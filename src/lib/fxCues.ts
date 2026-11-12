/**
 * The audio engineer's half of "when should an FX sound play": where in a song an effect would sound like it belongs,
 * which of the library's sounds suit that spot, and exactly when each must start to land on the beat. Pure, so the
 * rules can be tested; DualDeckStage.tsx plays what is decided. The DJ (a Claude call, with this module's own pick as
 * the fallback) chooses among what the engineer proposes — nothing here is random except the tie-break between
 * near-equal sounds, which takes an injectable `random`.
 *
 * What the engineer reads, all of it already measured elsewhere:
 *  - the song map (lib/song-map.ts): the beat grid, the bar lines, the 8/16-bar phrases and the sections
 *    (intro / build / drop / breakdown / body / outro). Without a trustworthy grid there is no way to land on the beat,
 *    so there are no cues at all (never a guess);
 *  - the voice map (lib/voiceMap.ts): where someone is singing, so a sweep isn't laid over a vocal line.
 *
 * Not covered: the moment one song hands over to the next. During a Song Sync morph the song plays through a stretching
 * voice whose tempo moves bar by bar and the crossfade start is only an estimate, so there is no steady grid to land on.
 *
 * Cues are moments ("a drop lands on this bar line"); sounds are matched to them by role (a riser leads INTO a moment,
 * an impact lands ON it, a downlifter falls AWAY from it). A sound with a BPM in the FX Library is sped up or slowed
 * to the song's tempo (within a turntable's pitch range) so it stays on the grid; one without is left at its own speed
 * unless a small stretch (<= 10%) makes it fill whole bars. The sound's pitch moves with its speed (a plain playback
 * rate, as the rest of the player's tempo moves do); no key matching is attempted.
 *
 * Which sounds may be used at all (Halloween ones only in Spooky Music) is decided BEFORE this module, by
 * getEligibleFX: pass in the eligible pool, never the raw library.
 */

import type { AmbienceFrequency } from "@/lib/ambience";
import { TEMPO_SYNC_MAX_DELTA } from "@/lib/mix-engine";
import { isPhraseGridTrustworthy, type SongMap, type SongSection } from "@/lib/song-map";
import { bestTempoRatio } from "@/lib/tempoRatio";
import type { VoiceMap } from "@/lib/voiceMap";
import type { FxSound } from "@/types/music";

export type FxCueKind = "build" | "drop" | "breakdown" | "phrase";
export type FxRole = "riser" | "downlifter" | "impact" | "hit" | "sweep" | "texture";

/** A moment in a song that an effect could mark. */
export interface FxCue {
  id: string;
  kind: FxCueKind;
  /** The bar line the moment is on (the drop's first beat, the breakdown's first beat, the instant the next song takes over). */
  atSec: number;
  /** Time before `atSec` that a lead-in sound could use (a riser needs this much run-up). */
  roomSec: number;
  /** Time from `atSec` before the next cue or the end guard (how long a sound that starts here can ring). */
  spaceSec: number;
  /** 0-1: how good a place this is, from the kind, the section's and the grid's confidence and any vocal on top. */
  quality: number;
  /** 0-1: the share of the cue's window with a voice on it. */
  vocalOverlap: number;
  reason: string;
}

export interface FxCueInput {
  songMap: SongMap | null | undefined;
  voiceMap?: VoiceMap | null;
  durationSec: number;
  /** Nothing is proposed before this (the playhead plus the time it takes to decode and schedule a sound). */
  fromSec: number;
}

