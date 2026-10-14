/**
 * The one-line "Stems: …" status the Stems panel leads with, so it is always clear whether stems are on, how many are
 * ready, whether something is separating, and — when it can't work here — why. Pure; the panel only renders it.
 */

export interface StemCounts {
  ready: number;
  inFlight: number;
  failed: number;
}

export interface StemStatusInput {
  enabled: boolean;
  /** The autopilot's own state (see StemAutopilotStatus). */
  state: "off" | "idle" | "working" | "paused" | "unavailable";
  /** Why it is paused / unavailable. */
  message: string | null;
  /** Library-wide job counts; null until the summary has loaded. */
  counts: StemCounts | null;
}

export interface StemHeadline {
  label: string;
  /** Detail shown beneath the label, when there is something to explain. */
  detail: string | null;
  tone: "off" | "ok" | "busy" | "warn";
}

function readyPart(counts: StemCounts | null): string | null {
  if (!counts) return null;
  return counts.ready > 0 ? `${counts.ready} ready` : "none ready yet";
}

export function describeStemStatus({ enabled, state, message, counts }: StemStatusInput): StemHeadline {
  // Unavailable beats everything: the switch can't do anything on this server.
  if (state === "unavailable") {
    return { label: "Stems: unavailable here", detail: message, tone: "warn" };
  }
  const parts: string[] = [];
  if (state === "working") {
    const n = counts?.inFlight ?? 0;
    parts.push(n > 0 ? `separating ${n}…` : "separating…");
  } else if (state === "paused") {
    parts.push("paused");
  } else {
    parts.push(enabled ? "on" : "off");
  }
  const ready = readyPart(counts);
  if (ready) parts.push(ready);
  if (counts && counts.failed > 0) parts.push(`${counts.failed} failed`);

  if (state === "paused") return { label: `Stems: ${parts.join(" · ")}`, detail: message, tone: "warn" };
  if (state === "working") return { label: `Stems: ${parts.join(" · ")}`, detail: null, tone: "busy" };
  if (!enabled) {
    return {
      label: `Stems: ${parts.join(" · ")}`,
      detail: "Automatic separation is off. Switch it on and the app makes stems for the tracks the DJ picks.",
      tone: "off",
    };
  }
  return { label: `Stems: ${parts.join(" · ")}`, detail: null, tone: "ok" };
}
