/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  let data: { title?: string; body?: string; url?: string; tag?: string };
  try { data = event.data.json(); } catch { data = {}; }
  const title = data.title || 'AutoDream';
  const options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    tag: data.tag || title,
    renotify: true,
  } as NotificationOptions;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = event.notification.data?.url || '/';
  event.waitUntil(
    (self.clients as Clients).matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return (client as WindowClient).focus();
      }
      return (self.clients as Clients).openWindow(url);
    })
  );
});