/** No effect in a song's last stretch: it belongs to the transition into the next song. */
export const FX_END_GUARD_SEC = 15;
/** The longest run-up or ring a cue offers, in bars. */
const MAX_ROOM_BARS = 16;
/** A section edge more than this many bars from a bar line isn't one the grid really agrees with: no cue. */
const SECTION_SNAP_BARS = 1;
// A build-up into a drop is where an effect is most at home (a riser filling the build), so it rates level with the drop itself; the planner then lets a riser that fills its build beat the impact on the same bar line.
const KIND_WEIGHT: Record<FxCueKind, number> = { drop: 1, build: 1, breakdown: 0.7, phrase: 0.4 };
/** Below this a sound isn't a fit for a moment. */
export const MIN_FIT_SCORE = 0.3;
/** How far a no-BPM sound may be stretched to fill whole bars. */
const BAR_FIT_MAX_STRETCH = 0.1;
/** A sound exactly as long as its run-up still fits when the measured bar lines put the room a few milliseconds short. */
const ROOM_TOLERANCE_SEC = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function barSec(map: SongMap): number {
  return (4 * 60) / map.bpm;
}

function nearestDownbeat(map: SongMap, timeSec: number): number {
  let best = map.downbeats[0];
  for (const t of map.downbeats) if (Math.abs(t - timeSec) < Math.abs(best - timeSec)) best = t;
  return best;
}

/** The share of [fromSec, toSec] that has a voice on it (0 when there is no voice map or the window is empty). */
export function vocalOverlap(voiceMap: VoiceMap | null | undefined, fromSec: number, toSec: number): number {
  if (!voiceMap || toSec <= fromSec) return 0;
  let covered = 0;
  for (const [start, end] of voiceMap.segments) {
    const overlap = Math.min(end, toSec) - Math.max(start, fromSec);
    if (overlap > 0) covered += overlap;
  }
  return clamp(covered / (toSec - fromSec), 0, 1);
}

/** The moments of one song that an effect could mark, in order. Empty when the song's beat grid can't be trusted. */
export function findFxCues(input: FxCueInput): FxCue[] {
  const map = input.songMap;
  if (!isPhraseGridTrustworthy(map) || !(map.bpm > 0)) return [];
  const bar = barSec(map);
  const gridConfidence = 0.5 + 0.5 * clamp(map.downbeatConfidence, 0, 1);
  const endGuard = input.durationSec - FX_END_GUARD_SEC;

  interface Draft {
    kind: FxCueKind;
    atSec: number;
    leadFromSec: number | null;
    sectionConfidence: number;
    reason: string;
  }
  const drafts: Draft[] = [];
  const add = (kind: FxCueKind, rawSec: number, leadFromRaw: number | null, sectionConfidence: number, reason: string) => {
    const atSec = nearestDownbeat(map, rawSec);
    if (Math.abs(atSec - rawSec) > SECTION_SNAP_BARS * bar) return;
    if (atSec < input.fromSec) return;
    if (atSec > endGuard) return;
    if (drafts.some((d) => Math.abs(d.atSec - atSec) < 1e-6 && d.kind === kind)) return;
    drafts.push({ kind, atSec, leadFromSec: leadFromRaw == null ? null : nearestDownbeat(map, leadFromRaw), sectionConfidence, reason });
  };

  const sections: SongSection[] = map.sections;
  sections.forEach((section, i) => {
    const previous = sections[i - 1];
    if (section.label === "drop") {
      // A build that ends in this drop is where a riser belongs; the drop itself takes an impact. They land on the same
      // bar line, so the planner keeps only the better of the two (an FX at a time keeps it restrained).
      if (previous?.label === "build") add("build", section.startSec, previous.startSec, previous.confidence, "a build-up runs into the drop");
      add("drop", section.startSec, null, section.confidence, "the drop lands");
    } else if (section.label === "breakdown") {
      add("breakdown", section.startSec, null, section.confidence, "the track falls into a breakdown");
    } else if (section.label === "body") {
      // A 16-bar phrase turning over inside a steady stretch: a small accent, never the first choice.
      for (const phraseStart of map.phrases.bars16) {
        if (phraseStart > section.startSec + bar && phraseStart < section.endSec - bar) {
          add("phrase", phraseStart, null, Math.min(section.confidence, map.phrases.confidence), "a new 16-bar phrase begins");
        }
      }
    }
  });

  drafts.sort((a, b) => a.atSec - b.atSec);
  return drafts.map((draft, i) => {
    const previousAt = i > 0 ? drafts[i - 1].atSec : input.fromSec;
    const nextAt = i + 1 < drafts.length ? drafts[i + 1].atSec : Math.max(draft.atSec, input.durationSec - 1);
    // A lead-in may start where its own section does, but not before the playhead or earlier than the last cue's moment.
    const leadFrom = Math.max(input.fromSec, draft.leadFromSec ?? previousAt, previousAt);
    const roomSec = clamp(draft.atSec - leadFrom, 0, MAX_ROOM_BARS * bar);
    const spaceSec = clamp(nextAt - draft.atSec, 0, MAX_ROOM_BARS * bar);
    const overlap = vocalOverlap(input.voiceMap, draft.atSec - Math.min(roomSec, 4 * bar), draft.atSec + 2 * bar);
    const quality = clamp(KIND_WEIGHT[draft.kind] * (0.5 + 0.5 * clamp(draft.sectionConfidence, 0, 1)) * gridConfidence * (1 - 0.5 * overlap), 0, 1);
    return {
      id: `${draft.kind}@${draft.atSec.toFixed(2)}`,
      kind: draft.kind,
      atSec: draft.atSec,
      roomSec,
      spaceSec,
      quality,
      vocalOverlap: overlap,
      reason: overlap > 0.5 ? `${draft.reason} (vocals on it)` : draft.reason,
    };
  });
}

