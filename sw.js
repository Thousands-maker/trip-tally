/* Offline support: cache the app shell, plus the receipt reader once it has been downloaded. */
const CACHE = 'trip-tally-v6';
const OCR_CACHE = 'trip-tally-ocr-v1';
const ASSETS = ['./', './index.html', './app.js', './receipt.js', './styles.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const OCR_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Receipt reader files are versioned: cache-first, keep forever.
  if (OCR_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(OCR_CACHE).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // App shell: answer from cache instantly, refresh in the background when online.
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
