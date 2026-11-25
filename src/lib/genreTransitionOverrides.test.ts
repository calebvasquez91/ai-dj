import { describe, expect, it } from "vitest";
import { GENRE_TRANSITIONS } from "./genreTransitions";
import { mergeRules, overrideFromEdit, parseOverrideTable, parseRuleOverride } from "./genreTransitionOverrides";
import { GENRE_TRANSITION_DEFAULTS, parseGenreTransitionSettings } from "./genreTransitionSettings";
import { DECISION_KEEP_DAYS, isTaxonomyGenre, parseDecisionInput, saveSharedOverride, shouldPrune } from "./genreTransitionsServer";
import { statsFromAggregates, summarizeDecisions, summarizeJobStatuses } from "./transitionStats";
import { rankTransitions } from "./transitionPlanner";

describe("parseRuleOverride", () => {
  it("keeps known styles in order without repeats, and a sane bar range", () => {
    expect(parseRuleOverride({ preferredStyles: ["fade", "quick-cut", "fade", "nonsense"], blendBarsRange: [2.4, 8] })).toEqual({ preferredStyles: ["fade", "quick-cut"], blendBarsRange: [2, 8] });
  });

  it("drops what is unusable: unknown styles only, a backwards or out-of-range bar range, non-objects", () => {
    expect(parseRuleOverride({ preferredStyles: ["nope"] })).toBeNull();
    expect(parseRuleOverride({ blendBarsRange: [8, 2] })).toBeNull();
    expect(parseRuleOverride({ blendBarsRange: [0, 4] })).toBeNull();
    expect(parseRuleOverride({ blendBarsRange: [1, 65] })).toBeNull();
    expect(parseRuleOverride({ blendBarsRange: ["a", "b"] })).toBeNull();
    expect(parseRuleOverride(null)).toBeNull();
    expect(parseRuleOverride("fade")).toBeNull();
  });

  it("keeps the usable half when the other half is bad", () => {
    expect(parseRuleOverride({ preferredStyles: ["fade"], blendBarsRange: [9, 3] })).toEqual({ preferredStyles: ["fade"] });
  });
});

describe("parseOverrideTable", () => {
  it("reads JSON text, ignores genres that are not in the taxonomy, and survives garbage", () => {
    expect(parseOverrideTable(JSON.stringify({ Pop: { preferredStyles: ["fade"] }, "Made Up": { preferredStyles: ["fade"] } }))).toEqual({ Pop: { preferredStyles: ["fade"] } });
    expect(parseOverrideTable("not json")).toEqual({});
    expect(parseOverrideTable([1, 2])).toEqual({});
    expect(parseOverrideTable(undefined)).toEqual({});
  });
});

describe("mergeRules", () => {
  it("applies the shared edit, then this device's on top, and leaves every other genre and field as built in", () => {
    const merged = mergeRules({ Pop: { preferredStyles: ["fade"], blendBarsRange: [2, 4] } }, { Pop: { blendBarsRange: [1, 2] }, Rock: { preferredStyles: ["fade"] } });
    expect(merged.Pop.preferredStyles).toEqual(["fade"]); // shared
    expect(merged.Pop.blendBarsRange).toEqual([1, 2]); // device wins
    expect(merged.Pop.beatSync).toBe(GENRE_TRANSITIONS.Pop.beatSync); // untouched field
    expect(merged.Rock.preferredStyles).toEqual(["fade"]);
    expect(merged.Jazz).toBe(GENRE_TRANSITIONS.Jazz); // no override: the very same rule
    expect(Object.keys(merged)).toEqual(Object.keys(GENRE_TRANSITIONS));
  });

  it("does not change the built-in table", () => {
    const before = JSON.stringify(GENRE_TRANSITIONS);
    mergeRules({ Pop: { preferredStyles: ["fade"] } }, {});
    expect(JSON.stringify(GENRE_TRANSITIONS)).toBe(before);
  });

  it("changes what the planner chooses", () => {
    const tagged = { genreTags: [{ genre: "Electronic", source: "file-tags" as const, confidence: 0.9, updatedAt: 0 }] };
    const report = { bpmDelta: 1, trackA_bpm: 124, tempoConfident: true, keyCompatibility: "perfect" as const, keyConfident: true, bpmStrategy: "exact" as const };
    const built = rankTransitions(tagged, tagged, report, undefined, { enabledTools: new Set() });
    const edited = rankTransitions(tagged, tagged, report, undefined, { enabledTools: new Set(), rules: mergeRules({}, { Electronic: { preferredStyles: ["short-blend"] } }) });
    expect(built[0].style).toBe("long-blend");
    expect(edited[0].style).toBe("short-blend");
  });
});

