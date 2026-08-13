/**
 * Repertoire of DJ transition styles, grouped by the classic technique
 * families (cut, blend, EQ/filter, effects, scratch, vocal/layering,
 * digital-assisted). `executable` marks whether the mix engine can
 * actually perform this transition with this app's audio stack (two
 * <audio> elements + a Web Audio gain/filter graph) — scratch and vocal
 * transitions need turntable-gesture input or vocal-stem isolation we
 * don't have, so they stay data-only: useful for "inspired by X" copy
 * and persona matching, never picked by the engine to actually play.
 */

export type TransitionCategory =
  | "cut"
  | "blend"
  | "eq-filter"
  | "effects"
  | "scratch"
  | "vocal"
  | "digital";

export interface TransitionEntry {
  id: string;
  name: string;
  category: TransitionCategory;
  description: string;
  /** Max fractional BPM difference (after best-octave adjustment) this transition suits well. Infinity = tempo-insensitive. */
  idealBpmDeltaMax: number;
  /** Genre family ids (from data/styles.ts) this transition fits best. Empty = genre-agnostic. */
  idealGenres: string[];
  executable: boolean;
  exampleDjs: string[];
}

export const transitions: TransitionEntry[] = [
  // Cut-based
  {
    id: "hard-cut",
    name: "Hard Cut",
    category: "cut",
    description: "An immediate, beat-aligned switch from one track to the next with no overlap.",
    idealBpmDeltaMax: Infinity,
    idealGenres: ["hip-hop", "breakbeat"],
    executable: true,
    exampleDjs: ["Grandmaster Flash", "DJ Premier"],
  },
  {
    id: "quick-chop",
    name: "Quick Chop",
    category: "cut",
    description: "A very short (roughly one beat) overlap before switching — a snappier, slightly softer cut.",
    idealBpmDeltaMax: Infinity,
    idealGenres: ["hip-hop"],
    executable: true,
    exampleDjs: ["DJ Z-Trip", "Cut Chemist"],
  },

  // Blend-based
  {
    id: "long-blend",
    name: "Long Blend",
    category: "blend",
    description: "A long, tempo-matched overlap where both tracks play together for many bars before the outgoing track fades away.",
    idealBpmDeltaMax: 0.03,
    idealGenres: ["house", "techno", "trance", "amapiano"],
    executable: true,
    exampleDjs: ["Carl Cox", "Danny Tenaglia", "Sven Väth"],
  },
  {
    id: "phrase-blend",
    name: "Phrase Blend",
    category: "blend",
    description: "A moderate overlap aligned to a musical phrase boundary, in the classic disco/house blending tradition.",
    idealBpmDeltaMax: 0.05,
    idealGenres: ["house", "disco"],
    executable: true,
    exampleDjs: ["Larry Levan", "Frankie Knuckles", "Nicky Siano"],
  },

  // EQ / filter-based
  {
    id: "bass-swap",
    name: "Bass Swap",
    category: "eq-filter",
    description: "Pulls the low end out of the outgoing track while bringing in the incoming track's bassline, so only one kick/bass plays at a time.",
    idealBpmDeltaMax: 0.08,
    idealGenres: ["house", "techno"],
    executable: true,
    exampleDjs: ["Richie Hawtin", "Adam Beyer", "Marco Carola"],
  },
  {
    id: "filter-sweep",
    name: "Filter Sweep Build",
    category: "eq-filter",
    description: "A low-pass filter sweep that gradually opens up the incoming track, building energy into the drop.",
    idealBpmDeltaMax: 0.08,
    idealGenres: ["techno", "trance"],
    executable: true,
    exampleDjs: ["Sven Väth", "Paul van Dyk"],
  },

  // Effects-based
  {
    id: "echo-out",
    name: "Echo Out",
    category: "effects",
    description: "The outgoing track trails off into a decaying echo/delay tail as the incoming track enters underneath.",
    idealBpmDeltaMax: Infinity,
    idealGenres: ["techno", "dubstep", "drum and bass"],
    executable: true,
    exampleDjs: ["Jeff Mills", "Ben Klock"],
  },

  // Scratch-based (data/persona only — not executed)
  {
    id: "scratch-transition",
    name: "Scratch Transition",
    category: "scratch",
    description: "A turntablist scratches the incoming track's intro in over the outgoing track's tail before dropping it in fully.",
    idealBpmDeltaMax: Infinity,
    idealGenres: ["hip-hop"],
    executable: false,
    exampleDjs: ["Q-Bert", "DJ Craze", "Mix Master Mike"],
  },
  {
    id: "beat-juggle-transition",
    name: "Beat Juggle Transition",
    category: "scratch",
    description: "Rapidly alternating between two copies of a record to construct a live rhythmic bridge into the next track.",
    idealBpmDeltaMax: Infinity,
    idealGenres: ["hip-hop"],
    executable: false,
    exampleDjs: ["DJ Jazzy Jeff", "Q-Bert"],
  },

  // Vocal / layering-based (data/persona only — not executed)
  {
    id: "vocal-layering",
    name: "Vocal Layering",
    category: "vocal",
    description: "Layers the incoming track's vocal or acapella over the outgoing track's instrumental before the full switch.",
    idealBpmDeltaMax: 0.05,
    idealGenres: ["house"],
    executable: false,
    exampleDjs: ["The Blessed Madonna", "Honey Dijon"],
  },
  {
    id: "acapella-mashup",
    name: "Acapella Mashup",
    category: "vocal",
    description: "Drops an isolated vocal from one track over the instrumental of another to bridge two otherwise unrelated records.",
    idealBpmDeltaMax: 0.1,
    idealGenres: ["breakbeat"],
    executable: false,
    exampleDjs: ["Fatboy Slim", "DJ Z-Trip"],
  },

  // Digital-assisted
  {
    id: "auto-sync-blend",
    name: "Auto Sync Blend",
    category: "digital",
    description: "A sync-button-style automated tempo-matched blend — the modern, software-assisted default for a clean, reliable mix.",
    idealBpmDeltaMax: 0.1,
    idealGenres: [],
    executable: true,
    exampleDjs: ["David Guetta", "Fisher", "John Summit"],
  },
];
