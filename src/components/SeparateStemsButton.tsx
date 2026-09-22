"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "@/types/music";

/** Mirrors the API's StemSeparationJob JSON shape — a plain client-side type rather than importing Prisma's generated type into browser code. */
interface StemJob {
  id: string;
  status: "pending" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  predictTimeSec: number | null;
  estimatedCostUsd: number | null;
  vocalsUrl: string | null;
  drumsUrl: string | null;
  bassUrl: string | null;
  otherUrl: string | null;
}

const POLL_INTERVAL_MS = 4000;

/**
 * Minimal trigger + status + playback UI for real stem separation (see
 * src/app/api/tracks/[id]/stems/route.ts). Deliberately not wired into the
 * mixer/transition engine/Auto-DJ yet — this is just "prove the pipeline
 * produces clean, correctly-synced stems," per the current scope. Only
 * shown for local tracks (YouTube tracks have no fetchable audio bytes to
 * hand to Replicate).
 */
export function SeparateStemsButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<StemJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  // Poll while a job is in flight, only while the panel is open.
  useEffect(() => {
    if (!open || !job || (job.status !== "pending" && job.status !== "processing")) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/tracks/${track.id}/stems`);
      if (res.ok) setJob(await res.json());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [open, job, track.id]);

  // Check for an existing job (from a previous visit) as soon as the panel opens.
  useEffect(() => {
    if (!open || job) return;
    (async () => {
      const res = await fetch(`/api/tracks/${track.id}/stems`);
      if (res.ok) setJob(await res.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function startSeparation() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/tracks/${track.id}/stems`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setFetchError(body.error ?? "Failed to start stem separation.");
        return;
      }
      setJob(body);
    } finally {
      setLoading(false);
    }
  }

  if (track.source !== "local") return null;

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-icon text-muted hover:text-accent-purple text-sm leading-none"
        title="Separate into vocals/drums/bass/other stems"
      >
        🎚️
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-xl bg-surface shadow-elevate-lg p-3 text-sm">
          <p className="font-semibold mb-2">Stem Separation</p>

          {fetchError && <p className="text-accent-pink text-xs mb-2">{fetchError}</p>}

          {!job && (
            <button
              type="button"
              onClick={startSeparation}
              disabled={loading}
              className="btn-outline w-full text-xs"
            >
              {loading ? "Starting…" : "Separate Stems"}
            </button>
          )}

          {job && (job.status === "pending" || job.status === "processing") && (
            <p className="text-xs text-muted">Separating stems… this can take a minute or more.</p>
          )}

          {job && job.status === "failed" && (
            <>
              <p className="text-xs text-accent-pink mb-2">{job.errorMessage ?? "Separation failed."}</p>
              <button type="button" onClick={startSeparation} disabled={loading} className="btn-outline w-full text-xs">
                {loading ? "Retrying…" : "Retry"}
              </button>
            </>
          )}

          {job && job.status === "ready" && (
            <div className="flex flex-col gap-2">
              {([
                ["Vocals", job.vocalsUrl],
                ["Drums", job.drumsUrl],
                ["Bass", job.bassUrl],
                ["Other", job.otherUrl],
              ] as const).map(([label, url]) =>
                url ? (
                  <div key={label}>
                    <p className="text-xs text-muted mb-0.5">{label}</p>
                    <audio controls src={url} className="w-full h-8" />
                  </div>
                ) : null
              )}
              {job.predictTimeSec != null && (
                <p className="text-[10px] text-muted mt-1">
                  {job.predictTimeSec.toFixed(1)}s compute
                  {job.estimatedCostUsd != null && ` · ~$${job.estimatedCostUsd.toFixed(4)} (estimated)`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
