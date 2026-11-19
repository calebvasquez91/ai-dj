import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  uploadCreate: vi.fn(),
  deviceUpsert: vi.fn(),
  deviceFind: vi.fn(),
  deviceCount: vi.fn(),
  sessionUpsert: vi.fn(),
  sessionFind: vi.fn(),
  sessionCount: vi.fn(),
  playDeviceUpsert: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: mocks.auditCreate },
    uploadRecord: { create: mocks.uploadCreate },
    device: { upsert: mocks.deviceUpsert, findUnique: mocks.deviceFind, count: mocks.deviceCount },
    appSession: { upsert: mocks.sessionUpsert, findUnique: mocks.sessionFind, count: mocks.sessionCount },
    playEventDevice: { upsert: mocks.playDeviceUpsert },
  },
}));

import { MAX_NEW_DEVICES_PER_DAY, MAX_SESSIONS_PER_DEVICE_PER_DAY, recordAuditEvent, recordHeartbeat, recordPlayDevice, recordUpload, requestDeviceId } from "./telemetryServer";

const DEVICE = "123e4567-e89b-12d3-a456-426614174000";
const SESSION = "223e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  for (const m of Object.values(mocks)) m.mockReset().mockResolvedValue(undefined);
  mocks.deviceCount.mockResolvedValue(0);
  mocks.sessionCount.mockResolvedValue(0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("requestDeviceId", () => {
  it("reads the anonymous id from the request's cookie", () => {
    expect(requestDeviceId(new Request("http://x", { headers: { cookie: `a=1; qdj_device=${DEVICE}` } }))).toBe(DEVICE);
    expect(requestDeviceId(new Request("http://x"))).toBeNull();
  });
});

describe("recordAuditEvent", () => {
  it("writes who (by role), from which device, did what to what", async () => {
    await recordAuditEvent({ eventType: "song_removed", actorId: "u-admin", deviceId: DEVICE, targetId: "t1", targetLabel: "A - B" });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: { eventType: "song_removed", actorRole: "admin", actorId: "u-admin", deviceId: DEVICE, targetId: "t1", targetLabel: "A - B" } });
    await recordAuditEvent({ eventType: "playlist_created", actorId: "u2", deviceId: null });
    expect(mocks.auditCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ actorRole: "user", deviceId: null, targetId: null }) });
  });
  it("never throws, even when the table is missing", async () => {
    mocks.auditCreate.mockRejectedValue(new Error("relation does not exist"));
    await expect(recordAuditEvent({ eventType: "image_added", actorId: "u", deviceId: null })).resolves.toBeUndefined();
  });
});

describe("recordUpload and recordPlayDevice", () => {
  it("records which device uploaded which song", async () => {
    await recordUpload({ userId: "u1", deviceId: DEVICE, trackId: "t1", trackTitle: "Song" });
    expect(mocks.uploadCreate).toHaveBeenCalledWith({ data: { userId: "u1", deviceId: DEVICE, trackId: "t1", trackTitle: "Song" } });
    mocks.uploadCreate.mockRejectedValue(new Error("nope"));
    await expect(recordUpload({ userId: "u1", deviceId: null, trackId: "t1", trackTitle: "Song" })).resolves.toBeUndefined();
  });
  it("remembers the device of a play, only when there is one", async () => {
    await recordPlayDevice("e1", null);
    expect(mocks.playDeviceUpsert).not.toHaveBeenCalled();
    await recordPlayDevice("e1", DEVICE);
    expect(mocks.playDeviceUpsert).toHaveBeenCalledWith({ where: { playEventId: "e1" }, create: { playEventId: "e1", deviceId: DEVICE }, update: { deviceId: DEVICE } });
  });
});

describe("recordHeartbeat", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  const beat = (over: object = {}) =>
    recordHeartbeat({ deviceId: DEVICE, sessionId: SESSION, userId: "u1", platform: "web", appVersion: "2.0.0", userAgent: "Mozilla/5.0 (Windows NT 10.0)", now, ...over });

  it("marks the device seen now with its platform, OS and version, and moves its session's last beat", async () => {
    expect(await beat()).toBe(true);
    expect(mocks.deviceUpsert).toHaveBeenCalledWith({
      where: { id: DEVICE },
      create: { id: DEVICE, lastUserId: "u1", platform: "web", os: "Windows", appVersion: "2.0.0", firstSeenAt: now, lastSeenAt: now },
      update: { lastUserId: "u1", platform: "web", os: "Windows", appVersion: "2.0.0", lastSeenAt: now },
    });
    expect(mocks.sessionUpsert).toHaveBeenCalledWith({
      where: { id: SESSION },
      create: { id: SESSION, deviceId: DEVICE, userId: "u1", startedAt: now, lastBeatAt: now },
      update: { lastBeatAt: now },
    });
  });
  it("keeps no personal data: only what it is given for the device (a long or odd value is cut or replaced)", async () => {
    await beat({ platform: "x".repeat(100), appVersion: "\u0001" });
    const data = mocks.deviceUpsert.mock.calls[0][0].create;
    expect(data.platform).toHaveLength(24);
    expect(data.appVersion).toBe("unknown");
  });
  it("answers false for a bad id and writes nothing, and false (not a throw) when the tables are missing", async () => {
    expect(await beat({ deviceId: "nope" })).toBe(false);
    expect(mocks.deviceUpsert).not.toHaveBeenCalled();
    mocks.deviceUpsert.mockRejectedValue(new Error("relation does not exist"));
    expect(await beat()).toBe(false);
  });
});

describe("recordHeartbeat limits", () => {
  const beat = () => recordHeartbeat({ deviceId: DEVICE, sessionId: SESSION, userId: "u1", platform: "web", appVersion: "2", userAgent: "UA" });

  it("refuses a new device once the account has brought ten in a day, and writes nothing", async () => {
    mocks.deviceFind.mockResolvedValue(null);
    mocks.deviceCount.mockResolvedValue(MAX_NEW_DEVICES_PER_DAY);
    expect(await beat()).toBe(false);
    expect(mocks.deviceUpsert).not.toHaveBeenCalled();
    expect(mocks.deviceCount.mock.calls[0][0].where.lastUserId).toBe("u1");
  });
  it("still accepts a device it already knows, however many the account has", async () => {
    mocks.deviceFind.mockResolvedValue({ id: DEVICE });
    mocks.deviceCount.mockResolvedValue(99);
    expect(await beat()).toBe(true);
    expect(mocks.deviceUpsert).toHaveBeenCalled();
    expect(mocks.deviceCount).not.toHaveBeenCalled();
  });
  it("does not start more than 200 sessions a day on one device", async () => {
    mocks.deviceFind.mockResolvedValue({ id: DEVICE });
    mocks.sessionFind.mockResolvedValue(null);
    mocks.sessionCount.mockResolvedValue(MAX_SESSIONS_PER_DEVICE_PER_DAY);
    expect(await beat()).toBe(true);
    expect(mocks.sessionUpsert).not.toHaveBeenCalled();
  });
  it("keeps moving a known session's last beat forward even at the session limit", async () => {
    mocks.deviceFind.mockResolvedValue({ id: DEVICE });
    mocks.sessionFind.mockResolvedValue({ id: SESSION });
    mocks.sessionCount.mockResolvedValue(MAX_SESSIONS_PER_DEVICE_PER_DAY + 5);
    await beat();
    expect(mocks.sessionUpsert).toHaveBeenCalled();
  });
});
