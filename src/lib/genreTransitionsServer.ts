// Server-only. The database side of genre-aware transitions: the shared override table (the admin's edits), the decision log and the admin's counts.
// Every function treats a missing table (prisma/genre-transitions.sql not run yet) as "not set up": reads give the built-in table and nothing is logged.
import { prisma } from "@/lib/prisma";
import { isMissingTable } from "@/lib/missingTable";
import { GENRE_TRANSITIONS, TRANSITION_STYLES } from "@/lib/genreTransitions";
import { parseOverrideTable, parseRuleOverride, type OverrideTable, type RuleOverride } from "@/lib/genreTransitionOverrides";
import { summarizeDecisions, summarizeJobStatuses, type JobStatusCounts, type TransitionStats } from "@/lib/transitionStats";

export interface SharedOverrides {
  ready: boolean;
  overrides: OverrideTable;
}

/** The admin's shared edits. `ready` is false when the table does not exist yet (the built-in table then stands). */
export async function loadSharedOverrides(): Promise<SharedOverrides> {
  try {
    const rows = await prisma.genreTransitionOverride.findMany({ select: { genre: true, ruleJson: true } });
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.genre] = JSON.parse(r.ruleJson);
      } catch {
        // a damaged row is ignored: that genre uses the built-in rule
      }
    }
    return { ready: true, overrides: parseOverrideTable(raw) };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, overrides: {} };
    throw err;
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: "no-table" | "unknown-genre" | "empty" };

/** Sets one genre's shared override, or clears it when `override` is null (the genre goes back to the built-in rule). */
export async function saveSharedOverride(genre: string, override: unknown, adminId: string): Promise<SaveResult> {
  if (!(genre in GENRE_TRANSITIONS)) return { ok: false, reason: "unknown-genre" };
  try {
    if (override == null) {
      await prisma.genreTransitionOverride.deleteMany({ where: { genre } });
      return { ok: true };
    }
    const parsed: RuleOverride | null = parseRuleOverride(override);
    if (!parsed) return { ok: false, reason: "empty" };
    const ruleJson = JSON.stringify(parsed);
    await prisma.genreTransitionOverride.upsert({ where: { genre }, create: { genre, ruleJson, updatedBy: adminId }, update: { ruleJson, updatedBy: adminId } });
    return { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    throw err;
  }
}

const DECIDED_BY = ["local", "claude", "local-fallback"] as const;
const cap = (s: unknown, n: number): string => (typeof s === "string" ? s.slice(0, n) : "");

export interface DecisionInput {
  fromGenre: string;
  toGenre: string;
  style: string;
  decidedBy: (typeof DECIDED_BY)[number];
  vetoes: { style: string; reason: string }[];
  mixability: number;
}

/** The decision as the browser posts it, or null when it is not that shape. Strings are length-capped: they are stored. */
export function parseDecisionInput(body: unknown): DecisionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const style = typeof b.style === "string" ? b.style : "";
  if (!(TRANSITION_STYLES as readonly string[]).includes(style)) return null;
  const decidedBy = (DECIDED_BY as readonly unknown[]).includes(b.decidedBy) ? (b.decidedBy as DecisionInput["decidedBy"]) : null;
  if (!decidedBy) return null;
  const fromGenre = cap(b.fromGenre, 40);
  const toGenre = cap(b.toGenre, 40);
  if (!fromGenre || !toGenre) return null;
  const mixability = typeof b.mixability === "number" && Number.isFinite(b.mixability) ? Math.min(1, Math.max(0, b.mixability)) : 0;
  const vetoes = (Array.isArray(b.vetoes) ? b.vetoes : [])
    .slice(0, 12)
    .map((v) => ({ style: cap((v as { style?: unknown })?.style, 40), reason: cap((v as { reason?: unknown })?.reason, 120) }))
    .filter((v) => v.style && v.reason);
  return { fromGenre, toGenre, style, decidedBy, vetoes, mixability };
}

/** Logs one decision. Returns false when the table does not exist yet (nothing is lost but the log line). */
export async function recordDecision(input: DecisionInput): Promise<boolean> {
  try {
    await prisma.transitionDecision.create({ data: { fromGenre: input.fromGenre, toGenre: input.toGenre, style: input.style, decidedBy: input.decidedBy, vetoesJson: JSON.stringify(input.vetoes), mixability: input.mixability } });
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

export type TransitionStatsResult = { ok: true; stats: TransitionStats; jobs: JobStatusCounts; sinceDays: number | null } | { ok: false; reason: "no-table" };

/** The admin's counts: decisions (all time, or the last `days`) and the vocal separation jobs by status. */
export async function loadTransitionStats(days: 7 | 30 | null, now = Date.now()): Promise<TransitionStatsResult> {
  const since = days ? new Date(now - days * 86_400_000) : null;
  try {
    const [rows, jobGroups] = await Promise.all([
      prisma.transitionDecision.findMany({ where: since ? { createdAt: { gte: since } } : {}, select: { fromGenre: true, toGenre: true, style: true, decidedBy: true, vetoesJson: true }, take: 50_000 }),
      prisma.stemSeparationJob.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    ]);
    return { ok: true, stats: summarizeDecisions(rows), jobs: summarizeJobStatuses(jobGroups.map((g) => ({ status: g.status, count: g._count._all }))), sinceDays: days };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    throw err;
  }
}
