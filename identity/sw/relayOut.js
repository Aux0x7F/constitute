// FILE: identity/sw/relayOut.js

import { signEventUnsigned } from './nostr.js';
import { ensureDevice } from './deviceStore.js';

const APP_TAG = 'constitute';
const SUB_ID = 'constitute_sub_v2';

function nowSec() { return Math.floor(Date.now() / 1000); }

export function getSubId() { return SUB_ID; }
export function getAppTag() { return APP_TAG; }

export async function relaySend(sw, frameArr) {
  const frame = JSON.stringify(frameArr);
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'relay.tx', data: frame });
  });
}

export async function subscribeOnRelayOpen(sw, ident, logFn) {
  const filters = [{ kinds: [1], '#t': [APP_TAG], limit: 200 }];

  if (ident?.label) {
    filters.unshift({ kinds: [1], '#t': [APP_TAG], '#i': [ident.label], limit: 200 });
  }

  await relaySend(sw, ['REQ', SUB_ID, ...filters]);
  if (logFn) logFn(`sent REQ subscribe`);
}

export async function publishAppEvent(sw, payloadObj, extraTags = []) {
  const dev = await ensureDevice();

  const unsigned = {
    kind: 1,
    created_at: nowSec(),
    tags: [['t', APP_TAG], ...extraTags],
    content: JSON.stringify(payloadObj),
    pubkey: dev.nostr.pk,
  };

  const ev = signEventUnsigned(unsigned, dev.nostr.skHex);
  await relaySend(sw, ['EVENT', ev]);
  return ev.id;
}
