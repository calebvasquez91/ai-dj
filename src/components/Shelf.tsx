"use client";

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
}: {
  art: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card w-36 sm:w-40 p-3 flex flex-col gap-2 text-left hover:-translate-y-0.5 transition-transform"
    >
      {art}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
      </div>
    </button>
  );
}
