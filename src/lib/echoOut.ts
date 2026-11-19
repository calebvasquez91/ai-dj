// Echo-out (behind ECHO_OUT_ENABLED): a song that stops suddenly, loud and then nothing, with no fade, is not simply followed by the next one. Its last
// beat is echoed into silence with a tempo-synced delay, the silence is held for three to five seconds so the moment can sit, and then the next song
// starts at its most energetic part (a drop or a chorus), entering on a downbeat; with no clear peak it starts on its first downbeat after the intro.
// A transition type of its own ("echo-out"): it does not depend on TRANSITION_FX_ENABLED, which belongs to the paused transition effects. Pure.
import type { TrackAnalysis } from "@/lib/audio-analysis";
import { beatLengthSec, nextBoundary } from "@/lib/djMoves";
import { energyProfileFromPeaks } from "@/lib/energyProfile";
import type { ParamLike } from "@/lib/djEq";

/** The id this transition goes by (its own type, separate from the ones the transition effects flag controls). */
export const ECHO_OUT_TRANSITION_ID = "echo-out";

/** A waveform bucket quieter than this is silence. */
export const SILENCE_LEVEL = 0.04;
/** The last stretch before the end must be at least this loud (0-1) for the ending to count as a stop from full energy. */
export const ABRUPT_MIN_BODY_LEVEL = 0.4;
/** The echo's feedback: each repeat is this fraction of the last. */
export const ECHO_FEEDBACK = 0.55;
/** The longest the echo tail is allowed to run, seconds. */
export const ECHO_MAX_TAIL_SEC = 4;
export const HOLD_SILENCE_SEC = { min: 3, max: 5 } as const;

export interface EndingReading {
  abrupt: boolean;
  /** Seconds into the song where the last sound ends (null when there is no waveform to read). */
  lastLoudSec: number | null;
  reason: string;
}

/**
 * Whether the song's ending is a sudden stop: the last seconds drop from high energy to silence (or are cut off while loud) without a fade. Read
 * from the waveform: the last sound, the loudness just before it, and whether the loudness was falling away before the end (a fade is not abrupt).
 */
export function detectAbruptEnding(analysis: Pick<TrackAnalysis, "waveformPeaks">, durationSec: number): EndingReading {
  const peaks = analysis.waveformPeaks;
  const n = peaks.length;
  if (n < 40 || !(durationSec > 0)) return { abrupt: false, lastLoudSec: null, reason: "no waveform to read" };
  let lastLoud = n - 1;
  while (lastLoud > 0 && peaks[lastLoud] <= SILENCE_LEVEL) lastLoud--;
  const lastLoudSec = ((lastLoud + 1) / n) * durationSec;
  const mean = (from: number, to: number) => {
    const slice = peaks.slice(Math.max(0, from), Math.max(0, to));
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  };
  const bodyBuckets = Math.max(6, Math.round(n * 0.06));
  const justBefore = mean(lastLoud - 2, lastLoud + 1);
  // A fade: the level just before the last sound has fallen well below what it was a little earlier (the loud body before the ending).
  const earlier = mean(lastLoud + 1 - bodyBuckets * 3, lastLoud + 1 - bodyBuckets);
  if (earlier > ABRUPT_MIN_BODY_LEVEL && justBefore < 0.6 * earlier) return { abrupt: false, lastLoudSec, reason: "the song fades out" };
  const body = mean(lastLoud + 1 - bodyBuckets, lastLoud + 1);
  if (body < ABRUPT_MIN_BODY_LEVEL) return { abrupt: false, lastLoudSec, reason: "the ending is not loud" };
  return { abrupt: true, lastLoudSec, reason: "the song stops while it is still loud" };
}

/** The most energetic part of a song to come in at, on a downbeat of its own grid: a drop, else the loudest stretch; "after-intro" when it has none. */
export function entryPoint(analysis: TrackAnalysis, durationSec: number): { sec: number; kind: "peak" | "after-intro" } {
  const peakTimes: number[] = [];
  for (const pair of analysis.buildDropPairs) peakTimes.push(pair.dropAtSec);
  if (analysis.dropAtSec != null) peakTimes.push(analysis.dropAtSec);
  for (const section of analysis.songMap?.sections ?? []) if (section.label === "drop") peakTimes.push(section.startSec);
  if (peakTimes.length === 0 && durationSec > 0) {
    const profile = energyProfileFromPeaks(analysis.waveformPeaks);
    if (profile.length > 0) {
      let best = 0;
      profile.forEach((v, i) => {
        if (v > profile[best]) best = i;
      });
      if (profile[best] >= 0.8) peakTimes.push((best / profile.length) * durationSec);
    }
  }
  if (peakTimes.length > 0) {
    // the earliest of the peaks that leaves room to play, snapped to the bar line at or before it so the peak itself lands on the downbeat
    const peak = peakTimes.sort((a, b) => a - b)[0];
    const snapped = nextBoundary(analysis, peak - 1e-3, "bar");
    if (snapped != null) return { sec: snapped, kind: "peak" };
  }
  const afterIntro = nextBoundary(analysis, analysis.energyOnsetSec, "bar");
  return { sec: afterIntro ?? analysis.energyOnsetSec, kind: "after-intro" };
}

