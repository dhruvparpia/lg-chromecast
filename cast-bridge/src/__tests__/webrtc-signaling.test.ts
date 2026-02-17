import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSignalingRelay, type SignalingRelay } from '../webrtc-signaling.js';
import type { WsServer } from '../ws-server.js';

function createMockWsServer() {
  const statusCallbacks: Array<(msg: any) => void> = [];
  const sentCommands: object[] = [];

  const ws: WsServer = {
    sendCommand(cmd: object) {
      sentCommands.push(cmd);
    },
    onStatusUpdate(cb: (msg: any) => void) {
      statusCallbacks.push(cb);
    },
    onSenderMessage() {},
    cleanup() {},
  };

  return {
    ws,
    sentCommands,
    simulateDisplayMessage(msg: any) {
      for (const cb of statusCallbacks) cb(msg);
    },
  };
}

describe('WebRTC signaling relay', () => {
  let mock: ReturnType<typeof createMockWsServer>;
  let relay: SignalingRelay;

  beforeEach(() => {
    mock = createMockWsServer();
    relay = createSignalingRelay({ wsServer: mock.ws });
  });

  it('handleOffer forwards offer to display via sendCommand', () => {
    relay.handleOffer('sess-1', 'v=0\r\noffer-sdp', 'cast');

    expect(mock.sentCommands).toEqual([
      { type: 'webrtc-offer', sessionId: 'sess-1', sdp: 'v=0\r\noffer-sdp' },
    ]);
  });

  it('handleOffer works for custom source', () => {
    relay.handleOffer('sess-2', 'offer-sdp', 'custom');

    expect(mock.sentCommands[0]).toEqual(
      expect.objectContaining({ type: 'webrtc-offer', sessionId: 'sess-2' }),
    );
  });

  it('onAnswerReady fires when display sends webrtc-answer', () => {
    const cb = vi.fn();
    relay.onAnswerReady(cb);

    relay.handleOffer('sess-1', 'offer', 'cast');
    mock.simulateDisplayMessage({ type: 'webrtc-answer', sessionId: 'sess-1', sdp: 'answer-sdp' });

    expect(cb).toHaveBeenCalledWith('sess-1', 'answer-sdp');
  });

  it('onDisplayCandidate fires when display sends ice-candidate', () => {
    const cb = vi.fn();
    relay.onDisplayCandidate(cb);

    relay.handleOffer('sess-1', 'offer', 'cast');
    mock.simulateDisplayMessage({
      type: 'ice-candidate',
      sessionId: 'sess-1',
      candidate: { candidate: 'a=candidate:1', sdpMid: '0' },
    });

    expect(cb).toHaveBeenCalledWith('sess-1', { candidate: 'a=candidate:1', sdpMid: '0' });
  });

  it('buffers sender ICE candidates until display answers', () => {
    relay.handleOffer('sess-1', 'offer', 'cast');

    const candidate = { candidate: 'a=candidate:1', sdpMid: '0' };
    relay.handleSenderCandidate('sess-1', candidate);

    // Should not have forwarded yet (no answer)
    const iceCommands = mock.sentCommands.filter((c: any) => c.type === 'ice-candidate');
    expect(iceCommands).toHaveLength(0);

    // Now simulate answer -- should flush buffered candidates
    mock.simulateDisplayMessage({ type: 'webrtc-answer', sessionId: 'sess-1', sdp: 'answer' });

    const flushed = mock.sentCommands.filter((c: any) => c.type === 'ice-candidate');
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ type: 'ice-candidate', sessionId: 'sess-1', candidate });
  });

  it('forwards sender ICE candidates immediately after answer exists', () => {
    relay.handleOffer('sess-1', 'offer', 'cast');
    mock.simulateDisplayMessage({ type: 'webrtc-answer', sessionId: 'sess-1', sdp: 'answer' });

    mock.sentCommands.length = 0; // clear

    const candidate = { candidate: 'a=candidate:2', sdpMid: '0' };
    relay.handleSenderCandidate('sess-1', candidate);

    expect(mock.sentCommands).toEqual([
      { type: 'ice-candidate', sessionId: 'sess-1', candidate },
    ]);
  });

  it('handleSenderCandidate ignores unknown sessions', () => {
    relay.handleSenderCandidate('unknown', { candidate: 'x', sdpMid: '0' });
    const iceCommands = mock.sentCommands.filter((c: any) => c.type === 'ice-candidate');
    expect(iceCommands).toHaveLength(0);
  });

  it('closeSession removes the session', () => {
    relay.handleOffer('sess-1', 'offer', 'cast');
    relay.closeSession('sess-1');

    // After close, sender candidates should be ignored
    relay.handleSenderCandidate('sess-1', { candidate: 'x', sdpMid: '0' });
    const iceCommands = mock.sentCommands.filter((c: any) => c.type === 'ice-candidate');
    expect(iceCommands).toHaveLength(0);
  });

  it('ignores malformed display messages', () => {
    const cb = vi.fn();
    relay.onAnswerReady(cb);

    mock.simulateDisplayMessage(null);
    mock.simulateDisplayMessage(undefined);
    mock.simulateDisplayMessage('not an object');
    mock.simulateDisplayMessage({ noType: true });
    mock.simulateDisplayMessage({ type: 'webrtc-answer' }); // missing sessionId/sdp

    expect(cb).not.toHaveBeenCalled();
  });

  it('handleDisplayCandidate relays to registered callbacks', () => {
    const cb = vi.fn();
    relay.onDisplayCandidate(cb);

    const candidate = { candidate: 'a=candidate:3', sdpMid: '1' };
    relay.handleDisplayCandidate('sess-1', candidate);

    expect(cb).toHaveBeenCalledWith('sess-1', candidate);
  });

  it('multiple answer callbacks all fire', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    relay.onAnswerReady(cb1);
    relay.onAnswerReady(cb2);

    relay.handleOffer('sess-1', 'offer', 'cast');
    mock.simulateDisplayMessage({ type: 'webrtc-answer', sessionId: 'sess-1', sdp: 'answer' });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
