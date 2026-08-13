/**
 * DJ techniques and genre families, cross-referenced against `djs.ts` by
 * name so the recommendation logic in `lib/dj-inspiration.ts` can look up
 * representative artists for a given style.
 */

export interface Technique {
  id: string;
  name: string;
  category: "technique";
  description: string;
  variants?: string[];
  bestForGenres: string[]; // GenreFamily ids
  exampleDjs: string[]; // names matching djs.ts
}

export interface GenreFamily {
  id: string;
  name: string;
  category: "genre";
  description: string;
  subgenres: string[];
  representativeTechnique: string; // Technique id
  exampleDjs: string[]; // names matching djs.ts
  moodKeywords: string[]; // loose keyword hints for the style advisor
}

export const techniques: Technique[] = [
  {
    id: "turntablism",
    name: "Turntablism",
    category: "technique",
    description:
      "Using turntables as a live instrument — scratching, juggling, and manipulating records rather than just playing them.",
    variants: ["baby scratch", "chirp", "transform", "flare", "crab"],
    bestForGenres: ["hip-hop"],
    exampleDjs: ["Q-Bert", "Mix Master Mike", "DJ Craze", "DJ Jazzy Jeff"],
  },
  {
    id: "beatmatching",
    name: "Beatmatching",
    category: "technique",
    description: "Aligning the tempo and phase of two tracks so they play in sync.",
    bestForGenres: ["house", "techno", "trance"],
    exampleDjs: ["Carl Cox", "Richie Hawtin", "Armin van Buuren"],
  },
  {
    id: "beat-juggling",
    name: "Beat Juggling",
    category: "technique",
    description: "Rapidly alternating between two copies of a record to create new rhythmic patterns live.",
    bestForGenres: ["hip-hop"],
    exampleDjs: ["Q-Bert", "DJ Craze"],
  },
  {
    id: "harmonic-mixing",
    name: "Harmonic Mixing",
    category: "technique",
    description: "Mixing tracks in compatible musical keys (often via the Camelot wheel) for smoother, more musical transitions.",
    bestForGenres: ["house", "techno", "trance"],
    exampleDjs: ["Carl Cox", "Danny Tenaglia", "Richie Hawtin"],
  },
  {
    id: "blending",
    name: "Blending / Phrase Mixing",
    category: "technique",
    description: "Smoothly overlapping the outro of one track with the intro of the next, aligned to musical phrases.",
    bestForGenres: ["house", "disco", "trance"],
    exampleDjs: ["Larry Levan", "Frankie Knuckles", "Nicky Siano"],
  },
  {
    id: "cutting",
    name: "Cutting",
    category: "technique",
    description: "Abruptly switching between two tracks for dramatic, percussive effect.",
    bestForGenres: ["hip-hop"],
    exampleDjs: ["Grandmaster Flash", "DJ Premier"],
  },
  {
    id: "backspinning",
    name: "Back-Spinning",
    category: "technique",
    description: "Spinning a record backward by hand to repeat a beat or create a rewind effect.",
    bestForGenres: ["hip-hop"],
    exampleDjs: ["Grandmaster Flash", "Grand Wizzard Theodore"],
  },
  {
    id: "slip-cueing",
    name: "Slip-Cueing",
    category: "technique",
    description: "Holding a spinning record in place by hand and releasing it precisely on the beat.",
    bestForGenres: ["hip-hop", "disco"],
    exampleDjs: ["Grandmaster Flash", "Larry Levan"],
  },
  {
    id: "mashup",
    name: "Live Remixing / Mashup DJing",
    category: "technique",
    description: "Combining elements of multiple tracks live to create a new hybrid on the fly.",
    bestForGenres: ["big beat", "edm"],
    exampleDjs: ["DJ Z-Trip", "Fatboy Slim"],
  },
  {
    id: "open-format",
    name: "Open-Format DJing",
    category: "technique",
    description: "Playing across genres in one set, reading the crowd rather than sticking to a single style.",
    bestForGenres: ["hip-hop", "house"],
    exampleDjs: ["DJ Z-Trip", "Cut Chemist"],
  },
  {
    id: "controllerism",
    name: "Controllerism",
    category: "technique",
    description: "Performance-style DJing built around digital controllers (Serato, Traktor, CDJs) rather than vinyl.",
    bestForGenres: ["edm", "bass music"],
    exampleDjs: ["Excision", "Zeds Dead"],
  },
  {
    id: "live-pa",
    name: "Live PA",
    category: "technique",
    description: "A hybrid DJ/live-production set where elements are performed and manipulated in real time, not just mixed.",
    bestForGenres: ["techno", "edm"],
    exampleDjs: ["The Chemical Brothers", "Jean-Michel Jarre"],
  },
  {
    id: "battle-dj",
    name: "Battle DJing",
    category: "technique",
    description: "Competitive, technically showcase-driven DJing built around scratch routines and juggling.",
    bestForGenres: ["hip-hop"],
    exampleDjs: ["DJ Craze", "Q-Bert"],
  },
  {
    id: "b2b",
    name: "B2B (Back-to-Back) DJing",
    category: "technique",
    description: "Two DJs alternating tracks in the same set, playing off each other's selections.",
    bestForGenres: ["techno", "house"],
    exampleDjs: ["Carl Cox", "Sven Väth"],
  },
  {
    id: "context-based",
    name: "Context-Based DJing",
    category: "technique",
    description: "Sets shaped by the venue and crowd — mobile, wedding, club, or festival DJing each call for a different approach.",
    variants: ["mobile/wedding", "club", "festival"],
    bestForGenres: ["house", "edm"],
    exampleDjs: ["David Guetta", "The Blessed Madonna"],
  },
];

