/**
 * Turning a validated spec and a library into a playlist preview: select the tracks (select.ts), plan their energy and
 * order them along the arc the request or its occasion wants (energyArc.ts), and describe the result. The title and
 * description here are the local ones; the server may replace them (and the order) with the model's, but only with an answer
 * that passes checks (see refineOrder), so a failed or odd model answer leaves this result standing. Pure.
 */
import { genresOfTrack } from "@/lib/genreLibrary";
import { ARC_KEY_WEIGHT, estimateEnergies, orderByEnergyArc } from "@/lib/curate/energyArc";
import { PROFILES, type EnergyArc, type EventProfile } from "@/lib/curate/profiles";
import { profileOf, selectTracks, shortfallOf, type Selection, type Shortfall } from "@/lib/curate/select";
import type { CurationSpec } from "@/lib/curate/spec";
import type { Track } from "@/types/music";

export interface PreviewTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  /** 0-1, for the sparkline. */
  energy: number;
  bpm: number | null;
  genre?: string;
}

export interface CurationPreview {
  title: string;
  description: string;
  tracks: PreviewTrack[];
  runtimeSec: number;
  arc: EnergyArc;
  profile: ProfileId | null;
  /** Null when the library covers the length asked for. */
  shortfall: Shortfall | null;
  /** Tracks in the playlist whose release year the request cares about but is unknown. */
  unknownYear: number;
  /** Under clean-only: tracks in the playlist with no content rating. */
  unknownRating: number;
  /** Words about what was dropped or mapped while reading the request. */
  notes: string[];
  spec: CurationSpec;
}
type ProfileId = EventProfile["id"];

const decadeLabel = (from: number, to: number) => {
  if (to - from === 9 && from % 10 === 0) return `${String(from).slice(from >= 2000 ? 0 : 2)}s`;
  return from === to ? String(from) : `${from}–${to}`;
};

/** A short name for a playlist from its spec: "90s R&B Workout", "Chill House". */
export function titleFromSpec(spec: CurationSpec): string {
  const parts: string[] = [];
  const mood = spec.moods.find((m) => m !== "workout" && m !== "party");
  if (mood && !profileOf(spec)) parts.push(mood.replace(/(^|-)\w/g, (c) => c.toUpperCase()).replace("-", " "));
  if (spec.eraRange) parts.push(decadeLabel(spec.eraRange.from, spec.eraRange.to));
  const sub = spec.subgenres[0];
  if (sub) parts.push(sub);
  if (!sub || spec.genres.length > 1) for (const g of spec.genres.slice(0, 2)) if (!parts.includes(g)) parts.push(g);
  const profile = profileOf(spec);
  if (profile && profile.id !== "open") parts.push(profile.label);
  else if (spec.moods.includes("workout")) parts.push("Workout");
  else if (spec.moods.includes("party")) parts.push("Party");
  return parts.filter(Boolean).join(" ").trim() || "Made by DJ";
}

const ARC_WORDS: Record<EnergyArc, string> = {
  build: "building in energy",
  steady: "holding a steady energy",
  peak: "rising to a peak and easing off",
  "wind-down": "winding down",
  wave: "rising and falling",
};

/** One or two plain sentences about the result. */
export function describeLocal(spec: CurationSpec, count: number, runtimeSec: number, arc: EnergyArc): string {
  const what = [spec.subgenres[0], ...spec.genres].filter(Boolean).slice(0, 2).join(" and ") || "your music";
  const era = spec.eraRange ? ` from ${decadeLabel(spec.eraRange.from, spec.eraRange.to)}` : "";
  const profile = profileOf(spec);
  const occasion = profile && profile.id !== "open" ? ` for a ${profile.label.toLowerCase()}` : "";
  const clean = spec.explicitPolicy === "clean-only" ? " Clean tracks only." : "";
  return `${count} track${count === 1 ? "" : "s"} of ${what}${era}${occasion}, about ${Math.round(runtimeSec / 60)} minutes, ${ARC_WORDS[arc]}.${clean}`;
}

