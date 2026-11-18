import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { trackUserData: { findMany: mocks.findMany, findUnique: mocks.findUnique, upsert: mocks.upsert, deleteMany: mocks.deleteMany } },
}));

import { isMissingTrackUserDataTable, loadOneUserTrackData, loadUserTrackData, saveUserTrackData } from "./trackUserData";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isMissingTrackUserDataTable", () => {
  it("recognizes only the table-not-there error", () => {
    expect(isMissingTrackUserDataTable({ code: "P2021" })).toBe(true);
    expect(isMissingTrackUserDataTable(new Error("The table `public.TrackUserData` does not exist in the current database."))).toBe(true);
    expect(isMissingTrackUserDataTable(new Error('relation "TrackUserData" does not exist'))).toBe(true);
  });
  it("is false for a timeout, a lost connection, another table, or a non-error", () => {
    expect(isMissingTrackUserDataTable(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isMissingTrackUserDataTable({ code: "P1001", message: "Can't reach database server" })).toBe(false);
    expect(isMissingTrackUserDataTable(new Error('relation "Playlist" does not exist'))).toBe(false);
    expect(isMissingTrackUserDataTable(null)).toBe(false);
    expect(isMissingTrackUserDataTable("boom")).toBe(false);
  });
});

describe("loadUserTrackData", () => {
  it("maps each song to the person's own values", async () => {
    mocks.findMany.mockResolvedValue([{ trackId: "t1", playPreference: "do-not", hotCueOverridesJson: null }]);
    const map = await loadUserTrackData("u1");
    expect(map.get("t1")).toEqual({ playPreference: "do-not", hotCueOverridesJson: null });
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("answers 'no marks' only while the table is not set up", async () => {
    mocks.findMany.mockRejectedValue({ code: "P2021" });
    expect((await loadUserTrackData("u1")).size).toBe(0);
  });

  it("lets any other failure through instead of silently dropping everybody's Do-Not-Play marks", async () => {
    mocks.findMany.mockRejectedValue(new Error("Connection terminated unexpectedly"));
    await expect(loadUserTrackData("u1")).rejects.toThrow("Connection terminated");
  });
});

describe("loadOneUserTrackData", () => {
  it("reads just the one row, by the person and song", async () => {
    mocks.findUnique.mockResolvedValue({ playPreference: "must", hotCueOverridesJson: '{"1":2}' });
    expect(await loadOneUserTrackData("u1", "t1")).toEqual({ playPreference: "must", hotCueOverridesJson: '{"1":2}' });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { userId_trackId: { userId: "u1", trackId: "t1" } } });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("is undefined when nothing is set, and lets real failures through", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    expect(await loadOneUserTrackData("u1", "t1")).toBeUndefined();
    mocks.findUnique.mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    await expect(loadOneUserTrackData("u1", "t1")).rejects.toThrow();
  });
});

describe("saveUserTrackData", () => {
  it("stores only what was sent and returns the person's values", async () => {
    mocks.upsert.mockResolvedValue({ playPreference: "do-not", hotCueOverridesJson: null });
    const out = await saveUserTrackData("u1", "t1", { playPreference: "do-not" });
    expect(out).toEqual({ playPreference: "do-not", hotCueOverridesJson: null });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId_trackId: { userId: "u1", trackId: "t1" } },
      create: { userId: "u1", trackId: "t1", playPreference: "do-not" },
      update: { playPreference: "do-not" },
    });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("removes the row when clearing leaves nothing in it, instead of keeping an empty one", async () => {
    mocks.upsert.mockResolvedValue({ playPreference: null, hotCueOverridesJson: null });
    expect(await saveUserTrackData("u1", "t1", { playPreference: null })).toEqual({});
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", trackId: "t1", playPreference: null, hotCueOverridesJson: null } });
  });

  it("keeps the row when the other value is still set", async () => {
    mocks.upsert.mockResolvedValue({ playPreference: null, hotCueOverridesJson: '{"1":3}' });
    expect(await saveUserTrackData("u1", "t1", { playPreference: null })).toEqual({ playPreference: null, hotCueOverridesJson: '{"1":3}' });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
