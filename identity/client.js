export class IdentityClient {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this._reqId = 1;
    this._pending = new Map();
    this._readyPromise = null;

    navigator.serviceWorker?.addEventListener('message', (e) => this._onMessage(e));
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      // A controller just became available (common right after first load)
      this.onEvent({ type: 'log', message: 'service worker controllerchange' });
    });
  }

  async ready() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('Service Worker not supported');

      // Ensure SW is registered (assumes your SW registration is already in place)
      const reg = await navigator.serviceWorker.ready;

      // Wait until we actually have a controller to talk to
      await this._waitForController(8000);

      return reg;
    })();
    return this._readyPromise;
  }

  async call(method, params = {}, { timeoutMs } = {}) {
    // Default timeout: conservative; first load can be slower
    const t = timeoutMs ?? 5000;

    // Ensure SW exists + controller is attached
    await this.ready();
    if (!navigator.serviceWorker.controller) {
      // controller may be in-flight
      await this._waitForController(6000);
    }

    const id = this._reqId++;
    const payload = { type: 'req', id, method, params };

    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`timeout calling ${method}`));
      }, t);

      this._pending.set(id, { resolve, reject, timer });

      try {
        navigator.serviceWorker.controller.postMessage(payload);
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(e);
      }
    });

    return p;
  }

  _onMessage(e) {
    const msg = e.data || {};
    if (msg.type === 'evt' && msg.evt) {
      this.onEvent(msg.evt);
      return;
    }
    if (msg.type === 'res') {
      const p = this._pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this._pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'unknown error'));
    }
  }

  _waitForController(timeoutMs = 8000) {
    if (navigator.serviceWorker.controller) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        if (navigator.serviceWorker.controller) {
          cleanup();
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          cleanup();
          reject(new Error('service worker controller not available'));
          return;
        }
      };

      const onChange = () => tick();
      const cleanup = () => {
        clearInterval(iv);
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      };

      navigator.serviceWorker.addEventListener('controllerchange', onChange);
      const iv = setInterval(tick, 100);
      tick();
    });
  }
}
