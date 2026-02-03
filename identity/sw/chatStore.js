// FILE: identity/sw/chatStore.js

import { kvGet, kvSet } from './idb.js';

function key(queueId) {
  return `chat:${queueId}`;
}

export async function chatList(queueId) {
  const q = String(queueId || '').trim();
  if (!q) return [];
  const list = (await kvGet(key(q))) || [];
  const arr = Array.isArray(list) ? list : [];
  return arr.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
}

export async function chatAdd(queueId, msg) {
  const q = String(queueId || '').trim();
  if (!q || !msg?.id) return { ok: false };
  const list = (await kvGet(key(q))) || [];
  const arr = Array.isArray(list) ? list : [];
  if (arr.some(m => m?.id === msg.id)) return { ok: true, dedup: true };
  arr.push(msg);
  while (arr.length > 500) arr.shift();
  await kvSet(key(q), arr);
  return { ok: true };
}
