# Remodel plan: DJ Claude as a modern streaming app

Working branch: `remodel-v2`. The old app is recoverable two ways: the tag `pre-remodel` and the branch `legacy-v1`
(both at `dc88b2c`, the PR 27 merge, which is what https://ai-dj-gamma.vercel.app serves today). Nothing here is pushed
or deployed until asked for.

## Scope: what the spec became

The spec was written for an Expo React Native monorepo. This repo is a Next.js 16 web app (React 19, Zustand, Prisma 7 on
Neon, NextAuth, Web Audio). The chosen approach is **redesign the existing app**:

| Spec item | Here |
| --- | --- |
| `/app` Expo, `/server` Fastify + SQLite, `/packages/contracts`, MusicProvider (Local/Api) | Not built. The Next app, its API routes and Prisma schema stay as they are. |
| AsyncStorage to SQLite migration | Not applicable (the library already lives in Postgres). |
| AI proxy, key only on the server | Already true: Anthropic calls are in `src/app/api/dj/*`; no `NEXT_PUBLIC_ANTHROPIC*` exists (checked). |
| Admin password / session rules | Out of scope (no admin flow in this app). |
| Move the engine to `app/src/engine/` | Not done: the audio engine, `DualDeckStage`, sync/morph code and every flag stay where they are, untouched. |
| Expo Go, expo-router, FlashList, Reanimated, gorhom sheet, expo-image | Replaced by Next routes, CSS, and small React primitives. |
| Design tokens, primitives, screens, nav, Now Playing, desktop shell, Que behind a flag | **Built**, in phases, one commit each. |

Flags carried over exactly (not edited): `TRANSITION_FX_ENABLED = false`, `SYNC_TEST_ENABLED = false`,
`getEligibleFX()` (Halloween FX only in Spooky Music), true shuffle with the AI DJ ordering the queue.

## Phases (one commit each)

1. **Design tokens and Settings.** The spec palette as CSS variables in `src/app/globals.css`, dark by default on first
   launch, System / Dark / Light in a Settings screen (`src/lib/theme.ts` becomes three-way), light tokens too, DM Sans
   for text and Space Mono for time and BPM (`src/app/layout.tsx`). Gradient only on play button, progress fill, active
   tab indicator and SYNC.
2. **Primitives** in `src/ui/`: Text, Button, IconButton, Chip, Card, Tile, CoverArt (generated gradient fallback),
   Carousel, PagedGrid (page dots), Skeleton, Sheet, TrackRow, SectionHeader. Everything after this uses them.
3. **Navigation shell.** Phone (< 600px): four tabs in the spec's order (Home, Search, Library, Playlists) with a mini
   player directly above. Tablet (600-1023): icon rail. Desktop (>= 1024): sidebar, centre, collapsible right panel
   (Now Playing / Queue), bottom player bar. Keep keyboard shortcuts and add Space for play/pause.
4. **Screens.** Home (filter chips, quick-access grid, "Choose a mix" hero carousel, paged 3x3 Quick picks,
   Recently added / Recently played / Mixed for you, skeletons), Search (grouped results, Browse-all tiles),
   Library (Songs, Artists, Liked, FX segments), Playlists (mosaics, Spooky pinned, detail with the existing Add Music bar).
5. **Now Playing sheet** with Queue, DJ and Chat tabs. Queue = `QueuePanel`, DJ = the existing deck/mixer/sync board
   (`DeckView`, `Mixer`, `SongSyncPanel`), both moved in, not rewritten. Chat is new.
6. **Remove Que, behind `QUE_ENABLED = false`.** Code moves to `src/features/que/`, nothing outside imports it
   unconditionally, album art shows real art or the gradient. Spooky theme otherwise stays.
7. **Verify.** `tsc`, lint, tests, live check of every item in the spec's verify list that applies to a web app.

## File disposition

**Keep untouched (engine, data, API, flags):** `src/components/DualDeckStage.tsx`, `YouTubeDeckStage.tsx`,
`BackgroundAudio.tsx`, `StemAutopilot.tsx`, `VoiceMapLoader.tsx`; all of `src/app/api/**`; `prisma/**`; `src/lib/*`
engine and sync code (`mix-engine`, `syncEngine`, `songSync`, `analysisJobs`, `fxAffinity`, `featureFlags`, ...);
`src/components/AddMusicBar.tsx` (restyled only through tokens); the store's data and playback logic.

**Change (restyle or restructure):** `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`,
`(app)/page.tsx` (Home), `library/page.tsx`, `playlists/page.tsx`, `playlist/page.tsx`, `search/page.tsx`,
`Sidebar.tsx`, `TopBar.tsx`, `BottomNav.tsx`, `PlayerBar.tsx`, `NowPlayingView.tsx`, `QueuePanel.tsx`, `DeckView.tsx`,
`Mixer.tsx`, `TrackGrid.tsx`, `TrackList.tsx`, `Shelf.tsx`, `TrackThumbnail.tsx`, `FxLibraryPanel.tsx`,
`AccountMenu.tsx`, `ThemeToggle.tsx`, `ThemeInit.tsx`, `src/lib/theme.ts`, `src/lib/navTabs.ts`.

**New:** `src/ui/*` (primitives), `src/features/settings/*` (or a `/settings` route), Home data helpers in `src/lib/`
(pure, with Vitest tests), a Chat route `src/app/api/dj/chat/route.ts` and its panel, `src/features/que/*`.

**Move (Phase 6):** `src/components/Que.tsx`, `QueCostumes.tsx`, `QueDock.tsx` and the `.que-*` rules in `globals.css`
to `src/features/que/`. `--que-lane-h` stays defined and stays 0 while Que is off.

**Delete:** nothing is deleted outright. Anything replaced is either moved or removed in the commit that supersedes it,
and `legacy-v1` keeps the old versions.

## Things the spec asks for that this app does not have today

These need a decision or a default. The default is what I will build unless told otherwise.

- **Albums.** `Track` has no album field and the API is off limits. Default: no Albums segment; Artists is derived.
- **Liked.** No like feature exists. Default: a per-device list in the browser (no database change), swappable later.
- **AI Chat.** No chat exists. Default: a new `/api/dj/chat` route and a Chat tab, using `claude-sonnet-5`.
- **AI-built mixes (Energize, Chill, Workout).** Default: built on the device from each track's analysed BPM and energy
  (pure, tested), not by a new AI call; "Mixed for you" the same way.
- **Palette and fonts.** The spec's tokens (`#080810` ... `#a78bfa`) and DM Sans / Space Mono replace the current purple
  and teal theme and Geist. This changes how the whole app looks.
- **Quick picks / filter chips** (All, Music, Mixes, Energize, Chill, Workout, Party): chips filter by derived mood
  from BPM and energy, so no new tags are needed.

## Risks and how they are handled

- Audio must not change: `DualDeckStage` and the engine are not edited; the layout keeps its single mounted instance.
- Overlays are sized by `--topbar-h`, `--player-bar-h`, `--bottom-nav-h`, `--dock-h`, `--chrome-bottom` (PR 25); the
  new shell keeps publishing those so the Queue, Decks and Mixer sheets never cover the player.
- Every phase ends with `tsc`, `eslint`, `vitest`, and a live look at the changed screens on a disposable
  `claude-*@local.test` account, cleaned up afterwards.
- Real-device behaviour (iOS lock screen, keyboard) cannot be proven here and will be listed as unverified.
