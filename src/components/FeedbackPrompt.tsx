"use client";

import { useEffect, useRef } from "react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import {
  addFeedbackUsage,
  loadFeedbackPromptState,
  markFeedbackDismissed,
  markFeedbackShown,
  markFeedbackSubmitted,
  saveFeedbackPromptState,
  shouldShowFeedbackPrompt,
  type FeedbackPromptState,
} from "@/lib/feedbackPrompt";
import { useFeedbackUi } from "@/lib/feedbackUi";

const TICK_MS = 15_000;

/**
 * Mounted once in the app shell. It counts the time the app is open and visible on this device, brings the feedback
 * pop-up up by itself once the person has used it for a while (lib/feedbackPrompt.ts decides when), and renders the
 * pop-up for both that and the "Send feedback" entries in the menus. The music keeps playing underneath.
 */
export function FeedbackPrompt() {
  const open = useFeedbackUi((s) => s.open);
  const source = useFeedbackUi((s) => s.source);
  const openFeedback = useFeedbackUi((s) => s.openFeedback);
  const closeFeedback = useFeedbackUi((s) => s.closeFeedback);
  const stateRef = useRef<FeedbackPromptState | null>(null);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    stateRef.current = loadFeedbackPromptState();
    const id = setInterval(() => {
      const current = stateRef.current;
      if (!current) return;
      let next = current;
      if (document.visibilityState === "visible") next = addFeedbackUsage(next, TICK_MS);
      const now = Date.now();
      if (!openRef.current && document.visibilityState === "visible" && shouldShowFeedbackPrompt(next, now)) {
        next = markFeedbackShown(next, now);
        openFeedback("prompt");
      }
      stateRef.current = next;
      if (next !== current) saveFeedbackPromptState(next);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [openFeedback]);

  function update(change: (s: FeedbackPromptState) => FeedbackPromptState) {
    const next = change(stateRef.current ?? loadFeedbackPromptState());
    stateRef.current = next;
    saveFeedbackPromptState(next);
  }

  if (!open) return null;
  return (
    <FeedbackDialog
      onDismiss={() => {
        // Closing the pop-up that came up by itself counts toward the three-times limit; closing one the person asked for does not.
        if (source === "prompt") update(markFeedbackDismissed);
        closeFeedback();
      }}
      onSent={() => update((s) => markFeedbackSubmitted(s, Date.now()))}
      onClose={closeFeedback}
    />
  );
}
