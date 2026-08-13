/*
 * Overlap's service worker.
 *
 * The CRDT already keeps painting working with no network, and IndexedDB already keeps the
 * room's state on the device. What neither can do is serve the app itself: without this, an
 * offline *reload* fails to fetch the HTML and the user sees a browser error page over data
 * that is sitting safely on their disk.
 *
 * Deliberately small and hand-written. A precache manifest would need a build plugin to track
 * hashed filenames, and the runtime cache below reaches the same place for an app this size.
 */

const CACHE = 'overlap-shell-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, '/']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Room state is never served from cache. The API is the authority while it is reachable,
  // and a stale room read out of a cache would be worse than no read at all — the client
  // already has a better copy in IndexedDB.
  if (url.pathname.startsWith('/api/')) return;

  // Any room URL is the same shell. Network first, so a fresh deploy is picked up promptly,
  // falling back to the cached shell when there is nothing to reach.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Assets are content-hashed, so a cache hit is always correct and never needs revalidating.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
