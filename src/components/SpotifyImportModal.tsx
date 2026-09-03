"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { listMyPlaylists, type SpotifyPlaylistSummary } from "@/lib/spotifyApi";
import { importPlaylists } from "@/lib/spotifyImport";

export function SpotifyImportModal({ onClose }: { onClose: () => void }) {
  const addLocalTracks = useStore((s) => s.addLocalTracks);
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyPlaylists()
      .then((list) => {
        if (!cancelled) setPlaylists(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load playlists.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const { tracks, importedCount, skippedCount } = await importPlaylists(Array.from(selected));
      addLocalTracks(tracks);
      setResult({ imported: importedCount, skipped: skippedCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface border-2 border-border rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold retro-heading">Import from Spotify</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground" title="Close">
            ✕
          </button>
        </div>

        {result ? (
          <>
            <p className="text-sm">
              Imported {result.imported} track{result.imported === 1 ? "" : "s"}
              {result.skipped > 0 ? ` (${result.skipped} already in your library)` : ""}.
            </p>
            <button type="button" onClick={onClose} className="btn-retro self-end">
              Done
            </button>
          </>
        ) : (
          <>
            {loading && <p className="text-sm text-muted">Loading your playlists…</p>}
            {error && <p className="text-sm text-accent-pink">{error}</p>}
            {playlists && playlists.length === 0 && (
              <p className="text-sm text-muted">No playlists found on this Spotify account.</p>
            )}
            {playlists && playlists.some((p) => !p.accessible) && (
              <p className="text-xs text-muted">
                Greyed-out playlists are ones you follow rather than own — Spotify&apos;s developer platform only
                allows importing playlists you created or collaborate on.
              </p>
            )}
            {playlists && playlists.length > 0 && (
              <div className="flex-1 overflow-y-auto flex flex-col gap-1">
                {playlists.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg ${
                      p.accessible ? "cursor-pointer hover:bg-surface-hover" : "opacity-40 cursor-not-allowed"
                    }`}
                    title={p.accessible ? undefined : "Followed, not owned — can't be imported"}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={!p.accessible}
                      className="w-4 h-4 accent-accent-purple shrink-0"
                    />
                    <span className="flex-1 truncate">{p.title}</span>
                    <span className="text-xs text-muted shrink-0">{p.itemCount} tracks</span>
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
              className="btn-retro self-end"
            >
              {importing ? "Importing…" : `Import selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
