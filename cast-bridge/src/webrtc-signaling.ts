import type { WsServer } from './ws-server.js';
import type { IceCandidateInit } from './types.js';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const SESSION_TIMEOUT_MS = 60_000;

interface SdpInit {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface SignalingSession {
  sessionId: string;
  offer?: SdpInit;
  answer?: SdpInit;
  pendingSenderCandidates: IceCandidateInit[];
  source: 'cast' | 'custom';
  lastActivity: number;
}

interface SignalingOptions {
  wsServer: WsServer;
}

export interface SignalingRelay {
  handleOffer(sessionId: string, sdp: string, source: 'cast' | 'custom'): void;
  handleSenderCandidate(sessionId: string, candidate: IceCandidateInit): void;
  handleDisplayCandidate(sessionId: string, candidate: IceCandidateInit): void;
  onAnswerReady(callback: (sessionId: string, sdp: string) => void): void;
  onDisplayCandidate(callback: (sessionId: string, candidate: IceCandidateInit) => void): void;
  closeSession(sessionId: string): void;
}

export function createSignalingRelay(options: SignalingOptions): SignalingRelay {
  const { wsServer } = options;
  const sessions = new Map<string, SignalingSession>();
  const answerCallbacks: Array<(sessionId: string, sdp: string) => void> = [];
  const displayCandidateCallbacks: Array<(sessionId: string, candidate: IceCandidateInit) => void> = [];

  // Reap inactive sessions every 15s
  const reapInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        if (DEBUG) console.log(`[signaling] reaping inactive session ${id}`);
        sessions.delete(id);
      }
    }
  }, 15_000);
  reapInterval.unref();

  function touch(session: SignalingSession): void {
    session.lastActivity = Date.now();
  }

  function getOrCreateSession(sessionId: string, source: 'cast' | 'custom'): SignalingSession {
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        pendingSenderCandidates: [],
        source,
        lastActivity: Date.now(),
      };
      sessions.set(sessionId, session);
    }
    return session;
  }

  // Listen for webrtc-answer and ice-candidate messages from the TV display.
  // The wsServer status callback receives any JSON message from the TV,
  // so we inspect the `type` field to intercept signaling messages.
  wsServer.onStatusUpdate((msg: any) => {
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    if (msg.type === 'webrtc-answer' && msg.sessionId && msg.sdp) {
      const sessionId: string = msg.sessionId;
      const sdp: string = msg.sdp;
      const session = sessions.get(sessionId);

      if (DEBUG) console.log(`[signaling] received answer for session ${sessionId}`);

      if (session) {
        session.answer = { type: 'answer', sdp };
        touch(session);

        // Flush any buffered sender ICE candidates now that display is connected
        if (session.pendingSenderCandidates.length > 0) {
          if (DEBUG) console.log(`[signaling] flushing ${session.pendingSenderCandidates.length} buffered ICE candidates for ${sessionId}`);
          for (const candidate of session.pendingSenderCandidates) {
            wsServer.sendCommand({ type: 'ice-candidate', sessionId, candidate });
          }
          session.pendingSenderCandidates = [];
        }
      }

      for (const cb of answerCallbacks) {
        cb(sessionId, sdp);
      }
    }

    if (msg.type === 'ice-candidate' && msg.sessionId && msg.candidate) {
      const sessionId: string = msg.sessionId;
      const candidate: IceCandidateInit = msg.candidate;
      const session = sessions.get(sessionId);

      if (DEBUG) console.log(`[signaling] received display ICE candidate for session ${sessionId}`);

      if (session) {
        touch(session);
      }

      for (const cb of displayCandidateCallbacks) {
        cb(sessionId, candidate);
      }
    }
  });

  return {
    handleOffer(sessionId: string, sdp: string, source: 'cast' | 'custom'): void {
      const session = getOrCreateSession(sessionId, source);
      session.offer = { type: 'offer', sdp };
      touch(session);

      if (DEBUG) console.log(`[signaling] forwarding offer for session ${sessionId} (source: ${source})`);

      wsServer.sendCommand({ type: 'webrtc-offer', sessionId, sdp });
    },

    handleSenderCandidate(sessionId: string, candidate: IceCandidateInit): void {
      const session = sessions.get(sessionId);
      if (!session) {
        if (DEBUG) console.log(`[signaling] handleSenderCandidate: no session ${sessionId}`);
        return;
      }

      touch(session);

      // If the display has already answered, forward immediately
      if (session.answer) {
        if (DEBUG) console.log(`[signaling] forwarding sender ICE candidate for ${sessionId}`);
        wsServer.sendCommand({ type: 'ice-candidate', sessionId, candidate });
      } else {
        // Buffer until display connects
        if (DEBUG) console.log(`[signaling] buffering sender ICE candidate for ${sessionId}`);
        session.pendingSenderCandidates.push(candidate);
      }
    },

    handleDisplayCandidate(sessionId: string, candidate: IceCandidateInit): void {
      const session = sessions.get(sessionId);
      if (session) {
        touch(session);
      }

      if (DEBUG) console.log(`[signaling] relaying display ICE candidate for ${sessionId}`);

      for (const cb of displayCandidateCallbacks) {
        cb(sessionId, candidate);
      }
    },

    onAnswerReady(callback: (sessionId: string, sdp: string) => void): void {
      answerCallbacks.push(callback);
    },

    onDisplayCandidate(callback: (sessionId: string, candidate: IceCandidateInit) => void): void {
      displayCandidateCallbacks.push(callback);
    },

    closeSession(sessionId: string): void {
      if (DEBUG) console.log(`[signaling] closing session ${sessionId}`);
      sessions.delete(sessionId);
    },
  };
}
