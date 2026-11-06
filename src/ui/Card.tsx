import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

const BASE = "block w-full rounded-card border border-border-subtle bg-surface p-4 text-left";
const INTERACTIVE =
  "transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** A card: 12px radius, a thin 1px border, a quiet surface. A link when it has an `href`, a button when it has `onClick`, else a plain box. */
export function Card({
  href,
  onClick,
  className,
  children,
}: {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={cx(BASE, INTERACTIVE, className)}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(BASE, INTERACTIVE, className)}>
        {children}
      </button>
    );
  }
  return <div className={cx(BASE, className)}>{children}</div>;
}
