import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { activityFilterParams, formatBytes, parseActivityFilter, shortDeviceId, usageLine } from "@/lib/activity";
import {
  FAILED_JOB_WINDOW_DAYS,
  loadAuditLog,
  loadDevices,
  loadGenreCounts,
  loadHealth,
  loadOverview,
  loadPlaytime,
  loadUploads,
  type Section,
} from "@/lib/activityServer";
import { AUDIT_EVENT_TYPES, auditEventLabel } from "@/lib/telemetry";
import { formatDuration } from "@/lib/playStats";

export const metadata = { title: "Activity" };

type Search = Record<string, string | string[] | undefined>;

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function Setup({ what }: { what: string }) {
  return (
    <div className="text-sm" role="status">
      <p className="font-semibold">{what} isn&apos;t being recorded yet: its tables don&apos;t exist.</p>
      <p className="text-muted">Create them once, from the project folder:</p>
      <code className="block rounded-lg bg-surface-hover px-3 py-2 text-xs break-all mt-1">npx prisma db execute --file prisma/telemetry.sql</code>
    </div>
  );
}

/** One titled card; shows the setup note when its tables are missing and an error line when it could not be read. */
function Panel<T>({ title, what, result, children }: { title: string; what: string; result: Section<T>; children: (data: T) => React.ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {result.ok ? children(result.data) : result.reason === "no-table" ? <Setup what={what} /> : <p className="text-sm text-accent-pink" role="alert">Couldn&apos;t load this just now; the details are in the server log.</p>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl heading">{value}</span>
    </div>
  );
}

function BarRow({ label, value, max, text, secondary }: { label: string; value: number; max: number; text: string; secondary?: number }) {
  // a count of zero draws no bar; any other count draws at least a sliver
  const pct = (n: number) => (n <= 0 ? 0 : Math.min(100, Math.max(2, Math.round((n / Math.max(1, max)) * 100))));
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words">{label}</span>
        <span className="shrink-0 text-right font-semibold">{text}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-hover" aria-hidden="true">
        {secondary !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-muted/40" style={{ width: `${pct(secondary)}%` }} />}
        <div className="absolute inset-y-0 left-0 rounded-full accent-gradient" style={{ width: `${pct(value)}%` }} />
      </div>
    </li>
  );
}

const th = "py-1 pr-3 text-left text-xs font-semibold text-muted whitespace-nowrap";
const td = "py-1 pr-3 text-xs align-top break-words";

/**
 * The admin's view of the whole site: totals, who is on now and which devices exist, which device uploaded what, every change to the library
 * and playlists (filterable by date and kind, with CSV export), playtime by day and week, genre counts, and the health of storage and the
 * background jobs. Only the admin; for anyone else the page does not exist, and the check comes before anything is read.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await feedbackOwnerSession())) notFound();
  const query = await searchParams;
  const filter = parseActivityFilter(query);
  const raw = (k: string) => (Array.isArray(query[k]) ? (query[k] as string[])[0] : (query[k] as string | undefined)) ?? "";
  const exportParams = activityFilterParams({ from: filter.from ? raw("from") : null, to: filter.to ? raw("to") : null, type: filter.type });

  const [overview, devices, uploads, audit, playtime, genres, health] = await Promise.all([
    loadOverview(),
    loadDevices(),
    loadUploads(filter),
    loadAuditLog(filter),
    loadPlaytime(),
    loadGenreCounts(),
    loadHealth(),
  ]);

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 max-w-4xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl heading">Activity</h1>
        <p className="text-sm text-muted">
          Devices, uploads, library changes, playtime and system health. Only you can see this page.{" "}
          <Link href="/admin/stats" className="text-accent underline">Listening by account, genre, playlist and song</Link>
        </p>
      </div>

      <Panel title="Overview" what="Device activity" result={overview}>
        {(o) => (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Songs in the library" value={o.tracks.toLocaleString("en-US")} />
            <Stat label="Playlists" value={o.playlists.toLocaleString("en-US")} />
            <Stat label="Devices" value={o.devices == null ? "—" : o.devices.toLocaleString("en-US")} />
            <Stat label="Total playtime" value={o.totalPlaySeconds == null ? "—" : formatDuration(o.totalPlaySeconds)} />
          </div>
        )}
      </Panel>

      <Panel title="Playtime" what="Playtime" result={playtime}>
        {(p) => (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted">Per day (last 14)</h3>
              {p.perDay.length === 0 ? <p className="text-sm text-muted">Nothing played yet.</p> : (
                <ol className="flex flex-col gap-2">
                  {p.perDay.map((d) => <BarRow key={d.key} label={d.key} value={d.seconds} max={Math.max(...p.perDay.map((x) => x.seconds))} text={formatDuration(d.seconds)} />)}
                </ol>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted">Per week (weeks start Monday)</h3>
              {p.perWeek.length === 0 ? <p className="text-sm text-muted">Nothing played yet.</p> : (
                <ol className="flex flex-col gap-2">
                  {p.perWeek.map((d) => <BarRow key={d.key} label={`Week of ${d.key}`} value={d.seconds} max={Math.max(...p.perWeek.map((x) => x.seconds))} text={formatDuration(d.seconds)} />)}
                </ol>
              )}
              <p className="text-xs text-muted mt-2">
                Average session: {p.averageSessionSeconds == null ? "not recorded yet" : `${formatDuration(p.averageSessionSeconds)} over ${p.sessions} session${p.sessions === 1 ? "" : "s"} in the last 30 days`}
              </p>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Devices" what="Device activity" result={devices}>
        {(rows) => {
          const active = rows.filter((d) => d.activeNow);
          return (
            <>
              <p className="text-sm">
                <span className="font-semibold">{active.length}</span> active now (heard from in the last 75 seconds), {rows.length} seen in all.
              </p>
              {rows.length === 0 ? <p className="text-sm text-muted">No device has been heard from yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className={th}>Device</th><th className={th}>System</th><th className={th}>Version</th><th className={th}>Last account</th><th className={th}>Last seen</th><th className={th}>Now</th></tr></thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id}>
                          <td className={`${td} font-mono`}>{shortDeviceId(d.id)}</td>
                          <td className={td}>{d.os} · {d.platform}</td>
                          <td className={td}>{d.appVersion}</td>
                          <td className={td}>{d.account}</td>
                          <td className={td}>{when(d.lastSeenAt)}</td>
                          <td className={td}>{d.activeNow ? <span className="text-accent-teal font-semibold">active</span> : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <a className="btn-outline !text-xs self-start" href="/api/admin/export?kind=devices">Export devices (CSV)</a>
            </>
          );
        }}
      </Panel>

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3" aria-label="Filter uploads and library activity">
        <label className="flex flex-col gap-1 text-xs text-muted">From<input type="date" name="from" defaultValue={filter.from ? raw("from") : ""} className="rounded-lg bg-surface-hover border border-border/10 px-2 py-1.5 text-sm text-foreground" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">To<input type="date" name="to" defaultValue={filter.to ? raw("to") : ""} className="rounded-lg bg-surface-hover border border-border/10 px-2 py-1.5 text-sm text-foreground" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Event
          <select name="type" defaultValue={filter.type ?? ""} className="rounded-lg bg-surface-hover border border-border/10 px-2 py-1.5 text-sm text-foreground">
            <option value="">All events</option>
            {AUDIT_EVENT_TYPES.map((t) => <option key={t} value={t}>{auditEventLabel(t)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-outline !text-xs">Apply</button>
        <Link href="/admin/activity" className="btn-outline !text-xs">Clear</Link>
      </form>

      <Panel title="Library activity" what="Library activity" result={audit}>
        {(rows) => (
          <>
            {rows.length === 0 ? <p className="text-sm text-muted">Nothing in this range.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className={th}>When</th><th className={th}>Event</th><th className={th}>By</th><th className={th}>Device</th><th className={th}>What</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className={td}>{when(r.at)}</td>
                        <td className={td}>{auditEventLabel(r.eventType)}</td>
                        <td className={td}>{r.actorRole}</td>
                        <td className={`${td} font-mono`}>{shortDeviceId(r.deviceId)}</td>
                        <td className={td}>{r.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <a className="btn-outline !text-xs self-start" href={`/api/admin/export?kind=audit&${exportParams.toString()}`}>Export this log (CSV)</a>
          </>
        )}
      </Panel>

      <Panel title="Uploads" what="Uploads" result={uploads}>
        {(rows) => (
          <>
            {rows.length === 0 ? <p className="text-sm text-muted">No uploads in this range.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className={th}>When</th><th className={th}>Device</th><th className={th}>Account</th><th className={th}>Song</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className={td}>{when(r.at)}</td>
                        <td className={`${td} font-mono`}>{shortDeviceId(r.deviceId)}</td>
                        <td className={td}>{r.account}</td>
                        <td className={td}>{r.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <a className="btn-outline !text-xs self-start" href={`/api/admin/export?kind=uploads&${exportParams.toString()}`}>Export uploads (CSV)</a>
          </>
        )}
      </Panel>

      <Panel title="Genres" what="Genre counts" result={genres}>
        {(g) => {
          const maxTagged = Math.max(1, ...g.genres.map((x) => x.tagged));
          return (
          <>
            <p className="text-sm">
              <span className="font-semibold">{g.needsReview}</span> waiting for review · <span className="font-semibold">{g.unclassified}</span> without a genre
            </p>
            <p className="text-xs text-muted">
              <span className="font-semibold">Main</span> (the solid bar): songs whose best genre this is, each song counted once.{" "}
              <span className="font-semibold">Tagged</span> (the light bar): songs that carry this genre among their tags, so a song can count under several.{" "}
              A &ldquo;Made by your DJ&rdquo; card starts from the tagged songs but leaves out songs the playlist rules skip (Halloween songs, for example) and only exists for
              genres with enough songs, so its count can be a little lower.
            </p>
            <ol className="flex flex-col gap-2">
              {g.genres.map((x) => (
                <BarRow
                  key={x.genre}
                  label={x.genre}
                  value={x.main}
                  secondary={x.tagged}
                  max={maxTagged}
                  text={`${x.main.toLocaleString("en-US")} main · ${x.tagged.toLocaleString("en-US")} tagged`}
                />
              ))}
            </ol>
          </>
          );
        }}
      </Panel>

      <Panel title="System health" what="System health" result={health}>
        {(h) => (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">File storage</dt><dd>{h.storage ? usageLine(h.storage.usedBytes, h.storage.limitBytes) : "not available"}</dd></div>
            <div><dt className="text-xs text-muted">Database</dt><dd>{h.database ? usageLine(h.database.usedBytes, h.database.limitBytes) : "not available"}</dd></div>
            <div><dt className="text-xs text-muted">Songs not analysed yet</dt><dd>{h.unanalysed == null ? "—" : h.unanalysed.toLocaleString("en-US")} <span className="text-xs text-muted">(analysed the first time each plays)</span></dd></div>
            {h.queues.map((q) => (
              <div key={q.kind}>
                <dt className="text-xs text-muted">{q.kind}</dt>
                <dd>
                  {q.waiting} waiting · {q.running} running ·{" "}
                  {q.failed == null ? (
                    <span className="text-muted">failed count not available</span>
                  ) : (
                    <span className={q.failed > 0 ? "text-accent-pink font-semibold" : ""}>{q.failed} failed in the last {FAILED_JOB_WINDOW_DAYS} days</span>
                  )}
                  {q.earlier > 0 && <span className="text-xs text-muted"> · {q.earlier} earlier</span>}
                </dd>
              </div>
            ))}
            <p className="text-xs text-muted sm:col-span-2">
              Limits show once set in the server settings: ADMIN_BLOB_LIMIT_GB for file storage and ADMIN_DB_LIMIT_MB for the database (this plan&apos;s allowance).
              {h.storage ? ` Total file storage now: ${formatBytes(h.storage.usedBytes)}.` : ""}
            </p>
          </dl>
        )}
      </Panel>
    </div>
  );
}
