import { create } from "zustand";

/** Whether the feedback pop-up is open, and why: "prompt" = it came up by itself, "menu" = the person asked for it. */
export type FeedbackSource = "prompt" | "menu";

interface FeedbackUiState {
  open: boolean;
  source: FeedbackSource | null;
  openFeedback: (source: FeedbackSource) => void;
  closeFeedback: () => void;
}

export const useFeedbackUi = create<FeedbackUiState>((set) => ({
  open: false,
  source: null,
  openFeedback: (source) => set((s) => (s.open ? s : { open: true, source })),
  closeFeedback: () => set({ open: false, source: null }),
}));
