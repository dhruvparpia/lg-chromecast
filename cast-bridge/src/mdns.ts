import { Bonjour } from 'bonjour-service';
import { randomBytes } from 'node:crypto';

const DEVICE_ID = randomBytes(16).toString('hex');

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
