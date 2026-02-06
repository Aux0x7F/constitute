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
  const identityId = String(entry?.identityId || '').trim();
  const devicePk = String(entry?.devicePk || '').trim();
  if (!identityId && !devicePk) return { ok: false };

  const key = identityId ? `id:${identityId}` : `dev:${devicePk}`;
  const next = arr.filter(e => e?.key !== key);
  next.unshift({
    key,
    identityId,
    identityLabel: String(entry?.identityLabel || ''),
    zone: String(entry?.zone || ''),
    lastSeen: Number(entry?.lastSeen || Date.now()),
    devicePk,
    swarm: String(entry?.swarm || ''),
  });

  while (next.length > CAP) next.pop();
  await kvSet(KEY, next);
  return { ok: true };
}
