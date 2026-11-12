/**
 * When the feedback pop-up appears by itself. Kept per device in localStorage (like the Auto FX and Song Sync settings):
 * it is a nudge, not account data. Pure, so the rules are tested; components/FeedbackPrompt.tsx runs them.
 *
 *   - Not until the person has really used the app: a few minutes with the page open and visible.
 *   - Then once; if they close it without answering, again after two weeks, and never after the third time.
 *   - After they send feedback, not for three months.
 * The "Send feedback" entry in the menus works at any time and is not governed by any of this.
 */

export interface FeedbackPromptState {
  /** Milliseconds the app has been open and visible on this device. */
  usedMs: number;
  lastShownAt: number | null;
  /** Times the pop-up was closed without sending anything. */
  dismissals: number;
  submittedAt: number | null;
}

export const FEEDBACK_PROMPT_STORAGE_KEY = "ai-dj:feedback-prompt";
export const FEEDBACK_FIRST_AFTER_USE_MS = 5 * 60 * 1000;
export const FEEDBACK_RESHOW_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const FEEDBACK_QUIET_AFTER_SUBMIT_MS = 90 * 24 * 60 * 60 * 1000;
export const FEEDBACK_MAX_DISMISSALS = 3;

export const FEEDBACK_PROMPT_DEFAULTS: FeedbackPromptState = { usedMs: 0, lastShownAt: null, dismissals: 0, submittedAt: null };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Reads saved state back, falling back field by field to the defaults for anything missing or the wrong type. */
export function parseFeedbackPromptState(raw: string | null): FeedbackPromptState {
  if (!raw) return FEEDBACK_PROMPT_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof FeedbackPromptState, unknown>> | null;
    if (!value || typeof value !== "object") return FEEDBACK_PROMPT_DEFAULTS;
    return {
      usedMs: finite(value.usedMs) ? value.usedMs : 0,
      lastShownAt: finite(value.lastShownAt) ? value.lastShownAt : null,
      dismissals: finite(value.dismissals) ? Math.floor(value.dismissals) : 0,
      submittedAt: finite(value.submittedAt) ? value.submittedAt : null,
    };
  } catch {
    return FEEDBACK_PROMPT_DEFAULTS;
  }
}

/** True when the pop-up should come up now. */
export function shouldShowFeedbackPrompt(state: FeedbackPromptState, nowMs: number): boolean {
  if (state.submittedAt !== null && nowMs - state.submittedAt < FEEDBACK_QUIET_AFTER_SUBMIT_MS) return false;
  if (state.dismissals >= FEEDBACK_MAX_DISMISSALS) return false;
  if (state.usedMs < FEEDBACK_FIRST_AFTER_USE_MS) return false;
  if (state.lastShownAt !== null && nowMs - state.lastShownAt < FEEDBACK_RESHOW_AFTER_MS) return false;
  return true;
}

export const addFeedbackUsage = (state: FeedbackPromptState, ms: number): FeedbackPromptState => ({ ...state, usedMs: state.usedMs + Math.max(0, ms) });
export const markFeedbackShown = (state: FeedbackPromptState, nowMs: number): FeedbackPromptState => ({ ...state, lastShownAt: nowMs });
export const markFeedbackDismissed = (state: FeedbackPromptState): FeedbackPromptState => ({ ...state, dismissals: state.dismissals + 1 });
export const markFeedbackSubmitted = (state: FeedbackPromptState, nowMs: number): FeedbackPromptState => ({ ...state, submittedAt: nowMs });

/** Browser-only; localStorage can be missing or throw (private windows, blocked storage), so both directions fail soft. */
export function loadFeedbackPromptState(): FeedbackPromptState {
  try {
    return parseFeedbackPromptState(window.localStorage.getItem(FEEDBACK_PROMPT_STORAGE_KEY));
  } catch {
    return FEEDBACK_PROMPT_DEFAULTS;
  }
}

export function saveFeedbackPromptState(state: FeedbackPromptState): void {
  try {
    window.localStorage.setItem(FEEDBACK_PROMPT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // not persisted this time; the pop-up logic still works for this page load
  }
}
