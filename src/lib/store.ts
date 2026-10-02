import { create } from "zustand";
import type { DeckId, FxSound, Playlist, Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";
import type { DjSetMode } from "@/lib/mix-engine";
import type { AmbienceFrequency } from "@/lib/ambience";
import {
  buildInitialShuffleBatch,
  buildShuffleSessionPool,
  extendShuffleQueue,
  SHUFFLE_EXTEND_THRESHOLD,
} from "@/lib/shuffle";
import {
  deserializeFingerprint,
  serializeFingerprint,
  type LyricalFingerprint,
  type SerializedLyricalFingerprint,
} from "@/lib/lyrics";
import { meanEnergy } from "@/lib/track-sequencing";
import {
  AI_CANDIDATE_CAP,
  DJ_MODE_DESCRIPTIONS,
  pickByBpmProximity,
  type AiNextTrackCandidate,
} from "@/lib/ai-dj";
import { pickFallbackTransitionFx, type AiFxCandidate, type AiFxTrackProfile } from "@/lib/ai-fx";

const MAX_HISTORY = 50;

/** An active self-extending Shuffle Play session — see startShuffle/extendShuffleQueue in lib/shuffle.ts. Null whenever the queue isn't currently DJ-driven (a manual track click, playlist, or direct queue clears it via playTrackList). */
interface ShuffleSession {
  /** Eligible (non-do-not) tracks captured when Shuffle Play was pressed. */
  pool: Track[];
  /** pool ids not yet handed out this "lap" — refilled by extendShuffleQueue once it runs out. */
  unplayedIds: string[];
}

interface PlayerState {
  queue: Track[];
  history: Track[];
  shuffleSession: ShuffleSession | null;
  /** The previous shuffle session's opening batch ids — nudges a fresh session's very first pick away from repeating the same start, without hard-excluding it. */
  recentShuffleOpeningIds: string[];
  /** id of the track requestAiNextPick last moved to the front of the queue — null whenever no AI pick is active (shuffle off, or the pick hasn't resolved yet). Drives the "AI Pick" badge in QueuePanel. */
  aiNextPickTrackId: string | null;
  /** Claude's (or the BPM-proximity fallback's) rationale for aiNextPickTrackId — shown as that badge's tooltip. */
  aiNextPickTransitionNote: string | null;
  /** Claude's recommended crossfade length for the upcoming mix into aiNextPickTrackId, seconds — informational only, never auto-applied to crossfadeOverrideSec (that field stays exclusively user-controlled). */
  aiNextPickRecommendedCrossfadeSec: number | null;
  aiNextPickLoading: boolean;
  /** id of the FX sound requestAiFxPick last chose for the upcoming transition into queue[0] — null whenever no pick is active (no FX library, request hasn't resolved, or it resolved to "play nothing"). See lib/ai-fx.ts. */
  aiFxPickId: string | null;
  aiFxPickStartOffsetSec: number | null;
  aiFxPickVolumeMultiplier: number | null;
  aiFxPickReason: string | null;
  aiFxPickLoading: boolean;
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number; // 0-1
  autoDjEnabled: boolean;
  currentTimeSec: number;
  seekRequest: number | null;
  crossfadeOverrideSec: number | null;
  mixNowRequestId: number;
  /** Beat Jump — a CDJ-style instant forward/back nudge, in a fixed beat count. Two independent counters (not one +/- field) so a rapid forward-then-back tap can never collide into "no change" — same shape as mixNowRequestId. */
  beatJumpForwardRequestId: number;
  beatJumpBackRequestId: number;
  /** Vinyl Brake Stop, exposed as a direct manual cue — see triggerBackspin in DualDeckStage.tsx. */
  backspinRequestId: number;
  /** Reverse Playback, a direct manual cue — see startReversePlayback in DualDeckStage.tsx. */
  reverseRequestId: number;
  /** Manual Loop In/Out — three independent request counters (not a single combined action) so a rapid in-then-out-then-exit sequence can never collide into "no change", same shape as every other manual request field above. See setLoopIn/setLoopOut/releaseManualLoop in DualDeckStage.tsx. */
  loopInRequestId: number;
  loopOutRequestId: number;
  loopExitRequestId: number;
  /** Read-only mirror of the real manual-loop state, for the DJ Decks panel to display — written only by DualDeckStage's real deck logic, same "mirror real nodes, never a second writer" contract as the Mixer panel's fields. */
  manualLoopActive: boolean;
  manualLoopInSec: number | null;
  manualLoopOutSec: number | null;
  isTransitioning: boolean;
  sidebarOpen: boolean;
  queuePanelOpen: boolean;
  deckViewOpen: boolean;
  /** Full-screen now-playing view, expanded from the compact PlayerBar footer. */
  nowPlayingExpanded: boolean;
  trackAnalysis: Record<string, TrackAnalysis>;
  /** Cached lyrical/thematic fingerprint per track id — present (even if empty) once looked up, absent if never attempted. Never the lyrics text itself, see lib/lyrics.ts. */
  trackLyricalFingerprints: Record<string, LyricalFingerprint>;
  /** Cached "does this track have a ready, real isolated vocal stem" check per track id (from StemSeparationJob, via the existing GET /api/tracks/[id]/stems) — absent if never checked, null if checked and not ready, a string (the vocalsUrl) once ready. Checked once per track, never invalidated, same convention as trackLyricalFingerprints. Used only to gate the "vocal-layering" transition's eligibility — never triggers separation itself. */
  stemAvailability: Record<string, string | null>;
  analyzingTrackIds: Set<string>;
  styleGenreHint: string | null;
  djMode: DjSetMode;
  /** Manually pinned transition id for the upcoming mix — cleared automatically once that mix starts. */
  forcedTransitionId: string | null;
  /** transitionIds the user has "rerolled" away from for the upcoming mix — cleared automatically once that mix starts. */
  rerolledTransitionIds: string[];
  djVarietyBias: boolean;
  /** Real, visible CDJ-style Quantize toggle — when on (default, matches every prior session's always-on behavior), transitions/mashups/loop starts snap to the beat grid; when off, they use raw unsnapped positions. */
  quantizeEnabled: boolean;
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
  /** Live 0-1 level of the "vocal-layering" transition's one-shot overlay voice, from a real AnalyserNode tap — 0 whenever that effect isn't currently active. Read-only, same convention as deckMeterLevel. */
  vocalLayerVoiceLevel: number;
  /** Jog-wheel rotation per deck, degrees (0-360, wraps) — accumulated from that deck's real <audio> element's playbackRate each tick, frozen while paused. Speeds up/slows down for real during brake and spin-up transitions since it's driven by the actual element, not a fixed animation. */
  deckJogAngle: Record<DeckId, number>;

  playlists: Playlist[];
  playlistsLoaded: boolean;
  localLibrary: Track[];
  fxLibrary: FxSound[];
  fxLibraryLoaded: boolean;
  /** The `theme` of whichever playlist the current queue was sourced from (playTrackList's `sourcePlaylistTheme` param) — e.g. "spooky" while playing the Spooky Music playlist, null otherwise. Drives all Halloween theming/audio. Cleared by any non-playlist playback (direct track click, Shuffle Play) the same way aiNextPickTrackId is. */
  activePlaylistTheme: string | null;
  libraryLoaded: boolean;
  /** Live text of the top search box — every keystroke lands here synchronously (see TopBar.tsx); the Library page and the quick-results dropdown both filter off it. In-memory only; the ?q= URL param on /library is a debounced mirror of it. */
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  /** In-memory only (never persisted) — see lib/googleAuth.ts. Cleared on reload; the user reconnects via "Connect YouTube". */
  youtubeAccessToken: string | null;
  youtubeTokenExpiresAt: number | null;
  setYoutubeToken: (token: string | null, expiresAt: number | null) => void;

  setQueue: (tracks: Track[]) => void;
  enqueue: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
  /** `sourcePlaylistTheme` is the playlist's `theme` field when playback was started from a themed playlist (e.g. "spooky"), omitted/null for any other playback — sets activePlaylistTheme so Halloween theming/audio knows to engage. */
  playTrackList: (tracks: Track[], startIndex: number, sourcePlaylistTheme?: string | null) => void;
  /** Starts a true, DJ-driven shuffle session: queues an initial compatibility-aware, non-repeating batch and marks the session active so `next()` keeps extending it as it runs low. See lib/shuffle.ts. */
  startShuffle: (tracks: Track[]) => void;
  /**
   * Asks the Anthropic API (via /api/dj/next-track) to pick the best next
   * track for a shuffle session, then reorders it to the front of the
   * queue. No-ops outside an active shuffle session. Falls back to a local
   * BPM-proximity pick (lib/ai-dj.ts's pickByBpmProximity, same algorithm
   * the API route itself falls back to) if the request fails outright —
   * shuffle playback should never stall waiting on this. See the effect in
   * DualDeckStage.tsx that calls this once per new currentTrack.
   */
  requestAiNextPick: () => Promise<void>;
  /**
   * Asks the Anthropic API (via /api/dj/next-fx) to pick the best transition
   * FX from the user's FX library for the upcoming transition from
   * currentTrack into queue[0]. No-ops without both tracks known. Falls back
   * to a local category+BPM pick (lib/ai-fx.ts's pickFallbackTransitionFx)
   * if the request fails outright. See the effect in DualDeckStage.tsx that
   * calls this once per new (currentTrack, queue[0]) pair.
   */
  requestAiFxPick: () => Promise<void>;
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
  requestBeatJump: (direction: 1 | -1) => void;
  requestBackspin: () => void;
  requestReverse: () => void;
  requestLoopIn: () => void;
  requestLoopOut: () => void;
  requestLoopExit: () => void;
  /** Write-only from the DJ Decks panel's perspective — called by DualDeckStage's real deck logic to mirror actual manual-loop state; never called from a component. */
  setManualLoopState: (active: boolean, inSec: number | null, outSec: number | null) => void;
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
  setQuantizeEnabled: (enabled: boolean) => void;
  setActiveTransitionRationale: (rationale: string | null) => void;
  setActiveTransitionShortWhy: (shortWhy: string | null) => void;
  setAmbienceEnabled: (enabled: boolean) => void;
  setAmbienceFrequency: (frequency: AmbienceFrequency) => void;
  setMashupEnabled: (enabled: boolean) => void;
  setTrackPlayPreference: (trackId: string, preference: Track["playPreference"]) => void;
  /** Manual tags (e.g. "halloween", "spooky") — drives the Spooky Music system playlist's auto-membership. */
  setTrackTags: (trackId: string, tags: string[]) => void;
  setHotCueOverride: (trackId: string, cueNumber: number, atSec: number) => void;

  toggleMixerPanel: () => void;
  setActiveDeckId: (deckId: DeckId) => void;
  setDeckEqLowDb: (deckId: DeckId, db: number) => void;
  setDeckFilterPos: (deckId: DeckId, pos: number) => void;
  setCrossfaderPosition: (pos: number) => void;
  setDeckMeterLevel: (deckId: DeckId, level: number) => void;
  setDeckJogAngle: (deckId: DeckId, angle: number) => void;
  setVocalLayerVoiceLevel: (level: number) => void;
  setStemAvailability: (trackId: string, vocalsUrl: string | null) => void;

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

  loadFxLibrary: () => Promise<void>;
  uploadFxSound: (file: File, metadata: { name: string; category: FxSound["category"] }) => Promise<void>;
  updateFxSound: (fxId: string, patch: Partial<Pick<FxSound, "name" | "category" | "bpm" | "key" | "tags" | "playlistAffinity">>) => Promise<void>;
  /** Local-only patch (no network) for bpm/key/tags inputs — pair with persistFxSound on blur so typing doesn't fire a request per keystroke. */
  patchFxSoundLocal: (fxId: string, patch: Partial<Pick<FxSound, "bpm" | "key" | "tags" | "playlistAffinity">>) => void;
  persistFxSound: (fxId: string) => Promise<void>;
  removeFxSound: (fxId: string) => Promise<void>;
}

export const useStore = create<PlayerState>()(
  (set, get) => ({
      queue: [],
      history: [],
      shuffleSession: null,
      recentShuffleOpeningIds: [],
      aiNextPickTrackId: null,
      aiNextPickTransitionNote: null,
      aiNextPickRecommendedCrossfadeSec: null,
      aiNextPickLoading: false,
      aiFxPickId: null,
      aiFxPickStartOffsetSec: null,
      aiFxPickVolumeMultiplier: null,
      aiFxPickReason: null,
      aiFxPickLoading: false,
      activePlaylistTheme: null,
      currentTrack: null,
      isPlaying: false,
      volume: 1,
      autoDjEnabled: true,
      currentTimeSec: 0,
      seekRequest: null,
      crossfadeOverrideSec: null,
      mixNowRequestId: 0,
      beatJumpForwardRequestId: 0,
      beatJumpBackRequestId: 0,
      backspinRequestId: 0,
      reverseRequestId: 0,
      loopInRequestId: 0,
      loopOutRequestId: 0,
      loopExitRequestId: 0,
      manualLoopActive: false,
      manualLoopInSec: null,
      manualLoopOutSec: null,
      isTransitioning: false,
      sidebarOpen: false,
      queuePanelOpen: false,
      deckViewOpen: false,
      nowPlayingExpanded: false,
      trackAnalysis: {},
      stemAvailability: {},
      trackLyricalFingerprints: {},
      analyzingTrackIds: new Set<string>(),
      styleGenreHint: null,
      djMode: "auto",
      forcedTransitionId: null,
      rerolledTransitionIds: [],
      djVarietyBias: false,
      quantizeEnabled: true,
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
      vocalLayerVoiceLevel: 0,
      deckJogAngle: { A: 0, B: 0 },

      playlists: [],
      playlistsLoaded: false,
      localLibrary: [],
      fxLibrary: [],
      fxLibraryLoaded: false,
      libraryLoaded: false,
      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),

      youtubeAccessToken: null,
      youtubeTokenExpiresAt: null,
      setYoutubeToken: (token, expiresAt) => set({ youtubeAccessToken: token, youtubeTokenExpiresAt: expiresAt }),

      setQueue: (tracks) => set({ queue: tracks }),
      enqueue: (track) => set((s) => ({ queue: [...s.queue, track] })),
      removeFromQueue: (trackId) =>
        set((s) => ({ queue: s.queue.filter((t) => t.id !== trackId) })),

      playTrackList: (tracks, startIndex, sourcePlaylistTheme = null) => {
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
          // Any direct/manual play (including a plain, non-shuffle queue)
          // ends a running shuffle session — the single choke point every
          // manual click path already goes through, so nothing else needs
          // to know about shuffle mode to correctly leave it.
          shuffleSession: null,
          aiNextPickTrackId: null,
          aiNextPickTransitionNote: null,
          aiNextPickRecommendedCrossfadeSec: null,
          // Stale from whatever was queued up before — a fresh pick gets
          // requested for the new (currentTrack, queue[0]) pairing, but
          // clear the old one now so a transition started before that
          // resolves can't play an FX matched to a different pairing.
          aiFxPickId: null,
          aiFxPickStartOffsetSec: null,
          aiFxPickVolumeMultiplier: null,
          aiFxPickReason: null,
          activePlaylistTheme: sourcePlaylistTheme,
        });
      },

      startShuffle: (tracks) => {
        const { trackAnalysis, trackLyricalFingerprints, recentShuffleOpeningIds, playTrackList: play } = get();
        const pool = buildShuffleSessionPool(tracks);
        const batch = buildInitialShuffleBatch(pool, trackAnalysis, trackLyricalFingerprints, recentShuffleOpeningIds);
        play(batch, 0);
        const batchIds = new Set(batch.map((t) => t.id));
        set({
          shuffleSession: { pool, unplayedIds: pool.filter((t) => !batchIds.has(t.id)).map((t) => t.id) },
          recentShuffleOpeningIds: batch.map((t) => t.id),
        });
      },

      requestAiNextPick: async () => {
        const {
          currentTrack,
          queue,
          shuffleSession,
          trackAnalysis,
          djMode,
          crossfadeOverrideSec,
          styleGenreHint,
          ambienceEnabled,
          mashupEnabled,
          djVarietyBias,
        } = get();
        if (!currentTrack || !shuffleSession || queue.length === 0) return;

        const toCandidate = (t: Track): AiNextTrackCandidate => {
          const analysis = trackAnalysis[t.id];
          return {
            id: t.id,
            title: t.title,
            artist: t.artist,
            bpm: analysis?.bpm ?? (t.source === "local" ? t.bpm ?? null : null),
            camelotKey: analysis?.camelotKey ?? null,
            energy: analysis ? meanEnergy(analysis.waveformPeaks) : null,
            hasRealAnalysis: analysis != null && !analysis.fallback,
          };
        };

        // Candidate pool for the AI: everything already queued, topped up
        // (bounded by AI_CANDIDATE_CAP) with the wider still-unplayed pool
        // so Claude reasons over more than just the small rolling window —
        // see lib/ai-dj.ts's AI_CANDIDATE_CAP comment for why it's capped.
        const queuedIds = new Set(queue.map((t) => t.id));
        const poolById = new Map(shuffleSession.pool.map((t) => [t.id, t]));
        const extraUnplayed = shuffleSession.unplayedIds
          .filter((id) => !queuedIds.has(id))
          .map((id) => poolById.get(id))
          .filter((t): t is Track => t != null)
          .slice(0, Math.max(0, AI_CANDIDATE_CAP - queue.length));
        const candidateTracks = [...queue, ...extraUnplayed];

        const trackIdAtStart = currentTrack.id;
        set({ aiNextPickLoading: true });

        let picked: { trackId: string; transitionNote?: string; recommendedCrossfadeSeconds?: number };
        try {
          const res = await fetch("/api/dj/next-track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentTrack: toCandidate(currentTrack),
              candidates: candidateTracks.map(toCandidate),
              boardState: {
                mixMode: djMode,
                mixModeDescription: DJ_MODE_DESCRIPTIONS[djMode],
                crossfadeSeconds: crossfadeOverrideSec,
                styleGenreHint,
                ambienceEnabled,
                mashupEnabled,
                djVarietyBias,
              },
            }),
          });
          picked = res.ok
            ? await res.json()
            : pickByBpmProximity(toCandidate(currentTrack), candidateTracks.map(toCandidate));
        } catch {
          picked = pickByBpmProximity(toCandidate(currentTrack), candidateTracks.map(toCandidate));
        }

        // The current track may have changed (a manual skip, or the
        // session ended) while this request was in flight — bail rather
        // than reordering a queue that's no longer the one this pick was
        // computed for. Same "trackIdAtStart" guard DualDeckStage.tsx uses
        // for its own async continuations.
        const state = get();
        if (state.currentTrack?.id !== trackIdAtStart || !state.shuffleSession) {
          set({ aiNextPickLoading: false });
          return;
        }

        const pickedId: string = picked.trackId;
        const applyPick = (nextQueue: Track[], nextSession: ShuffleSession) =>
          set({
            queue: nextQueue,
            shuffleSession: nextSession,
            aiNextPickTrackId: pickedId,
            aiNextPickTransitionNote: picked.transitionNote ?? null,
            aiNextPickRecommendedCrossfadeSec: picked.recommendedCrossfadeSeconds ?? null,
            aiNextPickLoading: false,
          });

        if (pickedId === state.queue[0]?.id) {
          applyPick(state.queue, state.shuffleSession);
          return;
        }
        const alreadyQueued = state.queue.find((t) => t.id === pickedId);
        if (alreadyQueued) {
          applyPick([alreadyQueued, ...state.queue.filter((t) => t.id !== pickedId)], state.shuffleSession);
          return;
        }
        const fromPool = state.shuffleSession.pool.find((t) => t.id === pickedId);
        if (fromPool) {
          applyPick([fromPool, ...state.queue], {
            ...state.shuffleSession,
            unplayedIds: state.shuffleSession.unplayedIds.filter((id) => id !== pickedId),
          });
          return;
        }
        // Picked id matched no known track (shouldn't happen — the route
        // validates it against the candidates it was sent) — leave the
        // queue untouched rather than risk dropping the current one.
        set({ aiNextPickLoading: false });
      },

      requestAiFxPick: async () => {
        const { currentTrack, queue, trackAnalysis, fxLibrary, djMode, crossfadeOverrideSec, activePlaylistTheme } =
          get();
        const nextTrack = queue[0];
        if (!currentTrack || !nextTrack) return;

        const toProfile = (t: Track): AiFxTrackProfile => {
          const analysis = trackAnalysis[t.id];
          return {
            title: t.title,
            bpm: analysis?.bpm ?? (t.source === "local" ? t.bpm ?? null : null),
            camelotKey: analysis?.camelotKey ?? null,
            energy: analysis ? meanEnergy(analysis.waveformPeaks) : null,
          };
        };

        // While the Spooky Music playlist is active, only halloween-affinied
        // FX are eligible — see DualDeckStage.tsx's 3-layer Halloween audio
        // system. Elsewhere, the whole library is in play.
        const isSpooky = activePlaylistTheme === "spooky";
        const eligibleFx = isSpooky
          ? fxLibrary.filter((fx) => fx.playlistAffinity.includes("spooky") || fx.playlistAffinity.includes("halloween"))
          : fxLibrary;
        const toCandidate = (fx: FxSound): AiFxCandidate => ({
          id: fx.id,
          name: fx.name,
          category: fx.category,
          bpm: fx.bpm ?? null,
          key: fx.key ?? null,
          tags: fx.tags,
          durationSec: fx.durationSec,
        });
        const fxCandidates = eligibleFx.map(toCandidate);

        const trackIdAtStart = currentTrack.id;
        const nextTrackIdAtStart = nextTrack.id;
        set({ aiFxPickLoading: true });

        let picked: { fxId: string | null; startOffsetSeconds?: number; volumeMultiplier?: number; reason?: string };
        try {
          const res = await fetch("/api/dj/next-fx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentTrack: toProfile(currentTrack),
              nextTrack: toProfile(nextTrack),
              fxLibrary: fxCandidates,
              boardState: { mixMode: djMode, crossfadeSeconds: crossfadeOverrideSec },
            }),
          });
          picked = res.ok ? await res.json() : pickFallbackTransitionFx(toProfile(currentTrack), fxCandidates);
        } catch {
          picked = pickFallbackTransitionFx(toProfile(currentTrack), fxCandidates);
        }

        // Same staleness guard as requestAiNextPick — bail if the upcoming
        // transition this pick was computed for is no longer the one lined
        // up (a manual skip, reorder, etc. while the request was in flight).
        const state = get();
        if (state.currentTrack?.id !== trackIdAtStart || state.queue[0]?.id !== nextTrackIdAtStart) {
          set({ aiFxPickLoading: false });
          return;
        }

        set({
          aiFxPickId: picked.fxId,
          aiFxPickStartOffsetSec: picked.startOffsetSeconds ?? 0,
          aiFxPickVolumeMultiplier: picked.volumeMultiplier ?? null,
          aiFxPickReason: picked.reason ?? null,
          aiFxPickLoading: false,
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
      requestBeatJump: (direction) =>
        direction === 1
          ? set((s) => ({ beatJumpForwardRequestId: s.beatJumpForwardRequestId + 1 }))
          : set((s) => ({ beatJumpBackRequestId: s.beatJumpBackRequestId + 1 })),
      requestBackspin: () => set((s) => ({ backspinRequestId: s.backspinRequestId + 1 })),
      requestReverse: () => set((s) => ({ reverseRequestId: s.reverseRequestId + 1 })),
      requestLoopIn: () => set((s) => ({ loopInRequestId: s.loopInRequestId + 1 })),
      requestLoopOut: () => set((s) => ({ loopOutRequestId: s.loopOutRequestId + 1 })),
      requestLoopExit: () => set((s) => ({ loopExitRequestId: s.loopExitRequestId + 1 })),
      setManualLoopState: (active, inSec, outSec) =>
        set({ manualLoopActive: active, manualLoopInSec: inSec, manualLoopOutSec: outSec }),
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
      setQuantizeEnabled: (enabled) => set({ quantizeEnabled: enabled }),
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
      setTrackTags: (trackId, tags) => {
        set((s) => {
          const patch = (t: Track) => (t.id === trackId ? { ...t, tags } : t);
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
          body: JSON.stringify({ tags }),
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
      setVocalLayerVoiceLevel: (level) => set({ vocalLayerVoiceLevel: level }),
      setStemAvailability: (trackId, vocalsUrl) =>
        set((s) => ({ stemAvailability: { ...s.stemAvailability, [trackId]: vocalsUrl } })),
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
        const { queue, currentTrack, history, shuffleSession, trackAnalysis, trackLyricalFingerprints } = get();
        const nextHistory = currentTrack
          ? [...history, currentTrack].slice(-MAX_HISTORY)
          : history;
        if (queue.length === 0) {
          set({
            currentTrack: null,
            isPlaying: false,
            currentTimeSec: 0,
            history: nextHistory,
            shuffleSession: null,
            aiNextPickTrackId: null,
            aiNextPickTransitionNote: null,
            aiNextPickRecommendedCrossfadeSec: null,
          });
          return;
        }
        const [nextTrack, ...rest] = queue;

        // Running low on a DJ-driven shuffle queue — extend it now, in the
        // same tick, so whatever reads queue[0] next never sees it empty.
        let extendedQueue = rest;
        let nextSession = shuffleSession;
        if (shuffleSession && rest.length <= SHUFFLE_EXTEND_THRESHOLD) {
          const anchor = rest[rest.length - 1] ?? nextTrack;
          const protectIds = new Set([nextTrack.id, ...rest.map((t) => t.id)]);
          const { batch, unplayedIds } = extendShuffleQueue(
            shuffleSession,
            anchor,
            protectIds,
            trackAnalysis,
            trackLyricalFingerprints
          );
          extendedQueue = [...rest, ...batch];
          nextSession = { ...shuffleSession, unplayedIds };
        }

        set({
          currentTrack: nextTrack,
          queue: extendedQueue,
          history: nextHistory,
          currentTimeSec: 0,
          shuffleSession: nextSession,
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

      loadFxLibrary: async () => {
        try {
          const res = await fetch("/api/fx");
          if (!res.ok) return;
          const fxLibrary = (await res.json()) as FxSound[];
          set({ fxLibrary });
        } finally {
          set({ fxLibraryLoaded: true });
        }
      },

      uploadFxSound: async (file, metadata) => {
        const { uploadFx } = await import("@/lib/fxUpload");
        const durationSec = await new Promise<number>((resolve) => {
          const audio = new Audio();
          const url = URL.createObjectURL(file);
          audio.preload = "metadata";
          audio.addEventListener("loadedmetadata", () => {
            URL.revokeObjectURL(url);
            resolve(audio.duration || 0);
          }, { once: true });
          audio.addEventListener("error", () => {
            URL.revokeObjectURL(url);
            resolve(0);
          }, { once: true });
          audio.src = url;
        });
        const fx = await uploadFx(file, { ...metadata, durationSec });
        set((s) => ({ fxLibrary: [...s.fxLibrary, fx] }));
      },

      updateFxSound: async (fxId, patch) => {
        set((s) => ({
          fxLibrary: s.fxLibrary.map((fx) => (fx.id === fxId ? { ...fx, ...patch } : fx)),
        }));
        const res = await fetch(`/api/fx/${fxId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const fx = (await res.json()) as FxSound;
          set((s) => ({ fxLibrary: s.fxLibrary.map((f) => (f.id === fxId ? fx : f)) }));
        }
      },

      // Local-only counterpart to updateFxSound, for free-typing fields
      // (bpm/key/tags) so every keystroke doesn't fire a PATCH — same split
      // renamePlaylist/persistPlaylistName already uses for playlist names.
      // Call persistFxSound (on blur) to actually save.
      patchFxSoundLocal: (fxId, patch) =>
        set((s) => ({
          fxLibrary: s.fxLibrary.map((fx) => (fx.id === fxId ? { ...fx, ...patch } : fx)),
        })),

      persistFxSound: async (fxId) => {
        const fx = get().fxLibrary.find((f) => f.id === fxId);
        if (!fx) return;
        const res = await fetch(`/api/fx/${fxId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bpm: fx.bpm ?? null, key: fx.key ?? null, tags: fx.tags, playlistAffinity: fx.playlistAffinity }),
        });
        if (res.ok) {
          const updated = (await res.json()) as FxSound;
          set((s) => ({ fxLibrary: s.fxLibrary.map((f) => (f.id === fxId ? updated : f)) }));
        }
      },

      removeFxSound: async (fxId) => {
        const res = await fetch(`/api/fx/${fxId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) return; // keep it in the UI if the server didn't actually remove it
        set((s) => ({ fxLibrary: s.fxLibrary.filter((fx) => fx.id !== fxId) }));
      },
    })
);
