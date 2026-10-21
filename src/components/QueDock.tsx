"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Que } from "@/components/Que";

/** The strip above the player bar that Que owns, in rem: his 40px stage plus a little air. Every overlay stops short of it (see --que-lane-h in globals.css). */
const QUE_LANE_REM = 2.75;

/**
 * Que, docked at the bottom-left just above the player bar.
 *
 * He used to be a child of the player bar, which is a stacking context of its own (backdrop-filter), so the dimming
 * layer behind the side panel, the decks, the mixer and the queue always painted over him. He is rendered here, outside
 * it, above every panel; and he reserves a lane (--que-lane-h) that the drawer and the bottom sheets are sized to stay
 * out of, so he is never covered and never covers a control. Hidden only while the full-screen now-playing view is up,
 * which shows its own Que.
 */
export function QueDock() {
  const hasTrack = useStore((s) => s.currentTrack != null);
  const nowPlayingExpanded = useStore((s) => s.nowPlayingExpanded);
  const show = hasTrack && !nowPlayingExpanded;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--que-lane-h", show ? `${QUE_LANE_REM}rem` : "0px");
    return () => {
      root.style.removeProperty("--que-lane-h");
    };
  }, [show]);

  if (!show) return null;
  return (
    <div className="fixed z-[60] left-[max(0.75rem,env(safe-area-inset-left))] bottom-[calc(var(--player-bar-h)+0.25rem)] max-w-[calc(100vw-1.5rem)]">
      <Que />
    </div>
  );
}
