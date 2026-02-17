import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import * as tls from 'node:tls';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { startCastV2Server } from '../castv2-server.js';

// ---------------------------------------------------------------------------
// Protobuf setup
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(__dirname, '..', '..', 'proto', 'cast_channel.proto');

let CastMessage: protobuf.Type;

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection';
const NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat';
const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver';
const NS_MEDIA = 'urn:x-cast:com.google.cast.media';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeCastMessage(msg: Record<string, unknown>): Buffer {
  const err = CastMessage.verify(msg);
  if (err) throw new Error(`CastMessage verify: ${err}`);
  const pbuf = CastMessage.encode(CastMessage.create(msg)).finish();
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(pbuf.length, 0);
  return Buffer.concat([lenBuf, Buffer.from(pbuf)]);
}

function sendMessage(
  socket: tls.TLSSocket,
  sourceId: string,
  destId: string,
  namespace: string,
  payload: Record<string, unknown>,
): void {
  const raw = encodeCastMessage({
    protocolVersion: 0,
    sourceId,
    destinationId: destId,
    namespace,
    payloadType: 0,
    payloadUtf8: JSON.stringify(payload),
  });
  socket.write(raw);
}

function readMessage(
  socket: tls.TLSSocket,
  timeoutMs = 5000,
): Promise<{ sourceId: string; destinationId: string; namespace: string; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('readMessage timed out'));
    }, timeoutMs);

    function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const msgLen = buf.readUInt32BE(0);
      if (buf.length < 4 + msgLen) return;

      const msgBytes = buf.subarray(4, 4 + msgLen);
      cleanup();

      const decoded = CastMessage.decode(msgBytes).toJSON() as Record<string, unknown>;
      let payload: Record<string, unknown> = {};
      if (decoded.payloadUtf8) {
        try {
          payload = JSON.parse(decoded.payloadUtf8 as string);
        } catch {
          // ignore
        }
      }
      resolve({
        sourceId: decoded.sourceId as string,
        destinationId: decoded.destinationId as string,
        namespace: decoded.namespace as string,
        payload,
      });
    }

    function onError(err: Error) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function connectToServer(port: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CastV2 Server', () => {
  let server: { port: number; close: () => void };
  let onMediaCommand: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const root = await protobuf.load(PROTO_PATH);
    CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage');
    onMediaCommand = vi.fn();
    server = await startCastV2Server({ onMediaCommand });
  }, 10000);

  afterAll(() => {
    server?.close();
  });

  it('starts and listens on port 8009', () => {
    expect(server.port).toBe(8009);
  }, 5000);

  it('heartbeat: send PING, receive PONG', async () => {
    const socket = await connectToServer(server.port);
    try {
      sendMessage(socket, 'sender-0', 'receiver-0', NS_HEARTBEAT, { type: 'PING' });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_HEARTBEAT);
      expect(resp.payload.type).toBe('PONG');
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('connection: send CONNECT, receive CONNECTED', async () => {
    const socket = await connectToServer(server.port);
    try {
      sendMessage(socket, 'sender-0', 'receiver-0', NS_CONNECTION, { type: 'CONNECT' });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_CONNECTION);
      expect(resp.payload.type).toBe('CONNECTED');
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('receiver: send GET_STATUS, receive RECEIVER_STATUS with CC1AD845 app', async () => {
    const socket = await connectToServer(server.port);
    try {
      sendMessage(socket, 'sender-0', 'receiver-0', NS_RECEIVER, {
        type: 'GET_STATUS',
        requestId: 1,
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_RECEIVER);
      expect(resp.payload.type).toBe('RECEIVER_STATUS');
      expect(resp.payload.requestId).toBe(1);
      const status = resp.payload.status as Record<string, unknown>;
      const apps = status.applications as Array<Record<string, unknown>>;
      expect(apps).toHaveLength(1);
      expect(apps[0].appId).toBe('CC1AD845');
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media LOAD: calls onMediaCommand with type load, url, contentType', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'LOAD',
        requestId: 10,
        media: {
          contentId: 'http://example.com/video.mp4',
          contentType: 'video/mp4',
          streamType: 'BUFFERED',
        },
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(10);

      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'load',
          url: 'http://example.com/video.mp4',
          contentType: 'video/mp4',
        }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media PLAY: calls onMediaCommand with type play', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'PLAY',
        requestId: 11,
        mediaSessionId: 1,
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(11);
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'play', requestId: 11 }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media PAUSE: calls onMediaCommand with type pause', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'PAUSE',
        requestId: 12,
        mediaSessionId: 1,
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(12);
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pause', requestId: 12 }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media SEEK: calls onMediaCommand with type seek and currentTime', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'SEEK',
        requestId: 13,
        mediaSessionId: 1,
        currentTime: 42.5,
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(13);
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'seek', currentTime: 42.5, requestId: 13 }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media STOP: calls onMediaCommand with type stop', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'STOP',
        requestId: 14,
        mediaSessionId: 1,
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(14);
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stop', requestId: 14 }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('media SET_VOLUME: calls onMediaCommand with type volume and level', async () => {
    const socket = await connectToServer(server.port);
    try {
      onMediaCommand.mockClear();
      sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, {
        type: 'SET_VOLUME',
        requestId: 15,
        volume: { level: 0.75 },
      });
      const resp = await readMessage(socket);
      expect(resp.namespace).toBe(NS_MEDIA);
      expect(resp.payload.type).toBe('MEDIA_STATUS');
      expect(resp.payload.requestId).toBe(15);
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'volume', volume: 0.75, requestId: 15 }),
      );
    } finally {
      socket.destroy();
    }
  }, 5000);

  it('all media responses include MEDIA_STATUS with correct requestId', async () => {
    const socket = await connectToServer(server.port);
    try {
      const commands = [
        { type: 'LOAD', requestId: 100, media: { contentId: 'http://example.com/a.mp4', contentType: 'video/mp4' } },
        { type: 'PLAY', requestId: 101, mediaSessionId: 1 },
        { type: 'PAUSE', requestId: 102, mediaSessionId: 1 },
        { type: 'SEEK', requestId: 103, mediaSessionId: 1, currentTime: 10 },
        { type: 'STOP', requestId: 104, mediaSessionId: 1 },
      ];

      for (const cmd of commands) {
        sendMessage(socket, 'sender-0', 'receiver-0', NS_MEDIA, cmd);
        const resp = await readMessage(socket);
        expect(resp.payload.type).toBe('MEDIA_STATUS');
        expect(resp.payload.requestId).toBe(cmd.requestId);
        const status = resp.payload.status as Array<Record<string, unknown>>;
        expect(Array.isArray(status)).toBe(true);
        expect(status.length).toBeGreaterThan(0);
      }
    } finally {
      socket.destroy();
    }
  }, 10000);

  it('multiple connections work independently', async () => {
    const socket1 = await connectToServer(server.port);
    const socket2 = await connectToServer(server.port);
    try {
      // Send PING on both connections
      sendMessage(socket1, 'sender-1', 'receiver-0', NS_HEARTBEAT, { type: 'PING' });
      sendMessage(socket2, 'sender-2', 'receiver-0', NS_HEARTBEAT, { type: 'PING' });

      const [resp1, resp2] = await Promise.all([
        readMessage(socket1),
        readMessage(socket2),
      ]);

      expect(resp1.payload.type).toBe('PONG');
      expect(resp1.destinationId).toBe('sender-1');
      expect(resp2.payload.type).toBe('PONG');
      expect(resp2.destinationId).toBe('sender-2');

      // Send media commands on different connections independently
      onMediaCommand.mockClear();

      sendMessage(socket1, 'sender-1', 'receiver-0', NS_MEDIA, {
        type: 'LOAD',
        requestId: 200,
        media: { contentId: 'http://example.com/1.mp4', contentType: 'video/mp4' },
      });
      sendMessage(socket2, 'sender-2', 'receiver-0', NS_MEDIA, {
        type: 'LOAD',
        requestId: 201,
        media: { contentId: 'http://example.com/2.mp4', contentType: 'audio/mp3' },
      });

      const [mResp1, mResp2] = await Promise.all([
        readMessage(socket1),
        readMessage(socket2),
      ]);

      expect(mResp1.payload.requestId).toBe(200);
      expect(mResp2.payload.requestId).toBe(201);

      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'load', url: 'http://example.com/1.mp4' }),
      );
      expect(onMediaCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'load', url: 'http://example.com/2.mp4' }),
      );
    } finally {
      socket1.destroy();
      socket2.destroy();
    }
  }, 10000);
});
