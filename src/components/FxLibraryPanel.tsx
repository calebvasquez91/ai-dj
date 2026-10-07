"use client";

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { HALLOWEEN_AFFINITY, hasHalloweenAffinity, withHalloweenAffinity } from "@/lib/fxAffinity";
import { PlayIcon, PlusIcon, CloseIcon } from "@/components/Icons";
import { effectsPool } from "@/lib/spookyFx";
import type { FxCategory, FxSound } from "@/types/music";

const CATEGORY_FILTERS: { value: FxCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "transition", label: "Transitions" },
  { value: "loop", label: "Loops" },
  { value: "effect", label: "Effects" },
  { value: "background", label: "Background" },
  { value: "vocal", label: "Vocal" },
];

const PREVIEW_MAX_SEC = 5;

function parseFxFileName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "");
}

/** Auto FX: fire an effect by itself when the playing track's energy enters a peak or a valley (lib/autoFx.ts). Off by default; the choice is saved in this browser. */
function AutoFxControls() {
  const autoFx = useStore((s) => s.autoFx);
  const setAutoFx = useStore((s) => s.setAutoFx);
  const fxLibrary = useStore((s) => s.fxLibrary);
  const effects = useMemo(() => effectsPool(fxLibrary), [fxLibrary]);
  const selectClass = "min-w-0 flex-1 text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1.5 outline-none";
  const options = (
    <>
      <option value="none">None</option>
      <option value="random">Random effect</option>
      {effects.map((fx) => (
        <option key={fx.id} value={fx.id}>
          {fx.name}
        </option>
      ))}
    </>
  );
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/10 p-2">
      <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={autoFx.enabled}
          onChange={(e) => setAutoFx({ enabled: e.target.checked })}
          className="mt-0.5 accent-accent-purple"
        />
        <span>
          Auto FX at energy peaks &amp; valleys
          <span className="block text-[10px]">Plays an effect when a track&apos;s energy rises into a peak or drops into a valley (see the Energy graph on the decks).</span>
        </span>
      </label>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 min-w-0 flex-col gap-0.5 text-[10px] text-muted">
          Peak
          <select value={autoFx.peakFx} onChange={(e) => setAutoFx({ peakFx: e.target.value })} aria-label="Effect for energy peaks" className={selectClass}>
            {options}
          </select>
        </label>
        <label className="flex flex-1 min-w-0 flex-col gap-0.5 text-[10px] text-muted">
          Valley
          <select value={autoFx.valleyFx} onChange={(e) => setAutoFx({ valleyFx: e.target.value })} aria-label="Effect for energy valleys" className={selectClass}>
            {options}
          </select>
        </label>
      </div>
    </div>
  );
}

