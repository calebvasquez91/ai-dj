import type { Track } from "@/types/music";
import { genreFamilies } from "@/data/styles";
import { transitions, type TransitionCategory, type TransitionEntry } from "@/data/transitions";
import type { TrackAnalysis } from "@/lib/audio-analysis";

export const MIN_CROSSFADE_SEC = 3;
export const MAX_CROSSFADE_SEC = 30;
export const AUTO_DJ_OFF_FADE_SEC = 3;
/** Auto-DJ never lets a track ride past this much active playback before forcing a transition into the next queued track, regardless of the file's real length. */
export const MAX_ACTIVE_PLAY_SEC = 150;
/**
 * Auto-DJ won't reach for an *opportunistic* early transition (Double Drop,
 * Breakdown Mixing) before this much active playback — a floor, not a
 * ceiling, so a track always gets a minimum amount of airtime before the
 * engine starts looking for an excuse to leave it. Deliberately doesn't gate
 * the "near natural end" trigger: a track shorter than this floor still has
 * to be allowed to transition out before it runs out, and doesn't gate the
 * MAX_ACTIVE_PLAY_SEC ceiling either, since that's already well above this.
 * Manual "Mix Now" is a separate code path entirely and always stays instant.
 */
export const MIN_ACTIVE_PLAY_SEC = 90;

/** How long a track fades in from silence when it starts outside of a transition (a direct pick, or the very first track of a session) — avoids an abrupt full-volume start. */
export const TRACK_FADE_IN_SEC = 1.5;
/** How long the last track in the queue fades out before its natural end, since there's nothing queued to transition into. */
export const TRACK_FADE_OUT_SEC = 2.5;

/** How close (fractional, after best-octave adjustment) two BPMs need to be to tempo-sync, roughly a real turntable's pitch-fader range. */
const TEMPO_SYNC_MAX_DELTA = 0.08;

/**
 * How confident the tempo estimate needs to be before we bet a
 * precision-dependent technique (a blend, an EQ mix, a tempo ramp) on it.
 * This is stricter than audio-analysis's own MIN_TEMPO_CONFIDENCE (0.15,
 * which only decides "is this real data or the 120 BPM fallback") —
 * two tracks that *both* fell back to that same neutral 120 would
 * otherwise read as a perfect bpmDelta-of-0 tempo match and get blended,
 * even though nothing about their real tempos is actually known.
 */
export const MIN_TEMPO_CONFIDENCE_FOR_TRUST = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Equal-power crossfade curve: outGain^2 + inGain^2 stays constant at 1. */
export function equalPowerGains(progress: number): { outGain: number; inGain: number } {
  const p = clamp(progress, 0, 1);
  const angle = (p * Math.PI) / 2;
  return { outGain: Math.cos(angle), inGain: Math.sin(angle) };
}

/** Precomputed equal-power gain curves as Float32Arrays for AudioParam.setValueCurveAtTime. */
export function equalPowerCurves(steps = 64): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const { outGain, inGain } = equalPowerGains(i / (steps - 1));
    outCurve[i] = outGain;
    inCurve[i] = inGain;
  }
  return { outCurve, inCurve };
}

/** BPM ratio (a/b) adjusted to whichever octave (1x, 2x, 0.5x) sits closest to 1 — treats double/half-tempo as compatible. */
export function bestTempoRatio(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return 1;
  const raw = bpmA / bpmB;
  const candidates = [raw, raw * 2, raw / 2];
  return candidates.reduce((best, r) => (Math.abs(r - 1) < Math.abs(best - 1) ? r : best));
}

/**
 * Whether a real, independent-time-stretch tempo ramp is worth attempting
 * for this pair: both tempo readings need to be genuinely trustworthy (a
 * ramp toward a fabricated BPM is worse than not ramping at all — same
 * reasoning as MIN_TEMPO_CONFIDENCE_FOR_TRUST elsewhere), and the gap has
 * to sit within TEMPO_RAMP_MAX_BPM_DELTA. Below TEMPO_SYNC_MAX_DELTA a plain
 * tempoSync blend already handles it with no ramp needed; this only governs
 * whether it's worth reaching for the ramp at all.
 */
