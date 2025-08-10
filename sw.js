// sw.js — Dev-friendly auto-update SW for Word Snake
// Behaviour:
// - Network-first for HTML/CSS/JS so code updates land immediately.
// - Cache-first (with background refresh) for everything else.
// - Auto-refresh the page once when a new SW activates.
// - Robust cloning to avoid "Response body is already used" errors.

const VERSION = '2025-08-10.1';                    // Bump when you change this file
const CACHE   = `word-snake-dev-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './words.js',
  './manifest.webmanifest'
];

// Install: pre-cache shell and become active immediately
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});

// Activate: clean old caches, take control, and notify clients to refresh
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Tell all pages that a new SW is active → pages can reload once
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage('sw:update'); // page script listens and reloads once
    }
  })());
});

// Fetch strategy:
// - HTML / CSS / JS → network-first (no-store), fallback to cache.
// - Others → cache-first, then background refresh (stale-while-revalidate-ish).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const dest = req.destination; // 'document' | 'script' | 'style' | 'image' | 'font' | ''
  const isCode = dest === 'document' || dest === 'script' || dest === 'style';

  if (isCode) {
    event.respondWith((async () => {
      try {
        const netResp = await fetch(req, { cache: 'no-store' });
        const toCache = netResp.clone();
        if (netResp.ok || netResp.type === 'opaque') {
          const cache = await caches.open(CACHE);
          await cache.put(req, toCache);
        }
        return netResp;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // As a last resort, try a generic fetch (may still fail)
        return fetch(req);
      }
    })());
    return;
  }

  // Assets (images/fonts/etc.): cache-first with background refresh
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // Kick off a background refresh
      event.waitUntil((async () => {
        try {
          const netResp = await fetch(req);
          if (netResp && (netResp.ok || netResp.type === 'opaque')) {
            const cache = await caches.open(CACHE);
            await cache.put(req, netResp.clone());
          }
        } catch { /* ignore */ }
      })());
      return cached;
    }
    // Not cached → go to network and cache it
    const netResp = await fetch(req);
    if (netResp && (netResp.ok || netResp.type === 'opaque')) {
      const cache = await caches.open(CACHE);
      await cache.put(req, netResp.clone());
    }
    return netResp;
  })());
});

// Optional: allow the page to tell the SW to activate immediately
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