/** The FX Library tab inside QueuePanel — upload, browse/filter/search, preview, and hand-edit metadata for FX sounds (spec #1-3, #6). */
export function FxLibraryPanel() {
  const fxLibrary = useStore((s) => s.fxLibrary);
  const fxLibraryLoaded = useStore((s) => s.fxLibraryLoaded);
  const uploadFxSound = useStore((s) => s.uploadFxSound);
  const updateFxSound = useStore((s) => s.updateFxSound);
  const patchFxSoundLocal = useStore((s) => s.patchFxSoundLocal);
  const persistFxSound = useStore((s) => s.persistFxSound);
  const removeFxSound = useStore((s) => s.removeFxSound);

  const [categoryFilter, setCategoryFilter] = useState<FxCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // On by default: Spooky Music only draws FX tagged spooky/halloween, so an
  // untagged upload would silently never play there. Lives in the store so
  // it isn't reset when this panel remounts on a tab switch.
  const tagForSpooky = useStore((s) => s.tagNewFxForSpooky);
  const setTagForSpooky = useStore((s) => s.setTagNewFxForSpooky);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  // Raw in-progress text for the tags input, keyed by fx id — lets the user
  // type a trailing comma/space without it being immediately re-split and
  // re-joined out from under their cursor. Cleared once persisted on blur.
  const [tagsDraft, setTagsDraft] = useState<Record<string, string>>({});
  // Same shape as tagsDraft, for the playlistAffinity input.
  const [affinityDraft, setAffinityDraft] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fxLibrary.filter((fx) => {
      if (categoryFilter !== "all" && fx.category !== categoryFilter) return false;
      if (!q) return true;
      return fx.name.toLowerCase().includes(q) || fx.tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [fxLibrary, categoryFilter, search]);

  // Bulk actions below apply to what's currently shown (category filter + search).
  const untaggedShown = useMemo(() => filtered.filter((fx) => !hasHalloweenAffinity(fx.playlistAffinity)), [filtered]);
  const [bulkBusy, setBulkBusy] = useState(false);

  /** PATCHes each target (a few at a time, so a big library doesn't fire hundreds of requests at once). updateFxSound never throws — failures roll back that one row and surface a sync error. */
  async function applyToShown(targets: FxSound[], patchFor: (fx: FxSound) => Partial<Pick<FxSound, "category" | "playlistAffinity">>) {
    setBulkBusy(true);
    try {
      const queue = [...targets];
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, async () => {
          for (let fx = queue.shift(); fx; fx = queue.shift()) await updateFxSound(fx.id, patchFor(fx));
        })
      );
    } finally {
      setBulkBusy(false);
    }
  }

  function handleBulkCategory(category: FxCategory) {
    const targets = filtered.filter((fx) => fx.category !== category);
    if (targets.length === 0) return;
    const label = CATEGORY_FILTERS.find((f) => f.value === category)?.label ?? category;
    if (!window.confirm(`Change ${targets.length} sound${targets.length === 1 ? "" : "s"} to ${label}?`)) return;
    void applyToShown(targets, () => ({ category }));
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadFxSound(file, {
          name: parseFxFileName(file.name),
          category: "effect",
          playlistAffinity: tagForSpooky ? HALLOWEEN_AFFINITY : [],
        });
      }
    } catch (err) {
      // Without a catch a failed upload (e.g. a 500) was an unhandled promise
      // rejection and the user saw nothing happen.
      setUploadError(err instanceof Error ? err.message : "FX upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function stopPreview() {
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setPreviewingId(null);
  }

  function playPreview(fx: FxSound) {
    stopPreview();
    const audio = new Audio(fx.sourceUrl);
    audio.volume = 0.8;
    previewAudioRef.current = audio;
    setPreviewingId(fx.id);
    void audio.play().catch(() => stopPreview());
    previewTimeoutRef.current = setTimeout(stopPreview, PREVIEW_MAX_SEC * 1000);
    audio.addEventListener("ended", stopPreview, { once: true });
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => void handleFilesSelected(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn !text-xs flex items-center gap-1.5 w-full justify-center"
        >
          <PlusIcon size={14} />
          {uploading ? "Uploading…" : "Upload FX sound"}
        </button>
      </div>

      <label className="flex items-start gap-2 px-1 text-xs text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={tagForSpooky}
          onChange={(e) => setTagForSpooky(e.target.checked)}
          className="mt-0.5 accent-accent-purple"
        />
        <span>
          Use new uploads in Spooky Music 🎃
          <span className="block text-[10px]">Tags them &quot;spooky, halloween&quot; so Spooky Music can pick them.</span>
        </span>
      </label>

      <AutoFxControls />

      {uploadError && (
        <p role="alert" className="px-1 text-xs text-accent-pink break-words">
          {uploadError}
        </p>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or tag…"
        className="w-full rounded-lg bg-surface-hover border border-border/10 px-3 py-2 text-xs outline-none focus:border-accent-purple"
      />

      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setCategoryFilter(f.value)}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              categoryFilter === f.value
                ? "bg-accent-purple/20 border-accent-purple text-accent-purple"
                : "border-border/10 text-muted hover:border-accent-purple/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {fxLibrary.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={bulkBusy || untaggedShown.length === 0}
            onClick={() =>
              void applyToShown(untaggedShown, (fx) => ({ playlistAffinity: withHalloweenAffinity(fx.playlistAffinity) }))
            }
            className="btn !text-xs"
            title="Adds the spooky + halloween tags to every sound currently shown that doesn't have one"
          >
            {bulkBusy
              ? "Saving…"
              : untaggedShown.length === 0
                ? "All shown are in Spooky Music 🎃"
                : `Add ${untaggedShown.length} shown to Spooky Music 🎃`}
          </button>
          <select
            value=""
            disabled={bulkBusy || filtered.length === 0}
            onChange={(e) => e.target.value && handleBulkCategory(e.target.value as FxCategory)}
            aria-label="Set the category of every shown sound"
            className="text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1.5 outline-none"
          >
            <option value="">Set category of {filtered.length} shown…</option>
            {CATEGORY_FILTERS.filter((f) => f.value !== "all").map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {!fxLibraryLoaded ? (
        <p className="px-1 text-xs text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="px-1 text-xs text-muted">
          {fxLibrary.length === 0 ? "No FX sounds yet — upload one above." : "No FX match this filter/search."}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((fx) => (
            <div
              key={fx.id}
              className="flex flex-col gap-1.5 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover border border-transparent hover:border-border/10"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (previewingId === fx.id ? stopPreview() : playPreview(fx))}
                  className="btn-icon text-accent-teal hover:text-accent-purple shrink-0"
                  title={previewingId === fx.id ? "Stop preview" : "Preview (5s)"}
                >
                  <PlayIcon size={14} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words line-clamp-2" title={fx.name}>
                    {fx.name}
                  </p>
                  {/* Badge + length live under the name (not beside it) so a
                      narrow panel gives the name the full row instead of
                      squeezing it down to a few letters. */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="shrink-0 text-[10px] leading-none px-1.5 py-1 rounded-full bg-accent-teal/20 text-accent-teal font-medium capitalize">
                      {fx.category}
                    </span>
                    <span className="text-xs text-muted shrink-0">{formatTime(fx.durationSec)}</span>
                    <span className="text-xs text-muted break-all line-clamp-1 min-w-0" title={fx.fileName}>
                      {fx.fileName}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeFxSound(fx.id)}
                  title="Delete FX"
                  className="btn-icon text-muted hover:text-accent-pink shrink-0"
                >
                  <CloseIcon size={14} />
                </button>
              </div>

              <div className="flex items-center gap-1.5 pl-7 flex-wrap">
                <select
                  value={fx.category}
                  onChange={(e) => void updateFxSound(fx.id, { category: e.target.value as FxCategory })}
                  className="text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
                >
                  {CATEGORY_FILTERS.filter((f) => f.value !== "all").map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  value={fx.bpm ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    patchFxSoundLocal(fx.id, { bpm: e.target.value === "" ? undefined : Number.isFinite(n) ? n : fx.bpm });
                  }}
                  onBlur={() => void persistFxSound(fx.id)}
                  placeholder="BPM"
                  inputMode="decimal"
                  className="w-14 text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
                />
                <input
                  value={fx.key ?? ""}
                  onChange={(e) => patchFxSoundLocal(fx.id, { key: e.target.value || undefined })}
                  onBlur={() => void persistFxSound(fx.id)}
                  placeholder="Key"
                  className="w-14 text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
                />
                <input
                  value={tagsDraft[fx.id] ?? fx.tags.join(", ")}
                  onChange={(e) => {
                    setTagsDraft((d) => ({ ...d, [fx.id]: e.target.value }));
                    patchFxSoundLocal(fx.id, {
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                  }}
                  onBlur={() => {
                    setTagsDraft((d) => {
                      const next = { ...d };
                      delete next[fx.id];
                      return next;
                    });
                    void persistFxSound(fx.id);
                  }}
                  placeholder="tags (comma-separated)"
                  className="flex-1 min-w-24 text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
                />
                <input
                  value={affinityDraft[fx.id] ?? fx.playlistAffinity.join(", ")}
                  onChange={(e) => {
                    setAffinityDraft((d) => ({ ...d, [fx.id]: e.target.value }));
                    patchFxSoundLocal(fx.id, {
                      playlistAffinity: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                  }}
                  onBlur={() => {
                    setAffinityDraft((d) => {
                      const next = { ...d };
                      delete next[fx.id];
                      return next;
                    });
                    void persistFxSound(fx.id);
                  }}
                  title="Which themed playlists/modes this FX is eligible for — e.g. spooky, halloween. Drives AI transition-FX matching and the Spooky Music ambient layer while that playlist is active."
                  placeholder="playlist affinity (e.g. spooky, halloween)"
                  className="flex-1 min-w-32 text-[10px] rounded bg-surface-hover border border-border/10 px-1.5 py-1 outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