export function isTempoRampEligible(currentAnalysis: TrackAnalysis, nextAnalysis: TrackAnalysis): boolean {
  if (
    currentAnalysis.bpmConfidence < MIN_TEMPO_CONFIDENCE_FOR_TRUST ||
    nextAnalysis.bpmConfidence < MIN_TEMPO_CONFIDENCE_FOR_TRUST
  ) {
    return false;
  }
  const bpmDelta = Math.abs(bestTempoRatio(currentAnalysis.bpm, nextAnalysis.bpm) - 1);
  return bpmDelta <= TEMPO_RAMP_MAX_BPM_DELTA;
}

export function snapToBeatGrid(timeSec: number, beatGridOffsetSec: number, bpm: number): number {
  if (bpm <= 0) return Math.max(0, timeSec);
  const beatLenSec = 60 / bpm;
  const beatsSinceOffset = (timeSec - beatGridOffsetSec) / beatLenSec;
  const snappedBeats = Math.round(beatsSinceOffset);
  return Math.max(0, beatGridOffsetSec + snappedBeats * beatLenSec);
}

function windowBeatsForTransition(t: TransitionEntry, tempoSync: boolean, bpmDelta: number): number {
  switch (t.category) {
    case "cut":
      // A real hard cut is near-instant; MIN_WINDOW_SEC_BY_CATEGORY (not
      // MIN_CROSSFADE_SEC) is what actually floors this in seconds.
      return t.id === "hard-cut" ? 0.25 : 1;
    case "scratch":
      // Transform Chop is a faster, more clipped toggle than a beat juggle.
      return t.id === "transform-chop" ? 2 : 4;
    case "brake":
      return 4;
    case "spin-up":
      return 4;
    case "riser":
      return 16;
    case "blend":
      return tempoSync && bpmDelta < 0.03 ? 32 : 16;
    case "eq-filter":
      return tempoSync ? 16 : 8;
    case "eq-kill":
      return 8;
    case "reverb":
      return 12;
    case "drop":
      return 16;
    case "tempo-ramp":
      // Deliberately long — the whole point is a gradual, extended shift.
      return 64;
    case "tag-sample":
      return 2;
    case "word-play":
      return 2;
    case "effects":
      return 8;
    case "digital":
      return 16;
    default:
      return 8;
  }
}

/**
 * Per-category floor for the transition window, in seconds — a flat
 * MIN_CROSSFADE_SEC applied to every category would force even a "hard cut"
 * or scratch-style stutter into at least a multi-second crossfade, which is
 * exactly why cuts and chops used to sound like generic fades.
 */
const MIN_WINDOW_SEC_BY_CATEGORY: Record<TransitionCategory, number> = {
  cut: 0.15,
  scratch: 0.6,
  brake: 1.5,
  "spin-up": 1.5,
  riser: 4,
  blend: MIN_CROSSFADE_SEC,
  "eq-filter": MIN_CROSSFADE_SEC,
  "eq-kill": MIN_CROSSFADE_SEC,
  reverb: MIN_CROSSFADE_SEC,
  drop: MIN_CROSSFADE_SEC,
  "tempo-ramp": 8,
  "tag-sample": 1.5,
  "word-play": 1.5,
  effects: MIN_CROSSFADE_SEC,
  digital: MIN_CROSSFADE_SEC,
  vocal: MIN_CROSSFADE_SEC,
};

export type TransitionEffect =
  | "none"
  | "highpass-sweep"
  | "lowpass-sweep"
  | "echo-tail"
  | "brake"
  | "spin-up"
  | "riser"
  | "stutter-gate"
  | "scratch-chirp"
  | "eq-kill"
  | "reverb-wash"
  | "tag-sample"
  | "word-play";

const TRANSITION_EFFECT_BY_ID: Record<string, TransitionEffect> = {
  "bass-swap": "highpass-sweep",
  "filter-sweep": "lowpass-sweep",
  "echo-out": "echo-tail",
  spinback: "brake",
  "spin-up": "spin-up",
  "riser-uplift": "riser",
  "scratch-transition": "scratch-chirp",
  "beat-juggle-transition": "stutter-gate",
  "transform-chop": "scratch-chirp",
  "eq-kill-mix": "eq-kill",
  "reverb-wash": "reverb-wash",
  "tag-drop": "tag-sample",
  "word-play-drop": "word-play",
};

/**
 * Gain shape for a "brake"/spinback transition: the outgoing track holds at
 * full volume while it's audibly slowing down (all the character is in the
 * pitch ramp, driven separately by playbackRate), then both decks
 * equal-power crossfade in the final stretch as the incoming track drops
 * in at full tempo.
 */
