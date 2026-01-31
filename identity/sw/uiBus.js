// FILE: identity/sw/uiBus.js

export function emit(sw, evt) {
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'evt', evt });
  });
}

export function status(sw, message) {
  emit(sw, { type: 'status', message });
}

export function log(sw, message) {
  console.log('[SW]', message);
  emit(sw, { type: 'log', message });
}

export function pokeUi(sw) {
  emit(sw, { type: 'notify' });
}
