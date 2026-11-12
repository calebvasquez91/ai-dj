import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { useStore } from "./store";
import type { LocalTrack, Playlist, Track } from "@/types/music";
import { fallbackAnalysis } from "@/lib/audio-analysis-core";
import { TRANSITION_TRACK_PREFIX } from "@/lib/transitionSound";

function makeTrack(id: string, playPreference?: Track["playPreference"]): Track {
  return {
    id,
    title: id,
    artist: "Test Artist",
    durationSec: 200,
    addedAt: 0,
    source: "local",
    sourceUrl: `blob:${id}`,
    playPreference,
  };
}

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("startShuffle", () => {
  it("queues an initial batch and marks a shuffle session active", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks);
    const state = useStore.getState();
    expect(state.currentTrack).not.toBeNull();
    expect(state.queue.length).toBeGreaterThan(0);
    expect(state.shuffleSession).not.toBeNull();
    expect(state.shuffleSession!.pool).toHaveLength(15);
  });

  it("excludes do-not-play tracks from the session pool", () => {
    const tracks = [makeTrack("a"), makeTrack("b", "do-not"), makeTrack("c")];
    useStore.getState().startShuffle(tracks);
    const session = useStore.getState().shuffleSession!;
    expect(session.pool.some((t) => t.id === "b")).toBe(false);
  });
});

describe("startShuffle on a themed playlist", () => {
  it("keeps the playlist's theme, so Halloween theming engages for Shuffle Play too", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks, "spooky");
    expect(useStore.getState().activePlaylistTheme).toBe("spooky");
  });

  it("clears a previous theme when the shuffle isn't from a themed playlist", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().playTrackList(tracks, 0, "spooky");
    useStore.getState().startShuffle(tracks);
    expect(useStore.getState().activePlaylistTheme).toBeNull();
  });
});

describe("a themed playlist's theme through a running session", () => {
  it("survives next() and shuffle queue extension while tracks keep playing", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks, "spooky");
    for (let i = 0; i < 6; i++) {
      useStore.getState().next();
      const state = useStore.getState();
      expect(state.currentTrack).not.toBeNull();
      expect(state.activePlaylistTheme).toBe("spooky");
    }
  });

  it("is cleared when the queue runs out and playback stops", () => {
    const tracks = [makeTrack("a"), makeTrack("b")];
    useStore.getState().playTrackList(tracks, 0, "spooky");
    useStore.getState().next(); // b
    expect(useStore.getState().activePlaylistTheme).toBe("spooky");
    useStore.getState().next(); // nothing left
    const state = useStore.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.activePlaylistTheme).toBeNull();
  });
});

describe("playPlaylist", () => {
  const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));

  it("plays from the given index and carries the playlist's theme", () => {
    useStore.getState().playPlaylist({ tracks, theme: "spooky" }, { startIndex: 3 });
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe("t3");
    expect(state.activePlaylistTheme).toBe("spooky");
    expect(state.shuffleSession).toBeNull();
  });

  it("starts a shuffle session that carries the theme", () => {
    useStore.getState().playPlaylist({ tracks, theme: "spooky" }, { shuffle: true });
    const state = useStore.getState();
    expect(state.shuffleSession).not.toBeNull();
    expect(state.activePlaylistTheme).toBe("spooky");
  });

  it("leaves a plain playlist unthemed", () => {
    useStore.getState().playPlaylist({ tracks }, { shuffle: true });
    expect(useStore.getState().activePlaylistTheme).toBeNull();
    useStore.getState().playPlaylist({ tracks });
    expect(useStore.getState().activePlaylistTheme).toBeNull();
  });
});

describe("playTrackList", () => {
  it("clears an active shuffle session (manual play always ends shuffle mode)", () => {
    const tracks = Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks);
    expect(useStore.getState().shuffleSession).not.toBeNull();

    useStore.getState().playTrackList(tracks, 0);
    expect(useStore.getState().shuffleSession).toBeNull();
  });
});

describe("next() with an active shuffle session", () => {
  it("is byte-for-byte unchanged when there's no shuffle session", () => {
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    useStore.getState().playTrackList(tracks, 0);
    useStore.getState().next();
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe("b");
    expect(state.queue.map((t) => t.id)).toEqual(["c"]);
    expect(state.shuffleSession).toBeNull();
  });

  it("extends the queue once it drops to the threshold, seamlessly", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks); // queue starts at 9 behind currentTrack (10 total - 1 current)
    // Advance a fixed number of times to reach the extend threshold (queue
    // shrinks by 1 per call: 9, 8, 7, 6 — the 4th call's `rest` is exactly
    // 5, which is when the threshold check fires). Deliberately NOT a
    // while-loop on "queue.length > threshold": the extension is designed
    // to refill back past the threshold every time it fires, so that
    // condition would never become false.
    useStore.getState().next();
    useStore.getState().next();
    useStore.getState().next();
    const beforeExtend = useStore.getState().queue.length;
    expect(beforeExtend).toBe(6);

    useStore.getState().next(); // this pop's `rest` is 5 — should trigger an extension
    const state = useStore.getState();
    expect(state.currentTrack).not.toBeNull();
    // The queue should have grown back up rather than running out, since
    // the pool (12 tracks) has plenty left to draw from.
    expect(state.queue.length).toBeGreaterThan(5);
  });

  it("never leaves the queue empty mid-session while the pool still has unplayed tracks", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => makeTrack(`t${i}`));
    useStore.getState().startShuffle(tracks);
    for (let i = 0; i < 8; i++) {
      useStore.getState().next();
      const state = useStore.getState();
      if (state.currentTrack) expect(state.queue.length).toBeGreaterThan(0);
    }
  });
});

