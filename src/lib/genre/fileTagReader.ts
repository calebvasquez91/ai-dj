/**
 * Reads the embedded tags of a stored audio file (ID3, Vorbis, MP4 and the rest music-metadata knows; MIT-licensed).
 * Server-only. A local file and a blob file are both read as a stream, so the song is never held in memory whole (a long WAV or
 * FLAC can be hundreds of MB); the reader takes the tags and stops. Trailing tags (ID3v1) are skipped on purpose (skipPostHeaders).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parseStream, parseWebStream } from "music-metadata";
import { getStorageBackend, localFilePath } from "@/lib/storage";
import type { ProviderInput } from "@/lib/genre/types";
import { advisoryFromNative, type RawFileTags } from "@/lib/genre/fileTags";

const READ_OPTIONS = { duration: false, skipCovers: true, skipPostHeaders: true } as const;

/**
 * The file extension for an audio MIME type, used as a hint. An upload is stored under its id with no extension, so the parser
 * must be told what it is. A MIME type alone is not enough everywhere (reading it back through a bundler's module resolution
 * failed to find the parser in one environment, while the extension always worked), so the hint gives both.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/aacp": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/aiff": ".aiff",
  "audio/x-aiff": ".aiff",
  "audio/webm": ".webm",
  "audio/x-ms-wma": ".wma",
};

export function fileInfoHint(mimeType: string | undefined): { mimeType?: string; path?: string } {
  const mime = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (!mime) return {};
  const extension = EXTENSION_BY_MIME[mime];
  return { mimeType: mime, ...(extension ? { path: `upload${extension}` } : {}) };
}

function yearOf(common: { year?: number; date?: string }): number | null {
  if (typeof common.year === "number" && common.year >= 1000 && common.year <= 2999) return common.year;
  const m = /^(\d{4})/.exec(common.date ?? "");
  return m ? Number(m[1]) : null;
}

export async function readFileTags(input: ProviderInput): Promise<RawFileTags | null> {
  if (!input.storageKey) return null;
  let parsed: Awaited<ReturnType<typeof parseStream>>;
  if (getStorageBackend() === "local") {
    // An upload is stored under its id with no extension, so the parser cannot learn the format from the name (opening it by
    // path fails): tell it the MIME type the upload was recorded with. The file is read whole, which also keeps a tag at the
    // end of it (ID3v1) readable; this backend is for development, where files are local.
    const path = localFilePath(input.storageKey);
    // Stat first: a stream for a missing file would raise an error event with nobody listening yet.
    const { size } = await stat(path);
    const stream = createReadStream(path);
    try {
      parsed = await parseStream(stream, { ...fileInfoHint(input.mimeType), size }, READ_OPTIONS);
    } finally {
      stream.destroy();
    }
  } else {
    const res = await fetch(input.storageKey, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) return null;
    try {
      parsed = await parseWebStream(res.body, { ...fileInfoHint(input.mimeType), size: Number(res.headers.get("content-length")) || undefined }, READ_OPTIONS);
    } finally {
      // The reader has what it needs; do not keep downloading the rest.
      await res.body.cancel().catch(() => undefined);
    }
  }
  const { common, native } = parsed;
  return { genres: (common.genre ?? []).filter((g) => typeof g === "string"), album: common.album ?? null, year: yearOf(common), explicit: advisoryFromNative(native) };
}
