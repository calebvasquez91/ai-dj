/**
 * The genre-aware pair resolver: given two songs' genres, the sync report for the pair and the event profile, which transition STYLE and tools to
 * ask for. Pure, and it only chooses: a beat-synced blend is handed to the existing sync pipeline (lib/syncEngine.ts, lib/songSync.ts) exactly as it is
 * today, with `bars` used only as an input to the existing crossfade length. Nothing here touches the sync engine, the morph, the master clock or
 * the audio op queue.
 *
 * Flow: rankTransitions() lists every plan that is allowed, best first (the Audio Engineer can veto some, the DJ picks among the rest: Phase 3);
 * resolveTransition() is the top one with the runner-up as its fallbackPlan.
 */
import { resolveGenreTags } from "@/lib/genre/combine";
import { DEFAULT_GENRE_RULE, GENRE_TRANSITIONS, type BeatSync, type GenreTransitionRule, type TransitionStyle, type TransitionTool } from "@/lib/genreTransitions";
import type { DjSetMode } from "@/lib/mix-engine";
import type { SyncReport } from "@/lib/syncEngine";
import type { GenreTag } from "@/types/music";
import * as flags from "@/lib/featureFlags";

/** The slice of a track the planner reads. */
export interface PlannerTrack {
  genreTags?: readonly GenreTag[];
  /** The resolved best genre, used when there are no tags. */
  genre?: string;
}

/** The event profile's say in a tie: the set mode and an optional default crossfade length in bars. */
export interface PlannerProfile {
  djMode?: DjSetMode;
  crossfadeBars?: number;
}

/** What a plan needs from the sync report: tempo and key facts only. */
export type PlannerSyncReport = Pick<SyncReport, "bpmDelta" | "trackA_bpm" | "tempoConfident" | "keyCompatibility" | "keyConfident" | "bpmStrategy">;

export interface PlannerOptions {
  /** Tools whose own flag is on. Default: read from lib/featureFlags.ts. A tool not in here never appears in a plan. */
  enabledTools?: ReadonlySet<TransitionTool>;
  /** Whether vocal separation is on (a vocal swap needs it). Default: VOCAL_SPLIT_ENABLED. */
  vocalSplit?: boolean;
  /** False when the two songs' vocal activity has no gap in the window to hand the vocal over in (lib/vocalSwap.ts planVocalSwap returned null): the swap is then not offered. Default true (unknown is not a veto). */
  vocalSwapFeasible?: boolean;
  /** The outgoing song ends abruptly (lib/echoOut.ts detectAbruptEnding): echo out, hold 3-5 s, then start the next at its most energetic section. */
  abruptEnding?: boolean;
  /** Replaces the shared table (the admin's edits and a device's own overrides arrive this way). */
  rules?: Readonly<Record<string, GenreTransitionRule>>;
}

export interface GenreTransitionPlan {
  style: TransitionStyle;
  /** Length in bars: of the blend, or of the bridge/echo that carries the hand-over. 0 for a silence-then-start. */
  bars: number;
  tools: TransitionTool[];
  /** True when this is a beat-synced blend that the existing sync pipeline should run unchanged. */
  keepSync: boolean;
  /** Why, in plain words ("tempo gap of 14 BPM", "both House"). */
  reason: string;
  /** 0-1. */
  confidence: number;
  /** The next-best plan, one level deep (its own fallbackPlan is null). */
  fallbackPlan: GenreTransitionPlan | null;
  /** The two genres this plan was made for, for the readout and the stats. */
  genrePair: { a: string; b: string };
}

/** The plan before it has a runner-up. */
export type RankedPlan = Omit<GenreTransitionPlan, "fallbackPlan"> & { score: number };

// ---- The tool each style needs, and which styles keep the beat grid ------------------------------------------------------------------

const STYLE_TOOL: Partial<Record<TransitionStyle, TransitionTool>> = {
  "echo-out": "echo",
  // The echo-out module is what holds the silence and starts the next song at its peak, so a silence-then-start needs it too.
  "silence-then-start": "echo",
  "scratch-bridge": "scratch",
  "instrumental-bridge": "instrumentalBridge",
  "bass-swap": "eq",
  "filter-sweep": "eq",
};

/** Styles that run on the beat grid: they only make sense when both songs have a beat to sync. */
const GRID_STYLES: ReadonlySet<TransitionStyle> = new Set<TransitionStyle>(["long-blend", "medium-blend", "short-blend", "bass-swap", "filter-sweep"]);
/** Styles a track with no beat can still take. */
const BEATLESS_STYLES: ReadonlySet<TransitionStyle> = new Set<TransitionStyle>(["fade", "echo-out", "silence-then-start"]);
const SAFE_CHAIN: readonly TransitionStyle[] = ["quick-cut", "echo-out", "fade"];

