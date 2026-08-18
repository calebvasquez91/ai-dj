import type { Track } from "@/types/music";
import { saveAudioFile } from "./audioDb";

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

export async function filesToTracks(files: File[]): Promise<Track[]> {
  return Promise.all(
    files.map(async (file) => {
      const id = crypto.randomUUID();
      const sourceUrl = URL.createObjectURL(file);
      const durationSec = await readDuration(sourceUrl);
      const { title, artist } = parseFileName(file.name);
      // Persist the actual bytes so this track survives a reload — the
      // blob: URL above only lives as long as this tab does.
      await saveAudioFile(id, file);
      return {
        id,
        title,
        artist,
        durationSec,
        sourceUrl,
      };
    })
  );
}
