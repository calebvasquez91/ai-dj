"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

/**
 * A bottom sheet: a dimmed backdrop and a panel that slides up from the bottom edge. A dialog for assistive tech: it
 * takes focus when it opens and gives it back to what had it when it closes; Escape or a tap on the backdrop closes it.
 * `bottomOffset` is a CSS length for the chrome that stays visible under it (the player bar); `full` makes it as tall
 * as the space allows, otherwise it is as tall as its content (up to 85% of the screen).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  bottomOffset = "0px",
  full = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  bottomOffset?: string;
  full?: boolean;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Portaled only in the browser: the document does not exist on the server (false there, true once hydrated).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      before?.focus();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-x-0 top-0 z-[80] bg-black/60" style={{ bottom: bottomOffset }} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "fixed inset-x-0 z-[81] mx-auto flex w-full max-w-3xl flex-col rounded-t-2xl border border-b-0 border-border-subtle bg-surface-hover shadow-elevate-lg outline-none",
          full ? "top-[var(--topbar-h)]" : "max-h-[85dvh]",
          className
        )}
        style={{ bottom: bottomOffset }}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-faint" aria-hidden="true" />
        <h2 id={titleId} className="px-4 pb-2 pt-3 text-lg font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
      </div>
    </>,
    document.body
  );
}