export interface EchoOutPlan {
  /** Where in the outgoing song the echo starts: on its last beat grid line before the sound ends. */
  echoStartSec: number;
  /** The delay time: a dotted eighth, locked to the tempo. */
  delayTimeSec: number;
  feedback: number;
  /** How long the echo rings out after the song stops, seconds. */
  tailSec: number;
  /** Silence held after the tail, 3 to 5 seconds. */
  holdSilenceSec: number;
  /** Seconds from the last sound of the outgoing song until the next song starts. */
  nextStartAfterSec: number;
  /** Where in the incoming song it starts (on a downbeat), and why there. */
  incomingEntrySec: number;
  entryKind: "peak" | "after-intro";
  reason: string;
}

/**
 * The echo-out from `outgoing` into `incoming`, or null when the outgoing song does not end suddenly (it then gets the normal transition).
 * The only thing not fixed by the songs is the length of the held silence, 3 to 5 seconds, taken from `rand` (injectable so it can be tested).
 */
export function planEchoOut(args: { outgoing: TrackAnalysis; outgoingDurationSec: number; incoming: TrackAnalysis; incomingDurationSec: number; rand?: () => number }): EchoOutPlan | null {
  const { outgoing, outgoingDurationSec, incoming, incomingDurationSec } = args;
  const ending = detectAbruptEnding(outgoing, outgoingDurationSec);
  if (!ending.abrupt || ending.lastLoudSec == null || outgoing.fallback || !(outgoing.bpm > 0)) return null;
  const beat = beatLengthSec(outgoing.bpm);
  const echoStart = nextBoundary(outgoing, ending.lastLoudSec - beat - 1e-3, "beat") ?? ending.lastLoudSec - beat;
  const delay = beat * 0.75;
  const tail = Math.min(ECHO_MAX_TAIL_SEC, Math.ceil(Math.log(0.001) / Math.log(ECHO_FEEDBACK)) * delay);
  const rand = args.rand ?? Math.random;
  const hold = HOLD_SILENCE_SEC.min + Math.min(1, Math.max(0, rand())) * (HOLD_SILENCE_SEC.max - HOLD_SILENCE_SEC.min);
  const entry = entryPoint(incoming, incomingDurationSec);
  return {
    echoStartSec: echoStart,
    delayTimeSec: delay,
    feedback: ECHO_FEEDBACK,
    tailSec: tail,
    holdSilenceSec: hold,
    nextStartAfterSec: tail + hold,
    incomingEntrySec: entry.sec,
    entryKind: entry.kind,
    reason: `${ending.reason}; echo, ${hold.toFixed(1)} s of silence, then the next song at ${entry.kind === "peak" ? "its peak" : "its first downbeat after the intro"}`,
  };
}

/** The deck's echo parameters the tail borrows. */
export interface EchoOutTarget {
  delaySendGain: ParamLike;
  delayTime: ParamLike;
  feedbackGain: ParamLike;
}

/**
 * Writes the echo on the audio clock: the delay is set to the dotted eighth, the last beat is sent into it, and the feedback carries it away. The
 * caller starts the next song `plan.nextStartAfterSec` after the outgoing song's last sound. Returns the audio-clock time the tail has died away.
 */
export function applyEchoOut(target: EchoOutTarget, plan: EchoOutPlan, echoStartCtxTime: number, nowCtxTime: number): number {
  const start = Math.max(echoStartCtxTime, nowCtxTime);
  target.delayTime.cancelScheduledValues(start);
  target.delayTime.setValueAtTime(plan.delayTimeSec, start);
  target.feedbackGain.cancelScheduledValues(start);
  target.feedbackGain.setValueAtTime(plan.feedback, start);
  target.delaySendGain.cancelScheduledValues(start);
  target.delaySendGain.setValueAtTime(1, start);
  // one beat of the song goes in, then the send closes so only the echo remains
  const sendEnd = start + plan.delayTimeSec / 0.75;
  target.delaySendGain.setValueAtTime(1, sendEnd - 0.004);
  target.delaySendGain.linearRampToValueAtTime(0, sendEnd);
  return sendEnd + plan.tailSec;
}
