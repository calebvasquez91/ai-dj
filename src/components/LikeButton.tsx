"use client";

import { HeartIcon } from "@/components/Icons";
import { useLiked } from "@/lib/liked";

/** A heart that likes or unlikes a song. Likes are kept on this device (lib/liked.ts). Stops the click so a row or card behind it doesn't also play. */
export function LikeButton({ trackId, title, size = 14 }: { trackId: string; title?: string; size?: number }) {
  const liked = useLiked((s) => s.ids.includes(trackId));
  const toggle = useLiked((s) => s.toggle);
  const label = liked ? `Unlike${title ? ` ${title}` : ""}` : `Like${title ? ` ${title}` : ""}`;
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        toggle(trackId);
      }}
      className={`btn-icon ${liked ? "text-accent-pink" : "text-muted hover:text-foreground"}`}
    >
      <HeartIcon size={size} filled={liked} />
    </button>
  );
}
