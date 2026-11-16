import { describe, expect, it } from "vitest";
import { UPLOAD_CONCURRENCY, describeUploadFailures, isAudioFile, uploadFiles } from "@/lib/localAudio";
import type { Track } from "@/types/music";

const file = (name: string, type = "audio/mpeg") => ({ name, type }) as File;
const track = (id: string): Track => ({ id, title: id, artist: "a", durationSec: 1, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio` });

describe("isAudioFile", () => {
  it("accepts anything the browser calls audio", () => {
    expect(isAudioFile(file("a.mp3", "audio/mpeg"))).toBe(true);
    expect(isAudioFile(file("a.weird", "audio/x-something"))).toBe(true);
  });
  it("falls back to the extension when the browser gives no useful type", () => {
    expect(isAudioFile(file("song.flac", ""))).toBe(true);
    expect(isAudioFile(file("song.M4A", "application/octet-stream"))).toBe(true);
    expect(isAudioFile(file("notes.txt", ""))).toBe(false);
    expect(isAudioFile(file("noextension", ""))).toBe(false);
  });
  it("refuses a file with a non-audio type, whatever its name", () => {
    expect(isAudioFile(file("notes.txt", "text/plain"))).toBe(false);
    expect(isAudioFile(file("cover.jpg", "image/jpeg"))).toBe(false);
    expect(isAudioFile(file("song.mp3", "text/html"))).toBe(false);
    expect(isAudioFile(file("clip.mp4", "video/mp4"))).toBe(false);
  });
});

describe("describeUploadFailures", () => {
  it("is null when nothing failed", () => {
    expect(describeUploadFailures([], 3)).toBeNull();
  });
  it("names the one file when one was picked", () => {
    expect(describeUploadFailures([{ name: "a.mp3", message: "Too big." }], 1)).toBe("Couldn't upload a.mp3: Too big.");
  });
  it("counts and names the failures out of the files picked", () => {
    const failed = [
      { name: "a.mp3", message: "Too big." },
      { name: "b.mp3", message: "Nope." },
    ];
    expect(describeUploadFailures(failed, 5)).toBe("2 of 5 files couldn't be uploaded (a.mp3, b.mp3): Too big.");
    expect(describeUploadFailures(failed, 2)).toBe("2 of 2 files couldn't be uploaded (a.mp3, b.mp3): Too big.");
  });
});

describe("uploadFiles", () => {
  it("returns every uploaded track, in the order the files were picked", async () => {
    const result = await uploadFiles([file("a.mp3"), file("b.mp3"), file("c.mp3")], async ([f]) => [track(f.name)]);
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
    expect(result.failed).toEqual([]);
  });

  it("keeps the order picked even when later files finish first", async () => {
    const delays: Record<string, number> = { "a.mp3": 30, "b.mp3": 5, "c.mp3": 1 };
    const result = await uploadFiles([file("a.mp3"), file("b.mp3"), file("c.mp3")], async ([f]) => {
      await new Promise((r) => setTimeout(r, delays[f.name]));
      return [track(f.name)];
    });
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
  });

  it("keeps the files that uploaded when another one fails, and says which failed and why", async () => {
    const result = await uploadFiles([file("a.mp3"), file("bad.mp3"), file("c.mp3")], async ([f]) => {
      if (f.name === "bad.mp3") throw new Error("Too big.");
      return [track(f.name)];
    });
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "c.mp3"]);
    expect(result.failed).toEqual([{ name: "bad.mp3", message: "Too big." }]);
  });

  it("does not send a file that is not audio, and says so", async () => {
    const sent: string[] = [];
    const result = await uploadFiles([file("a.mp3"), file("notes.txt", "text/plain"), file("c.mp3")], async ([f]) => {
      sent.push(f.name);
      return [track(f.name)];
    });
    expect(sent.sort()).toEqual(["a.mp3", "c.mp3"]);
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "c.mp3"]);
    expect(result.failed).toEqual([{ name: "notes.txt", message: "Not an audio file." }]);
  });

  it("gives a plain message when something that is not an Error is thrown", async () => {
    const result = await uploadFiles([file("a.mp3")], async () => Promise.reject("boom"));
    expect(result.failed).toEqual([{ name: "a.mp3", message: "Upload failed." }]);
  });

  it("uploads only a few files at a time, however many were picked", async () => {
    let inFlight = 0;
    let peak = 0;
    const files = Array.from({ length: 12 }, (_, i) => file(`f${i}.mp3`));
    const result = await uploadFiles(files, async ([f]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      return [track(f.name)];
    });
    expect(peak).toBe(UPLOAD_CONCURRENCY);
    expect(result.tracks).toHaveLength(12);
  });

  it("does nothing for no files", async () => {
    expect(await uploadFiles([], async () => [])).toEqual({ tracks: [], failed: [] });
  });
});
