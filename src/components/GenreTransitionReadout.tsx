"use client";

import { GENRE_TRANSITIONS_ENABLED } from "@/lib/featureFlags";
import { planMatchesPair } from "@/lib/genrePlanApply";
import { useStore } from "@/lib/store";

const DECIDED: Record<string, string> = { local: "DJ", claude: "DJ (asked Claude)", "local-fallback": "DJ (Claude did not answer in time)" };

/**
 * The DJ board's readout of the genre-aware plan for the next mix: the genre pair, the style and tools chosen, the audio engineer's mixability score,
 * what it vetoed, and the reason ("Hip-Hop to R&B: quick-cut with echo-out. Reason: tempo gap of 14 BPM."). Renders nothing while the feature is off or
 * no plan has been made for the pair that is up next.
 */
export function GenreTransitionReadout() {
  const genrePlan = useStore((s) => s.genrePlan);
  const currentId = useStore((s) => s.currentTrack?.id);
  const nextId = useStore((s) => s.queue[0]?.id);
  if (!GENRE_TRANSITIONS_ENABLED || !currentId || !nextId || !planMatchesPair(genrePlan, currentId, nextId)) return null;
  const p = genrePlan!;
  const { plan } = p;
  return (
    <section className="card p-3 flex flex-col gap-1.5" aria-label="Genre-aware transition">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">Genre-aware transition</h3>
      <p className="text-sm break-words">{p.readout}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">Genres</dt>
        <dd>{plan.genrePair.a} → {plan.genrePair.b}</dd>
        <dt className="text-muted">Style</dt>
        <dd>{plan.style}{plan.bars > 0 ? `, ${plan.bars} bars` : ""}{plan.keepSync ? ", beat-synced" : ""}</dd>
        <dt className="text-muted">Tools</dt>
        <dd>{plan.tools.length > 0 ? plan.tools.join(", ") : "none"}</dd>
        <dt className="text-muted">Engineer</dt>
        <dd>mixability {p.mixability.toFixed(2)}{p.vetoes.length > 0 ? `; vetoed ${p.vetoes.map((v) => `${v.style} (${v.reason})`).join(", ")}` : "; no vetoes"}</dd>
        <dt className="text-muted">Chosen by</dt>
        <dd>{DECIDED[p.decidedBy] ?? p.decidedBy}</dd>
      </dl>
    </section>
  );
}