export interface CurationInputs {
  spec: CurationSpec;
  notes?: string[];
  library: readonly Track[];
  bpmOf: (track: Track) => number | null;
  /** A track's Camelot key ("8A") when the app's own analysis is sure of it (lib/camelot.ts trustedCamelot), else null. Absent: no key is known, and the order ignores keys. Where both neighbours have one, a compatible key is preferred over a clash, after the energy arc and the tempo. */
  camelotOf?: (track: Track) => string | null;
  /** The loudness (mean waveform level 0-1) of the tracks that were chosen, by id; absent ids are treated as unknown. */
  loudnessOf?: (trackId: string) => number | null;
  seed?: number;
  /** How much a genre jump between neighbours costs in the order (lib/genreTransitions.ts GENRE_FLOW_WEIGHT), or 0. Set only when genre-aware transitions are on for the person asking. */
  genreFlowWeight?: number;
}

/** What the server needs before it can order: the selection (so it can fetch loudness for just those tracks). */
export function selectForCuration(inputs: Pick<CurationInputs, "spec" | "library" | "bpmOf" | "seed">): Selection {
  return selectTracks(inputs.spec, inputs.library, inputs.bpmOf, inputs.seed ?? 0);
}

/** Orders a selection along the energy arc and builds the preview. */
export function finishCuration(inputs: CurationInputs, selection: Selection): CurationPreview {
  const { spec, library, bpmOf, camelotOf, loudnessOf, seed = 0, genreFlowWeight = 0 } = inputs;
  const profile = profileOf(spec);
  const arc: EnergyArc = spec.energyArc ?? profile?.energyArc ?? PROFILES.open.energyArc;
  const energies = estimateEnergies(selection.chosen.map((c) => ({ id: c.track.id, loudness: loudnessOf?.(c.track.id) ?? null, bpm: c.bpm, genre: genresOfTrack(c.track)[0]?.genre })));
  const order = orderByEnergyArc(
    selection.chosen.map((c) => ({ id: c.track.id, energy: energies.get(c.track.id) ?? 0.5, bpm: c.bpm, genre: genresOfTrack(c.track)[0]?.genre, camelot: camelotOf?.(c.track) ?? null })),
    arc,
    seed,
    genreFlowWeight,
    camelotOf ? ARC_KEY_WEIGHT : 0
  );
  const byId = new Map(selection.chosen.map((c) => [c.track.id, c]));
  const tracks: PreviewTrack[] = order.map((o) => {
    const c = byId.get(o.id)!;
    return { id: c.track.id, title: c.track.title, artist: c.track.artist, durationSec: c.track.durationSec, energy: o.energy, bpm: c.bpm, genre: genresOfTrack(c.track)[0]?.genre };
  });
  const runtimeSec = tracks.reduce((s, t) => s + (t.durationSec || 0), 0);
  return {
    title: titleFromSpec(spec),
    description: describeLocal(spec, tracks.length, runtimeSec, arc),
    tracks,
    runtimeSec,
    arc,
    profile: profile?.id ?? null,
    shortfall: shortfallOf(spec, library, bpmOf, selection),
    unknownYear: selection.unknownYear,
    unknownRating: selection.unknownRating,
    notes: inputs.notes ?? [],
    spec,
  };
}

/**
 * Checks a model's reply for the title, description and order, and applies only what is sound: the order must be exactly
 * the tracks already chosen (no more, no fewer, none new, none twice); the title and description must be plain, short text.
 * Anything else keeps the local value, so the model can reorder and describe but never add or drop a track.
 */
export function refineOrder(preview: CurationPreview, raw: unknown): CurationPreview {
  const r = (raw ?? {}) as { title?: unknown; description?: unknown; order?: unknown };
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max && !/[<>]/.test(v) ? v.trim() : null);
  const title = text(r.title, 60);
  const description = text(r.description, 240);
  let tracks = preview.tracks;
  if (Array.isArray(r.order) && r.order.length === preview.tracks.length && r.order.every((x) => typeof x === "string")) {
    const ids = new Set(r.order as string[]);
    const same = ids.size === preview.tracks.length && preview.tracks.every((t) => ids.has(t.id));
    if (same) {
      const byId = new Map(preview.tracks.map((t) => [t.id, t]));
      tracks = (r.order as string[]).map((id) => byId.get(id)!);
    }
  }
  return { ...preview, title: title ?? preview.title, description: description ?? preview.description, tracks };
}
