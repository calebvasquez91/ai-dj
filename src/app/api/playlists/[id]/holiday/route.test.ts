import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "u-owner", findPlaylist: vi.fn(), setHoliday: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => (mocks.user ? { user: { id: mocks.user } } : null)) }));
vi.mock("@/lib/prisma", () => ({ prisma: { playlist: { findUnique: mocks.findPlaylist } } }));
vi.mock("@/lib/playlistHolidayServer", () => ({ setPlaylistHoliday: mocks.setHoliday }));
vi.mock("@/lib/playlistImageServer", () => ({ isMissingTable: (e: unknown) => (e as { code?: string })?.code === "P2021" }));

import { PUT } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const put = (body: unknown) => PUT(new Request("http://x/api/playlists/p1/holiday", { method: "PUT", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-owner";
  mocks.findPlaylist.mockReset().mockResolvedValue({ userId: "u-owner", theme: null });
  mocks.setHoliday.mockReset().mockResolvedValue(undefined);
});

describe("PUT /api/playlists/[id]/holiday", () => {
  it("lets the owner set a holiday theme, and clear it", async () => {
    expect((await put({ holiday: "christmas" })).status).toBe(200);
    expect(mocks.setHoliday).toHaveBeenLastCalledWith("p1", "christmas");
    expect((await put({ holiday: null })).status).toBe(200);
    expect(mocks.setHoliday).toHaveBeenLastCalledWith("p1", null);
  });
  it("lets the admin do it on anyone's playlist", async () => {
    mocks.user = "u-admin";
    expect((await put({ holiday: "diwali" })).status).toBe(200);
  });
  it("is a 404 for another account's playlist and a 401 when signed out", async () => {
    mocks.user = "u-other";
    expect((await put({ holiday: "easter" })).status).toBe(404);
    mocks.user = "";
    expect((await put({ holiday: "easter" })).status).toBe(401);
    expect(mocks.setHoliday).not.toHaveBeenCalled();
  });
  it("never gives a system playlist (Spooky Music) a holiday theme", async () => {
    mocks.findPlaylist.mockResolvedValue({ userId: "u-owner", theme: "spooky" });
    expect((await put({ holiday: "christmas" })).status).toBe(400);
    expect(mocks.setHoliday).not.toHaveBeenCalled();
  });
  it("refuses anything that is not one of the ten themes, Halloween included", async () => {
    for (const holiday of ["halloween", "spooky", "", 5, undefined]) expect((await put({ holiday })).status, String(holiday)).toBe(400);
    expect(mocks.setHoliday).not.toHaveBeenCalled();
  });
  it("says so plainly (503) when the table is not there yet", async () => {
    mocks.setHoliday.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await put({ holiday: "christmas" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not set up/);
  });
});
