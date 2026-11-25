// Server-only. The database side of genre-aware transitions: the shared override table (the admin's edits), the decision log and the admin's counts.
// Every function treats a missing table (prisma/genre-transitions.sql not run yet) as "not set up": reads give the built-in table and nothing is logged.
import { prisma } from "@/lib/prisma";
import { isMissingTable } from "@/lib/missingTable";
import { GENRE_TRANSITIONS, TRANSITION_STYLES } from "@/lib/genreTransitions";
import { parseOverrideTable, parseRuleOverride, type OverrideTable, type RuleOverride } from "@/lib/genreTransitionOverrides";
import { statsFromAggregates, summarizeJobStatuses, type JobStatusCounts, type TransitionStats } from "@/lib/transitionStats";

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

/** True for a top-level genre in the table, and only for those: not an inherited key such as "toString". */
export function isTaxonomyGenre(genre: string): boolean {
  return Object.hasOwn(GENRE_TRANSITIONS, genre);
}

export type SaveResult = { ok: true } | { ok: false; reason: "no-table" | "unknown-genre" | "empty" };

/** Sets one genre's shared override, or clears it when `override` is null (the genre goes back to the built-in rule). */
export async function saveSharedOverride(genre: string, override: unknown, adminId: string): Promise<SaveResult> {
  if (!isTaxonomyGenre(genre)) return { ok: false, reason: "unknown-genre" };
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
  // Only genres of the taxonomy are logged: free text from a browser never becomes a row (and a song with no genre is not a genre pair).
  const fromGenre = typeof b.fromGenre === "string" ? b.fromGenre : "";
  const toGenre = typeof b.toGenre === "string" ? b.toGenre : "";
  if (!isTaxonomyGenre(fromGenre) || !isTaxonomyGenre(toGenre)) return null;
  const mixability = typeof b.mixability === "number" && Number.isFinite(b.mixability) ? Math.min(1, Math.max(0, b.mixability)) : 0;
  const vetoes = (Array.isArray(b.vetoes) ? b.vetoes : [])
    .slice(0, 12)
    .map((v) => ({ style: cap((v as { style?: unknown })?.style, 40), reason: cap((v as { reason?: unknown })?.reason, 120) }))
    .filter((v) => v.style && v.reason);
  return { fromGenre, toGenre, style, decidedBy, vetoes, mixability };
}

/** Decisions older than this are deleted: the dashboard looks at all time, the last 30 days and the last 7, and the log must not grow without limit. */
export const DECISION_KEEP_DAYS = 180;
const PRUNE_EVERY_MS = 6 * 3_600_000;
let lastPruneAt = 0;

/** Whether this server instance should prune now: at most once every six hours. Pure, so it is tested. */
export function shouldPrune(now: number, lastAt: number): boolean {
  return now - lastAt >= PRUNE_EVERY_MS;
}

/** Logs one decision. Returns false when the table does not exist yet (nothing is lost but the log line). Occasionally deletes decisions older than DECISION_KEEP_DAYS. */
export async function recordDecision(input: DecisionInput, now = Date.now()): Promise<boolean> {
  try {
    await prisma.transitionDecision.create({ data: { fromGenre: input.fromGenre, toGenre: input.toGenre, style: input.style, decidedBy: input.decidedBy, vetoesJson: JSON.stringify(input.vetoes), mixability: input.mixability } });
    if (shouldPrune(now, lastPruneAt)) {
      lastPruneAt = now;
      await prisma.transitionDecision.deleteMany({ where: { createdAt: { lt: new Date(now - DECISION_KEEP_DAYS * 86_400_000) } } }).catch(() => {});
    }
    return true;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

/** How many decisions with a veto are read for the veto breakdown (the veto detail is JSON text, so it cannot be summed in the database). */
const VETO_SAMPLE_ROWS = 5000;

export type TransitionStatsResult = { ok: true; stats: TransitionStats; jobs: JobStatusCounts; /** Instrumentals built so far; null before prisma/vocal-split.sql has been run. */ instrumentalsBuilt: number | null; sinceDays: number | null } | { ok: false; reason: "no-table" };

/** The admin's counts: decisions (all time, or the last `days`), added up in the database so they are exact, and the vocal separation jobs by status. */
export async function loadTransitionStats(days: 7 | 30 | null, now = Date.now()): Promise<TransitionStatsResult> {
  const since = days ? new Date(now - days * 86_400_000) : null;
  const where = since ? { createdAt: { gte: since } } : {};
  try {
    const [total, byStyle, byPair, byDecider, vetoRows, jobGroups, instrumentalsBuilt] = await Promise.all([
      prisma.transitionDecision.count({ where }),
      prisma.transitionDecision.groupBy({ by: ["style"], where, _count: { _all: true } }),
      prisma.transitionDecision.groupBy({ by: ["fromGenre", "toGenre"], where, _count: { _all: true } }),
      prisma.transitionDecision.groupBy({ by: ["decidedBy"], where, _count: { _all: true } }),
      prisma.transitionDecision.findMany({ where: { ...where, NOT: { vetoesJson: "[]" } }, select: { vetoesJson: true }, orderBy: { createdAt: "desc" }, take: VETO_SAMPLE_ROWS + 1 }),
      prisma.stemSeparationJob.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
      prisma.stemSeparationJob.count({ where: { instrumentalUrl: { not: null } } }).catch(() => null),
    ]);
    const stats = statsFromAggregates({
      total,
      byStyle: byStyle.map((g) => ({ style: g.style, count: g._count._all })),
      byPair: byPair.map((g) => ({ fromGenre: g.fromGenre, toGenre: g.toGenre, count: g._count._all })),
      byDecider: byDecider.map((g) => ({ decidedBy: g.decidedBy, count: g._count._all })),
      vetoRows: vetoRows.slice(0, VETO_SAMPLE_ROWS),
      vetoRowsCapped: vetoRows.length > VETO_SAMPLE_ROWS,
    });
    return { ok: true, stats, jobs: summarizeJobStatuses(jobGroups.map((g) => ({ status: g.status, count: g._count._all }))), instrumentalsBuilt, sinceDays: days };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "no-table" };
    throw err;
  }
}
