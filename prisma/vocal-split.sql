-- Three columns on StemSeparationJob (schema.prisma) for vocal / instrumental separation (VOCAL_SPLIT_ENABLED):
--
--   instrumentalUrl      the vocal-free mix (drums + bass + other summed) built from a finished job's stems, stored in Blob. For playback inside the app only.
--   instrumentalBuiltAt  when a build was last attempted (set on success and on failure; a failed job is retried an hour later).
--   vocalActivityJson    when the lead vocal is present (a voice map built from the vocal stem's energy), so vocal swaps can be scheduled in the gaps.
--
-- Additive and idempotent: it only adds nullable columns, and does nothing if they exist. It does not touch existing rows. Run it once against the database
-- (the same one local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/vocal-split.sql
--
-- Not `prisma db push` (schema.prisma declares an index on Playlist(userId, theme) the live database does not have). Until the columns exist nothing reads
-- or writes them: the feature is off (VOCAL_SPLIT_ENABLED) and the stem jobs work exactly as before.

ALTER TABLE "StemSeparationJob" ADD COLUMN IF NOT EXISTS "instrumentalUrl" TEXT;
ALTER TABLE "StemSeparationJob" ADD COLUMN IF NOT EXISTS "instrumentalBuiltAt" TIMESTAMP(3);
ALTER TABLE "StemSeparationJob" ADD COLUMN IF NOT EXISTS "vocalActivityJson" TEXT;
