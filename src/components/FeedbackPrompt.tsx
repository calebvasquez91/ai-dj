"use client";

import { useEffect, useRef } from "react";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import {
  addFeedbackUsage,
  feedbackPromptIsDormant,
  isBusyElement,
  loadFeedbackPromptState,
  markFeedbackDismissed,
  markFeedbackShown,
  markFeedbackSubmitted,
  mergeServerSubmission,
  saveFeedbackPromptState,
  shouldRunFeedbackTick,
  shouldShowFeedbackPrompt,
  updateFeedbackPromptState,
} from "@/lib/feedbackPrompt";
import { useFeedbackUi } from "@/lib/feedbackUi";

const TICK_MS = 15_000;

/** True when something is in the way of a pop-up taking focus: the person is typing, or another dialog is open. */
function userIsBusy(): boolean {
  return isBusyElement(document.activeElement as HTMLElement | null) || document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
}

/**
 * Mounted once in the app shell. It counts the time the app is open and visible on this device, brings the feedback
 * pop-up up by itself once the person has used it for a while and isn't busy (lib/feedbackPrompt.ts decides when), and
 * renders the pop-up for both that and the "Send feedback" entries in the menus. The music keeps playing underneath.
 *
 * The saved state is read fresh on every tick and every change (never kept in memory), so two open tabs can't overwrite
 * each other's answer; and the timer isn't started at all for a person who has answered lately or closed it three times.
 */
export function FeedbackPrompt() {
  const open = useFeedbackUi((s) => s.open);
  const source = useFeedbackUi((s) => s.source);
  const returnFocusTo = useFeedbackUi((s) => s.returnFocusTo);
  const openFeedback = useFeedbackUi((s) => s.openFeedback);
  const closeFeedback = useFeedbackUi((s) => s.closeFeedback);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (feedbackPromptIsDormant(loadFeedbackPromptState(), Date.now())) return; // nothing will ever bring it up: no timer
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    function tick() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const current = loadFeedbackPromptState();
      if (feedbackPromptIsDormant(current, now)) {
        stop(); // answered (here or in another tab) since this started
        return;
      }
      if (!shouldRunFeedbackTick(current, now)) return; // between two asks: nothing to count or decide
      let next = addFeedbackUsage(current, TICK_MS);
      if (!openRef.current && shouldShowFeedbackPrompt(next, now) && !userIsBusy()) {
        next = markFeedbackShown(next, now);
        saveFeedbackPromptState(next);
        openFeedback("prompt");
        return;
      }
      saveFeedbackPromptState(next);
    }
    timer = setInterval(tick, TICK_MS);

    // Has this account already sent feedback, from another device? One small request per page load.
    fetch("/api/feedback", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { lastSentAt?: unknown } | null) => {
        if (cancelled || !data) return;
        const merged = updateFeedbackPromptState((s) => mergeServerSubmission(s, data.lastSentAt));
        if (feedbackPromptIsDormant(merged, Date.now())) stop();
      })
      .catch(() => {
        // the server can't tell us (offline, not set up yet): rely on this device's own record
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [openFeedback]);

  if (!open) return null;
  return (
    <FeedbackDialog
      onDismiss={() => {
        // Closing the pop-up that came up by itself counts toward the three-times limit; closing one the person asked for does not.
        if (source === "prompt") updateFeedbackPromptState(markFeedbackDismissed);
        closeFeedback();
      }}
      onSent={() => updateFeedbackPromptState((s) => markFeedbackSubmitted(s, Date.now()))}
      onClose={closeFeedback}
      returnFocusTo={returnFocusTo}
    />
  );
}
