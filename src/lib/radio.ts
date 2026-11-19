// Seed radio: from one song, a queue of songs from the library that go with it, kept topped up as it plays. A candidate is scored on what it
// shares with the seed (genre and subgenre, mood, tempo, key, energy), with a boost for the same artist and for artists Last.fm says are similar.
// The picks are ordered along an energy arc with the app's own planner (lib/curate/energyArc.ts) for the occasion the seed suggests (lib/curate/
// profiles.ts), and shaped so no song repeats and no artist plays more than twice in a row. Only songs the rules allow are used at all (Do-Not-Play,
// the explicit policy and Halloween music, via lib/curate/eligibility.ts). With too few good matches it says so (the page then offers Discover
// suggestions, which are metadata only) instead of padding the queue with weak ones. Pure; behind SEED_RADIO_ENABLED.
import { eligibleTracks } from "@/lib/curate/eligibility";
import { estimateEnergies, orderByEnergyArc } from "@/lib/curate/energyArc";
import { PROFILES, type ProfileId } from "@/lib/curate/profiles";
import type { ExplicitPolicy } from "@/lib/curate/spec";
import { genresOfTrack } from "@/lib/genreLibrary";
import { camelotCompatibility } from "@/lib/mix-engine";
import { bestTempoRatio } from "@/lib/tempoRatio";
import type { Track } from "@/types/music";

/** The radio keeps at least this many songs queued behind the one playing. */
export const RADIO_MIN_AHEAD = 10;
/** How many songs it adds at a time. */
export const RADIO_BATCH = 15;
/** Fewer good matches than this and the radio says there are not enough. */
export const RADIO_MIN_MATCHES = 8;
/** A candidate scoring below this is not a match. */
export const RADIO_MIN_SCORE = 0.4;
/** No artist plays more than this many songs in a row. */
export const RADIO_MAX_ARTIST_RUN = 2;

/** What is known about a song besides its tags: from its analysis, when it has one. */
export interface RadioFacts {
  bpm: number | null;
  camelot: string | null;
  /** Mean waveform level 0-1, or null. */
  energy: number | null;
}

