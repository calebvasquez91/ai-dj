/**
 * Stem separation and what hangs off it (the stem autopilot, the Stems panel, voice-end detection) is paused: the
 * pieces are in the codebase and tested, but nothing starts paid jobs or builds voice maps until this is switched on
 * with NEXT_PUBLIC_STEM_FEATURES="on". (NEXT_PUBLIC_ so the client bundle sees the same value as the server.)
 * The rest of the app — playback, the mix engine, the sync report — doesn't depend on it.
 */
export const STEM_FEATURES_ENABLED = process.env.NEXT_PUBLIC_STEM_FEATURES === "on";

/**
 * The vocal mashup (lib/vocalMashup.ts): when the playing track's singing is over, the next track's vocal rides its
 * instrumental. Independent of the paused stem features above: it separates only the one next track of a mashable
 * pair, on demand, under the same server-side budget, and builds voice maps only to know when singing has ended. On
 * by default (it also needs the "Mashups" toggle on the DJ board); set NEXT_PUBLIC_VOCAL_MASHUP="off" to disable.
 */
export const VOCAL_MASHUP_ENABLED = process.env.NEXT_PUBLIC_VOCAL_MASHUP !== "off";
