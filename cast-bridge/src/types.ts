export interface PlayerStatus {
  playerState: 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING';
  currentTime: number;
  duration: number;
  volume: number;
}

export type DisplayCommand =
  | { type: 'load'; url: string; contentType: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; currentTime: number }
  | { type: 'stop' }
  | { type: 'volume'; level: number };

export interface MediaCommand {
  type: 'load' | 'play' | 'pause' | 'seek' | 'stop' | 'volume';
  url?: string;
  contentType?: string;
  currentTime?: number;
  volume?: number;
  requestId?: number;
}
