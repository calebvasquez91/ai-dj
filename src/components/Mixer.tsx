"use client";

import { useStore } from "@/lib/store";
import { ChannelStrip } from "@/components/ChannelStrip";
import { Crossfader } from "@/components/Crossfader";

/**
 * A live, read-only view of the AI's own mixing — the low-EQ cut, filter
 * sweep, output level, and crossfader position DualDeckStage.tsx's real
 * transition automation is actually driving, for both decks side by side.
 * Nothing here is user-adjustable; the user's only input into a mix is Mix
 * Now or the Auto-DJ toggle.
 */
export function Mixer() {
  const open = useStore((s) => s.mixerPanelOpen);
  const toggle = useStore((s) => s.toggleMixerPanel);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={toggle} aria-hidden="true" />
      <div className="fixed inset-x-4 bottom-32 md:bottom-24 z-50 mx-auto max-w-3xl max-h-[70vh] overflow-y-auto rounded-2xl bg-surface p-4 flex flex-col gap-4 shadow-elevate-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-sm heading">Mixer</h2>
          <button
            type="button"
            onClick={toggle}
            className="btn-icon text-accent-purple hover:text-accent-pink text-lg leading-none"
            title="Close"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-muted -mt-2">
          A live view of the AI&apos;s own mixing — press Mix Now or turn on Auto-DJ to watch the crossfader, filter,
          and EQ move on their own. Nothing here is draggable.
        </p>
        <div className="flex flex-wrap items-start justify-center gap-4">
          <ChannelStrip deckId="A" />
          <ChannelStrip deckId="B" />
        </div>
        <Crossfader />
      </div>
    </>
  );
}
