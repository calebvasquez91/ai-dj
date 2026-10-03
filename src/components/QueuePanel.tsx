"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { TrackThumbnail } from "@/components/TrackThumbnail";
import { CloseIcon } from "@/components/Icons";
import { FxLibraryPanel } from "@/components/FxLibraryPanel";
import { LayerIndicator } from "@/components/LayerIndicator";

type PanelTab = "queue" | "fx";

export function QueuePanel() {
  const open = useStore((s) => s.queuePanelOpen);
  const toggle = useStore((s) => s.toggleQueuePanel);
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const isTransitioning = useStore((s) => s.isTransitioning);
  const aiNextPickTrackId = useStore((s) => s.aiNextPickTrackId);
  const aiNextPickTransitionNote = useStore((s) => s.aiNextPickTransitionNote);
  const activePlaylistTheme = useStore((s) => s.activePlaylistTheme);
  const [tab, setTab] = useState<PanelTab>("queue");

  if (!open) return null;

  const isSpooky = activePlaylistTheme === "spooky";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={toggle}
        aria-hidden="true"
      />
      <aside className="fixed top-0 right-0 z-50 h-dvh w-[85vw] max-w-80 pb-[env(safe-area-inset-bottom)] surface-glass border-l border-border/10 shadow-elevate-left flex flex-col">
        <div
          className="flex items-center justify-between px-4 h-16 shrink-0 border-b border-border/10 transition-colors duration-1000"
          style={isSpooky ? { backgroundColor: "rgba(255, 80, 0, 0.08)" } : undefined}
        >
          <h2 className="text-sm heading">{isSpooky ? "🎃 Spooky Mode" : "Queue"}</h2>
          <button
            type="button"
            onClick={toggle}
            className="btn-icon text-accent-purple hover:text-accent-pink"
            title="Close queue"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-3 pt-3 shrink-0">
          <button
            type="button"
            onClick={() => setTab("queue")}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              tab === "queue" ? "bg-accent-purple/20 text-accent-purple" : "text-muted hover:text-foreground"
            }`}
          >
            Queue
          </button>
          <button
            type="button"
            onClick={() => setTab("fx")}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
              tab === "fx" ? "bg-accent-purple/20 text-accent-purple" : "text-muted hover:text-foreground"
            }`}
          >
            FX Library
          </button>
        </div>

        {isSpooky && <LayerIndicator className="px-4 pt-2 shrink-0" />}

        {tab === "fx" ? (
          <FxLibraryPanel />
        ) : (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
          {currentTrack && (
            <div>
              <p className="text-xs font-semibold text-muted px-1 mb-1">Now Playing</p>
              <div className="flex items-center gap-3 rounded-xl px-2 py-2 bg-surface-hover border border-accent-teal/40">
                <TrackThumbnail
                  thumbnailUrl={currentTrack.thumbnailUrl}
                  title={currentTrack.title}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{currentTrack.title}</p>
                  <p className="text-xs text-muted truncate">{currentTrack.artist}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted px-1 mb-1">
              Up Next {queue.length > 0 ? `(${queue.length})` : ""}
            </p>
            {queue.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                Nothing queued. Add tracks from Music Library or a playlist.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {queue.map((track, index) => (
                  <div
                    key={`${track.id}-${index}`}
                    className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-hover"
                  >
                    <TrackThumbnail
                      thumbnailUrl={track.thumbnailUrl}
                      title={track.title}
                      size={36}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{track.title}</p>
                      <p className="text-xs text-muted truncate">{track.artist}</p>
                    </div>
                    {track.id === aiNextPickTrackId && (
                      <span
                        title={aiNextPickTransitionNote || "Chosen by the AI DJ"}
                        className="shrink-0 text-[10px] leading-none px-1.5 py-1 rounded-full bg-accent-purple/20 text-accent-purple font-medium"
                      >
                        🤖 AI Pick
                      </span>
                    )}
                    <span className="text-xs text-muted">
                      {formatTime(track.durationSec)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(track.id)}
                      disabled={index === 0 && isTransitioning}
                      title={
                        index === 0 && isTransitioning
                          ? "Can't remove while mixing into this track"
                          : "Remove from queue"
                      }
                      className="btn-icon text-muted hover:text-accent-pink"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </aside>
    </>
  );
}
