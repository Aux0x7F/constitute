// FILE: identity/sw/notifs.js

import { kvGet, kvSet } from './idb.js';

export async function notifAdd(n) {
  const list = (await kvGet('notifications')) || [];
  list.unshift(n);
  while (list.length > 200) list.pop();
  await kvSet('notifications', list);
}

export async function notifList() {
  return (await kvGet('notifications')) || [];
}

export async function notifMarkRead(id) {
  const list = (await kvGet('notifications')) || [];
  for (const n of list) {
    if (n.id === id) n.read = true;
  }
  await kvSet('notifications', list);
}

export async function notifClear() {
  await kvSet('notifications', []);
}
