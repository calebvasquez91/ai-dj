import type { CatalogTrack } from "@/lib/catalog/types";

export interface Attribution {
  /** One line to show wherever the track plays: title, artist, where it is from, the license and (where the license asks for it) a note that the track was adapted. */
  text: string;
  /** The license deed, to link from the license name. */
  licenseUrl: string;
  /** The track's page at the source, when it has one. */
  pageUrl?: string;
  /** False for CC0 and the Public Domain Mark: credit is courtesy there, not a condition. */
  required: boolean;
  /** Present when the license requires crediting and the track is modified, which this app always does (tempo and pitch morphs, crossfades): CC BY asks that changes be indicated. Already part of `text`; kept separately so a UI can style it. */
  adaptationNote?: string;
}

const SOURCE_NAMES: Record<string, string> = { jamendo: "Jamendo", archive: "Internet Archive" };

/** What this app does to every track it plays, in words for the credit line. */
export const ADAPTATION_NOTE = "Tempo and pitch adjusted for mixing.";

/**
 * What to show for a catalog track, wherever it is played or listed. CC BY needs credit to the creator, a link to the
 * license and an indication of changes: `text` carries all three (the link is `licenseUrl`), so showing `text` and
 * linking the license name is enough. The player and the catalog UI must show it; nothing here shows it by itself.
 */
export function attributionFor(track: CatalogTrack): Attribution {
  const via = SOURCE_NAMES[track.source] ?? track.source;
  const required = track.license.requiresAttribution;
  const adaptationNote = required ? ADAPTATION_NOTE : undefined;
  return {
    text: `“${track.title}” by ${track.artist}, via ${via}. ${track.license.label}.${adaptationNote ? ` ${adaptationNote}` : ""}`,
    licenseUrl: track.license.url,
    pageUrl: track.pageUrl,
    required,
    adaptationNote,
  };
}
