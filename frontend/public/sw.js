// Justice Gavel Service Worker — v2.4.0
// Cache-first strategy for static assets, network-first for API calls

const CACHE_NAME = 'justice-gavel-v8.7.61'; // bump with package.json version to drop old caches
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js',
  '/offline.html',
  // App shell assets — add bundle hashes here after build
  // '/static/js/main.chunk.js',
  // '/static/css/main.chunk.css',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
    // Add each asset individually so a missing icon doesn't kill the install
    return Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)));
  })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls or external requests
  if (url.pathname.startsWith('/api') || url.origin !== location.origin) {
    return; // fall through to network
  }

  if (event.request.method !== 'GET') return;

  // Navigations (index.html): network-first so a new deploy is picked up
  // immediately; fall back to the cached shell, then offline.html.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/', toCache)).catch(() => {});
        return response;
      }).catch(() =>
        caches.match('/').then((cached) => cached || caches.match('/offline.html')).then((r) =>
          r || new Response('<h1>You are offline</h1><p>Your case data is available when you reconnect.</p>',
            { headers: { 'Content-Type': 'text/html' } }))
      )
    );
    return;
  }

  // Static assets (content-hashed bundles, fonts, images): cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache)).catch(() => {});
        }
        return response;
      });
    })
  );
});


// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue') {
    // App-level offline sync is handled by offlineSync.ts
  }
});

// ── Web push (court reminders and other notifications) ───────────────────────
// The server sends { title, body, url, icon, tag } (backend/src/services/webPush.js).
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Justice Gavel', body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Justice Gavel';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: d.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true,
    data: { url: d.url || '/', ...(d.data || {}) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