export function brakeGainCurves(
  steps = 64,
  dropStartRatio = 0.75
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    if (p < dropStartRatio) {
      outCurve[i] = 1;
      inCurve[i] = 0;
    } else {
      const dropProgress = (p - dropStartRatio) / (1 - dropStartRatio);
      const { outGain, inGain } = equalPowerGains(dropProgress);
      outCurve[i] = outGain;
      inCurve[i] = inGain;
    }
  }
  return { outCurve, inCurve };
}

/**
 * Gain shape for a "spin up" transition — the mirror of a brake: the
 * outgoing track drops out quickly at the start while the incoming track
 * comes up early and holds, so its playbackRate ramp (driven separately,
 * from slow up to full speed) is clearly audible the whole time rather
 * than being masked by a still-present outgoing track.
 */
export function spinUpGainCurves(
  steps = 64,
  riseEndRatio = 0.25
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    if (p < riseEndRatio) {
      const riseProgress = p / riseEndRatio;
      const { outGain, inGain } = equalPowerGains(riseProgress);
      outCurve[i] = outGain;
      inCurve[i] = inGain;
    } else {
      outCurve[i] = 0;
      inCurve[i] = 1;
    }
  }
  return { outCurve, inCurve };
}

/**
 * Alternating hard on/off gain gate for scratch/beat-juggle-style
 * transitions — toggles between the outgoing and incoming deck, always
 * landing on the incoming deck for the final segment.
 */
export function stutterGateCurves(
  steps = 64,
  toggleCount = 8
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    const toggleIndex = Math.min(toggleCount - 1, Math.floor(p * toggleCount));
    const incomingIsUp = toggleIndex % 2 === 1 || toggleIndex === toggleCount - 1;
    outCurve[i] = incomingIsUp ? 0 : 1;
    inCurve[i] = incomingIsUp ? 1 : 0;
  }
  return { outCurve, inCurve };
}

/**
 * Gain shape for a matched mashup's full overlap window: both decks ease
 * to a shared mid-level (so the combined loudness of two full mixes
 * playing together doesn't spike), hold there for the bulk of the
 * section, then resolve down to a normal single-track handoff using the
 * same equal-power taper every other blend uses — "no sudden stop"
 * applies here exactly as everywhere else, just stretched across bars
 * instead of seconds.
 */
export function mashupGainCurves(
  steps = 128,
  holdStartRatio = 0.15,
  holdEndRatio = 0.7,
  midLevel = 0.75
): { outCurve: Float32Array; inCurve: Float32Array } {
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const p = i / (steps - 1);
    if (p < holdStartRatio) {
      const local = p / holdStartRatio;
      outCurve[i] = 1 - local * (1 - midLevel);
      inCurve[i] = local * midLevel;
    } else if (p < holdEndRatio) {
      outCurve[i] = midLevel;
      inCurve[i] = midLevel;
    } else {
      const local = (p - holdEndRatio) / (1 - holdEndRatio);
      const { outGain, inGain } = equalPowerGains(local);
      outCurve[i] = midLevel * outGain;
      inCurve[i] = midLevel + (1 - midLevel) * inGain;
    }
  }
  return { outCurve, inCurve };
}

// ---------------------------------------------------------------------------
// Harmonic mixing — Camelot wheel key-compatibility scoring. This is a
// selection *input* (which transition/pairing reads as musically sound),
// not a distinct audible technique, so it feeds transition scoring rather
// than becoming its own TransitionEntry.
// ---------------------------------------------------------------------------

export const MIN_KEY_CONFIDENCE_FOR_SCORING = 0.15;

function parseCamelotCode(code: string): { number: number; letter: "A" | "B" } | null {
  const m = code.match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  return { number: parseInt(m[1], 10), letter: m[2] as "A" | "B" };
}

/** 2 = identical key, 1 = relative major/minor or adjacent on the wheel, 0 = not compatible (or unknown). */
export function camelotCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const pa = parseCamelotCode(a);
  const pb = parseCamelotCode(b);
  if (!pa || !pb) return 0;
  if (pa.number === pb.number && pa.letter === pb.letter) return 2;
  if (pa.number === pb.number) return 1;
  const diff = Math.min((pa.number - pb.number + 12) % 12, (pb.number - pa.number + 12) % 12);
  if (diff === 1 && pa.letter === pb.letter) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// DJ Set Modes — a vibe/context preset that biases which transition
