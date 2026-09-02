"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { connectYouTube } from "@/lib/googleAuth";

interface ConnectYouTubeButtonProps {
  onReady: () => void;
  /** "button" (default): standalone pill button. "menuItem": a full-width row for ConnectMenu.tsx's dropdown — same connect logic, different chrome. */
  variant?: "button" | "menuItem";
  /** menuItem variant only — called whenever this row's click leads to a state the dropdown should close for (already-connected -> Import). */
  onClose?: () => void;
}

/** "Connect YouTube" until an access token exists, then doubles as the "Import from YouTube" trigger — no separate connected/disconnected UI state to track beyond the token itself. */
export function ConnectYouTubeButton({ onReady, variant = "button", onClose }: ConnectYouTubeButtonProps) {
  const connected = useStore((s) => s.youtubeAccessToken != null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (connected) {
      onClose?.();
      onReady();
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await connectYouTube();
      onClose?.();
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to YouTube.");
    } finally {
      setConnecting(false);
    }
  }

  const status = connecting ? "Connecting…" : connected ? "Import ▸" : "Connect";

  if (variant === "menuItem") {
    return (
      <div>
        <button
          type="button"
          onClick={handleClick}
          disabled={connecting}
          className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-surface-hover disabled:opacity-60"
          title="Import playlists from your YouTube account (read-only)"
        >
          <span>YouTube</span>
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
        disabled={connecting}
        className="btn-retro-outline"
        title="Import playlists from your YouTube account (read-only)"
      >
        {connecting ? "Connecting…" : connected ? "Import from YouTube" : "Connect YouTube"}
      </button>
      {error && <p className="text-xs text-accent-pink max-w-48 text-right">{error}</p>}
    </div>
  );
}
