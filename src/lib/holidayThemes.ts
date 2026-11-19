// Holiday themes for a playlist: the waveform colours, an accent tint and a light particle effect for each of ten holidays, and when each holiday
// is, so the app can suggest one when it is within three weeks. Spooky Music is NOT part of this: it keeps its own look (the Halloween layers and
// the spooky-* styles) and never takes a holiday theme. Pure.

export const HOLIDAY_IDS = [
  "christmas",
  "valentines",
  "new-years-eve",
  "st-patricks",
  "easter",
  "fourth-of-july",
  "thanksgiving",
  "hanukkah",
  "diwali",
  "lunar-new-year",
] as const;
export type HolidayId = (typeof HOLIDAY_IDS)[number];

export function isHolidayId(value: unknown): value is HolidayId {
  return typeof value === "string" && (HOLIDAY_IDS as readonly string[]).includes(value);
}

export type ParticleShape = "snowflake" | "heart" | "confetti" | "shamrock" | "egg" | "firework" | "leaf" | "star" | "diya" | "lantern";
/** How the particles move: fall, rise, drift about, or burst out from a point and fade. */
export type ParticleMotion = "fall" | "rise" | "drift" | "burst";

export interface HolidayTheme {
  id: HolidayId;
  label: string;
  /** The waveform's played bars: bottom colour to top colour. Each is bright enough to read on the dark surface (WCAG AA, 4.5:1). */
  waveform: { from: string; to: string };
  /** Tints the app's accent gradient (the play button and progress fill) while the playlist plays. */
  accent: { from: string; to: string };
  /** The particles' colours, drawn from the holiday's own palette. */
  particles: { shape: ParticleShape; motion: ParticleMotion; colors: readonly string[] };
}

export const HOLIDAY_THEMES: Readonly<Record<HolidayId, HolidayTheme>> = {
  christmas: {
    id: "christmas",
    label: "Christmas",
    waveform: { from: "#34d058", to: "#ff5c5c" },
    accent: { from: "#ff5c5c", to: "#34d058" },
    particles: { shape: "snowflake", motion: "fall", colors: ["#ffffff", "#e6f0ff", "#ffd6d6"] },
  },
  valentines: {
    id: "valentines",
    label: "Valentine's Day",
    waveform: { from: "#ff6fa5", to: "#ff4d6d" },
    accent: { from: "#ff6fa5", to: "#ff4d6d" },
    particles: { shape: "heart", motion: "rise", colors: ["#ff6fa5", "#ff4d6d", "#ffffff"] },
  },
  "new-years-eve": {
    id: "new-years-eve",
    label: "New Year's Eve",
    waveform: { from: "#e6b422", to: "#d9dde3" },
    accent: { from: "#e6b422", to: "#c9ced6" },
    particles: { shape: "confetti", motion: "fall", colors: ["#e6b422", "#d9dde3", "#ffffff"] },
  },
  "st-patricks": {
    id: "st-patricks",
    label: "St. Patrick's Day",
    waveform: { from: "#3ddc84", to: "#f5c542" },
    accent: { from: "#3ddc84", to: "#f5c542" },
    particles: { shape: "shamrock", motion: "fall", colors: ["#3ddc84", "#2fbf71", "#f5c542"] },
  },
  easter: {
    id: "easter",
    label: "Easter",
    waveform: { from: "#ff9ec4", to: "#c9a7ff" },
    accent: { from: "#ff9ec4", to: "#a8f0d0" },
    particles: { shape: "egg", motion: "drift", colors: ["#ffb3d1", "#fff3a3", "#a8f0d0", "#d2b8ff"] },
  },
  "fourth-of-july": {
    id: "fourth-of-july",
    label: "Fourth of July",
    waveform: { from: "#ff5c5c", to: "#5aa9ff" },
    accent: { from: "#ff5c5c", to: "#5aa9ff" },
    particles: { shape: "firework", motion: "burst", colors: ["#ff5c5c", "#ffffff", "#5aa9ff"] },
  },
  thanksgiving: {
    id: "thanksgiving",
    label: "Thanksgiving",
    waveform: { from: "#d98c3f", to: "#f2b84b" },
    accent: { from: "#ff8a3d", to: "#d9a441" },
    particles: { shape: "leaf", motion: "fall", colors: ["#ff8a3d", "#c47a3c", "#f2b84b"] },
  },
  hanukkah: {
    id: "hanukkah",
    label: "Hanukkah",
    waveform: { from: "#5aa9ff", to: "#dfe7f5" },
    accent: { from: "#5aa9ff", to: "#c9d6ee" },
    particles: { shape: "star", motion: "drift", colors: ["#5aa9ff", "#dfe7f5", "#ffffff"] },
  },
  diwali: {
    id: "diwali",
    label: "Diwali",
    waveform: { from: "#f5b942", to: "#ff4fb8" },
    accent: { from: "#f5b942", to: "#ff4fb8" },
    particles: { shape: "diya", motion: "rise", colors: ["#f5b942", "#ff4fb8", "#ff8a3d"] },
  },
  "lunar-new-year": {
    id: "lunar-new-year",
    label: "Lunar New Year",
    waveform: { from: "#ff5c5c", to: "#f5c542" },
    accent: { from: "#ff5c5c", to: "#f5c542" },
    particles: { shape: "lantern", motion: "rise", colors: ["#ff5c5c", "#f5c542"] },
  },
};

