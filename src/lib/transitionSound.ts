/**
 * Transition sounds (pure logic). A song-to-song change can carry a sound between the two songs: A morphs its tempo and
 * key onto the sound (Song Sync, lib/songSync.ts), the sound plays for about thirty seconds, and then it morphs onto B
 * the same way.
 *
 * The engine already knows how to do the morph and the hand-over between two tracks on its decks, so the sound is made
 * into a track: its audio is tiled on its own bar grid into one file of the right length, a song map with an exact
 * bar grid is written for it, and it is queued between A and B for the length of the change. Nothing here touches the
 * Web Audio graph; the decoding, the file and the queueing are DualDeckStage's and the store's.
 *
 * Which sounds may be used: the FX library's transitions, loops and vocals, through getEligibleFX, so Halloween sounds
 * play only in Spooky Music and never anywhere else.
 */

import type { TrackAnalysis } from "@/lib/audio-analysis-core";
import { camelotForKey } from "@/lib/audio-analysis-core";
import { getEligibleFX } from "@/lib/fxAffinity";
import type { SongMap } from "@/lib/song-map";
import { SONG_SYNC_CROSSFADE_BARS, planSongSync, type SongSyncPlan } from "@/lib/songSync";
import { planBpm, planKey } from "@/lib/syncEngine";
import type { FxCategory, FxSound, LocalTrack } from "@/types/music";

/** The FX library categories that may carry a song change. */
export const TRANSITION_SOUND_CATEGORIES: readonly FxCategory[] = ["transition", "loop", "vocal"];

/** How long the sound is meant to play on its own, between the change into it and the change out of it. */
export const TRANSITION_SOUND_SOLO_SEC = 30;

/** The sync engine skips this much of an incoming track's start (it enters on the first bar line past it), so the file has bars to spare there. */
export const TRANSITION_SOUND_ENTRY_SEC = 4;

/** Bars kept after the change out of the sound starts, for the engine's wait for the phase to lock. */
export const TRANSITION_SOUND_EXIT_SLACK_BARS = 2;

/** A sound shorter than this is a click, not something to build a thirty-second bed from. */
export const TRANSITION_SOUND_MIN_SEC = 0.25;

/** The longest unit the tiling repeats, in bars. A sound longer than that is cut to it. */
export const TRANSITION_SOUND_MAX_UNIT_BARS = 64;

const UNIT_BARS = [1, 2, 4, 8, 16, 32, 64] as const;

/** The queue ids of transition sounds all start with this; nothing else does. */
export const TRANSITION_TRACK_PREFIX = "tsound:";

/** True for the stand-in track a transition sound is queued as. Such a track is never part of the library, history or liked songs. */
export function isTransitionTrack(track: { id: string } | null | undefined): boolean {
  return !!track && track.id.startsWith(TRANSITION_TRACK_PREFIX);
}

// ---------------------------------------------------------------------------
// Which sound
// ---------------------------------------------------------------------------

/** The FX that may carry a song change right now: the right categories, long enough, and (via getEligibleFX) Halloween sounds only in Spooky Music. */
export function eligibleTransitionSounds(library: FxSound[], spookyActive: boolean): FxSound[] {
  return getEligibleFX(library, spookyActive).filter(
    (fx) =>
      TRANSITION_SOUND_CATEGORIES.includes(fx.category) &&
      !!fx.sourceUrl &&
      Number.isFinite(fx.durationSec) &&
      fx.durationSec >= TRANSITION_SOUND_MIN_SEC
  );
}

