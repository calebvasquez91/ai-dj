import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  owner: null as object | null,
  playlists: vi.fn(),
  playlistOne: vi.fn(),
  groupBy: vi.fn(),
  aggregate: vi.fn(),
  actions: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => mocks.owner) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    playlist: { findMany: mocks.playlists, findUnique: mocks.playlistOne },
    playEvent: { groupBy: mocks.groupBy, aggregate: mocks.aggregate },
    adminAction: { findMany: mocks.actions },
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AllPlaylistsPage from "./page";
import AdminPlaylistPage from "./[id]/page";

const owner = { id: "u1", email: "test@test.com", name: "Test Account" };

beforeEach(() => {
  mocks.owner = null;
  mocks.notFound.mockClear();
  mocks.playlists.mockReset().mockResolvedValue([
    { id: "p1", name: "Workout", theme: null, user: owner, tracks: [{ track: { durationSec: 180 } }, { track: { durationSec: 120 } }] },
  ]);
  mocks.playlistOne.mockReset().mockResolvedValue({
    id: "p1",
    name: "Workout",
    theme: null,
    user: owner,
    tracks: [{ track: { id: "t1", title: "Song", artist: "Artist", durationSec: 185 } }],
  });
  mocks.groupBy.mockReset().mockResolvedValue([{ playlistId: "p1", _sum: { seconds: 5400 } }]);
  mocks.aggregate.mockReset().mockResolvedValue({ _sum: { seconds: 5400 } });
  mocks.actions.mockReset().mockResolvedValue([
    { id: "a1", action: "playlist.rename", playlistName: "Workout", ownerEmail: "test@test.com", detail: "Mine -> Workout", createdAt: new Date("2026-11-18T10:30:00Z") },
  ]);
});

describe("the All playlists pages' gate", () => {
  it("shows a 404 to anyone who isn't the admin, on both pages, and reads nothing first", async () => {
    await expect(AllPlaylistsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminPlaylistPage({ params: Promise.resolve({ id: "p1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.playlists).not.toHaveBeenCalled();
    expect(mocks.playlistOne).not.toHaveBeenCalled();
  });
});

describe("the All playlists page", () => {
  it("lists every account's playlists with their size, length and playtime, and the recent admin changes", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    const html = renderToStaticMarkup(await AllPlaylistsPage());
    expect(html).toContain("Test Account (test@test.com)");
    expect(html).toContain("Workout");
    expect(html).toContain("2 songs");
    expect(html).toContain("5 min long");
    expect(html).toContain("played 1 h 30 min");
    expect(html).toContain('href="/admin/playlists/p1"');
    expect(html).toContain("Recent admin changes");
    expect(html).toContain("renamed");
  });

  it("still opens when the listening and log tables do not exist yet", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    mocks.groupBy.mockRejectedValue({ code: "P2021" });
    mocks.actions.mockRejectedValue({ code: "P2021" });
    const html = renderToStaticMarkup(await AllPlaylistsPage());
    expect(html).toContain("Workout");
    expect(html).not.toContain("Recent admin changes");
  });
});

describe("one playlist's page", () => {
  it("shows the songs in order, the owner, and the total playtime", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    const html = renderToStaticMarkup(await AdminPlaylistPage({ params: Promise.resolve({ id: "p1" }) }));
    expect(html).toContain("Workout");
    expect(html).toContain("Test Account (test@test.com)");
    expect(html).toContain("Song");
    expect(html).toContain("3:05");
    expect(html).toContain("played 1 h 30 min in total");
  });

  it("is a 404 for a playlist that does not exist", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    mocks.playlistOne.mockResolvedValue(null);
    await expect(AdminPlaylistPage({ params: Promise.resolve({ id: "gone" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