// ---------------------------------------------------------------------------
// What a sound is
// ---------------------------------------------------------------------------

const ROLE_WORDS: [FxRole, RegExp][] = [
  ["downlifter", /down\s*-?\s*lift|down\s*-?\s*sweep|downsweep|falling|\bfall\b|descend|decay/],
  ["riser", /riser|up\s*-?\s*lift|uplift|build\s*-?\s*up|buildup|\brise\b|rising|swell|tension|ascend|reverse/],
  ["impact", /impact|boom|slam|crash|explosion|thud|bomb|sub\s*drop|drop\s*hit/],
  ["sweep", /sweep|whoosh|swoosh|swish|woosh|\bpass\b|noise/],
  ["hit", /\bhit\b|stab|stinger|\bpop\b|snap|clap|zap|blip|chirp|scratch|horn|\bshot\b|\bbell\b|ding|laser|stomp/],
  ["texture", /atmos|ambien|texture|drone|\bpad\b|\bbed\b|rumble|wind|scream|laugh|cackle|whisper|howl|growl|ghost|witch/],
];

/** What a sound is for, from its name, file name and tags (the FX Library has no such field), and for an unlabelled one its length. */
export function fxRoleOf(fx: Pick<FxSound, "name" | "fileName" | "tags" | "durationSec">): FxRole {
  const text = `${fx.name} ${fx.fileName} ${fx.tags.join(" ")}`.toLowerCase();
  for (const [role, pattern] of ROLE_WORDS) {
    if (pattern.test(text)) return role === "texture" && fx.durationSec <= 2 ? "hit" : role;
  }
  return fx.durationSec <= 2 ? "hit" : "texture";
}

/** How well each role suits each kind of moment, 0-1 (absent = never). */
const AFFINITY: Record<FxCueKind, Partial<Record<FxRole, number>>> = {
  build: { riser: 1, sweep: 0.6, texture: 0.2 },
  drop: { impact: 1, hit: 0.8, sweep: 0.3 },
  breakdown: { downlifter: 1, sweep: 0.6, texture: 0.6, hit: 0.2 },
  phrase: { hit: 0.7, sweep: 0.6, downlifter: 0.5, impact: 0.4, texture: 0.35 },
};

/** True when the sound runs UP to the cue's moment (it ends on the bar line); false when it starts on the bar line. */
function endsAtCue(role: FxRole, kind: FxCueKind): boolean {
  if (role === "riser") return true;
  if (role === "sweep") return kind === "build" || kind === "drop";
  return false;
}

