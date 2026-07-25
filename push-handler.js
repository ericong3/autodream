self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = event.data.json();
  var title = data.title || 'AutoDream';
  var options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    tag: data.tag || title,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow(url);
    })
  );
});
