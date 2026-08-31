// Minimal service worker for offline/installable support.
// Deliberately network-first, not cache-first: this app's code and data
// change often, and a cache-first strategy risks silently serving stale
// app.js after every deploy. This only falls back to cache when there's
// genuinely no network (e.g. brief connectivity drop), not as the default.

const CACHE_NAME = 'ldrooms-shell-v1';
const APP_SHELL = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
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
        // Keep the cached shell fresh with whatever we just successfully fetched.
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
