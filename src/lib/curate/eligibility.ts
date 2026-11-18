/**
 * Which tracks a curated playlist may use at all, decided in one place before anything is scored:
 *  - Do-Not-Play tracks are never used (the same rule Shuffle Play applies).
 *  - Under a clean-only request, a track marked explicit is never used. Whether a track is explicit comes from its file's
 *    advisory tag, or from the person's own tag ("explicit" or "clean" on the track, which wins). A track with no mark at all
 *    is unknown: it can be used, and the preview says how many unknowns it holds, because nothing here can listen to the words.
 *  - Halloween music stays in Spooky Music: a track tagged halloween/spooky/horror/dark/eerie, or whose genre is
 *    Holiday > Halloween, is not offered to any other playlist, unless the request itself is for Halloween.
 * Pure. (The FX rule, that Halloween sounds only play in Spooky Music, is lib/autoFx and friends and is not touched here.)
 */
import { hasSpookyTrackTag } from "@/lib/spookyTags";
import { genresOfTrack } from "@/lib/genreLibrary";
import type { Track } from "@/types/music";
import type { ExplicitPolicy } from "@/lib/curate/spec";

export type ExplicitStatus = "explicit" | "clean" | "unknown";

/** A track's content rating: the person's own tag first, then the file's advisory. */
export function explicitStatusOf(track: Pick<Track, "tags" | "explicit">): ExplicitStatus {
  const tags = (track.tags ?? []).map((t) => t.trim().toLowerCase());
  if (tags.includes("explicit")) return "explicit";
  if (tags.includes("clean")) return "clean";
  return track.explicit ?? "unknown";
}

/** Halloween music: tagged for Spooky Music, or Holiday > Halloween by genre. */
export function isHalloweenTrack(track: Pick<Track, "tags" | "genreTags" | "genre" | "subgenres">): boolean {
  if (hasSpookyTrackTag(track.tags)) return true;
  return genresOfTrack(track).some((g) => g.genre === "Holiday" && g.subgenres.some((s) => s.subgenre === "Halloween"));
}

export interface Eligibility {
  explicitPolicy: ExplicitPolicy;
  /** The request is for Halloween music, so Halloween tracks may be used. */
  allowHalloween: boolean;
}

export interface EligibleResult {
  tracks: Track[];
  excluded: { doNotPlay: number; explicit: number; halloween: number };
  /** Tracks in `tracks` whose content rating is unknown (only counted under clean-only). */
  unknownRating: number;
}

export function eligibleTracks(library: readonly Track[], { explicitPolicy, allowHalloween }: Eligibility): EligibleResult {
  const tracks: Track[] = [];
  const excluded = { doNotPlay: 0, explicit: 0, halloween: 0 };
  let unknownRating = 0;
  for (const track of library) {
    if (track.playPreference === "do-not") {
      excluded.doNotPlay++;
      continue;
    }
    const rating = explicitStatusOf(track);
    if (explicitPolicy === "clean-only" && rating === "explicit") {
      excluded.explicit++;
      continue;
    }
    if (!allowHalloween && isHalloweenTrack(track)) {
      excluded.halloween++;
      continue;
    }
    if (explicitPolicy === "clean-only" && rating === "unknown") unknownRating++;
    tracks.push(track);
  }
  return { tracks, excluded, unknownRating };
}
