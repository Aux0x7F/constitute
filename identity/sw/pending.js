// FILE: identity/sw/pending.js

import { kvGet, kvSet } from './idb.js';
import { getIdentity } from './identityStore.js';

export async function pendingAdd(req) {
  const list = (await kvGet('pairPending')) || [];
  if (!list.some(x => x.id === req.id)) list.unshift(req);
  await kvSet('pairPending', list);
}

export async function pendingList() {
  const list = (await kvGet('pairPending')) || [];
  const ident = await getIdentity();
  const known = new Set((ident?.devices || []).map(d => d.pk).filter(Boolean));
  return list.filter(r => !(r?.devicePk && known.has(r.devicePk)));
}

export async function pendingRemove(id) {
  const list = (await kvGet('pairPending')) || [];
  await kvSet('pairPending', list.filter(x => x.id !== id));
}
