"use client";

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { PlayIcon, PlusIcon, CloseIcon } from "@/components/Icons";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  // Raw in-progress text for the tags input, keyed by fx id — lets the user
  // type a trailing comma/space without it being immediately re-split and
  // re-joined out from under their cursor. Cleared once persisted on blur.
  const [tagsDraft, setTagsDraft] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fxLibrary.filter((fx) => {
      if (categoryFilter !== "all" && fx.category !== categoryFilter) return false;
      if (!q) return true;
      return fx.name.toLowerCase().includes(q) || fx.tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [fxLibrary, categoryFilter, search]);

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFxSound(file, { name: parseFxFileName(file.name), category: "effect" });
      }
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
                  <p className="text-sm font-medium truncate">{fx.name}</p>
                  <p className="text-xs text-muted truncate">{fx.fileName}</p>
                </div>
                <span className="shrink-0 text-[10px] leading-none px-1.5 py-1 rounded-full bg-accent-teal/20 text-accent-teal font-medium capitalize">
                  {fx.category}
                </span>
                <span className="text-xs text-muted shrink-0">{formatTime(fx.durationSec)}</span>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
