# LG CX55 Cast Receiver

Make an LG CX55 TV appear as a Chromecast on the local network.

## Architecture

Two components communicating over WebSocket on the LAN:

- **cast-bridge** (Node.js/TS, runs on Ubuntu box) -- mDNS/DIAL advertisement, CastV2 protocol, WebSocket server
- **cast-display** (HTML/JS, sideloaded webOS app on LG CX55) -- media renderer, WebSocket client

```
Phone/Laptop                 Ubuntu Box              LG CX55
┌──────────┐   Cast/mDNS    ┌──────────────┐  WS   ┌──────────────┐
│  Sender  │ ──────────────>│  cast-bridge │──────>│ cast-display │
│   App    │   CastV2+TLS   │  (Node.js)   │       │  (webOS app) │
└──────────┘                └──────────────┘       └──────────────┘
```

## Phase 1: Media URL Casting

### cast-bridge

- **mDNS**: advertise `_googlecast._tcp` service on LAN (bonjour/mdns npm)
- **DIAL**: HTTP server on port 8008, responds to SSDP/UPnP discovery
- **CastV2**: TLS server on port 8009, speaks Cast protobuf protocol (session mgmt, media load, playback control)
- **WebSocket server**: pushes commands to TV app (`load`, `pause`, `seek`, `volume`, `stop`)
- **Status relay**: forwards TV playback state back to sender app

### cast-display

- **WebSocket client**: connects to cast-bridge, auto-reconnects
- **Media player**: HTML5 `<video>`/`<audio>`, handles URL playback + controls
- **Status reporting**: sends position/duration/state back to cast-bridge
- **Idle screen**: "ready to cast" when nothing playing

### Key dependencies

- `castv2` / `castv2-client` -- Cast protocol implementation (reverse to build receiver side)
- `bonjour-service` -- mDNS advertisement
- `ws` -- WebSocket
- `protobufjs` -- Cast protocol messages

## Phase 2: Screen Mirroring (future)

- cast-bridge receives WebRTC/H.264 mirroring stream from sender
- Relays to cast-display via WebRTC peer connection
- cast-display renders in `<video>` via MediaSource/WebRTC
- Target: presentation-quality latency, not gaming

## Deployment

- cast-bridge: systemd service on Ubuntu box
- cast-display: sideloaded via webOS Developer Mode (ares-cli)