describe("Song Sync Mode state", () => {
  it("starts with Auto on, no morph running and no request", () => {
    const state = useStore.getState();
    expect(state.songSyncAuto).toBe(true);
    expect(state.songSync).toBeNull();
    expect(state.songSyncRequestId).toBe(0);
  });

  it("counts SYNC presses, so two quick presses can't collide into no change", () => {
    useStore.getState().requestSongSync();
    useStore.getState().requestSongSync();
    expect(useStore.getState().songSyncRequestId).toBe(2);
  });

  it("switches Auto off and on", () => {
    useStore.getState().setSongSyncAuto(false);
    expect(useStore.getState().songSyncAuto).toBe(false);
    useStore.getState().setSongSyncAuto(true);
    expect(useStore.getState().songSyncAuto).toBe(true);
  });
});

describe("transition FX are off (Song Sync Mode)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no AI FX-pick request and leaves no pick standing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const tracks = [makeTrack("a"), makeTrack("b")];
    useStore.getState().playTrackList(tracks, 0);
    useStore.setState({
      aiFxPickId: "stale-pick",
      aiFxPickStartOffsetSec: 3,
      aiFxPickVolumeMultiplier: 0.5,
      aiFxPickReason: "old",
      aiFxPickLoading: true,
    });
    await useStore.getState().requestAiFxPick();
    expect(fetchSpy).not.toHaveBeenCalled();
    const state = useStore.getState();
    expect(state.aiFxPickId).toBeNull();
    expect(state.aiFxPickLoading).toBe(false);
  });
});

