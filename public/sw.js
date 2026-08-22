// Minimal, hand-rolled service worker — no build-time precache manifest,
// since Next's static export gives every JS/CSS chunk a content hash in its
// filename anyway (safe to cache indefinitely) and this project has no
// bundler plugin wired up to generate a workbox-style asset list.
//
// Strategy: cache-first for hashed static assets (they never change under a
// given filename), network-first-with-cache-fallback for everything else
// (HTML pages, the manifest) so a stale visit still works offline but a
// fresh deploy is picked up as soon as the network is reachable again.
//
// Bump CACHE_NAME whenever this strategy changes so old caches get cleared.
const CACHE_NAME = "ai-dj-cache-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return url.pathname.includes("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin requests pass through untouched
  if (url.protocol !== "http:" && url.protocol !== "https:") return; // e.g. blob: URLs for uploaded audio

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
