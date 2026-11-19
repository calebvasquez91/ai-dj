// Server-only. A playlist's own picture, kept in the PlaylistImage table (prisma/telemetry.sql) beside the playlist. On the blob storage backend the
// picture is a file in Blob and the row holds its address; on the local dev backend (which has nothing to serve a picture from) the small,
// already-shrunk picture is kept in the row itself as a data address. Reads are best effort: with the table missing a playlist just has no picture.
import { prisma } from "@/lib/prisma";
import { deleteBlobFile, getStorageBackend, uploadBlobFile } from "@/lib/storage";
import { imageExtension, type ImageType } from "@/lib/playlistImage";

/** The picture address for each playlist that has one. Empty (not an error) when the table does not exist yet. */
export async function loadPlaylistImages(playlistIds: readonly string[]): Promise<Map<string, string>> {
  if (playlistIds.length === 0) return new Map();
  try {
    const rows = await prisma.playlistImage.findMany({ where: { playlistId: { in: [...playlistIds] } }, select: { playlistId: true, url: true } });
    return new Map(rows.map((r) => [r.playlistId, r.url]));
  } catch {
    return new Map();
  }
}

/** Stores the picture (replacing any earlier one, whose file is then removed) and returns the address to show it from. */
export async function storePlaylistImage(playlistId: string, bytes: Buffer, type: ImageType): Promise<string> {
  const previous = await prisma.playlistImage.findUnique({ where: { playlistId }, select: { url: true } });
  const url =
    getStorageBackend() === "blob"
      ? await uploadBlobFile(`playlist-images/${playlistId}-${Date.now()}.${imageExtension(type)}`, bytes, type)
      : `data:${type};base64,${bytes.toString("base64")}`;
  await prisma.playlistImage.upsert({ where: { playlistId }, create: { playlistId, url }, update: { url } });
  if (previous && previous.url !== url) await removeStoredFile(previous.url);
  return url;
}

/** Removes a playlist's picture; true when it had one. */
export async function removePlaylistImage(playlistId: string): Promise<boolean> {
  const previous = await prisma.playlistImage.findUnique({ where: { playlistId }, select: { url: true } });
  if (!previous) return false;
  await prisma.playlistImage.deleteMany({ where: { playlistId } });
  await removeStoredFile(previous.url);
  return true;
}

/** Best effort: a file that cannot be removed is left behind rather than failing the change that was asked for. */
async function removeStoredFile(url: string): Promise<void> {
  if (!url.startsWith("http")) return; // a data address has no file
  try {
    await deleteBlobFile(url);
  } catch (err) {
    console.warn("Could not delete an old playlist picture:", err instanceof Error ? err.message : err);
  }
}
