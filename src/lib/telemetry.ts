// Pure parts of the device telemetry and the audit log (the server side is lib/telemetryServer.ts): the anonymous device id, the heartbeat
// timing, what a device is from its user agent, the audit event types, session and playtime arithmetic for the Admin pages, and the CSV the
// admin exports. No names or emails are involved: a device is only an id, a platform, an OS and an app version.

/** The cookie that holds a browser's anonymous device id. Not secret and not a login: it only tells installs apart. */
export const DEVICE_COOKIE = "qdj_device";
export const HEARTBEAT_MS = 30_000;
/** A device counts as active now when it has been heard from within this long (two missed beats of grace). */
export const ACTIVE_WINDOW_MS = 75_000;
/** No session is counted as longer than this (a tab left open overnight is not twelve hours of use). */
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

/** The device id in a Cookie header, or null when there is none or it is not a well-formed id. */
export function deviceIdFromCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEVICE_COOKIE) {
      const value = rest.join("=");
      return isDeviceId(value) ? value : null;
    }
  }
  return null;
}

export function isActiveNow(lastSeenAt: Date | number, now: number = Date.now()): boolean {
  const seen = typeof lastSeenAt === "number" ? lastSeenAt : lastSeenAt.getTime();
  return now - seen <= ACTIVE_WINDOW_MS;
}

export type DeviceOs = "Windows" | "macOS" | "iOS" | "Android" | "ChromeOS" | "Linux" | "unknown";

/** The OS named in a user agent. Phones and tablets are checked before the desktop systems they pretend to be. */
export function osFromUserAgent(userAgent: string | null | undefined): DeviceOs {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux|X11/i.test(ua)) return "Linux";
  return "unknown";
}

/** Short text from a client, safe to keep: control characters out, trimmed, cut to length, or the fallback when nothing is left. */
export function cleanInfo(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return text || fallback;
}

export const AUDIT_EVENT_TYPES = [
  "song_added",
  "song_removed",
  "playlist_created",
  "playlist_renamed",
  "playlist_deleted",
  "image_added",
  "image_removed",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

const AUDIT_LABELS: Record<AuditEventType, string> = {
  song_added: "Song added",
  song_removed: "Song removed",
  playlist_created: "Playlist created",
  playlist_renamed: "Playlist renamed",
  playlist_deleted: "Playlist deleted",
  image_added: "Image added",
  image_removed: "Image removed",
};

export function isAuditEventType(value: unknown): value is AuditEventType {
  return typeof value === "string" && (AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

export function auditEventLabel(type: string): string {
  return isAuditEventType(type) ? AUDIT_LABELS[type] : type;
}

/** The text of one CSV cell: quoted when it needs it, and a cell that starts like a spreadsheet formula is made plain text (so an exported song title cannot run as one). */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The length of one session in seconds (its last beat minus its start), never negative and never more than the cap. */
export function sessionSeconds(startedAt: Date | number, lastBeatAt: Date | number): number {
  const a = typeof startedAt === "number" ? startedAt : startedAt.getTime();
  const b = typeof lastBeatAt === "number" ? lastBeatAt : lastBeatAt.getTime();
  return Math.round(Math.min(Math.max(0, b - a), MAX_SESSION_MS) / 1000);
}

export function averageSessionSeconds(sessions: readonly { startedAt: Date | number; lastBeatAt: Date | number }[]): number {
  if (sessions.length === 0) return 0;
  const total = sessions.reduce((sum, s) => sum + sessionSeconds(s.startedAt, s.lastBeatAt), 0);
  return Math.round(total / sessions.length);
}

/** "2026-11-19": the UTC day a moment falls on. */
export function dayKey(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The Monday (UTC) of the week a moment falls in, as a day key. */
export function weekKey(at: Date | number): string {
  const d = new Date(new Date(at).toISOString().slice(0, 10) + "T00:00:00Z");
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return dayKey(d.getTime() - sinceMonday * 86_400_000);
}

/** Seconds played added up by day or by week, oldest first. */
export function playtimeSeries(rows: readonly { at: Date | number; seconds: number }[], unit: "day" | "week"): { key: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = unit === "day" ? dayKey(r.at) : weekKey(r.at);
    totals.set(key, (totals.get(key) ?? 0) + r.seconds);
  }
  return [...totals].map(([key, seconds]) => ({ key, seconds })).sort((a, b) => a.key.localeCompare(b.key));
}

/** A "YYYY-MM-DD" from a query string as the start (or the end of) that UTC day, or null for anything else. */
export function parseDayParam(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
