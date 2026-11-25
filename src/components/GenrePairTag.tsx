"use client";

import { GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import { planMatchesPair } from "@/lib/genrePlanApply";
import { useStore } from "@/lib/store";

/** The genre pair of the mix in progress, for the "Mixing into" pill: " · Hip-Hop → R&B". Nothing while the feature is off or no plan was made for this pair. */
export function GenrePairTag() {
  const genrePlan = useStore((s) => s.genrePlan);
  const currentId = useStore((s) => s.currentTrack?.id);
  const nextId = useStore((s) => s.queue[0]?.id);
  if (!GENRE_TRANSITIONS_ENABLED || !currentId || !nextId || !planMatchesPair(genrePlan, currentId, nextId)) return null;
  const { a, b } = genrePlan!.plan.genrePair;
  return <span className="font-normal opacity-80"> · {a} &rarr; {b}</span>;
}
