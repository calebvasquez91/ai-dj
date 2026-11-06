import type { ElementType, HTMLAttributes } from "react";
import { cx } from "./cx";

export type TextVariant = "title" | "heading" | "body" | "secondary" | "caption" | "numeric";

const STYLES: Record<TextVariant, string> = {
  title: "text-2xl font-bold tracking-tight text-foreground",
  heading: "text-lg font-semibold text-foreground",
  body: "text-sm text-foreground",
  secondary: "text-sm text-muted",
  caption: "text-xs text-muted",
  // Space Mono, with every digit the same width, for time and BPM.
  numeric: "font-mono text-xs tabular-nums text-muted",
};

/** The one place text styles are defined: pick a variant instead of repeating size, weight and color. */
export function Text({
  as: Tag = "p",
  variant = "body",
  className,
  ...rest
}: { as?: ElementType; variant?: TextVariant } & HTMLAttributes<HTMLElement>) {
  return <Tag className={cx(STYLES[variant], className)} {...rest} />;
}
