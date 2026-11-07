// PocketBudget service worker — makes the app open and run with no internet.
// App files: served from the cache instantly, refreshed in the background when online.
// Receipt reader + fonts (vendor/): cached the first time they're used.
const VERSION = 'pb-v4.0.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './styles.css', './fonts.css',
  './main.js', './views.js', './ui.js', './icons.js', './logic.js', './db.js', './sync.js', './parser.js', './ocr.js',
  './icon-192.png', './icon-512.png',
];
const FONTS = ['archivo-black-latin-400-normal', 'space-grotesk-latin-500-normal', 'space-grotesk-latin-600-normal', 'space-grotesk-latin-700-normal']
  .map(f => `./vendor/fonts/${f}.woff2`);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(FONTS.map(u => cache.add(u).catch(() => {}))); // fonts are optional
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [VERSION, 'pb-vendor'];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase etc. go straight to the network

  // Receipt reader, language data and fonts: cache-first, kept across app updates.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith((async () => {
      const cache = await caches.open('pb-vendor');
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Page loads: always answer with the cached app so it opens offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put('./index.html', res.clone());
        return res;
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
