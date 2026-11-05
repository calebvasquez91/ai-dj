import { cx } from "./cx";

/**
 * The dots under a swipeable row. The current page's dot is the longer, brighter one. Each dot is a button (a 44px tap
 * area around a small dot) so the row can be driven without swiping; hidden when there is only one page.
 */
export function PageDots({
  count,
  page,
  onSelect,
  label = "Page",
}: {
  count: number;
  page: number;
  onSelect?: (page: number) => void;
  label?: string;
}) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center justify-center" role="group" aria-label={`${label} indicator`}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${label} ${i + 1} of ${count}`}
          aria-current={i === page ? "true" : undefined}
          onClick={() => onSelect?.(i)}
          className="group flex h-11 w-6 items-center justify-center focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span
            className={cx(
              "block h-1.5 rounded-full transition-all motion-reduce:transition-none",
              i === page ? "w-4 bg-foreground" : "w-1.5 bg-faint group-hover:bg-muted"
            )}
          />
        </button>
      ))}
    </div>
  );
}
