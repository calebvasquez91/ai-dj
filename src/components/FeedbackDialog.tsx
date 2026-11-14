"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { StarIcon } from "@/components/Icons";
import { FEEDBACK_MAX_COMMENT, FEEDBACK_MAX_RATING, RATING_LABELS } from "@/lib/feedback";
import { cycleFocus } from "@/lib/focusTrap";

type Status = "idle" | "sending" | "sent";

/** How long to wait for the server before telling the person it is taking too long. */
const SEND_TIMEOUT_MS = 15_000;
/** What can take focus inside the pop-up: buttons that aren't disabled or skipped by the star group's roving tab stop, and the comment box. */
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled)';

/**
 * The feedback pop-up: a 1-5 star rating and an optional comment ("is there anything you'd like us to fix?"), sent to
 * POST /api/feedback, which emails the developer. `onDismiss` = closed without sending; `onSent` = it went through.
 */
export function FeedbackDialog({
  onDismiss,
  onSent,
  onClose,
  returnFocusTo = null,
}: {
  onDismiss: () => void;
  onSent: () => void;
  onClose: () => void;
  /** Where focus goes on close when the control that opened the pop-up won't still be on screen (the phone's account menu). */
  returnFocusTo?: HTMLElement | null;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const commentId = useId();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus moves into the pop-up when it opens and goes back when it closes: to the control it was told about, or else to
  // whatever had focus when the pop-up opened (when that is still on screen). The target is read once, as it opens.
  const returnFocusRef = useRef(returnFocusTo);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const target = returnFocusRef.current;
    dialogRef.current?.focus();
    return () => {
      if (target && document.contains(target)) target.focus();
      else if (before && before !== document.body && document.contains(before)) before.focus();
    };
  }, []);

  // Tab and Shift+Tab stay inside the pop-up (it is modal: the page behind it is not reachable).
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const next = cycleFocus(items, document.activeElement, e.shiftKey);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  // Escape closes it, as "maybe later" before it was sent and as a plain close after.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (status === "sent") onClose();
      else if (status === "idle") onDismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [status, onClose, onDismiss]);

  const shown = hover || rating;

  function onStarKeyDown(e: React.KeyboardEvent, value: number) {
    let next = value;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(FEEDBACK_MAX_RATING, value + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = FEEDBACK_MAX_RATING;
    else return;
    e.preventDefault();
    setRating(next);
    starRefs.current[next - 1]?.focus();
  }

  async function send() {
    if (rating < 1 || status !== "idle") return;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, comment, page: pathname }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Couldn't send your feedback. Please try again.");
      }
      setStatus("sent");
      onSent();
    } catch (err) {
      setStatus("idle");
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("That's taking longer than expected. Please try again in a moment.");
      } else {
        setError(err instanceof Error ? err.message : "Couldn't send your feedback. Please try again.");
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onClick={() => (status === "sent" ? onClose() : status === "idle" ? onDismiss() : undefined)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="bg-surface shadow-elevate-lg rounded-2xl p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto flex flex-col gap-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {status === "sent" ? (
          <>
            <h2 id={titleId} className="text-lg heading">
              Thank you!
            </h2>
            <p className="text-sm text-muted" role="status">
              Your feedback went straight to the developer. It really helps.
            </p>
            <button type="button" onClick={onClose} className="btn self-end">
              Close
            </button>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 id={titleId} className="text-lg heading">
                  How are you liking AI DJ?
                </h2>
                <p className="text-sm text-muted">Tap a star to rate it.</p>
              </div>
              <button type="button" onClick={onDismiss} className="btn-icon text-muted hover:text-foreground" title="Close" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div role="radiogroup" aria-label="Rating out of 5 stars" className="flex gap-1" onMouseLeave={() => setHover(0)}>
                {Array.from({ length: FEEDBACK_MAX_RATING }, (_, i) => i + 1).map((value) => (
                  <button
                    key={value}
                    ref={(el) => {
                      starRefs.current[value - 1] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={rating === value}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    tabIndex={rating === value || (rating === 0 && value === 1) ? 0 : -1}
                    onClick={() => setRating(value)}
                    onMouseEnter={() => setHover(value)}
                    onKeyDown={(e) => onStarKeyDown(e, value)}
                    className={`p-1 rounded-md transition-transform hover:scale-110 ${value <= shown ? "text-accent-pink" : "text-muted"}`}
                  >
                    <StarIcon size={34} filled={value <= shown} />
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted h-4" aria-live="polite">
                {RATING_LABELS[shown]}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={commentId} className="text-sm">
                Is there anything you&apos;d like us to fix or improve? <span className="text-muted">(optional)</span>
              </label>
              <textarea
                id={commentId}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={FEEDBACK_MAX_COMMENT}
                rows={4}
                placeholder="Bugs, ideas, anything that bugged you…"
                className="w-full rounded-xl bg-surface-raised border border-border-subtle px-3 py-2 text-sm outline-none focus:border-accent-purple resize-y"
              />
              <span className="text-[11px] text-muted self-end">
                {comment.length}/{FEEDBACK_MAX_COMMENT}
              </span>
            </div>

            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onDismiss} disabled={status === "sending"} className="btn-outline">
                Maybe later
              </button>
              <button type="button" onClick={send} disabled={rating < 1 || status === "sending"} className="btn">
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
