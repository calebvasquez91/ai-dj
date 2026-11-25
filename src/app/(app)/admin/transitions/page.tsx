import Link from "next/link";
import { notFound } from "next/navigation";
import { SharedGenreRulesEditor } from "@/components/SharedGenreRulesEditor";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { GENRE_TRANSITIONS_ENABLED, VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import { loadSharedOverrides, loadTransitionStats } from "@/lib/genreTransitionsServer";
import { parseDays } from "@/lib/playStats";
import type { Count } from "@/lib/transitionStats";

export const metadata = { title: "Transitions" };

type Search = { days?: string | string[] };

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={to} aria-current={active ? "true" : undefined} className={`btn-outline !text-xs ${active ? "!border-accent-purple !text-foreground" : ""}`}>
      {children}
    </Link>
  );
}

function Counts({ title, rows, empty }: { title: string; rows: Count[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.slice(0, 15).map((r) => (
            <li key={r.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{r.key}</span>
                <span className="shrink-0 font-semibold">{r.count.toLocaleString("en-US")}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-hover" aria-hidden="true">
                <div className="h-full rounded-full accent-gradient" style={{ width: `${Math.max(2, Math.round((r.count / max) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Genre-aware transitions for the admin: how many transitions per style and per genre pair, what the Audio Engineer vetoed, how often the DJ asked
 * Claude, the state of vocal separation, and the editor for the shared genre transition table. Only the admin; for anyone else the page does not
 * exist. The check comes first, before anything is read.
 */
export default async function TransitionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await feedbackOwnerSession())) notFound();
  const days = parseDays((await searchParams).days);
  const [stats, shared] = await Promise.all([loadTransitionStats(days), loadSharedOverrides()]);

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Transitions</h1>
        <p className="text-sm text-muted">
          How the genre-aware DJ is mixing. Genre-aware transitions are {GENRE_TRANSITIONS_ENABLED ? "available in this version" : "not switched on in this version yet"}, and vocal separation is {VOCAL_SPLIT_ENABLED ? "available" : "not switched on yet"}.
          Counts come from devices that have genre-aware transitions turned on. Only you can see this page.
        </p>
      </div>

      {!stats.ok ? (
        <div className="card p-4 flex flex-col gap-2 text-sm" role="status">
          <p className="font-semibold">Transitions are not being recorded yet: their tables do not exist.</p>
          <p className="text-muted">Create them once, from the project folder:</p>
          <code className="block rounded-lg bg-surface-hover px-3 py-2 text-xs break-all">npx prisma db execute --file prisma/genre-transitions.sql</code>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
            <Chip to="/admin/transitions" active={days === null}>All time</Chip>
            <Chip to="/admin/transitions?days=30" active={days === 30}>Last 30 days</Chip>
            <Chip to="/admin/transitions?days=7" active={days === 7}>Last 7 days</Chip>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4 flex flex-col gap-1">
              <span className="text-xs text-muted">Transitions decided</span>
              <span className="text-3xl heading">{stats.stats.total.toLocaleString("en-US")}</span>
            </div>
            <div className="card p-4 flex flex-col gap-1">
              <span className="text-xs text-muted">Engineer vetoes</span>
              <span className="text-3xl heading">{stats.stats.vetoTotal.toLocaleString("en-US")}</span>
            </div>
            <div className="card p-4 flex flex-col gap-1">
              <span className="text-xs text-muted">DJ asked Claude</span>
              <span className="text-3xl heading">{stats.stats.modelCalls.toLocaleString("en-US")}</span>
              <span className="text-xs text-muted">{stats.stats.modelFallbacks.toLocaleString("en-US")} close calls it did not answer in time</span>
            </div>
          </div>

          <Counts title="By style" rows={stats.stats.byStyle} empty="No transitions decided yet." />
          <Counts title="By genre pair" rows={stats.stats.byGenrePair} empty="No transitions decided yet." />
          <Counts title="What the Audio Engineer vetoed" rows={stats.stats.vetoes} empty="No vetoes yet." />
          {stats.stats.vetoesSampled && <p className="text-xs text-muted" role="status">The veto breakdown covers the most recent decisions that had a veto, not all of them. The other counts are exact.</p>}

          <section className="card p-4 flex flex-col gap-2" aria-label="Vocal separation jobs">
            <h2 className="font-semibold">Vocal separation jobs</h2>
            <p className="text-sm text-muted">The stem-separation jobs that vocal and instrumental splitting reuses. All time.</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted">Waiting</dt><dd className="font-semibold">{stats.jobs.pending.toLocaleString("en-US")}</dd></div>
              <div><dt className="text-xs text-muted">Running</dt><dd className="font-semibold">{stats.jobs.processing.toLocaleString("en-US")}</dd></div>
              <div><dt className="text-xs text-muted">Done</dt><dd className="font-semibold">{stats.jobs.ready.toLocaleString("en-US")}</dd></div>
              <div><dt className="text-xs text-muted">Failed</dt><dd className="font-semibold">{stats.jobs.failed.toLocaleString("en-US")}</dd></div>
            </dl>
            <p className="text-sm text-muted">
              {stats.instrumentalsBuilt == null
                ? "Instrumentals are not being built yet: the columns for them do not exist (prisma/vocal-split.sql)."
                : `${stats.instrumentalsBuilt.toLocaleString("en-US")} of ${stats.jobs.ready.toLocaleString("en-US")} finished jobs have a built instrumental.`}
            </p>
          </section>
        </>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="shared-rules-heading">
        <h2 id="shared-rules-heading" className="font-semibold">Shared transition table</h2>
        <p className="text-sm text-muted">
          Each genre&apos;s preferred styles and blend length. A change here applies to every account (a device&apos;s own overrides still win on that device).
        </p>
        {!shared.ready && (
          <p className="text-sm text-muted" role="status">The edits cannot be saved until the tables above exist; the built-in table is in use.</p>
        )}
        <SharedGenreRulesEditor overrides={shared.overrides} />
      </section>
    </div>
  );
}
