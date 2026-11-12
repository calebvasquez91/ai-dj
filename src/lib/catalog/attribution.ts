import type { CatalogTrack } from "@/lib/catalog/types";

export interface Attribution {
  /** One line to show wherever the track plays: title, artist, where it is from and the license. */
  text: string;
  /** The license deed, to link from the license name. */
  licenseUrl: string;
  /** The track's page at the source, when it has one. */
  pageUrl?: string;
  /** False for CC0 and the Public Domain Mark: credit is courtesy there, not a condition. */
  required: boolean;
}

const SOURCE_NAMES: Record<string, string> = { jamendo: "Jamendo", archive: "Internet Archive" };

/** What to show for a catalog track. CC BY needs credit to the creator, a link to the license and a note of changes: the text covers the first two, the app shows a "tempo-adjusted" note wherever it morphs a track. */
export function attributionFor(track: CatalogTrack): Attribution {
  const via = SOURCE_NAMES[track.source] ?? track.source;
  return {
    text: `“${track.title}” by ${track.artist}, via ${via}. ${track.license.label}.`,
    licenseUrl: track.license.url,
    pageUrl: track.pageUrl,
    required: track.license.requiresAttribution,
  };
}
