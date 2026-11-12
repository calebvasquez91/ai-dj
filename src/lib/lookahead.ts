/**
 * Which queued tracks the app does background work for (analysis, lyric fingerprints, stems checks, BPM lookups).
 *
 * Starting playback from a big library queues ALL of it — thousands of tracks — and these jobs used to walk the whole
 * queue, firing thousands of requests and database writes in a burst on the first play. Only the playing track and the
 * next few can matter to a mix decision, so work is limited to that window; as the queue advances, the next track
 * enters the window and gets its turn then.
 */

/** Heavy work (decode + analyse a whole audio file): the playing track and the next few, one at a time. */
export const ANALYSIS_LOOKAHEAD = 3;
/** Light lookups (a small request each): the playing track and a few more, enough for sequencing to see ahead. */
export const LOOKUP_LOOKAHEAD = 8;

/** The playing track (if any) followed by the next `ahead` queued tracks. With nothing playing, the first `ahead + 1` of the queue. */
export function reachableTracks<T>(currentTrack: T | null | undefined, queue: T[], ahead: number): T[] {
  const n = Math.max(0, Math.floor(ahead));
  return currentTrack ? [currentTrack, ...queue.slice(0, n)] : queue.slice(0, n + 1);
}
