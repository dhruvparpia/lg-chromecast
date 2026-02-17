import { createSocket, type Socket } from "node:dgram";

export interface RtpReader {
  onPacket: (cb: (buf: Buffer) => void) => void;
  stop: () => void;
}

/**
 * Bind a UDP socket to the given port and emit raw RTP packets
 * as they arrive from FFmpeg's RTP output.
 */
export function createRtpReader(port: number): RtpReader {
  const socket: Socket = createSocket("udp4");
  const listeners: Array<(buf: Buffer) => void> = [];
  let stopped = false;

  socket.on("message", (msg) => {
    if (stopped) return;

    // Minimal RTP validation: version must be 2, packet at least 12 bytes (fixed header)
    if (msg.length < 12) return;
    const version = (msg[0]! >> 6) & 0x03;
    if (version !== 2) return;

    for (const cb of listeners) {
      cb(msg);
    }
  });

  socket.on("error", (err) => {
    if (!stopped) {
      console.error(`[rtp-reader] UDP socket error: ${err.message}`);
    }
  });

  socket.bind(port, "127.0.0.1", () => {
    console.log(`[rtp-reader] Listening for RTP on 127.0.0.1:${port}`);
  });

  return {
    onPacket(cb: (buf: Buffer) => void) {
      listeners.push(cb);
    },
    stop() {
      stopped = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}
