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
  href,
  onClick,
  active = false,
  className,
}: {
  cover: ReactNode;
  title: string;
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
      <span className={cx("line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-tight", active ? "text-accent" : "text-foreground")}>
        {title}
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
