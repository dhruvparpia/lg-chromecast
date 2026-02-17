import { createServer, TLSSocket } from 'node:tls';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import protobuf from 'protobufjs';
import type { MediaCommand } from './types.js';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

interface StartOptions {
  onMediaCommand: (cmd: MediaCommand) => void;
  deviceName?: string;
  port?: number;
  onWebrtcOffer?: (
    sessionId: string,
    sdp: string,
    sendAnswer: (sdp: string) => void,
    sendCandidate: (candidate: object) => void,
  ) => void;
  onIceCandidate?: (sessionId: string, candidate: object) => void;
  onMirroringStop?: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Self-signed certificate generation (in-memory, no files)
// ---------------------------------------------------------------------------

let cachedCert: { key: string; cert: string } | null = null;

function generateSelfSignedCert(): { key: string; cert: string } {
  if (cachedCert) return cachedCert;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const pkDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

  const certDer = buildSelfSignedCert(pkDer, pubDer);

  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const certPem = derToPem(certDer, 'CERTIFICATE');

  cachedCert = { key: keyPem, cert: certPem };
  return cachedCert;
}

// ---------------------------------------------------------------------------
// Minimal ASN.1 DER builder for a self-signed X.509 v3 certificate
// ---------------------------------------------------------------------------

function derLength(len: number): Buffer {
  if (len > 0xFFFF) throw new Error('DER length > 65535 not supported');
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTag(tag: number, content: Buffer): Buffer {
  const len = derLength(content.length);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}

function derSequence(content: Buffer): Buffer {
  return derTag(0x30, content);
}

function derSet(content: Buffer): Buffer {
  return derTag(0x31, content);
}

function derUtf8String(s: string): Buffer {
  return derTag(0x0c, Buffer.from(s, 'utf-8'));
}

function derUtcTime(s: string): Buffer {
  return derTag(0x17, Buffer.from(s, 'ascii'));
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function buildSelfSignedCert(pkDer: Buffer, pubDer: Buffer): Buffer {
  // Serial number: INTEGER 1
  const serial = Buffer.from([0x02, 0x01, 0x01]);

  // Signature algorithm: sha256WithRSAEncryption
  const sigAlgOid = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x0b, 0x05, 0x00,
  ]);

  // Issuer / Subject: CN=CastV2
  const cn = derUtf8String('CastV2');
  const atv = derSequence(Buffer.concat([
    Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]), // OID 2.5.4.3 (CN)
    cn,
  ]));
  const rdn = derSet(atv);
  const name = derSequence(rdn);

  // Validity: 2025-01-01 to 2035-01-01
  const notBefore = derUtcTime('250101000000Z');
  const notAfter = derUtcTime('350101000000Z');
  const validity = derSequence(Buffer.concat([notBefore, notAfter]));

  // Version: v3 (explicit tag [0])
  const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]);

  // TBS Certificate
  const tbs = derSequence(Buffer.concat([
    version,
    serial,
    sigAlgOid,
    name,     // issuer
    validity,
    name,     // subject
    pubDer,   // subjectPublicKeyInfo (already DER SPKI)
  ]));

  // Sign the TBS
  const signer = createSign('SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign({ key: Buffer.from(pkDer), format: 'der', type: 'pkcs8' });

  // BitString wrapper for signature
  const sigBits = Buffer.concat([
    Buffer.from([0x00]), // no unused bits
    signature,
  ]);
  const sigBitString = derTag(0x03, sigBits);

  // Final certificate: SEQUENCE { tbs, sigAlg, signature }
  return derSequence(Buffer.concat([tbs, sigAlgOid, sigBitString]));
}

// ---------------------------------------------------------------------------
// Protobuf loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'cast_channel.proto');

let CastMessage: protobuf.Type;
let protoLoaded = false;

