import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackCount: vi.fn(), fxCount: vi.fn(), findUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { track: { count: mocks.trackCount }, fxSound: { count: mocks.fxCount }, user: { findUnique: mocks.findUser } },
}));

import {
  DEFAULT_ESTABLISHED_UPLOADS_PER_DAY,
  DEFAULT_UPLOADS_PER_DAY,
  ESTABLISHED_ACCOUNT_MS,
  ESTABLISHED_MIN_FILES,
  newAccountCap,
  parseCap,
  uploadAllowance,
  uploadCapFor,
  UPLOAD_WINDOW_MS,
} from "./uploadLimit";
import { uploadLimitResponse } from "./uploadGuard";

const DAY = 24 * 60 * 60 * 1000;

describe("parseCap and newAccountCap", () => {
  it("read a whole number of files and fall back for anything else", () => {
    expect(parseCap("50", 7)).toBe(50);
    expect(newAccountCap({ MAX_UPLOADS_PER_DAY: "40" })).toBe(40);
    for (const bad of [undefined, null, "", "  ", "0", "-3", "2.5", "lots", "NaN"]) {
      expect(parseCap(bad as string | null | undefined, 7), String(bad)).toBe(7);
      expect(newAccountCap({ MAX_UPLOADS_PER_DAY: bad as string | undefined }), String(bad)).toBe(DEFAULT_UPLOADS_PER_DAY);
    }
  });
});

describe("uploadCapFor", () => {
  const library = ESTABLISHED_MIN_FILES; // enough files from before today
  it("holds a new account (less than a week old, or one we cannot find) to the tight limit", () => {
    expect(uploadCapFor(0, library, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
    expect(uploadCapFor(ESTABLISHED_ACCOUNT_MS - 1, library, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
    expect(uploadCapFor(null, library, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
  });
  it("holds an old account with no library of its own to the tight limit too (age alone is not trust: anyone can sign up and wait)", () => {
    expect(uploadCapFor(90 * DAY, 0, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
    expect(uploadCapFor(90 * DAY, ESTABLISHED_MIN_FILES - 1, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
  });
  it("gives an account that is a week old and already has a library a much higher limit", () => {
    expect(uploadCapFor(ESTABLISHED_ACCOUNT_MS, library, {})).toBe(DEFAULT_ESTABLISHED_UPLOADS_PER_DAY);
    expect(uploadCapFor(90 * DAY, library, { MAX_UPLOADS_PER_DAY_ESTABLISHED: "9000" })).toBe(9000);
  });
  it("never gives an established account less than a new one", () => {
    expect(uploadCapFor(90 * DAY, library, { MAX_UPLOADS_PER_DAY: "10000", MAX_UPLOADS_PER_DAY_ESTABLISHED: "500" })).toBe(10000);
  });
  it("treats an account created in the future (clock skew) as new", () => {
    expect(uploadCapFor(-5 * DAY, library, {})).toBe(DEFAULT_UPLOADS_PER_DAY);
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
  const cutoff = now - UPLOAD_WINDOW_MS;

  /** What the account added in the last 24 hours (`recent`) and what it had before that (`older`), songs only. */
  function setFiles({ recent, older = 0, fxRecent = 0 }: { recent: number; older?: number; fxRecent?: number }) {
    mocks.trackCount.mockImplementation(async ({ where }: { where: { createdAt: { gte?: Date; lt?: Date } } }) => (where.createdAt.lt ? older : recent));
    mocks.fxCount.mockImplementation(async ({ where }: { where: { createdAt: { gte?: Date; lt?: Date } } }) => (where.createdAt.lt ? 0 : fxRecent));
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_USER_IDS", "u-admin");
    vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
    vi.stubEnv("MAX_UPLOADS_PER_DAY", "5");
    vi.stubEnv("MAX_UPLOADS_PER_DAY_ESTABLISHED", "50000");
    mocks.trackCount.mockReset();
    mocks.fxCount.mockReset();
    setFiles({ recent: 0 });
    mocks.findUser.mockReset().mockResolvedValue({ createdAt: new Date(now - 1 * DAY) }); // a new account
  });

  it("lets an account under the cap add a file, without looking the account up", async () => {
    setFiles({ recent: 2, fxRecent: 2 });
    expect(await uploadLimitResponse("u1", now)).toBeNull();
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.trackCount).toHaveBeenCalledTimes(1); // only the last-24-hours count was needed
  });

  it("answers 429 once songs and FX sounds together reach a new account's cap", async () => {
    setFiles({ recent: 3, fxRecent: 2 });
    const res = await uploadLimitResponse("u1", now);
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/5 files per 24 hours/);
  });

  it("judges an established account (a week old, with a library from before today) by the higher cap", async () => {
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now - 90 * DAY) });
    setFiles({ recent: 2141, older: 900 }); // e.g. a whole library added the day before: far over the new-account limit of 5
    vi.stubEnv("MAX_UPLOADS_PER_DAY_ESTABLISHED", "2000");
    expect((await uploadLimitResponse("u1", now))?.status).toBe(429); // over 2,000
    vi.stubEnv("MAX_UPLOADS_PER_DAY_ESTABLISHED", "5000");
    expect(await uploadLimitResponse("u1", now)).toBeNull(); // under 5,000
  });

  it("does not trust an old account that has no library from before today", async () => {
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now - 90 * DAY) });
    setFiles({ recent: 5, older: 0 }); // signed up long ago, never uploaded, now starts a flood
    expect((await uploadLimitResponse("sleeper", now))?.status).toBe(429);
  });

  it("reads the account's age in milliseconds: just under a week is still new, a week is established", async () => {
    setFiles({ recent: 5, older: 100 });
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now - ESTABLISHED_ACCOUNT_MS + 1) });
    expect((await uploadLimitResponse("u1", now))?.status).toBe(429);
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now - ESTABLISHED_ACCOUNT_MS) });
    expect(await uploadLimitResponse("u1", now)).toBeNull();
  });

  it("holds an account created in the future, or one we cannot find, to the tight limit", async () => {
    setFiles({ recent: 5, older: 100 });
    mocks.findUser.mockResolvedValue({ createdAt: new Date(now + 5 * DAY) });
    expect((await uploadLimitResponse("u1", now))?.status).toBe(429);
    mocks.findUser.mockResolvedValue(null);
    expect((await uploadLimitResponse("ghost", now))?.status).toBe(429);
  });

  it("counts only the last 24 hours as recent, for this account", async () => {
    await uploadLimitResponse("u1", now);
    const where = mocks.trackCount.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.createdAt.gte.getTime()).toBe(cutoff);
    expect(mocks.fxCount.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("counts what the account had from before the window as its library", async () => {
    setFiles({ recent: 5 });
    await uploadLimitResponse("u1", now);
    const older = mocks.trackCount.mock.calls.map((c) => c[0].where).find((w) => w.createdAt.lt);
    expect(older.userId).toBe("u1");
    expect(older.createdAt.lt.getTime()).toBe(cutoff);
  });

  it("never limits the admin (and does not even count)", async () => {
    setFiles({ recent: 9999 });
    expect(await uploadLimitResponse("u-admin", now)).toBeNull();
    expect(mocks.trackCount).not.toHaveBeenCalled();
  });
});
