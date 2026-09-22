// Two storage backends behind one interface, chosen via
// NEXT_PUBLIC_STORAGE_BACKEND:
//  - "local" (dev default): saves to disk under UPLOADS_DIR, served back
//    through a hand-written Range-aware route (app/api/tracks/[id]/audio).
//    Vercel's serverless functions can't durably write to disk, so this
//    backend is dev-only.
//  - "blob": Vercel Blob. Files go client -> Blob storage directly (see
//    app/api/tracks/upload-token/route.ts) since Vercel's server functions
//    hard-cap request bodies at 4.5MB, well under typical audio file sizes.
//    The resulting public URL is stored as-is and used directly as
//    sourceUrl — Blob's CDN already supports Range requests.
import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { del, put } from "@vercel/blob";

export type StorageBackend = "local" | "blob";

export function getStorageBackend(): StorageBackend {
  return process.env.NEXT_PUBLIC_STORAGE_BACKEND === "blob" ? "blob" : "local";
}

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? "./uploads");

/** Resolves a local storage key to an absolute path, rejecting anything that would escape UPLOADS_DIR. */
function resolveLocalPath(storageKey: string): string {
  const resolved = path.resolve(UPLOADS_DIR, storageKey);
  if (resolved !== UPLOADS_DIR && !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return resolved;
}

/** Saves a File to disk under a fresh id and returns the storageKey (just the id). */
export async function saveLocalFile(id: string, file: File): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(resolveLocalPath(id), buffer);
  return id;
}

export async function deleteLocalFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveLocalPath(storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function localFileSize(storageKey: string): Promise<number> {
  const stats = await stat(resolveLocalPath(storageKey));
  return stats.size;
}

export function localFileStream(storageKey: string, range?: { start: number; end: number }) {
  return createReadStream(resolveLocalPath(storageKey), range);
}

/** Deletes an object from Vercel Blob storage given its public URL. */
export async function deleteBlobFile(storageKey: string): Promise<void> {
  await del(storageKey);
}

/**
 * Uploads a server-generated file (e.g. one of Replicate's stem-separation
 * outputs, downloaded then re-hosted here so we don't depend on Replicate's
 * own temporary URLs staying valid) to Vercel Blob and returns its public
 * URL. This app's first server-side Blob *upload* — every other upload goes
 * client -> Blob directly (see app/api/tracks/upload-token/route.ts)
 * because Vercel's server functions cap request bodies at 4.5MB; a single
 * separated stem can exceed that, so this path only ever handles files this
 * server itself already has in memory after fetching them from elsewhere,
 * never a browser upload.
 */
export async function uploadBlobFile(pathname: string, data: Buffer, contentType: string): Promise<string> {
  const blob = await put(pathname, data, { access: "public", contentType });
  return blob.url;
}
