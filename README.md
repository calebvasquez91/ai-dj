# Que DJ

A web app that plays a queue of your own local audio files back-to-back like a continuous DJ set, auto-transitioning between songs with timed crossfades instead of hard cuts.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), go to **Local Files** in the sidebar, and click **+ Add Files** to pick audio files from your computer. No API keys or accounts needed.

Note: picked files live only in that browser tab (as `blob:` object URLs) — after a reload you'll need to re-add them. Playlists persist across reloads, but any local-file tracks saved in a playlist will show up without a working audio source until you re-add the same files.

## How the mixing engine works

Two `<audio>` decks play in the background; only one is audible at a time. As the active track nears its end (or when you hit "Mix Now"), the next queued track is loaded into the idle deck and the two are cross-faded using an equal-power volume curve ([`src/lib/mixEngine.ts`](src/lib/mixEngine.ts)) — both tracks are briefly audible together, then the decks swap roles. Auto-DJ toggles between this early, overlapping crossfade and a short tail fade at the very end of a track.

## Genre classification: sources, keys, models and licenses

Every track can carry genres on one fixed taxonomy (`src/lib/genres.ts`: 26 genres, each with subgenres and alias lists, so
"Hip Hop/Rap", "rap" and "hip-hop" are all Hip-Hop). The work is done on the server as background jobs
(`src/lib/genre/`); the app only reads the results. Run `prisma/genre-tables.sql` once against the database before using it
(`npx prisma db execute --file prisma/genre-tables.sql`); until then the genre routes answer "not set up yet" and nothing else is affected.

Environment variables (all server-side; none reach the browser bundle):

| Variable | Used for | If missing |
| --- | --- | --- |
| `LASTFM_API_KEY` | Last.fm top tags (genres and moods) | that source is skipped |
| `ACOUSTID_API_KEY` | fingerprint lookup (with `FPCALC_PATH`) | that source is skipped |
| `FPCALC_PATH` | path to the `fpcalc` (Chromaprint) tool on the server | fingerprinting is off |
| `ANTHROPIC_API_KEY` | the Claude Haiku reconciler and the playlist curator | those are skipped |
| `GENRE_LLM_MODEL` | overrides the Haiku model id (default in `llmReconciler.ts`) | default used |
| `CLASSIFIER_ENABLED` | `true` turns the audio classifier on | off (and no model is bundled anyway) |
| `GENRE_CONTACT_URL` | the contact in the User-Agent sent to MusicBrainz and Last.fm | the app's public URL |
| `CRON_SECRET` | the secret Vercel Cron (and any scheduler) sends as `Authorization: Bearer <secret>` to `GET /api/genre/run` | the cron call is refused (401); only the signed-in app drains the queue |

### How the background work runs

A new upload or import queues a job per track (`GenreJob`). While the app is open it asks the server to work a few jobs at a time
(`POST /api/genre/run`), at most one MusicBrainz request a second across every instance (the limit is kept in the database).
Tracks that were never classified are queued once per session at low priority (the backfill). A failed job is retried after
30 s, 60 s, 2 min... up to an hour, and given up after five tries. Nothing runs while the app is closed unless a scheduler
calls the run route. `vercel.json` schedules that every minute (`GET /api/genre/run`): it takes up to 20 jobs per call and,
when the queue is empty, queues the next 1,000 never-classified songs, so the whole library gets classified with nobody having the
app open. It needs `CRON_SECRET` set in Vercel (Vercel then sends it as `Authorization: Bearer ...` itself); without it the call
is refused. **Per-minute schedules need Vercel Pro**: on Hobby (daily cron only) a deployment with this schedule fails, so change
the schedule in `vercel.json` to `0 4 * * *` or remove it.

### Models and licenses

No audio genre model is bundled or enabled. The classifier is an interface behind `CLASSIFIER_ENABLED`; a model can be plugged in
without other code changes once its license has been checked against this app's use.

| Component | Used here? | License | Notes |
| --- | --- | --- | --- |
| Essentia library | No | AGPL-3.0 | Barred by `CLAUDE.md`: AGPL would oblige releasing this app's full source. |
| Essentia genre models `genre_discogs400`, `genre_discogs519` (`discogs-effnet`, `discogs-maest`), `mtg_jamendo_genre` | No | CC BY-NC-SA 4.0 | Non-commercial and share-alike, per essentia.upf.edu/models.html (checked 2026-11-17). MTG also offers a proprietary license on request. |
| `music-metadata` (reads ID3/Vorbis/MP4 tags) | Yes | MIT | New dependencies it pulls in are MIT or BSD-3-Clause. |
| Chromaprint `fpcalc` | Optional, external | depends on the build you install | Not bundled or committed; only run if `FPCALC_PATH` names one. Check the license of the build you use. |
| Claude Haiku (`claude-haiku-5-5`) | Yes | Anthropic API terms | Only metadata is sent (title, artist, album, year, the other sources' tags), never audio or lyrics. |

### Data sources and their terms

- **MusicBrainz**: a User-Agent that names the app, at most one request a second (queued in the database so it holds across
  serverless instances), every answer cached 30 days (7 days for "not found"). Its core data is CC0; its *supplementary* data
  is CC BY-NC-SA 3.0 (non-commercial, share-alike), and genres and tags are user-contributed. The license page does not itself
  say which side tags fall on, so confirm with MetaBrainz before using this commercially.
- **Last.fm**: its API terms limit use to non-commercial purposes (a commercial use needs an agreement with Last.fm), cap stored
  data at 100 MB (only the derived genre and mood labels are kept, not Last.fm's tag lists), and ask for attribution where its data is shown.
- **AcoustID**: fingerprints are sent, never audio, and every answer is cached.
- Only metadata is stored. No lyrics or other copyrighted text is fetched or kept.
