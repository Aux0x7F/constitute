// FILE: identity/sw/directory.js

import { kvGet, kvSet } from './idb.js';

const KEY = 'directory';
const CAP = 200;

export async function directoryList() {
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  return arr.sort((a, b) => (b?.lastSeen || 0) - (a?.lastSeen || 0));
}

export async function directoryUpsert(entry) {
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  const id = String(entry?.identityId || '').trim();
  if (!id) return { ok: false };

  const next = arr.filter(e => e?.identityId !== id);
  next.unshift({
    identityId: id,
    identityLabel: String(entry?.identityLabel || ''),
    neighborhood: String(entry?.neighborhood || ''),
    lastSeen: Number(entry?.lastSeen || Date.now()),
    devicePk: String(entry?.devicePk || ''),
  });

  while (next.length > CAP) next.pop();
  await kvSet(KEY, next);
  return { ok: true };
}
