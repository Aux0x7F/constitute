// FILE: identity/sw/neighborhood.js

import { randomBytes, b64url, sha256B64Url } from './crypto.js';
import { kvGet, kvSet } from './idb.js';
import { publishAppEvent } from './relayOut.js';

const KEY = 'neighborhoods';
const CAP = 50;

export async function deriveNeighborhoodKey(ident) {
  const id = String(ident?.id || '').trim();
  const roomKey = String(ident?.roomKeyB64 || '').trim();
  if (!id || !roomKey) return '';
  const raw = `${id}|${roomKey}`;
  const h = await sha256B64Url(raw);
  return h.slice(0, 20);
}

export async function listNeighborhoods(ident) {
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  const next = arr.filter(n => n?.key);

  if (ident?.linked) {
    const defKey = await deriveNeighborhoodKey(ident);
    if (defKey && !next.some(n => n.key === defKey)) {
      next.unshift({ key: defKey, name: 'Private', createdAt: Date.now() });
    }
  }

  while (next.length > CAP) next.pop();
  await kvSet(KEY, next);
  return next;
}

export async function addNeighborhood(ident, name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false };
  const seed = b64url(randomBytes(8));
  const h = await sha256B64Url(`${label}|${seed}`);
  const key = h.slice(0, 20);

  const list = await listNeighborhoods(ident);
  if (list.some(n => n.key === key)) return { ok: true, key };

  list.unshift({ key, name: label, createdAt: Date.now() });
  await kvSet(KEY, list);
  return { ok: true, key };
}

export async function joinNeighborhood(ident, key, name = '') {
  const k = String(key || '').trim();
  if (!k) return { ok: false };
  const list = await listNeighborhoods(ident);
  if (list.some(n => n.key === k)) return { ok: true, key: k };

  list.unshift({ key: k, name: String(name || 'Joined'), createdAt: Date.now() });
  await kvSet(KEY, list);
  return { ok: true, key: k };
}

export async function isNeighborhoodJoined(ident, key) {
  const k = String(key || '').trim();
  if (!k) return false;
  const list = await listNeighborhoods(ident);
  return list.some(n => n.key === k);
}

export async function publishNeighborhoodPresence(sw, ident, dev, key) {
  if (!ident?.linked) return null;
  const nb = String(key || '').trim() || await deriveNeighborhoodKey(ident);
  if (!nb) return null;

  const payload = {
    type: 'neighborhood_presence',
    neighborhood: nb,
    identity: ident.label || '',
    identityId: ident.id,
    identityLabel: ident.label || '',
    devicePk: dev?.nostr?.pk || '',
    ts: Date.now(),
    ttl: 120,
  };

  await publishAppEvent(sw, payload, [['nb', nb]]);
  return nb;
}
