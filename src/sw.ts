/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  const data = event.data.json();
  const title: string = data.title ?? 'AutoDream';
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: data.body ?? '',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: data.url ?? '/' },
    vibrate: [200, 100, 200],
    tag: data.tag ?? title,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/';
  event.waitUntil(
    (self as any).clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list: any[]) => {
        for (const client of list) {
          if ('focus' in client) return client.focus();
        }
        return (self as any).clients.openWindow(url);
      })
  );
});
