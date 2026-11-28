const CACHE_NAME = 'parikramapath-v16';
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
  '/js/admin.js',
  '/js/diary-blog.js'
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

  // 1. OpenStreetMap & Topo Map Tiles: Cache-First (Turant load + Offline support)
  if (url.hostname.includes('openstreetmap.org') || url.hostname.includes('opentopomap.org')) {
    const normalizedReq = url.hostname.includes('openstreetmap.org')
      ? normalizeOsmTileRequest(url)
      : event.request;

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

  // 3. App HTML / JS / CSS & CDN Libraries: Stale-While-Revalidate
  // Pehle purane cache se 0.1 sec me turant khulega, aur background me sirf updated file refresh hogi
  const isLocalAsset = (url.origin === self.location.origin);
  const isTrustedCdn = url.hostname.includes('unpkg.com') ||
                       url.hostname.includes('cdnjs.cloudflare.com') ||
                       url.hostname.includes('cdn.jsdelivr.net');

  if (isLocalAsset || isTrustedCdn) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request, { ignoreSearch: isLocalAsset }).then(cachedResponse => {
          const networkFetchPromise = fetch(event.request)
            .then(networkRes => {
              if (networkRes && networkRes.status === 200) {
                cache.put(event.request, networkRes.clone());
              }
              return networkRes;
            })
            .catch(() => null);

          if (cachedResponse) {
            event.waitUntil(networkFetchPromise);
            return cachedResponse;
          }

          return networkFetchPromise.then(netRes => {
            if (netRes) return netRes;
            if (event.request.mode === 'navigate') {
              return cache.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
        })
      )
    );
  }
});