describe("per-device settings", () => {
  it("are off by default, and survive missing or damaged storage", () => {
    expect(GENRE_TRANSITION_DEFAULTS.enabled).toBe(false);
    expect(parseGenreTransitionSettings(null)).toEqual(GENRE_TRANSITION_DEFAULTS);
    expect(parseGenreTransitionSettings("{oops")).toEqual(GENRE_TRANSITION_DEFAULTS);
    expect(parseGenreTransitionSettings("42")).toEqual(GENRE_TRANSITION_DEFAULTS);
  });

  it("turn on only for an explicit true, and clean the saved overrides", () => {
    expect(parseGenreTransitionSettings(JSON.stringify({ enabled: "yes" })).enabled).toBe(false);
    const s = parseGenreTransitionSettings(JSON.stringify({ enabled: true, overrides: { Pop: { preferredStyles: ["fade", "bogus"] }, Bogus: {} } }));
    expect(s).toEqual({ enabled: true, overrides: { Pop: { preferredStyles: ["fade"] } } });
  });
});

describe("the decision the browser logs", () => {
  const ok = { fromGenre: "Pop", toGenre: "Rock", style: "quick-cut", decidedBy: "claude", vetoes: [{ style: "long-blend", reason: "both ends have heavy vocals" }], mixability: 0.7 };

  it("accepts a well-formed decision", () => {
    expect(parseDecisionInput(ok)).toEqual(ok);
  });

  it("rejects an unknown style or decider, or a missing genre", () => {
    expect(parseDecisionInput({ ...ok, style: "wobble" })).toBeNull();
    expect(parseDecisionInput({ ...ok, decidedBy: "somebody" })).toBeNull();
    expect(parseDecisionInput({ ...ok, fromGenre: "" })).toBeNull();
    expect(parseDecisionInput(null)).toBeNull();
  });

  it("clamps mixability and drops malformed vetoes", () => {
    const d = parseDecisionInput({ ...ok, mixability: 5, vetoes: [{ style: "a", reason: "b" }, { style: 1 }, null] });
    expect(d?.mixability).toBe(1);
    expect(d?.vetoes).toEqual([{ style: "a", reason: "b" }]);
  });

  it("logs only genres of the taxonomy: free text, inherited keys and an unknown genre are refused", () => {
    expect(parseDecisionInput({ ...ok, fromGenre: "x".repeat(200) })).toBeNull();
    expect(parseDecisionInput({ ...ok, toGenre: "Not A Genre" })).toBeNull();
    expect(parseDecisionInput({ ...ok, fromGenre: "toString" })).toBeNull();
    expect(parseDecisionInput({ ...ok, toGenre: "Unknown" })).toBeNull();
  });
});

describe("the admin counts", () => {
  const rows = [
    { fromGenre: "Pop", toGenre: "Rock", style: "quick-cut", decidedBy: "local", vetoesJson: JSON.stringify([{ style: "long-blend", reason: "beat confidence is below 0.5" }]) },
    { fromGenre: "Pop", toGenre: "Rock", style: "echo-out", decidedBy: "claude", vetoesJson: JSON.stringify([{ style: "long-blend", reason: "beat confidence is below 0.5" }, { style: "medium-blend", reason: "beat confidence is below 0.5" }]) },
    { fromGenre: "Electronic", toGenre: "Electronic", style: "long-blend", decidedBy: "local-fallback", vetoesJson: "not json" },
  ];

  it("counts transitions by style and by genre pair, vetoes, and model calls", () => {
    const s = summarizeDecisions(rows);
    expect(s.total).toBe(3);
    expect(s.byStyle).toEqual([{ key: "echo-out", count: 1 }, { key: "long-blend", count: 1 }, { key: "quick-cut", count: 1 }]);
    expect(s.byGenrePair[0]).toEqual({ key: "Pop → Rock", count: 2 });
    expect(s.vetoTotal).toBe(3);
    expect(s.vetoes[0]).toEqual({ key: "long-blend: beat confidence is below 0.5", count: 2 });
    expect(s.modelCalls).toBe(1);
    expect(s.modelFallbacks).toBe(1);
  });

  it("is all zeros for no decisions", () => {
    expect(summarizeDecisions([])).toEqual({ vetoesSampled: false, total: 0, byStyle: [], byGenrePair: [], vetoes: [], vetoTotal: 0, modelCalls: 0, modelFallbacks: 0 });
  });

  it("sums vocal separation jobs by status, putting an unknown status under other", () => {
    expect(summarizeJobStatuses([{ status: "ready", count: 4 }, { status: "failed", count: 1 }, { status: "pending", count: 2 }, { status: "weird", count: 3 }])).toEqual({ pending: 2, processing: 0, ready: 4, failed: 1, other: 3 });
  });
});

