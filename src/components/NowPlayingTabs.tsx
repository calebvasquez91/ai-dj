"use client";

import { useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { DeckView } from "@/components/DeckView";
import { DjControls } from "@/components/DjControls";
import { Mixer } from "@/components/Mixer";
import { QueueBody } from "@/components/QueuePanel";
import { moveTab, swipeDelta } from "@/lib/tabSwipe";

const TABS = ["queue", "dj", "chat"] as const;
type NowPlayingTab = (typeof TABS)[number];
const LABEL: Record<NowPlayingTab, string> = { queue: "Queue", dj: "DJ", chat: "Chat" };

/** Where a swipe must not switch the tab: controls that are dragged sideways themselves. */
const NO_SWIPE = "input, select, textarea, canvas, [role=slider], [data-no-swipe]";

/**
 * The Now Playing sheet's three sections: Queue (the queue, with the AI's pick and the "Mixing into" pill), DJ (the DJ
 * controls, the deck board and the mixer, the same ones as the overlays) and Chat (the AI DJ). Tap a tab, press the
 * arrow keys on the tab bar, or swipe the panel. Queue and DJ are only mounted while shown (they recompute as the music
 * plays), and only while the sheet is open (`active`): a closed sheet must not keep the deck board and the mixer
 * re-rendering behind it. Chat stays mounted so its conversation survives a trip to another tab or a closed sheet.
 */
export function NowPlayingTabs({ active }: { active: boolean }) {
  const [tab, setTab] = useState<NowPlayingTab>("queue");
  const start = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="w-full">
      <div
        role="tablist"
        aria-label="Now Playing sections"
        className="flex border-b border-border-subtle"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const next = moveTab(TABS, tab, e.key === "ArrowRight" ? 1 : -1);
          setTab(next);
          document.getElementById(`np-tab-${next}`)?.focus();
        }}
      >
        {TABS.map((id) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              id={`np-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`np-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              className={`relative min-h-11 flex-1 text-sm font-semibold transition-colors ${selected ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {LABEL[id]}
              {selected && <span aria-hidden="true" className="accent-gradient absolute inset-x-6 bottom-0 h-0.5 rounded-full" />}
            </button>
          );
        })}
      </div>

      <div
        className="pt-4"
        onTouchStart={(e) => {
          start.current = (e.target as Element).closest(NO_SWIPE) ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const from = start.current;
          start.current = null;
          if (!from) return;
          const delta = swipeDelta(e.changedTouches[0].clientX - from.x, e.changedTouches[0].clientY - from.y);
          if (delta !== 0) setTab((current) => moveTab(TABS, current, delta));
        }}
      >
        {active && tab === "queue" && (
          <div id="np-panel-queue" role="tabpanel" aria-labelledby="np-tab-queue" className="flex flex-col">
            <QueueBody />
          </div>
        )}
        {active && tab === "dj" && (
          <div id="np-panel-dj" role="tabpanel" aria-labelledby="np-tab-dj" className="flex flex-col gap-6">
            <DjControls />
            <DeckView embedded />
            <Mixer embedded />
          </div>
        )}
        <div id="np-panel-chat" role="tabpanel" aria-labelledby="np-tab-chat" hidden={tab !== "chat"}>
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
