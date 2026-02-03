// FILE: identity/sw/pending.js

import { kvGet, kvSet } from './idb.js';
import { getIdentity } from './identityStore.js';
import { blockedIs } from './blocklist.js';

export async function pendingAdd(req) {
  const list = (await kvGet('pairPending')) || [];
  if (!list.some(x => x.id === req.id)) list.unshift(req);
  await kvSet('pairPending', list);
}

export async function pendingList() {
  const list = (await kvGet('pairPending')) || [];
  const ident = await getIdentity();
  const known = new Set((ident?.devices || []).map(d => d.pk).filter(Boolean));

  // Filter out:
  // - requests for already-known devices (stale)
  // - requests from blocked/rejected/revoked devices
  const out = [];
  for (const r of (Array.isArray(list) ? list : [])) {
    if (r?.devicePk && known.has(r.devicePk)) continue;
    if (await blockedIs({ pk: r?.devicePk, did: r?.deviceDid })) continue;
    out.push(r);
  }
  return out;
}

export async function pendingRemove(id) {
  const list = (await kvGet('pairPending')) || [];
  await kvSet('pairPending', (Array.isArray(list) ? list : []).filter(x => x.id !== id));
}
