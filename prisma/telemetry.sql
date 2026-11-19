-- Tables for the device telemetry, the audit log, upload records and playlist images (models Device, AppSession, AuditEvent,
-- UploadRecord, PlayEventDevice and PlaylistImage in schema.prisma).
--
-- What they hold: an anonymous id per install of the app with its platform, OS and app version and when it was last seen (a
-- heartbeat every 30 seconds while the app is open); the sessions that gives; a line for every song added or removed, playlist
-- created, renamed or deleted and playlist image added or removed (who by role, from which device); which device uploaded which
-- song; the device each listening row was played on; and each playlist's own picture. Admin-only to read (the admin pages check it).
--
-- Additive and idempotent: only creates tables and indexes, does nothing if they exist, and does not touch any existing table.
-- Run it once against the database (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/telemetry.sql
--
-- Not `prisma db push` (schema.prisma declares an index on Playlist(userId, theme) the live database does not have). Until these
-- tables exist every recording call quietly does nothing and the Activity page says so; the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "Device" (
    "id" TEXT NOT NULL,
    "lastUserId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "os" TEXT NOT NULL DEFAULT 'unknown',
    "appVersion" TEXT NOT NULL DEFAULT 'unknown',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

CREATE TABLE IF NOT EXISTS "AppSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AppSession_deviceId_lastBeatAt_idx" ON "AppSession"("deviceId", "lastBeatAt");
CREATE INDEX IF NOT EXISTS "AppSession_startedAt_idx" ON "AppSession"("startedAt");

CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT,
    "deviceId" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

CREATE TABLE IF NOT EXISTS "UploadRecord" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "trackTitle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UploadRecord_createdAt_idx" ON "UploadRecord"("createdAt");
CREATE INDEX IF NOT EXISTS "UploadRecord_deviceId_idx" ON "UploadRecord"("deviceId");

CREATE TABLE IF NOT EXISTS "PlayEventDevice" (
    "playEventId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    CONSTRAINT "PlayEventDevice_pkey" PRIMARY KEY ("playEventId")
);
CREATE INDEX IF NOT EXISTS "PlayEventDevice_deviceId_idx" ON "PlayEventDevice"("deviceId");

CREATE TABLE IF NOT EXISTS "PlaylistImage" (
    "playlistId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistImage_pkey" PRIMARY KEY ("playlistId")
);
