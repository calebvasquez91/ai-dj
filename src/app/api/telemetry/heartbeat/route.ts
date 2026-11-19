// The app's heartbeat: { deviceId, sessionId, platform?, appVersion? }, sent every 30 seconds while the app is open. It marks the device
// as active now and moves its session forward. Never fails the app: with the table missing (prisma/telemetry.sql not run yet) it just says no.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { apiHandler, jsonError, unauthorized } from "@/lib/apiRoute";
import { isDeviceId } from "@/lib/telemetry";
import { recordHeartbeat } from "@/lib/telemetryServer";

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const body = (await request.json().catch(() => null)) as { deviceId?: unknown; sessionId?: unknown; platform?: unknown; appVersion?: unknown } | null;
  if (!body || !isDeviceId(body.deviceId) || !isDeviceId(body.sessionId)) return jsonError(400, "A device id and a session id are needed.");
  const recorded = await recordHeartbeat({
    deviceId: body.deviceId,
    sessionId: body.sessionId,
    userId: session.user.id,
    platform: body.platform,
    appVersion: body.appVersion,
    userAgent: request.headers.get("user-agent"),
  });
  return NextResponse.json({ recorded });
}

export const POST = apiHandler(handlePOST);
