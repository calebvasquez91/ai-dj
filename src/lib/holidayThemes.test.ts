import { describe, expect, it } from "vitest";
import { activeHolidayTheme, CUSTOM_PLAYLIST_THEMES, HOLIDAY_IDS, HOLIDAY_THEMES, holidayCountdown, holidayDate, holidayTheme, isCustomThemeId, isHolidayId, upcomingHoliday } from "./holidayThemes";
import { AA_RATIO, contrastRatio, WAVEFORM_BACKGROUND } from "./waveformColors";

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe("the ten holiday themes", () => {
  it("are exactly the ten asked for, each with its own waveform colours, accent tint and particles", () => {
    expect([...HOLIDAY_IDS]).toEqual(["christmas", "valentines", "new-years-eve", "st-patricks", "easter", "fourth-of-july", "thanksgiving", "hanukkah", "diwali", "lunar-new-year"]);
    for (const id of HOLIDAY_IDS) {
      const t = HOLIDAY_THEMES[id];
      expect(t.id).toBe(id);
      expect(t.particles.colors.length).toBeGreaterThan(0);
    }
  });

  it("use the particle each holiday calls for", () => {
    const shape = (id: (typeof HOLIDAY_IDS)[number]) => HOLIDAY_THEMES[id].particles.shape;
    expect(shape("christmas")).toBe("snowflake");
    expect(shape("valentines")).toBe("heart");
    expect(shape("new-years-eve")).toBe("confetti");
    expect(shape("st-patricks")).toBe("shamrock");
    expect(shape("easter")).toBe("egg");
    expect(shape("fourth-of-july")).toBe("firework");
    expect(shape("thanksgiving")).toBe("leaf");
    expect(shape("hanukkah")).toBe("star");
    expect(shape("diwali")).toBe("diya");
    expect(shape("lunar-new-year")).toBe("lantern");
    expect(HOLIDAY_THEMES.christmas.particles.motion).toBe("fall");
    expect(HOLIDAY_THEMES.valentines.particles.motion).toBe("rise");
  });

  it("keep every waveform colour readable on the dark surface (WCAG AA, 4.5:1)", () => {
    for (const id of HOLIDAY_IDS) {
      const { from, to } = HOLIDAY_THEMES[id].waveform;
      expect(contrastRatio(from, WAVEFORM_BACKGROUND), `${id} from`).toBeGreaterThanOrEqual(AA_RATIO);
      expect(contrastRatio(to, WAVEFORM_BACKGROUND), `${id} to`).toBeGreaterThanOrEqual(AA_RATIO);
    }
  });

  it("use the colours each holiday is known by", () => {
    expect(HOLIDAY_THEMES.christmas.waveform).toEqual({ from: "#34d058", to: "#ff5c5c" }); // green and red
    expect(HOLIDAY_THEMES.valentines.waveform).toEqual({ from: "#ff6fa5", to: "#ff4d6d" }); // pink and red
  });
});

describe("holidayTheme and activeHolidayTheme", () => {
  it("look a theme up by id, and know a real id", () => {
    expect(holidayTheme("diwali")?.label).toBe("Diwali");
    expect(holidayTheme("nope")).toBeNull();
    expect(holidayTheme(null)).toBeNull();
    expect(isHolidayId("easter")).toBe(true);
    expect(isHolidayId("halloween")).toBe(false);
  });
  it("give a playlist its own theme, and never a system playlist (Spooky Music keeps its own look)", () => {
    expect(activeHolidayTheme({ holidayTheme: "christmas" })?.id).toBe("christmas");
    expect(activeHolidayTheme({ holidayTheme: "christmas", theme: "spooky" })).toBeNull();
    expect(activeHolidayTheme({ holidayTheme: null })).toBeNull();
    expect(activeHolidayTheme(null)).toBeNull();
  });
  it("has no Halloween or spooky theme in the list", () => {
    expect([...HOLIDAY_IDS].some((id) => /spooky|halloween/i.test(id))).toBe(false);
  });
});