// ---------------------------------------------------------------------------
// Fitting a sound to a moment
// ---------------------------------------------------------------------------

export interface FxPlacement {
  startSec: number;
  endSec: number;
  /** Playback rate: 1 is the file's own speed. */
  rate: number;
  /** The sound's BPM was matched to the song's. */
  tempoMatched: boolean;
  /** The sound was stretched a little to fill whole bars. */
  barFit: boolean;
}

export interface FxProposal {
  cueId: string;
  fxId: string;
  role: FxRole;
  kind: FxCueKind;
  /** 0-1. */
  score: number;
  placement: FxPlacement;
  reason: string;
}

/** Where a sound goes for a cue and at what speed, or null when it can't fit there (too long for the room, a tempo that can't be reached). */
export function placeFx(fx: FxSound, cue: FxCue, map: SongMap): { placement: FxPlacement; role: FxRole; tempoFit: number } | null {
  if (!(fx.durationSec > 0) || !(map.bpm > 0)) return null;
  const role = fxRoleOf(fx);
  if ((AFFINITY[cue.kind][role] ?? 0) <= 0) return null;
  const bar = barSec(map);
  const lead = endsAtCue(role, cue.kind);

  let rate = 1;
  let tempoMatched = false;
  let barFit = false;
  let tempoFit = 1;
  if (fx.bpm && fx.bpm > 0) {
    const ratio = bestTempoRatio(map.bpm, fx.bpm);
    const delta = Math.abs(ratio - 1);
    if (delta > TEMPO_SYNC_MAX_DELTA) return null; // it has a tempo and the song's is out of reach: it would drift off the grid
    rate = ratio;
    tempoMatched = true;
    tempoFit = 1 - 0.4 * (delta / TEMPO_SYNC_MAX_DELTA);
  } else if (role === "riser" || role === "sweep" || role === "downlifter") {
    // No tempo to match: a small stretch that makes it fill whole bars keeps its end (or its start) on a bar line.
    const bars = Math.max(1, Math.round(fx.durationSec / bar));
    const fitRate = fx.durationSec / (bars * bar);
    if (Math.abs(fitRate - 1) <= BAR_FIT_MAX_STRETCH) {
      rate = fitRate;
      barFit = true;
      // No stretch at all is a perfect fit; the full 10% scores as low as leaving it alone.
      tempoFit = 1 - (0.3 * Math.abs(fitRate - 1)) / BAR_FIT_MAX_STRETCH;
    } else {
      tempoFit = 0.7;
    }
  }

  const length = fx.durationSec / rate;
  if (length > (lead ? cue.roomSec : cue.spaceSec) + ROOM_TOLERANCE_SEC) return null;
  const startSec = lead ? cue.atSec - length : cue.atSec;
  const endSec = startSec + length;
  return { placement: { startSec, endSec, rate, tempoMatched, barFit }, role, tempoFit };
}

/** How well one sound suits one cue, with where it would go; null when it can't be used there. */
export function fitFxToCue(fx: FxSound, cue: FxCue, map: SongMap): FxProposal | null {
  const placed = placeFx(fx, cue, map);
  if (!placed) return null;
  const affinity = AFFINITY[cue.kind][placed.role] ?? 0;
  const room = endsAtCue(placed.role, cue.kind) ? cue.roomSec : cue.spaceSec;
  const length = placed.placement.endSec - placed.placement.startSec;
  // A lead-in that fills most of its run-up sounds like a build; a one-shot that rings past two bars gets in the way.
  const lengthFit = endsAtCue(placed.role, cue.kind)
    ? 0.5 + 0.5 * Math.min(1, length / Math.max(room, 1e-6))
    : length > 2 * barSec(map) ? 0.7 : 1;
  const score = clamp(affinity * cue.quality * placed.tempoFit * lengthFit, 0, 1);
  const how = placed.placement.tempoMatched ? "tempo-matched" : placed.placement.barFit ? "stretched to whole bars" : "at its own speed";
  return {
    cueId: cue.id,
    fxId: fx.id,
    role: placed.role,
    kind: cue.kind,
    score,
    placement: placed.placement,
    reason: `${placed.role} for ${cue.reason}, ${how}`,
  };
}

