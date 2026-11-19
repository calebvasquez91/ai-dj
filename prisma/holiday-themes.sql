-- The table behind a playlist's holiday theme (model PlaylistHoliday in schema.prisma): which of the ten holiday themes (Christmas, Valentine's
-- Day, New Year's Eve, St. Patrick's Day, Easter, Fourth of July, Thanksgiving, Hanukkah, Diwali, Lunar New Year) a playlist uses for its waveform
-- colours, accent tint and light particles while it plays.
--
-- Additive and idempotent: it only creates one new table and touches no existing one. Run it once against the database (the same one local dev,
-- previews and production all use):
--
--   npx prisma db execute --file prisma/holiday-themes.sql
--
-- Not `prisma db push` (schema.prisma declares an index on Playlist(userId, theme) the live database does not have). Until the table exists the
-- picker says so and playlists simply have no holiday theme; the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "PlaylistHoliday" (
    "playlistId" TEXT NOT NULL,
    "holiday" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistHoliday_pkey" PRIMARY KEY ("playlistId")
);
