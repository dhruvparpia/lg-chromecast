import { Bonjour } from 'bonjour-service';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

// Deterministic device ID derived from hostname so Cast clients reconnect across restarts
const DEVICE_ID = createHash('sha256').update(`cast-bridge:${hostname()}`).digest('hex').slice(0, 32);

export function startMdns(port: number, friendlyName = 'Cast Bridge'): () => void {
  const bonjour = new Bonjour();

  const service = bonjour.publish({
    name: friendlyName,
    type: 'googlecast',
    protocol: 'tcp',
    port,
    txt: {
      id: DEVICE_ID,
      cd: DEVICE_ID.slice(0, 32),
      md: 'Chromecast Ultra',
      fn: friendlyName,
      rs: '',
      ca: '201221',
      st: '0',
      ve: '05',
      ic: '/setup/icon.png',
      nf: '1',
      bs: 'FA8FCA771D51',
      rm: '',
    },
  });

  console.log(
    `[mdns] advertising _googlecast._tcp "${friendlyName}" on port ${port} (id=${DEVICE_ID.slice(0, 8)}...)`,
  );

  return () => {
    service.stop?.();
    bonjour.destroy();
    console.log('[mdns] stopped');
  };
}
