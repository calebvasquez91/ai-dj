import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: { user: { id: "u1" } } as { user: { id: string } } | null, beat: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/telemetryServer", () => ({ recordHeartbeat: mocks.beat }));

import { POST } from "./route";

const DEVICE = "123e4567-e89b-12d3-a456-426614174000";
const SESSION = "223e4567-e89b-12d3-a456-426614174000";
const post = (body: unknown) => POST(new Request("http://x/api/telemetry/heartbeat", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": "UA" } }));

beforeEach(() => {
  mocks.session = { user: { id: "u1" } };
  mocks.beat.mockReset().mockResolvedValue(true);
});

describe("POST /api/telemetry/heartbeat", () => {
  it("records a heartbeat for the signed-in account's device", async () => {
    const res = await post({ deviceId: DEVICE, sessionId: SESSION, platform: "web", appVersion: "2.0.0" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    expect(mocks.beat).toHaveBeenCalledWith({ deviceId: DEVICE, sessionId: SESSION, userId: "u1", platform: "web", appVersion: "2.0.0", userAgent: "UA" });
  });

  it("needs a signed-in account", async () => {
    mocks.session = null;
    expect((await post({ deviceId: DEVICE, sessionId: SESSION })).status).toBe(401);
    expect(mocks.beat).not.toHaveBeenCalled();
  });

  it("refuses an id that is not well formed, and records nothing", async () => {
    expect((await post({ deviceId: "not-an-id", sessionId: SESSION })).status).toBe(400);
    expect((await post({ deviceId: DEVICE })).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
    expect(mocks.beat).not.toHaveBeenCalled();
  });

  it("answers recorded: false (not an error) when nothing could be written", async () => {
    mocks.beat.mockResolvedValue(false);
    const res = await post({ deviceId: DEVICE, sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: false });
  });
});
