import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/featureFlags", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/featureFlags")>()), SEED_RADIO_ENABLED: true }));

import { useStore } from "./store";
import { RADIO_MAX_ARTIST_RUN, RADIO_MIN_AHEAD } from "./radio";
import type { Track } from "@/types/music";

let n = 0;
const song = (over: Partial<Track> = {}): Track =>
  ({
    id: `t${++n}`,
    title: `Song ${n}`,
    artist: `artist ${n % 25}`,
    durationSec: 200,
    addedAt: 0,
    source: "local",
    sourceUrl: `x/${n}`,
    genre: "Pop",
    subgenres: ["Dance Pop"],
    moods: ["summer"],
    ...over,
  }) as Track;

const initial = useStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  useStore.setState(initial, true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ artists: ["artist 3"] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("seed radio in the store (SEED_RADIO_ENABLED on)", () => {
  const library = Array.from({ length: 80 }, () => song());

  it("playing one song on its own starts a radio: it plays, and songs that go with it queue behind", async () => {
    useStore.setState({ localLibrary: library });
    useStore.getState().playTrackList([library[0]], 0);
    await flush();
    const s = useStore.getState();
    expect(s.currentTrack?.id).toBe(library[0].id);
    expect(s.radioSession?.seedId).toBe(library[0].id);
    expect(s.queue.length).toBeGreaterThanOrEqual(RADIO_MIN_AHEAD);
    expect(s.queue.some((t) => t.id === library[0].id)).toBe(false);
    expect(new Set(s.queue.map((t) => t.id)).size).toBe(s.queue.length);
  });

  it("does not start one for a list of songs or a playlist", async () => {
    useStore.setState({ localLibrary: library });
    useStore.getState().playTrackList(library.slice(0, 5), 0);
    await flush();
    expect(useStore.getState().radioSession).toBeNull();
    useStore.getState().playTrackList([library[0]], 0, null, "playlist-1");
    await flush();
    expect(useStore.getState().radioSession).toBeNull();
  });

  it("keeps at least ten songs ahead as it plays, never repeats a song, and never plays an artist more than twice in a row", async () => {
    useStore.setState({ localLibrary: library });
    useStore.getState().startRadio(library[0]);
    await flush();
    const played: Track[] = [library[0]];
    for (let i = 0; i < 40; i++) {
      useStore.getState().next();
      const s = useStore.getState();
      if (!s.currentTrack) break;
      played.push(s.currentTrack);
      expect(s.queue.length, `after ${i + 1} songs`).toBeGreaterThanOrEqual(RADIO_MIN_AHEAD);
    }
    expect(played.length).toBeGreaterThan(30);
    expect(new Set(played.map((t) => t.id)).size).toBe(played.length); // no repeat
    let run = 1;
    for (let i = 1; i < played.length; i++) {
      run = played[i].artist === played[i - 1].artist ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(RADIO_MAX_ARTIST_RUN);
    }
  });

  it("a song the person plays by hand afterwards ends the radio", async () => {
    useStore.setState({ localLibrary: library });
    useStore.getState().startRadio(library[0]);
    await flush();
    expect(useStore.getState().radioSession).not.toBeNull();
    useStore.getState().playTrackList(library.slice(10, 14), 0);
    expect(useStore.getState().radioSession).toBeNull();
  });

  it("never queues a Do-Not-Play or Halloween song", async () => {
    const bad = [song({ id: "dn", playPreference: "do-not" }), song({ id: "sp", tags: ["halloween"] })];
    useStore.setState({ localLibrary: [...library, ...bad] });
    useStore.getState().startRadio(library[0]);
    await flush();
    const ids = useStore.getState().queue.map((t) => t.id);
    expect(ids).not.toContain("dn");
    expect(ids).not.toContain("sp");
  });

  it("with too few matches it says so and leaves the queue short, with artists to look for", async () => {
    const few = [library[0], ...library.slice(1, 4), ...Array.from({ length: 30 }, () => song({ genre: "Country", subgenres: [], moods: ["sleep"] }))];
    useStore.setState({ localLibrary: few });
    useStore.getState().startRadio(few[0]);
    await flush();
    const s = useStore.getState();
    expect(s.radioNotice?.seedId).toBe(few[0].id);
    expect(s.radioNotice?.discover).toEqual(["artist 3"]);
    expect(s.queue.every((t) => t.genre === "Pop")).toBe(true);
  });
});
