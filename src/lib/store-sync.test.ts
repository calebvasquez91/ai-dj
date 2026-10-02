// Optimistic store mutations must roll back (and tell the user) when the
// server rejects the background save — see src/lib/syncRequest.ts. Before this
// they were `void fetch(...)` calls that never looked at the response.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import type { Track } from "@/types/music";

function makeTrack(id: string): Track {
  return { id, title: id, artist: "Test Artist", durationSec: 200, addedAt: 0, source: "local", sourceUrl: `blob:${id}` };
}

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchStatus(status: number, body: unknown = null) {
  const fn = vi.fn(async () => (body === null ? new Response(null, { status }) : Response.json(body, { status })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ids = () => useStore.getState().playlists[0].tracks.map((t) => t.id);

function seedPlaylist(trackIds: string[]) {
  const tracks = trackIds.map(makeTrack);
  useStore.setState({ localLibrary: tracks, playlists: [{ id: "pl1", name: "Mix", createdAt: 0, tracks }] });
}

describe("optimistic playlist mutations", () => {
  it("addTrackToPlaylist keeps the track when the server accepts it", async () => {
    const f = stubFetchStatus(201, { id: "pl1" });
    seedPlaylist(["a"]);
    useStore.getState().addTrackToPlaylist("pl1", makeTrack("b"));
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(ids()).toEqual(["a", "b"]);
    expect(useStore.getState().syncError).toBeNull();
  });

  it("addTrackToPlaylist rolls back and reports when the server rejects it", async () => {
    stubFetchStatus(404, { error: "Track not found." });
    seedPlaylist(["a"]);
    useStore.getState().addTrackToPlaylist("pl1", makeTrack("b"));
    expect(ids()).toEqual(["a", "b"]); // optimistic
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(ids()).toEqual(["a"]);
    expect(useStore.getState().syncError).toMatch(/Track not found/);
  });

  it("addTrackToPlaylist does not remove a track that was already there when the request fails", async () => {
    stubFetchStatus(500);
    seedPlaylist(["a", "b"]);
    useStore.getState().addTrackToPlaylist("pl1", makeTrack("b"));
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(ids()).toEqual(["a", "b"]);
  });

  it("removeTrackFromPlaylist puts the track back at its old position on failure", async () => {
    stubFetchStatus(500);
    seedPlaylist(["a", "b", "c"]);
    useStore.getState().removeTrackFromPlaylist("pl1", "b");
    expect(ids()).toEqual(["a", "c"]);
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("removeTrackFromPlaylist treats a 404 as already-removed (no rollback, no error)", async () => {
    const f = stubFetchStatus(404);
    seedPlaylist(["a", "b"]);
    useStore.getState().removeTrackFromPlaylist("pl1", "b");
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(ids()).toEqual(["a"]);
    expect(useStore.getState().syncError).toBeNull();
  });

  it("moveTrackInPlaylist restores the previous order on failure", async () => {
    stubFetchStatus(409, { error: "The playlist changed — reload it and try again." });
    seedPlaylist(["a", "b", "c"]);
    useStore.getState().moveTrackInPlaylist("pl1", 0, "down");
    expect(ids()).toEqual(["b", "a", "c"]);
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("removePlaylist re-inserts the playlist at its old index on failure", async () => {
    stubFetchStatus(500);
    useStore.setState({
      playlists: [
        { id: "p0", name: "Zero", createdAt: 0, tracks: [] },
        { id: "p1", name: "One", createdAt: 0, tracks: [makeTrack("a")] },
        { id: "p2", name: "Two", createdAt: 0, tracks: [] },
      ],
    });
    useStore.getState().removePlaylist("p1");
    expect(useStore.getState().playlists.map((p) => p.id)).toEqual(["p0", "p2"]);
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(useStore.getState().playlists.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
    expect(useStore.getState().playlists[1].tracks).toHaveLength(1);
  });

  it("createPlaylist throws and reports instead of pushing an error body into state", async () => {
    stubFetchStatus(401, { error: "Not signed in." });
    await expect(useStore.getState().createPlaylist()).rejects.toThrow();
    expect(useStore.getState().playlists).toEqual([]);
    expect(useStore.getState().syncError).toMatch(/Not signed in/);
  });

  it("createPlaylist appends the new playlist on success", async () => {
    stubFetchStatus(201, { id: "new1", name: "New Playlist", createdAt: 1, tracks: [] });
    await expect(useStore.getState().createPlaylist()).resolves.toBe("new1");
    expect(useStore.getState().playlists.map((p) => p.id)).toEqual(["new1"]);
  });
});

describe("optimistic track-curation mutations", () => {
  it("setTrackPlayPreference reverts on failure", async () => {
    stubFetchStatus(500);
    useStore.setState({ localLibrary: [makeTrack("a")] });
    useStore.getState().setTrackPlayPreference("a", "must");
    expect(useStore.getState().localLibrary[0].playPreference).toBe("must");
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(useStore.getState().localLibrary[0].playPreference).toBeUndefined();
  });

  it("an older failed request does not clobber a newer change", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) {
          await new Promise((r) => setTimeout(r, 20)); // the first (older) request fails late
          return new Response(null, { status: 500 });
        }
        return new Response(null, { status: 200 });
      })
    );
    useStore.setState({ localLibrary: [makeTrack("a")] });
    useStore.getState().setTrackPlayPreference("a", "must");
    useStore.getState().setTrackPlayPreference("a", "do-not");
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(useStore.getState().localLibrary[0].playPreference).toBe("do-not");
  });

  it("setTrackTags reverts on failure and keeps them on success", async () => {
    stubFetchStatus(500);
    useStore.setState({ localLibrary: [{ ...makeTrack("a"), tags: ["old"] }] });
    useStore.getState().setTrackTags("a", ["new"]);
    expect(useStore.getState().localLibrary[0].tags).toEqual(["new"]);
    await vi.waitFor(() => expect(useStore.getState().syncError).not.toBeNull());
    expect(useStore.getState().localLibrary[0].tags).toEqual(["old"]);

    useStore.setState({ syncError: null });
    stubFetchStatus(200, {});
    useStore.getState().setTrackTags("a", ["kept"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(useStore.getState().localLibrary[0].tags).toEqual(["kept"]);
    expect(useStore.getState().syncError).toBeNull();
  });

  it("a network failure is a rollback, not an unhandled rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    useStore.setState({ localLibrary: [makeTrack("a")] });
    useStore.getState().setTrackPlayPreference("a", "must");
    await vi.waitFor(() => expect(useStore.getState().syncError).toMatch(/connection/i));
    expect(useStore.getState().localLibrary[0].playPreference).toBeUndefined();
  });
});

describe("removeLocalTrack", () => {
  it("keeps the track and reports when the server refuses", async () => {
    stubFetchStatus(500);
    useStore.setState({ localLibrary: [makeTrack("a")] });
    await useStore.getState().removeLocalTrack("a");
    expect(useStore.getState().localLibrary).toHaveLength(1);
    expect(useStore.getState().syncError).not.toBeNull();
  });

  it("removes the track when the server says 404 (already gone)", async () => {
    stubFetchStatus(404);
    useStore.setState({ localLibrary: [makeTrack("a")] });
    await useStore.getState().removeLocalTrack("a");
    expect(useStore.getState().localLibrary).toHaveLength(0);
  });
});
