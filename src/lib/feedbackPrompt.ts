/**
 * When the feedback pop-up appears by itself. Kept per device in localStorage (like the Auto FX and Song Sync settings),
 * with the account's last submission folded in from the server so answering on one device quiets the others. Pure where
 * it can be, so the rules are tested; components/FeedbackPrompt.tsx runs them.
 *
 *   - Not until the person has really used the app: a few minutes with the page open and visible.
 *   - Not while they are typing, or another dialog is open: it waits for a calmer moment.
 *   - Then once; if they close it without answering, again after two weeks, and never after the third time.
 *   - After they send feedback (on any device), not for three months.
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

/** True when the pop-up should come up now (not counting whether the person is busy; see isBusyElement). */
export function shouldShowFeedbackPrompt(state: FeedbackPromptState, nowMs: number): boolean {
  if (state.submittedAt !== null && nowMs - state.submittedAt < FEEDBACK_QUIET_AFTER_SUBMIT_MS) return false;
  if (state.dismissals >= FEEDBACK_MAX_DISMISSALS) return false;
  if (state.usedMs < FEEDBACK_FIRST_AFTER_USE_MS) return false;
  if (state.lastShownAt !== null && nowMs - state.lastShownAt < FEEDBACK_RESHOW_AFTER_MS) return false;
  return true;
}

/** True when nothing will bring the pop-up up for a long while (feedback sent recently, or closed three times), so the timer need not run at all. */
export function feedbackPromptIsDormant(state: FeedbackPromptState, nowMs: number): boolean {
  if (state.dismissals >= FEEDBACK_MAX_DISMISSALS) return true;
  return state.submittedAt !== null && nowMs - state.submittedAt < FEEDBACK_QUIET_AFTER_SUBMIT_MS;
}

/**
 * Whether a tick has anything to do: counting usage toward the first ask, or deciding on a re-ask. Between two asks
 * (the pop-up was shown lately, usage already counted) a tick would only rewrite the same state.
 */
export function shouldRunFeedbackTick(state: FeedbackPromptState, nowMs: number): boolean {
  if (feedbackPromptIsDormant(state, nowMs)) return false;
  if (state.usedMs < FEEDBACK_FIRST_AFTER_USE_MS) return true;
  return state.lastShownAt === null || nowMs - state.lastShownAt >= FEEDBACK_RESHOW_AFTER_MS;
}

export const addFeedbackUsage = (state: FeedbackPromptState, ms: number): FeedbackPromptState => ({ ...state, usedMs: state.usedMs + Math.max(0, ms) });
export const markFeedbackShown = (state: FeedbackPromptState, nowMs: number): FeedbackPromptState => ({ ...state, lastShownAt: nowMs });
export const markFeedbackDismissed = (state: FeedbackPromptState): FeedbackPromptState => ({ ...state, dismissals: state.dismissals + 1 });
export const markFeedbackSubmitted = (state: FeedbackPromptState, nowMs: number): FeedbackPromptState => ({ ...state, submittedAt: nowMs });

/**
 * Folds in what the server knows: the time of this account's latest feedback (from GET /api/feedback). Feedback sent on
 * another device counts here too, so the person isn't asked again on this one. Keeps the later of the two times.
 */
export function mergeServerSubmission(state: FeedbackPromptState, lastSentAtIso: unknown): FeedbackPromptState {
  if (typeof lastSentAtIso !== "string") return state;
  const at = Date.parse(lastSentAtIso);
  if (!Number.isFinite(at)) return state;
  if (state.submittedAt !== null && state.submittedAt >= at) return state;
  return { ...state, submittedAt: at };
}

/** An element the person is typing into (or about to): the pop-up must not take focus from it. */
export function isBusyElement(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

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

/**
 * Reads the saved state fresh, applies one change and saves it. Every change goes through here rather than through a
 * copy kept in memory, so two tabs of the app never overwrite each other's saved answer with a stale one.
 */
export function updateFeedbackPromptState(change: (state: FeedbackPromptState) => FeedbackPromptState): FeedbackPromptState {
  const next = change(loadFeedbackPromptState());
  saveFeedbackPromptState(next);
  return next;
}
