"use client";

import { useStore } from "@/lib/store";
import { genreFamilies } from "@/data/styles";
import type { DjSetMode } from "@/lib/mix-engine";
import { CROSSFADE_PRESETS, DJ_MODES } from "@/components/PlayerBar";

const SELECT_CLASS = "min-h-11 w-full rounded-full bg-surface-raised px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-accent";

/**
 * The DJ's main controls, for the Now Playing sheet's DJ tab: FX, Mix Now and Auto-DJ, and the three settings that steer
 * the mix (set mode, style, crossfade length). On a tablet or desktop the player bar carries these too; on a phone the
 * player bar is a compact mini player, so this is where they live.
 */
export function DjControls() {
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const isTransitioning = useStore((s) => s.isTransitioning);
  const requestMixNow = useStore((s) => s.requestMixNow);
  const requestFx = useStore((s) => s.requestFx);
  const fxLayerActive = useStore((s) => s.fxLayerActive);
  const autoDjEnabled = useStore((s) => s.autoDjEnabled);
  const setAutoDj = useStore((s) => s.setAutoDj);
  const djMode = useStore((s) => s.djMode);
  const setDjMode = useStore((s) => s.setDjMode);
  const styleGenreHint = useStore((s) => s.styleGenreHint);
  const setStyleGenreHint = useStore((s) => s.setStyleGenreHint);
  const crossfadeOverrideSec = useStore((s) => s.crossfadeOverrideSec);
  const setCrossfadeOverride = useStore((s) => s.setCrossfadeOverride);
  const analyzingTrackIds = useStore((s) => s.analyzingTrackIds);
  const nextTrackAnalyzing = queue[0] ? analyzingTrackIds.has(queue[0].id) : false;

  return (
    <section className="flex flex-col gap-3" aria-label="DJ controls">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => requestFx()}
          aria-pressed={fxLayerActive}
          className="btn-outline min-h-11 justify-center"
          data-active={fxLayerActive}
          title={fxLayerActive ? "FX playing — press again to stop it" : "Play a random sound from your FX Library's Effects category"}
        >
          FX
        </button>
        <button
          type="button"
          onClick={requestMixNow}
          disabled={!currentTrack || queue.length === 0 || isTransitioning || nextTrackAnalyzing}
          className="btn-outline min-h-11 justify-center"
          title={nextTrackAnalyzing ? "Analyzing next track's beat/tempo…" : "Beatmatch and mix into the next queued track now (M)"}
        >
          {isTransitioning ? "Mixing…" : nextTrackAnalyzing ? "Analyzing…" : "Mix Now"}
        </button>
        <button
          type="button"
          onClick={() => setAutoDj(!autoDjEnabled)}
          aria-pressed={autoDjEnabled}
          data-active={autoDjEnabled}
          className="btn-outline min-h-11 justify-center"
          title="Toggle automatic DJ transitions"
        >
          Auto-DJ {autoDjEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Set mode
          <select
            value={djMode}
            onChange={(e) => setDjMode(e.target.value as DjSetMode)}
            title="DJ set mode — biases which transition techniques get chosen"
            className={SELECT_CLASS}
          >
            {DJ_MODES.map((m) => (
              <option key={m.id} value={m.id} title={m.title}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Style
          <select
            value={styleGenreHint ?? "auto"}
            onChange={(e) => setStyleGenreHint(e.target.value === "auto" ? null : e.target.value)}
            title="Style influence for chosen transitions"
            className={SELECT_CLASS}
          >
            <option value="auto">Style: Auto</option>
            {genreFamilies.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Crossfade
          <select
            value={crossfadeOverrideSec ?? "auto"}
            onChange={(e) => setCrossfadeOverride(e.target.value === "auto" ? null : Number(e.target.value))}
            title="Crossfade length"
            className={SELECT_CLASS}
          >
            <option value="auto">Auto</option>
            {CROSSFADE_PRESETS.map((sec) => (
              <option key={sec} value={sec}>
                {sec}s
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
