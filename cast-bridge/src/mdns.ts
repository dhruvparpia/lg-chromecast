import { Bonjour } from 'bonjour-service';
import { randomBytes } from 'node:crypto';

const DEVICE_ID = randomBytes(16).toString('hex');
const FRIENDLY_NAME = 'LG CX55';
const MODEL_NAME = 'Chromecast Ultra';

export function startMdns(port: number): () => void {
  const bonjour = new Bonjour();

  const service = bonjour.publish({
    name: FRIENDLY_NAME,
    type: 'googlecast',
    protocol: 'tcp',
    port,
    txt: {
      id: DEVICE_ID,
      cd: DEVICE_ID.slice(0, 32),
      md: MODEL_NAME,
      fn: FRIENDLY_NAME,
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
    `[mdns] advertising _googlecast._tcp "${FRIENDLY_NAME}" on port ${port} (id=${DEVICE_ID.slice(0, 8)}...)`,
  );

  return () => {
    service.stop?.();
    bonjour.destroy();
    console.log('[mdns] stopped');
  };
}
