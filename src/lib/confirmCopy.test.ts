import { describe, expect, it } from "vitest";
import {
  confirmDeleteFromLibrary,
  confirmDeletePlaylist,
  confirmRemovePlaylistImage,
  confirmRemoveSongFromPlaylist,
  confirmRenamePlaylist,
} from "./confirmCopy";

describe("confirmation wording", () => {
  it("renaming names both the old and the new name", () => {
    const c = confirmRenamePlaylist("Gym", "Gym 2");
    expect(c.message).toContain("Gym");
    expect(c.message).toContain("Gym 2");
    expect(c.destructive).toBe(false);
  });

  it("deleting a playlist names it and says the songs stay in the library", () => {
    const c = confirmDeletePlaylist("Road Trip");
    expect(c.message).toContain("Road Trip");
    expect(c.message).toMatch(/stay in the music library/);
    expect(c.destructive).toBe(true);
  });

  it("removing a song names the song and the playlist, and says the library keeps it", () => {
    const c = confirmRemoveSongFromPlaylist("Levitating", "Gym");
    expect(c.message).toContain("Levitating");
    expect(c.message).toContain("Gym");
    expect(c.message).toMatch(/stays in the music library/);
    expect(c.destructive).toBe(true);
  });

  it("removing a playlist image names the playlist", () => {
    const c = confirmRemovePlaylistImage("Chill");
    expect(c.message).toContain("Chill");
    expect(c.destructive).toBe(true);
  });

  it("deleting from the library is the strongest: names the song, says for everyone and that it cannot be undone", () => {
    const c = confirmDeleteFromLibrary("Hotline Bling (Clean)");
    expect(c.message).toContain("Hotline Bling (Clean)");
    expect(c.message).toMatch(/for everyone/);
    expect(c.message).toMatch(/This cannot be undone\./);
    expect(c.destructive).toBe(true);
  });

  it("never shows an empty name", () => {
    expect(confirmDeletePlaylist("  ").message).toContain("Untitled");
  });
});
