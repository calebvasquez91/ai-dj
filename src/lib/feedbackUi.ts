import { create } from "zustand";

/** Whether the feedback pop-up is open, and why: "prompt" = it came up by itself, "menu" = the person asked for it. */
export type FeedbackSource = "prompt" | "menu";

interface FeedbackUiState {
  open: boolean;
  source: FeedbackSource | null;
  /**
   * Where keyboard focus goes when the pop-up closes, when the control that opened it won't still be on screen. The
   * phone's account menu closes itself as it opens the pop-up, taking its "Send feedback" item with it, so it passes
   * its own button here. Without one, focus goes back to whatever had it when the pop-up opened.
   */
  returnFocusTo: HTMLElement | null;
  openFeedback: (source: FeedbackSource, returnFocusTo?: HTMLElement | null) => void;
  closeFeedback: () => void;
}

export const useFeedbackUi = create<FeedbackUiState>((set) => ({
  open: false,
  source: null,
  returnFocusTo: null,
  openFeedback: (source, returnFocusTo = null) => set((s) => (s.open ? s : { open: true, source, returnFocusTo })),
  closeFeedback: () => set({ open: false, source: null, returnFocusTo: null }),
}));
