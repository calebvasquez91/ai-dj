import type { ReactNode } from "react";
import { formatTime } from "@/lib/format";
import { CoverArt } from "./CoverArt";
import { cx } from "./cx";

/**
 * One song in a list: cover, title and artist, the length in Space Mono, and a slot for row actions (add, remove,
 * more). The main area is one button that plays it; `active` marks the song that is playing. 56px tall.
 */
export function TrackRow({
  title,
  artist,
  coverUrl,
  durationSec,
  active = false,
  onPlay,
  trailing,
  className,
}: {
  title: string;
  artist: string;
  coverUrl?: string | null;
  durationSec?: number;
  active?: boolean;
  onPlay?: () => void;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex min-h-14 items-center gap-1 rounded-lg hover:bg-surface-hover", active && "bg-surface-hover", className)}>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${title} by ${artist}`}
        aria-current={active ? "true" : undefined}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CoverArt src={coverUrl} title={title} size={40} />
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-sm font-semibold", active ? "text-accent" : "text-foreground")}>{title}</span>
          <span className="block truncate text-xs text-muted">{artist || "Unknown artist"}</span>
        </span>
        {durationSec != null && durationSec > 0 && <span className="font-mono text-xs tabular-nums text-muted">{formatTime(durationSec)}</span>}
      </button>
      {trailing}
    </div>
  );
}