export const genreFamilies: GenreFamily[] = [
  {
    id: "house",
    name: "House",
    category: "genre",
    description: "Four-on-the-floor dance music rooted in disco, soul, and Chicago warehouse culture.",
    subgenres: [
      "deep house",
      "tech house",
      "progressive house",
      "electro house",
      "tropical house",
      "future house",
      "acid house",
      "disco house",
      "afro house",
      "funky house",
    ],
    representativeTechnique: "harmonic-mixing",
    exampleDjs: ["Frankie Knuckles", "Black Coffee", "Carl Cox", "Fisher"],
    moodKeywords: ["groovy", "warm", "soulful", "club", "night out"],
  },
  {
    id: "techno",
    name: "Techno",
    category: "genre",
    description: "Machine-driven, repetitive dance music that originated in Detroit and evolved into many harder-edged offshoots.",
    subgenres: ["minimal techno", "hard techno", "industrial techno", "acid techno", "Detroit techno", "melodic techno", "dub techno"],
    representativeTechnique: "harmonic-mixing",
    exampleDjs: ["Jeff Mills", "Charlotte de Witte", "Richie Hawtin", "Ben Klock"],
    moodKeywords: ["dark", "driving", "intense", "warehouse", "hypnotic"],
  },
  {
    id: "trance",
    name: "Trance",
    category: "genre",
    description: "Melodic, build-and-release dance music built around long, euphoric arrangements.",
    subgenres: ["progressive trance", "uplifting trance", "psytrance", "tech trance", "vocal trance", "hard trance"],
    representativeTechnique: "beatmatching",
    exampleDjs: ["Armin van Buuren", "Tiësto", "Above & Beyond"],
    moodKeywords: ["euphoric", "uplifting", "emotional", "festival", "journey"],
  },
  {
    id: "dnb",
    name: "Drum & Bass / Jungle",
    category: "genre",
    description: "Fast breakbeat-driven dance music with heavy basslines, rooted in UK jungle.",
    subgenres: ["liquid dnb", "jump-up", "neurofunk", "jungle"],
    representativeTechnique: "beatmatching",
    exampleDjs: ["Andy C", "Goldie", "Netsky"],
    moodKeywords: ["fast", "energetic", "workout", "intense"],
  },
  {
    id: "dubstep",
    name: "Dubstep / Bass",
    category: "genre",
    description: "Bass-heavy, half-time dance music built around syncopated rhythms and heavy sub-bass drops.",
    subgenres: ["brostep", "riddim", "future bass", "trap (edm)", "moombahton"],
    representativeTechnique: "controllerism",
    exampleDjs: ["Skrillex", "Excision", "Flux Pavilion"],
    moodKeywords: ["heavy", "aggressive", "bass", "rowdy"],
  },
  {
    id: "hip-hop",
    name: "Hip-Hop / Turntablism",
    category: "genre",
    description: "Rhythm-and-rhyme dance music built on breakbeats, sampling, and scratch technique.",
    subgenres: ["boom bap", "trap", "scratch-based sets"],
    representativeTechnique: "turntablism",
    exampleDjs: ["Grandmaster Flash", "DJ Premier", "Q-Bert"],
    moodKeywords: ["party", "old school", "block party", "hip hop night"],
  },
  {
    id: "disco",
    name: "Disco / Funk",
    category: "genre",
    description: "Groove-forward, band-based dance music that laid the foundation for house music.",
    subgenres: ["nu-disco", "boogie"],
    representativeTechnique: "blending",
    exampleDjs: ["Larry Levan", "Nile Rodgers", "Nicky Siano"],
    moodKeywords: ["retro", "funky", "feel good", "warm up"],
  },
  {
    id: "breakbeat",
    name: "Breakbeat / Big Beat",
    category: "genre",
    description: "Sample-heavy dance music built on chopped, syncopated drum breaks.",
    subgenres: ["breaks", "electro", "big beat"],
    representativeTechnique: "mashup",
    exampleDjs: ["Fatboy Slim", "The Chemical Brothers", "The Prodigy"],
    moodKeywords: ["party", "playful", "high energy", "rock crossover"],
  },
  {
    id: "uk-bass",
    name: "UK Garage / Bass",
    category: "genre",
    description: "Syncopated, bass-forward UK club music spanning garage, grime, and its dubstep-adjacent offshoots.",
    subgenres: ["2-step", "speed garage", "grime"],
    representativeTechnique: "beatmatching",
    exampleDjs: ["Disclosure"],
    moodKeywords: ["uk club", "bouncy", "late night"],
  },
  {
    id: "reggae",
    name: "Reggae / Dancehall",
    category: "genre",
    description: "Soundsystem-rooted Jamaican music built on deep basslines and dub techniques.",
    subgenres: ["dub", "soundsystem culture"],
    representativeTechnique: "blending",
    exampleDjs: [],
    moodKeywords: ["chill", "soundsystem", "island", "laid back"],
  },
  {
    id: "hardstyle",
    name: "Hardstyle / Hardcore",
    category: "genre",
    description: "Aggressive, distorted-kick dance music built for maximum intensity.",
    subgenres: ["gabber", "hardcore", "hardstyle", "hard dance"],
    representativeTechnique: "beatmatching",
    exampleDjs: [],
    moodKeywords: ["extreme", "rave", "aggressive", "hard"],
  },
  {
    id: "downtempo",
    name: "IDM / Ambient / Downtempo",
    category: "genre",
    description: "Slower, texture-focused electronic music built for listening as much as dancing.",
    subgenres: ["chillout", "ambient techno", "trip-hop"],
    representativeTechnique: "live-pa",
    exampleDjs: ["DJ Shadow", "Jean-Michel Jarre"],
    moodKeywords: ["chill", "relax", "study", "wind down", "ambient"],
  },
  {
    id: "synthwave",
    name: "Synthwave / Electro-Pop",
    category: "genre",
    description: "Retro-futurist synth-driven music crossing into pop songwriting.",
    subgenres: [],
    representativeTechnique: "live-pa",
    exampleDjs: ["Jean-Michel Jarre"],
    moodKeywords: ["retro", "nostalgic", "cinematic"],
  },
  {
    id: "amapiano",
    name: "Amapiano",
    category: "genre",
    description: "South African house style built around deep, rolling log-drum basslines.",
    subgenres: [],
    representativeTechnique: "blending",
    exampleDjs: ["Black Coffee"],
    moodKeywords: ["african", "groovy", "laid back", "log drum"],
  },
];