/** The Camelot code for an FX's free-text key: "8A", "C minor", "Cm", "F#min", "Db" (major when nothing says minor). Null when it can't be read. */
export function camelotFromFxKey(key: string | undefined | null): string | null {
  const text = (key ?? "").trim();
  if (!text) return null;
  const camelot = text.match(/^(\d{1,2})\s*([ab])$/i);
  if (camelot) {
    const n = Number(camelot[1]);
    return n >= 1 && n <= 12 ? `${n}${camelot[2].toUpperCase()}` : null;
  }
  const named = text.match(/^([A-Ga-g])\s*([#b♯♭]?)\s*(major|maj|minor|min|m)?$/);
  if (!named) return null;
  const FLAT_TO_SHARP: Record<string, string> = { C: "B", D: "C#", E: "D#", F: "E", G: "F#", A: "G#", B: "A#" };
  const letter = named[1].toUpperCase();
  let note = letter;
  if (named[2] === "#" || named[2] === "♯") note = `${letter}#`;
  else if (named[2] === "b" || named[2] === "♭") note = FLAT_TO_SHARP[letter];
  if (!note || /^(E#|B#)$/.test(note)) return null;
  const suffix = (named[3] ?? "").toLowerCase();
  const minor = suffix === "minor" || suffix === "min" || suffix === "m";
  return camelotForKey(`${note} ${minor ? "minor" : "major"}`);
}

type TempoKeyFields = Pick<TrackAnalysis, "bpm" | "bpmConfidence" | "key" | "keyConfidence" | "camelotKey">;

/** The two ways a sound gets its tempo. */
export type TransitionTempoSource = "library" | "follows-previous";

export interface TransitionSoundChoice {
  sound: FxSound;
  /** The tempo the sound plays at in the file. */
  bpm: number;
  /** "library": the BPM saved on the sound, A and B morph onto it. "follows-previous": it has none, so it is laid out at A's tempo. */
  tempoSource: TransitionTempoSource;
  /** The Camelot code of the sound's key, or null when it has none (no pitch change is then asked of A or of B). */
  camelotKey: string | null;
  /** The morph out of the previous song onto the sound, and out of the sound onto B. */
  entryPlan: SongSyncPlan;
  exitPlan: SongSyncPlan;
}

/** The tempo/key part of an analysis for a sound the engine has no analysis of: the tempo is certain (it is the sound's own, or A's). */
function soundFields(bpm: number, camelotKey: string | null): TempoKeyFields {
  return {
    bpm,
    bpmConfidence: 1,
    key: null,
    keyConfidence: camelotKey ? 0.9 : 0,
    camelotKey,
  };
}

/** The Song Sync morph from one track onto another, the way the engine would plan it, or null when it would refuse (no trusted tempo, too far apart). */
export function planLeg(from: TempoKeyFields, to: TempoKeyFields): SongSyncPlan | null {
  const bpm = planBpm(from, to);
  const key = planKey(from, to);
  const planned = planSongSync({ ...bpm, ...key });
  return planned.ok ? planned.plan : null;
}

/** A rough cost of a plan, so a choice can prefer the gentler morph: bars of morphing plus the tempo and key it moves through. */
function legCost(plan: SongSyncPlan): number {
  return plan.morphBars + Math.abs(plan.bpmTo - plan.bpmFrom) / 4 + Math.abs(plan.pitchTargetSemitones);
}

/** A sound with a tempo of its own beats one without it, because it is the one A and B are asked to match. */
const NO_TEMPO_PENALTY = 6;
/** Per recent use, so the same sound doesn't carry every change. */
const RECENT_PENALTY = 8;
/** How many of the best candidates the random pick chooses between. */
const PICK_FROM_BEST = 3;

/**
 * Picks the sound for a change from `a` to `b`, or null when there is none to use: either side has no trusted tempo,
 * nothing is eligible, or no sound can be reached from A and left for B (the morph would be too wide). `random` is
 * injected so the pick can be tested.
 */
export function chooseTransitionSound(input: {
  sounds: FxSound[];
  a: TempoKeyFields;
  b: TempoKeyFields;
  /** FX ids used recently, most recent last. */
  recentFxIds?: readonly string[];
  random?: () => number;
}): TransitionSoundChoice | null {
  const { sounds, a, b, recentFxIds = [], random = Math.random } = input;
  const trusted = (t: TempoKeyFields) => t.bpm > 0 && t.bpmConfidence >= 0.15;
  if (!trusted(a) || !trusted(b)) return null;

  const scored: { choice: TransitionSoundChoice; cost: number }[] = [];
  for (const sound of sounds) {
    const ownBpm = sound.bpm != null && Number.isFinite(sound.bpm) && sound.bpm > 0 ? sound.bpm : null;
    const bpm = ownBpm ?? a.bpm;
    const camelotKey = camelotFromFxKey(sound.key);
    const asTrack = soundFields(bpm, camelotKey);
    const entryPlan = planLeg(a, asTrack);
    const exitPlan = planLeg(asTrack, b);
    if (!entryPlan || !exitPlan) continue;
    const uses = recentFxIds.filter((id) => id === sound.id).length;
    const cost = legCost(entryPlan) + legCost(exitPlan) + (ownBpm ? 0 : NO_TEMPO_PENALTY) + uses * RECENT_PENALTY;
    scored.push({
      choice: { sound, bpm, tempoSource: ownBpm ? "library" : "follows-previous", camelotKey, entryPlan, exitPlan },
      cost,
    });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => x.cost - y.cost);
  const pool = scored.slice(0, PICK_FROM_BEST);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].choice;
}

// ---------------------------------------------------------------------------
// The file's layout
// ---------------------------------------------------------------------------

export interface TransitionLoopLayout {
  bpm: number;
  barSec: number;
  /** Bars the sound is repeated at: the smallest whole number of bars that holds the sound. */
  unitBars: number;
  unitSec: number;
  /** Bars before the sync engine's entry point, which it skips over (the entry is the first bar line at or past TRANSITION_SOUND_ENTRY_SEC). */
  leadInBars: number;
  soloBars: number;
  /** Bars needed for the change out of the sound onto B: its morph, the crossfade and some slack. */
  exitBars: number;
  totalBars: number;
  totalSec: number;
}

/** How the sound is laid out in a file of whole bars: the lead-in the engine skips, thirty seconds of sound, and the room for the change out of it. */
export function planTransitionLoop(input: {
  bpm: number;
  soundDurationSec: number;
  /** Bars of the morph out of the sound onto B (from planLeg), which sets how much room the end needs. */
  exitMorphBars: number;
  soloSec?: number;
}): TransitionLoopLayout {
  const bpm = input.bpm > 0 ? input.bpm : 120;
  const barSec = (4 * 60) / bpm;
  // Holds the whole sound with a little to spare for a tail, so the repeat doesn't cut it.
  const need = input.soundDurationSec * 0.9;
  const unitBars = UNIT_BARS.find((bars) => bars * barSec >= need) ?? TRANSITION_SOUND_MAX_UNIT_BARS;
  const leadInBars = Math.ceil(TRANSITION_SOUND_ENTRY_SEC / barSec);
  const soloBars = Math.ceil((input.soloSec ?? TRANSITION_SOUND_SOLO_SEC) / barSec);
  const exitBars = Math.max(0, Math.round(input.exitMorphBars)) + SONG_SYNC_CROSSFADE_BARS + TRANSITION_SOUND_EXIT_SLACK_BARS;
  const bars = leadInBars + soloBars + exitBars;
  const totalBars = Math.ceil(bars / 4) * 4; // whole phrases
  return {
    bpm,
    barSec,
    unitBars,
    unitSec: unitBars * barSec,
    leadInBars,
    soloBars,
    exitBars,
    totalBars,
    totalSec: totalBars * barSec,
  };
}

// ---------------------------------------------------------------------------
// The file's audio
// ---------------------------------------------------------------------------

const TRIM_THRESHOLD = 0.003; // about -50 dBFS
const JOINT_FADE_SEC = 0.004;
const END_FADE_SEC = 0.5;

/** The index of the first sample (any channel) louder than the threshold, so a sound that begins with silence starts on its sound. */
export function leadingSilenceSamples(channels: readonly Float32Array[], threshold = TRIM_THRESHOLD): number {
  const length = channels[0]?.length ?? 0;
  for (let i = 0; i < length; i++) {
    for (const ch of channels) if (Math.abs(ch[i]) > threshold) return i;
  }
  return 0;
}

/**
 * The sound repeated on the layout's grid into one stereo file: each repeat starts on a bar line, the sound is cut at
 * its repeat length with a short fade so the cut doesn't click, and the file ends with a half-second fade (the change
 * out of it is over before the end; the fade is only for a change that never happened).
 */
export function renderTransitionLoop(
  channels: readonly Float32Array[],
  sampleRate: number,
  layout: TransitionLoopLayout
): Float32Array<ArrayBuffer>[] {
  const source = channels.length > 0 ? channels : [new Float32Array(0)];
  const start = leadingSilenceSamples(source);
  const unitSamples = Math.max(1, Math.round(layout.unitSec * sampleRate));
  const totalSamples = Math.max(1, Math.round(layout.totalSec * sampleRate));
  const fade = Math.max(1, Math.round(JOINT_FADE_SEC * sampleRate));
  const out = [new Float32Array(totalSamples), new Float32Array(totalSamples)];

  for (let side = 0; side < 2; side++) {
    const src = source[Math.min(side, source.length - 1)];
    const dest = out[side];
    const available = Math.max(0, Math.min(unitSamples, src.length - start));
    for (let tileStart = 0; tileStart < totalSamples; tileStart += unitSamples) {
      const count = Math.min(available, totalSamples - tileStart);
      for (let i = 0; i < count; i++) {
        let gain = 1;
        if (i < fade) gain = i / fade;
        // Fade out only where the unit cuts the sound short, not where the sound has ended by itself.
        else if (available === unitSamples && i >= available - fade) gain = (available - 1 - i) / fade;
        dest[tileStart + i] = src[start + i] * gain;
      }
    }
    const endFade = Math.min(totalSamples, Math.round(END_FADE_SEC * sampleRate));
    for (let i = 0; i < endFade; i++) dest[totalSamples - 1 - i] *= i / endFade;
  }
  return out;
}

/** 16-bit PCM WAV bytes for planar channels (what <audio> can play from a blob). */
export function encodeWav16(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// The sound as a track
// ---------------------------------------------------------------------------

/** A song map with an exact bar grid, because the file was made on one: every beat, every bar line, the phrase starts. */
export function transitionSongMap(layout: TransitionLoopLayout): SongMap {
  const beatSec = 60 / layout.bpm;
  const beatCount = layout.totalBars * 4;
  const beats = Array.from({ length: beatCount }, (_, i) => i * beatSec);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const every = (bars: number) => downbeats.filter((_, i) => i % bars === 0);
  return {
    version: 1,
    durationSec: layout.totalSec,
    bpm: layout.bpm,
    tempoConfidence: 1,
    beatsPerBar: 4,
    beats,
    downbeatPhase: 0,
    downbeatConfidence: 1,
    downbeats,
    phrases: { bars8: every(8), bars16: every(16), bars32: every(32), confidence: 1 },
    sections: [],
  };
}

/** The analysis the engine reads for the sound's track, written rather than measured: the grid is the file's own. */
export function transitionAnalysis(layout: TransitionLoopLayout, camelotKey: string | null): TrackAnalysis {
  return {
    bpm: layout.bpm,
    bpmConfidence: 1,
    beatGridOffsetSec: 0,
    energyOnsetSec: 0,
    key: null,
    keyConfidence: camelotKey ? 0.9 : 0,
    camelotKey,
    breakdownAtSec: null,
    dropAtSec: null,
    buildDropPairs: [],
    waveformPeaks: [],
    fallback: false,
    songMap: transitionSongMap(layout),
  };
}

/** The stand-in track the sound is queued as. `nonce` keeps two uses of the same sound apart. */
export function makeTransitionTrack(input: { sound: FxSound; url: string; layout: TransitionLoopLayout; nonce: string }): LocalTrack {
  return {
    id: `${TRANSITION_TRACK_PREFIX}${input.sound.id}:${input.nonce}`,
    title: input.sound.name,
    artist: "Transition sound",
    source: "local",
    sourceUrl: input.url,
    durationSec: input.layout.totalSec,
    addedAt: Date.now(),
    bpm: input.layout.bpm,
    tags: [],
  };
}

/** The FX id a transition track was made from, or null if it isn't one. */
export function fxIdOfTransitionTrack(track: { id: string }): string | null {
  if (!isTransitionTrack(track)) return null;
  return track.id.slice(TRANSITION_TRACK_PREFIX.length).split(":")[0] || null;
}
