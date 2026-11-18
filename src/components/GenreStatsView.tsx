import type { GenreStats } from "@/lib/genre/stats";

const SOURCE_NAMES: Record<string, string> = {
  "file-tags": "File tags",
  fingerprint: "Fingerprint (recording found)",
  musicbrainz: "MusicBrainz",
  lastfm: "Last.fm",
  "audio-classifier": "Audio model",
  llm: "AI DJ reconciler",
};

const pct = (n: number) => `${n}%`;

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

/** The numbers from computeGenreStats, laid out. A server component: nothing here is interactive. */
export function GenreStatsView({ stats }: { stats: GenreStats }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Classified" value={pct(stats.percentClassified)} note={`${stats.classified} of ${stats.totalTracks} tracks`} />
        <Figure label="Needs review" value={pct(stats.percentNeedsReview)} note={`${stats.needsReview} tracks`} />
        <Figure label="Average confidence" value={stats.averageConfidence == null ? "n/a" : stats.averageConfidence.toFixed(2)} note={`over ${stats.logged} classifications`} />
        <Figure label="Needed the AI DJ" value={pct(stats.percentUsedLlm)} note={`${stats.confirmed} confirmed by people`} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Sources</h2>
        {stats.sources.length === 0 ? (
          <p className="text-sm text-muted">No classifications have been logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-4 font-medium">Source</th>
                  <th className="py-1 pr-4 font-medium text-right">Runs</th>
                  <th className="py-1 pr-4 font-medium text-right">Found something</th>
                  <th className="py-1 pr-4 font-medium text-right">Hit rate</th>
                  <th className="py-1 font-medium text-right">Average time</th>
                </tr>
              </thead>
              <tbody>
                {stats.sources.map((s) => (
                  <tr key={s.source} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4">{SOURCE_NAMES[s.source] ?? s.source}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{s.runs}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{s.hits}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{pct(Math.round(s.hitRate * 1000) / 10)}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.avgMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          Each track counts once, by its latest classification. A source that was skipped (already confident, no key, switched off) is not counted as a miss. Use these to tune the thresholds in{" "}
          <code>src/lib/genre/combine.ts</code>.
        </p>
      </section>
    </div>
  );
}
