/** Any track tagged with one of these (case-insensitive) belongs in Spooky Music: the server unions such tracks into that playlist (lib/playlistApi.ts) and Add Music lists them first there. */
export const SPOOKY_TRACK_TAGS = ["halloween", "spooky", "horror", "dark", "eerie"];

/** True when one of the tags is a Spooky Music tag. */
export function hasSpookyTrackTag(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).some((tag) => SPOOKY_TRACK_TAGS.includes(tag.toLowerCase()));
}
