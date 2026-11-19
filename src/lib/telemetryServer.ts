// Server-only. Writes the device telemetry and the audit log (the tables in prisma/telemetry.sql). Every call is best effort: until the SQL has
// been run, or on any database hiccup, it logs a warning and carries on, so recording can never break or slow down what the person asked for.
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/feedbackAdmin";
import { cleanInfo, deviceIdFromCookie, isDeviceId, osFromUserAgent, type AuditEventType } from "@/lib/telemetry";

/** The anonymous device id in the request's cookie, or null. */
export function requestDeviceId(request: Request): string | null {
  return deviceIdFromCookie(request.headers.get("cookie"));
}

function warn(what: string, err: unknown) {
  console.warn(`Could not record ${what} (has prisma/telemetry.sql been run?):`, err instanceof Error ? err.message : err);
}

/** One line in the audit log: who (by role), from which device, did what to what. */
export async function recordAuditEvent(args: {
  eventType: AuditEventType;
  actorId: string;
  deviceId: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        eventType: args.eventType,
        actorRole: isAdmin(args.actorId) ? "admin" : "user",
        actorId: args.actorId,
        deviceId: args.deviceId,
        targetId: args.targetId ?? null,
        targetLabel: args.targetLabel?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    warn("an audit event", err);
  }
}

/** Which device uploaded which song. */
export async function recordUpload(args: { userId: string; deviceId: string | null; trackId: string; trackTitle: string }): Promise<void> {
  try {
    await prisma.uploadRecord.create({
      data: { userId: args.userId, deviceId: args.deviceId, trackId: args.trackId, trackTitle: args.trackTitle.slice(0, 300) },
    });
  } catch (err) {
    warn("an upload", err);
  }
}

/** The device a listening row was played on. */
export async function recordPlayDevice(playEventId: string, deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  try {
    await prisma.playEventDevice.upsert({ where: { playEventId }, create: { playEventId, deviceId }, update: { deviceId } });
  } catch (err) {
    warn("the device of a play", err);
  }
}

/** An account may bring this many new devices in a day, and a device may start this many sessions in a day: past that a heartbeat is refused, so a client cannot fill the tables. */
export const MAX_NEW_DEVICES_PER_DAY = 10;
export const MAX_SESSIONS_PER_DEVICE_PER_DAY = 200;
const DAY_MS = 86_400_000;

/** A heartbeat: the device is seen now (created on its first), and its session's last beat moves forward (created on its first). */
export async function recordHeartbeat(args: {
  deviceId: string;
  sessionId: string;
  userId: string;
  platform: unknown;
  appVersion: unknown;
  userAgent: string | null;
  now?: Date;
}): Promise<boolean> {
  if (!isDeviceId(args.deviceId) || !isDeviceId(args.sessionId)) return false;
  const now = args.now ?? new Date();
  const info = {
    platform: cleanInfo(args.platform, 24, "web"),
    os: osFromUserAgent(args.userAgent),
    appVersion: cleanInfo(args.appVersion, 24, "unknown"),
  };
  try {
    const since = new Date(now.getTime() - DAY_MS);
    const known = await prisma.device.findUnique({ where: { id: args.deviceId }, select: { id: true } });
    if (!known && (await prisma.device.count({ where: { lastUserId: args.userId, firstSeenAt: { gte: since } } })) >= MAX_NEW_DEVICES_PER_DAY) return false;
    await prisma.device.upsert({
      where: { id: args.deviceId },
      create: { id: args.deviceId, lastUserId: args.userId, ...info, firstSeenAt: now, lastSeenAt: now },
      update: { lastUserId: args.userId, ...info, lastSeenAt: now },
    });
    const knownSession = await prisma.appSession.findUnique({ where: { id: args.sessionId }, select: { id: true } });
    if (!knownSession && (await prisma.appSession.count({ where: { deviceId: args.deviceId, startedAt: { gte: since } } })) >= MAX_SESSIONS_PER_DEVICE_PER_DAY) return true;
    await prisma.appSession.upsert({
      where: { id: args.sessionId },
      create: { id: args.sessionId, deviceId: args.deviceId, userId: args.userId, startedAt: now, lastBeatAt: now },
      update: { lastBeatAt: now },
    });
    return true;
  } catch (err) {
    warn("a heartbeat", err);
    return false;
  }
}
