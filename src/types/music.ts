export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl?: string; // local files have no artwork
  durationSec: number;
  bpm?: number;
  sourceUrl: string; // blob: object URL for playback
  /** Library curation flag for Shuffle Play — "must" is guaranteed inclusion (moved to the front), "do-not" is excluded. Never blocks a direct manual play; only affects automatic shuffle selection. */
  playPreference?: "must" | "do-not";
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
