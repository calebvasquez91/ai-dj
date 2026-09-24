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

type StemName = "vocals" | "drums" | "bass" | "other";
const STEM_NAMES: readonly StemName[] = ["vocals", "drums", "bass", "other"];
const STEM_LABELS: Record<StemName, string> = { vocals: "Vocals", drums: "Drums", bass: "Bass", other: "Other" };

const POLL_INTERVAL_MS = 4000;

/**
 * Trigger + status + playback UI for real stem separation (see
 * src/app/api/tracks/[id]/stems/route.ts): once ready, lets you preview
 * each isolated stem alone, or play the other 3 mixed together in real
 * time (an on-demand "what does this sound like with the vocals/drums/
 * bass/other removed" check). Both are manual, popup-only previews —
 * deliberately not wired into the mixer/transition engine/Auto-DJ's actual
 * playback (see Vocal Layering in mix-engine.ts for the one place stems
 * *are* used automatically, during a transition). Only shown for local
 * tracks (YouTube tracks have no fetchable audio bytes to hand to
 * Replicate).
 */
export function SeparateStemsButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<StemJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // "Play with one stem removed": decodes the other 3 stems' real audio in
  // the browser and starts them together, in sync — an on-demand, in-app
  // way to hear a stem's absence, distinct from the per-stem <audio>
  // previews below (which play one stem alone, not the mix minus one).
  const [playingRemoved, setPlayingRemoved] = useState<StemName | null>(null);
  const [decodingRemoved, setDecodingRemoved] = useState<StemName | null>(null);
  const [mixError, setMixError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferCacheRef = useRef<Record<string, AudioBuffer>>({});
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  function stopMinusStemPlayback() {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped/ended — harmless.
      }
    }
    activeSourcesRef.current = [];
    setPlayingRemoved(null);
  }

  async function playMinusStem(removeStem: StemName) {
    if (!job) return;
    stopMinusStemPlayback();
    if (playingRemoved === removeStem) return; // clicking the active one again just stops it

    setMixError(null);
    setDecodingRemoved(removeStem);
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const urls: Record<StemName, string | null> = {
        vocals: job.vocalsUrl,
        drums: job.drumsUrl,
        bass: job.bassUrl,
        other: job.otherUrl,
      };
      const keep = STEM_NAMES.filter((s) => s !== removeStem);
      const buffers = await Promise.all(
        keep.map(async (stem) => {
          const url = urls[stem];
          if (!url) throw new Error(`Missing ${stem} stem.`);
          const cached = bufferCacheRef.current[url];
          if (cached) return cached;
          const res = await fetch(url);
          const arrayBuffer = await res.arrayBuffer();
          // The browser's own decoder handles whatever real format Replicate
          // returns (24-bit WAV) correctly — no manual byte-parsing needed.
          const buffer = await ctx.decodeAudioData(arrayBuffer);
          bufferCacheRef.current[url] = buffer;
          return buffer;
        })
      );

      const startAt = ctx.currentTime + 0.1; // small lookahead so all 3 truly start together
      const sources = buffers.map((buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(startAt);
        return source;
      });
      activeSourcesRef.current = sources;
      sources[0].onended = () => {
        // Only clear the "now playing" state if this is still the active
        // playback — a fast switch to a different stem already replaced it.
        if (activeSourcesRef.current.includes(sources[0])) stopMinusStemPlayback();
      };
      setPlayingRemoved(removeStem);
    } catch (err) {
      setMixError(err instanceof Error ? err.message : "Couldn't play that mix.");
    } finally {
      setDecodingRemoved(null);
    }
  }

  // Stop playback and free the AudioContext whenever the popup closes —
  // this is a temporary listening aid, not meant to keep running in the
  // background. Done from the actual close actions (below) rather than an
  // effect reacting to `open`, since triggering setState synchronously
  // from an effect body is exactly what react-hooks/set-state-in-effect
  // flags — closing is already an explicit event, so the cleanup belongs
  // right there.
  function closePopup() {
    stopMinusStemPlayback();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    bufferCacheRef.current = {};
    setOpen(false);
  }

  // Unmount-only cleanup (e.g. the row itself gets removed from the list)
  // still belongs in an effect's cleanup function — that's not the pattern
  // the lint rule is about.
  useEffect(() => {
    return () => {
      stopMinusStemPlayback();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopup();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        onClick={() => (open ? closePopup() : setOpen(true))}
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
              <div>
                <p className="text-xs text-muted mb-1">Play with a stem removed</p>
                <div className="grid grid-cols-2 gap-1">
                  {STEM_NAMES.map((stem) => (
                    <button
                      key={stem}
                      type="button"
                      onClick={() => playMinusStem(stem)}
                      disabled={decodingRemoved !== null && decodingRemoved !== stem}
                      className={`btn-outline text-xs py-1 ${playingRemoved === stem ? "bg-accent-purple/15 text-accent-purple" : ""}`}
                    >
                      {decodingRemoved === stem
                        ? "Loading…"
                        : playingRemoved === stem
                          ? `⏹ No ${STEM_LABELS[stem]}`
                          : `No ${STEM_LABELS[stem]}`}
                    </button>
                  ))}
                </div>
                {mixError && <p className="text-accent-pink text-[10px] mt-1">{mixError}</p>}
              </div>

              <p className="text-xs text-muted mb-0.5 mt-1">Or preview a single stem alone</p>
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
