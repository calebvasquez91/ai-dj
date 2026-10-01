"use client";

import { PlayIcon } from "@/components/Icons";

/** A horizontally-scrolling row of cards — the Home page's shelf layout. Renders nothing when `items` is empty so an empty shelf never shows as a bare heading. */
export function Shelf<T>({
  title,
  items,
  renderItem,
  trailing,
}: {
  title: string;
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  /** An extra card appended after the real items — e.g. a "+ New playlist" tile. */
  trailing?: React.ReactNode;
}) {
  if (items.length === 0 && !trailing) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-accent-purple px-6">{title}</h2>
      <div className="flex gap-3 overflow-x-auto px-6 pb-2 snap-x snap-mandatory scroll-px-6">
        {items.map((item, index) => (
          <div key={index} className="snap-start shrink-0">
            {renderItem(item, index)}
          </div>
        ))}
        {trailing && <div className="snap-start shrink-0">{trailing}</div>}
      </div>
    </section>
  );
}

export function ShelfCard({
  art,
  title,
  subtitle,
  onClick,
  showPlayIcon = false,
}: {
  art: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
  /** Overlays a Spotify-style play button on the art on hover — the whole
      card already calls `onClick`, so this is a visual affordance matching
      TrackGrid's cards, not a separate click target. Only for cards whose
      click action actually starts playback (track shelves) — leave off for
      ones that navigate instead (e.g. playlist cards), so the icon never
      promises an action the click doesn't take. */
  showPlayIcon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group card w-36 sm:w-40 p-3 flex flex-col gap-2 text-left hover:-translate-y-0.5 transition-transform"
    >
      {showPlayIcon ? (
        <div className="relative">
          {art}
          <span
            className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-gradient-to-br from-accent-teal to-accent-purple text-white flex items-center justify-center shadow-elevate-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200"
            aria-hidden="true"
          >
            <PlayIcon size={14} className="translate-x-0.5" />
          </span>
        </div>
      ) : (
        art
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
      </div>
    </button>
  );
}
