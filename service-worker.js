/* Network-first offline cache for the small, fixed app asset set. */
const CACHE_PREFIX = 'cassino-lab-';
const CACHE = CACHE_PREFIX + 'v0.10.5-auto-hand';
const ASSETS = ['./index.html', './manifest.webmanifest', './icon.svg', './version.json'];
const scope = new URL(self.registration.scope);
const home = new URL('./index.html', scope).href;
const assetKeys = new Map(ASSETS.map(asset => {
  const url=new URL(asset,scope);
  return [url.pathname,url.href];
}));
assetKeys.set(scope.pathname,home);
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
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  const key=assetKeys.get(url.pathname);
  // Do not accumulate unrelated or query-versioned responses in storage.
  if(!key&&request.mode!=='navigate')return;
  event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
    if(response.ok&&key){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(key,copy)).catch(()=>{}));
    }
    return response;
  }).catch(async()=>{
    const cache=await caches.open(CACHE);
    if(key){const cached=await cache.match(key);if(cached)return cached;}
    if(request.mode==='navigate'){const cached=await cache.match(home);if(cached)return cached;}
    return Response.error();
  }));
});
