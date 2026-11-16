import { describe, expect, it } from "vitest";
import { uploadFiles } from "@/lib/localAudio";
import type { Track } from "@/types/music";

const file = (name: string) => ({ name }) as File;
const track = (id: string): Track => ({ id, title: id, artist: "a", durationSec: 1, addedAt: 0, source: "local", sourceUrl: `/api/tracks/${id}/audio` });

describe("uploadFiles", () => {
  it("returns every uploaded track, in the order the files were picked", async () => {
    const result = await uploadFiles([file("a.mp3"), file("b.mp3"), file("c.mp3")], async ([f]) => [track(f.name)]);
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
    expect(result.failed).toEqual([]);
  });

  it("keeps the files that uploaded when another one fails, and says which failed and why", async () => {
    const result = await uploadFiles([file("a.mp3"), file("bad.txt"), file("c.mp3")], async ([f]) => {
      if (f.name === "bad.txt") throw new Error("Not an audio file.");
      return [track(f.name)];
    });
    expect(result.tracks.map((t) => t.id)).toEqual(["a.mp3", "c.mp3"]);
    expect(result.failed).toEqual([{ name: "bad.txt", message: "Not an audio file." }]);
  });

  it("gives a plain message when something that is not an Error is thrown", async () => {
    const result = await uploadFiles([file("a.mp3")], async () => Promise.reject("boom"));
    expect(result.failed).toEqual([{ name: "a.mp3", message: "Upload failed." }]);
  });

  it("does nothing for no files", async () => {
    expect(await uploadFiles([], async () => [])).toEqual({ tracks: [], failed: [] });
  });
});
