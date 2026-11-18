import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { formatDuration, parseDays } from "@/lib/playStats";
import { loadPlayStats, type Entry } from "@/lib/playStatsServer";

export const metadata = { title: "Listening" };

type Search = { days?: string | string[]; account?: string | string[] };

function href(days: 7 | 30 | null, account: string | null): string {
  const q = new URLSearchParams();
  if (days) q.set("days", String(days));
  if (account) q.set("account", account);
  const s = q.toString();
  return s ? `/admin/stats?${s}` : "/admin/stats";
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={to} aria-current={active ? "true" : undefined} className={`btn-outline !text-xs ${active ? "!border-accent-purple !text-foreground" : ""}`}>
      {children}
    </Link>
  );
}

function Bars({ title, rows, empty, ids }: { title: string; rows: Entry[]; empty: string; ids?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={`${r.key}-${i}`} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">
                  {ids ? <span className="text-muted mr-1">{i + 1}.</span> : null}
                  {r.label}
                  {r.sub ? <span className="text-muted"> · {r.sub}</span> : null}
                </span>
                <span className="shrink-0 font-semibold">{formatDuration(r.seconds)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-hover" aria-hidden="true">
                <div className="h-full rounded-full accent-gradient" style={{ width: `${Math.max(2, Math.round((r.seconds / max) * 100))}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * How the site is being listened to: hours played, by account, genre, playlist and song, for all time or the last 7 / 30 days, for every
 * account or one. Only the admin; for anyone else the page does not exist. The check comes first, before anything is read.
 */
export default async function ListeningStatsPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await feedbackOwnerSession())) notFound();
  const q = await searchParams;
  const days = parseDays(q.days);
  const accountParam = Array.isArray(q.account) ? q.account[0] : q.account;
  const result = await loadPlayStats({ days, accountId: accountParam && accountParam.length <= 64 ? accountParam : null });

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Listening</h1>
        <p className="text-sm text-muted">
          Time music was playing, as reported by the player about every 30 seconds. It counts from the day recording started; nothing
          earlier exists. Only you can see this page.
        </p>
      </div>

      {!result.ok ? (
        result.reason === "no-table" ? (
          <div className="card p-4 flex flex-col gap-2 text-sm" role="status">
            <p className="font-semibold">Listening time isn&apos;t being recorded yet: its table doesn&apos;t exist.</p>
            <p className="text-muted">Create it once, from the project folder:</p>
            <code className="block rounded-lg bg-surface-hover px-3 py-2 text-xs break-all">npx prisma db execute --file prisma/play-stats.sql</code>
          </div>
        ) : (
          <div className="card p-4 text-sm" role="alert">
            Couldn&apos;t load the numbers just now. Reload the page to try again; the details are in the server log.
          </div>
        )
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
              <Chip to={href(null, accountParam ?? null)} active={days === null}>All time</Chip>
              <Chip to={href(30, accountParam ?? null)} active={days === 30}>Last 30 days</Chip>
              <Chip to={href(7, accountParam ?? null)} active={days === 7}>Last 7 days</Chip>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Account">
              <Chip to={href(days, null)} active={!accountParam}>Every account</Chip>
              {result.report.accounts.map((a) => (
                <Chip key={a.id} to={href(days, a.id)} active={accountParam === a.id}>
                  {a.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="card p-4 flex flex-col gap-1">
            <span className="text-xs text-muted">{accountParam ? "Listening by this account" : "Listening by every account"}</span>
            <span className="text-3xl heading">{formatDuration(result.report.totalSeconds)}</span>
            {result.report.totalSeconds > 0 && (
              <span className="text-xs text-muted">
                of which {formatDuration(result.report.outsidePlaylistSeconds)} was not played from a playlist
              </span>
            )}
          </div>

          <Bars title="Hours by account" rows={result.report.accounts} empty="Nothing has been played in this period." />
          <Bars title="Hours by genre" rows={result.report.genres} empty="Nothing has been played in this period." />
          <Bars title="Playlists with the most playtime" rows={result.report.playlists} empty="No playlist has been played in this period." ids />
          <Bars title="Songs with the most playtime" rows={result.report.songs} empty="Nothing has been played in this period." ids />
        </>
      )}
    </div>
  );
}
