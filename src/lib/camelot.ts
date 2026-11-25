// Musical keys and the Camelot wheel: pure and tiny, so both the audio analysis (lib/audio-analysis-core.ts) and the admin's Music catalog
// (lib/adminMusic.ts, which also reaches the browser) can use them without dragging the signal-processing code along.

export const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---------------------------------------------------------------------------
// Camelot wheel — maps an estimated key to Camelot notation (e.g. "8A") for
// harmonic-mixing compatibility scoring. Camelot numbers follow the circle
// of fifths (each +7 semitones/perfect-fifth step advances the number by
// one); a minor key shares its relative major's number with the "A" letter
// in place of "B" (relative major = minor tonic + 3 semitones).
// ---------------------------------------------------------------------------

const MAJOR_CAMELOT_NUMBER_BY_SEMITONE = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

export function camelotForKey(key: string | null): string | null {
  if (!key) return null;
  const match = key.match(/^([A-G]#?)\s+(major|minor)$/);
  if (!match) return null;
  const semitone = PITCH_CLASSES.indexOf(match[1]);
  if (semitone < 0) return null;
  const isMinor = match[2] === "minor";
  const idx = isMinor ? (semitone + 3) % 12 : semitone;
  const number = MAJOR_CAMELOT_NUMBER_BY_SEMITONE[idx];
  return `${number}${isMinor ? "A" : "B"}`;
}

/**
 * Where a Camelot code sits on the wheel, for sorting: 1A, 1B, 2A, 2B ... 12A, 12B (so 2A comes before 10A, which text order gets wrong).
 * Null for anything that is not a code.
 */
export function camelotRank(code: string | null | undefined): number | null {
  const match = (code ?? "").trim().match(/^(1[0-2]|[1-9])([AB])$/i);
  if (!match) return null;
  return Number(match[1]) * 2 + (match[2].toUpperCase() === "B" ? 1 : 0);
}

function parseCamelotCode(code: string): { number: number; letter: "A" | "B" } | null {
  const m = code.match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  return { number: parseInt(m[1], 10), letter: m[2] as "A" | "B" };
}

/**
 * How well two Camelot keys sit together for harmonic mixing: 2 = identical key, 1 = relative major/minor or adjacent on the wheel, 0 = not compatible (or unknown).
 * Lives here, with the other Camelot helpers, so the playlist curator can use it without loading the whole mixing engine; lib/mix-engine.ts re-exports it.
 */
export function camelotCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const pa = parseCamelotCode(a);
  const pb = parseCamelotCode(b);
  if (!pa || !pb) return 0;
  if (pa.number === pb.number && pa.letter === pb.letter) return 2;
  if (pa.number === pb.number) return 1;
  const diff = Math.min((pa.number - pb.number + 12) % 12, (pb.number - pa.number + 12) % 12);
  if (diff === 1 && pa.letter === pb.letter) return 1;
  return 0;
}
