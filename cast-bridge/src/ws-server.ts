import { WebSocketServer, WebSocket } from 'ws';
import type { PlayerStatus } from './types.js';

export interface WsServer {
  sendCommand(cmd: object): void;
  onStatusUpdate(callback: (status: PlayerStatus) => void): void;
  cleanup(): void;
}

export function startWsServer(port = 8010): WsServer {
  const wss = new WebSocketServer({ port });
  let tvClient: WebSocket | null = null;
  const statusCallbacks: Array<(status: PlayerStatus) => void> = [];

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress ?? 'unknown';
    console.log(`[ws] TV client connected from ${addr}`);

    if (tvClient && tvClient.readyState === WebSocket.OPEN) {
      console.log('[ws] replacing previous TV client');
      tvClient.close();
    }
    tvClient = ws;

    ws.on('message', (data) => {
      try {
        const status: PlayerStatus = JSON.parse(String(data));
        for (const cb of statusCallbacks) {
          cb(status);
        }
      } catch (err) {
        console.error('[ws] failed to parse TV message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[ws] TV client disconnected (${addr})`);
      if (tvClient === ws) {
        tvClient = null;
      }
    });

    ws.on('error', (err) => {
      console.error('[ws] client error:', err.message);
    });
  });

  console.log(`[ws] server listening on port ${port}`);

  return {
    sendCommand(cmd: object) {
      if (!tvClient || tvClient.readyState !== WebSocket.OPEN) {
        console.warn('[ws] no TV client connected, dropping command');
        return;
      }
      tvClient.send(JSON.stringify(cmd));
    },

    onStatusUpdate(callback: (status: PlayerStatus) => void) {
      statusCallbacks.push(callback);
    },

    cleanup() {
      wss.close();
      console.log('[ws] server closed');
    },
  };
}
