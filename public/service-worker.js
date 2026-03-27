self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { text: 'Task reminder', id: 0 };

  e.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (allClients.length > 0) {
      // Tab is open — message it to play alarm sound immediately
      allClients.forEach(client => {
        client.postMessage({ type: 'PLAY_ALARM', text: data.text, id: data.id });
      });
    } else {
      // Tab is closed — open app so alarm sound can play
      await clients.openWindow(
        self.location.origin +
        '?alarm=' + encodeURIComponent(data.text) +
        '&alarmId=' + data.id
      );
    }

    // Always show the notification with system sound
    await self.registration.showNotification('🔔 To Do List Reminder', {
      body: 'Reminder: ' + data.text,
      icon: '/favicon.ico',
      vibrate: [400, 100, 400, 100, 400],
      requireInteraction: true,
      silent: false,
      tag: 'reminder-' + data.id,
      data: { url: self.location.origin, text: data.text, id: data.id }
    });
  })());
});

// When user clicks the notification, focus/open tab and play alarm
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url, text, id } = e.notification.data;

  e.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (allClients.length > 0) {
      await allClients[0].focus();
      allClients[0].postMessage({ type: 'PLAY_ALARM', text, id });
    } else {
      await clients.openWindow(
        url + '?alarm=' + encodeURIComponent(text) + '&alarmId=' + id
      );
    }
  })());
});