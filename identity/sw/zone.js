// FILE: identity/sw/zone.js

import { randomBytes, b64url, sha256B64Url } from './crypto.js';
import { kvGet, kvSet } from './idb.js';
import { publishAppEvent } from './relayOut.js';

const KEY = 'zones';
const CAP = 50;
const LIST_PREFIX = 'zone_list:';
const PENDING_KEY = 'pendingZoneKey';

function listKey(key) {
  return `${LIST_PREFIX}${String(key || '').trim()}`;
}

export async function deriveZoneKey(ident) {
  const id = String(ident?.id || '').trim();
  const roomKey = String(ident?.roomKeyB64 || '').trim();
  if (!id || !roomKey) return '';
  const raw = `${id}|${roomKey}`;
  const h = await sha256B64Url(raw);
  return h.slice(0, 20);
}

export async function listZones(ident) {
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  const next = arr.filter(n => n?.key);

  while (next.length > CAP) next.pop();
  await kvSet(KEY, next);
  return next;
}

export async function getZoneName(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  const hit = arr.find(z => z.key === k);
  return String(hit?.name || '');
}

export async function setPendingZoneKey(key) {
  const k = String(key || '').trim();
  if (!k) return { ok: false };
  await kvSet(PENDING_KEY, k);
  return { ok: true, key: k };
}

export async function getPendingZoneKey() {
  return await kvGet(PENDING_KEY);
}

export async function clearPendingZoneKey() {
  await kvSet(PENDING_KEY, '');
}

export async function addZone(ident, name) {
  const label = String(name || '').trim();
  if (!label) return { ok: false };
  const seed = b64url(randomBytes(8));
  const h = await sha256B64Url(`${label}|${seed}`);
  const key = h.slice(0, 20);

  const list = await listZones(ident);
  if (list.some(n => n.key === key)) return { ok: true, key };

  list.unshift({ key, name: label, createdAt: Date.now() });
  await kvSet(KEY, list);
  return { ok: true, key };
}

export async function joinZone(ident, key, name = '') {
  const k = String(key || '').trim();
  if (!k) return { ok: false };
  const list = await listZones(ident);
  if (list.some(n => n.key === k)) return { ok: true, key: k };

  list.unshift({ key: k, name: String(name || 'Joined'), createdAt: Date.now() });
  await kvSet(KEY, list);
  return { ok: true, key: k };
}

export async function updateZoneName(key, name) {
  const k = String(key || '').trim();
  const n = String(name || '').trim();
  if (!k || !n) return { ok: false };
  const list = (await kvGet(KEY)) || [];
  const arr = Array.isArray(list) ? list : [];
  const next = arr.map(z => z.key === k ? { ...z, name: n } : z);
  await kvSet(KEY, next);
  return { ok: true };
}

export async function isZoneJoined(ident, key) {
  const k = String(key || '').trim();
  if (!k) return false;
  const list = await listZones(ident);
  return list.some(n => n.key === k);
}

export async function getZoneList(key) {
  const k = String(key || '').trim();
  if (!k) return { ts: 0, members: [] };
  return (await kvGet(listKey(k))) || { ts: 0, members: [] };
}

export async function setZoneList(key, members, ts) {
  const k = String(key || '').trim();
  if (!k) return { ok: false };
  const payload = {
    ts: Number(ts || Date.now()),
    members: Array.isArray(members) ? members : [],
  };
  await kvSet(listKey(k), payload);
  return { ok: true };
}

export function buildMemberEntry(dev, swarm = '') {
  return {
    devicePk: String(dev?.nostr?.pk || ''),
    swarm: String(swarm || ''),
  };
}

export async function addSelfToZoneList(dev, key, swarm = '') {
  const k = String(key || '').trim();
  if (!k) return { ok: false };
  const curr = await getZoneList(k);
  const members = Array.isArray(curr.members) ? curr.members : [];
  const self = buildMemberEntry(dev, swarm);
  const next = members.filter(m => m?.devicePk !== self.devicePk);
  next.unshift(self);
  await setZoneList(k, next, Date.now());
  return { ok: true, members: next };
}

export async function publishZonePresence(sw, ident, dev, key) {
  if (!ident?.linked) return null;
  const z = String(key || '').trim() || await deriveZoneKey(ident);
  if (!z) return null;

  const payload = {
    type: 'zone_presence',
    zone: z,
    devicePk: dev?.nostr?.pk || '',
    swarm: '',
    ts: Date.now(),
    ttl: 120,
  };

  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}

export async function publishZoneList(sw, ident, key, members, ts, name = '') {
  if (!ident?.linked) return null;
  const z = String(key || '').trim();
  if (!z) return null;

  const payload = {
    type: 'zone_list',
    zone: z,
    name: String(name || ''),
    ts: Number(ts || Date.now()),
    members: Array.isArray(members) ? members : [],
  };

  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}

export async function publishZoneListRequest(sw, ident, key) {
  if (!ident?.linked) return null;
  const z = String(key || '').trim();
  if (!z) return null;

  const payload = {
    type: 'zone_list_request',
    zone: z,
    ts: Date.now(),
  };

  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}

export async function publishZoneMeta(sw, ident, key, name) {
  if (!ident?.linked) return null;
  const z = String(key || '').trim();
  const n = String(name || '').trim();
  if (!z || !n) return null;
  const payload = { type: 'zone_meta', zone: z, name: n, ts: Date.now() };
  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}

export async function publishZoneMetaRequest(sw, ident, key) {
  if (!ident?.linked) return null;
  const z = String(key || '').trim();
  if (!z) return null;
  const payload = { type: 'zone_meta_request', zone: z, ts: Date.now() };
  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}

export async function publishZoneProbe(sw, ident, key) {
  if (!ident?.linked) return null;
  const z = String(key || '').trim();
  if (!z) return null;

  const payload = {
    type: 'zone_probe',
    zone: z,
    ts: Date.now(),
  };

  await publishAppEvent(sw, payload, [['z', z]]);
  return z;
}
