import { describe, expect, it } from "vitest";
import {
  FEEDBACK_FIRST_AFTER_USE_MS,
  FEEDBACK_MAX_DISMISSALS,
  FEEDBACK_PROMPT_DEFAULTS,
  FEEDBACK_QUIET_AFTER_SUBMIT_MS,
  FEEDBACK_RESHOW_AFTER_MS,
  addFeedbackUsage,
  markFeedbackDismissed,
  markFeedbackShown,
  markFeedbackSubmitted,
  parseFeedbackPromptState,
  shouldShowFeedbackPrompt,
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