describe("genre names are the table's own, never inherited object keys", () => {
  it("rejects toString, constructor and __proto__ everywhere a genre name is checked", () => {
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(isTaxonomyGenre(name), name).toBe(false);
      expect(parseOverrideTable(JSON.parse(`{"${name}": {"preferredStyles": ["fade"]}}`)), name).toEqual({});
    }
    expect(isTaxonomyGenre("Hip-Hop")).toBe(true);
  });

  it("the admin save refuses an inherited key before touching the database", async () => {
    expect(await saveSharedOverride("toString", { preferredStyles: ["fade"] }, "admin")).toEqual({ ok: false, reason: "unknown-genre" });
    expect(await saveSharedOverride("Nope", { preferredStyles: ["fade"] }, "admin")).toEqual({ ok: false, reason: "unknown-genre" });
  });

  it("a rule lookup for an inherited key is the safe default, not a function", async () => {
    const { genreRule, DEFAULT_GENRE_RULE, genreFlowDistance } = await import("./genreTransitions");
    expect(genreRule("constructor")).toBe(DEFAULT_GENRE_RULE);
    expect(genreRule("toString")).toBe(DEFAULT_GENRE_RULE);
    expect(genreFlowDistance("toString", "Pop")).toBe(0);
  });

  it("mergeRules ignores inherited keys on the override tables", () => {
    const hostile = Object.create({ Pop: { preferredStyles: ["fade"] } }) as Record<string, never>;
    expect(mergeRules(hostile, hostile).Pop.preferredStyles).toEqual(GENRE_TRANSITIONS.Pop.preferredStyles);
  });
});

describe("overrideFromEdit: only what was changed is stored", () => {
  const pop = GENRE_TRANSITIONS.Pop;
  const same = { preferredStyles: pop.preferredStyles, blendBarsRange: pop.blendBarsRange };

  it("reordering styles does not also pin the bar range", () => {
    const reordered = [...pop.preferredStyles].reverse();
    expect(overrideFromEdit(pop, undefined, { ...same, preferredStyles: reordered })).toEqual({ preferredStyles: reordered });
  });

  it("changing only the bars does not pin the styles", () => {
    expect(overrideFromEdit(pop, undefined, { ...same, blendBarsRange: [2, 3] })).toEqual({ blendBarsRange: [2, 3] });
  });

  it("keeps what this layer already overrode when the other field is edited", () => {
    const existing = { blendBarsRange: [1, 2] as [number, number] };
    const rule = mergeRules({}, { Pop: existing }).Pop;
    const reordered = [...rule.preferredStyles].reverse();
    expect(overrideFromEdit(rule, existing, { preferredStyles: reordered, blendBarsRange: rule.blendBarsRange })).toEqual({ blendBarsRange: [1, 2], preferredStyles: reordered });
  });

  it("stores nothing when nothing changed", () => {
    expect(overrideFromEdit(pop, undefined, same)).toBeNull();
  });
});

describe("exact admin counts from the database's own totals", () => {
  it("builds the same numbers as summing the rows, however many decisions there are", () => {
    const s = statsFromAggregates({
      total: 123456,
      byStyle: [{ style: "fade", count: 40 }, { style: "quick-cut", count: 123416 }],
      byPair: [{ fromGenre: "Pop", toGenre: "Rock", count: 100000 }, { fromGenre: "Rock", toGenre: "Pop", count: 23456 }],
      byDecider: [{ decidedBy: "local", count: 123000 }, { decidedBy: "claude", count: 400 }, { decidedBy: "local-fallback", count: 56 }],
      vetoRows: [{ vetoesJson: JSON.stringify([{ style: "long-blend", reason: "the key is not certain" }]) }, { vetoesJson: "[]" }],
      vetoRowsCapped: true,
    });
    expect(s.total).toBe(123456); // past the old 50,000-row cap
    expect(s.byStyle[0]).toEqual({ key: "quick-cut", count: 123416 });
    expect(s.byGenrePair[0]).toEqual({ key: "Pop \u2192 Rock", count: 100000 });
    expect(s.modelCalls).toBe(400);
    expect(s.modelFallbacks).toBe(56);
    expect(s.vetoes).toEqual([{ key: "long-blend: the key is not certain", count: 1 }]);
    expect(s.vetoesSampled).toBe(true);
  });
});

describe("the decision log does not grow without limit", () => {
  it("prunes at most once every six hours, and keeps 180 days", () => {
    const six = 6 * 3_600_000;
    expect(shouldPrune(six, 0)).toBe(true);
    expect(shouldPrune(six - 1, 0)).toBe(false);
    expect(shouldPrune(2 * six, six)).toBe(true);
    expect(DECISION_KEEP_DAYS).toBe(180);
  });
});
