import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir = "";
vi.mock("@/lib/storage", () => ({
  getStorageBackend: () => "local",
  localFilePath: (key: string) => path.join(dir, key),
}));

import { fileInfoHint, readFileTags } from "@/lib/genre/fileTagReader";
import { createFileTagProvider } from "@/lib/genre/fileTags";

const latin1 = (s: string) => Buffer.from(s, "latin1");
function frame(id: string, body: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([latin1(id), size, Buffer.from([0, 0]), body]);
}
const text = (id: string, value: string) => frame(id, Buffer.concat([Buffer.from([0]), latin1(value)]));
const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** An MP3: an ID3v2.3 tag with the given fields, then a few silent MPEG-1 Layer III frames. */
function mp3(fields: { title?: string; genre?: string[]; year?: string; album?: string; advisory?: string }): Buffer {
  const frames = [text("TIT2", fields.title ?? "Song")];
  if (fields.album) frames.push(text("TALB", fields.album));
  if (fields.year) frames.push(text("TYER", fields.year));
  if (fields.genre) frames.push(text("TCON", fields.genre.join("\u0000")));
  if (fields.advisory) frames.push(frame("TXXX", Buffer.concat([Buffer.from([0]), latin1("ITUNESADVISORY"), Buffer.from([0]), latin1(fields.advisory)])));
  const body = Buffer.concat(frames);
  const header = Buffer.concat([latin1("ID3"), Buffer.from([3, 0, 0]), syncsafe(body.length)]);
  const audio = Buffer.concat(Array.from({ length: 12 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])));
  return Buffer.concat([header, body, audio]);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "genre-tags-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fileInfoHint", () => {
  it("gives the parser both the MIME type and an extension for it", () => {
    expect(fileInfoHint("audio/mpeg")).toEqual({ mimeType: "audio/mpeg", path: "upload.mp3" });
    expect(fileInfoHint("Audio/X-M4A; codecs=mp4a")).toEqual({ mimeType: "audio/x-m4a", path: "upload.m4a" });
    expect(fileInfoHint("audio/flac")).toEqual({ mimeType: "audio/flac", path: "upload.flac" });
  });
  it("gives only the MIME type for one it does not know, and nothing when there is none", () => {
    expect(fileInfoHint("audio/x-something")).toEqual({ mimeType: "audio/x-something" });
    expect(fileInfoHint(undefined)).toEqual({});
    expect(fileInfoHint("")).toEqual({});
  });
});

describe("readFileTags on a stored upload", () => {
  it("reads the tags of a file stored with no extension, as every upload is (the type comes from the recorded MIME type)", async () => {
    await writeFile(path.join(dir, "0b6f2a54-uuid-no-extension"), mp3({ genre: ["Hip Hop/Rap"], year: "1994", album: "Ready to Die", advisory: "1" }));
    const tags = await readFileTags({ trackId: "t", title: "x", artist: "y", durationSec: 1, source: "local", storageKey: "0b6f2a54-uuid-no-extension", mimeType: "audio/mpeg" });
    expect(tags).toEqual({ genres: ["Hip Hop/Rap"], album: "Ready to Die", year: 1994, explicit: "explicit" });
  });

  it("reads several genre values, a clean advisory, and no year or advisory when the file has none", async () => {
    await writeFile(path.join(dir, "multi"), mp3({ genre: ["Pop", "R&B"], advisory: "2" }));
    await writeFile(path.join(dir, "bare"), mp3({}));
    const input = { trackId: "t", title: "x", artist: "y", durationSec: 1, source: "local" as const, mimeType: "audio/mpeg" };
    expect(await readFileTags({ ...input, storageKey: "multi" })).toMatchObject({ genres: ["Pop", "R&B"], explicit: "clean", year: null });
    expect(await readFileTags({ ...input, storageKey: "bare" })).toMatchObject({ genres: [], explicit: null, year: null });
  });

  it("feeds the file tags provider: a messy tag becomes a taxonomy genre at the file-tag confidence", async () => {
    await writeFile(path.join(dir, "messy"), mp3({ genre: ["Hip Hop/Rap"], year: "1999" }));
    const provider = createFileTagProvider({ readTags: readFileTags, now: () => 1 });
    const r = await provider.classify({ trackId: "t", title: "x", artist: "y", durationSec: 1, source: "local", storageKey: "messy", mimeType: "audio/mpeg" });
    expect(r.tags).toEqual([{ genre: "Hip-Hop", source: "file-tags", confidence: 0.6, updatedAt: 1 }]);
    expect(r.meta).toMatchObject({ year: 1999 });
  });

  it("is a failed read, not a crash, for a file that is not audio", async () => {
    await writeFile(path.join(dir, "junk"), Buffer.from("this is not audio at all"));
    const provider = createFileTagProvider({ readTags: readFileTags });
    const r = await provider.classify({ trackId: "t", title: "x", artist: "y", durationSec: 1, source: "local", storageKey: "junk", mimeType: "audio/mpeg" });
    expect(r.tags).toEqual([]);
    expect(r.note).toMatch(/could not read|no readable|no genre/);
  });
});