const BEAT_RANK: Record<BeatSync, number> = { required: 3, preferred: 2, unreliable: 1, none: 0 };

/** How many bars a style spans by default, and the band a blend style must stay in. */
const STYLE_BARS: Record<TransitionStyle, { min: number; max: number; default: number }> = {
  "long-blend": { min: 16, max: 32, default: 24 },
  "medium-blend": { min: 8, max: 16, default: 12 },
  "short-blend": { min: 4, max: 8, default: 6 },
  "quick-cut": { min: 1, max: 2, default: 1 },
  "echo-out": { min: 1, max: 4, default: 2 },
  fade: { min: 2, max: 8, default: 4 },
  "silence-then-start": { min: 0, max: 0, default: 0 },
  "vocal-swap": { min: 4, max: 16, default: 8 },
  "instrumental-bridge": { min: 4, max: 8, default: 4 },
  "scratch-bridge": { min: 1, max: 2, default: 1 },
  "filter-sweep": { min: 4, max: 16, default: 8 },
  "bass-swap": { min: 8, max: 32, default: 16 },
};

/** The tools that are on, from the flags. */
export function enabledToolsFromFlags(): Set<TransitionTool> {
  const on = new Set<TransitionTool>();
  if (flags.SCRATCH_ENABLED) on.add("scratch");
  if (flags.STUTTER_ENABLED) { on.add("stutter"); on.add("roll"); }
  if (flags.INSTRUMENTAL_BRIDGE_ENABLED) on.add("instrumentalBridge");
  if (flags.DJ_EQ_ENABLED) on.add("eq");
  if (flags.ECHO_OUT_ENABLED) on.add("echo");
  return on;
}

// ---- Reading a track's genres --------------------------------------------------------------------------------------------------------

/** A track's genres, best first: its primary, then its secondaries that reach the 0.5 keep line (the combiner already drops the rest). */
export function genresOfTrack(track: PlannerTrack): string[] {
  const resolved = resolveGenreTags([...(track.genreTags ?? [])]).genres.map((g) => g.genre);
  if (resolved.length > 0) return resolved;
  return track.genre ? [track.genre] : [];
}

function ruleFor(table: Readonly<Record<string, GenreTransitionRule>>, genre: string | undefined): GenreTransitionRule {
  return (genre ? table[genre] : undefined) ?? DEFAULT_GENRE_RULE;
}

/** Every style a track's genres accept: the primary's, widened by its secondaries'. */
function acceptedStyles(table: Readonly<Record<string, GenreTransitionRule>>, genres: readonly string[]): Set<TransitionStyle> {
  const out = new Set<TransitionStyle>();
  const list = genres.length > 0 ? genres : [undefined];
  for (const g of list) for (const s of ruleFor(table, g).preferredStyles) out.add(s);
  return out;
}

const rankScore = (rule: GenreTransitionRule, style: TransitionStyle): number => {
  const i = rule.preferredStyles.indexOf(style);
  return i < 0 ? 0 : (rule.preferredStyles.length - i) / rule.preferredStyles.length;
};

// ---- The mode's say in a tie ---------------------------------------------------------------------------------------------------------

/** A small bias, used only to order styles that score the same: club and open-format like longer blends, party likes shorter, chill likes soft endings. */
function modeBias(mode: DjSetMode | undefined, style: TransitionStyle): number {
  const long = style === "long-blend" || style === "bass-swap" || style === "filter-sweep";
  const short = style === "quick-cut" || style === "short-blend" || style === "scratch-bridge";
  const soft = style === "fade" || style === "echo-out" || style === "silence-then-start";
  switch (mode) {
    case "club": return long ? 0.03 : 0;
    case "party": return short ? 0.03 : 0;
    case "chill": return soft ? 0.03 : 0;
    case "wedding": return style === "medium-blend" || style === "fade" ? 0.03 : 0;
    default: return 0;
  }
}

// ---- The ranked plans ----------------------------------------------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The bars a plan asks for: the style's own default (or the event profile's), kept inside the style's band and inside what BOTH genres allow for a blend. */
function barsFor(style: TransitionStyle, ruleA: GenreTransitionRule, ruleB: GenreTransitionRule, profile: PlannerProfile | undefined): number {
  const band = STYLE_BARS[style];
  if (band.max === 0) return 0;
  let bars = profile?.crossfadeBars && GRID_STYLES.has(style) ? profile.crossfadeBars : band.default;
  bars = clamp(bars, band.min, band.max);
  if (GRID_STYLES.has(style)) {
    const lo = Math.max(ruleA.blendBarsRange[0], ruleB.blendBarsRange[0]);
    const hi = Math.min(ruleA.blendBarsRange[1], ruleB.blendBarsRange[1]);
    // Disjoint ranges (a 16-32 genre against a 1-4 one): the shorter genre's range wins, because a blend that long is what it cannot take.
    const [from, to] = lo <= hi ? [lo, hi] : [Math.min(ruleA.blendBarsRange[0], ruleB.blendBarsRange[0]), Math.min(ruleA.blendBarsRange[1], ruleB.blendBarsRange[1])];
    bars = clamp(bars, from, Math.max(from, to));
    // The band stays: a "short blend" never grows past 8 bars because a genre allows more.
    bars = clamp(bars, band.min, band.max);
  }
  return bars;
}

