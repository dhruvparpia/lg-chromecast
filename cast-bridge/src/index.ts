import { startMdns } from './mdns.js';
import { startDial } from './dial.js';
import { startCastV2Server } from './castv2-server.js';
import { startWsServer } from './ws-server.js';
import { createMediaRelay } from './media-relay.js';
import { createSignalingRelay } from './webrtc-signaling.js';
import type { IceCandidateInit } from './types.js';

const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Cast Bridge';
const CASTV2_PORT = 8009;
const WS_PORT = 8010;
const DIAL_PORT = 8008;

async function main(): Promise<void> {
  console.log(`[cast-bridge] starting as "${DEVICE_NAME}"...`);

  // 1. WebSocket server (TV display + custom senders connect here)
  const wsServer = startWsServer(WS_PORT);

  // 2. Media relay (bridges CastV2 media commands <-> WebSocket)
  const onMediaCommand = createMediaRelay({
    wsServer,
    onStatusForCast: (status) => {
      if (status.playerState && status.currentTime !== undefined) {
        console.log('[cast-bridge] TV status:', status.playerState, `${status.currentTime.toFixed(1)}s`);
      }
    },
  });

  // 3. WebRTC signaling relay (bridges screen mirroring SDP/ICE between senders and display)
  const signaling = createSignalingRelay({ wsServer });

  // Track per-session sendAnswer/sendCandidate callbacks from CastV2
  const castAnswerCallbacks = new Map<string, (sdp: string) => void>();
  const castCandidateCallbacks = new Map<string, (candidate: object) => void>();

  // When display sends an SDP answer, relay it back to the Cast sender
  signaling.onAnswerReady((sessionId, sdp) => {
    const sendAnswer = castAnswerCallbacks.get(sessionId);
    if (sendAnswer) {
      sendAnswer(sdp);
      castAnswerCallbacks.delete(sessionId);
    }
  });

  // When display sends an ICE candidate, relay it back to the Cast sender
  signaling.onDisplayCandidate((sessionId, candidate) => {
    const sendCandidate = castCandidateCallbacks.get(sessionId);
    if (sendCandidate) {
      sendCandidate(candidate);
    }
  });

  // Helper to clean up callback maps for a session
  function cleanupSession(sessionId: string): void {
    signaling.closeSession(sessionId);
    castAnswerCallbacks.delete(sessionId);
    castCandidateCallbacks.delete(sessionId);
  }

  // 4. CastV2 TLS server (Chrome and Cast senders connect here)
  const castv2 = await startCastV2Server({
    onMediaCommand,
    deviceName: DEVICE_NAME,
    onWebrtcOffer: (sessionId, sdp, sendAnswer, sendCandidate) => {
      // Store the CastV2 response callbacks for this session
      castAnswerCallbacks.set(sessionId, sendAnswer);
      castCandidateCallbacks.set(sessionId, sendCandidate);
      // Forward the offer to the display via signaling relay
      signaling.handleOffer(sessionId, sdp, 'cast');
    },
    onIceCandidate: (sessionId, candidate) => {
      signaling.handleSenderCandidate(sessionId, candidate as IceCandidateInit);
    },
    onMirroringStop: (sessionId) => {
      wsServer.sendCommand({ type: 'mirror-stop', sessionId });
      cleanupSession(sessionId);
    },
    onSenderDisconnect: (sessionId) => {
      cleanupSession(sessionId);
    },
  });
  console.log(`[cast-bridge] CastV2 server on port ${castv2.port}`);

  // 4b. Handle WebRTC signaling from custom WebSocket senders
  wsServer.onSenderMessage((msg) => {
    if (msg.type === 'webrtc-offer' && msg.sessionId && msg.sdp) {
      signaling.handleOffer(msg.sessionId, msg.sdp, 'custom');
    } else if (msg.type === 'ice-candidate' && msg.sessionId && msg.candidate) {
      signaling.handleSenderCandidate(msg.sessionId, msg.candidate);
    }
  });

  // 5. mDNS advertisement
  const stopMdns = startMdns(CASTV2_PORT, DEVICE_NAME);

  // 6. DIAL server
  const stopDial = startDial(DIAL_PORT, DEVICE_NAME);

  console.log('[cast-bridge] all services running');
  console.log(`  mDNS: advertising _googlecast._tcp on port ${CASTV2_PORT}`);
  console.log(`  DIAL: http://0.0.0.0:${DIAL_PORT}`);
  console.log(`  CastV2: tls://0.0.0.0:${castv2.port}`);
  console.log(`  WebSocket: ws://0.0.0.0:${WS_PORT}`);
  console.log(`  Mirroring: enabled (Chrome + custom sender)`);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[cast-bridge] shutting down...');
    stopMdns();
    stopDial();
    castv2.close();
    wsServer.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[cast-bridge] fatal error:', err);
  process.exit(1);
});
