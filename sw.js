// Minimal service worker for offline/installable support.
// Deliberately network-first, not cache-first: this app's code and data
// change often, and a cache-first strategy risks silently serving stale
// app.js after every deploy. This only falls back to cache when there's
// genuinely no network (e.g. brief connectivity drop), not as the default.

// v4: bumped so any error responses cached by the pre-fix fetch handler are
// discarded on activate. Bump this whenever the caching logic changes.
const CACHE_NAME = 'ldrooms-shell-v4';
// NOTE: root-level app.js no longer exists — the app is now ~24 ES modules
// under js/. cache.addAll() rejects wholesale if ANY entry 404s, which would
// silently abort service worker installation entirely, so app.js is removed
// rather than replaced with a hand-maintained list of 24 module paths.
// The network-first fetch handler below caches each module the first time
// it's fetched, so offline fallback still fills in after one online visit.
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.json',
  'vendor/supabase.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests for the app shell files.
  // Everything else (Supabase API calls, external CDN scripts) goes
  // straight to the network, untouched — never intercept or cache API data.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Keep the cached shell fresh — but ONLY with real successes. There
        // was no status check here, so a 404, a 500 or a corporate proxy's
        // block page got written into the cache and then served as the app by
        // the offline fallback, surviving until CACHE_NAME changed or the
        // worker was unregistered by hand. type === 'basic' excludes opaque
        // cross-origin responses, which cannot be inspected and so cannot be
        // trusted.
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(event.request);
        // Without a fallback Response, respondWith() rejects on a cache miss
        // and the browser shows its own network error page instead of
        // something controllable.
        return hit || new Response('Offline and not cached.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});
