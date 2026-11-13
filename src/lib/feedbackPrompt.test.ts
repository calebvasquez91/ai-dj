import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_FIRST_AFTER_USE_MS,
  FEEDBACK_MAX_DISMISSALS,
  FEEDBACK_PROMPT_DEFAULTS,
  FEEDBACK_PROMPT_STORAGE_KEY,
  FEEDBACK_QUIET_AFTER_SUBMIT_MS,
  FEEDBACK_RESHOW_AFTER_MS,
  addFeedbackUsage,
  feedbackPromptIsDormant,
  isBusyElement,
  loadFeedbackPromptState,
  markFeedbackDismissed,
  markFeedbackShown,
  markFeedbackSubmitted,
  mergeServerSubmission,
  parseFeedbackPromptState,
  shouldRunFeedbackTick,
  shouldShowFeedbackPrompt,
  updateFeedbackPromptState,
  type FeedbackPromptState,
} from "@/lib/feedbackPrompt";

const DAY = 24 * 60 * 60 * 1000;
const used = (over: Partial<FeedbackPromptState> = {}): FeedbackPromptState => ({ ...FEEDBACK_PROMPT_DEFAULTS, usedMs: FEEDBACK_FIRST_AFTER_USE_MS, ...over });

describe("shouldShowFeedbackPrompt", () => {
  const now = 100 * DAY;

  it("waits until the app has been used for a while", () => {
    expect(shouldShowFeedbackPrompt(FEEDBACK_PROMPT_DEFAULTS, now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used({ usedMs: FEEDBACK_FIRST_AFTER_USE_MS - 1 }), now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used(), now)).toBe(true);
  });

  it("shows only once until the wait is over", () => {
    expect(shouldShowFeedbackPrompt(used({ lastShownAt: now - 1000 }), now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used({ lastShownAt: now - FEEDBACK_RESHOW_AFTER_MS + 1 }), now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used({ lastShownAt: now - FEEDBACK_RESHOW_AFTER_MS }), now)).toBe(true);
  });

  it("stops asking after the third time it was closed without an answer", () => {
    const longAgo = now - 60 * DAY;
    expect(shouldShowFeedbackPrompt(used({ lastShownAt: longAgo, dismissals: FEEDBACK_MAX_DISMISSALS - 1 }), now)).toBe(true);
    expect(shouldShowFeedbackPrompt(used({ lastShownAt: longAgo, dismissals: FEEDBACK_MAX_DISMISSALS }), now)).toBe(false);
  });

  it("stays quiet for three months after feedback was sent, then may ask again", () => {
    expect(shouldShowFeedbackPrompt(used({ submittedAt: now - DAY }), now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used({ submittedAt: now - FEEDBACK_QUIET_AFTER_SUBMIT_MS + 1 }), now)).toBe(false);
    expect(shouldShowFeedbackPrompt(used({ submittedAt: now - FEEDBACK_QUIET_AFTER_SUBMIT_MS }), now)).toBe(true);
  });
});

describe("the state transitions", () => {
  it("adds usage, never negative", () => {
    expect(addFeedbackUsage(FEEDBACK_PROMPT_DEFAULTS, 15_000).usedMs).toBe(15_000);
    expect(addFeedbackUsage(used(), -5000).usedMs).toBe(FEEDBACK_FIRST_AFTER_USE_MS);
  });

  it("records shown, dismissed and submitted, leaving the rest alone", () => {
    const start = used({ dismissals: 1 });
    expect(markFeedbackShown(start, 5)).toEqual({ ...start, lastShownAt: 5 });
    expect(markFeedbackDismissed(start)).toEqual({ ...start, dismissals: 2 });
    expect(markFeedbackSubmitted(start, 9)).toEqual({ ...start, submittedAt: 9 });
  });

  it("walks a person through: first ask, closed, asked again later, then answered", () => {
    let state = FEEDBACK_PROMPT_DEFAULTS;
    let t = 1000 * DAY;
    state = addFeedbackUsage(state, FEEDBACK_FIRST_AFTER_USE_MS);
    expect(shouldShowFeedbackPrompt(state, t)).toBe(true);
    state = markFeedbackDismissed(markFeedbackShown(state, t));
    expect(shouldShowFeedbackPrompt(state, t + DAY)).toBe(false);
    t += FEEDBACK_RESHOW_AFTER_MS;
    expect(shouldShowFeedbackPrompt(state, t)).toBe(true);
    state = markFeedbackSubmitted(markFeedbackShown(state, t), t);
    expect(shouldShowFeedbackPrompt(state, t + 30 * DAY)).toBe(false);
  });
});

describe("parseFeedbackPromptState", () => {
  it("falls back to the defaults for nothing or nonsense", () => {
    for (const raw of [null, "", "not json", "null", "5", "[]"]) expect(parseFeedbackPromptState(raw), String(raw)).toEqual(FEEDBACK_PROMPT_DEFAULTS);
  });

  it("reads saved state back, field by field", () => {
    const saved = { usedMs: 12345, lastShownAt: 99, dismissals: 2, submittedAt: 7 };
    expect(parseFeedbackPromptState(JSON.stringify(saved))).toEqual(saved);
    expect(parseFeedbackPromptState(JSON.stringify({ usedMs: "x", lastShownAt: -1, dismissals: 2.9, submittedAt: null }))).toEqual({
      usedMs: 0,
      lastShownAt: null,
      dismissals: 2,
      submittedAt: null,
    });
  });
});

