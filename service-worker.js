/* Offline-capable, network-first browser cache; updated when a new release is deployed. */
const CACHE_PREFIX = 'cassino-lab-';
const CACHE = CACHE_PREFIX + 'v0.2.0';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(
    fetch(request, {cache:'no-store'}).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const offlineHome = await caches.match(new URL('./index.html', self.registration.scope));
        if (offlineHome) return offlineHome;
      }
      return Response.error();
    })
  );
});
