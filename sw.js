const CACHE_NAME = 'parikramapath-v11';
const TILE_CACHE = 'parikramapath-tiles-v1';

const APP_ASSETS = [
  '/',
  '/index.html',
  '/yatra-guide.html',
  '/style.css',
  '/manifest.json',
  '/js/config.js',
  '/js/yatra-flow.js',
  '/js/map.js',
  '/js/auth-sos.js',
  '/js/admin.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. OpenStreetMap Tiles: Cache-First (Offline Map Support)
  if (url.hostname.includes('openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        return caches.open(TILE_CACHE).then(cache => {
          cache.put(event.request, res.clone());
          return res;
        });
      }).catch(() => new Response('')))
    );
    return;
  }

  // 2. Supabase API Calls: Always Live Network
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. App HTML / JS / CSS Files: Network-First with Offline Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        }
        return networkRes;
      })
      .catch(() => caches.match(event.request).then(cached => cached || new Response('Offline', { status: 503 })))
  );
});