describe("the GTA6 custom theme", () => {
  const gta6 = CUSTOM_PLAYLIST_THEMES.gta6;

  it("is a custom theme, not a holiday: not in the picker's list, not a valid holiday id (so the API cannot set it), not suggested", () => {
    expect([...HOLIDAY_IDS]).not.toContain("gta6");
    expect(isHolidayId("gta6")).toBe(false);
    expect(isCustomThemeId("gta6")).toBe(true);
    expect(isCustomThemeId("christmas")).toBe(false);
    expect(isCustomThemeId("toString")).toBe(false); // not an inherited property
    expect(holidayTheme("gta6")).toBe(gta6);
  });

  it("takes the cover's neon sunset colours: pink to peach waveform, violet to pink accent, peach-pink-violet bars", () => {
    expect(gta6.waveform).toEqual({ from: "#ff6fb5", to: "#ffb375" });
    expect(gta6.accent).toEqual({ from: "#8f7bff", to: "#ff6fb5" });
    expect(gta6.lights).toEqual({ low: "#ffb375", mid: "#ff6fb5", high: "#8f7bff" });
  });

  it("keeps its waveform colours readable on the dark surface (WCAG AA, 4.5:1)", () => {
    expect(contrastRatio(gta6.waveform.from, WAVEFORM_BACKGROUND)).toBeGreaterThanOrEqual(AA_RATIO);
    expect(contrastRatio(gta6.waveform.to, WAVEFORM_BACKGROUND)).toBeGreaterThanOrEqual(AA_RATIO);
  });

  it("rains stars, cars and money, only while a song plays, one glyph per particle choice", () => {
    const { shape, motion, glyphs, colors } = gta6.particles;
    expect(shape).toBe("emoji");
    expect(motion).toBe("fall");
    expect(gta6.onlyWhilePlaying).toBe(true);
    expect(glyphs).toEqual(expect.arrayContaining(["\u2B50", "\u{1F697}", "\u{1F4B0}"])); // a star, a car, a money bag
    expect(colors).toHaveLength(glyphs!.length); // a particle picks its glyph by the same index as a colour
    expect(new Set(glyphs).size).toBe(glyphs!.length);
  });

  it("goes to a playlist that has it, never to a system playlist, and the holiday themes stay as they were", () => {
    expect(activeHolidayTheme({ holidayTheme: "gta6" })?.id).toBe("gta6");
    expect(activeHolidayTheme({ holidayTheme: "gta6", theme: "spooky" })).toBeNull();
    for (const id of HOLIDAY_IDS) {
      expect(HOLIDAY_THEMES[id].lights, id).toBeUndefined();
      expect(HOLIDAY_THEMES[id].onlyWhilePlaying, id).toBeUndefined();
      expect(HOLIDAY_THEMES[id].particles.shape, id).not.toBe("emoji");
    }
  });
});

describe("holidayDate", () => {
  it("knows the fixed holidays", () => {
    expect(holidayDate("christmas", 2026)).toBe(day(2026, 12, 25));
    expect(holidayDate("valentines", 2027)).toBe(day(2027, 2, 14));
    expect(holidayDate("new-years-eve", 2026)).toBe(day(2026, 12, 31));
    expect(holidayDate("st-patricks", 2026)).toBe(day(2026, 3, 17));
    expect(holidayDate("fourth-of-july", 2026)).toBe(day(2026, 7, 4));
  });
  it("works out Thanksgiving (the fourth Thursday of November) and Easter", () => {
    expect(holidayDate("thanksgiving", 2026)).toBe(day(2026, 11, 26));
    expect(holidayDate("thanksgiving", 2027)).toBe(day(2027, 11, 25));
    expect(holidayDate("easter", 2026)).toBe(day(2026, 4, 5));
    expect(holidayDate("easter", 2027)).toBe(day(2027, 3, 28));
  });
  it("lists the lunar and Hebrew calendar holidays by year, and says null for a year it does not know", () => {
    expect(holidayDate("diwali", 2026)).toBe(day(2026, 11, 8));
    expect(holidayDate("hanukkah", 2026)).toBe(day(2026, 12, 4));
    expect(holidayDate("lunar-new-year", 2027)).toBe(day(2027, 2, 6));
    expect(holidayDate("diwali", 2040)).toBeNull();
  });
});

