/* Puja el número de VERSIO cada cop que publiquis canvis: això fa que els
   mòbils esborrin la còpia antiga i es quedin només amb la nova. */
const VERSIO = 'v8';
const CACHE = 'scouting-mcbf-' + VERSIO;

// L'app sencera es precarrega: dins el pavelló sovint no hi ha cobertura i
// ha de poder obrir-se igual.
const APP = [
  './', './index.html', './app.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // L'Apps Script va sempre a la xarxa: les dades no es cachegen mai aquí,
  // d'això ja se n'ocupa el magatzem local de l'app.
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  const esCodi = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('.html') || url.pathname.endsWith('.js') ||
                 url.pathname.endsWith('/');

  if (esCodi) {
    // Xarxa primer: qualsevol canvi que publiquis arriba sol al mòbil.
    // Sense cobertura, servim l'última còpia bona desada.
    event.respondWith(
      // 'no-store' salta la còpia HTTP del propi navegador: sense això, un
      // canvi acabat de publicar pot trigar minuts a arribar al mòbil.
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Icones i manifest: còpia primer, que no canvien i així l'app obre ràpid.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
      }
      return res;
    }))
  );
});
