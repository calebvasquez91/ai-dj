import type { ReactNode } from "react";
import { cx } from "./cx";

/** A section title with an optional action on the right ("See all"). `level` is the heading level, so the page outline stays right. */
export function SectionHeader({
  title,
  action,
  level = 2,
  className,
}: {
  title: string;
  action?: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <Heading className="text-lg font-bold tracking-tight text-foreground">{title}</Heading>
      {action}
    </div>
  );
}