interface Gap {
  tempoPct: number;
  tempoExceedsBoth: boolean;
  keyClashBoth: boolean;
  description: string | null;
}

function gapOf(report: PlannerSyncReport, ruleA: GenreTransitionRule, ruleB: GenreTransitionRule): Gap {
  const pct = report.tempoConfident && report.trackA_bpm > 0 ? (report.bpmDelta / report.trackA_bpm) * 100 : 0;
  const tempoExceedsBoth = report.tempoConfident && pct > ruleA.bpmTolerancePct && pct > ruleB.bpmTolerancePct;
  // A key clash is a problem for a genre that cares about key (importance >= 0.5); the pair needs a bridge when it matters to both.
  const keyClashBoth = report.keyConfident && report.keyCompatibility === "clash" && ruleA.keyMatchImportance >= 0.5 && ruleB.keyMatchImportance >= 0.5;
  const description = tempoExceedsBoth ? `tempo gap of ${Math.round(report.bpmDelta)} BPM` : keyClashBoth ? "the keys clash" : null;
  return { tempoPct: pct, tempoExceedsBoth, keyClashBoth, description };
}

/**
 * Every plan the genres, the sync report and the flags allow, best first. At least one is always returned: a fade needs no tool and no beat.
 */
export function rankTransitions(trackA: PlannerTrack, trackB: PlannerTrack, report: PlannerSyncReport, profile?: PlannerProfile, options: PlannerOptions = {}): RankedPlan[] {
  const table = options.rules ?? GENRE_TRANSITIONS;
  const tools = options.enabledTools ?? enabledToolsFromFlags();
  const vocalSplit = options.vocalSplit ?? flags.VOCAL_SPLIT_ENABLED;
  const genresA = genresOfTrack(trackA);
  const genresB = genresOfTrack(trackB);
  const nameA = genresA[0] ?? "Unknown";
  const nameB = genresB[0] ?? "Unknown";
  const ruleA = ruleFor(table, genresA[0]);
  const ruleB = ruleFor(table, genresB[0]);
  const sameGenre = genresA[0] !== undefined && genresA[0] === genresB[0];
  const gap = gapOf(report, ruleA, ruleB);
  const noBeat = ruleA.beatSync === "none" || ruleB.beatSync === "none";
  const unreliable = ruleA.beatSync === "unreliable" || ruleB.beatSync === "unreliable";

  /** A style is usable when its tool and flag are on, and the beat situation allows it. */
  const usable = (style: TransitionStyle): boolean => {
    const needs = STYLE_TOOL[style];
    if (needs && !tools.has(needs)) return false;
    if (style === "vocal-swap" && (!vocalSplit || options.vocalSwapFeasible === false)) return false;
    if (noBeat && !BEATLESS_STYLES.has(style)) return false;
    if (unreliable && (style === "long-blend" || style === "bass-swap" || style === "filter-sweep")) return false;
    if (gap.tempoExceedsBoth && GRID_STYLES.has(style)) return false;
    return true;
  };

  // The pool: what both genres accept; with nothing in common, the styles of whichever genre is less reliable on the beat (quick-cut, echo-out or fade beat a long blend).
  const acceptA = acceptedStyles(table, genresA);
  const acceptB = acceptedStyles(table, genresB);
  const overlap = [...acceptA].filter((s) => acceptB.has(s));
  const lowerRule = BEAT_RANK[ruleA.beatSync] <= BEAT_RANK[ruleB.beatSync] ? ruleA : ruleB;
  const scoreOf = (s: TransitionStyle): number => rankScore(ruleA, s) + rankScore(ruleB, s) + modeBias(profile?.djMode, s);
  const pool: { style: TransitionStyle; score: number; why: string }[] = [];

  const push = (style: TransitionStyle, score: number, why: string) => {
    if (pool.some((p) => p.style === style) || !usable(style)) return;
    pool.push({ style, score, why });
  };

  // A pair too far apart for either genre: bridge it (a scratch or an instrumental), else cut on a downbeat.
  if (gap.description) {
    push("instrumental-bridge", 4, gap.description);
    push("scratch-bridge", 3.8, gap.description);
    push("quick-cut", 3.5, gap.description);
  }
  if (overlap.length > 0) {
    for (const s of overlap) push(s, scoreOf(s), sameGenre ? `both ${nameA}` : "both genres take it");
  } else {
    for (const s of lowerRule.preferredStyles) push(s, scoreOf(s), `${nameA} and ${nameB} share no style: the less beat-reliable genre's choice`);
  }
  // Everything the first genre prefers, then the second, as lower-ranked options the DJ can still choose among.
  for (const s of ruleA.preferredStyles) push(s, scoreOf(s) * 0.5, `${nameA}'s preference`);
  for (const s of ruleB.preferredStyles) push(s, scoreOf(s) * 0.5, `${nameB}'s preference`);
  for (const s of SAFE_CHAIN) push(s, 0.01, "the safe option");
  push("fade", 0.001, "the safe option");

  pool.sort((x, y) => y.score - x.score);

  const confidenceBase = sameGenre ? 0.85 : overlap.length > 0 ? 0.7 : 0.5;
  const plans: RankedPlan[] = pool.map((p, i) => {
    const needsTool = STYLE_TOOL[p.style];
    const planTools: TransitionTool[] = needsTool ? [needsTool] : [];
    // An EQ move on top of a blend, when both genres allow it and it is on.
    if (GRID_STYLES.has(p.style) && p.style !== "bass-swap" && p.style !== "filter-sweep" && tools.has("eq") && ruleA.allowedTools.includes("eq") && ruleB.allowedTools.includes("eq")) planTools.push("eq");
    // A cut can ride an echo tail when echo-out is on and both genres allow it ("quick-cut with echo-out").
    if (p.style === "quick-cut" && tools.has("echo") && ruleA.allowedTools.includes("echo") && ruleB.allowedTools.includes("echo")) planTools.push("echo");
    const keepSync = GRID_STYLES.has(p.style) && report.tempoConfident && report.bpmStrategy !== "freeform";
    return {
      style: p.style,
      bars: barsFor(p.style, ruleA, ruleB, profile),
      tools: planTools,
      keepSync,
      reason: p.why,
      confidence: clamp(confidenceBase - i * 0.1 - (gap.description && !["instrumental-bridge", "scratch-bridge", "quick-cut"].includes(p.style) ? 0.2 : 0), 0.1, 1),
      genrePair: { a: nameA, b: nameB },
      score: p.score,
    };
  });

  // An abrupt ending: echo out, hold 3-5 seconds, then start the next song at its most energetic section. It outranks everything when echo-out is on.
  if (options.abruptEnding && tools.has("echo")) {
    const abrupt: RankedPlan = { style: "echo-out", bars: barsFor("echo-out", ruleA, ruleB, profile), tools: ["echo"], keepSync: false, reason: "the song ends abruptly: echo out, hold 3-5 s, then start the next at its most energetic section", confidence: 0.9, genrePair: { a: nameA, b: nameB }, score: 99 };
    return [abrupt, ...plans.filter((p) => p.style !== "echo-out")];
  }
  return plans;
}

