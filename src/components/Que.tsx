"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** How long the reaction bounce plays — matches the CSS animation duration in globals.css. */
const REACT_DURATION_MS = 650;
/** How long the "why" pill stays up before self-dismissing if the user doesn't close it first. */
const PILL_AUTO_DISMISS_MS = 6000;

/**
 * Que — the AI DJ's visible presence. Not a trained model or an LLM: it
 * reacts to the exact same explicit BPM/key/genre/persona/learned-weight
 * scoring that already picks every transition (mix-engine.ts, dj-weights.ts)
 * — Que is a face on that existing logic, not a new one. Idle, it just
 * breathes; the instant a transition is chosen, it bounces and a short
 * "why" pill appears next to it, both driven by the same
 * activeTransitionShortWhy field DualDeckStage sets/clears alongside
 * DeckView's longer rationale (see mix-engine.ts's shortWhy).
 */
export function Que() {
  const shortWhy = useStore((s) => s.activeTransitionShortWhy);
  const [reacting, setReacting] = useState(false);
  const [pillText, setPillText] = useState<string | null>(null);
  const [pillDismissed, setPillDismissed] = useState(false);
  const seenShortWhy = useRef<string | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shortWhy) {
      seenShortWhy.current = null;
      return;
    }
    if (shortWhy === seenShortWhy.current) return;
    seenShortWhy.current = shortWhy;

    setReacting(true);
    setPillText(shortWhy);
    setPillDismissed(false);
    const bounceTimer = setTimeout(() => setReacting(false), REACT_DURATION_MS);

    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    autoDismissTimer.current = setTimeout(() => setPillDismissed(true), PILL_AUTO_DISMISS_MS);

    return () => clearTimeout(bounceTimer);
  }, [shortWhy]);

  useEffect(() => {
    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
  }, []);

  const showPill = Boolean(pillText) && !pillDismissed;

  return (
    <div className="flex items-center gap-2">
      <div className={`que-stage${reacting ? " reacting" : ""}`} title="Que — the AI DJ">
        <svg viewBox="0 0 84 84" width="32" height="32" fill="none" aria-hidden="true">
          <circle className="que-ring" cx="42" cy="48" r="20" fill="none" stroke="url(#queRingGrad)" strokeWidth="2" />
          <g className="que-band">
            <path d="M 22 33 A 20 20 0 0 1 62 33" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" fill="none" />
            <circle cx="22" cy="33" r="3.5" fill="var(--muted)" />
            <circle cx="62" cy="33" r="3.5" fill="var(--muted)" />
          </g>
          <g className="que-body">
            <circle cx="42" cy="48" r="23" fill="url(#queBodyGrad)" />
            <ellipse className="que-eye" cx="34" cy="46" rx="2.5" ry="3.5" fill="var(--foreground)" />
            <ellipse className="que-eye" cx="50" cy="46" rx="2.5" ry="3.5" fill="var(--foreground)" />
          </g>
          <defs>
            <linearGradient id="queBodyGrad" x1="20" y1="28" x2="64" y2="70" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--accent-teal-bright)" />
              <stop offset="1" stopColor="var(--accent-purple)" />
            </linearGradient>
            <linearGradient id="queRingGrad" x1="22" y1="28" x2="62" y2="68" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--accent-purple-bright)" />
              <stop offset="1" stopColor="var(--accent-pink)" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      {showPill && (
        <button type="button" onClick={() => setPillDismissed(true)} className="que-why-pill" title="Dismiss">
          {pillText}
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
