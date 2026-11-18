import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playlistFindUnique: vi.fn(),
  playlistFindMany: vi.fn(),
  trackFindMany: vi.fn(),
  loadUserTrackData: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { playlist: { findUnique: mocks.playlistFindUnique, findMany: mocks.playlistFindMany }, track: { findMany: mocks.trackFindMany } },
}));
vi.mock("@/lib/storage", () => ({ getStorageBackend: () => "blob" }));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: mocks.loadUserTrackData }));

import { loadUserPlaylistsWithSpookyUnion } from "./playlistApi";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: "someone-else", // the library is shared: songs are not tied to the reader
  title: id,
  artist: "A",
  durationSec: 100,
  source: "local",
  storageKey: `https://x.public.blob.vercel-storage.com/${id}.mp3`,
  mimeType: "audio/mpeg",
  thumbnailUrl: null,
  playPreference: "must", // the old per-song copy: never read
  createdAt: new Date(0),
  hotCueOverridesJson: null,
  tagsJson: null,
  bpm: null,
  bpmSource: null,
  ...over,
});

beforeEach(() => {
  mocks.playlistFindUnique.mockReset().mockResolvedValue({ id: "sp", theme: "spooky" }); // the Spooky playlist already exists
  mocks.playlistFindMany.mockReset().mockResolvedValue([
    { id: "mine", name: "Mine", theme: null, createdAt: new Date(0), tracks: [{ track: row("t1") }] },
    { id: "sp", name: "Spooky Music", theme: "spooky", createdAt: new Date(1), tracks: [{ track: row("t2", { tagsJson: '["halloween"]' }) }] },
  ]);
  mocks.trackFindMany.mockReset().mockResolvedValue([
    row("t2", { tagsJson: '["halloween"]' }), // already in the playlist by hand
    row("t3", { tagsJson: '["Spooky"]' }), // somebody else's upload, tagged spooky
    row("t4", { tagsJson: '["rock"]' }), // tagged, but not spooky
  ]);
  mocks.loadUserTrackData.mockReset().mockResolvedValue(new Map([["t1", { playPreference: "do-not" }]]));
});

describe("loadUserPlaylistsWithSpookyUnion on a shared library", () => {
  it("reads spooky-tagged songs from the whole library, not only the reader's own", async () => {
    await loadUserPlaylistsWithSpookyUnion("reader");
    expect(mocks.trackFindMany.mock.calls[0][0].where).toEqual({ source: "local", tagsJson: { not: null } });
  });

  it("adds each spooky-tagged song the playlist does not hold, and lists those as automatic", async () => {
    const [, spooky] = await loadUserPlaylistsWithSpookyUnion("reader");
    expect(spooky.tracks.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(spooky.autoIncludedTrackIds).toEqual(["t3"]);
  });

  it("shows the reader's own marks on songs, never the old shared column", async () => {
    const [mine, spooky] = await loadUserPlaylistsWithSpookyUnion("reader");
    expect(mine.tracks[0].playPreference).toBe("do-not");
    expect(spooky.tracks.every((t) => t.playPreference === undefined)).toBe(true);
  });
});
