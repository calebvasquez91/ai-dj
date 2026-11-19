"use client";

import { create } from "zustand";
import { DJ_MOVE_DEFAULTS, loadDjMoveSettings, saveDjMoveSettings, type DjMoveSettings } from "@/lib/djMoveSettings";

export type DjMoveKind = "eq" | "stutter" | "scratch" | "echoOut" | "bridge";

interface DjMovesState {
  settings: DjMoveSettings;
  /** Set once the browser's saved settings have been read (they cannot be on the server). */
  loaded: boolean;
  /** The latest planned move of each kind, with its reason, for the DJ readout ("energy 0.82, 128 BPM, drop in 4 bars"). Null until one is planned. */
  readout: Record<DjMoveKind, string | null>;
  load: () => void;
  update: (patch: Partial<DjMoveSettings>) => void;
  setReadout: (kind: DjMoveKind, text: string | null) => void;
}

export const useDjMoves = create<DjMovesState>((set, get) => ({
  settings: DJ_MOVE_DEFAULTS,
  loaded: false,
  readout: { eq: null, stutter: null, scratch: null, echoOut: null, bridge: null },
  load: () => {
    if (get().loaded) return;
    set({ settings: loadDjMoveSettings(), loaded: true });
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    saveDjMoveSettings(next);
  },
  setReadout: (kind, text) => {
    if (get().readout[kind] !== text) set({ readout: { ...get().readout, [kind]: text } });
  },
}));
