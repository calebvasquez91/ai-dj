/**
 * Song Sync Mode's one switch for everything that isn't the two songs. While false (until further notice), a
 * crossfade is only music: no transition FX sounds (riser, scratch chirps, tag stabs, word play, AI-picked FX), no AI
 * FX-pick calls, and the Halloween ambient loop pauses for the whole morph/crossfade and comes back once the new track
 * is fully playing. Flip it to true to bring them back.
 *
 * It lives in this leaf module so the mix engine can read it without importing the sync engine (which imports the mix
 * engine); lib/syncEngine.ts re-exports it, and that is where the rest of the app imports it from.
 */
export const TRANSITION_FX_ENABLED = false;
