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

/** HTMLMediaElement.NETWORK_LOADING: the browser is fetching media data. */
export const NETWORK_LOADING = 2;
/** A transition waits at most this long for the incoming song, however slow the connection. */
export const MAX_INCOMING_HOLD_MS = 4000;
/** An aligned start (timed to the playing song's drop or breakdown) waits far less: every moment of delay moves the two songs' drops apart. */
export const ALIGNED_MAX_HOLD_MS = 1000;
/** It never waits if that would leave less than this (beyond the transition's own window) of the playing song. */
export const MIN_HOLD_SLACK_SEC = 2;
/**
 * A start at the playing song's natural end (and the Auto-DJ-off fade) begins this much earlier than usual when the incoming song is not ready, so there is room to wait for
 * it: at the usual moment the playing song only has the transition's own length left, which leaves no room at all. The longest wait plus the slack.
 */
export const NATURAL_END_HOLD_LEAD_SEC = MAX_INCOMING_HOLD_MS / 1000 + MIN_HOLD_SLACK_SEC;
/** How much of the song must be buffered from the entry point for it to count as ready. */
export const READY_BUFFER_SEC = 1;
/** Closer than this to the entry point the deck needs no seek. */
export const ENTRY_SEEK_TOLERANCE_SEC = 0.5;

export interface BufferedRange {
  start: number;
  end: number;
}

export interface IncomingState {
  /** The incoming deck's readyState. */
  readyState: number;
  /** The incoming deck's networkState. */
  networkState: number;
  /** The incoming deck's buffered time ranges, seconds. */
  buffered: BufferedRange[];
  /** The incoming song's duration as the deck reports it (NaN until the metadata is in). */
  durationSec: number;
  /** Where the transition will start the incoming song, seconds. */
  entryOffsetSec: number;
}

/** True when the media from `fromSec` for `needSec` is inside one buffered range (or reaches the end of the song). */
export function isBufferedFrom(ranges: BufferedRange[], fromSec: number, needSec: number, durationSec: number): boolean {
  const want = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(fromSec + needSec, durationSec - 0.05) : fromSec + needSec;
  return ranges.some((r) => r.start <= fromSec + 0.05 && r.end >= want);
}

/**
 * True when the incoming song can start playing from the entry point without waiting: the entry point itself is buffered (not just the start of the song, which is all a
 * plain preload fetches). Without buffer information the deck's own readyState decides.
 */
export function incomingIsReady(s: IncomingState): boolean {
  if (s.buffered.length === 0) return s.readyState >= HAVE_FUTURE_DATA;
  return isBufferedFrom(s.buffered, s.entryOffsetSec, READY_BUFFER_SEC, s.durationSec);
}

/** True when the browser is actually fetching the incoming song (some browsers ignore a preload until playback is asked for: waiting there would wait for nothing). */
export function incomingIsLoading(s: IncomingState): boolean {
  return s.networkState === NETWORK_LOADING || s.buffered.length > 0;
}

/** True when the idle deck should be moved to the entry point now, so the browser fetches the media there instead of at the transition's start. */
export function needsEntrySeek(s: IncomingState, currentTimeSec: number): boolean {
  if (s.entryOffsetSec <= ENTRY_SEEK_TOLERANCE_SEC) return false;
  if (incomingIsReady(s)) return false;
  return Math.abs(currentTimeSec - s.entryOffsetSec) > ENTRY_SEEK_TOLERANCE_SEC;
}

/** HTMLMediaElement.HAVE_FUTURE_DATA: enough is buffered to start playing. */
export const HAVE_FUTURE_DATA = 3;

export interface HoldInput {
  /** The incoming song is ready to play from its entry point (incomingIsReady). */
  ready: boolean;
  /** The browser is fetching it (incomingIsLoading). */
  loading: boolean;
  /** Seconds of the playing song left. */
  remainingSec: number;
  /** The transition's own length, seconds. */
  windowSec: number;
  /** How long this transition has already been waiting, ms. */
  heldMs: number;
  /** The longest this start may wait, ms (MAX_INCOMING_HOLD_MS unless it is aligned to a drop or breakdown). */
  maxHoldMs?: number;
}

/**
 * True when the transition should wait a little longer for the incoming song to be ready to play: it is not, the browser is fetching it, there is room to wait (the playing
 * song would still outlast the transition by a margin) and it has not already waited long enough. Never true for a song that is ready, and never forever.
 */
export function shouldHoldForIncoming({ ready, loading, remainingSec, windowSec, heldMs, maxHoldMs = MAX_INCOMING_HOLD_MS }: HoldInput): boolean {
  if (ready || !loading) return false;
  if (heldMs >= maxHoldMs) return false;
  return remainingSec - windowSec > MIN_HOLD_SLACK_SEC;
}
