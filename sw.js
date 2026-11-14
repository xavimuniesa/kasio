/* Kasio · service worker
   Fa que l'app instal·lada s'obri també sense connexió.

   - La pàgina (index.html): primer la xarxa, perquè les versions noves arribin
     de seguida; si no hi ha xarxa (o triga més de 4 s), la còpia desada.
   - La resta de fitxers d'aquesta carpeta (manifest, icones): còpia desada i,
     per darrere, es renova.
   - Tipografia (Google Fonts) i hls.js (jsDelivr): igual, còpia desada i renovació.
   - Tot el altre (temps, aire, ràdio, podcasts, notícies) NO es toca: va sempre
     directe a la xarxa, com fins ara.

   Ha d'anar a la mateixa carpeta que index.html. No cal canviar-hi res quan
   s'actualitza l'index; CACHE només s'ha de canviar si es canvia aquest fitxer
   i es vol llençar tot el que hi havia desat. */
const CACHE = 'kasio-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest'];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // un fitxer que falli (p. ex. si no hi ha manifest) no ha d'impedir la instal·lació
      .then(cache => Promise.all(SHELL.map(u => cache.add(new Request(u, { cache:'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('kasio-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Només es desen respostes bones (o opaques, com el full d'estil de la tipografia)
const storable = res => res && (res.ok || res.type === 'opaque');

function put(request, response){
  if(!storable(response)) return Promise.resolve();
  return caches.open(CACHE).then(cache => cache.put(request, response)).catch(() => {});
}

// Pàgina: xarxa primer, amb temps límit; si falla, la còpia desada
function pageFirstNetwork(event){
  const request = event.request;
  const cached = () => caches.match(request, { ignoreSearch:true })
    .then(r => r || caches.match('./'))
    .then(r => r || caches.match('index.html'));
  const network = fetch(request).then(res => {
    if(storable(res)) event.waitUntil(put(request, res.clone()));
    return res;
  });
  const slow = new Promise(resolve => setTimeout(resolve, PAGE_TIMEOUT_MS)).then(cached);
  return Promise.race([
    network.catch(() => null),
    slow
  ]).then(res => res || cached()).then(res => res || network);
}

// Fitxers estàtics: còpia desada de seguida i renovació per darrere
function staleWhileRevalidate(event){
  const request = event.request;
  return caches.match(request).then(hit => {
    const refresh = fetch(request).then(res => {
      if(storable(res)) return put(request, res.clone()).then(() => res);
      return res;
    });
    if(hit){ event.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || request.headers.has('range')) return;
  let url;
  try{ url = new URL(request.url); }catch(err){ return; }
  if(url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if(url.origin === self.location.origin){
    const isPage = request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    event.respondWith(isPage ? pageFirstNetwork(event) : staleWhileRevalidate(event));
    return;
  }
  if(CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(event));
  // qualsevol altre servidor: no s'intercepta
});
