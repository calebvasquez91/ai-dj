import type { Track } from "@/types/music";
import { uploadTrack } from "./trackUpload";

function parseFileName(fileName: string): { title: string; artist: string } {
  const withoutExt = fileName.replace(/\.[^/.]+$/, "");
  const match = withoutExt.match(/^(.+?)\s*-\s*(.+)$/);
  if (match) {
    return { artist: match[1].trim(), title: match[2].trim() };
  }
  return { artist: "Unknown Artist", title: withoutExt };
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => resolve(audio.duration || 0), {
      once: true,
    });
    audio.addEventListener("error", () => resolve(0), { once: true });
    audio.src = url;
  });
}

/** Reads each file's duration/filename client-side, then uploads it (bytes + metadata) to the server library. */
export async function filesToTracks(files: File[]): Promise<Track[]> {
  return Promise.all(
    files.map(async (file) => {
      const tempUrl = URL.createObjectURL(file);
      const durationSec = await readDuration(tempUrl);
      URL.revokeObjectURL(tempUrl);
      const { title, artist } = parseFileName(file.name);
      return uploadTrack(file, { title, artist, durationSec });
    })
  );
}

export interface UploadFilesResult {
  /** The files that uploaded, as library tracks, in the order they were picked. */
  tracks: Track[];
  /** The files that did not, with why. */
  failed: { name: string; message: string }[];
}

/**
 * Uploads each picked file on its own, so one bad file (too big, not audio, a dropped connection) does not hide the ones that
 * did upload: those are already saved to the account and must still reach the library and the playlist they were picked for.
 * `upload` is injectable for tests.
 */
export async function uploadFiles(files: File[], upload: (files: File[]) => Promise<Track[]> = filesToTracks): Promise<UploadFilesResult> {
  const settled = await Promise.allSettled(files.map((file) => upload([file])));
  const result: UploadFilesResult = { tracks: [], failed: [] };
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") result.tracks.push(...outcome.value);
    else result.failed.push({ name: files[i].name, message: outcome.reason instanceof Error ? outcome.reason.message : "Upload failed." });
  });
  return result;
}
