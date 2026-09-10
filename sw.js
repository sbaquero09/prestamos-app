// Service worker — cachea solo el shell estático de la app.
// Las llamadas a Supabase (datos/auth) siempre van directo a red, nunca a caché.
const CACHE = 'prestamos-pro-v2';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // no tocar Supabase/CDN/fonts
  if (e.request.method !== 'GET') return;

  // Network-first: siempre intenta traer la versión más reciente. Solo cae a
  // caché si no hay red (offline), para no servir nunca una versión vieja
  // de la app mientras haya conexión.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
