-- The two tables behind genre-aware transitions (models GenreTransitionOverride and TransitionDecision in schema.prisma).
--
--   GenreTransitionOverride: the admin's edits to the transition table (a genre's preferred styles and blend bar range), one row per genre, shared by
--   every account. A genre without a row uses the built-in table (lib/genreTransitions.ts).
--   TransitionDecision: one row per genre-aware transition decision (the genre pair, the style, who chose it, what the Audio Engineer vetoed) for the
--   counts on the admin's Transitions page. It holds no song titles and no account.
--
-- Additive and idempotent: it only creates two new tables and an index, and touches no existing table. Run it once against the database (the same one
-- local dev, previews and production all use):
--
--   npx prisma db execute --file prisma/genre-transitions.sql
--
-- Not `prisma db push` (schema.prisma declares an index on Playlist(userId, theme) the live database does not have). Until the tables exist the admin
-- screen says so, the shared table is the built-in one and decisions are simply not logged; the rest of the app is unaffected.

CREATE TABLE IF NOT EXISTS "GenreTransitionOverride" (
    "genre" TEXT NOT NULL,
    "ruleJson" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenreTransitionOverride_pkey" PRIMARY KEY ("genre")
);

CREATE TABLE IF NOT EXISTS "TransitionDecision" (
    "id" TEXT NOT NULL,
    "fromGenre" TEXT NOT NULL,
    "toGenre" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "vetoesJson" TEXT NOT NULL DEFAULT '[]',
    "mixability" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransitionDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TransitionDecision_createdAt_idx" ON "TransitionDecision"("createdAt");
