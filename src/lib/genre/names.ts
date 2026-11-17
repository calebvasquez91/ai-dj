/**
 * Cleaning a title and an artist the way a music database wants them: without the "(feat. X)", "[Explicit]" and "- 2011
 * Remaster" that file names and store listings add, and with only the main artist. Used to look a track up and to compare
 * what a lookup found against what we asked for.
 */
import { aliasKey } from "@/lib/genres";

const TITLE_NOISE = [
  /\s*[([](?:feat\.?|ft\.?|featuring|with|prod\.?|produced by)\b[^)\]]*[)\]]/gi,
  /\s*[([](?:explicit|clean|radio edit|album version|single version|original mix|official (?:audio|video|music video)|lyrics?|lyric video|audio|hd|hq|remaster(?:ed)?(?: \d{4})?|\d{4} remaster(?:ed)?|bonus track|deluxe(?: edition)?)[)\]]/gi,
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?(?:\s+\d{4})?|radio edit|single version|album version|original mix|bonus track|mono|stereo)\b.*$/gi,
  /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/gi,
];

/** The title with release noise taken off. Never returns an empty string for a non-empty title: if cleaning would empty it, the title is kept. */
export function cleanTitle(title: string): string {
  let out = title.replace(/\s+/g, " ").trim();
  for (const re of TITLE_NOISE) out = out.replace(re, "").trim();
  return out || title.trim();
}

/** The main artist: the part before "feat.", "ft.", "&", "x", "with", "," or "/" (a collaboration is looked up under its first name). */
export function primaryArtist(artist: string): string {
  const first = artist
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x)\s+|\s*(?:,|;|\/|&| and )\s*/i)[0]
    ?.trim();
  return first || artist.trim();
}

/** An artist field that says nothing about who the artist is. */
export function isUnknownArtist(artist: string): boolean {
  const key = aliasKey(artist);
  return key === "" || key === "unknown artist" || key === "unknown" || key === "various artists" || key === "various" || key === "artist" || key === "n a";
}

/** Whether two names are the same track or artist once case, accents and punctuation are ignored. */
export function sameName(a: string, b: string): boolean {
  const x = aliasKey(a);
  const y = aliasKey(b);
  return x !== "" && x === y;
}
