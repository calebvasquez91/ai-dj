import { cx } from "./cx";

/** A loading placeholder: give it the size of what is coming (`h-4 w-32`, `aspect-square`). Still, not pulsing, for reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-card bg-surface-raised motion-reduce:animate-none", className)} />;
}
