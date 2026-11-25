/**
 * When to load the next song into the idle deck, and when a transition should wait for it. Until now the idle deck was given the next song at the very moment a
 * transition began (the browser then had to fetch it, seek to the entry point and start decoding while the fade was already running), so any delay in loading it
 * landed inside the transition: a late start, a dip, a stumble or a jump once it began. Loading it well ahead removes that, and a transition that finds the song
 * still not ready waits a moment (while there is room) instead of fading into silence. Pure, so it is tested: the deck stage only applies the answers.
 */

/** The next song starts loading when this much (or less) of the playing one is left. Long enough for a slow connection to fetch a whole song. */
export const PRELOAD_LEAD_SEC = 90;
/** ...but not in the first moments of a song: the deck stage is still settling then. */
export const PRELOAD_MIN_ELAPSED_SEC = 3;

/** True when it is time to load the next song into the idle deck. */
export function shouldPreloadNext(remainingSec: number, elapsedSec: number): boolean {
  return Number.isFinite(remainingSec) && remainingSec > 0 && remainingSec <= PRELOAD_LEAD_SEC && elapsedSec >= PRELOAD_MIN_ELAPSED_SEC;
}

/** HTMLMediaElement.HAVE_FUTURE_DATA: enough is buffered to start playing. */
export const HAVE_FUTURE_DATA = 3;
/** A transition waits at most this long for the incoming song, however slow the connection. */
export const MAX_INCOMING_HOLD_MS = 4000;
/** It never waits if that would leave less than this (beyond the transition's own window) of the playing song. */
export const MIN_HOLD_SLACK_SEC = 2;

export interface HoldInput {
  /** The incoming deck's readyState. */
  readyState: number;
  /** Seconds of the playing song left. */
  remainingSec: number;
  /** The transition's own length, seconds. */
  windowSec: number;
  /** How long this transition has already been waiting, ms. */
  heldMs: number;
}

/**
 * True when the transition should wait a little longer for the incoming song to be ready to play: it is not, there is room to wait (the playing song would still
 * outlast the transition by a margin) and it has not already waited long enough. Never true for a song that is ready, and never forever.
 */
export function shouldHoldForIncoming({ readyState, remainingSec, windowSec, heldMs }: HoldInput): boolean {
  if (readyState >= HAVE_FUTURE_DATA) return false;
  if (heldMs >= MAX_INCOMING_HOLD_MS) return false;
  return remainingSec - windowSec > MIN_HOLD_SLACK_SEC;
}
