const CACHE='vmk114-shell-__BUILD_ID__';
const DATA='vmk114-data-v1';
const scope=self.registration.scope;
const inScope=url=>url.origin===self.location.origin&&url.pathname.startsWith(new URL(scope).pathname);
const local=path=>new URL(path.replace(/^\//,''),scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const listResponse=await fetch(local('precache.json'),{cache:'no-store'});
 if(!listResponse.ok)throw Error('Offline asset list unavailable');
 const list=await listResponse.json();
 const cache=await caches.open(CACHE);
 for(const path of list){const url=local(path);const response=await fetch(url,{cache:'reload'});if(!response.ok)throw Error('Offline asset unavailable: '+path);await cache.put(url,response);}
 await cache.put(local('offline-ready'),new Response('ready'));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('vmk114-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||!inScope(url))return;
 if(url.pathname.endsWith('/source.json')||url.pathname.endsWith('/latest.pdf'))return;
 if(/\/saved-schedule-[a-f0-9]{64}\.pdf$/.test(url.pathname)){event.respondWith((async()=>await (await caches.open(DATA)).match(url.href)||new Response('PDF не сохранён',{status:404}))());return;}
 if(request.mode==='navigate'){
  event.respondWith((async()=>{const cached=await (await caches.open(CACHE)).match(local('index.html'));try{const response=await fetch(request,{signal:AbortSignal.timeout(3000)});if(response.ok)return response;if(cached)return cached;return response;}catch{if(cached)return cached;return new Response('Для первого открытия нужен интернет.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}})());return;
 }
 event.respondWith((async()=>{const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}return response;})());
});
