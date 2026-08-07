"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function KeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const state = useStore.getState();

      switch (e.key) {
        case " ":
          if (!state.currentTrack) return;
          e.preventDefault();
          state.togglePlay();
          break;
        case "ArrowRight":
          if (!state.currentTrack) return;
          e.preventDefault();
          state.next();
          break;
        case "ArrowLeft":
          if (!state.currentTrack) return;
          e.preventDefault();
          state.previous();
          break;
        case "m":
        case "M":
          if (!state.currentTrack || state.queue.length === 0) return;
          e.preventDefault();
          state.requestMixNow();
          break;
        case "q":
        case "Q":
          e.preventDefault();
          state.toggleQueuePanel();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
