// The words on every confirmation (ui/ConfirmSheet.tsx): each one names the thing being changed, says what will happen, and labels
// the button with the action. Pure, so the wording is tested and the same everywhere (the playlist page, the admin pages, the library).

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
  /** Styles the confirm button as a warning (anything that removes something). */
  destructive: boolean;
}

const quote = (name: string) => `“${name.trim() || "Untitled"}”`;

export function confirmRenamePlaylist(from: string, to: string): ConfirmCopy {
  return {
    title: "Rename this playlist?",
    message: `${quote(from)} will be called ${quote(to)}.`,
    confirmLabel: "Rename",
    destructive: false,
  };
}

export function confirmDeletePlaylist(name: string): ConfirmCopy {
  return {
    title: "Delete this playlist?",
    message: `${quote(name)} will be deleted for good. Its songs stay in the music library.`,
    confirmLabel: "Delete playlist",
    destructive: true,
  };
}

export function confirmRemoveSongFromPlaylist(song: string, playlist: string): ConfirmCopy {
  return {
    title: "Remove this song from the playlist?",
    message: `${quote(song)} will come out of ${quote(playlist)}. It stays in the music library.`,
    confirmLabel: "Remove from playlist",
    destructive: true,
  };
}

export function confirmRemovePlaylistImage(playlist: string): ConfirmCopy {
  return {
    title: "Remove this playlist image?",
    message: `The picture on ${quote(playlist)} will be removed. The playlist shows its song covers again.`,
    confirmLabel: "Remove image",
    destructive: true,
  };
}

/** Admin only, and the strongest wording: it takes the song out of the app for every account. */
export function confirmDeleteFromLibrary(song: string): ConfirmCopy {
  return {
    title: "Delete this song from the library?",
    message: `${quote(song)} will be deleted from the music library for everyone, and taken out of every playlist. This cannot be undone.`,
    confirmLabel: "Delete for everyone",
    destructive: true,
  };
}
