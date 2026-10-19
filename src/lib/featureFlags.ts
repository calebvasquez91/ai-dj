/**
 * Stem separation and what hangs off it (the stem autopilot, the Stems panel, voice-end detection) is paused: the
 * pieces are in the codebase and tested, but nothing starts paid jobs or builds voice maps until this is switched on
 * with NEXT_PUBLIC_STEM_FEATURES="on". (NEXT_PUBLIC_ so the client bundle sees the same value as the server.)
 * The rest of the app — playback, the mix engine, the sync report — doesn't depend on it.
 */
export const STEM_FEATURES_ENABLED = process.env.NEXT_PUBLIC_STEM_FEATURES === "on";

/**
 * Song Sync Mode (lib/songSync.ts): the playing track's tempo and pitch morph, bar by bar, onto the next track's before
 * a plain four-bar crossfade. On by default (the "Auto" switch beside the SYNC button on the DJ board decides whether
 * every automatic transition is one); set NEXT_PUBLIC_SONG_SYNC="off" at build time to remove it entirely and get the
 * ordinary transitions back.
 */
export const SONG_SYNC_ENABLED = process.env.NEXT_PUBLIC_SONG_SYNC !== "off";

/**
 * The vocal mashup (lib/vocalMashup.ts): when the playing track's singing is over, the next track's vocal rides its
 * instrumental. Independent of the paused stem features above: it separates only the one next track of a mashable
 * pair, on demand, under the same server-side budget, and builds voice maps only to know when singing has ended. Off
 * by default until a real stem separation has been run end to end; set NEXT_PUBLIC_VOCAL_MASHUP="on" to enable (it
 * also needs the "Mashups" toggle on the DJ board).
 */
export const VOCAL_MASHUP_ENABLED = process.env.NEXT_PUBLIC_VOCAL_MASHUP === "on";
