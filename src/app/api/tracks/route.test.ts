import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), load: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-reader" } })) }));
vi.mock("@/lib/prisma", () => ({ prisma: { track: { findMany: mocks.findMany } } }));
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => "blob",
  saveLocalFile: vi.fn(),
  deleteLocalFile: vi.fn(),
  deleteBlobFile: vi.fn(),
}));
vi.mock("@/lib/trackUserData", () => ({ loadUserTrackData: mocks.load }));

import { GET } from "./route";

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
  mocks.findMany.mockReset().mockResolvedValue([row("mine", "u-reader"), row("theirs", "u-someone-else")]);
  mocks.load.mockReset().mockResolvedValue(new Map([["theirs", { playPreference: "do-not" }]]));
});

describe("GET /api/tracks: one library for every account", () => {
  it("lists every song, not only the reader's own, and no YouTube imports", async () => {
    const res = await GET();
    const body = (await res.json()) as { id: string }[];
    expect(body.map((t) => t.id)).toEqual(["mine", "theirs"]);
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { source: "local" }, orderBy: { createdAt: "asc" } });
  });

  it("shows each reader their own must / do-not-play marks, not the song's old shared one", async () => {
    const body = (await (await GET()).json()) as { id: string; playPreference?: string }[];
    expect(body.find((t) => t.id === "theirs")?.playPreference).toBe("do-not");
    expect(body.find((t) => t.id === "mine")?.playPreference).toBeUndefined();
  });
});
