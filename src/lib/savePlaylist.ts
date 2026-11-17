/** Saves tracks from the library as a new, ordinary playlist (the app's own create, rename and add, so the order is kept). */
import { useStore } from "@/lib/store";

/** The new playlist's id, or null if it could not be created (the store has already told the person why). */
export async function savePlaylistFromTracks(name: string, trackIds: readonly string[]): Promise<string | null> {
  const s = useStore.getState();
  const id = await s.createPlaylist();
  if (!id) return null;
  s.renamePlaylist(id, name.trim().slice(0, 100) || "New playlist");
  s.persistPlaylistName(id);
  const byId = new Map(useStore.getState().localLibrary.map((t) => [t.id, t]));
  // One after another, so the playlist keeps the order it was given.
  for (const trackId of trackIds) {
    const track = byId.get(trackId);
    if (track) await useStore.getState().addTrackToPlaylist(id, track);
  }
  return id;
}
