/**
 * Stem separation and what hangs off it (the stem autopilot, the Stems panel, voice-end detection) is paused: the
 * pieces are in the codebase and tested, but nothing starts paid jobs or builds voice maps until this is switched on
 * with NEXT_PUBLIC_STEM_FEATURES="on". (NEXT_PUBLIC_ so the client bundle sees the same value as the server.)
 * The rest of the app — playback, the mix engine, the sync report — doesn't depend on it.
 */
export const STEM_FEATURES_ENABLED = process.env.NEXT_PUBLIC_STEM_FEATURES === "on";

/**
 * The per-song stem button (components/SeparateStemsButton.tsx) on library rows and cards. Off: no song shows a stem button, a
 * "Separating stems…" chip or a stem badge. The stem engine itself (separation jobs, the stem caches, per-stem handling in the
 * sync, the DJ board's controls) is not affected: it is switched by STEM_FEATURES_ENABLED above. Set true to bring the button back.
 */
export const SHOW_STEM_BUTTON_ON_SONGS = false;

/**
 * Song Sync Mode (lib/songSync.ts): the playing track's tempo and pitch morph, bar by bar, onto the next track's before
 * a plain four-bar crossfade. On by default (the "Auto" switch beside the SYNC button on the DJ board decides whether
 * every automatic transition is one); set NEXT_PUBLIC_SONG_SYNC="off" at build time to remove it entirely and get the
 * ordinary transitions back.
 */
export const SONG_SYNC_ENABLED = process.env.NEXT_PUBLIC_SONG_SYNC !== "off";

/**
 * The in-app "Run Sync Test — Same Beat" suite (lib/syncTest.ts, syncTestRunner.ts, components/SyncTestPanel.tsx): the
 * button on the DJ board, the pair-by-pair verification run, the "Fix Issues Automatically" loop, the results panel and
 * the Export Log. Switched off: none of it renders or runs, and the Same Beat playlist is an ordinary playlist that
 * plays with the normal sync/morph behaviour. All the test code stays in place; flip this to true to bring it back.
 */
export const SYNC_TEST_ENABLED = false;

/**
 * The vocal mashup (lib/vocalMashup.ts): when the playing track's singing is over, the next track's vocal rides its
 * instrumental. Independent of the paused stem features above: it separates only the one next track of a mashable
 * pair, on demand, under the same server-side budget, and builds voice maps only to know when singing has ended. Off
 * by default until a real stem separation has been run end to end; set NEXT_PUBLIC_VOCAL_MASHUP="on" to enable (it
 * also needs the "Mashups" toggle on the DJ board).
 */
export const VOCAL_MASHUP_ENABLED = process.env.NEXT_PUBLIC_VOCAL_MASHUP === "on";

// ---- The new DJ abilities. Each has its own switch, all off until it has been checked on real playback, so one can be turned on without turning on
// ---- another (and without touching the paused transition effects: TRANSITION_FX_ENABLED in lib/syncEngine.ts is a separate flag and stays as it is).
// ---- Every DJ move is locked to the master clock and the beat grid, rate-limited and gated by energy; none of them is ever random.

/** Seed radio (lib/radio.ts): playing one song on its own queues songs that go with it, kept topped up; "Start radio" on a song. */
export const SEED_RADIO_ENABLED = false;
/** Stutter repeats (lib/stutter.ts) on 1/16, 1/8 and 1/4 notes at energy peaks and drops. */
export const STUTTER_ENABLED = false;
/** Scratching (lib/scratch.ts): beat-quantised scratch patterns over a song, and as a transition bridge. */
export const SCRATCH_ENABLED = false;
/** Instrumental bridges (lib/instrumentalBridge.ts): a song morphs into an instrumental, which morphs into the next song. */
export const INSTRUMENTAL_BRIDGE_ENABLED = false;
/** DJ EQ moves (lib/djEq.ts): low cuts, bass returns, high lifts and bass swaps on beat and phrase boundaries. */
export const DJ_EQ_ENABLED = false;
/** Echo-out (lib/echoOut.ts): a song that ends abruptly echoes into silence, holds 3 to 5 seconds, and the next starts at its peak. */
export const ECHO_OUT_ENABLED = false;