describe("feedbackPromptIsDormant", () => {
  const now = 500 * DAY;
  it("is true once it was closed three times, whatever else", () => {
    expect(feedbackPromptIsDormant(used({ dismissals: FEEDBACK_MAX_DISMISSALS }), now)).toBe(true);
    expect(feedbackPromptIsDormant(used({ dismissals: FEEDBACK_MAX_DISMISSALS - 1 }), now)).toBe(false);
  });
  it("is true while feedback was sent lately, and ends with the quiet period", () => {
    expect(feedbackPromptIsDormant(used({ submittedAt: now - DAY }), now)).toBe(true);
    expect(feedbackPromptIsDormant(used({ submittedAt: now - FEEDBACK_QUIET_AFTER_SUBMIT_MS }), now)).toBe(false);
  });
  it("is false for a person who hasn't been asked yet", () => {
    expect(feedbackPromptIsDormant(FEEDBACK_PROMPT_DEFAULTS, now)).toBe(false);
  });
});

describe("shouldRunFeedbackTick", () => {
  const now = 500 * DAY;
  it("runs while usage is still being counted toward the first ask", () => {
    expect(shouldRunFeedbackTick(FEEDBACK_PROMPT_DEFAULTS, now)).toBe(true);
    expect(shouldRunFeedbackTick(used({ usedMs: FEEDBACK_FIRST_AFTER_USE_MS - 1 }), now)).toBe(true);
  });
  it("runs when the first ask is due but hasn't been shown (the person was busy)", () => {
    expect(shouldRunFeedbackTick(used(), now)).toBe(true);
  });
  it("does nothing between two asks, so nothing is rewritten for two weeks", () => {
    expect(shouldRunFeedbackTick(used({ lastShownAt: now - DAY }), now)).toBe(false);
    expect(shouldRunFeedbackTick(used({ lastShownAt: now - FEEDBACK_RESHOW_AFTER_MS }), now)).toBe(true);
  });
  it("does nothing when dormant", () => {
    expect(shouldRunFeedbackTick(used({ dismissals: 3 }), now)).toBe(false);
    expect(shouldRunFeedbackTick(used({ submittedAt: now - DAY }), now)).toBe(false);
  });
});

describe("mergeServerSubmission", () => {
  it("counts feedback this account sent from another device", () => {
    const merged = mergeServerSubmission(used(), "2026-11-01T10:00:00.000Z");
    expect(merged.submittedAt).toBe(Date.parse("2026-11-01T10:00:00.000Z"));
    expect(merged.usedMs).toBe(FEEDBACK_FIRST_AFTER_USE_MS);
  });
  it("keeps the later of the device's own time and the server's", () => {
    const later = Date.parse("2026-12-01T00:00:00Z");
    expect(mergeServerSubmission(used({ submittedAt: later }), "2026-11-01T10:00:00.000Z").submittedAt).toBe(later);
    expect(mergeServerSubmission(used({ submittedAt: 5 }), "2026-11-01T10:00:00.000Z").submittedAt).toBe(Date.parse("2026-11-01T10:00:00.000Z"));
  });
  it("ignores a missing or unreadable time", () => {
    const state = used();
    for (const bad of [null, undefined, "", "not a date", 42, {}]) expect(mergeServerSubmission(state, bad), String(bad)).toBe(state);
  });
});

describe("isBusyElement", () => {
  it("is busy for anything the person types into", () => {
    expect(isBusyElement({ tagName: "INPUT" })).toBe(true);
    expect(isBusyElement({ tagName: "textarea" })).toBe(true);
    expect(isBusyElement({ tagName: "SELECT" })).toBe(true);
    expect(isBusyElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("is not busy for a button, the page body or nothing", () => {
    expect(isBusyElement({ tagName: "BUTTON" })).toBe(false);
    expect(isBusyElement({ tagName: "BODY" })).toBe(false);
    expect(isBusyElement({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isBusyElement(null)).toBe(false);
    expect(isBusyElement(undefined)).toBe(false);
  });
});

describe("updateFeedbackPromptState: two tabs share one saved answer", () => {
  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("a tick in one tab no longer erases what the other tab saved", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    // Both tabs start from the same saved state.
    updateFeedbackPromptState(() => used());
    // Tab A: the person sends feedback.
    updateFeedbackPromptState((s) => markFeedbackSubmitted(s, 1000));
    // Tab B, which has been open all along, ticks: it adds usage to what is saved NOW, not to what it saw at the start.
    const afterB = updateFeedbackPromptState((s) => addFeedbackUsage(s, 15_000));
    expect(afterB.submittedAt).toBe(1000);
    expect(loadFeedbackPromptState().submittedAt).toBe(1000);
    expect(loadFeedbackPromptState().usedMs).toBe(FEEDBACK_FIRST_AFTER_USE_MS + 15_000);
  });

  it("dismissals from two tabs add up instead of overwriting each other", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    updateFeedbackPromptState(markFeedbackDismissed);
    updateFeedbackPromptState(markFeedbackDismissed);
    expect(loadFeedbackPromptState().dismissals).toBe(2);
  });

  it("works with storage missing or throwing", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(updateFeedbackPromptState((s) => addFeedbackUsage(s, 1000)).usedMs).toBe(1000);
    expect(FEEDBACK_PROMPT_STORAGE_KEY).toBe("ai-dj:feedback-prompt");
  });
});
