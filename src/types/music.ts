export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl?: string; // local files have no artwork
  durationSec: number;
  bpm?: number;
  sourceUrl: string; // blob: object URL for playback
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
}

export type DeckId = "A" | "B";

export interface DeckState {
  deckId: DeckId;
  track: Track | null;
  isActive: boolean;
  isPlaying: boolean;
  currentTimeSec: number;
  volume: number; // 0-1
}
