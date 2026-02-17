#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { startCapture } from "./capture.js";
import { startSender } from "./webrtc-sender.js";

// --- Argument parsing ---

interface CliOptions {
  bridge: string;
  display: string;
  bitrate: string;
  fps: number;
  resolution?: string;
}

function printUsage(): void {
  console.log(`
Usage: cast-sender [options]

Options:
  --bridge <url>      WebSocket URL of cast-bridge (default: ws://localhost:8010)
  --display <id>      X11 display to capture (default: :0)
  --bitrate <rate>    Video bitrate (default: 20M)
  --fps <n>           Frames per second (default: 60)
  --resolution <WxH>  Capture resolution (default: screen native)
  --help              Show this help message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    bridge: "ws://localhost:8010",
    display: ":0",
    bitrate: "20M",
    fps: 60,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--bridge":
        if (!next) throw new Error("--bridge requires a value");
        try { new URL(next); } catch { throw new Error("--bridge must be a valid URL (e.g. ws://host:8010)"); }
        opts.bridge = next;
        i++;
        break;
      case "--display":
        if (!next) throw new Error("--display requires a value");
        opts.display = next;
        i++;
        break;
      case "--bitrate":
        if (!next) throw new Error("--bitrate requires a value");
        opts.bitrate = next;
        i++;
        break;
      case "--fps":
        if (!next) throw new Error("--fps requires a value");
        opts.fps = parseInt(next, 10);
        if (isNaN(opts.fps) || opts.fps <= 0) {
          throw new Error("--fps must be a positive integer");
        }
        i++;
        break;
      case "--resolution":
        if (!next) throw new Error("--resolution requires a value");
        if (!/^\d+x\d+$/.test(next)) {
          throw new Error("--resolution must be in WxH format (e.g. 1920x1080)");
        }
        opts.resolution = next;
        i++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg?.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          printUsage();
          process.exit(1);
        }
        break;
    }
  }

  return opts;
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sessionId = randomUUID();

  console.log("[cast-sender] Starting screen capture sender");
  console.log(`[cast-sender] Session ID: ${sessionId}`);
  console.log(`[cast-sender] Bridge: ${opts.bridge}`);
  console.log(
    `[cast-sender] Capture: display=${opts.display} fps=${opts.fps} bitrate=${opts.bitrate}` +
      (opts.resolution ? ` resolution=${opts.resolution}` : " resolution=native")
  );

  // Start screen capture with FFmpeg
  const capture = await startCapture({
    display: opts.display,
    bitrate: opts.bitrate,
    fps: opts.fps,
    resolution: opts.resolution,
  });

  console.log(`[cast-sender] FFmpeg streaming RTP to 127.0.0.1:${capture.port}`);

  // Start WebRTC sender
  let sender: { stop: () => void } | undefined;
  try {
    sender = await startSender({
      bridgeUrl: opts.bridge,
      capturePort: capture.port,
      sessionId,
    });
  } catch (err) {
    console.error(
      `[cast-sender] Failed to start WebRTC sender: ${err instanceof Error ? err.message : err}`
    );
    capture.stop();
    process.exit(1);
  }

  // Graceful shutdown
  function shutdown() {
    console.log("\n[cast-sender] Shutting down...");
    sender?.stop();
    capture.stop();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[cast-sender] Running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error(`[cast-sender] Fatal error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
