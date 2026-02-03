import { startDaemon } from './identity/sw/daemon.js';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

try {
  startDaemon(self);
} catch (e) {
  console.error('[SW] startDaemon failed', e);
}
