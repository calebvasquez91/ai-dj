import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A compact quick-access tile: a small square cover and a one- or two-line title, as in a Spotify home screen's grid of
 * pinned playlists. 56px tall. A link with an `href`, a button with `onClick`.
 */
export function Tile({
  cover,
  title,
  subtitle,
  href,
  onClick,
  active = false,
  className,
}: {
  cover: ReactNode;
  title: string;
  /** A short second line saying what the tile does, when its name alone does not. */
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const classes = cx(
    "flex h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg bg-surface-raised pr-3 text-left transition-colors",
    "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    className
  );
  const content = (
    <>
      <span className="h-14 w-14 shrink-0 [&>*]:rounded-none">{cover}</span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className={cx("text-sm font-semibold leading-tight", subtitle ? "line-clamp-1" : "line-clamp-2", active ? "text-accent" : "text-foreground")}>
          {title}
        </span>
        {subtitle && <span className="line-clamp-2 text-xs leading-tight text-muted">{subtitle}</span>}
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
