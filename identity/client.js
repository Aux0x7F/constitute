// identity/client.js
export class IdentityClient {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this._reqId = 1;
    this._pending = new Map();
    this._readyPromise = null;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => this._onMessage(e));
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.onEvent({ type: 'log', message: 'service worker controllerchange' });
      });
    }
  }

  async ready() {
    if (this._readyPromise) return this._readyPromise;

    this._readyPromise = (async () => {
      if (!('serviceWorker' in navigator)) {
        throw new Error('Service Worker not supported in this browser');
      }

      // 1) Ensure SW is registered (your repo did not register it anywhere).
      //    IMPORTANT: sw.js is an ES module (has import statements), so we MUST register as type:"module".
      let reg = await navigator.serviceWorker.getRegistration('./');

      // Some browsers return null unless you query without scope param; do both.
      if (!reg) reg = await navigator.serviceWorker.getRegistration();

      if (!reg) {
        this.onEvent({ type: 'log', message: 'registering service worker ./sw.js (module)' });
        try {
          reg = await navigator.serviceWorker.register('./sw.js', {
            scope: './',
            type: 'module',
          });
        } catch (e) {
          // Common causes: not on http(s)/localhost, wrong path, browser lacks module SW support
          throw new Error(`Service Worker registration failed: ${String(e?.message || e)}`);
        }
      }

      // 2) Wait for activation/ready
      await navigator.serviceWorker.ready;

      // 3) Ensure we have a controller (first load needs a reload sometimes; we wait rather than blame server)
      await this._waitForController(9000);

      return reg;
    })();

    return this._readyPromise;
  }

  async call(method, params = {}, { timeoutMs } = {}) {
    // Default timeout: first load can be slower
    const t = timeoutMs ?? 6000;

    await this.ready();

    if (!navigator.serviceWorker.controller) {
      await this._waitForController(6000);
    }

    const id = this._reqId++;
    const payload = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
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
  }

  _onMessage(e) {
    const msg = e.data || {};

    // daemon events
    if (msg.type === 'evt' && msg.evt) {
      this.onEvent(msg.evt);
      return;
    }

    // rpc responses
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
