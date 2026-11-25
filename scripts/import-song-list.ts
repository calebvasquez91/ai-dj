// Puts the owner's song list (data/dj-library.jsonl) into the SongListEntry table for Vibe Code's "From your song list" suggestions.
//
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-song-list.ts            (a dry run: reads the file and the database, writes nothing)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/import-song-list.ts --apply    (writes)
//   ... --apply --prune                                                                         (writes, and deletes rows that are no longer in the file)
//
// The table must exist first (prisma/song-list.sql). Without --apply it only reports: how many rows the file has, how many of its genre words the app's genre
// list recognises, how many songs are already uploaded (those are left out of the suggestions), and how many rows in the table are no longer in the file. With
// --apply it upserts every row by its list id, so it can be run again after the list changes. A row that has left the file stays in the table, and keeps being
// suggested, until the run has --prune as well (the dry run says how many that would delete). Only music facts are written: no recommender names and no notes.
// The same database local dev, previews and production all use. Not part of the build or the tests.
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { normalize } from "../src/lib/genres";
import { dedupeSongs, ownedSongKeys } from "../src/lib/songList";
import { parseLibraryJsonl } from "../src/lib/djLibrary";

const LIBRARY_PATH = "data/dj-library.jsonl";
const apply = process.argv.includes("--apply");
const prune = process.argv.includes("--prune");

async function main() {
  const { rows, skipped } = parseLibraryJsonl(readFileSync(LIBRARY_PATH, "utf8"));
  const songs = dedupeSongs(rows);
  const mapped = songs.filter((s) => normalize(s.subGenre) ?? normalize(s.genre)).length;
  console.log(`list rows: ${rows.length} (${skipped} unreadable skipped) | distinct songs: ${songs.length} | genre wording the app recognises: ${mapped} of ${songs.length}`);

  const tracks = await prisma.track.findMany({ select: { title: true, artist: true } });
  const owned = ownedSongKeys(rows, songs, tracks);
  console.log(`already uploaded: ${owned.size} songs | would be suggested (not uploaded): ${songs.length - owned.size}`);

  // The ids already in the table (null when the table does not exist yet), so rows that have left the file can be reported and, with --prune, deleted.
  let stored: string[] | null = null;
  try {
    stored = (await prisma.songListEntry.findMany({ select: { id: true } })).map((r) => r.id);
  } catch {
    stored = null;
  }
  const inFile = new Set(rows.map((r) => r.id));
  const stale = (stored ?? []).filter((id) => !inFile.has(id));
  console.log(stored === null ? "table: not found (run prisma/song-list.sql first)" : `table: ${stored.length} rows | rows no longer in the file: ${stale.length}${stale.length > 0 ? (prune ? " (--prune would delete them)" : " (kept; add --prune with --apply to delete them)") : ""}`);

  if (!apply) {
    console.log("dry run: nothing written. Add --apply to write the rows (the table must exist: prisma/song-list.sql).");
    return;
  }
  if (stored === null) {
    console.error("The SongListEntry table does not exist yet: run prisma/song-list.sql first. Nothing was written.");
    process.exitCode = 1;
    return;
  }

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.$transaction(
      rows.slice(i, i + BATCH).map((r) => {
        const data = {
          playlist: r.playlist,
          title: r.title,
          artist: r.artist,
          genre: r.genre,
          subGenre: r.subGenre,
          year: r.year,
          bpm: r.bpm,
          camelot: r.camelot,
          energy: r.energy == null ? null : Math.round(r.energy),
          moods: r.moods.join(","),
          explicit: r.explicit,
          durationSec: r.durationSec,
        };
        return prisma.songListEntry.upsert({ where: { id: r.id }, create: { id: r.id, ...data }, update: data });
      })
    );
  }
  console.log(`wrote ${rows.length} rows to SongListEntry`);
  if (prune && stale.length > 0) {
    const { count } = await prisma.songListEntry.deleteMany({ where: { id: { in: stale } } });
    console.log(`deleted ${count} rows that are no longer in the file`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
