/* eslint-disable no-undef */
/**
 * F-7 — SERVICE WORKER (PWA)
 * -------------------------
 * Namerno mali i bez biblioteke (nema `vite-plugin-pwa` u zavisnostima):
 *
 *  1. **App shell offline** — navigacija pada na keširanu stranicu (`/offline`),
 *     statika (JS/CSS/fontovi) je „stale-while-revalidate“.
 *  2. **Web push** — prikazuje notifikacije za odgovor/citat/upozorenje.
 *  3. **Ne kešira API** — podaci (sesija, notifikacije, deal-ovi) uvek idu na
 *     mrežu; keširanje bi prikazivalo tuđe/old podatke posle odjave.
 *
 * Bump `VERSION` pri promeni strategije; stari keševi se brišu u `activate`.
 */

const VERSION = 'nexus-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/favicon.svg', '/manifest.webmanifest']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('nexus-') && !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API i autentifikacija nikad iz keša.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Navigacija: mreža prvo (sveže HTML/meta), offline fallback ako pukne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(OFFLINE_URL)) ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }),
    );
    return;
  }

  // Statika (Vite izlazi `assets/` sa hash-om — bezbedno keširati).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || /\.(?:js|css|woff2?|svg|png|webp|jpg|avif)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});

/* ------------------------------ WEB PUSH ------------------------------ */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'NEXUS', body: event.data.text() };
  }
  const title = payload.title || 'NEXUS';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Isti `tag` zamenjuje prethodnu notifikaciju iste teme (nema duplikata).
      tag: payload.tag || 'nexus',
      renotify: Boolean(payload.tag),
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
