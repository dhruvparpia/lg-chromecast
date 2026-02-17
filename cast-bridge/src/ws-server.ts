import { WebSocketServer, WebSocket } from 'ws';
import type { PlayerStatus, DisplayCommand, SenderMessage } from './types.js';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const MAX_PAYLOAD = 64 * 1024; // 64 KB
const PING_INTERVAL_MS = 30_000;

export interface WsServer {
  sendCommand(cmd: DisplayCommand): void;
  onStatusUpdate(callback: (status: PlayerStatus) => void): void;
  onSenderMessage(callback: (msg: SenderMessage) => void): void;
  cleanup(): void;
}

export function startWsServer(port = 8010): WsServer {
  const wss = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD });
  let tvClient: WebSocket | null = null;
  const senderClients = new Map<string, WebSocket>();
  const statusCallbacks: Array<(status: PlayerStatus) => void> = [];
  const senderMessageCallbacks: Array<(msg: SenderMessage) => void> = [];

  // Ping/pong heartbeat to detect zombie connections
  const aliveSet = new WeakSet<WebSocket>();

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!aliveSet.has(ws)) {
        if (DEBUG) console.log('[ws] terminating unresponsive client');
        ws.terminate();
        return;
      }
      aliveSet.delete(ws);
      ws.ping();
    });
  }, PING_INTERVAL_MS);
  pingInterval.unref();

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress ?? 'unknown';
    if (DEBUG) console.log(`[ws] client connected from ${addr}`);

    aliveSet.add(ws);
    ws.on('pong', () => {
      aliveSet.add(ws);
    });

    // Initially treat as TV client; sender-hello will re-classify
    let role: 'tv' | 'sender' = 'tv';
    let senderId: string | null = null;

    if (tvClient && tvClient.readyState === WebSocket.OPEN) {
      if (DEBUG) console.log('[ws] replacing previous TV client');
      tvClient.close();
    }
    tvClient = ws;

    ws.on('message', (data) => {
      try {
        const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        const msg = JSON.parse(str);

        // If this client sends sender-hello, reclassify it as a sender
        if (msg.type === 'sender-hello' && msg.sessionId) {
          role = 'sender';
          senderId = msg.sessionId as string;
          // Remove from TV slot if it was assigned there
          if (tvClient === ws) {
            tvClient = null;
          }
          senderClients.set(senderId, ws);
          if (DEBUG) console.log(`[ws] client ${addr} identified as sender (session: ${senderId})`);
          return;
        }

        if (role === 'sender') {
          for (const cb of senderMessageCallbacks) {
            cb(msg);
          }
        } else {
          const status: PlayerStatus = msg;
          for (const cb of statusCallbacks) {
            cb(status);
          }
        }
      } catch (err) {
        if (DEBUG) console.error('[ws] failed to parse message:', err);
      }
    });

    ws.on('close', () => {
      if (DEBUG) console.log(`[ws] client disconnected (${addr}, role: ${role})`);
      if (role === 'sender' && senderId) {
        senderClients.delete(senderId);
      } else if (tvClient === ws) {
        tvClient = null;
      }
    });

    ws.on('error', (err) => {
      if (DEBUG) console.error('[ws] client error:', err.message);
    });
  });

  console.log(`[ws] server listening on port ${port}`);

  return {
    sendCommand(cmd: DisplayCommand) {
      if (!tvClient || tvClient.readyState !== WebSocket.OPEN) {
        if (DEBUG) console.warn('[ws] no TV client connected, dropping command');
        return;
      }
      tvClient.send(JSON.stringify(cmd));
    },

    onStatusUpdate(callback: (status: PlayerStatus) => void) {
      statusCallbacks.push(callback);
    },

    onSenderMessage(callback: (msg: SenderMessage) => void) {
      senderMessageCallbacks.push(callback);
    },

    cleanup() {
      clearInterval(pingInterval);
      wss.close();
      if (DEBUG) console.log('[ws] server closed');
    },
  };
}