// ---------------------------------------------------------------------------
// Proposing a plan
// ---------------------------------------------------------------------------

/** Least time between the starts of two effects, and the most in one song, by the same on/off + frequency setting as the other mid-track FX. */
export const FX_SPACING_SEC: Record<AmbienceFrequency, number> = { off: Infinity, occasional: 60, frequent: 30 };
export const FX_MAX_PER_SONG: Record<AmbienceFrequency, number> = { off: 0, occasional: 3, frequent: 6 };
/** Cues this close (in bars) are one moment: only the best sound for it is kept. */
const SAME_MOMENT_BARS = 2;
/** How many near-best sounds a cue chooses among, so the same riser doesn't answer every build. */
const TIE_BREAK_CANDIDATES = 3;

export interface ProposeFxInput {
  cues: FxCue[];
  /** The sounds that may be used here: the FX Library's Effects, already filtered by getEligibleFX. */
  pool: FxSound[];
  songMap: SongMap | null | undefined;
  frequency: AmbienceFrequency;
  /** Sounds played lately, newest last: avoided where another fits nearly as well. */
  recentFxIds?: string[];
  random?: () => number;
}

/** Each good moment's best-fitting sound, spaced out and capped by the frequency setting, in song order. Empty when off, with no grid, or with nothing that fits. */
export function proposeFx({ cues, pool, songMap, frequency, recentFxIds = [], random = Math.random }: ProposeFxInput): FxProposal[] {
  if (frequency === "off" || !isPhraseGridTrustworthy(songMap) || pool.length === 0) return [];
  const map = songMap;
  const bar = barSec(map);

  const perCue: FxProposal[] = [];
  for (const cue of cues) {
    const fits = pool
      .map((fx) => {
        const proposal = fitFxToCue(fx, cue, map);
        if (!proposal) return null;
        const recentRank = recentFxIds.lastIndexOf(fx.id);
        // A sound heard lately counts for less, the more recently the less, but never rules out the only good fit.
        const staleness = recentRank < 0 ? 1 : 0.6 + 0.4 * (1 - (recentRank + 1) / (recentFxIds.length + 1));
        return { ...proposal, score: proposal.score * staleness };
      })
      .filter((p): p is FxProposal => p !== null && p.score >= MIN_FIT_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, TIE_BREAK_CANDIDATES);
    if (fits.length === 0) continue;
    // Weighted by score squared, so a clearly better sound nearly always wins and near-equals alternate.
    const weights = fits.map((p) => p.score * p.score);
    let roll = random() * weights.reduce((sum, w) => sum + w, 0);
    let chosen = fits[0];
    for (let i = 0; i < fits.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosen = fits[i];
        break;
      }
    }
    perCue.push(chosen);
  }

  // One FX per moment, then the strongest first within the spacing and the per-song cap.
  const cueAt = new Map(cues.map((c) => [c.id, c.atSec]));
  const byStrength = [...perCue].sort((a, b) => b.score - a.score);
  const taken: FxProposal[] = [];
  for (const proposal of byStrength) {
    if (taken.length >= FX_MAX_PER_SONG[frequency]) break;
    const at = cueAt.get(proposal.cueId) ?? proposal.placement.startSec;
    const clash = taken.some(
      (t) =>
        Math.abs((cueAt.get(t.cueId) ?? 0) - at) < SAME_MOMENT_BARS * bar ||
        Math.abs(t.placement.startSec - proposal.placement.startSec) < FX_SPACING_SEC[frequency] ||
        // Two sounds must never overlap: only one FX plays at a time.
        (proposal.placement.startSec < t.placement.endSec && t.placement.startSec < proposal.placement.endSec)
    );
    if (!clash) taken.push(proposal);
  }
  return taken.sort((a, b) => a.placement.startSec - b.placement.startSec);
}
