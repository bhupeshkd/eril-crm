/* Service worker for the installable app.
 * - Page navigations go to the network; when offline, a small "You're offline" page is shown instead.
 *   Pages are never cached, so no customer data is kept on the device.
 * - Built JS/CSS (/_next/static, content-hashed) is cached for fast starts. Skipped in development (?dev=1),
 *   where those files aren't hashed.
 * - Push notifications: shows them, and opens the right page (and workspace) when tapped.
 */
const VERSION = 'v2';
const SHELL = `eril-shell-${VERSION}`;
const STATIC = `eril-static-${VERSION}`;
const DEV = new URL(self.location.href).searchParams.has('dev');
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL, '/app-icon/192'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API calls and third parties go straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!DEV && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof msg.url === 'string' && msg.url.startsWith('/') && !msg.url.startsWith('//') ? msg.url : '/dashboard';
  event.waitUntil(
    self.registration.showNotification(msg.title || 'New notification', {
      body: msg.body || '',
      icon: msg.icon || '/app-icon/192',
      badge: '/app-icon/96',
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      data: { url, workspaceId: msg.workspaceId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/dashboard', workspaceId } = event.notification.data || {};
  const target = new URL(url, self.location.origin);
  if (workspaceId) target.searchParams.set('ws', workspaceId); // the app switches to that workspace first
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.navigate(target.href).then((c) => (c || open).focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