describe("addTrackToPlaylist while that playlist is playing", () => {
  const failingSave = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
  const okSave = () => vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

  function playing(shuffle = false) {
    const playlist = { id: "p1", name: "P", theme: null, tracks: [makeTrack("a"), makeTrack("c")] } as unknown as Playlist;
    useStore.setState({ playlists: [playlist, { id: "p2", name: "Other", theme: null, tracks: [] } as unknown as Playlist] });
    useStore.getState().playPlaylist(playlist, { shuffle });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("joins the live queue and asks for background analysis", () => {
    vi.stubGlobal("fetch", okSave());
    playing();
    const added = makeTrack("b");
    useStore.getState().addTrackToPlaylist("p1", added);
    const state = useStore.getState();
    expect(state.queue.some((t) => t.id === "b")).toBe(true);
    expect(state.analysisRequests.map((t) => t.id)).toEqual(["b"]);
    expect(state.playlists[0].tracks.map((t) => t.id)).toContain("b");
  });

  it("joins the shuffle pool, not the queue, in a shuffle", () => {
    vi.stubGlobal("fetch", okSave());
    playing(true);
    useStore.getState().addTrackToPlaylist("p1", makeTrack("b"));
    const state = useStore.getState();
    expect(state.shuffleSession!.pool.some((t) => t.id === "b")).toBe(true);
    expect(state.shuffleSession!.unplayedIds).toContain("b");
    expect(state.queue.some((t) => t.id === "b")).toBe(false);
  });

  it("leaves a Do-Not-Play track out of the live session", () => {
    vi.stubGlobal("fetch", okSave());
    playing();
    useStore.getState().addTrackToPlaylist("p1", makeTrack("b", "do-not"));
    expect(useStore.getState().queue.some((t) => t.id === "b")).toBe(false);
  });

  it("does not touch the live session when it is added to some other playlist", () => {
    vi.stubGlobal("fetch", okSave());
    playing();
    useStore.getState().addTrackToPlaylist("p2", makeTrack("b"));
    expect(useStore.getState().queue.some((t) => t.id === "b")).toBe(false);
  });

  it("undoes the playlist entry and the queue entry when the save fails", async () => {
    vi.stubGlobal("fetch", failingSave());
    playing();
    useStore.getState().addTrackToPlaylist("p1", makeTrack("b"));
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    const state = useStore.getState();
    expect(state.playlists[0].tracks.some((t) => t.id === "b")).toBe(false);
    expect(state.queue.some((t) => t.id === "b")).toBe(false);
  });

  it("keeps a copy of the track that was already queued when the save fails", async () => {
    vi.stubGlobal("fetch", failingSave());
    playing();
    const b = makeTrack("b");
    useStore.getState().enqueue(b); // queued by hand before it was added to the playlist
    useStore.getState().addTrackToPlaylist("p1", b);
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(useStore.getState().queue.filter((t) => t.id === "b")).toHaveLength(1);
  });
});

describe("transition sounds in the queue", () => {
  const sound = (n = 1): LocalTrack => ({
    ...makeTrack(`${TRANSITION_TRACK_PREFIX}riser:${n}`),
    source: "local",
  }) as LocalTrack;
  const song = (id: string) => makeTrack(id) as LocalTrack;
  const ids = () => useStore.getState().queue.map((t) => t.id);

  function playing() {
    useStore.setState({ currentTrack: song("a"), queue: [song("b"), song("c")], history: [] });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queueTransitionSound puts the sound first, with its analysis, and replaces an earlier one", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(1), fallbackAnalysis());
    useStore.getState().queueTransitionSound(sound(2), fallbackAnalysis());
    expect(ids()).toEqual([`${TRANSITION_TRACK_PREFIX}riser:2`, "b", "c"]);
    expect(useStore.getState().trackAnalysis[`${TRANSITION_TRACK_PREFIX}riser:2`]).toBeDefined();
  });

  it("dropQueuedTransitionSound takes the sound and its analysis out, but only while it is first in line", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(1), fallbackAnalysis());
    useStore.getState().dropQueuedTransitionSound("not-the-sound");
    expect(ids()).toHaveLength(3);
    useStore.getState().dropQueuedTransitionSound(`${TRANSITION_TRACK_PREFIX}riser:1`);
    expect(ids()).toEqual(["b", "c"]);
    expect(useStore.getState().trackAnalysis[`${TRANSITION_TRACK_PREFIX}riser:1`]).toBeUndefined();
    // gone already, or not first: nothing more happens
    useStore.getState().dropQueuedTransitionSound(`${TRANSITION_TRACK_PREFIX}riser:1`);
    expect(ids()).toEqual(["b", "c"]);
  });

  it("advanceQueue hands over to the queued sound (the engine's hand-over)", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().advanceQueue();
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe(`${TRANSITION_TRACK_PREFIX}riser:1`);
    expect(ids()).toEqual(["b", "c"]);
    expect(state.history.map((t) => t.id)).toEqual(["a"]);
  });

  it("next (the user's skip) passes over a queued sound to the next song", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().next();
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe("b");
    expect(ids()).toEqual(["c"]);
  });

  it("a sound that has played never enters the history, and Previous goes back to the song before it", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().advanceQueue(); // a -> sound
    useStore.getState().advanceQueue(); // sound -> b
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe("b");
    expect(state.history.map((t) => t.id)).toEqual(["a"]);
    useStore.getState().previous();
    expect(useStore.getState().currentTrack?.id).toBe("a");
    expect(useStore.getState().queue.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("Previous while the sound plays goes back to the song before it and does not put the sound back in the queue", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().advanceQueue(); // a -> sound
    useStore.getState().previous();
    const state = useStore.getState();
    expect(state.currentTrack?.id).toBe("a");
    expect(state.queue.some((t) => t.id.startsWith(TRANSITION_TRACK_PREFIX))).toBe(false);
    expect(state.queue.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("Previous drops a sound that is waiting first in line", () => {
    useStore.setState({ currentTrack: song("b"), queue: [song("c")], history: [song("a")] });
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().previous();
    expect(useStore.getState().queue.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("playing a new list while the sound plays leaves it out of the history", () => {
    playing();
    useStore.getState().queueTransitionSound(sound(), fallbackAnalysis());
    useStore.getState().advanceQueue();
    useStore.getState().playTrackList([song("x"), song("y")], 0);
    expect(useStore.getState().history.map((t) => t.id)).toEqual(["a"]);
  });

  it("setTrackAnalysis keeps the sound's analysis in memory but never saves it to the server", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    useStore.getState().setTrackAnalysis(`${TRANSITION_TRACK_PREFIX}riser:1`, fallbackAnalysis());
    expect(useStore.getState().trackAnalysis[`${TRANSITION_TRACK_PREFIX}riser:1`]).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    useStore.getState().setTrackAnalysis("real-song", fallbackAnalysis());
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("no AI pick is made for a sound, or over a change that is running through one", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    useStore.getState().startShuffle(Array.from({ length: 15 }, (_, i) => makeTrack(`t${i}`)));
    const base = useStore.getState();
    // the sound is playing
    useStore.setState({ currentTrack: sound(), queue: base.queue });
    await useStore.getState().requestAiNextPick();
    await useStore.getState().requestAiFxPick();
    // the sound is waiting first in line
    useStore.setState({ currentTrack: base.currentTrack, queue: [sound(), ...base.queue] });
    await useStore.getState().requestAiNextPick();
    await useStore.getState().requestAiFxPick();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
