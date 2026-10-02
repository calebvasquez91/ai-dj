"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Minimum gap kept between the menu and every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Gap between the anchor and the menu. */
const ANCHOR_GAP = 4;

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * A dropdown that can never be cut off. It renders in a portal on <body>
 * with `position: fixed`, so no ancestor's `overflow` (e.g. <main>'s
 * overflow-y-auto, which silently clips horizontally too) or stacking
 * context can clip or hide it, and it positions itself from the anchor's
 * live bounding box against the real viewport: width capped to the
 * viewport, horizontally clamped on-screen, flipped above the anchor when
 * there isn't room below, and given a max-height with its own scroll when
 * the content is taller than any available space. Repositions on
 * resize/scroll/content-size changes.
 *
 * Portal caveat handled here: React events still bubble through a portal
 * to the *React* parent (e.g. a clickable track card), so clicks/keys
 * inside the menu are stopped at its root.
 */
export function AnchoredMenu({
  anchorRef,
  onClose,
  width = 224,
  align = "end",
  className = "",
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Preferred width in px; shrinks to fit narrow viewports. */
  width?: number;
  /** Which edge of the anchor the menu lines up with when there's room. */
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const rect = anchor.getBoundingClientRect();

    const menuWidth = Math.min(width, viewportWidth - VIEWPORT_MARGIN * 2);
    const preferredLeft = align === "end" ? rect.right - menuWidth : rect.left;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, viewportWidth - VIEWPORT_MARGIN - menuWidth));

    // scrollHeight of the content, not the (possibly already max-height
    // capped) rendered box, so a previously-shrunk menu can grow back.
    const contentHeight = menu.scrollHeight;
    const spaceBelow = viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;

    let top: number;
    let maxHeight: number;
    if (contentHeight <= spaceBelow || spaceBelow >= spaceAbove) {
      top = rect.bottom + ANCHOR_GAP;
      maxHeight = Math.max(80, spaceBelow);
    } else {
      maxHeight = Math.max(80, spaceAbove);
      top = rect.top - ANCHOR_GAP - Math.min(contentHeight, maxHeight);
    }
    // Last-resort guard for a viewport shorter than the minimum height.
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - VIEWPORT_MARGIN - Math.min(contentHeight, maxHeight)));

    setPosition((prev) =>
      prev && prev.top === top && prev.left === left && prev.width === menuWidth && prev.maxHeight === maxHeight
        ? prev
        : { top, left, width: menuWidth, maxHeight }
    );
  }, [anchorRef, align, width]);

  // Measure before paint so the menu never flashes in the wrong place.
  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    window.addEventListener("resize", reposition);
    // Capture so scrolling *any* ancestor (the page's <main>, a shelf) re-anchors it.
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    if (menuRef.current) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [reposition]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={`fixed z-[100] overflow-y-auto overscroll-contain rounded-xl bg-surface shadow-elevate-lg ${className}`}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: position?.width ?? Math.min(width, document.documentElement.clientWidth - VIEWPORT_MARGIN * 2),
        maxHeight: position?.maxHeight,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
