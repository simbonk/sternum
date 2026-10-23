// Offline support: the app shell is cached on first visit, so the Home Screen app opens without a network.
// Pages are fetched network-first (so updates arrive), everything else cache-first. Readings never pass through here.
const CACHE = 'sternum-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'fonts/fonts.css', 'fonts/bricolage-grotesque.woff2', 'fonts/ibm-plex-sans.woff2', 'fonts/ibm-plex-mono-400.woff2', 'fonts/ibm-plex-mono-500.woff2', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./', copy)); return r; }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
