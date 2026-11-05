/**
 * Keeping the music going when the phone's screen locks or the browser is backgrounded. Pure helpers; the browser
 * wiring is components/BackgroundAudio.tsx (the silent keep-alive element, the audio session, the lock-screen controls)
 * and DualDeckStage.tsx (waking a suspended audio context).
 *
 * Why it matters: the mix runs through one Web Audio context. When the OS suspends that context (iOS when the screen
 * locks and nothing it counts as media is playing, an incoming call, another app taking the audio, Android when the
 * tab goes to the background) the sound stops while the app's own state still says "playing" — and nothing used to
 * start the context again.
 */

/** A context that should be making sound but isn't. iOS reports "interrupted", which the DOM typings don't list. */
export function shouldResumeContext(state: string, wantPlaying: boolean): boolean {
  return wantPlaying && state !== "running" && state !== "closed";
}

/**
 * A silent mono 8-bit WAV as a data URI. Played in a loop by a hidden <audio> element it is what makes the browser and
 * the OS treat the page as one that is playing media, so its audio keeps running (and keeps its lock-screen controls)
 * even while the real music is between <audio> elements — for example, while Song Sync hands the playing track to the
 * stretcher during a morph, when no element is playing at all.
 */
export function silentWavDataUri(seconds = 1, sampleRate = 8000): string {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate: 1 byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8-bit PCM is unsigned: 128 is silence
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** What the lock screen's progress bar is told, or null when the numbers can't be trusted (setPositionState throws on bad ones). */
export function mediaPositionState(
  durationSec: number,
  positionSec: number,
  playbackRate = 1
): { duration: number; position: number; playbackRate: number } | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(positionSec)) return null;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return { duration: durationSec, position: Math.min(Math.max(0, positionSec), durationSec), playbackRate: rate };
}

/** A Song Sync morph is dropped when the audio clock was stopped, or fell behind real time, for at least this long. */
export const AUDIO_GAP_ABANDON_MS = 1500;
/** The audio clock counts as having fallen behind when it advanced less than this fraction of the real time that passed. */
const AUDIO_CLOCK_LAG_RATIO = 0.5;

export interface WakeInput {
  /** The audio context's state right now. */
  contextState: string;
  /** The app wants sound (playing, not paused). */
  wantPlaying: boolean;
  /** How long the context has been seen not running, ms (0 if it hasn't been). */
  stoppedForMs: number;
  /** Real time since the previous check, ms, and how far the audio clock (ctx.currentTime) moved in that time, ms. */
  wallDeltaMs: number;
  audioDeltaMs: number;
  /** A Song Sync morph is under way, and whether its crossfade is already scheduled on the audio clock. */
  morphActive: boolean;
  crossfadeScheduled: boolean;
}

/**
 * How long the app keeps waking a stopped context on its own. A screen lock or a short interruption (Siri, a
 * notification) is over well within this; a phone call or another app that took the audio is not, and past it the app
 * stops fighting for the speakers and treats the stop as a pause (the caller sets isPlaying false), so the user decides
 * when the music comes back. Touching or returning to the page starts the wait over (see wakeAudioContext).
 */
export const RESUME_PATIENCE_MS = 15000;

/**
 * What to do about the audio context on this check: wake it if it stopped while sound is wanted (for up to
 * RESUME_PATIENCE_MS, then give up), and drop a Song Sync morph whose two clocks (the wall clock its tick runs on, the
 * audio clock its voice and gains run on) can no longer be trusted to agree. They disagree only when the AUDIO clock
 * stopped or fell behind — a context the OS suspended — and not when the page's main thread merely hung for a few
 * seconds (the audio thread, and the morph's voice with it, carried on, so the elapsed wall time alone says nothing). A
 * morph whose crossfade is already scheduled is left to finish, as before.
 */
export function wakeVerdict(i: WakeInput): { resume: boolean; dropMorph: boolean; giveUp: boolean } {
  const dropIfMorph = i.morphActive && !i.crossfadeScheduled;
  if (shouldResumeContext(i.contextState, i.wantPlaying)) {
    // Giving up pauses the app, so the stale morph goes with it (its wall clock has run on without any sound).
    if (i.stoppedForMs >= RESUME_PATIENCE_MS) return { resume: false, dropMorph: dropIfMorph, giveUp: true };
    return { resume: true, dropMorph: false, giveUp: false };
  }
  const audioClockBehind = i.wallDeltaMs >= AUDIO_GAP_ABANDON_MS && i.audioDeltaMs < i.wallDeltaMs * AUDIO_CLOCK_LAG_RATIO;
  const wasStopped = i.stoppedForMs >= AUDIO_GAP_ABANDON_MS;
  return { resume: false, dropMorph: dropIfMorph && (audioClockBehind || wasStopped), giveUp: false };
}

/** How long a deck's gain may sit near zero while its track is playing and nothing is fading it, before it is judged stuck. */
export const STUCK_MUTE_MS = 2500;
/** A gain under this, outside any fade, is a muted deck. */
export const MUTED_GAIN = 0.05;
/** An output level (RMS of the deck's samples after its gain) under this is silence. */
export const SILENT_OUTPUT_RMS = 0.002;

/** The RMS level of a block of samples (0 for none), for reading how loud a deck really is. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * A deck that looks muted right now: its gain reads near zero AND nothing audible is coming out of it. The gain alone is
 * not trusted: AudioParam.value is the live automated value in Chrome, but a browser that reports the last value that
 * was set instead (it can be 0 from a finished fade-in) would show a healthy deck as muted. The measured output is the
 * ground truth; a deck whose output is audible is not muted whatever its gain reads.
 */
export function looksMuted(gain: number, outputRms: number): boolean {
  return gain < MUTED_GAIN && outputRms < SILENT_OUTPUT_RMS;
}

/**
 * A playing deck that has looked muted (looksMuted) for long enough when no transition, fade-in or fade-out is
 * accounting for it: the leftover of an automation that never finished (for instance a crossfade that was frozen with
 * the audio context). `mutedSinceMs` is when it was first seen like that (null if it wasn't), `nowMs` the current time;
 * true means "lift it".
 */
export function isStuckMuted(args: {
  gain: number;
  outputRms: number;
  mutedSinceMs: number | null;
  nowMs: number;
}): boolean {
  return looksMuted(args.gain, args.outputRms) && args.mutedSinceMs != null && args.nowMs - args.mutedSinceMs >= STUCK_MUTE_MS;
}