/** The plan for a pair: the best allowed one, with the runner-up as its fallback. */
export function resolveTransition(trackA: PlannerTrack, trackB: PlannerTrack, report: PlannerSyncReport, profile?: PlannerProfile, options: PlannerOptions = {}): GenreTransitionPlan {
  const [best, next] = rankTransitions(trackA, trackB, report, profile, options);
  const strip = (ranked: RankedPlan): Omit<GenreTransitionPlan, "fallbackPlan"> => {
    const { score, ...plan } = ranked;
    void score;
    return plan;
  };
  return { ...strip(best), fallbackPlan: next ? { ...strip(next), fallbackPlan: null } : null };
}

/** The one-line readout: "Hip-Hop to R&B: quick-cut with echo-out. Reason: tempo gap of 14 BPM." */
export function describeGenrePlan(plan: Pick<GenreTransitionPlan, "style" | "tools" | "reason" | "genrePair">): string {
  const toolNames: Record<TransitionTool, string> = { scratch: "scratch", stutter: "stutter", roll: "roll", eq: "EQ", echo: "echo-out", instrumentalBridge: "instrumental bridge" };
  const tools = plan.tools.filter((t) => STYLE_TOOL[plan.style] !== t).map((t) => toolNames[t]);
  const withTools = tools.length > 0 ? ` with ${tools.join(" and ")}` : "";
  return `${plan.genrePair.a} to ${plan.genrePair.b}: ${plan.style}${withTools}. Reason: ${plan.reason}.`;
}
