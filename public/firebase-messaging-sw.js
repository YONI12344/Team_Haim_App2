importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDLbpHzJ2i1Bl5pkI14yjCkah7GK4QVYKs',
  authDomain: 'team-haim.firebaseapp.com',
  projectId: 'team-haim',
  storageBucket: 'team-haim.firebasestorage.app',
  messagingSenderId: '57632152447',
  appId: '1:57632152447:web:b2109f9fb26f50cc5a584a',
  databaseURL: 'https://team-haim-default-rtdb.firebaseio.com',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Data-only messages: title/body/icon live in payload.data, not
  // payload.notification, so the browser never auto-displays its own
  // notification and this showNotification() call is the only one.
  const { title, body, icon } = payload.data || {};
  self.registration.showNotification(title || 'Team Haim', {
    body: body || '',
    icon: icon || '/icon-192x192.png',
    badge: '/icon-192x192.png',
    dir: 'rtl',
    lang: 'he',
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: payload.data?.actions ? JSON.parse(payload.data.actions) : [],
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
