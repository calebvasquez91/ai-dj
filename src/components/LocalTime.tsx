"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * A time shown in the viewer's own time zone. A server renders in its own zone (UTC on Vercel), so the server render and
 * the first browser render show the time in UTC and the browser then swaps in the local one, without a hydration mismatch.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const text = useSyncExternalStore(
    noopSubscribe,
    () => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
    () => `${iso.slice(0, 16).replace("T", " ")} UTC`
  );
  return (
    <time dateTime={iso} className={className} title={iso}>
      {text}
    </time>
  );
}