export interface RadioOptions {
  explicitPolicy?: ExplicitPolicy;
  factsOf: (track: Track) => RadioFacts;
  /** Artists Last.fm calls similar to the seed's (matched by name, ignoring case). */
  similarArtists?: readonly string[];
  /** Song ids never to pick (already played or queued). */
  exclude?: ReadonlySet<string>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const artistKey = (t: Pick<Track, "artist">) => norm(t.artist);

type GenreSets = { genres: Set<string>; subgenres: Set<string>; best: string | null };
// Resolving a song's genre tags means parsing them, and a top-up scores the whole library, so each song's sets are worked out once (a song
// object is replaced, never changed, when its genre does, so the cache cannot go stale).
const genreSetsCache = new WeakMap<Track, GenreSets>();

function genreSets(track: Track): GenreSets {
  const cached = genreSetsCache.get(track);
  if (cached) return cached;
  const resolved = genresOfTrack(track);
  const genres = new Set(resolved.map((g) => g.genre));
  const subgenres = new Set([...resolved.flatMap((g) => g.subgenres.map((s) => s.subgenre)), ...(track.subgenres ?? [])]);
  const sets = { genres, subgenres, best: resolved[0]?.genre ?? track.genre ?? null };
  genreSetsCache.set(track, sets);
  return sets;
}

/** 0-1: how well `candidate` goes with `seed`. Unknown facts count for little, not against. */
export function radioScore(seed: Track, seedFacts: RadioFacts, candidate: Track, candidateFacts: RadioFacts, similar: ReadonlySet<string>): number {
  const a = genreSets(seed);
  const b = genreSets(candidate);
  let genre = 0;
  if (a.best && a.best === b.best) genre = 1;
  else if ([...a.genres].some((g) => b.genres.has(g))) genre = 0.7;
  const subgenre = [...a.subgenres].some((s) => b.subgenres.has(s)) ? 1 : 0;
  const genreScore = genre * (subgenre ? 1 : 0.85);

  const seedMoods = new Set(seed.moods ?? []);
  const mood = seedMoods.size === 0 || (candidate.moods ?? []).length === 0 ? 0.4 : (candidate.moods ?? []).some((m) => seedMoods.has(m)) ? 1 : 0;

  let tempo = 0.4;
  if (seedFacts.bpm && candidateFacts.bpm) {
    const off = Math.abs(bestTempoRatio(seedFacts.bpm, candidateFacts.bpm) - 1);
    tempo = off <= 0.06 ? 1 : off >= 0.2 ? 0 : 1 - (off - 0.06) / 0.14;
  }

  const key = seedFacts.camelot && candidateFacts.camelot ? [0, 0.6, 1][camelotCompatibility(seedFacts.camelot, candidateFacts.camelot)] : 0.3;

  const energy = seedFacts.energy != null && candidateFacts.energy != null ? 1 - Math.min(1, Math.abs(seedFacts.energy - candidateFacts.energy) * 2) : 0.5;

  const sameArtist = artistKey(seed) === artistKey(candidate);
  const similarArtist = !sameArtist && similar.has(artistKey(candidate));
  const base = 0.4 * genreScore + 0.15 * mood + 0.2 * tempo + 0.1 * key + 0.15 * energy;
  return Math.min(1, base + (sameArtist ? 0.15 : 0) + (similarArtist ? 0.1 : 0));
}

// Which songs a radio may use depends only on the library and the explicit policy, and working it out means checking every song for Halloween
// music, so it is kept per library array (the store replaces the array when songs change) and policy.
const eligibleCache = new WeakMap<readonly Track[], Map<ExplicitPolicy, Track[]>>();

function eligibleCached(library: readonly Track[], policy: ExplicitPolicy): Track[] {
  let byPolicy = eligibleCache.get(library);
  if (!byPolicy) eligibleCache.set(library, (byPolicy = new Map()));
  let tracks = byPolicy.get(policy);
  if (!tracks) byPolicy.set(policy, (tracks = eligibleTracks(library, { explicitPolicy: policy, allowHalloween: false }).tracks));
  return tracks;
}

export interface RadioCandidate {
  track: Track;
  score: number;
}

/** Every allowed song that matches the seed well enough, best first. The seed itself is never a candidate. */
export function radioCandidates(seed: Track, library: readonly Track[], options: RadioOptions): RadioCandidate[] {
  const tracks = eligibleCached(library, options.explicitPolicy ?? "any");
  const similar = new Set((options.similarArtists ?? []).map(norm));
  const seedFacts = options.factsOf(seed);
  const out: RadioCandidate[] = [];
  for (const track of tracks) {
    if (track.id === seed.id || options.exclude?.has(track.id)) continue;
    const score = radioScore(seed, seedFacts, track, options.factsOf(track), similar);
    if (score >= RADIO_MIN_SCORE) out.push({ track, score });
  }
  return out.sort((x, y) => y.score - x.score || x.track.title.localeCompare(y.track.title));
}

/** The occasion the seed suggests, from how energetic it is: lively songs get a party's arc, mellow ones a chill one, the rest an open one. */
export function radioProfile(seedEnergy: number | null): ProfileId {
  if (seedEnergy == null) return "open";
  return seedEnergy >= 0.65 ? "party" : seedEnergy <= 0.35 ? "chill" : "open";
}

/**
 * Puts the songs in an order where no artist plays more than `maxRun` times in a row, counting the artists already at the end of the queue
 * (`tail`, newest last). A song that would break the rule is held back and used as soon as another artist has played; one that never fits is
 * left out rather than breaking the rule.
 */
export function enforceArtistSpacing<T extends { artist: string }>(items: readonly T[], tail: readonly { artist: string }[] = [], maxRun = RADIO_MAX_ARTIST_RUN): T[] {
  const out: T[] = [];
  const recent = tail.map(artistKey);
  const pending = [...items];
  const runWith = (key: string) => {
    let run = 0;
    for (let i = recent.length - 1; i >= 0 && recent[i] === key; i--) run++;
    return run;
  };
  while (pending.length > 0) {
    const index = pending.findIndex((item) => runWith(artistKey(item)) < maxRun);
    if (index === -1) break; // everything left would break the rule
    const [item] = pending.splice(index, 1);
    out.push(item);
    recent.push(artistKey(item));
  }
  return out;
}

export interface RadioBatch {
  /** The songs to queue, in play order. */
  tracks: Track[];
  /** False when fewer than RADIO_MIN_MATCHES songs matched well: the page then offers Discover suggestions instead of padding the queue. */
  enough: boolean;
  profile: ProfileId;
}

/** The next songs for a radio: the best matches that are not excluded, ordered along the occasion's energy arc and spaced by artist. */
export function nextRadioBatch(seed: Track, library: readonly Track[], options: RadioOptions, tail: readonly { artist: string }[] = [], count = RADIO_BATCH): RadioBatch {
  const candidates = radioCandidates(seed, library, options);
  const seedFacts = options.factsOf(seed);
  const profile = radioProfile(seedFacts.energy);
  // Plan over more than will be used, so the artist rule can drop a few without leaving the batch short.
  const pool = candidates.slice(0, count * 3);
  const energies = estimateEnergies(pool.map((c) => ({ id: c.track.id, loudness: options.factsOf(c.track).energy, bpm: options.factsOf(c.track).bpm, genre: genresOfTrack(c.track)[0]?.genre })));
  const ordered = orderByEnergyArc(
    pool.map((c) => ({ id: c.track.id, energy: energies.get(c.track.id) ?? 0.5, bpm: options.factsOf(c.track).bpm })),
    PROFILES[profile].energyArc,
  );
  const byId = new Map(pool.map((c) => [c.track.id, c.track]));
  const spaced = enforceArtistSpacing(ordered.map((o) => byId.get(o.id)!), tail);
  return { tracks: spaced.slice(0, count), enough: candidates.length >= RADIO_MIN_MATCHES, profile };
}

/** The radio's first queue: the seed is the current song, and these follow it. */
export function buildRadioQueue(seed: Track, library: readonly Track[], options: RadioOptions): RadioBatch {
  return nextRadioBatch(seed, library, { ...options, exclude: new Set([...(options.exclude ?? []), seed.id]) }, [seed]);
}

/** True when the queue behind the playing song has run below the minimum and the radio should add more. */
export function radioNeedsMore(queueLength: number): boolean {
  return queueLength < RADIO_MIN_AHEAD;
}

/** Whether a play is one song on its own, from nowhere: not a playlist, not a list of songs. */
export function isLoneSongPlay(tracks: readonly unknown[], sourcePlaylistId: string | null | undefined): boolean {
  return tracks.length === 1 && !sourcePlaylistId;
}