describe("upcomingHoliday (the suggestion within three weeks)", () => {
  it("finds the nearest holiday that is today or within 21 days", () => {
    // 19 Nov 2026: Thanksgiving is 7 days away, Hanukkah 15, Christmas 36
    expect(upcomingHoliday(day(2026, 11, 19))).toEqual({ id: "thanksgiving", year: 2026, daysAway: 7 });
  });
  it("counts the day itself, and nothing a day after it", () => {
    expect(upcomingHoliday(day(2026, 12, 25))?.id).toBe("christmas");
    expect(upcomingHoliday(day(2026, 12, 25))?.daysAway).toBe(0);
    expect(upcomingHoliday(day(2026, 12, 26))?.id).toBe("new-years-eve");
  });
  it("is within exactly three weeks: 21 days counts, 22 does not", () => {
    expect(upcomingHoliday(day(2026, 12, 4))?.id).toBe("hanukkah"); // 21 days before Christmas, but Hanukkah is that day
    expect(upcomingHoliday(day(2026, 9, 14))).toBeNull(); // nothing in September to early October
    expect(upcomingHoliday(day(2026, 6, 13))?.id).toBe("fourth-of-july"); // 21 days before
    expect(upcomingHoliday(day(2026, 6, 12))).toBeNull(); // 22 days before
  });
  it("looks into next year (New Year's Eve in December leads on to Lunar New Year)", () => {
    expect(upcomingHoliday(day(2027, 1, 20))?.id).toBe("lunar-new-year");
  });
  it("says null when nothing is near", () => {
    expect(upcomingHoliday(day(2026, 5, 1))).toBeNull();
  });
});

describe("upcomingHoliday uses the person's own day", () => {
  const NEW_YORK = 300; // Date.getTimezoneOffset() in winter: UTC is five hours ahead
  it("at 9 pm on Christmas Eve in New York (already Christmas in UTC) it is still tomorrow, not today", () => {
    const eveningUtc = Date.UTC(2026, 11, 25, 2, 0); // 02:00 UTC on the 25th = 21:00 on the 24th in New York
    expect(upcomingHoliday(eveningUtc, undefined, NEW_YORK)).toMatchObject({ id: "christmas", daysAway: 1 });
    expect(upcomingHoliday(eveningUtc)).toMatchObject({ id: "christmas", daysAway: 0 }); // the UTC day, as before
  });
  it("on Christmas evening in New York the holiday is still today, not already gone", () => {
    const eveningUtc = Date.UTC(2026, 11, 26, 2, 0);
    expect(upcomingHoliday(eveningUtc, undefined, NEW_YORK)).toMatchObject({ id: "christmas", daysAway: 0 });
  });
  it("east of UTC the local day can be ahead of the UTC one", () => {
    const lateUtc = Date.UTC(2026, 11, 24, 20, 0); // 05:00 on the 25th in Tokyo
    expect(upcomingHoliday(lateUtc, undefined, -540)).toMatchObject({ id: "christmas", daysAway: 0 });
  });
});

describe("holidayCountdown", () => {
  it("reads naturally", () => {
    expect(holidayCountdown("thanksgiving", 7)).toBe("Thanksgiving is 7 days away.");
    expect(holidayCountdown("christmas", 1)).toBe("Christmas is tomorrow.");
    expect(holidayCountdown("christmas", 0)).toBe("It's Christmas today.");
  });
});
