// Whether a request carries the scheduler's secret (Authorization: Bearer $CRON_SECRET). With CRON_SECRET unset nothing counts as the scheduler.
import { timingSafeEqual } from "node:crypto";

export function isScheduler(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
