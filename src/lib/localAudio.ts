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
