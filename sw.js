const CACHE_NAME = 'parikramapath-v14';
const TILE_CACHE = 'parikrama-map-tiles-v1';

const APP_ASSETS = [
  '/',
  '/index.html',
  '/yatra-guide.html',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/js/config.js',
  '/js/offline-manager.js',
  '/js/yatra-flow.js',
  '/js/visited-local.js',
  '/js/map.js',
  '/js/auth-sos.js',
  '/js/live-yatris.js',
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

// Normalize OSM subdomain (a/b/c.tile.openstreetmap.org -> tile.openstreetmap.org)
// taaki pre-cached tiles offline mode me har subdomain ke liye match karein
function normalizeOsmTileRequest(requestUrl) {
  const normalizedHref = requestUrl.href.replace(
    /^https?:\/\/[abc]\.tile\.openstreetmap\.org\//i,
    'https://tile.openstreetmap.org/'
  );
  return new Request(normalizedHref, { method: 'GET' });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. OpenStreetMap Tiles: Cache-First (Offline Map Support)
  if (url.hostname.includes('openstreetmap.org')) {
    const normalizedReq = normalizeOsmTileRequest(url);
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(normalizedReq).then(cached => {
          if (cached) return cached;
          return fetch(event.request)
            .then(res => {
              if (res && res.ok) {
                cache.put(normalizedReq, res.clone());
              }
              return res;
            })
            .catch(() => new Response('', { status: 204 }));
        })
      )
    );
    return;
  }

  // 2. Supabase API Calls: Network-First with graceful JSON fallback when offline
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ offline: true, message: 'Offline mode active' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 3. App HTML / JS / CSS & Leaflet CDN Files: Network-First with Offline Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        if (networkRes && networkRes.status === 200 && (url.origin === self.location.origin || url.hostname.includes('unpkg.com') || url.hostname.includes('cdnjs.cloudflare.com'))) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        }
        return networkRes;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        })
      )
  );
});