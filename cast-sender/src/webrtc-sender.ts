import {
  RTCPeerConnection,
  RTCIceCandidate,
  MediaStreamTrack,
  RtpPacket,
} from "werift";
import WebSocket from "ws";
import { createRtpReader, type RtpReader } from "./rtp-reader.js";

export interface SenderOptions {
  bridgeUrl: string;
  capturePort: number;
  sessionId: string;
}

export interface SenderHandle {
  stop: () => void;
}

/**
 * Connect to cast-bridge via WebSocket, establish a WebRTC peer connection,
 * and forward RTP packets from the local FFmpeg capture into the WebRTC track.
 */
export async function startSender(
  options: SenderOptions
): Promise<SenderHandle> {
  const { bridgeUrl, capturePort, sessionId } = options;

  // --- WebSocket connection to cast-bridge ---
  console.log(`[sender] Connecting to cast-bridge at ${bridgeUrl}`);
  const ws = new WebSocket(bridgeUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  console.log("[sender] Connected to cast-bridge");

  function send(msg: Record<string, unknown>) {
    ws.send(JSON.stringify(msg));
  }

  // Identify as a sender
  send({ type: "sender-hello", sessionId });

  // --- WebRTC peer connection ---
  const pc = new RTCPeerConnection({
    iceServers: [],
  });

  // Create a video track for H.265
  // werift uses codec parameters to negotiate; 96 is the dynamic payload type for H.265
  const videoTrack = new MediaStreamTrack({ kind: "video" });
  const transceiver = pc.addTransceiver(videoTrack, { direction: "sendonly" });

  pc.onIceCandidate.subscribe((candidate) => {
    if (candidate) {
      send({
        type: "ice-candidate",
        sessionId,
        candidate: candidate.toJSON(),
        source: "custom",
      });
    }
  });

  pc.iceConnectionStateChange.subscribe((state) => {
    console.log(`[sender] ICE connection state: ${state}`);
  });

  // --- Create and send offer ---
  const offer = await pc.createOffer();

  // Munge SDP to ensure H.265 (payload type 96) is advertised
  let sdp = offer.sdp ?? "";
  if (!sdp.includes("H265") && !sdp.includes("H.265") && !sdp.includes("hevc")) {
    // Inject H.265 codec line if werift didn't include it
    sdp = sdp.replace(
      /(m=video \d+ [A-Z/]+ )/,
      "$1"
    );
    // Add H.265 rtpmap if missing
    if (!sdp.includes("a=rtpmap:96")) {
      sdp = sdp.replace(
        /(a=rtpmap:\d+ .*\r?\n)/,
        `a=rtpmap:96 H265/90000\r\na=fmtp:96 profile-id=1\r\n$1`
      );
    }
  }

  await pc.setLocalDescription({ type: "offer", sdp });
  console.log("[sender] Created WebRTC offer");

  send({
    type: "webrtc-offer",
    sessionId,
    sdp,
    source: "custom",
  });

  // --- Handle incoming messages ---
  const messageHandler = async (data: WebSocket.RawData) => {
    try {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "webrtc-answer": {
          console.log("[sender] Received WebRTC answer");
          await pc.setRemoteDescription({
            type: "answer",
            sdp: msg.sdp as string,
          });
          break;
        }
        case "ice-candidate": {
          if (msg.candidate) {
            const candidate = msg.candidate as { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error("[sender] Error handling message:", err);
    }
  };

  ws.on("message", messageHandler);

  // --- Read RTP from FFmpeg and feed into WebRTC ---
  let rtpReader: RtpReader | undefined;

  // Small delay to let FFmpeg start producing packets
  await new Promise((resolve) => setTimeout(resolve, 500));

  rtpReader = createRtpReader(capturePort);

  rtpReader.onPacket((buf: Buffer) => {
    try {
      const rtp = RtpPacket.deSerialize(buf);
      // Ensure payload type matches our negotiated type
      rtp.header.payloadType = 96;
      videoTrack.writeRtp(rtp);
    } catch {
      // Skip malformed packets silently
    }
  });

  console.log("[sender] Streaming started");

  // --- Cleanup ---
  return {
    stop() {
      console.log("[sender] Stopping...");
      rtpReader?.stop();
      pc.close();
      ws.close();
    },
  };
}
