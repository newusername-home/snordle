const CACHE = 'snakewordle-v2';  // ← bump this

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './words.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

// Clean up old caches when a new SW takes control
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Stale-while-revalidate for JS/HTML to pick up updates quickly
  if (e.request.destination === 'document' || e.request.destination === 'script') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
  // Cache-first for everything else
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
