/* Offline support. Online: always fetch the latest app (so updates show up straight away).
   Offline: serve the copy saved on the phone. The receipt reader is cached once and kept. */
const CACHE = 'trip-tally-v8';
const OCR_CACHE = 'trip-tally-ocr-v1';
const ASSETS = ['./', './index.html', './app.js', './receipt.js', './styles.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const OCR_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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

  if (OCR_HOSTS.includes(url.hostname)) { // versioned files: cache-first, keep
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

  // network-first (give up after 4s on a weak connection), fall back to the saved copy
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
    }
  })());
});
