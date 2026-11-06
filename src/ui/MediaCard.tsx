import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A cover with a title and a line under it, for the rows of songs and playlists. It takes the width of its parent (the
 * Carousel's `itemClassName`, or a grid cell) and keeps the cover square. A link with an `href`, a button with `onClick`.
 */
export function MediaCard({
  cover,
  title,
  subtitle,
  href,
  onClick,
  className,
}: {
  cover: ReactNode;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cx(
    "group flex w-full min-w-0 flex-col gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    className
  );
  const content = (
    <>
      <span className="block aspect-square w-full overflow-hidden rounded-lg transition-transform group-hover:scale-[1.02] motion-reduce:transition-none">
        {cover}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
