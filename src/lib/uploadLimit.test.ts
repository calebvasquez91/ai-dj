import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackCount: vi.fn(), fxCount: vi.fn(), findUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { track: { count: mocks.trackCount }, fxSound: { count: mocks.fxCount }, user: { findUnique: mocks.findUser } },
}));

import {
  DEFAULT_ESTABLISHED_UPLOADS_PER_DAY,
  DEFAULT_UPLOADS_PER_DAY,
  ESTABLISHED_ACCOUNT_MS,
  parseEstablishedCap,
  parseUploadCap,
  uploadAllowance,
  uploadCapFor,
  UPLOAD_WINDOW_MS,
} from "./uploadLimit";
import { uploadLimitResponse } from "./uploadGuard";

const DAY = 24 * 60 * 60 * 1000;

describe("parseUploadCap and parseEstablishedCap", () => {
  it("read a whole number of files and fall back to the default for anything else", () => {
    expect(parseUploadCap("50")).toBe(50);
    expect(parseEstablishedCap("800")).toBe(800);
    for (const bad of [undefined, null, "", "  ", "0", "-3", "2.5", "lots", "NaN"]) {
      expect(parseUploadCap(bad as string | null | undefined), String(bad)).toBe(DEFAULT_UPLOADS_PER_DAY);
      expect(parseEstablishedCap(bad as string | null | undefined), String(bad)).toBe(DEFAULT_ESTABLISHED_UPLOADS_PER_DAY);
    }
  });
});

describe("uploadCapFor", () => {
  it("holds a new account (less than a week old, or one we cannot find) to the tight limit", () => {
    expect(uploadCapFor(0, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
    expect(uploadCapFor(ESTABLISHED_ACCOUNT_MS - 1, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
    expect(uploadCapFor(null, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
  });
  it("gives an established account a much higher one, so importing a whole library is not blocked", () => {
    expect(uploadCapFor(ESTABLISHED_ACCOUNT_MS, {})).toBe(DEFAULT_ESTABLISHED_UPLOADS_PER_DAY);
    expect(uploadCapFor(90 * DAY, { MAX_UPLOADS_PER_DAY_ESTABLISHED: "9000" })).toBe(9000);
  });
  it("never gives an established account less than a new one", () => {
    expect(uploadCapFor(90 * DAY, { MAX_UPLOADS_PER_DAY: "10000", MAX_UPLOADS_PER_DAY_ESTABLISHED: "500" })).toBe(10000);
  });
});

describe("uploadAllowance", () => {
  it("allows until the cap is reached, then says how many are left", () => {
    expect(uploadAllowance(0, 10)).toEqual({ allowed: true, remaining: 10 });
    expect(uploadAllowance(9, 10)).toEqual({ allowed: true, remaining: 1 });
    expect(uploadAllowance(10, 10)).toEqual({ allowed: false, remaining: 0 });
    expect(uploadAllowance(400, 10)).toEqual({ allowed: false, remaining: 0 });
  });
});

describe("uploadLimitResponse", () => {
  const now = Date.UTC(2026, 10, 18, 12);

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_USER_IDS", "u-admin");
    vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
    vi.stubEnv("MAX_UPLOADS_PER_DAY", "5");
    vi.stubEnv("MAX_UPLOADS_PER_DAY_ESTABLISHED", "50");
    mocks.trackCount.mockReset().mockResolvedValue(0);
    mocks.fxCount.mockReset().mockResolvedValue(0);
    mocks.findUser.mockReset().mockResolvedValue({ createdAt: new Date(now - 1 * DAY) }); // a new account
  });

  it("lets an account under the cap add a file", async () => {
    mocks.trackCount.mockResolvedValue(2);
    mocks.fxCount.mockResolvedValue(2);
    expect(await uploadLimitResponse("u1", now)).toBeNull();
  });

  it("answers 429 once songs and FX sounds together reach a new account's cap", async () => {
    mocks.trackCount.mockResolvedValue(3);
    mocks.fxCount.mockResolvedValue(2);
    const res = await uploadLimitResponse("u1", now);
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/5 files per 24 hours/);
  });

  it("judges an established account by the higher cap, so a whole library added to it the day before does not lock it out", async () => {
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now - 90 * DAY) });
    mocks.trackCount.mockResolvedValue(2141); // far over the new-account limit of 5
    expect((await uploadLimitResponse("u1", now))?.status).toBe(429); // over the established cap of 50 as well
    vi.stubEnv("MAX_UPLOADS_PER_DAY_ESTABLISHED", "5000");
    expect(await uploadLimitResponse("u1", now)).toBeNull(); // under 5,000: allowed
  });

  it("holds an account we cannot find to the tight limit", async () => {
    mocks.findUser.mockResolvedValue(null);
    mocks.trackCount.mockResolvedValue(5);
    expect((await uploadLimitResponse("ghost", now))?.status).toBe(429);
  });

  it("counts only the last 24 hours, for this account", async () => {
    await uploadLimitResponse("u1", now);
    const where = mocks.trackCount.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.createdAt.gte.getTime()).toBe(now - UPLOAD_WINDOW_MS);
    expect(mocks.fxCount.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("never limits the admin (and does not even count)", async () => {
    mocks.trackCount.mockResolvedValue(9999);
    expect(await uploadLimitResponse("u-admin", now)).toBeNull();
    expect(mocks.trackCount).not.toHaveBeenCalled();
  });
});
