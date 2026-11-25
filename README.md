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

## Genre-aware transitions (flag `GENRE_TRANSITIONS_ENABLED`, off)

The DJ and the audio engineer choose each transition's style and tools from the two songs' genres. The genre layer only chooses what to ask for; a beat-synced blend is handed to the existing sync pipeline unchanged (a golden test with the flag on checks the engine arguments, transition plan and `SyncReport` are identical). Pieces: the per-genre table (`src/lib/genreTransitions.ts`), the pair resolver (`transitionPlanner.ts`), the engineer's report and vetoes (`mixability.ts`), the DJ's choice with a Claude Haiku tie-break (`transitionChoice.ts`, `anthropicTransitionPick.ts`), and the hand-off to the engine (`genrePlanApply.ts`, through `planArgsFromState`). A song's key confidence is trusted from the app's own line (0.15), not a stricter one: most songs read under 0.3. The engine's hard cut is switched off by the owner's choice, so a planned quick cut plays as a short phrase blend. Admin: `/admin/transitions` (counts, shared table editor; tables from `prisma/genre-transitions.sql`).

## Vocal / instrumental separation (flag `VOCAL_SPLIT_ENABLED`, off)

**Decision: the instrumental is the sum of the drums, bass and other stems (`src/lib/wav.ts`, `src/lib/stemInstrumental.ts`); no second, two-stem separation run.**

The app already separates four stems with Demucs (`htdemucs`) on Replicate. Two ways to get a vocal-free mix were considered:

| | (a) sum the stems | (b) two-stem run (`isolate_stem: "vocals"`) |
|---|---|---|
| Extra model run | none: reuses the finished stems | one more paid run per song |
| Time | about 1-2 s on the server (measured: 1.3 s for 127 s of audio, 2.0 s for 204 s) | the same Demucs run again (8-12 s of GPU time, about $0.01 per song) |
| Audio | the three non-vocal stems added sample by sample | Demucs's own `no_vocals`, which it builds as the sum of the same non-vocal sources |
| File size | 16-bit stereo WAV: 22.4 MB, 36.0 MB and 34.6 MB for songs of 127, 204 and 196 s (a 24-bit model stem is 1.5x that) | not measured |

What was measured, on the three songs that already had finished stem jobs (stems from the pinned model version `5a7041cc`): processing 8.3, 12.4 and 11.9 s; estimated cost $0.009, $0.014 and $0.013; each 24-bit stem 33.7, 54.0 and 51.8 MB; the summed instrumental peaked above full scale on two of the three (it is scaled down by 0.98 and 0.96, not clipped). As a proxy for vocal bleed the 300-3400 Hz level of the instrumental was compared with the vocal stem's loudness over time: the correlation is 0.05, -0.08 and -0.13, so the instrumental does not move with the vocal.

**What was NOT done, and why.** No listening was possible in this session, so there is no listening note on artifacts, and the vocal-band correlation is only a proxy. Option (b) was not measured: a run of the current model version (`ff5ad47d2685`, the first with `isolate_stem`) on a sample song stalled with no output for 15+ minutes (the Replicate account has under $5 of credit, which also limits it to one new prediction at a time), and it was not cancelled from here. The choice therefore rests on how the model builds `no_vocals` (not re-verified numerically) and on the cost and time above. If a listening test of (b) on real songs ever shows it is cleaner, switching is a change to one function.

How it runs: `GET/POST /api/stems/instrumental` builds one instrumental (and the vocal activity timeline, a voice map from the vocal stem's energy) per call, from stems that already exist, and does nothing while the flag is off; add it to `vercel.json` crons when enabling. It never starts a paid separation (the stem flow does, under its own budget). The columns it writes come from `prisma/vocal-split.sql`. Vocal swaps (`src/lib/vocalSwap.ts`) are scheduled only in a stretch where both vocals are silent, so two lead vocals are never audible together; with no such gap the planner picks another style. "Instrumental mode" (a switch on the DJ board, from the next song on) plays the built instrumental in place of the song. The instrumental takes effect in the player's deck loads and Song Sync decodes only.

**Licensing and safety.** Separated files are for playback inside the app only: nothing offers a download, export or share of a vocal or instrumental file. Streaming separated audio to other people needs the same licenses as the original songs. The Demucs code and its pretrained `htdemucs` weights are published by Meta under the MIT license (per the project's repository; this was not re-checked against the live repository in this session, so confirm before any commercial use). Replicate's hosted copy (`ryan5453/demucs`) is a separate wrapper with its own terms. The songs themselves are sent to Replicate to be separated, as the existing stem feature already does.
