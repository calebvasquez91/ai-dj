"use client";

import { useStore } from "@/lib/store";
import { AMBIENCE_MAX_LEVEL, FX_MAX_LEVEL } from "@/lib/layerMix";

/**
 * "Halloween Layers" mini mixer for the DJ Decks panel — only shown while
 * Spooky Music is the active theme. Three sliders:
 *  - Music: the master output level (the same control as the player bar's
 *    volume slider — it also scales the two layers below, since they all
 *    share one master gain).
 *  - Ambience: the background loop's base level (0–0.5, default 0.25)
 *    before it ducks under busy parts and transitions.
 *  - FX: how loud transition FX are (0–1, default 0.7).
 * Ambience and FX apply to the live audio immediately (see DualDeckStage).
 */
export function HalloweenLayers() {
  const spooky = useStore((s) => s.activePlaylistTheme === "spooky");
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const ambienceLevel = useStore((s) => s.ambienceLevel);
  const setAmbienceLevel = useStore((s) => s.setAmbienceLevel);
  const fxLevel = useStore((s) => s.fxLevel);
  const setFxLevel = useStore((s) => s.setFxLevel);

  if (!spooky) return null;

  return (
    <section
      aria-label="Halloween Layers"
      className="rounded-xl bg-surface-hover px-3 py-2 flex flex-col gap-1.5"
    >
      <h3 className="text-xs font-semibold" style={{ color: "#ff8a3d" }}>
        🎃 Halloween Layers
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
        <LayerSlider
          label="Music"
          title="Master volume — the same as the player bar's slider, so it scales the layers too"
          value={volume}
          max={1}
          onChange={setVolume}
        />
        <LayerSlider
          label="Ambience"
          title="Background loop volume (0–0.5)"
          value={ambienceLevel}
          max={AMBIENCE_MAX_LEVEL}
          onChange={setAmbienceLevel}
        />
        <LayerSlider
          label="FX"
          title="Transition FX volume"
          value={fxLevel}
          max={FX_MAX_LEVEL}
          onChange={setFxLevel}
        />
      </div>
    </section>
  );
}

function LayerSlider({
  label,
  title,
  value,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted min-w-0" title={title}>
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} volume`}
        className="flex-1 min-w-0 accent-accent-purple"
      />
      <span className="w-8 shrink-0 text-right tabular-nums">{value.toFixed(2)}</span>
    </label>
  );
}
