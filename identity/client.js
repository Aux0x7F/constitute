// identity/client.js
// Client-side RPC wrapper for the identity Service Worker.
//
// IMPORTANT: We serialize RPC calls.
// The Service Worker is single-threaded and uses IndexedDB; sending many
// concurrent RPCs can cause contention and apparent hangs/timeouts.

export class IdentityClient {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this._reqId = 1;
    this._pending = new Map();
    this._readyPromise = null;
    this._reg = null;

    // Serialize calls to prevent SW/IDB contention.
    this._queue = Promise.resolve();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (e) => this._onMessage(e));
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        this.onEvent({ type: "log", message: "service worker controllerchange" });
      });
    }
  }

  async ready() {
    if (this._readyPromise) return this._readyPromise;

    this._readyPromise = (async () => {
      if (!("serviceWorker" in navigator)) {
        throw new Error("Service Worker not supported in this browser");
      }

      console.log("[client] ready: checking SW registration");
      // Ensure SW is registered. sw.js is an ES module.
      let reg = await navigator.serviceWorker.getRegistration("./");
      if (!reg) reg = await navigator.serviceWorker.getRegistration();

      if (!reg) {
        this.onEvent({ type: "log", message: "registering service worker ./sw.js (module)" });
        console.log("[client] registering SW ./sw.js");
        reg = await navigator.serviceWorker.register("./sw.js", {
          scope: "./",
          type: "module",
        });
      }

      this._reg = reg;
      console.log("[client] waiting for SW ready");
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      // First load after registration may need a controller; wait a bit.
      console.log("[client] waiting for controller");
      let controllerOk = false;
      try {
        await this._waitForController(9000);
        controllerOk = true;
      } catch (e) {
        // On first registration, controller may not attach until reload.
        const k = "sw:reloaded";
        if (!sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, "1");
          console.warn("[client] no controller; reloading to attach SW");
          location.reload();
          return reg;
        }
        console.warn("[client] controller unavailable; continuing with direct port fallback");
      }
      if (controllerOk) console.log("[client] controller ready");
      return reg;
    })();

    return this._readyPromise;
  }

  isServiceWorkerAvailable() {
    return !!(navigator.serviceWorker.controller || this._reg?.active || this._reg?.waiting || this._reg?.installing);
  }

  /**
   * Enqueue an RPC call (serialized).
   */
  call(method, params = {}, { timeoutMs } = {}) {
    const run = () => this._callOnce(method, params, { timeoutMs });

    const p = this._queue.then(run);

    // Keep the queue alive even if a call fails.
    this._queue = p.catch(() => {});
    return p;
  }

  async _callOnce(method, params = {}, { timeoutMs } = {}) {
    // Default timeout: be generous for IDB/crypto + first-load conditions.
    const t = timeoutMs ?? 15000;

    await this.ready();

    const controller = navigator.serviceWorker.controller;

    const id = this._reqId++;
    const payload = { type: "req", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`timeout calling ${method}`));
      }, t);

      this._pending.set(id, { resolve, reject, timer });

      try {
        if (controller) {
          controller.postMessage(payload);
        } else if (this._reg?.active) {
          const ch = new MessageChannel();
          ch.port1.onmessage = (e) => {
            const msg = e.data || {};
            if (msg.type !== "res" || msg.id !== id) return;
            const p = this._pending.get(msg.id);
            if (!p) return;
            clearTimeout(p.timer);
            this._pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || "unknown error"));
          };
          this._reg.active.postMessage(payload, [ch.port2]);
        } else {
          const any = this._reg?.waiting || this._reg?.installing;
          if (any) {
            const ch = new MessageChannel();
            ch.port1.onmessage = (e) => {
              const msg = e.data || {};
              if (msg.type !== "res" || msg.id !== id) return;
              const p = this._pending.get(msg.id);
              if (!p) return;
              clearTimeout(p.timer);
              this._pending.delete(msg.id);
              if (msg.ok) p.resolve(msg.result);
              else p.reject(new Error(msg.error || "unknown error"));
            };
            any.postMessage(payload, [ch.port2]);
          } else {
            throw new Error("service worker controller not available");
          }
        }
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
    if (msg.type === "evt" && msg.evt) {
      this.onEvent(msg.evt);
      return;
    }

    // rpc responses
    if (msg.type === "res") {
      const p = this._pending.get(msg.id);
      if (!p) return;

      clearTimeout(p.timer);
      this._pending.delete(msg.id);

      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "unknown error"));
    }
  }

  _waitForController(timeoutMs = 8000) {
    if (navigator.serviceWorker.controller) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        if (navigator.serviceWorker.controller) {
          cleanup();
          console.log("[client] controllerchange: controller set");
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          cleanup();
          console.warn("[client] controller wait timeout");
          reject(new Error("service worker controller not available"));
        }
      };

      const onChange = () => tick();
      const cleanup = () => {
        clearInterval(iv);
        navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      };

      navigator.serviceWorker.addEventListener("controllerchange", onChange);
      const iv = setInterval(tick, 100);
      tick();
    });
  }
}
