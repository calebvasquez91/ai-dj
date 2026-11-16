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
  /** The files that did not, with why, in the order they were picked. */
  failed: { name: string; message: string }[];
}

/** At most this many files upload at once: a big pick should not open dozens of multi-megabyte requests together. */
export const UPLOAD_CONCURRENCY = 3;

const AUDIO_EXTENSION = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?|wma|caf)$/i;

/**
 * Whether a picked file is audio. The picker's `accept="audio/*"` is only a hint (a drag-and-drop or "All files" gets
 * past it), so the type is checked here: an audio/* type passes; a file with no useful type (some browsers leave .flac or
 * .m4a blank, or say application/octet-stream) passes on its extension; anything else (text, images, video) does not.
 */
export function isAudioFile(file: Pick<File, "name" | "type">): boolean {
  if (file.type.startsWith("audio/")) return true;
  if (file.type === "" || file.type === "application/octet-stream") return AUDIO_EXTENSION.test(file.name);
  return false;
}

/** The line to show when some of the picked files did not upload, or null when all did. */
export function describeUploadFailures(failed: readonly { name: string; message: string }[], picked: number): string | null {
  if (failed.length === 0) return null;
  if (picked === 1) return `Couldn't upload ${failed[0].name}: ${failed[0].message}`;
  return `${failed.length} of ${picked} files couldn't be uploaded (${failed.map((f) => f.name).join(", ")}): ${failed[0].message}`;
}

/**
 * Uploads each picked file on its own, so one bad file (too big, not audio, a dropped connection) does not hide the ones that
 * did upload: those are already saved to the account and must still reach the library and the playlist they were picked for.
 * Files that are not audio are refused here without being sent; the rest upload UPLOAD_CONCURRENCY at a time. Results keep the
 * order the files were picked in. `upload` is injectable for tests.
 */
export async function uploadFiles(files: File[], upload: (files: File[]) => Promise<Track[]> = filesToTracks): Promise<UploadFilesResult> {
  const outcomes: ({ tracks: Track[] } | { message: string })[] = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      if (!isAudioFile(file)) {
        outcomes[i] = { message: "Not an audio file." };
        continue;
      }
      try {
        outcomes[i] = { tracks: await upload([file]) };
      } catch (err) {
        outcomes[i] = { message: err instanceof Error ? err.message : "Upload failed." };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
  const result: UploadFilesResult = { tracks: [], failed: [] };
  outcomes.forEach((outcome, i) => {
    if ("tracks" in outcome) result.tracks.push(...outcome.tracks);
    else result.failed.push({ name: files[i].name, message: outcome.message });
  });
  return result;
}
