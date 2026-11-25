// Service worker do Fixa: guarda o app no aparelho para abrir sem internet.
// Estratégia: tenta a rede primeiro (versão nova aparece na hora) e cai no que está guardado se estiver sem internet.
// Ao publicar mudança, suba VERSAO para limpar o cache antigo.
const VERSAO = 'fixa-v2';
const ARQUIVOS = [
  './', './index.html', './style.css', './app.js', './fsrs.js', './midia.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
