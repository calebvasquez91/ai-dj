import { describe, expect, it, beforeEach } from "vitest";
import { useStore } from "./store";
import type { Track } from "@/types/music";

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
