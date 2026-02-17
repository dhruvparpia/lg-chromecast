import { describe, it, expect, vi } from 'vitest';
import { createMediaRelay } from '../media-relay.js';
import type { WsServer } from '../ws-server.js';
import type { PlayerStatus } from '../types.js';

function mockWsServer() {
  const statusCallbacks: Array<(status: PlayerStatus) => void> = [];
  const server: WsServer = {
    sendCommand: vi.fn(),
    onStatusUpdate(cb) {
      statusCallbacks.push(cb);
    },
    cleanup: vi.fn(),
  };
  return { server, statusCallbacks };
}

describe('media relay', { timeout: 5000 }, () => {
  it('createMediaRelay returns an onMediaCommand handler function', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });
    expect(typeof handler).toBe('function');
  });

  it('translates load command', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'load', url: 'http://x.mp4', contentType: 'video/mp4' });

    expect(server.sendCommand).toHaveBeenCalledWith({
      type: 'load',
      url: 'http://x.mp4',
      contentType: 'video/mp4',
    });
  });

  it('translates play command', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'play' });

    expect(server.sendCommand).toHaveBeenCalledWith({ type: 'play' });
  });

  it('translates pause command', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'pause' });

    expect(server.sendCommand).toHaveBeenCalledWith({ type: 'pause' });
  });

  it('translates seek command', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'seek', currentTime: 30 });

    expect(server.sendCommand).toHaveBeenCalledWith({ type: 'seek', currentTime: 30 });
  });

  it('translates stop command', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'stop' });

    expect(server.sendCommand).toHaveBeenCalledWith({ type: 'stop' });
  });

  it('translates volume command (volume -> level)', () => {
    const { server } = mockWsServer();
    const handler = createMediaRelay({ wsServer: server, onStatusForCast: () => {} });

    handler({ type: 'volume', volume: 0.5 });

    expect(server.sendCommand).toHaveBeenCalledWith({ type: 'volume', level: 0.5 });
  });

  it('forwards PlayerStatus from WS to onStatusForCast callback', () => {
    const { server, statusCallbacks } = mockWsServer();
    const onStatus = vi.fn();
    createMediaRelay({ wsServer: server, onStatusForCast: onStatus });

    const status: PlayerStatus = {
      playerState: 'PLAYING',
      currentTime: 42,
      duration: 200,
      volume: 0.7,
    };

    // simulate WS sending a status update
    for (const cb of statusCallbacks) {
      cb(status);
    }

    expect(onStatus).toHaveBeenCalledWith(status);
  });
});