// *techniques* get chosen. There's no song-selection engine here (that
// would need real metadata this app doesn't have — genre tags, popularity,
// crowd sensing), so modes work on the one lever this engine actually
// controls: steering Wedding/Chill away from flashy, risky effects and
// toward clean blends, while Party/Open-Format lean into bigger, bolder
// moments. Soft score bonuses/penalties, not hard exclusions — per the
// "AI is an assistant, never the boss" principle, a mode should make a
// technique unlikely, not impossible, if it's truly the only thing that fits.
// ---------------------------------------------------------------------------

export type DjSetMode = "auto" | "club" | "wedding" | "party" | "chill" | "open-format";

const MODE_CATEGORY_BIAS: Record<DjSetMode, Partial<Record<TransitionCategory, number>>> = {
  auto: {},
  club: {
    blend: 4,
    "eq-filter": 4,
    "eq-kill": 3,
    digital: 3,
    scratch: -4,
    brake: -3,
    "spin-up": -3,
    riser: -2,
  },
  wedding: {
    blend: 6,
    digital: 6,
    cut: 2,
    "eq-filter": 2,
    scratch: -10,
    "tag-sample": -10,
    "word-play": -10,
    riser: -8,
    brake: -8,
    "spin-up": -8,
    reverb: -6,
    drop: -6,
  },
  party: {
    "tag-sample": 6,
    "word-play": 6,
    riser: 5,
    drop: 4,
    "spin-up": 3,
    effects: 3,
    digital: 2,
  },
  chill: {
    blend: 6,
    reverb: 4,
    "eq-filter": 3,
    "tempo-ramp": 2,
    brake: -6,
    "spin-up": -6,
    scratch: -10,
    "tag-sample": -10,
    "word-play": -10,
    riser: -8,
    drop: -6,
  },
  "open-format": {
    "tempo-ramp": 6,
    brake: 4,
    "spin-up": 4,
    cut: 3,
    drop: 2,
    "word-play": 2,
  },
};

/**
 * Score for how well a transition's BPM tolerance fits the actual gap.
 * Within tolerance is a flat +10 regardless of technique (a hard cut
 * doesn't care if it's 1% or 40% off). Outside tolerance, the penalty
 * scales with how far over — a technique built around tight tempo-sync
 * (a blend, an EQ mix) should score sharply worse the more mismatched the
 * pair actually is, instead of a flat -5 that genre/persona bonuses can
 * easily paper over regardless of how badly the tempos actually clash.
 *
 * `varietyBias` softens this penalty (higher floor, gentler slope) — the
 * default penalty is correct (it's what stops badly-mismatched tracks from
 * getting blended), but it also means tempo-insensitive categories like
 * "cut" win by default whenever tempo is uncertain, which real, varied-tempo
 * libraries hit constantly. Variety bias trades some of that safety for
 * more willingness to take a chance on a bolder technique.
 */
function bpmFitScore(bpmDelta: number, idealBpmDeltaMax: number, varietyBias = false): number {
  if (bpmDelta <= idealBpmDeltaMax) return 10;
  if (!Number.isFinite(idealBpmDeltaMax)) return 10;
  const excessRatio = (bpmDelta - idealBpmDeltaMax) / Math.max(idealBpmDeltaMax, 0.01);
  const slope = varietyBias ? 8 : 15;
  const floor = varietyBias ? -15 : -25;
  return Math.max(floor, -5 - excessRatio * slope);
}

/** How much the anti-repetition penalty scales under variety bias — pushes harder against repeating the same pick. */
const REPETITION_PENALTY = 7;
const REPETITION_PENALTY_VARIETY = 14;
/** Flat penalty applied to the "cut" category under variety bias — the thing that otherwise wins by default whenever tempo is uncertain. */
const VARIETY_CUT_PENALTY = 6;

