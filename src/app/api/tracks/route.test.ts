import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), load: vi.fn(), limit: vi.fn(), user: "u-reader" }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: mocks.user } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { findMany: mocks.findMany } } }));
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => "blob",
  saveLocalFile: vi.fn(),
  deleteLocalFile: vi.fn(),
  deleteBlobFile: vi.fn(),
}));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: mocks.load }));
vi.mock("@/lib/uploadGuard", () => ({ uploadLimitResponse: mocks.limit }));

import { GET, POST } from "./route";

const row = (id: string, userId: string) => ({
  id,
  userId,
  title: id,
  artist: "A",
  durationSec: 100,
  source: "local",
  storageKey: `https://x.public.blob.vercel-storage.com/${id}.mp3`,
  mimeType: "audio/mpeg",
  thumbnailUrl: null,
  playPreference: "must", // the old per-song copy: not read any more
  createdAt: new Date(0),
  hotCueOverridesJson: null,
  tagsJson: null,
  bpm: null,
  bpmSource: null,
  buildDropPairsJson: null,
  waveformPeaksJson: null,
  lyricalFingerprintJson: null,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_USER_IDS", "u-admin");
  vi.stubEnv("FEEDBACK_ADMIN_USER_IDS", "");
  mocks.user = "u-reader";
  mocks.findMany.mockReset().mockResolvedValue([row("mine", "u-reader"), row("theirs", "u-someone-else")]);
  mocks.load.mockReset().mockResolvedValue(new Map([["theirs", { playPreference: "do-not" }]]));
  mocks.limit.mockReset().mockResolvedValue(null);
});

describe("GET /api/tracks: one library for every account", () => {
  it("lists every song, not only the reader's own, and no YouTube imports", async () => {
    const res = await GET();
    const body = (await res.json()) as { id: string }[];
    expect(body.map((t) => t.id)).toEqual(["mine", "theirs"]);
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { source: "local" }, orderBy: { createdAt: "asc" } });
  });

  it("shows each reader their own must mark, not the song's old shared one", async () => {
    mocks.load.mockResolvedValue(new Map([["theirs", { playPreference: "must" }]]));
    const body = (await (await GET()).json()) as { id: string; playPreference?: string }[];
    expect(body.find((t) => t.id === "theirs")?.playPreference).toBe("must");
    expect(body.find((t) => t.id === "mine")?.playPreference).toBeUndefined();
  });

  it("does not apply an old do-not-play mark for anyone but the admin (the feature is the admin's alone)", async () => {
    const body = (await (await GET()).json()) as { id: string; playPreference?: string }[];
    expect(body.find((t) => t.id === "theirs")?.playPreference).toBeUndefined();
  });

  it("still shows the admin their own do-not-play marks", async () => {
    mocks.user = "u-admin";
    const body = (await (await GET()).json()) as { id: string; playPreference?: string }[];
    expect(body.find((t) => t.id === "theirs")?.playPreference).toBe("do-not");
  });
});

describe("POST /api/tracks: the daily upload limit", () => {
  it("answers 429 and records nothing when the account is over its limit", async () => {
    const { NextResponse } = await import("next/server");
    mocks.limit.mockResolvedValue(NextResponse.json({ error: "Upload limit reached" }, { status: 429 }));
    const res = await POST(new Request("http://x/api/tracks", { method: "POST", body: JSON.stringify({ title: "t" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(429);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
