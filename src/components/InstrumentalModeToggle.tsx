"use client";

import { VOCAL_SPLIT_ENABLED } from "@/lib/featureFlags";
import { useStore } from "@/lib/store";

/**
 * "Instrumental mode" on Now Playing: play the vocal-free mix instead of the full song. Available only once the playing song's separation has finished (its
 * instrumental is built); until then the switch is off and says why. It takes effect from the next song to load. Renders nothing while VOCAL_SPLIT_ENABLED is off.
 * The instrumental is for listening inside the app: there is no download, export or share of it anywhere.
 */
export function InstrumentalModeToggle() {
  const mode = useStore((s) => s.instrumentalMode);
  const setMode = useStore((s) => s.setInstrumentalMode);
  const ready = useStore((s) => (s.currentTrack ? Boolean(s.instrumentalAvailability[s.currentTrack.id]) : false));
  const anyReady = useStore((s) => Object.keys(s.instrumentalAvailability).length > 0);
  if (!VOCAL_SPLIT_ENABLED) return null;
  const note = !anyReady ? "No song has been separated yet." : ready ? "From the next song." : "This song has not finished separating, so it plays in full.";
  return (
    <section className="card p-3" aria-label="Instrumental mode">
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span>
        Instrumental mode
        <span className="block text-xs text-muted">{note}</span>
      </span>
      <input type="checkbox" checked={mode} disabled={!anyReady} onChange={(e) => setMode(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" aria-label="Instrumental mode" />
    </label>
    </section>
  );
}
