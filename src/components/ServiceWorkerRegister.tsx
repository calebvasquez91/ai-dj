"use client";

import { useEffect } from "react";

/** Registers the offline-caching service worker once on mount. Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev mode rebuilds .next (and its chunk hashes) on every restart, but
    // the SW's cache-first strategy for _next/static/ doesn't know that —
    // it'll happily keep serving yesterday's JS chunks, which then fail to
    // link against today's server and throw "module factory not available"
    // errors. Production deploys are atomic per-build, so this is dev-only.
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
