/**
 * The DJ's side of a genre-aware transition: among the plans the Audio Engineer did not veto, choose one. Decided locally when the top plan leads by a
 * clear margin; only when the top two are close does it ask Claude Haiku (through an injected `ask`, so this file stays pure and testable) to pick one
 * and write a one-sentence reason, with a hard timeout, falling back to the local winner. Both the Engineer's vetoes and the DJ's choice are returned,
 * with reasons, for the readout and the admin counts.
 *
 * The plan is chosen 60 to 90 seconds before the transition (PLAN_LEAD_SEC), so nothing waits until the end of the song.
 */
import type { GenreTransitionPlan, RankedPlan } from "@/lib/transitionPlanner";
import { KNOWN_CONSTRAINTS, applyVetoes, type MixabilityReport } from "@/lib/mixability";

/** The plan is decided this early (seconds before the mix-out): between 60 and 90, so a 2 s model call never holds up a transition. */
export const PLAN_LEAD_SEC = { min: 60, max: 90 } as const;
/** The top plan must lead the runner-up by at least this share of its own score to be chosen without asking Claude. */
export const CLEAR_MARGIN = 0.2;
/** The server's call to Claude gets this long (the spec's 2 seconds). */
export const HAIKU_CALL_TIMEOUT_MS = 2000;
/**
 * The browser waits this long for the whole answer: the server's 2 s plus the round trip to our own route and a cold start. It must be longer than
 * HAIKU_CALL_TIMEOUT_MS, or answers that arrive in time are dropped by the browser's own clock. After it the local winner stands.
 */
export const ASK_TIMEOUT_MS = 3000;

export interface PickCandidate {
  style: string;
  bars: number;
  tools: string[];
  keepSync: boolean;
  why: string;
}

export interface PickRequest {
  genrePair: { a: string; b: string };
  mixability: Pick<MixabilityReport, "mixability" | "constraints" | "beatConfidenceA" | "beatConfidenceB" | "keyConfidenceA" | "keyConfidenceB" | "energyAtMixOut" | "energyAtMixIn" | "vocalDensityAtMixOut" | "vocalDensityAtMixIn">;
  candidates: [PickCandidate, PickCandidate];
}

export interface PickAnswer {
  style: string;
  reason: string;
}

export type AskDj = (request: PickRequest) => Promise<PickAnswer | null>;

export interface TransitionDecision {
  plan: GenreTransitionPlan;
  mixability: MixabilityReport;
  /** What the Engineer vetoed, with why. */
  vetoes: { style: string; reason: string }[];
  /** `local`: a clear winner; `claude`: the top two were close and Claude chose; `local-fallback`: they were close but Claude was off, slow or answered badly. */
  decidedBy: "local" | "claude" | "local-fallback";
  /** One sentence for the readout: the DJ's own reason. */
  reason: string;
}

const candidateOf = (p: RankedPlan): PickCandidate => ({ style: p.style, bars: p.bars, tools: p.tools, keepSync: p.keepSync, why: p.reason });

function asPlan(p: RankedPlan, fallback: RankedPlan | undefined): GenreTransitionPlan {
  const { score, ...rest } = p;
  void score;
  let fallbackPlan: GenreTransitionPlan | null = null;
  if (fallback) {
    const { score: fs, ...frest } = fallback;
    void fs;
    fallbackPlan = { ...frest, fallbackPlan: null };
  }
  return { ...rest, fallbackPlan };
}

/** True when the first plan leads the second clearly enough to need no second opinion. */
export function leadsClearly(first: Pick<RankedPlan, "score">, second: Pick<RankedPlan, "score"> | undefined): boolean {
  if (!second) return true;
  if (first.score <= 0) return false;
  return (first.score - second.score) / first.score >= CLEAR_MARGIN;
}

/** Resolves to the answer, or null if `ask` is slow, throws or rejects. */
async function askWithTimeout(ask: AskDj, request: PickRequest, timeoutMs: number): Promise<PickAnswer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ask(request).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The decision for a pair. `ranked` is what rankTransitions() returned (best first); the Engineer's vetoes are applied first, then the DJ chooses.
 * Always returns a plan: if everything was vetoed the safest ranked plan (the last, a fade or cut the Engineer never blocks) stands.
 */
