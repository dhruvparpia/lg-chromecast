# Screen Mirroring Design

## Phase 2a: Chrome Cast Screen Relay

Relay Chrome's tab/desktop cast stream to the TV via WebRTC signaling.

### Flow

1. Chrome sends SDP offer via `urn:x-cast:com.google.cast.webrtc` namespace over CastV2
2. cast-bridge relays the offer to cast-display via WebSocket
3. cast-display creates a WebRTC peer connection, generates SDP answer
4. cast-bridge relays the answer back to Chrome via CastV2
5. ICE candidates exchanged via the same relay path
6. Once connected, media flows peer-to-peer (Chrome -> TV directly on LAN)
7. cast-bridge drops out of the data path

### Components

- `cast-bridge/src/webrtc-signaling.ts` -- SDP/ICE relay between CastV2 and WebSocket
- `cast-bridge/src/castv2-server.ts` -- add `webrtc` and `remoting` namespace handlers
- `cast-display/app.js` -- add WebRTC peer connection, render remote stream in `<video>`

### Codec: VP8 or H.264 (whatever Chrome sends)

## Phase 2b: Custom NVENC H.265 Pipeline

Ultra-low-latency screen mirroring from CUDA-capable machines.

### Flow

1. Custom sender agent captures screen (X11/Wayland grab or PipeWire)
2. Encodes with NVENC H.265 (hardware, sub-5ms encode latency)
3. Sends RTP/WebRTC stream directly to cast-display
4. cast-bridge handles signaling only
5. cast-display decodes H.265 via TV's hardware decoder

### Components

- `cast-sender/` -- new package, Node.js or native binary
  - Screen capture (FFmpeg with NVENC or GStreamer)
  - WebRTC sender with H.265 codec
  - Connects to cast-bridge for signaling
- `cast-bridge/src/sender-signaling.ts` -- custom sender WebSocket endpoint
- `cast-display/app.js` -- extend WebRTC to handle H.265 streams

### Latency targets

| Stage | Target |
|-------|--------|
| Screen capture | < 5ms |
| NVENC H.265 encode | < 5ms |
| Network (LAN) | < 1ms |
| TV decode + render | < 16ms (one frame at 60fps) |
| **Total** | **< 30ms** |
