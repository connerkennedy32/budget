// Bumped whenever cached content could be wrong: activate deletes older caches.
const CACHE_NAME = "budget-v3";

// Pages sit behind a login, so nothing is pre-cached here: fetched before
// signing in, they would all be copies of the sign-in redirect.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const { pathname } = new URL(event.request.url);
  // Bank data and sign-in must always come from the server, never a cache.
  if (pathname.startsWith("/api/") || pathname === "/login") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        // A response that went through a redirect must never be stored or
        // served back: browsers refuse to show it for a page load, and here
        // it would mean the sign-in page standing in for another page.
        if (response.ok && !response.redirected && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      return network;
    })
  );
});
