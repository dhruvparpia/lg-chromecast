# Cast Bridge

Make any TV appear as a Chromecast on your local network. Cast from YouTube, Chrome, or any Cast-enabled app.

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

## Install

### Option 1: Install script (recommended)

```sh
git clone https://github.com/dhruvparpia/lg-chromecast.git
cd lg-chromecast
./scripts/install.sh
```

Sets up a systemd service that starts on boot.

### Option 2: Docker

```sh
git clone https://github.com/dhruvparpia/lg-chromecast.git
cd lg-chromecast
DEVICE_NAME="Living Room TV" docker compose up -d
```

Note: requires `network_mode: host` for mDNS (already configured in `docker-compose.yml`).

### Option 3: Manual

```sh
cd cast-bridge
npm install
DEVICE_NAME="My TV" npm start
```

## TV Setup (cast-display)

### Option A: Browser

Open in the TV's web browser. Works on any smart TV.

```
http://<bridge-ip>:8010?bridge=<bridge-ip>
```

### Option B: webOS sideload

```sh
./scripts/package-webos.sh
```

Then install with the webOS CLI tools:

```sh
ares-install cast-display/com.cast.display_1.0.0_all.ipk
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DEVICE_NAME` | `Cast Bridge` | Name shown in Cast device list |
| `DEBUG` | (unset) | Set to `1` for verbose logging |

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 8008 | HTTP | DIAL discovery |
| 8009 | TLS | CastV2 protocol |
| 8010 | WebSocket | Bridge <-> Display |

## Limitations

- DRM streams won't work (Netflix, Disney+, etc.)
- Screen mirroring not yet implemented
- Some Cast apps may need protocol tweaks

## Development

```sh
npm test        # 49 tests
npm run bench   # performance benchmarks
npm run dev     # watch mode
```
