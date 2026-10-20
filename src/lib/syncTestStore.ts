import { create } from "zustand";
import type { PairResult } from "@/lib/syncTest";

/**
 * The sync test suite's run state, read by the panel on the DJ board. Separate from the player's store on purpose: it
 * is a developer tool's bookkeeping, and the runner (lib/syncTestRunner.ts) keeps going when the board is closed.
 * Written only by the runner.
 */

export type SyncTestPhase = "idle" | "running" | "done" | "failed";

export interface SyncTestState {
  phase: SyncTestPhase;
  /** What the runner is doing right now, one line. */
  label: string;
  stepsDone: number;
  stepsTotal: number;
  pairs: PairResult[];
  /** The automatic fixes tried, in words (also written to the exported log). */
  fixLog: string[];
  fixing: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  cancelRequested: boolean;
  patch: (patch: Partial<Omit<SyncTestState, "patch">>) => void;
}

export const useSyncTestStore = create<SyncTestState>()((set) => ({
  phase: "idle",
  label: "",
  stepsDone: 0,
  stepsTotal: 0,
  pairs: [],
  fixLog: [],
  fixing: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  cancelRequested: false,
  patch: (patch) => set(patch),
}));
