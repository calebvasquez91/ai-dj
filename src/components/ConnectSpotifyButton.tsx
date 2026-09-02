"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { connectSpotify, getValidSpotifyToken, hasSpotifyRefreshToken } from "@/lib/spotifyAuth";

interface ConnectSpotifyButtonProps {
  onReady: () => void;
  /** "button" (default): standalone pill button. "menuItem": a full-width row for ConnectMenu.tsx's dropdown — same connect logic, different chrome. */
  variant?: "button" | "menuItem";
  /** menuItem variant only — called whenever this row's click leads to a state the dropdown should close for (already-connected -> Import; the redirect case doesn't need it since the whole page navigates away). */
  onClose?: () => void;
}

/** "Connect Spotify" until an access token exists, then doubles as the "Import from Spotify" trigger — mirrors ConnectYouTubeButton.tsx. The one addition: since the refresh token survives a page reload (unlike YouTube's in-memory-only token), this silently re-derives an access token on mount instead of always showing "Connect" first. */
export function ConnectSpotifyButton({ onReady, variant = "button", onClose }: ConnectSpotifyButtonProps) {
  const connected = useStore((s) => s.spotifyAccessToken != null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connected || !hasSpotifyRefreshToken()) {
      // One-shot mount check, not state synced from an external system.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecking(false);
      return;
    }
    getValidSpotifyToken().finally(() => setChecking(false));
    // Only needs to run once per mount — re-checking whenever `connected`
    // flips true would just be a redundant no-op read of the same state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleClick() {
    if (connected) {
      onClose?.();
      onReady();
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await connectSpotify(); // navigates away on success; this only resolves on failure
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to Spotify.");
      setConnecting(false);
    }
  }

  const status = checking ? "Checking…" : connecting ? "Connecting…" : connected ? "Import ▸" : "Connect";

  if (variant === "menuItem") {
    return (
      <div>
        <button
          type="button"
          onClick={handleClick}
          disabled={connecting || checking}
          className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-surface-hover disabled:opacity-60"
          title="Import playlists from your Spotify account — playback requires Spotify Premium"
        >
          <span>Spotify</span>
          <span className="text-xs text-muted">{status}</span>
        </button>
        {error && <p className="px-3 pb-2 text-xs text-accent-pink">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={connecting || checking}
        className="btn-retro-outline"
        title="Import playlists from your Spotify account — playback requires Spotify Premium"
      >
        {checking ? "Checking…" : connecting ? "Connecting…" : connected ? "Import from Spotify" : "Connect Spotify"}
      </button>
      {error && <p className="text-xs text-accent-pink max-w-48 text-right">{error}</p>}
    </div>
  );
}
