import { spawn, execSync, execFileSync, type ChildProcess } from "node:child_process";
import { createSocket } from "node:dgram";

export interface CaptureOptions {
  display: string;
  bitrate: string;
  fps: number;
  resolution?: string;
}

export interface CaptureHandle {
  port: number;
  process: ChildProcess;
  stop: () => void;
}

/** Check that ffmpeg is installed and reachable. */
export function checkFfmpeg(): void {
  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
  } catch {
    console.error(
      "[capture] FFmpeg is not installed or not in PATH.\n" +
        "  Install it with: sudo dnf install ffmpeg   (Fedora)\n" +
        "                    sudo apt install ffmpeg   (Debian/Ubuntu)\n" +
        "                    brew install ffmpeg        (macOS)"
    );
    process.exit(1);
  }
}

/** Check if NVENC H.265 encoder is available. */
export function hasNvenc(): boolean {
  try {
    const out = execFileSync("ffmpeg", ["-encoders"], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    return out.includes("hevc_nvenc");
  } catch {
    return false;
  }
}

/** Get the native screen resolution from xdpyinfo. */
function detectResolution(display: string): string | undefined {
  try {
    const out = execFileSync('xdpyinfo', ['-display', display], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: display },
    });
    const match = out.match(/dimensions:\s+(\d+x\d+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Find a random available UDP port by briefly binding a socket. */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = createSocket("udp4");
    sock.bind(0, "127.0.0.1", () => {
      const addr = sock.address();
      const port = addr.port;
      sock.close(() => resolve(port));
    });
    sock.on("error", reject);
  });
}

/**
 * Spawn FFmpeg to capture the screen and output RTP to a local UDP port.
 * Uses NVENC H.265 if available, falls back to libx265 ultrafast.
 */
export async function startCapture(
  options: CaptureOptions
): Promise<CaptureHandle> {
  if (!/^:\d+(\.\d+)?$/.test(options.display)) {
    throw new Error(`Invalid display format: ${options.display}. Expected format like :0 or :0.0`);
  }

  checkFfmpeg();

  const nvenc = hasNvenc();
  if (nvenc) {
    console.log("[capture] NVENC H.265 encoder detected");
  } else {
    console.warn(
      "[capture] WARNING: NVENC not available, falling back to libx265 software encoding.\n" +
        "  Performance will be significantly worse. Install NVIDIA drivers with NVENC support for best results."
    );
  }

  const port = await findAvailablePort();
  const resolution =
    options.resolution ?? detectResolution(options.display) ?? "1920x1080";

  console.log(
    `[capture] Resolution: ${resolution}, FPS: ${options.fps}, Bitrate: ${options.bitrate}`
  );

  const args: string[] = [];

  if (nvenc) {
    // Zero-copy GPU pipeline: grab screen -> CUDA memory -> NVENC encode
    args.push(
      "-hwaccel",
      "cuda",
      "-hwaccel_output_format",
      "cuda",
      "-f",
      "x11grab",
      "-framerate",
      String(options.fps),
      "-video_size",
      resolution,
      "-i",
      options.display,
      "-c:v",
      "hevc_nvenc",
      "-preset",
      "p1",
      "-tune",
      "ull",
      "-rc",
      "cbr",
      "-b:v",
      options.bitrate,
      "-f",
      "rtp",
      `rtp://127.0.0.1:${port}`
    );
  } else {
    // Software fallback
    args.push(
      "-f",
      "x11grab",
      "-framerate",
      String(options.fps),
      "-video_size",
      resolution,
      "-i",
      options.display,
      "-c:v",
      "libx265",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-b:v",
      options.bitrate,
      "-f",
      "rtp",
      `rtp://127.0.0.1:${port}`
    );
  }

  console.log(`[capture] Spawning: ffmpeg ${args.join(" ")}`);

  const proc = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    // Only log non-spammy lines (skip frame progress lines in normal operation)
    if (line && !line.startsWith("frame=")) {
      console.log(`[ffmpeg] ${line}`);
    }
  });

  proc.on("error", (err) => {
    console.error(`[capture] FFmpeg process error: ${err.message}`);
  });

  proc.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[capture] FFmpeg exited with code ${code}`);
    } else if (signal) {
      console.log(`[capture] FFmpeg killed with signal ${signal}`);
    }
  });

  return {
    port,
    process: proc,
    stop() {
      if (!proc.killed) {
        proc.kill("SIGTERM");
        // Force kill after 2 seconds if still alive
        const killTimer = setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 2000);
        killTimer.unref();
      }
    },
  };
}
