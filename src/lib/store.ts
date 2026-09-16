import { create } from "zustand";
import type { DeckId, Playlist, Track } from "@/types/music";
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
  /** Terse version of the same rationale, for Que's dismissible player-side label — set/cleared at the exact same moments as activeTransitionRationale, see mix-engine.ts's shortWhy. */
  activeTransitionShortWhy: string | null;
  /** Occasional mid-track FX (filter/riser builds, echo throws on breakdowns) — separate from transition FX, which always fire regardless of this setting. */
  ambienceEnabled: boolean;
  ambienceFrequency: AmbienceFrequency;
  /** Opportunistic tempo/key-matched dual-track mashup moments — a distinct, rarer "special moment" from ambience FX. */
  mashupEnabled: boolean;

  // ---- Mixer: a read-only live view of the AI's own mixing. Every field
  // here is written by DualDeckStage.tsx's read-back poll off the *real*
  // automation nodes mix-engine.ts already drives for Auto-DJ transitions
  // (nodes.gain/nodes.filter/nodes.lowShelf) — nothing here is user-settable;
  // there is no "apply store to node" direction anymore. Same in-memory-only
  // treatment as volume/crossfadeOverrideSec above (a mixing session's own
  // state, not saved to the DB).
  mixerPanelOpen: boolean;
  /** Which deck (A/B) is currently the audible one — mirrors DualDeckStage's own activeDeck state so the mixer UI knows which channel strip is "live" without needing to reach into that component. */
  activeDeckId: DeckId;
  /** Low-shelf cut per deck, dB — mirrors nodes.lowShelf.gain.value, the same node eq-kill transitions actually drive. */
  deckEqLowDb: Record<DeckId, number>;
  /** One-knob filter per deck, -1 (lowpass, full left) .. 0 (bypass) .. 1 (highpass, full right) — mirrors nodes.filter's live type/frequency via mixer-controls.ts's filterStateToKnobPos. */
  deckFilterPos: Record<DeckId, number>;
  /** Crossfader position, 0 (full deck A) .. 1 (full deck B) — derived from both decks' live nodes.gain.gain.value while both are actually audible (a transition/mashup/tempo-ramp in progress), otherwise snapped to whichever deck is solely active. */
  crossfaderPosition: number;
  /** Live 0-1 level per deck, written ~20x/sec by DualDeckStage from a real AnalyserNode tap — read-only from the UI's side, for the channel-strip meters. */
  deckMeterLevel: Record<DeckId, number>;
  /** Jog-wheel rotation per deck, degrees (0-360, wraps) — accumulated from that deck's real <audio> element's playbackRate each tick, frozen while paused. Speeds up/slows down for real during brake and spin-up transitions since it's driven by the actual element, not a fixed animation. */
  deckJogAngle: Record<DeckId, number>;

  playlists: Playlist[];
  playlistsLoaded: boolean;
  localLibrary: Track[];
  libraryLoaded: boolean;

  /** In-memory only (never persisted) — see lib/googleAuth.ts. Cleared on reload; the user reconnects via "Connect YouTube". */
  youtubeAccessToken: string | null;
  youtubeTokenExpiresAt: number | null;
  setYoutubeToken: (token: string | null, expiresAt: number | null) => void;

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
  /**
   * Syncs a YouTube track's resolved bpm across every place a Track object
   * lives (mirrors setTrackPlayPreference's pattern) plus the trackAnalysis
   * map mix-engine.ts actually reads. `persist: false` skips the PATCH —
   * used when the caller already wrote it server-side itself (the
   * bpm-lookup route, which has to call Deezer server-side anyway); pass
   * `true` for a value that's only ever lived in the browser so far (a
   * fresh tap-tempo reading).
   */
  setYoutubeBpm: (
    trackId: string,
    analysis: TrackAnalysis,
    bpmSource: "metadata" | "tap",
    persist: boolean
  ) => void;
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
  setActiveTransitionShortWhy: (shortWhy: string | null) => void;
  setAmbienceEnabled: (enabled: boolean) => void;
  setAmbienceFrequency: (frequency: AmbienceFrequency) => void;
  setMashupEnabled: (enabled: boolean) => void;
  setTrackPlayPreference: (trackId: string, preference: Track["playPreference"]) => void;
  setHotCueOverride: (trackId: string, cueNumber: number, atSec: number) => void;

  toggleMixerPanel: () => void;
  setActiveDeckId: (deckId: DeckId) => void;
  setDeckEqLowDb: (deckId: DeckId, db: number) => void;
  setDeckFilterPos: (deckId: DeckId, pos: number) => void;
  setCrossfaderPosition: (pos: number) => void;
  setDeckMeterLevel: (deckId: DeckId, level: number) => void;
  setDeckJogAngle: (deckId: DeckId, angle: number) => void;

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
      activeTransitionShortWhy: null,
      ambienceEnabled: true,
      ambienceFrequency: "occasional",
      mashupEnabled: true,

      mixerPanelOpen: false,
      activeDeckId: "A",
      deckEqLowDb: { A: 0, B: 0 },
      deckFilterPos: { A: 0, B: 0 },
      crossfaderPosition: 0.5,
      deckMeterLevel: { A: 0, B: 0 },
      deckJogAngle: { A: 0, B: 0 },

      playlists: [],
      playlistsLoaded: false,
      localLibrary: [],
      libraryLoaded: false,

      youtubeAccessToken: null,
      youtubeTokenExpiresAt: null,
      setYoutubeToken: (token, expiresAt) => set({ youtubeAccessToken: token, youtubeTokenExpiresAt: expiresAt }),

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
      setActiveTransitionShortWhy: (shortWhy) => set({ activeTransitionShortWhy: shortWhy }),
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
      // Same shape as setTrackPlayPreference: patch every place the track
      // object lives, then persist the whole (merged) override map — not
      // just the one changed cue — since the PATCH route replaces
      // hotCueOverridesJson wholesale rather than deep-merging it.
      setHotCueOverride: (trackId, cueNumber, atSec) => {
        set((s) => {
          const patch = (t: Track) =>
            t.id === trackId ? { ...t, hotCueOverrides: { ...t.hotCueOverrides, [cueNumber]: atSec } } : t;
          return {
            localLibrary: s.localLibrary.map(patch),
            playlists: s.playlists.map((p) => ({ ...p, tracks: p.tracks.map(patch) })),
            queue: s.queue.map(patch),
            currentTrack: s.currentTrack ? patch(s.currentTrack) : s.currentTrack,
          };
        });
        const { currentTrack, localLibrary } = get();
        const updated = currentTrack?.id === trackId ? currentTrack : localLibrary.find((t) => t.id === trackId);
        void fetch(`/api/tracks/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotCueOverrides: updated?.hotCueOverrides ?? { [cueNumber]: atSec } }),
        });
      },
      toggleMixerPanel: () => set((s) => ({ mixerPanelOpen: !s.mixerPanelOpen })),
      setActiveDeckId: (deckId) => set({ activeDeckId: deckId }),
      setDeckEqLowDb: (deckId, db) => set((s) => ({ deckEqLowDb: { ...s.deckEqLowDb, [deckId]: db } })),
      setDeckFilterPos: (deckId, pos) => set((s) => ({ deckFilterPos: { ...s.deckFilterPos, [deckId]: pos } })),
      setCrossfaderPosition: (pos) => set({ crossfaderPosition: pos }),
      setDeckMeterLevel: (deckId, level) =>
        set((s) => ({ deckMeterLevel: { ...s.deckMeterLevel, [deckId]: level } })),
      setDeckJogAngle: (deckId, angle) =>
        set((s) => ({ deckJogAngle: { ...s.deckJogAngle, [deckId]: angle } })),

      setYoutubeBpm: (trackId, analysis, bpmSource, persist) => {
        set((s) => {
          const patch = (t: Track) => (t.id === trackId && t.source === "youtube" ? { ...t, bpmSource } : t);
          return {
            localLibrary: s.localLibrary.map(patch),
            playlists: s.playlists.map((p) => ({ ...p, tracks: p.tracks.map(patch) })),
            queue: s.queue.map(patch),
            currentTrack: s.currentTrack ? patch(s.currentTrack) : s.currentTrack,
            trackAnalysis: { ...s.trackAnalysis, [trackId]: analysis },
          };
        });
        if (persist) {
          void fetch(`/api/tracks/${trackId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ analysis, bpmSource }),
          });
        }
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
