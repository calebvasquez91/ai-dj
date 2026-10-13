"use client";

import { useMemo } from "react";
import { energyProfileFromPeaks, energyZones } from "@/lib/energyProfile";

/**
 * Mini energy graph shown above a deck's waveform: the track's energy across its length (lib/energyProfile.ts), with
 * peaks (pink) and valleys (teal) marked so you can see them coming, and a playhead. Renders nothing for a track with
 * no usable waveform data, or one too flat to have peaks and valleys.
 */
export function EnergyGraph({ peaks, progressRatio }: { peaks: number[]; progressRatio?: number }) {
  const profile = useMemo(() => energyProfileFromPeaks(peaks), [peaks]);
  // The bars depend only on the profile; the playhead moves several times a second, so it is drawn outside this memo.
  // Bar height is the real energy; the colour is the zone (a peak is the track's loudest fifth, a valley its quietest).
  const bars = useMemo(
    () => {
      const zones = energyZones(profile);
      return profile.map((value, i) => {
        const zone = zones[i];
        const height = Math.max(0.6, value * 20);
        return (
          <rect
            key={i}
            x={i}
            y={20 - height}
            width={0.9}
            height={height}
            style={{
              fill: zone === "peak" ? "var(--accent-pink)" : zone === "valley" ? "var(--accent-teal)" : "var(--accent-purple)",
              opacity: zone === "mid" ? 0.45 : 0.95,
            }}
          />
        );
      });
    },
    [profile]
  );
  if (profile.length === 0) return null;
  const playhead = progressRatio != null && Number.isFinite(progressRatio) ? Math.min(1, Math.max(0, progressRatio)) * profile.length : null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="uppercase tracking-wide">Energy</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-accent-pink" /> peaks
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-accent-teal" /> valleys
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${profile.length} 20`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Energy across the track: peaks in pink, valleys in teal"
        className="h-6 w-full rounded-sm bg-surface-hover"
      >
        {bars}
        {playhead != null && <rect x={playhead} y={0} width={0.6} height={20} style={{ fill: "var(--foreground)" }} />}
      </svg>
    </div>
  );
}
