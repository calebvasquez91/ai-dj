/** Where a genre tag came from. `manual` is the user's (or the admin's) own edit and always wins. */
export type GenreTagSource = "file-tags" | "musicbrainz" | "lastfm" | "audio-classifier" | "llm" | "manual";

/** One genre a track has, on the fixed taxonomy (src/lib/genres.ts), with where it came from and how sure that source was. */
export interface GenreTag {
  /** A top-level genre label from the taxonomy, e.g. "Hip-Hop". */
  genre: string;
  /** A subgenre label of that genre, e.g. "Trap". */
  subgenre?: string;
  source: GenreTagSource;
  /** 0-1. */
  confidence: number;
  /** ms since epoch. */
  updatedAt: number;
}

/** `auto`: classified by the pipeline and trusted; `needs-review`: low confidence or sources disagree; `confirmed`: a person set it, and no re-run overwrites it. */
export type GenreStatus = "auto" | "needs-review" | "confirmed";

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
  /** Every genre the track has, by source (src/lib/genreTags.ts resolves them). Absent until classified. */
  genreTags?: GenreTag[];
  genreStatus?: GenreStatus;
  /** The resolved summary of genreTags, kept for display and filtering: the best genre, the subgenres on the taxonomy, and the moods the sources named. Derived, never edited directly. */
  genre?: string;
  subgenres?: string[];
  moods?: string[];
  /** The release year, when a source knew it (the file's tags, or MusicBrainz's first release date). */
  year?: number;
  /** Whether the track is marked explicit or clean (the file's advisory tag, or the person's own "explicit" / "clean" tag). Absent when unknown. */
  explicit?: "explicit" | "clean";
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
  /** The playlist's own picture (an address, or a data address in local development); a playlist without one shows its songs' covers. */
  imageUrl?: string;
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
