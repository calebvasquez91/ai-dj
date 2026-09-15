"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "@/lib/store";

/** How long the reaction bounce plays — matches the CSS animation duration in globals.css. */
const REACT_DURATION_MS = 650;
/** How long the "why" pill stays up before self-dismissing if the user doesn't close it first. */
const PILL_AUTO_DISMISS_MS = 6000;
/** N64-viseme-style mouth swap rate while Que is "talking" (the why pill is up). */
const TALK_FRAME_MS = 150;

/**
 * Que — the AI DJ's visible presence. Not a trained model or an LLM: it
 * reacts to the exact same explicit BPM/key/genre/persona/learned-weight
 * scoring that already picks every transition (mix-engine.ts, dj-weights.ts)
 * — Que is a face on that existing logic, not a new one. Idle, it just
 * breathes; the instant a transition is chosen, it bounces and a short
 * "why" pill appears next to it, both driven by the same
 * activeTransitionShortWhy field DualDeckStage sets/clears alongside
 * DeckView's longer rationale (see mix-engine.ts's shortWhy).
 *
 * Redrawn as a flat SVG "robotic helmet" (gradient shell, glass visor, an
 * LED-style eyes/mouth face, over-ear cups, trim rings, a status light) per
 * the 2026 design refresh — deliberately kept as inline SVG rather than a
 * 3D/WebGL character: Que renders on nearly every route (docked in
 * PlayerBar) and occasionally twice at once (PlayerBar + Home hero), so a
 * WebGL context per instance would be a real, mostly-invisible-to-the-user
 * cost for a decorative badge. Same silhouette/palette/face-state ideas as
 * the 3D reference, same animation budget as the previous SVG.
 *
 * `welcomeMessage` is for spots with no transition to react to yet (the
 * Home page greeting) — it seeds the same pill, with the same dismiss
 * button and auto-fade, rather than a second UI element. A real
 * transition reason still takes over normally if one ever fires here too.
 *
 * `size` lets a spot with more room (Home) show Que bigger than the
 * docked PlayerBar badge — purely a scale of the same SVG, same
 * animations (their transform-origins are in the SVG's own viewBox units,
 * unaffected by the rendered pixel size).
 */
