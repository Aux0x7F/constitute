// FILE: identity/sw/daemon.js

import { emit, status, log, pokeUi } from './uiBus.js';
import { ensureDevice } from './deviceStore.js';
import { getIdentity } from './identityStore.js';
import { handleRpc } from './rpc.js';
import { handleRelayFrame, subscribeOnRelayOpen } from './relayIn.js';

export function startDaemon(sw) {
  status(sw, 'identity daemon online');

  let relayState = 'idle';

  sw.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'req') return;

    const { id, method, params } = msg;
    const replyPort = e.ports && e.ports[0] ? e.ports[0] : null;

    (async () => {
      try {
        const result = await handleRpc(
          sw,
          method,
          params || {},
          () => relayState,
          (s) => { relayState = s; }
        );
        if (replyPort) replyPort.postMessage({ type: 'res', id, ok: true, result });
        else if (e.source?.postMessage) e.source.postMessage({ type: 'res', id, ok: true, result });
      } catch (err) {
        if (replyPort) replyPort.postMessage({ type: 'res', id, ok: false, error: String(err?.message || err) });
        else if (e.source?.postMessage) e.source.postMessage({ type: 'res', id, ok: false, error: String(err?.message || err) });
      }
    })();
  });

  // Keep a tiny boot sequence to ensure device keys exist early.
  (async () => {
    await ensureDevice();
    const ident = await getIdentity();
    log(sw, `boot ok (linked=${!!ident?.linked})`);
    pokeUi(sw);
  })();
}
