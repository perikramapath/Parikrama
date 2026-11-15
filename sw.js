const CACHE_NAME = 'parikramapath-v1';
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
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        return caches.open(TILE_CACHE).then(cache => {
          cache.put(event.request, res.clone());
          return res;
        });
      }).catch(() => new Response('')))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(res => res || fetch(event.request).catch(() => new Response('Offline', { status: 503 })))
    );
  }
});