export function Que({ welcomeMessage, size = 32 }: { welcomeMessage?: string; size?: number } = {}) {
  const shortWhy = useStore((s) => s.activeTransitionShortWhy);
  const [reacting, setReacting] = useState(false);
  const [pillText, setPillText] = useState<string | null>(welcomeMessage ?? null);
  const [pillDismissed, setPillDismissed] = useState(false);
  const [talkFrame, setTalkFrame] = useState(0);
  const seenShortWhy = useRef<string | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PlayerBar and Home can both render Que on screen at once (a track can
  // be playing while browsing Home) — unique per-instance gradient ids so
  // one <svg>'s <defs> never gets shadowed by another's identical id.
  const gradientId = useId();
  const bodyGradId = `que-body-grad-${gradientId}`;
  const ringGradId = `que-ring-grad-${gradientId}`;

  useEffect(() => {
    if (!welcomeMessage) return;
    autoDismissTimer.current = setTimeout(() => setPillDismissed(true), PILL_AUTO_DISMISS_MS);
    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
    // Deliberately mount-only — a static greeting fades once, it doesn't
    // restart if the string reference happens to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // "Talking" — the mouth swaps between two drawn shapes for as long as
  // the why-pill is up, then holds the idle mouth. Plain setInterval
  // rather than a CSS animation since it needs to start/stop on exactly
  // the pill's own lifecycle (see globals.css's note on .talking).
  useEffect(() => {
    if (!showPill) {
      // Resets the mouth to idle the instant the pill closes — not
      // derivable at render time since it has to win over whatever frame
      // the interval below last left it on.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTalkFrame(0);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => setTalkFrame((f) => (f === 0 ? 1 : 0)), TALK_FRAME_MS);
    return () => clearInterval(id);
  }, [showPill]);

  // Que's own footprint scaled up a bit, floored/ceilinged for readability
  // at either extreme — the docked 32px badge and the ~96px Home hero are
  // very different contexts, but neither should show a bubble that dwarfs
  // the character standing next to it.
  const bubbleMaxWidth = Math.min(260, Math.max(110, size * 2.2));

  return (
    <div className="flex items-start gap-2 flex-wrap">
      <div
        className={`que-stage${reacting ? " reacting" : ""}${showPill ? " talking" : ""}`}
        style={{ width: size + 8, height: size + 8 }}
        title="Que — the AI DJ"
      >
        <svg viewBox="0 0 84 84" width={size} height={size} fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={bodyGradId} x1="14" y1="13" x2="70" y2="78" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--accent-teal-bright)" />
              <stop offset="1" stopColor="var(--accent-purple)" />
            </linearGradient>
            <linearGradient id={ringGradId} x1="12" y1="14" x2="72" y2="78" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--accent-purple-bright)" />
              <stop offset="1" stopColor="var(--accent-pink)" />
            </linearGradient>
          </defs>

          <circle className="que-ring" cx="42" cy="46" r="34" fill="none" stroke={`url(#${ringGradId})`} strokeWidth="2" />

          {/* Over-ear cups, drawn under the shell so it reads as embedded. */}
          <g className="que-band">
            <circle cx="8.5" cy="45" r="8.5" fill="#241a33" />
            <circle cx="8.5" cy="45" r="8.5" fill="none" stroke="var(--accent-pink)" strokeWidth="1.8" />
            <circle cx="8.5" cy="45" r="3.4" fill="#180f26" />
            <circle cx="75.5" cy="45" r="8.5" fill="#241a33" />
            <circle cx="75.5" cy="45" r="8.5" fill="none" stroke="var(--accent-purple-bright)" strokeWidth="1.8" />
            <circle cx="75.5" cy="45" r="3.4" fill="#180f26" />
          </g>

          <g className="que-body">
            {/* Shell — a rounded-helmet silhouette, not a plain circle. */}
            <path
              d="M 24 18 C 14 19, 8 30, 8 42 C 8 55, 14 66, 26 74 Q 42 80, 58 74 C 70 66, 76 55, 76 42 C 76 30, 70 19, 60 18 Q 42 13, 24 18 Z"
              fill={`url(#${bodyGradId})`}
            />
            <ellipse cx="27" cy="26" rx="13" ry="7" fill="#fff" opacity="0.16" />

            <path d="M 16 28 Q 42 21, 68 28" stroke="var(--accent-purple-bright)" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.95" />
            <path d="M 21 67 Q 42 73.5, 63 67" stroke="var(--accent-pink)" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.95" />

            {/* Visor — glass over the LED face. */}
            <path
              d="M 20 32 C 15 40, 15 53, 22 61 Q 42 69, 62 61 C 69 53, 69 40, 64 32 Q 42 26, 20 32 Z"
              fill="#0a0713"
              opacity="0.48"
            />

            <circle cx="62" cy="25" r="2.1" fill="var(--accent-yellow)" />

            {/* Eyes — each an independent group so blink squashes each about its own center. */}
            <g className="que-eye que-led" style={{ transformOrigin: "28.8px 44.3px" }} fill="#cffff4">
              <rect x="26.5" y="37.5" width="4.6" height="4.6" rx="1.2" />
              <rect x="22" y="42" width="4.6" height="4.6" rx="1.2" />
              <rect x="31" y="42" width="4.6" height="4.6" rx="1.2" />
              <rect x="26.5" y="46.5" width="4.6" height="4.6" rx="1.2" />
            </g>
            <g className="que-eye que-led" style={{ transformOrigin: "57.5px 44.3px" }} fill="#cffff4">
              <rect x="52.9" y="37.5" width="4.6" height="4.6" rx="1.2" />
              <rect x="48.4" y="42" width="4.6" height="4.6" rx="1.2" />
              <rect x="57.4" y="42" width="4.6" height="4.6" rx="1.2" />
              <rect x="52.9" y="46.5" width="4.6" height="4.6" rx="1.2" />
            </g>

            {/* Mouth — idle smile, or a two-frame open/closed talk cycle while the pill is up. */}
            {showPill && talkFrame === 1 ? (
              <g className="que-led" fill="#cffff4">
                <rect x="33" y="56" width="4.6" height="4.6" rx="1.2" />
                <rect x="38.7" y="56" width="4.6" height="4.6" rx="1.2" />
                <rect x="44.4" y="56" width="4.6" height="4.6" rx="1.2" />
                <rect x="33" y="60.6" width="4.6" height="4.6" rx="1.2" />
                <rect x="38.7" y="60.6" width="4.6" height="4.6" rx="1.2" />
                <rect x="44.4" y="60.6" width="4.6" height="4.6" rx="1.2" />
              </g>
            ) : (
              <g className="que-led" fill="#cffff4">
                <rect x="30.5" y="55" width="4.6" height="4.6" rx="1.2" />
                <rect x="37.7" y="58.5" width="4.6" height="4.6" rx="1.2" />
                <rect x="44.9" y="58.5" width="4.6" height="4.6" rx="1.2" />
                <rect x="49.1" y="55" width="4.6" height="4.6" rx="1.2" />
              </g>
            )}
          </g>
        </svg>
      </div>
      {showPill && (
        <button
          type="button"
          onClick={() => setPillDismissed(true)}
          className="que-why-pill"
          style={{ maxWidth: bubbleMaxWidth }}
          title="Dismiss"
        >
          {pillText}
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
