/**
 * Local "learns as it goes" adaptation: a small, deterministic weight per
 * transition category, nudged by explicit user overrides (a manual pick
 * that differs from what auto-scoring would have chosen, a reroll away
 * from a suggestion) and fed back into mix-engine.ts's scoring as one more
 * additive term — the same shape as MODE_CATEGORY_BIAS, just tuned by the
 * user's own behavior instead of a fixed preset. No ML/training involved:
 * every nudge is a small, bounded, fully-inspectable number change.
 *
 * Persisted to this browser's localStorage only — there is no server-side
 * concept of these weights, and they intentionally don't follow the user
 * across devices. Kept as its own store (not merged into the main
 * useStore in store.ts) so the main store's shape and in-memory-only
 * behavior stay exactly as they were.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TransitionCategory } from "@/data/transitions";

const MIN_WEIGHT = -15;
const MAX_WEIGHT = 15;

/** Applied to the category the user manually picked/kept, when it differs from what auto-scoring would have chosen. */
export const LEARNING_NUDGE_UP = 2;
/** Applied to the category auto-scoring would have chosen but the user overrode away from. */
export const LEARNING_NUDGE_DOWN = -1;

export interface WeightsState {
  categoryWeights: Partial<Record<TransitionCategory, number>>;
  nudge: (category: TransitionCategory, delta: number) => void;
  reset: () => void;
}

function clampWeight(value: number): number {
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, value));
}

function createWeightsState(
  set: (fn: (s: WeightsState) => Partial<WeightsState>) => void
): WeightsState {
  return {
    categoryWeights: {},
    nudge: (category, delta) =>
      set((s) => ({
        categoryWeights: {
          ...s.categoryWeights,
          [category]: clampWeight((s.categoryWeights[category] ?? 0) + delta),
        },
      })),
    reset: () => set(() => ({ categoryWeights: {} })),
  };
}

// zustand's persist middleware warns on every write when its storage is
// unavailable (e.g. `window` doesn't exist, as in the Vitest/Node test
// environment) rather than just silently skipping persistence — so persist
// is only applied in a real browser, keeping test output clean while
// behaving identically in-memory either way.
export const useDjWeights =
  typeof window !== "undefined"
    ? create<WeightsState>()(
        persist(
          (set) => createWeightsState(set),
          {
            name: "ai-dj:transition-weights",
            storage: createJSONStorage(() => window.localStorage),
          }
        )
      )
    : create<WeightsState>()((set) => createWeightsState(set));
