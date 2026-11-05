import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * A filter chip (All, Music, Chill ...). A toggle: `selected` is exposed as aria-pressed. The chip is 32px tall to look
 * like a chip, with an invisible extension that makes the tappable area 44px. That extension is clipped by a scrolling
 * parent, so put chips in a ChipRow, whose padding leaves it room.
 */
export function Chip({
  selected = false,
  className,
  type = "button",
  ...rest
}: { selected?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "relative inline-flex h-8 shrink-0 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors",
        "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "bg-foreground text-background" : "bg-surface-raised text-foreground hover:bg-surface-hover",
        className
      )}
      {...rest}
    />
  );
}

/** A row of chips that scrolls sideways (scrollbar hidden). Its 6px of vertical padding is what keeps each chip's 44px tap area from being clipped. */
export function ChipRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1.5 sm:-mx-6 sm:px-6", className)}
    >
      {children}
    </div>
  );
}
