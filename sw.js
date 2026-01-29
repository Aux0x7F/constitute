import { startDaemon } from './identity/sw/daemon.js';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

startDaemon(self);
