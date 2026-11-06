"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cx } from "./cx";

/**
 * An icon-only button: `label` is required (it is the screen-reader name and the tooltip) and the target is never under
 * 44px. `variant="play"` is the one gradient button in the app, a round 56px play/pause with a tap of haptics.
 */
export function IconButton({
  label,
  variant = "plain",
  className,
  onClick,
  children,
  type = "button",
  ...rest
}: { label: string; variant?: "plain" | "play"; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (variant === "play") haptic("medium");
        onClick?.(event);
      }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none",
        variant === "play"
          ? "accent-gradient h-14 w-14 text-background hover:brightness-110"
          : "min-h-11 min-w-11 text-muted hover:bg-surface-hover hover:text-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
