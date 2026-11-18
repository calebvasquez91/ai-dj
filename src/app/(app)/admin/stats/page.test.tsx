import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  owner: null as object | null,
  load: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => mocks.owner) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/playStatsServer", () => ({ loadPlayStats: mocks.load }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import ListeningStatsPage from "./page";

const report = {
  totalSeconds: 3 * 3600 + 1800,
  outsidePlaylistSeconds: 600,
  accounts: [{ id: "u1", key: "u1", label: "Test Account (test@test.com)", seconds: 3 * 3600 }],
  genres: [{ key: "Hip-Hop", label: "Hip-Hop", seconds: 7200 }],
  playlists: [{ key: "p1", label: "Party Essentials", sub: "Test Account (test@test.com)", seconds: 5400 }],
  songs: [{ key: "t1", label: "California Love", sub: "2Pac", seconds: 1800 }],
};

beforeEach(() => {
  mocks.owner = null;
  mocks.load.mockReset().mockResolvedValue({ ok: true, report });
  mocks.notFound.mockClear();
});

const render = async (search: Record<string, string> = {}) => renderToStaticMarkup(await ListeningStatsPage({ searchParams: Promise.resolve(search) }));

describe("the Listening page", () => {
  it("shows a 404 to anyone who isn't the admin, and reads nothing first", async () => {
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("shows the hours, by account, genre, playlist and song", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    const html = await render();
    expect(html).toContain("3 h 30 min");
    expect(html).toContain("Test Account (test@test.com)");
    expect(html).toContain("Hip-Hop");
    expect(html).toContain("Party Essentials");
    expect(html).toContain("California Love");
    expect(html).toContain("1 h 30 min");
  });

  it("asks for the period and account in the address, and ignores a bad period", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    await render({ days: "7", account: "u1" });
    expect(mocks.load).toHaveBeenLastCalledWith({ days: 7, accountId: "u1" });
    await render({ days: "999" });
    expect(mocks.load).toHaveBeenLastCalledWith({ days: null, accountId: null });
  });

  it("tells the admin how to create the table when it is not there yet", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    mocks.load.mockResolvedValue({ ok: false, reason: "no-table" });
    expect(await render()).toContain("prisma/play-stats.sql");
  });
});
