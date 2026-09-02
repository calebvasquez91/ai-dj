import { create } from "zustand";
import type { Playlist, Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { DjSetMode } from "@/lib/mix-engine";
import type { AmbienceFrequency } from "@/lib/ambience";
import {
  deserializeFingerprint,
  serializeFingerprint,
  type LyricalFingerprint,
  type SerializedLyricalFingerprint,
} from "@/lib/lyrics";

const MAX_HISTORY = 50;

interface PlayerState {
  queue: Track[];
  history: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number; // 0-1
  autoDjEnabled: boolean;
  currentTimeSec: number;
  seekRequest: number | null;
  crossfadeOverrideSec: number | null;
  mixNowRequestId: number;
  isTransitioning: boolean;
  sidebarOpen: boolean;
  queuePanelOpen: boolean;
  deckViewOpen: boolean;
  /** Full-screen now-playing view, expanded from the compact PlayerBar footer. */
  nowPlayingExpanded: boolean;
  trackAnalysis: Record<string, TrackAnalysis>;
  /** Cached lyrical/thematic fingerprint per track id — present (even if empty) once looked up, absent if never attempted. Never the lyrics text itself, see lib/lyrics.ts. */
  trackLyricalFingerprints: Record<string, LyricalFingerprint>;
  analyzingTrackIds: Set<string>;
  styleGenreHint: string | null;
  djMode: DjSetMode;
  /** Manually pinned transition id for the upcoming mix — cleared automatically once that mix starts. */
  forcedTransitionId: string | null;
  /** transitionIds the user has "rerolled" away from for the upcoming mix — cleared automatically once that mix starts. */
  rerolledTransitionIds: string[];
  djVarietyBias: boolean;
  /** Rationale text for the mix currently in progress, captured at the moment it started — so the DJ Decks panel keeps showing what's actually playing out instead of a live recompute that goes stale the instant a one-shot override clears. */
  activeTransitionRationale: string | null;
  /** Occasional mid-track FX (filter/riser builds, echo throws on breakdowns) — separate from transition FX, which always fire regardless of this setting. */
  ambienceEnabled: boolean;
  ambienceFrequency: AmbienceFrequency;
  /** Opportunistic tempo/key-matched dual-track mashup moments — a distinct, rarer "special moment" from ambience FX. */
  mashupEnabled: boolean;

  playlists: Playlist[];
  playlistsLoaded: boolean;
  localLibrary: Track[];
  libraryLoaded: boolean;

  /** In-memory only (never persisted) — see lib/googleAuth.ts. Cleared on reload; the user reconnects via "Connect YouTube". */
  youtubeAccessToken: string | null;
  youtubeTokenExpiresAt: number | null;
  setYoutubeToken: (token: string | null, expiresAt: number | null) => void;

  /** In-memory only — see lib/spotifyAuth.ts, which separately persists just the refresh token (not this access token) to localStorage so reconnecting doesn't require the full OAuth redirect every session. */
  spotifyAccessToken: string | null;
  spotifyTokenExpiresAt: number | null;
  setSpotifyToken: (token: string | null, expiresAt: number | null) => void;

  setQueue: (tracks: Track[]) => void;
  enqueue: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
  playTrackList: (tracks: Track[], startIndex: number) => void;
  togglePlay: () => void;
  setVolume: (volume: number) => void;
  setAutoDj: (enabled: boolean) => void;
  setCurrentTime: (seconds: number) => void;
  requestSeek: (seconds: number) => void;
  clearSeekRequest: () => void;
  next: () => void;
  previous: () => void;
  setCrossfadeOverride: (seconds: number | null) => void;
  requestMixNow: () => void;
  setIsTransitioning: (isTransitioning: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleQueuePanel: () => void;
  toggleDeckView: () => void;
  setNowPlayingExpanded: (expanded: boolean) => void;
  loadLibrary: () => Promise<void>;
  addLocalTracks: (tracks: Track[]) => void;
  removeLocalTrack: (trackId: string) => Promise<void>;
  setTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => void;
  setLyricalFingerprint: (trackId: string, fingerprint: LyricalFingerprint) => void;
  startAnalyzing: (trackId: string) => void;
  stopAnalyzing: (trackId: string) => void;
  setStyleGenreHint: (genreId: string | null) => void;
  setDjMode: (mode: DjSetMode) => void;
  setForcedTransitionId: (id: string | null) => void;
  addRerolledTransitionId: (id: string) => void;
  clearRerolledTransitionIds: () => void;
  setDjVarietyBias: (enabled: boolean) => void;
  setActiveTransitionRationale: (rationale: string | null) => void;
  setAmbienceEnabled: (enabled: boolean) => void;
  setAmbienceFrequency: (frequency: AmbienceFrequency) => void;
  setMashupEnabled: (enabled: boolean) => void;
  setTrackPlayPreference: (trackId: string, preference: Track["playPreference"]) => void;

  loadPlaylists: () => Promise<void>;
  createPlaylist: () => Promise<string>;
  renamePlaylist: (playlistId: string, name: string) => void;
  persistPlaylistName: (playlistId: string) => void;
  removePlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  moveTrackInPlaylist: (
    playlistId: string,
    index: number,
    direction: "up" | "down"
  ) => void;
}

export const useStore = create<PlayerState>()(
  (set, get) => ({
      queue: [],
      history: [],
      currentTrack: null,
      isPlaying: false,
      volume: 1,
      autoDjEnabled: true,
      currentTimeSec: 0,
      seekRequest: null,
      crossfadeOverrideSec: null,
      mixNowRequestId: 0,
      isTransitioning: false,
      sidebarOpen: false,
      queuePanelOpen: false,
      deckViewOpen: false,
      nowPlayingExpanded: false,
      trackAnalysis: {},
      trackLyricalFingerprints: {},
      analyzingTrackIds: new Set<string>(),
      styleGenreHint: null,
      djMode: "auto",
      forcedTransitionId: null,
      rerolledTransitionIds: [],
      djVarietyBias: false,
      activeTransitionRationale: null,
      ambienceEnabled: true,
      ambienceFrequency: "occasional",
      mashupEnabled: true,

      playlists: [],
      playlistsLoaded: false,
      localLibrary: [],
      libraryLoaded: false,

      youtubeAccessToken: null,
      youtubeTokenExpiresAt: null,
      setYoutubeToken: (token, expiresAt) => set({ youtubeAccessToken: token, youtubeTokenExpiresAt: expiresAt }),

      spotifyAccessToken: null,
      spotifyTokenExpiresAt: null,
      setSpotifyToken: (token, expiresAt) => set({ spotifyAccessToken: token, spotifyTokenExpiresAt: expiresAt }),

      setQueue: (tracks) => set({ queue: tracks }),
      enqueue: (track) => set((s) => ({ queue: [...s.queue, track] })),
      removeFromQueue: (trackId) =>
        set((s) => ({ queue: s.queue.filter((t) => t.id !== trackId) })),

      playTrackList: (tracks, startIndex) => {
        const { currentTrack, history } = get();
        const nextHistory = currentTrack
          ? [...history, currentTrack].slice(-MAX_HISTORY)
          : history;
        set({
          currentTrack: tracks[startIndex] ?? null,
          queue: tracks.slice(startIndex + 1),
          history: nextHistory,
          isPlaying: true,
          currentTimeSec: 0,
        });
      },

      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
      setVolume: (volume) => set({ volume }),
      setAutoDj: (enabled) => set({ autoDjEnabled: enabled }),
      setCurrentTime: (seconds) => set({ currentTimeSec: seconds }),
      requestSeek: (seconds) => set({ seekRequest: seconds }),
      clearSeekRequest: () => set({ seekRequest: null }),
      setCrossfadeOverride: (seconds) => set({ crossfadeOverrideSec: seconds }),
      requestMixNow: () => set((s) => ({ mixNowRequestId: s.mixNowRequestId + 1 })),
      setIsTransitioning: (isTransitioning) => set({ isTransitioning }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleQueuePanel: () => set((s) => ({ queuePanelOpen: !s.queuePanelOpen })),
      toggleDeckView: () => set((s) => ({ deckViewOpen: !s.deckViewOpen })),
      setNowPlayingExpanded: (expanded) => set({ nowPlayingExpanded: expanded }),
      // Populates the library from the server once on app start (replaces
      // the old IndexedDB-rehydration step — track sourceUrls are now
      // stable server URLs, not per-session blob: URLs, so there's nothing
      // to "rehydrate", just an initial fetch).
      loadLibrary: async () => {
        try {
          const res = await fetch("/api/tracks");
          if (!res.ok) return;
          const tracks = (await res.json()) as (Track & {
            analysis: TrackAnalysis | null;
            lyricalFingerprint: SerializedLyricalFingerprint | null;
          })[];
          const trackAnalysis: Record<string, TrackAnalysis> = {};
          const trackLyricalFingerprints: Record<string, LyricalFingerprint> = {};
          const localLibrary: Track[] = tracks.map(({ analysis, lyricalFingerprint, ...track }) => {
            if (analysis) trackAnalysis[track.id] = analysis;
            if (lyricalFingerprint) trackLyricalFingerprints[track.id] = deserializeFingerprint(lyricalFingerprint);
            return track;
          });
          set((s) => ({
            localLibrary,
            trackAnalysis: { ...s.trackAnalysis, ...trackAnalysis },
            trackLyricalFingerprints: { ...s.trackLyricalFingerprints, ...trackLyricalFingerprints },
          }));
        } finally {
          set({ libraryLoaded: true });
        }
      },
      addLocalTracks: (tracks) =>
        set((s) => ({ localLibrary: [...s.localLibrary, ...tracks] })),
      removeLocalTrack: async (trackId) => {
        const res = await fetch(`/api/tracks/${trackId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) return; // keep it in the UI if the server didn't actually remove it
        set((s) => ({
          localLibrary: s.localLibrary.filter((t) => t.id !== trackId),
        }));
      },
      setTrackAnalysis: (trackId, analysis) => {
        set((s) => ({ trackAnalysis: { ...s.trackAnalysis, [trackId]: analysis } }));
        // Cache it server-side so it's never recomputed for this track again.
        void fetch(`/api/tracks/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis }),
        });
      },
      setLyricalFingerprint: (trackId, fingerprint) => {
        set((s) => ({ trackLyricalFingerprints: { ...s.trackLyricalFingerprints, [trackId]: fingerprint } }));
        // Cache it server-side (fingerprint only, never the lyrics text) so
        // it's never re-looked-up for this track again, even an empty
        // "found nothing" result — see the schema comment on
        // lyricalFingerprintJson for why that distinction matters.
        void fetch(`/api/tracks/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lyricalFingerprint: serializeFingerprint(fingerprint) }),
        });
      },
      startAnalyzing: (trackId) =>
        set((s) => ({ analyzingTrackIds: new Set(s.analyzingTrackIds).add(trackId) })),
      stopAnalyzing: (trackId) =>
        set((s) => {
          const next = new Set(s.analyzingTrackIds);
          next.delete(trackId);
          return { analyzingTrackIds: next };
        }),
      setStyleGenreHint: (genreId) => set({ styleGenreHint: genreId }),
      setDjMode: (mode) => set({ djMode: mode }),
      setForcedTransitionId: (id) => set({ forcedTransitionId: id }),
      addRerolledTransitionId: (id) =>
        set((s) => ({ rerolledTransitionIds: [...s.rerolledTransitionIds, id] })),
      clearRerolledTransitionIds: () => set({ rerolledTransitionIds: [] }),
      setDjVarietyBias: (enabled) => set({ djVarietyBias: enabled }),
      setActiveTransitionRationale: (rationale) => set({ activeTransitionRationale: rationale }),
      setAmbienceEnabled: (enabled) => set({ ambienceEnabled: enabled }),
      setAmbienceFrequency: (frequency) => set({ ambienceFrequency: frequency }),
      setMashupEnabled: (enabled) => set({ mashupEnabled: enabled }),
      // Only localLibrary is the source of truth for curation flags, but
      // patch every place a matching track object might already live so a
      // badge shown elsewhere (queue, playlists, deck view) stays in sync.
      setTrackPlayPreference: (trackId, preference) => {
        set((s) => {
          const patch = (t: Track) => (t.id === trackId ? { ...t, playPreference: preference } : t);
          return {
            localLibrary: s.localLibrary.map(patch),
            playlists: s.playlists.map((p) => ({ ...p, tracks: p.tracks.map(patch) })),
            queue: s.queue.map(patch),
            currentTrack: s.currentTrack ? patch(s.currentTrack) : s.currentTrack,
          };
        });
        void fetch(`/api/tracks/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playPreference: preference ?? null }),
        });
      },

      next: () => {
        const { queue, currentTrack, history } = get();
        const nextHistory = currentTrack
          ? [...history, currentTrack].slice(-MAX_HISTORY)
          : history;
        if (queue.length === 0) {
          set({
            currentTrack: null,
            isPlaying: false,
            currentTimeSec: 0,
            history: nextHistory,
          });
          return;
        }
        const [nextTrack, ...rest] = queue;
        set({
          currentTrack: nextTrack,
          queue: rest,
          history: nextHistory,
          currentTimeSec: 0,
        });
      },

      previous: () => {
        const { history, currentTrack, queue } = get();
        if (history.length === 0) return;
        const previousTrack = history[history.length - 1];
        set({
          history: history.slice(0, -1),
          currentTrack: previousTrack,
          queue: currentTrack ? [currentTrack, ...queue] : queue,
          currentTimeSec: 0,
        });
      },

      // Server is the source of truth for playlists now — this only
      // populates the initial snapshot; every mutation below applies
      // optimistically to local state and persists to the API in the
      // background (except createPlaylist, which needs the server-assigned
      // id before the caller can navigate to it).
      loadPlaylists: async () => {
        try {
          const res = await fetch("/api/playlists");
          if (!res.ok) return;
          const playlists = (await res.json()) as Playlist[];
          set({ playlists });
        } finally {
          set({ playlistsLoaded: true });
        }
      },

      createPlaylist: async () => {
        const res = await fetch("/api/playlists", { method: "POST" });
        const playlist = (await res.json()) as Playlist;
        set((s) => ({ playlists: [...s.playlists, playlist] }));
        return playlist.id;
      },

      renamePlaylist: (playlistId, name) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, name } : p
          ),
        })),

      // Separate from renamePlaylist so typing doesn't fire a request per
      // keystroke — call this on blur once the name has settled.
      persistPlaylistName: (playlistId) => {
        const name = get().playlists.find((p) => p.id === playlistId)?.name;
        if (name === undefined) return;
        void fetch(`/api/playlists/${playlistId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      },

      removePlaylist: (playlistId) => {
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== playlistId),
        }));
        void fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
      },

      addTrackToPlaylist: (playlistId, track) => {
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.tracks.some((t) => t.id === track.id)
              ? { ...p, tracks: [...p.tracks, track] }
              : p
          ),
        }));
        void fetch(`/api/playlists/${playlistId}/tracks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId: track.id }),
        });
      },

      removeTrackFromPlaylist: (playlistId, trackId) => {
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }
              : p
          ),
        }));
        void fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" });
      },

      moveTrackInPlaylist: (playlistId, index, direction) => {
        const playlist = get().playlists.find((p) => p.id === playlistId);
        if (!playlist) return;
        const swapIndex = direction === "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= playlist.tracks.length) return;
        const tracks = [...playlist.tracks];
        [tracks[index], tracks[swapIndex]] = [tracks[swapIndex], tracks[index]];
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === playlistId ? { ...p, tracks } : p)),
        }));
        void fetch(`/api/playlists/${playlistId}/tracks/reorder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackIds: tracks.map((t) => t.id) }),
        });
      },
    })
);
