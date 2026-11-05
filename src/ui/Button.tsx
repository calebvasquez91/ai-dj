import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-background hover:bg-accent-strong",
  secondary: "bg-surface-raised text-foreground hover:bg-surface-hover",
  ghost: "text-muted hover:bg-surface-hover hover:text-foreground",
};

/**
 * A text button. 44px tall at the smallest (the touch minimum). Neutral by default: the gradient belongs to the play
 * button alone, so even "primary" is a flat accent.
 */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        className
      )}
      {...rest}
    />
  );
}
