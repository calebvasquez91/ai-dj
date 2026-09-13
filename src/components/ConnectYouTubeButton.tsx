"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { connectYouTube } from "@/lib/googleAuth";
import { YouTubeIcon } from "@/components/YouTubeIcon";

/** "Connect YouTube" until an access token exists, then doubles as the "Import from YouTube" trigger — no separate connected/disconnected UI state to track beyond the token itself. */
export function ConnectYouTubeButton({ onReady }: { onReady: () => void }) {
  const connected = useStore((s) => s.youtubeAccessToken != null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (connected) {
      onReady();
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await connectYouTube();
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to YouTube.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={connecting}
        className="btn-outline"
        title="Import playlists from your YouTube account (read-only)"
      >
        <YouTubeIcon />
        <span className="hidden sm:inline">
          {connecting ? "Connecting…" : connected ? "Import from YouTube" : "Connect YouTube"}
        </span>
      </button>
      {error && <p className="text-xs text-accent-pink max-w-48 text-right">{error}</p>}
    </div>
  );
}
