interface TrackBase {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl?: string; // local files have no artwork; YouTube tracks get the video's own thumbnail
  durationSec: number;
  /** When this track was added to the library, ms since epoch — the server's Track.createdAt. */
  addedAt: number;
  /** Library curation flag for Shuffle Play and Drop the Needle — "must" is guaranteed inclusion (moved to the front), "do-not" is excluded. Never blocks a direct manual play; only affects automatic shuffle selection. */
  playPreference?: "must" | "do-not";
}

/** A locally-uploaded file, played through the full Web Audio engine (real BPM/key/energy analysis, EQ, mashups, tempo ramps). */
export interface LocalTrack extends TrackBase {
  source: "local";
  sourceUrl: string; // stable server URL for playback — local backend's Range route, or a public Blob URL
  bpm?: number;
}

/**
 * A track imported from a YouTube playlist, played through the official
 * IFrame Player API. There's no raw audio buffer access, so it never gets
 * real BPM/key/energy analysis and is limited to transport control + a
 * basic volume crossfade — see YouTubeDeckStage.tsx.
 */
export interface YouTubeTrack extends TrackBase {
  source: "youtube";
  youtubeVideoId: string;
}

export type Track = LocalTrack | YouTubeTrack;

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
