import type { WsServer } from './ws-server.js';
import type { MediaCommand, DisplayCommand, PlayerStatus } from './types.js';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

export interface MediaRelayOptions {
  wsServer: WsServer;
  onStatusForCast: (status: PlayerStatus) => void;
}

export function createMediaRelay(options: MediaRelayOptions): (cmd: MediaCommand) => void {
  const { wsServer, onStatusForCast } = options;

  wsServer.onStatusUpdate(onStatusForCast);

  return (cmd: MediaCommand) => {
    const displayCmd = toDisplayCommand(cmd);
    if (displayCmd) {
      wsServer.sendCommand(displayCmd);
    }
  };
}

function toDisplayCommand(cmd: MediaCommand): DisplayCommand | null {
  switch (cmd.type) {
    case 'load':
      return { type: 'load', url: cmd.url ?? '', contentType: cmd.contentType ?? 'video/mp4' };
    case 'play':
      return { type: 'play' };
    case 'pause':
      return { type: 'pause' };
    case 'seek':
      return { type: 'seek', currentTime: cmd.currentTime ?? 0 };
    case 'stop':
      return { type: 'stop' };
    case 'volume':
      return { type: 'volume', level: cmd.volume ?? 1 };
    default:
      if (DEBUG) console.warn('[relay] unknown command type:', (cmd as MediaCommand).type);
      return null;
  }
}
