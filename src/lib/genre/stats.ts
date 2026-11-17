/**
 * What the classification log says about how well genre classification is doing, for the owner's stats screen: how much of
 * the library has a genre, how much is waiting for review, how often each source found something, and how sure the results
 * are. Used to tune the thresholds (combine.ts) and to see which source earns its keep. Pure: the loader reads the rows.
 */

export interface LogRow {
  trackId: string;
  status: string;
  genre: string | null;
  confidence: number | null;
  /** JSON.stringify'd SourceLog[] (pipeline.ts). */
  sourcesJson: string;
  usedLlm: boolean;
  createdAt: Date;
}

export interface SourceStat {
  source: string;
  /** Classifications in which this source actually ran. */
  runs: number;
  /** Of those, how many it gave at least one genre for (the fingerprint step: found a recording). */
  hits: number;
  /** hits / runs, 0-1 (0 with no runs). */
  hitRate: number;
  avgMs: number;
}

export interface GenreStats {
  totalTracks: number;
  classified: number;
  needsReview: number;
  confirmed: number;
  /** 0-100, one decimal. */
  percentClassified: number;
  /** Of the tracks that have a genre record, 0-100. */
  percentNeedsReview: number;
  /** Mean best-genre confidence over each track's latest classification, 0-1 (null with none). */
  averageConfidence: number | null;
  /** Share of latest classifications that needed the LLM, 0-100. */
  percentUsedLlm: number;
  /** How many tracks' latest classification the numbers above come from. */
  logged: number;
  sources: SourceStat[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Each track's most recent log row (a track re-classified many times counts once). */
export function latestPerTrack(rows: readonly LogRow[]): LogRow[] {
  const latest = new Map<string, LogRow>();
  for (const row of rows) {
    const have = latest.get(row.trackId);
    if (!have || row.createdAt > have.createdAt) latest.set(row.trackId, row);
  }
  return [...latest.values()];
}

interface ParsedSource {
  source: string;
  ran: boolean;
  tags: number;
  ms: number;
  hit?: boolean;
}

function parseSources(json: string): ParsedSource[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as ParsedSource[]).filter((s) => s && typeof s.source === "string") : [];
  } catch {
    return [];
  }
}

export interface StatsInput {
  totalTracks: number;
  /** Tracks that have a genre record at all (classified or waiting for review). */
  records: number;
  /** Of those, the ones with a best genre. */
  classified: number;
  needsReview: number;
  confirmed: number;
  /** Every log row in the window (re-runs included). */
  logs: readonly LogRow[];
}

const SOURCE_ORDER = ["file-tags", "fingerprint", "musicbrainz", "lastfm", "audio-classifier", "llm"];

export function computeGenreStats({ totalTracks, records, classified, needsReview, confirmed, logs }: StatsInput): GenreStats {
  const latest = latestPerTrack(logs);
  const confidences = latest.map((l) => l.confidence).filter((c): c is number => c != null && Number.isFinite(c));
  const bySource = new Map<string, { runs: number; hits: number; ms: number }>();
  for (const row of latest) {
    for (const s of parseSources(row.sourcesJson)) {
      if (!s.ran) continue;
      const e = bySource.get(s.source) ?? { runs: 0, hits: 0, ms: 0 };
      e.runs++;
      if (s.hit === true || (s.hit === undefined && s.tags > 0)) e.hits++;
      e.ms += Number(s.ms) || 0;
      bySource.set(s.source, e);
    }
  }
  const sources: SourceStat[] = [...bySource.entries()]
    .map(([source, e]) => ({ source, runs: e.runs, hits: e.hits, hitRate: e.runs ? e.hits / e.runs : 0, avgMs: e.runs ? Math.round(e.ms / e.runs) : 0 }))
    .sort((a, b) => (SOURCE_ORDER.indexOf(a.source) + 1 || 99) - (SOURCE_ORDER.indexOf(b.source) + 1 || 99));
  return {
    totalTracks,
    classified,
    needsReview,
    confirmed,
    percentClassified: totalTracks > 0 ? round1((classified / totalTracks) * 100) : 0,
    percentNeedsReview: records > 0 ? round1((needsReview / records) * 100) : 0,
    averageConfidence: confidences.length > 0 ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 1000) / 1000 : null,
    percentUsedLlm: latest.length > 0 ? round1((latest.filter((l) => l.usedLlm).length / latest.length) * 100) : 0,
    logged: latest.length,
    sources,
  };
}