async function loadProto(): Promise<void> {
  if (protoLoaded) return;
  const root = await protobuf.load(PROTO_PATH);
  CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage');
  protoLoaded = true;
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection';
const NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat';
const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver';
const NS_MEDIA = 'urn:x-cast:com.google.cast.media';
const NS_WEBRTC = 'urn:x-cast:com.google.cast.webrtc';
const NS_REMOTING = 'urn:x-cast:com.google.cast.remoting';

// ---------------------------------------------------------------------------
// Default receiver status (mimics a Chromecast with Default Media Receiver)
// ---------------------------------------------------------------------------

const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

function makeReceiverStatus(sessionId: string, transportId: string) {
  return {
    applications: [
      {
        appId: DEFAULT_MEDIA_RECEIVER_APP_ID,
        displayName: 'Default Media Receiver',
        namespaces: [
          { name: NS_MEDIA },
          { name: NS_WEBRTC },
          { name: NS_REMOTING },
          { name: 'urn:x-cast:com.google.cast.debugoverlay' },
        ],
        sessionId,
        statusText: '',
        transportId,
        isIdleScreen: false,
      },
    ],
    volume: {
      controlType: 'attenuation',
      level: 1.0,
      muted: false,
      stepInterval: 0.05,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-connection media state
// ---------------------------------------------------------------------------

interface MediaState {
  mediaSessionId: number;
  media: { contentId: string; contentType: string; streamType: string } | null;
  currentTime: number;
  playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
  supportedMediaCommands: number;
  volume: { level: number; muted: boolean };
}

function makeDefaultMediaState(): MediaState {
  return {
    mediaSessionId: 1,
    media: null,
    currentTime: 0,
    playerState: 'IDLE',
    supportedMediaCommands: 0b1111111,
    volume: { level: 1.0, muted: false },
  };
}

function makeMediaStatus(state: MediaState) {
  const entry: Record<string, unknown> = {
    mediaSessionId: state.mediaSessionId,
    playbackRate: 1,
    playerState: state.playerState,
    currentTime: state.currentTime,
    supportedMediaCommands: state.supportedMediaCommands,
    volume: state.volume,
  };
  if (state.media) {
    entry.media = state.media;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Message framing helpers
// ---------------------------------------------------------------------------

function encodeMessage(msg: Record<string, unknown>): Buffer {
  const err = CastMessage.verify(msg);
  if (err) throw new Error(`CastMessage verify: ${err}`);
  const pbuf = CastMessage.encode(CastMessage.create(msg)).finish();
  // Single allocation: 4 bytes length prefix + protobuf payload
  const frame = Buffer.allocUnsafe(4 + pbuf.length);
  frame.writeUInt32BE(pbuf.length, 0);
  frame.set(pbuf, 4);
  return frame;
}

function sendJsonMessage(
  socket: TLSSocket,
  sourceId: string,
  destinationId: string,
  namespace: string,
  payload: Record<string, unknown>,
): void {
  const raw = encodeMessage({
    protocolVersion: 0, // CASTV2_1_0
    sourceId,
    destinationId,
    namespace,
    payloadType: 0, // STRING
    payloadUtf8: JSON.stringify(payload),
  });
  socket.write(raw);
}

// ---------------------------------------------------------------------------
// Pre-built static response helpers
// ---------------------------------------------------------------------------

function buildPongBuffer(sourceId: string, destinationId: string): Buffer {
  return encodeMessage({
    protocolVersion: 0,
    sourceId,
    destinationId,
    namespace: NS_HEARTBEAT,
    payloadType: 0,
    payloadUtf8: '{"type":"PONG"}',
  });
}

function buildConnectedBuffer(sourceId: string, destinationId: string, requestId: number): Buffer {
  return encodeMessage({
    protocolVersion: 0,
    sourceId,
    destinationId,
    namespace: NS_CONNECTION,
    payloadType: 0,
    payloadUtf8: JSON.stringify({ type: 'CONNECTED', requestId }),
  });
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

function handleConnection(
  socket: TLSSocket,
  options: StartOptions,
): void {
  const { onMediaCommand, onWebrtcOffer, onIceCandidate, onMirroringStop } = options;
  const sessionId = randomUUID();
  const transportId = `transport-${sessionId.slice(0, 8)}`;
  const mediaState = makeDefaultMediaState();
  // Smarter receive buffer: track offset instead of slicing on every message
  let recvBuf = Buffer.alloc(0);
  let recvOffset = 0;

  socket.on('data', (chunk: Buffer) => {
    // Append chunk to receive buffer
    if (recvOffset > 0 && recvOffset === recvBuf.length) {
      // Buffer fully consumed, reset
      recvBuf = chunk;
      recvOffset = 0;
    } else if (recvOffset > 0) {
      // Compact remaining data + new chunk
      const remaining = recvBuf.length - recvOffset;
      const newBuf = Buffer.allocUnsafe(remaining + chunk.length);
      recvBuf.copy(newBuf, 0, recvOffset);
      chunk.copy(newBuf, remaining);
      recvBuf = newBuf;
      recvOffset = 0;
    } else {
      recvBuf = Buffer.concat([recvBuf, chunk]);
    }

    while (recvBuf.length - recvOffset >= 4) {
      const msgLen = recvBuf.readUInt32BE(recvOffset);
      const MAX_MSG_LEN = 1024 * 1024; // 1 MB
      if (msgLen > MAX_MSG_LEN) {
        socket.destroy();
        return;
      }
      if (recvBuf.length - recvOffset < 4 + msgLen) break;

      const msgBytes = recvBuf.subarray(recvOffset + 4, recvOffset + 4 + msgLen);
      recvOffset += 4 + msgLen;

      let decoded: Record<string, unknown>;
      try {
        decoded = CastMessage.decode(msgBytes).toJSON() as Record<string, unknown>;
      } catch {
        continue;
      }

      const ns = decoded.namespace as string;
      const src = decoded.sourceId as string;
      const dst = decoded.destinationId as string;
      let payload: Record<string, unknown> = {};

      if (decoded.payloadType === 'STRING' || decoded.payloadType === 0) {
        try {
          payload = JSON.parse(decoded.payloadUtf8 as string);
        } catch {
          // ignore malformed JSON
        }
      }

      const requestId = (payload.requestId as number) ?? 0;

      switch (ns) {
        // -- Connection --
        case NS_CONNECTION: {
          const msgType = (payload.type as string) ?? '';
          if (msgType === 'CONNECT') {
            socket.write(buildConnectedBuffer(dst, src, requestId));
          }
          // CLOSE: let the socket close naturally
          break;
        }

        // -- Heartbeat --
        case NS_HEARTBEAT: {
          if (payload.type === 'PING') {
            socket.write(buildPongBuffer(dst, src));
          }
          break;
        }

        // -- Receiver control --
        case NS_RECEIVER: {
          const msgType = (payload.type as string) ?? '';
          if (msgType === 'GET_STATUS') {
            sendJsonMessage(socket, dst, src, NS_RECEIVER, {
              type: 'RECEIVER_STATUS',
              requestId,
              status: makeReceiverStatus(sessionId, transportId),
            });
          } else if (msgType === 'LAUNCH') {
            sendJsonMessage(socket, dst, src, NS_RECEIVER, {
              type: 'RECEIVER_STATUS',
              requestId,
              status: makeReceiverStatus(sessionId, transportId),
            });
          } else if (msgType === 'STOP') {
            mediaState.playerState = 'IDLE';
            mediaState.media = null;
            sendJsonMessage(socket, dst, src, NS_RECEIVER, {
              type: 'RECEIVER_STATUS',
              requestId,
              status: makeReceiverStatus(sessionId, transportId),
            });
            onMediaCommand({ type: 'stop', requestId });
          }
          break;
        }

        // -- Media control --
        case NS_MEDIA: {
          const msgType = (payload.type as string) ?? '';

          if (msgType === 'GET_STATUS') {
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
          } else if (msgType === 'LOAD') {
            const mediaInfo = payload.media as Record<string, unknown> | undefined;
            const contentId = (mediaInfo?.contentId as string) ?? (mediaInfo?.url as string) ?? '';
            const contentType = (mediaInfo?.contentType as string) ?? 'video/mp4';
            const streamType = (mediaInfo?.streamType as string) ?? 'BUFFERED';

            mediaState.media = { contentId, contentType, streamType };
            mediaState.playerState = 'PLAYING';
            mediaState.currentTime = (payload.currentTime as number) ?? 0;
            mediaState.mediaSessionId += 1;

            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });

            onMediaCommand({
              type: 'load',
              url: contentId,
              contentType,
              currentTime: mediaState.currentTime,
              requestId,
            });
          } else if (msgType === 'PLAY') {
            mediaState.playerState = 'PLAYING';
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
            onMediaCommand({ type: 'play', requestId });
          } else if (msgType === 'PAUSE') {
            mediaState.playerState = 'PAUSED';
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
            onMediaCommand({ type: 'pause', requestId });
          } else if (msgType === 'SEEK') {
            mediaState.currentTime = (payload.currentTime as number) ?? 0;
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
            onMediaCommand({
              type: 'seek',
              currentTime: mediaState.currentTime,
              requestId,
            });
          } else if (msgType === 'STOP') {
            mediaState.playerState = 'IDLE';
            mediaState.media = null;
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
            onMediaCommand({ type: 'stop', requestId });
          } else if (msgType === 'SET_VOLUME' || msgType === 'VOLUME') {
            const vol = payload.volume as Record<string, unknown> | undefined;
            if (vol) {
              if (typeof vol.level === 'number') mediaState.volume.level = vol.level;
              if (typeof vol.muted === 'boolean') mediaState.volume.muted = vol.muted;
            }
            sendJsonMessage(socket, dst, src, NS_MEDIA, {
              type: 'MEDIA_STATUS',
              requestId,
              status: [makeMediaStatus(mediaState)],
            });
            onMediaCommand({
              type: 'volume',
              volume: mediaState.volume.level,
              requestId,
            });
          }
          break;
        }

        // -- WebRTC signaling --
        case NS_WEBRTC: {
          const msgType = (payload.type as string) ?? '';
          if (msgType === 'OFFER') {
            const seqNum = (payload.seqNum as number) ?? 0;
            const offerObj = payload.offer as Record<string, unknown> | undefined;
            const sdp = (offerObj?.sdp as string) ?? '';
            if (DEBUG) console.log(`[castv2] WebRTC OFFER seqNum=${seqNum} sessionId=${sessionId}`);

            const sendAnswer = (answerSdp: string): void => {
              sendJsonMessage(socket, dst, src, NS_WEBRTC, {
                type: 'ANSWER',
                seqNum,
                answer: { sdp: answerSdp },
              });
            };

            const sendCandidate = (candidate: object): void => {
              sendJsonMessage(socket, dst, src, NS_WEBRTC, {
                type: 'ICE_CANDIDATE',
                seqNum,
                candidate,
              });
            };

            if (onWebrtcOffer) {
              onWebrtcOffer(sessionId, sdp, sendAnswer, sendCandidate);
            }
          } else if (msgType === 'ICE_CANDIDATE') {
            const candidate = payload.candidate as object | undefined;
            if (DEBUG) console.log(`[castv2] WebRTC ICE_CANDIDATE sessionId=${sessionId}`);
            if (onIceCandidate && candidate) {
              onIceCandidate(sessionId, candidate);
            }
          }
          break;
        }

        // -- Remoting control --
        case NS_REMOTING: {
          const msgType = (payload.type as string) ?? '';
          if (msgType === 'SETUP') {
            if (DEBUG) console.log(`[castv2] Remoting SETUP sessionId=${sessionId}`);
            sendJsonMessage(socket, dst, src, NS_REMOTING, {
              type: 'SETUP_OK',
            });
          } else if (msgType === 'START') {
            if (DEBUG) console.log(`[castv2] Remoting START sessionId=${sessionId}`);
            sendJsonMessage(socket, dst, src, NS_REMOTING, {
              type: 'START_OK',
            });
          } else if (msgType === 'STOP') {
            if (DEBUG) console.log(`[castv2] Remoting STOP sessionId=${sessionId}`);
            sendJsonMessage(socket, dst, src, NS_REMOTING, {
              type: 'STOP_OK',
            });
            if (onMirroringStop) {
              onMirroringStop(sessionId);
            }
          }
          break;
        }

        default:
          break;
      }
    }
  });

  socket.on('error', () => {
    // Connection errors are expected when senders disconnect
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startCastV2Server(
  options: StartOptions,
): Promise<{ port: number; close: () => void }> {
  await loadProto();

  const { key, cert } = generateSelfSignedCert();

  const server = createServer(
    {
      key,
      cert,
      rejectUnauthorized: false,
    },
    (socket) => {
      handleConnection(socket, options);
    },
  );

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(options.port ?? 8009, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 8009;
      console.log(`CastV2 TLS server listening on port ${port}`);
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}
