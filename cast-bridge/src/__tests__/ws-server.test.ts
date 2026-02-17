import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startWsServer, type WsServer } from '../ws-server.js';

const TEST_PORT = 19010;

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(String(data)));
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
  });
}

describe('WebSocket server', () => {
  let server: WsServer | null = null;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN || c.readyState === WebSocket.CONNECTING) {
        c.close();
      }
    }
    clients.length = 0;
    if (server) {
      server.cleanup();
      server = null;
    }
    // small delay so the port is freed
    await new Promise((r) => setTimeout(r, 50));
  });

  it('startWsServer returns a WsServer interface', { timeout: 5000 }, () => {
    server = startWsServer(TEST_PORT);
    expect(server).toBeDefined();
    expect(typeof server.sendCommand).toBe('function');
    expect(typeof server.onStatusUpdate).toBe('function');
    expect(typeof server.cleanup).toBe('function');
  });

  it('accepts WebSocket client connections', { timeout: 5000 }, async () => {
    server = startWsServer(TEST_PORT);
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('sendCommand delivers JSON to connected client', { timeout: 5000 }, async () => {
    server = startWsServer(TEST_PORT);
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);

    const msgPromise = waitForMessage(ws);
    server.sendCommand({ type: 'play' });
    const raw = await msgPromise;
    expect(JSON.parse(raw)).toEqual({ type: 'play' });
  });

  it('onStatusUpdate fires callback when client sends PlayerStatus JSON', { timeout: 5000 }, async () => {
    server = startWsServer(TEST_PORT);
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);

    const status = { playerState: 'PLAYING', currentTime: 10, duration: 100, volume: 0.8 };
    const received = new Promise<object>((resolve) => {
      server!.onStatusUpdate((s) => resolve(s));
    });

    ws.send(JSON.stringify(status));
    expect(await received).toEqual(status);
  });

  it('last-connection-wins: second client replaces first', { timeout: 5000 }, async () => {
    server = startWsServer(TEST_PORT);

    const ws1 = await connectClient(TEST_PORT);
    clients.push(ws1);
    const ws1Closed = waitForClose(ws1);

    const ws2 = await connectClient(TEST_PORT);
    clients.push(ws2);

    // first client should be closed by server
    await ws1Closed;
    expect(ws1.readyState).toBe(WebSocket.CLOSED);

    // commands go to ws2
    const msgPromise = waitForMessage(ws2);
    server.sendCommand({ type: 'pause' });
    const raw = await msgPromise;
    expect(JSON.parse(raw)).toEqual({ type: 'pause' });
  });

  it('sendCommand with no client connected does not throw', { timeout: 5000 }, () => {
    server = startWsServer(TEST_PORT);
    expect(() => server!.sendCommand({ type: 'stop' })).not.toThrow();
  });

  it('cleanup closes the server', { timeout: 5000 }, async () => {
    server = startWsServer(TEST_PORT);
    server.cleanup();
    server = null;

    // connecting should fail after cleanup
    await expect(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', reject);
      }),
    ).rejects.toThrow();
  });
});
