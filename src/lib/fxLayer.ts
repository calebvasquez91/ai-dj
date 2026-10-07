/**
 * The FX layer's request bookkeeping as pure functions — the part of DualDeckStage's FX button / Auto FX / DJ moments
 * that decides what a press or a finished decode means. The audio nodes themselves stay in the component; this only
 * tracks "is a sound still loading, and which request is the live one".
 *
 * `token` identifies the latest request. Anything that changes the plan (a new request, a stop press, teardown) bumps
 * it, so an earlier request that is still decoding finds its token stale when it finishes and stands down instead of
 * starting a sound nobody wants any more.
 */

export interface FxLoadState {
  token: number;
  /** A sound is decoding and hasn't started yet. */
  loading: boolean;
}

export const FX_LOAD_IDLE: FxLoadState = { token: 0, loading: false };

/** The FX button: stops when a sound is playing or loading, otherwise starts one. A stop bumps the token, cancelling a still-loading request. */
export function pressFx(state: FxLoadState, playing: boolean): { action: "stop" | "start"; state: FxLoadState } {
  if (playing || state.loading) return { action: "stop", state: { token: state.token + 1, loading: false } };
  return { action: "start", state };
}

/** A new sound is requested (button start, Auto FX, a DJ moment). It becomes the live request, superseding any other still loading. */
export function beginFxRequest(state: FxLoadState): { token: number; state: FxLoadState } {
  const token = state.token + 1;
  return { token, state: { token, loading: true } };
}

/**
 * A request's decode finished (`ok`) or failed. "cancelled": it was superseded or stopped meanwhile — do nothing.
 * "failed": the live request's file wouldn't load. "start": play it. "replace": play it, fading out the sound that is
 * still playing (`playing`) first.
 */
export function finishFxRequest(
  state: FxLoadState,
  token: number,
  ok: boolean,
  playing: boolean
): { outcome: "cancelled" | "failed" | "start" | "replace"; state: FxLoadState } {
  if (token !== state.token) return { outcome: "cancelled", state };
  const next = { ...state, loading: false };
  if (!ok) return { outcome: "failed", state: next };
  return { outcome: playing ? "replace" : "start", state: next };
}

/** Teardown: forget any in-flight request. */
export function resetFxLoad(state: FxLoadState): FxLoadState {
  return { token: state.token + 1, loading: false };
}
