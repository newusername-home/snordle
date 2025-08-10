// sw.js — robust cache + update, avoids "Response body is already used"
const CACHE = 'snakewordle-v23'; // bump on each deploy

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './words.js',
  './manifest.webmanifest'
];

// Precache
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    // Activate immediately on first load
    self.skipWaiting();
  })());
});

// Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    // Control all clients right away
    await self.clients.claim();
  })());
});

// Strategy:
// - HTML & JS: network-first (fallback to cache). Clone BEFORE using.
// - Other assets: cache-first (fallback to network).
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only cache GET
  if (req.method !== 'GET') return;

  const dest = req.destination; // 'document' | 'script' | 'style' | 'image' | ''

  // Network-first for HTML/JS so updates land quickly
  if (dest === 'document' || dest === 'script') {
    event.respondWith((async () => {
      try {
        const networkResp = await fetch(req, { cache: 'no-store' });
        // Clone BEFORE returning/use
        const toCache = networkResp.clone();
        // Cache only OK or opaque (some CDNs/scripts can be opaque)
        if (networkResp.ok || networkResp.type === 'opaque') {
          const cache = await caches.open(CACHE);
