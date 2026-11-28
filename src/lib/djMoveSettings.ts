// What the person has chosen for the DJ moves (EQ, stutter, scratch): on or off, and how often or how loud, kept in this browser like the other DJ
// preferences. A move only ever runs when its own feature flag (lib/featureFlags.ts) is on AND the person has it on here; these switches do
// nothing while a flag is off. Pure parsing here; the browser store is lib/djMovesStore.ts.

import { STUTTER_NOTES, type StutterNote } from "@/lib/stutter";

/** The stutter note a person picks: a fixed slice, or "auto" to let the DJ mode and genre choose (lib/stutter.ts noteForIntensity). The notes come from stutter.ts, so there is one list. */
export type StutterNoteSetting = "auto" | StutterNote;
export const STUTTER_NOTE_SETTINGS: readonly StutterNoteSetting[] = ["auto", ...STUTTER_NOTES];

export interface DjMoveSettings {
  djEq: boolean;
  stutter: boolean;
  /** Seed radio's automatic start: a song played on its own (no playlist) keeps going with songs that go with it. The "Radio" button on a song works either way. */
  autoRadio: boolean;
  /** 0 (rarely) to 1 (as often as the rules allow). */
  stutterFrequency: number;
  /** Which note a stutter repeats; "auto" leaves it to the DJ mode and the song's genre. Applies to the automatic stutters and to the "Stutter now" button. */
  stutterNote: StutterNoteSetting;
  scratch: boolean;
  /** 0-1: how loud scratches are. */
  scratchVolume: number;
  /** 0 (rarely) to 1 (as often as the rules allow). */
  scratchFrequency: number;
}

/** Every switch starts off: these moves change what a person hears, so each is something they turn on in Settings. */
export const DJ_MOVE_DEFAULTS: DjMoveSettings = {
  djEq: false,
  stutter: false,
  autoRadio: false,
  stutterFrequency: 0.5,
  stutterNote: "auto",
  scratch: false,
  scratchVolume: 0.7,
  scratchFrequency: 0.5,
};

export const DJ_MOVE_STORAGE_KEY = "ai-dj:dj-moves";

const clamp01 = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function parseDjMoveSettings(raw: string | null | undefined): DjMoveSettings {
  if (!raw) return DJ_MOVE_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof DjMoveSettings, unknown>> | null;
    if (!v || typeof v !== "object") return DJ_MOVE_DEFAULTS;
    return {
      djEq: bool(v.djEq, DJ_MOVE_DEFAULTS.djEq),
      stutter: bool(v.stutter, DJ_MOVE_DEFAULTS.stutter),
      autoRadio: bool(v.autoRadio, DJ_MOVE_DEFAULTS.autoRadio),
      stutterFrequency: clamp01(v.stutterFrequency, DJ_MOVE_DEFAULTS.stutterFrequency),
      stutterNote: STUTTER_NOTE_SETTINGS.includes(v.stutterNote as StutterNoteSetting) ? (v.stutterNote as StutterNoteSetting) : DJ_MOVE_DEFAULTS.stutterNote,
      scratch: bool(v.scratch, DJ_MOVE_DEFAULTS.scratch),
      scratchVolume: clamp01(v.scratchVolume, DJ_MOVE_DEFAULTS.scratchVolume),
      scratchFrequency: clamp01(v.scratchFrequency, DJ_MOVE_DEFAULTS.scratchFrequency),
    };
  } catch {
    return DJ_MOVE_DEFAULTS;
  }
}

/** Browser-only; storage can be missing or throw, so both directions fail soft. */
export function loadDjMoveSettings(): DjMoveSettings {
  try {
    return parseDjMoveSettings(window.localStorage.getItem(DJ_MOVE_STORAGE_KEY));
  } catch {
    return DJ_MOVE_DEFAULTS;
  }
}

export function saveDjMoveSettings(settings: DjMoveSettings): void {
  try {
    window.localStorage.setItem(DJ_MOVE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // not remembered this time
  }
}
