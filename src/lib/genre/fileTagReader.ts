/**
 * Reads the embedded tags of a stored audio file (ID3, Vorbis, MP4 and the rest music-metadata knows; MIT-licensed).
 * Server-only. A local file is opened by path, so a tag at the end of the file (ID3v1) can be read; a blob file is streamed,
 * and the reader stops as soon as it has the tags, so the whole file is not downloaded.
 */
import { parseFile, parseWebStream } from "music-metadata";
import { getStorageBackend, localFilePath } from "@/lib/storage";
import type { ProviderInput } from "@/lib/genre/types";
import { advisoryFromNative, type RawFileTags } from "@/lib/genre/fileTags";

const READ_OPTIONS = { duration: false, skipCovers: true, skipPostHeaders: true } as const;

function yearOf(common: { year?: number; date?: string }): number | null {
  if (typeof common.year === "number" && common.year >= 1000 && common.year <= 2999) return common.year;
  const m = /^(\d{4})/.exec(common.date ?? "");
  return m ? Number(m[1]) : null;
}

export async function readFileTags(input: ProviderInput): Promise<RawFileTags | null> {
  if (!input.storageKey) return null;
  let parsed: Awaited<ReturnType<typeof parseFile>>;
  if (getStorageBackend() === "local") {
    parsed = await parseFile(localFilePath(input.storageKey), READ_OPTIONS);
  } else {
    const res = await fetch(input.storageKey, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) return null;
    try {
      parsed = await parseWebStream(res.body, { mimeType: input.mimeType, size: Number(res.headers.get("content-length")) || undefined }, READ_OPTIONS);
    } finally {
      // The reader has what it needs; do not keep downloading the rest.
      await res.body.cancel().catch(() => undefined);
    }
  }
  const { common, native } = parsed;
  return { genres: (common.genre ?? []).filter((g) => typeof g === "string"), album: common.album ?? null, year: yearOf(common), explicit: advisoryFromNative(native) };
}
