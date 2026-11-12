import type { CatalogLicense } from "@/lib/catalog/license";

/** A track from a free catalog, in the shape every source adapter returns. Not yet a library `Track`: nothing here is stored or played until the user adds it. */
export interface CatalogTrack {
  /** Unique across sources: `<source>:<sourceId>`. */
  id: string;
  source: string;
  sourceId: string;
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  /** An https audio URL for playback. */
  streamUrl: string;
  /** Present only when the source says a copy may be downloaded. */
  downloadUrl?: string;
  imageUrl?: string;
  /** The track's page at the source, for credit and for "open at source". */
  pageUrl?: string;
  license: CatalogLicense;
  /** Genre, instrument and free tags from the source. */
  tags: string[];
  /** The source's own tempo bucket, when it gives one (Jamendo: verylow..veryhigh). Not a BPM. */
  speed?: string;
  vocal?: "vocal" | "instrumental";
}

export interface CatalogQuery {
  /** Free text across title, artist, album and tags. */
  text?: string;
  /** Every one of these tags. */
  tags?: string[];
  /** Any of these tempo buckets. */
  speed?: string[];
  vocal?: "vocal" | "instrumental";
  /** Tracks between these lengths, in seconds. */
  minDurationSec?: number;
  maxDurationSec?: number;
  limit?: number;
  offset?: number;
}

export interface CatalogPage {
  tracks: CatalogTrack[];
  offset: number;
  /** Where the next page starts, or null when the source has no more. */
  nextOffset: number | null;
  /** What the source returned that was left out, so a thin page can be told from an empty catalog. */
  skipped: { invalid: number; license: number };
}

export interface CatalogAdapter {
  /** The `source` of every track it returns. */
  id: string;
  /** Never returns a track whose license the app can't use. Throws a `CatalogSourceError` when the source can't be reached or refuses the request. */
  search(query: CatalogQuery): Promise<CatalogPage>;
}

/** A catalog source failed (unreachable, timed out, refused the key). The message is safe to show or log: it never carries the request URL or the key. */
export class CatalogSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogSourceError";
  }
}
