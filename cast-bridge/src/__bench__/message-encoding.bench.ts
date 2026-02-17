import { bench, describe } from 'vitest';
import protobuf from 'protobufjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', '..', 'proto', 'cast_channel.proto');

const root = await protobuf.load(PROTO_PATH);
const CastMessage = root.lookupType('extensions.api.cast_channel.CastMessage');

// Typical media LOAD message
const LOAD_PAYLOAD = JSON.stringify({
  type: 'LOAD',
  requestId: 1,
  media: {
    contentId: 'https://example.com/video.mp4',
    contentType: 'video/mp4',
    streamType: 'BUFFERED',
  },
  currentTime: 0,
  autoplay: true,
});

const CAST_MSG = {
  protocolVersion: 0,
  sourceId: 'sender-0',
  destinationId: 'receiver-0',
  namespace: 'urn:x-cast:com.google.cast.media',
  payloadType: 0,
  payloadUtf8: LOAD_PAYLOAD,
};

const encodedPb = CastMessage.encode(CastMessage.create(CAST_MSG)).finish();

// A typical status update from WebSocket
const WS_STATUS = {
  playerState: 'PLAYING',
  currentTime: 42.5,
  duration: 300,
  volume: 1.0,
};
const WS_STATUS_STR = JSON.stringify(WS_STATUS);

describe('CastMessage protobuf', () => {
  bench('encode', () => {
    CastMessage.encode(CastMessage.create(CAST_MSG)).finish();
  });

  bench('decode', () => {
    CastMessage.decode(encodedPb);
  });

  bench('encode + decode roundtrip', () => {
    const buf = CastMessage.encode(CastMessage.create(CAST_MSG)).finish();
    CastMessage.decode(buf);
  });
});

describe('JSON stringify/parse (WebSocket messages)', () => {
  bench('JSON.stringify status', () => {
    JSON.stringify(WS_STATUS);
  });

  bench('JSON.parse status', () => {
    JSON.parse(WS_STATUS_STR);
  });

  bench('JSON roundtrip', () => {
    JSON.parse(JSON.stringify(WS_STATUS));
  });
});

describe('Buffer operations: length-prefix framing', () => {
  bench('alloc + writeUInt32BE + concat (original)', () => {
    const pbuf = CastMessage.encode(CastMessage.create(CAST_MSG)).finish();
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(pbuf.length, 0);
    Buffer.concat([lenBuf, Buffer.from(pbuf)]);
  });

  const LEN_BUF = Buffer.alloc(4);
  bench('reuse LEN_BUF + concat (optimized)', () => {
    const pbuf = CastMessage.encode(CastMessage.create(CAST_MSG)).finish();
    LEN_BUF.writeUInt32BE(pbuf.length, 0);
    const frame = Buffer.allocUnsafe(4 + pbuf.length);
    LEN_BUF.copy(frame, 0);
    frame.set(pbuf, 4);
  });

  bench('DataView on single allocation (zero-copy)', () => {
    const pbuf = CastMessage.encode(CastMessage.create(CAST_MSG)).finish();
    const frame = Buffer.allocUnsafe(4 + pbuf.length);
    frame.writeUInt32BE(pbuf.length, 0);
    frame.set(pbuf, 4);
  });
});
