# Cast Bridge

Make any TV appear as a Chromecast on your local network. Cast from YouTube, Chrome, or any Cast-enabled app -- the TV shows up as a cast target just like a real Chromecast.

## How it works

```
Phone/Laptop                 Ubuntu Box              Any TV/Display
┌──────────┐   Cast/mDNS    ┌──────────────┐  WS   ┌──────────────┐
│  Sender  │ ──────────────>│  cast-bridge │──────>│ cast-display │
│   App    │   CastV2+TLS   │  (Node.js)   │       │  (web app)   │
└──────────┘                └──────────────┘       └──────────────┘
```

**cast-bridge** runs on an always-on machine (server, Pi, NAS). It advertises as a Chromecast via mDNS/DIAL and speaks the CastV2 protocol. When something is cast, it relays the media URL to the display over WebSocket.

**cast-display** runs on the TV (or any device with a browser). It connects to the bridge, receives media URLs, and plays them full-screen.

## Quick start

### 1. Start the bridge

```sh
cd cast-bridge
npm install
npm start
```

Set a custom device name (what shows up in the Cast list):

```sh
DEVICE_NAME="Living Room TV" npm start
```

### 2. Open the display on your TV

Open this URL in your TV's browser (or sideload as a webOS app):

```
http://<bridge-ip>:8010?bridge=<bridge-ip>
```

For webOS TVs, sideload with `ares-install`:

```sh
cd cast-display
ares-package .
ares-install com.cast.display_1.0.0_all.ipk
```

### 3. Cast

Open any Cast-enabled app, tap the Cast button, and select your device.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 8008 | HTTP | DIAL discovery |
| 8009 | TLS | CastV2 protocol |
| 8010 | WebSocket | Bridge <-> Display |

## Limitations

- DRM-protected streams (Netflix, Disney+, etc.) won't work -- they require licensed Chromecast hardware
- Screen mirroring not yet implemented (media URL casting only)
- Real Cast sender apps may need protocol tweaks discovered during testing
