"use client";

import { useState, useSyncExternalStore } from "react";
import { coverGradient, coverInitial } from "@/lib/coverGradient";
import { cx } from "./cx";

/**
 * Cover art: the real image when there is one, and a generated gradient (stable per title, with its first letter) when
 * there is none or the image fails to load. The gradient is also what shows while the image is still loading, so the
 * square never pops in empty. `size` is in px; omit it to fill the parent (which should give it a size).
 */
export function CoverArt({
  src,
  title,
  size,
  className,
}: {
  src?: string | null;
  title: string;
  size?: number;
  className?: string;
}) {
  // Remember which source failed, so a new `src` gets a fresh try without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // The image is only rendered once the page is hydrated (the gradient is what the server sends): a broken image that
  // failed before React attached its error handler would never be noticed, and so never fall back to the gradient.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const showImage = hydrated && Boolean(src) && failedSrc !== src;
  const style = { background: coverGradient(title), ...(size ? { width: size, height: size } : null) };

  return (
    <div
      className={cx("relative shrink-0 overflow-hidden rounded-lg", !size && "h-full w-full", className)}
      style={style}
      role="img"
      aria-label={title}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- covers come from arbitrary user URLs (YouTube, blobs), which next/image can't be configured for ahead of time
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src ?? null)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-bold text-white/70"
          style={{ fontSize: size ? Math.max(12, Math.round(size * 0.42)) : "2rem" }}
        >
          {coverInitial(title)}
        </span>
      )}
    </div>
  );
}
