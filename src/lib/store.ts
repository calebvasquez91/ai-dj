import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Playlist, Track } from "@/types/music";
import type { TrackAnalysis } from "@/lib/audio-analysis";

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
  trackAnalysis: Record<string, TrackAnalysis>;
  analyzingTrackIds: Set<string>;
  styleGenreHint: string | null;

  playlists: Playlist[];
  localLibrary: Track[];
  audioHydrated: boolean;

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
  addLocalTracks: (tracks: Track[]) => void;
  removeLocalTrack: (trackId: string) => void;
  setTrackSourceUrls: (urls: Record<string, string>) => void;
  setAudioHydrated: (hydrated: boolean) => void;
  setTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => void;
  startAnalyzing: (trackId: string) => void;
  stopAnalyzing: (trackId: string) => void;
  setStyleGenreHint: (genreId: string | null) => void;

  createPlaylist: () => string;
  renamePlaylist: (playlistId: string, name: string) => void;
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
  persist(
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
      trackAnalysis: {},
      analyzingTrackIds: new Set<string>(),
      styleGenreHint: null,

      playlists: [],
      localLibrary: [],
      audioHydrated: false,

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
      addLocalTracks: (tracks) =>
        set((s) => ({ localLibrary: [...s.localLibrary, ...tracks] })),
      removeLocalTrack: (trackId) =>
        set((s) => ({
          localLibrary: s.localLibrary.filter((t) => t.id !== trackId),
        })),
      // Called once on startup by <AudioHydrator> after it reads each
      // track's bytes back out of IndexedDB and mints fresh blob: URLs —
      // patches every place a matching track object might live.
      setTrackSourceUrls: (urls) =>
        set((s) => {
          const patch = (t: Track) =>
            urls[t.id] ? { ...t, sourceUrl: urls[t.id] } : t;
          return {
            localLibrary: s.localLibrary.map(patch),
            playlists: s.playlists.map((p) => ({
              ...p,
              tracks: p.tracks.map(patch),
            })),
            queue: s.queue.map(patch),
            history: s.history.map(patch),
            currentTrack: s.currentTrack ? patch(s.currentTrack) : s.currentTrack,
          };
        }),
      setAudioHydrated: (hydrated) => set({ audioHydrated: hydrated }),
      setTrackAnalysis: (trackId, analysis) =>
        set((s) => ({ trackAnalysis: { ...s.trackAnalysis, [trackId]: analysis } })),
      startAnalyzing: (trackId) =>
        set((s) => ({ analyzingTrackIds: new Set(s.analyzingTrackIds).add(trackId) })),
      stopAnalyzing: (trackId) =>
        set((s) => {
          const next = new Set(s.analyzingTrackIds);
          next.delete(trackId);
          return { analyzingTrackIds: next };
        }),
      setStyleGenreHint: (genreId) => set({ styleGenreHint: genreId }),

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

      createPlaylist: () => {
        const id = crypto.randomUUID();
        const playlist: Playlist = {
          id,
          name: "New Playlist",
          tracks: [],
          createdAt: Date.now(),
        };
        set((s) => ({ playlists: [...s.playlists, playlist] }));
        return id;
      },

      renamePlaylist: (playlistId, name) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, name } : p
          ),
        })),

      removePlaylist: (playlistId) =>
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== playlistId),
        })),

      addTrackToPlaylist: (playlistId, track) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.tracks.some((t) => t.id === track.id)
              ? { ...p, tracks: [...p.tracks, track] }
              : p
          ),
        })),

      removeTrackFromPlaylist: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }
              : p
          ),
        })),

      moveTrackInPlaylist: (playlistId, index, direction) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const swapIndex = direction === "up" ? index - 1 : index + 1;
            if (swapIndex < 0 || swapIndex >= p.tracks.length) return p;
            const tracks = [...p.tracks];
            [tracks[index], tracks[swapIndex]] = [tracks[swapIndex], tracks[index]];
            return { ...p, tracks };
          }),
        })),
    }),
    {
      name: "ai-dj-storage",
      // sourceUrl values are stale blob: URLs the moment this is written to
      // localStorage — <AudioHydrator> mints fresh ones from IndexedDB on
      // next load and patches them back in via setTrackSourceUrls.
      partialize: (state) => ({
        playlists: state.playlists,
        localLibrary: state.localLibrary,
      }),
    }
  )
);