export function holidayTheme(id: string | null | undefined): HolidayTheme | null {
  return isHolidayId(id) ? HOLIDAY_THEMES[id] : null;
}

/** The holiday theme a playing playlist uses: its own, unless it is a system playlist (Spooky Music keeps its own look and never takes one). */
export function activeHolidayTheme(playlist: { holidayTheme?: string | null; theme?: string | null } | null | undefined): HolidayTheme | null {
  if (!playlist || playlist.theme) return null;
  return holidayTheme(playlist.holidayTheme);
}

// ---- When each holiday is ------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** Easter Sunday (the Gregorian rule), as a UTC day. */
function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The fourth Thursday of November (US Thanksgiving). */
function thanksgiving(year: number): number {
  const firstOfNov = new Date(utc(year, 11, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - firstOfNov + 7) % 7);
  return utc(year, 11, firstThursday + 21);
}

// Holidays that follow the lunar or Hebrew calendar, listed by year (Hanukkah by the day it starts at sunset, Diwali by its main day, Lunar
// New Year by its first day). Years outside the list get no suggestion for these rather than a wrong one.
const LUNAR_NEW_YEAR: Record<number, [number, number]> = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13] };
const HANUKKAH: Record<number, [number, number]> = { 2026: [12, 4], 2027: [12, 24], 2028: [12, 12], 2029: [12, 1] };
const DIWALI: Record<number, [number, number]> = { 2026: [11, 8], 2027: [10, 29], 2028: [10, 17], 2029: [11, 5] };

function fromTable(table: Record<number, [number, number]>, year: number): number | null {
  const entry = table[year];
  return entry ? utc(year, entry[0], entry[1]) : null;
}

/** The day (UTC midnight) a holiday falls on in a year, or null when the year is not known for a lunar or Hebrew calendar holiday. */
export function holidayDate(id: HolidayId, year: number): number | null {
  switch (id) {
    case "christmas":
      return utc(year, 12, 25);
    case "valentines":
      return utc(year, 2, 14);
    case "new-years-eve":
      return utc(year, 12, 31);
    case "st-patricks":
      return utc(year, 3, 17);
    case "easter":
      return easter(year);
    case "fourth-of-july":
      return utc(year, 7, 4);
    case "thanksgiving":
      return thanksgiving(year);
    case "hanukkah":
      return fromTable(HANUKKAH, year);
    case "diwali":
      return fromTable(DIWALI, year);
    case "lunar-new-year":
      return fromTable(LUNAR_NEW_YEAR, year);
  }
}

export const SUGGEST_WITHIN_DAYS = 21;

export interface UpcomingHoliday {
  id: HolidayId;
  /** The year it is in (a key for remembering that the suggestion was dismissed). */
  year: number;
  /** Whole days from today (0 is the day itself). */
  daysAway: number;
}

/** The nearest holiday that is today or within the next three weeks, or null when there is none. Looks into next year too (New Year's Eve in December, Lunar New Year in January). */
export function upcomingHoliday(now: number = Date.now(), withinDays = SUGGEST_WITHIN_DAYS, tzOffsetMinutes = 0): UpcomingHoliday | null {
  // "Today" is the person's own day: `tzOffsetMinutes` is Date.getTimezoneOffset() (minutes UTC is ahead of local time; 0 reads the UTC day).
  const local = new Date(now - tzOffsetMinutes * 60_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const thisYear = new Date(today).getUTCFullYear();
  let best: UpcomingHoliday | null = null;
  for (const year of [thisYear, thisYear + 1]) {
    for (const id of HOLIDAY_IDS) {
      const date = holidayDate(id, year);
      if (date == null) continue;
      const daysAway = Math.round((date - today) / DAY_MS);
      if (daysAway >= 0 && daysAway <= withinDays && (!best || daysAway < best.daysAway)) best = { id, year, daysAway };
    }
  }
  return best;
}

/** "Thanksgiving is 7 days away." / "Christmas is tomorrow." / "It's Christmas." */
export function holidayCountdown(id: HolidayId, daysAway: number): string {
  const label = HOLIDAY_THEMES[id].label;
  if (daysAway === 0) return `It's ${label} today.`;
  if (daysAway === 1) return `${label} is tomorrow.`;
  return `${label} is ${daysAway} days away.`;
}