export async function decideTransition(args: { ranked: readonly RankedPlan[]; mixability: MixabilityReport; ask?: AskDj; timeoutMs?: number }): Promise<TransitionDecision> {
  const { allowed, vetoed } = applyVetoes(args.ranked, args.mixability);
  const vetoes = vetoed.map((v) => ({ style: v.plan.style, reason: v.reason }));
  const pool = allowed.length > 0 ? allowed : [args.ranked[args.ranked.length - 1]];
  const [first, second] = pool;

  const clear = !second || leadsClearly(first, second);
  if (clear || !args.ask) {
    return { plan: asPlan(first, second), mixability: args.mixability, vetoes, decidedBy: clear ? "local" : "local-fallback", reason: first.reason };
  }

  const answer = await askWithTimeout(args.ask, { genrePair: first.genrePair, mixability: args.mixability, candidates: [candidateOf(first), candidateOf(second)] }, args.timeoutMs ?? ASK_TIMEOUT_MS);
  const chosen = answer && (answer.style === first.style ? first : answer.style === second.style ? second : null);
  if (!answer || !chosen) return { plan: asPlan(first, second), mixability: args.mixability, vetoes, decidedBy: "local-fallback", reason: first.reason };
  const runnerUp = chosen === first ? second : first;
  return { plan: asPlan(chosen, runnerUp), mixability: args.mixability, vetoes, decidedBy: "claude", reason: answer.reason.trim().slice(0, 240) || chosen.reason };
}

/** What a pick answer must look like: one of the two offered styles and a short reason. Anything else is ignored (the local winner stands). */
export function parsePickAnswer(raw: unknown, offered: readonly string[]): PickAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const { style, reason } = raw as { style?: unknown; reason?: unknown };
  if (typeof style !== "string" || !offered.includes(style)) return null;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;
  return { style, reason: reason.trim().slice(0, 240) };
}

const isCandidate = (c: unknown): c is PickCandidate => {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return typeof x.style === "string" && typeof x.bars === "number" && Array.isArray(x.tools) && typeof x.keepSync === "boolean" && typeof x.why === "string";
};

/** The request, or null when it is not the shape the DJ sends. Strings are length-capped: they go into a prompt. */
export function sanitizePickRequest(body: unknown): PickRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { genrePair?: { a?: unknown; b?: unknown }; mixability?: unknown; candidates?: unknown };
  if (typeof b.genrePair?.a !== "string" || typeof b.genrePair?.b !== "string") return null;
  const mixability = sanitizeMixability(b.mixability);
  if (!mixability) return null;
  if (!Array.isArray(b.candidates) || b.candidates.length !== 2 || !b.candidates.every(isCandidate)) return null;
  const cap = (s: string) => s.slice(0, 120);
  const [c1, c2] = b.candidates as PickCandidate[];
  const clean = (c: PickCandidate): PickCandidate => ({ style: cap(c.style), bars: c.bars, tools: c.tools.filter((t): t is string => typeof t === "string").slice(0, 6).map(cap), keepSync: c.keepSync, why: cap(c.why) });
  return { genrePair: { a: cap(b.genrePair.a), b: cap(b.genrePair.b) }, mixability, candidates: [clean(c1), clean(c2)] };
}


const NUMERIC_FACTS = ["mixability", "beatConfidenceA", "beatConfidenceB", "keyConfidenceA", "keyConfidenceB", "energyAtMixOut", "energyAtMixIn", "vocalDensityAtMixOut", "vocalDensityAtMixIn"] as const;

/**
 * The Engineer's facts as the browser sends them, rebuilt from a whitelist: each number clamped to 0-1 (or null), the constraints only from the closed list
 * of sentences the Engineer writes. Nothing else the client sends reaches the prompt. Null when it is not an object at all.
 */
export function sanitizeMixability(raw: unknown): PickRequest["mixability"] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  const out = Object.fromEntries(NUMERIC_FACTS.map((k) => [k, num(r[k])])) as Record<(typeof NUMERIC_FACTS)[number], number | null>;
  const constraints = (Array.isArray(r.constraints) ? r.constraints : []).filter((c): c is string => typeof c === "string" && (KNOWN_CONSTRAINTS as readonly string[]).includes(c)).slice(0, KNOWN_CONSTRAINTS.length);
  return { ...out, mixability: out.mixability ?? 0, beatConfidenceA: out.beatConfidenceA ?? 0, beatConfidenceB: out.beatConfidenceB ?? 0, keyConfidenceA: out.keyConfidenceA ?? 0, keyConfidenceB: out.keyConfidenceB ?? 0, constraints };
}