export interface TransitionContext {
  bpmDelta: number;
  tempoSync: boolean;
  genreHint: string | null;
  personaDjNames: string[];
  camelotScore?: number; // 0-2, from camelotCompatibility() — omit/0 when key confidence is too low to trust
  djMode?: DjSetMode;
  /** transitionIds used for the last few transitions, most recent last — discourages picking the exact same technique over and over when several score similarly. */
  recentTransitionIds?: string[];
  /** Pins the pick to this exact transition id (must be executable), bypassing scoring entirely — a manual override for the upcoming mix. */
  forceTransitionId?: string | null;
  /** Candidates to skip this round (treated as unpickable) — used by "reroll" to cycle to the next-best alternative instead of the top score. */
  excludeTransitionIds?: string[];
  /** Trades some tempo-mismatch safety for more willingness to pick a bold technique, and pushes harder against repeating the last few picks. */
  varietyBias?: boolean;
  /** Per-category score adjustment learned from the user's own manual picks/rerolls over time (see lib/dj-weights.ts) — same shape and role as MODE_CATEGORY_BIAS, just tuned by behavior instead of a fixed preset. */
  categoryWeights?: Partial<Record<TransitionCategory, number>>;
}

/**
 * How far apart two tracks' tempos can be (after best-octave adjustment)
 * before a tempo-ramp stops sounding like a natural glide — the same 20%
 * ceiling mashup-engine.ts's MASHUP_MAX_TEMPO_DELTA already established as
 * where SoundTouchJS's WSOLA artifacts get noticeable, reused rather than
 * inventing a second threshold. If anything a solo pre-transition ramp
 * exposes those artifacts *more* than a mashup does (there's no second
 * layer of audio masking them), so this is already the generous end, not
 * the conservative one. Beyond this, scoring excludes the category outright
 * and a mismatched pair falls back to whatever wins among the other
 * (filter/EQ-driven) categories instead.
 */
export const TEMPO_RAMP_MAX_BPM_DELTA = 0.2;

function scoreTransition(t: TransitionEntry, ctx: TransitionContext): number {
  if (!t.executable) return -Infinity;
  if (ctx.excludeTransitionIds?.includes(t.id)) return -Infinity;
  if (t.category === "tempo-ramp" && ctx.bpmDelta > TEMPO_RAMP_MAX_BPM_DELTA) return -Infinity;
  let score = 0;
  score += bpmFitScore(ctx.bpmDelta, t.idealBpmDeltaMax, ctx.varietyBias);
  if (ctx.genreHint) {
    if (t.idealGenres.includes(ctx.genreHint)) score += 6;
    else if (t.idealGenres.length > 0) score -= 2;
  }
  if (ctx.personaDjNames.some((name) => t.exampleDjs.includes(name))) score += 8;
  if (t.idealGenres.length === 0) score += 1;
  score += (ctx.camelotScore ?? 0) * 3;
  score += MODE_CATEGORY_BIAS[ctx.djMode ?? "auto"][t.category] ?? 0;
  score += ctx.categoryWeights?.[t.category] ?? 0;
  if (ctx.varietyBias && t.category === "cut") score -= VARIETY_CUT_PENALTY;
  if (ctx.recentTransitionIds?.includes(t.id)) {
    score -= ctx.varietyBias ? REPETITION_PENALTY_VARIETY : REPETITION_PENALTY;
  }
  return score;
}

