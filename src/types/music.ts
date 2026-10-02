interface TrackBase {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl?: string; // local files have no artwork; YouTube tracks get the video's own thumbnail
  durationSec: number;
  /** When this track was added to the library, ms since epoch — the server's Track.createdAt. */
  addedAt: number;
  /** Library curation flag for Shuffle Play — "must" is guaranteed inclusion (moved to the front), "do-not" is excluded. Never blocks a direct manual play; only affects automatic shuffle selection. */
  playPreference?: "must" | "do-not";
  /** Manually-set Hot Cue positions, keyed 1-8 (src/lib/hot-cues.ts) — sparse; a cue not present here falls back to the best-effort auto placement (or stays unset). The only source of hot cues for a YouTube track. */
  hotCueOverrides?: Record<number, number>;
  /** User-set free-text tags, e.g. ["halloween","spooky"] — drives the Spooky Music system playlist's auto-membership. Empty/absent means untagged. */
  tags?: string[];
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
  /** How its bpm (surfaced through the trackAnalysis map, not stored here) was determined — undefined until a metadata lookup or a manual tap resolves one. */
  bpmSource?: "metadata" | "tap";
}

export type Track = LocalTrack | YouTubeTrack;

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  /** Marks a system-curated playlist, e.g. "spooky" for the built-in Spooky Music playlist — undefined for a normal user-made playlist. */
  theme?: string;
  /** ids (a subset of `tracks`) present only because they matched a tag-based auto-membership rule (e.g. the Spooky Music playlist's halloween/spooky tag union) — they have no backing PlaylistTrack row, so "remove from playlist" can't actually remove them; the track's own tags would need to change instead. Undefined for a playlist with no such rule. */
  autoIncludedTrackIds?: string[];
}

export type FxCategory = "transition" | "loop" | "effect" | "background" | "vocal";

/** An uploaded FX/stinger sound — see prisma/schema.prisma's FxSound model for the storage-side shape this mirrors. */
export interface FxSound {
  id: string;
  name: string;
  fileName: string;
  sourceUrl: string;
  mimeType: string;
  category: FxCategory;
  durationSec: number;
  bpm?: number;
  key?: string;
  tags: string[];
  /** Themed playlists/modes this FX is eligible for, e.g. ["spooky","halloween"]. */
  playlistAffinity: string[];
  addedAt: number;
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
