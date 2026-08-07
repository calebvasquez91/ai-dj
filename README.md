# AI DJ

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
