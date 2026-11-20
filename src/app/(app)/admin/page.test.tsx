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
vi.mock("@/lib/adminOverview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adminOverview")>()),
  loadAdminOverview: mocks.load,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AdminPage from "./page";

beforeEach(() => {
  mocks.owner = null;
  mocks.load.mockReset().mockResolvedValue({ feedbackCount: 1, songs: 3038, classified: 1715, needsReview: 1225, playlists: 8, listenedSeconds: 7200 });
  mocks.notFound.mockClear();
});

describe("the Admin page", () => {
  it("shows a 404 to anyone who isn't the admin, and reads nothing first", async () => {
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("links the admin to every admin screen, each with its number", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    const html = renderToStaticMarkup(await AdminPage());
    for (const href of ["/admin/feedback", "/admin/genres", "/library?view=review", "/admin/stats", "/admin/playlists", "/admin/music", "/library"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).toContain("1 message");
    expect(html).toContain("1,715 of 3,038 songs have a genre");
    expect(html).toContain("1,225 waiting for a decision");
    expect(html).toContain("3,038 songs");
    expect(html).toContain("2 h played");
    expect(html).toContain("8 playlists");
  });

  it("shows a dash for a number that could not be read, and still opens", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    mocks.load.mockResolvedValue({ feedbackCount: null, songs: null, classified: null, needsReview: null, playlists: null, listenedSeconds: null });
    const html = renderToStaticMarkup(await AdminPage());
    expect(html).toContain("—");
    expect(html).toContain("Not recording yet");
    expect(html).toContain("Admin");
  });

  it("does not call a database error \"not recording yet\" (that would send the admin to rerun SQL that already ran)", async () => {
    mocks.owner = { user: { id: "cmadmin0001" } };
    mocks.load.mockResolvedValue({ feedbackCount: 1, songs: 10, classified: 5, needsReview: 1, playlists: 2, listenedSeconds: "error" });
    expect(renderToStaticMarkup(await AdminPage())).not.toContain("Not recording yet");
  });
});
