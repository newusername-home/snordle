const CACHE = 'snakewordle-v10';  // bump this

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

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Prefer network for HTML/JS so updates land quickly (fallback to cache)
  if (e.request.destination === 'document' || e.request.destination === 'script') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetched = fetch(e.request).then(resp => {
          caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
          return resp;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
    return;
  }
  // Cache-first for other assets
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
