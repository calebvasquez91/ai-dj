import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as { user?: { id?: string; email?: string } } | null }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));

import { feedbackOwnerSession } from "@/lib/feedbackOwner";

beforeEach(() => vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "cmowner0001"));
afterEach(() => vi.unstubAllEnvs());

describe("feedbackOwnerSession", () => {
  it("returns the session for the owner", async () => {
    mocks.session = { user: { id: "cmowner0001", email: "owner@example.com" } };
    expect(await feedbackOwnerSession()).toBe(mocks.session);
  });

  it("returns null for everyone else: another account, a session with no id, a signed-out visitor", async () => {
    mocks.session = { user: { id: "cmother0002", email: "owner@example.com" } }; // the owner's email is not what counts
    expect(await feedbackOwnerSession()).toBeNull();
    mocks.session = { user: { email: "owner@example.com" } };
    expect(await feedbackOwnerSession()).toBeNull();
    mocks.session = {};
    expect(await feedbackOwnerSession()).toBeNull();
    mocks.session = null;
    expect(await feedbackOwnerSession()).toBeNull();
  });

  it("returns null for everyone when no owner is configured", async () => {
    vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
    mocks.session = { user: { id: "cmowner0001" } };
    expect(await feedbackOwnerSession()).toBeNull();
  });
});
