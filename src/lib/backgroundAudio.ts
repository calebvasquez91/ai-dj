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

/** How long a deck's gain may sit near zero while its track is playing and nothing is fading it, before it is judged stuck. */
export const STUCK_MUTE_MS = 2500;
/** A gain under this, outside any fade, is a muted deck. */
export const MUTED_GAIN = 0.05;

/**
 * A playing deck whose gain stayed at (almost) zero when no transition, fade-in or fade-out is accounting for it: the
 * leftover of an automation that never finished (for instance a crossfade that was frozen with the audio context).
 * `mutedSinceMs` is when it was first seen like that (null if it wasn't), `nowMs` the current time; true means "lift it".
 */
export function isStuckMuted(args: {
  gain: number;
  mutedSinceMs: number | null;
  nowMs: number;
}): boolean {
  return args.gain < MUTED_GAIN && args.mutedSinceMs != null && args.nowMs - args.mutedSinceMs >= STUCK_MUTE_MS;
}
