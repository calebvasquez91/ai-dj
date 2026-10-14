/**
 * Stem separation and what hangs off it (the stem autopilot, the Stems panel, voice-end detection) is paused: the
 * pieces are in the codebase and tested, but nothing starts paid jobs or builds voice maps until this is switched on
 * with NEXT_PUBLIC_STEM_FEATURES="on". (NEXT_PUBLIC_ so the client bundle sees the same value as the server.)
 * The rest of the app — playback, the mix engine, the sync report — doesn't depend on it.
 */
export const STEM_FEATURES_ENABLED = process.env.NEXT_PUBLIC_STEM_FEATURES === "on";
