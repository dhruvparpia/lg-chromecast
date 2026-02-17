import { startMdns } from './mdns.js';
import { startDial } from './dial.js';
import { startCastV2Server } from './castv2-server.js';
import { startWsServer } from './ws-server.js';
import { createMediaRelay } from './media-relay.js';

const DEVICE_NAME = process.env.DEVICE_NAME ?? 'Cast Bridge';
const CASTV2_PORT = 8009;
const WS_PORT = 8010;
const DIAL_PORT = 8008;

async function main(): Promise<void> {
  console.log(`[cast-bridge] starting as "${DEVICE_NAME}"...`);

  // 1. WebSocket server (TV display connects here)
  const wsServer = startWsServer(WS_PORT);

  // 2. Media relay (bridges CastV2 commands <-> WebSocket)
  const onMediaCommand = createMediaRelay({
    wsServer,
    onStatusForCast: (status) => {
      console.log('[cast-bridge] TV status:', status.playerState, `${status.currentTime.toFixed(1)}s`);
    },
  });

  // 3. CastV2 TLS server (senders connect here)
  const castv2 = await startCastV2Server({ onMediaCommand });
  console.log(`[cast-bridge] CastV2 server on port ${castv2.port}`);

  // 4. mDNS advertisement
  const stopMdns = startMdns(CASTV2_PORT, DEVICE_NAME);

  // 5. DIAL server
  const stopDial = startDial(DIAL_PORT, DEVICE_NAME);

  console.log('[cast-bridge] all services running');
  console.log(`  mDNS: advertising _googlecast._tcp on port ${CASTV2_PORT}`);
  console.log(`  DIAL: http://0.0.0.0:${DIAL_PORT}`);
  console.log(`  CastV2: tls://0.0.0.0:${castv2.port}`);
  console.log(`  WebSocket: ws://0.0.0.0:${WS_PORT}`);

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
