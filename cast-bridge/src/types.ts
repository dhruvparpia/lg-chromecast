export interface PlayerStatus {
  playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
  currentTime: number;
  duration: number;
  volume: number;
}

export interface IceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type DisplayCommand =
  | { type: 'load'; url: string; contentType: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; currentTime: number }
  | { type: 'stop' }
  | { type: 'volume'; level: number }
  | { type: 'webrtc-offer'; sessionId: string; sdp: string }
  | { type: 'ice-candidate'; sessionId: string; candidate: IceCandidateInit }
  | { type: 'mirror-stop'; sessionId: string };

export type SenderMessage =
  | { type: 'webrtc-offer'; sessionId: string; sdp: string }
  | { type: 'ice-candidate'; sessionId: string; candidate: IceCandidateInit };

export interface MediaCommand {
  type: 'load' | 'play' | 'pause' | 'seek' | 'stop' | 'volume';
  url?: string;
  contentType?: string;
  currentTime?: number;
  volume?: number;
  requestId?: number;
}
