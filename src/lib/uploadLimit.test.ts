import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackCount: vi.fn(), fxCount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { count: mocks.trackCount }, fxSound: { count: mocks.fxCount } } }));

import { DEFAULT_UPLOADS_PER_DAY, parseUploadCap, uploadAllowance, UPLOAD_WINDOW_MS } from "./uploadLimit";
import { uploadLimitResponse } from "./uploadGuard";

describe("parseUploadCap", () => {
  it("reads a whole number of files and falls back to the default for anything else", () => {
    expect(parseUploadCap("50")).toBe(50);
    for (const bad of [undefined, null, "", "  ", "0", "-3", "2.5", "lots", "NaN"]) expect(parseUploadCap(bad as string | null | undefined), String(bad)).toBe(DEFAULT_UPLOADS_PER_DAY);
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
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_USER_IDS", "u-admin");
    vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
    vi.stubEnv("MAX_UPLOADS_PER_DAY", "5");
    mocks.trackCount.mockReset().mockResolvedValue(0);
    mocks.fxCount.mockReset().mockResolvedValue(0);
  });

  it("lets an account under the cap add a file", async () => {
    mocks.trackCount.mockResolvedValue(2);
    mocks.fxCount.mockResolvedValue(2);
    expect(await uploadLimitResponse("u1")).toBeNull();
  });

  it("answers 429 once songs and FX sounds together reach the cap", async () => {
    mocks.trackCount.mockResolvedValue(3);
    mocks.fxCount.mockResolvedValue(2);
    const res = await uploadLimitResponse("u1");
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/5 files per 24 hours/);
  });

  it("counts only the last 24 hours, for this account", async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    await uploadLimitResponse("u1", now);
    const where = mocks.trackCount.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.createdAt.gte.getTime()).toBe(now - UPLOAD_WINDOW_MS);
    expect(mocks.fxCount.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("never limits the admin (and does not even count)", async () => {
    mocks.trackCount.mockResolvedValue(9999);
    expect(await uploadLimitResponse("u-admin")).toBeNull();
    expect(mocks.trackCount).not.toHaveBeenCalled();
  });
});
