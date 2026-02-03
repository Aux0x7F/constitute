// FILE: identity/sw/blocklist.js
//
// A device/request blacklist (revoked or rejected). This is authoritative state in the daemon,
// never a UI-only artifact.
//
// Stored in IDB key: 'blockedDevices' as an array of entries:
//   { pk, did, reason, ts }

import { kvGet, kvSet } from './idb.js';

const KEY = 'blockedDevices';

function normPk(pk) {
  const s = String(pk || '').trim();
  return s || null;
}
function normDid(did) {
  const s = String(did || '').trim();
  return s || null;
}

export async function blockedList() {
  const list = (await kvGet(KEY)) || [];
  // newest first
  return Array.isArray(list) ? list : [];
}

export async function blockedIs({ pk, did } = {}) {
  const p = normPk(pk);
  const d = normDid(did);
  if (!p && !d) return false;

  const list = await blockedList();
  return list.some(e => (p && e?.pk === p) || (d && e?.did === d));
}

export async function blockedAdd({ pk, did, reason = 'blocked', ts = Date.now() } = {}) {
  const p = normPk(pk);
  const d = normDid(did);
  if (!p && !d) return { ok: false };

  const list = await blockedList();
  const next = list.filter(e => !((p && e?.pk === p) || (d && e?.did === d)));

  next.unshift({
    pk: p || '',
    did: d || '',
    reason: String(reason || 'blocked'),
    ts: Number(ts || Date.now()),
  });

  // cap size to avoid unbounded growth
  while (next.length > 200) next.pop();

  await kvSet(KEY, next);
  return { ok: true };
}

export async function blockedRemove({ pk, did } = {}) {
  const p = normPk(pk);
  const d = normDid(did);
  if (!p && !d) return { ok: false };

  const list = await blockedList();
  const next = list.filter(e => !((p && e?.pk === p) || (d && e?.did === d)));
  await kvSet(KEY, next);
  return { ok: true };
}
