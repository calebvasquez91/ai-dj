/**
 * The admin dashboard's counts for genre-aware transitions, from the logged decisions: how many transitions per style and per genre pair, what the
 * Audio Engineer vetoed, how many times the DJ asked Claude, and (from the stem jobs) the state of vocal separation. Pure: the page reads the rows and
 * this sums them.
 */
export interface DecisionRow {
  fromGenre: string;
  toGenre: string;
  style: string;
  /** "local" | "claude" | "local-fallback" */
  decidedBy: string;
  /** JSON text: [{ style, reason }] */
  vetoesJson: string;
}

export interface Count {
  key: string;
  count: number;
}

export interface TransitionStats {
  /** True when the veto counts come from only the most recent decisions that had a veto (the veto detail is JSON text and is read from a capped sample). */
  vetoesSampled: boolean;
  total: number;
  byStyle: Count[];
  byGenrePair: Count[];
  /** Engineer vetoes, by "style: reason". A decision with three vetoes adds three. */
  vetoes: Count[];
  vetoTotal: number;
  /** How many decisions Claude Haiku made (decidedBy "claude") and how many close calls it did not answer in time (decidedBy "local-fallback"). */
  modelCalls: number;
  modelFallbacks: number;
}

function tally(keys: string[]): Count[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function vetoesOf(json: string): { style: string; reason: string }[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is { style: string; reason: string } => !!x && typeof (x as { style?: unknown }).style === "string" && typeof (x as { reason?: unknown }).reason === "string");
  } catch {
    return [];
  }
}

export function summarizeDecisions(rows: readonly DecisionRow[]): TransitionStats {
  const vetoes = rows.flatMap((r) => vetoesOf(r.vetoesJson).map((v) => `${v.style}: ${v.reason}`));
  return {
    vetoesSampled: false,
    total: rows.length,
    byStyle: tally(rows.map((r) => r.style)),
    byGenrePair: tally(rows.map((r) => `${r.fromGenre} → ${r.toGenre}`)),
    vetoes: tally(vetoes),
    vetoTotal: vetoes.length,
    modelCalls: rows.filter((r) => r.decidedBy === "claude").length,
    modelFallbacks: rows.filter((r) => r.decidedBy === "local-fallback").length,
  };
}

export interface JobStatusCounts {
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  other: number;
}

/** Vocal separation job status, from the stem jobs' own status column. */
export function summarizeJobStatuses(rows: readonly { status: string; count: number }[]): JobStatusCounts {
  const out: JobStatusCounts = { pending: 0, processing: 0, ready: 0, failed: 0, other: 0 };
  for (const r of rows) {
    if (r.status === "pending" || r.status === "processing" || r.status === "ready" || r.status === "failed") out[r.status] += r.count;
    else out.other += r.count;
  }
  return out;
}

/** What the database adds up for the dashboard: one row per style, per genre pair and per decider, plus a capped sample of the decisions that had a veto. */
export interface DecisionAggregates {
  total: number;
  byStyle: { style: string; count: number }[];
  byPair: { fromGenre: string; toGenre: string; count: number }[];
  byDecider: { decidedBy: string; count: number }[];
  /** The most recent decisions that carried at least one veto, newest first. */
  vetoRows: { vetoesJson: string }[];
  /** Whether more decisions with a veto existed than were read. */
  vetoRowsCapped: boolean;
}

const byCount = (a: Count, b: Count) => b.count - a.count || a.key.localeCompare(b.key);

/** The same counts as summarizeDecisions, built from the database's own totals: exact however many decisions there are. Only the veto detail comes from a sample. */
export function statsFromAggregates(a: DecisionAggregates): TransitionStats {
  const vetoes = tally(a.vetoRows.flatMap((r) => vetoesOf(r.vetoesJson).map((v) => `${v.style}: ${v.reason}`)));
  return {
    vetoesSampled: a.vetoRowsCapped,
    total: a.total,
    byStyle: a.byStyle.map((g) => ({ key: g.style, count: g.count })).sort(byCount),
    byGenrePair: a.byPair.map((g) => ({ key: `${g.fromGenre} \u2192 ${g.toGenre}`, count: g.count })).sort(byCount),
    vetoes,
    vetoTotal: vetoes.reduce((n, v) => n + v.count, 0),
    modelCalls: a.byDecider.find((g) => g.decidedBy === "claude")?.count ?? 0,
    modelFallbacks: a.byDecider.find((g) => g.decidedBy === "local-fallback")?.count ?? 0,
  };
}
