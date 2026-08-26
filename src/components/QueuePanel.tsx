"use client";

import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { TrackThumbnail } from "@/components/TrackThumbnail";

export function QueuePanel() {
  const open = useStore((s) => s.queuePanelOpen);
  const toggle = useStore((s) => s.toggleQueuePanel);
  const currentTrack = useStore((s) => s.currentTrack);
  const queue = useStore((s) => s.queue);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const isTransitioning = useStore((s) => s.isTransitioning);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={toggle}
        aria-hidden="true"
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-[85vw] max-w-80 bg-surface border-l-2 border-border flex flex-col">
        <div className="flex items-center justify-between px-4 h-16 shrink-0 border-b-2 border-border">
          <h2 className="text-sm retro-heading">Queue</h2>
          <button
            type="button"
            onClick={toggle}
            className="text-accent-purple hover:text-accent-pink text-lg leading-none px-1"
            title="Close queue"
          >
            ✕
          </button>
        </div>

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
                Nothing queued. Add tracks from Local Files or a playlist.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {queue.map((track, index) => (
                  <div
                    key={`${track.id}-${index}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover"
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
                      className="text-muted hover:text-red-400 disabled:opacity-30 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