function bestScoringTransition(ctx: TransitionContext): { entry: TransitionEntry; score: number } {
  let best = transitions[0];
  let bestScore = -Infinity;
  for (const t of transitions) {
    const score = scoreTransition(t, ctx);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return { entry: best, score: bestScore };
}

export function chooseTransition(ctx: TransitionContext): TransitionEntry {
  if (ctx.forceTransitionId) {
    const forced = transitions.find((t) => t.id === ctx.forceTransitionId && t.executable);
    if (forced) return forced;
  }
  const result = bestScoringTransition(ctx);
  // Excluding candidates (reroll) can in principle exhaust every viable
  // option — fall back to unrestricted scoring rather than ever returning
  // an arbitrary/wrong pick.
  if (result.score === -Infinity && ctx.excludeTransitionIds?.length) {
    return bestScoringTransition({ ...ctx, excludeTransitionIds: [] }).entry;
  }
  return result.entry;
}

export interface TransitionPlan {
  transitionId: string;
  category: TransitionCategory;
  windowSec: number;
  windowBeats: number;
  incomingEntryOffsetSec: number;
  tempoSync: boolean;
  tempoRatioStart: number; // incoming deck's playbackRate at transition start (1 = no adjustment)
  effect: TransitionEffect;
  rationale: string;
}

interface PlanTransitionArgs {
  current: { track: Track; analysis: TrackAnalysis };
  next: { track: Track; analysis: TrackAnalysis };
  genreHint?: string | null;
  overrideSec?: number | null;
  /** The outgoing track's current playback position, if known — enables phase-locking the incoming track's entry point to the outgoing track's current beat position (not just its own beat grid), so the downbeats actually land together instead of just matching tempo. */
  currentElapsedSec?: number | null;
  djMode?: DjSetMode;
  /** transitionIds used for the last few transitions, most recent last — discourages repeating the exact same technique back-to-back. */
  recentTransitionIds?: string[];
  /** Pins the pick to this exact transition id for this one mix, bypassing scoring — cleared by the caller after the mix starts. */
  forceTransitionId?: string | null;
  /** transitionIds to skip this round — used by "reroll" to cycle to the next-best alternative. */
  excludeTransitionIds?: string[];
  /** Trades some tempo-mismatch safety for more willingness to pick a bold technique — see bpmFitScore(). */
  varietyBias?: boolean;
  /** Per-category score adjustment learned from the user's own manual picks/rerolls over time — see lib/dj-weights.ts. */
  categoryWeights?: Partial<Record<TransitionCategory, number>>;
}

function buildRationale(
  t: TransitionEntry,
  genreHint: string | null,
  tempoSync: boolean,
  camelotScore: number,
  hasConfidentTempo: boolean,
  wasForced: boolean
): string {
  const harmonicNote = camelotScore >= 2 ? " Same key." : camelotScore === 1 ? " Harmonically compatible keys." : "";
  if (wasForced) {
    return `${t.name} — your pick. ${t.description}` + harmonicNote;
  }
  const genre = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const djNames = (genre?.exampleDjs.length ? genre.exampleDjs : t.exampleDjs).slice(0, 2).join(" & ");
  const tempoNote = tempoSync ? "tempo-synced" : hasConfidentTempo ? "beat-aligned" : "tempo unclear, played safe";
  const base = djNames
    ? `${t.name}, ${genreHint ? `channeling ${djNames}'s ${genre?.name ?? ""} energy` : `in the style of ${djNames}`} — ${tempoNote}. ${t.description}`
    : `${t.name} — ${tempoNote}. ${t.description}`;
  return base + harmonicNote;
}

/**
 * Plans a musically-aware transition between two tracks: picks a transition
 * style from the repertoire in data/transitions.ts (factoring in tempo,
 * genre, persona, and Camelot-wheel key compatibility), sizes the overlap
 * window in beats (not an arbitrary second count), and snaps the incoming
 * track's entry point to its own beat grid near its energy-onset — never a
 * bare 0 — or, for a Double Drop, to land its own drop at the window's end.
 */
export function planTransition({
  current,
  next,
  genreHint = null,
  overrideSec = null,
  currentElapsedSec = null,
  djMode = "auto",
  recentTransitionIds = [],
  forceTransitionId = null,
  excludeTransitionIds = [],
  varietyBias = false,
  categoryWeights = {},
}: PlanTransitionArgs): TransitionPlan {
  const bpmDelta = Math.abs(bestTempoRatio(current.analysis.bpm, next.analysis.bpm) - 1);
  // Two tracks that both fell back to the same neutral 120 BPM (low
  // confidence, not real data) would otherwise read as a perfect
  // bpmDelta-of-0 match. Require real confidence on both sides before
  // trusting the numbers enough to call it tempo-synced or feed them to
  // scoring as-is — an inflated "we don't actually know" delta pushes
  // precision-dependent techniques (blends, EQ mixes) to score the way
  // they should when the tempo match is fabricated, not real.
  const hasConfidentTempo =
    current.analysis.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST &&
    next.analysis.bpmConfidence >= MIN_TEMPO_CONFIDENCE_FOR_TRUST;
  const tempoSync = hasConfidentTempo && bpmDelta <= TEMPO_SYNC_MAX_DELTA;
  const scoringBpmDelta = hasConfidentTempo ? bpmDelta : Math.max(bpmDelta, TEMPO_SYNC_MAX_DELTA + 0.05);
  const genreFamily = genreHint ? genreFamilies.find((g) => g.id === genreHint) : null;
  const personaDjNames = genreFamily?.exampleDjs ?? [];
  const camelotScore =
    current.analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING &&
    next.analysis.keyConfidence >= MIN_KEY_CONFIDENCE_FOR_SCORING
      ? camelotCompatibility(current.analysis.camelotKey, next.analysis.camelotKey)
      : 0;

  const transition = chooseTransition({
    bpmDelta: scoringBpmDelta,
    tempoSync,
    genreHint,
    personaDjNames,
    camelotScore,
    djMode,
    recentTransitionIds,
    forceTransitionId,
    excludeTransitionIds,
    varietyBias,
    categoryWeights,
  });
  const wasForced = Boolean(forceTransitionId) && transition.id === forceTransitionId;

  const windowBeats = windowBeatsForTransition(transition, tempoSync, bpmDelta);
  const effectiveBpm = current.analysis.bpm > 0 ? current.analysis.bpm : 120;
  const minWindowSec = MIN_WINDOW_SEC_BY_CATEGORY[transition.category];
  const windowSec =
    overrideSec != null
      ? clamp(overrideSec, MIN_CROSSFADE_SEC, MAX_CROSSFADE_SEC)
      : clamp((windowBeats * 60) / effectiveBpm, minWindowSec, MAX_CROSSFADE_SEC);

  // A Tempo Ramp deliberately bridges a wider gap than normal tempoSync
  // allows, gradually, across its unusually long window — everything else
  // only attempts a tempo-ratio adjustment when tracks are already close.
  // Either way, only worth attempting when the tempo readings are actually
  // trustworthy — ramping toward a fabricated ratio is worse than not
  // ramping at all.
  const attemptsTempoRatio = hasConfidentTempo && (tempoSync || transition.category === "tempo-ramp");
  const tempoRatioStart = attemptsTempoRatio
    ? bestTempoRatio(current.analysis.bpm, next.analysis.bpm)
    : 1;

  // Double Drop: target the incoming track's own drop to land right at the
  // end of the window, instead of just its post-intro energy onset — the
  // whole point of this technique is the two drops coinciding.
  const baseEntryOffsetSec =
    transition.category === "drop" && next.analysis.dropAtSec != null
      ? snapToBeatGrid(
          Math.max(0, next.analysis.dropAtSec - windowSec),
          next.analysis.beatGridOffsetSec,
          next.analysis.bpm
        )
      : snapToBeatGrid(next.analysis.energyOnsetSec, next.analysis.beatGridOffsetSec, next.analysis.bpm);
  const latestSensibleEntrySec = Math.max(0, next.track.durationSec - MIN_CROSSFADE_SEC);

  // Phase-lock: snapping to the incoming track's own beat grid gets the
  // tempo right, but says nothing about where the outgoing track currently
  // sits within ITS beat cycle — so the two downbeats can still land apart
  // even though both tracks are on-tempo. Nudge the entry point forward by
  // the outgoing track's current sub-beat phase (converted into incoming-
  // track-time via the rate the incoming deck starts at) so the two
  // downbeats actually coincide the moment the incoming track starts.
  let entryOffsetSec = baseEntryOffsetSec;
  if (currentElapsedSec != null && current.analysis.bpm > 0) {
    const fromBeatLenSec = 60 / current.analysis.bpm;
    const fromPhaseSec =
      (((currentElapsedSec - current.analysis.beatGridOffsetSec) % fromBeatLenSec) + fromBeatLenSec) %
      fromBeatLenSec;
    entryOffsetSec += fromPhaseSec * tempoRatioStart;
  }
  const incomingEntryOffsetSec = clamp(entryOffsetSec, 0, latestSensibleEntrySec);

  return {
    transitionId: transition.id,
    category: transition.category,
    windowSec,
    windowBeats,
    incomingEntryOffsetSec,
    tempoSync,
    tempoRatioStart,
    effect: TRANSITION_EFFECT_BY_ID[transition.id] ?? "none",
    rationale: buildRationale(transition, genreHint, tempoSync, camelotScore, hasConfidentTempo, wasForced),
  };
}

/** Simple flat-timer fade, used only for the Auto-DJ-off tail fade and as a last resort if audio decoding itself fails. */
export function planSimpleFade(windowSec = AUTO_DJ_OFF_FADE_SEC): TransitionPlan {
  return {
    transitionId: "hard-cut",
    category: "cut",
    windowSec: clamp(windowSec, 1, MAX_CROSSFADE_SEC),
    windowBeats: 0,
    incomingEntryOffsetSec: 0,
    tempoSync: false,
    tempoRatioStart: 1,
    effect: "none",
    rationale: "Simple fade (Auto-DJ off, or analysis unavailable).",
  };
}
