"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectYouTubeButton } from "@/components/ConnectYouTubeButton";
import { ConnectSpotifyButton } from "@/components/ConnectSpotifyButton";

/**
 * Consolidates the YouTube/Spotify connect buttons into one dropdown so the
 * library toolbar fits on screen instead of growing a new pill button (and
 * a long "Import from X"/"Checking…" label) per streaming source. Same
 * outside-click-close pattern as AddToPlaylistButton.tsx. The connect
 * logic itself stays in ConnectYouTubeButton/ConnectSpotifyButton (via
 * their `variant="menuItem"`) rather than being duplicated here.
 */
export function ConnectMenu({
  onYouTubeReady,
  onSpotifyReady,
}: {
  onYouTubeReady: () => void;
  onSpotifyReady: () => void;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn-retro-outline"
        title="Connect a streaming account to import playlists"
      >
        🔗 Connect
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-xl border-2 border-border bg-surface shadow-lg py-1">
          <ConnectYouTubeButton variant="menuItem" onClose={() => setOpen(false)} onReady={onYouTubeReady} />
          <ConnectSpotifyButton variant="menuItem" onClose={() => setOpen(false)} onReady={onSpotifyReady} />
        </div>
      )}
    </div>
  );
}
