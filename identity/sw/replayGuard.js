import { kvGet, kvSet } from './idb.js'

const KEY = 'seen.events.v1'

function now() { return Math.floor(Date.now() / 1000) }

export async function markSeen(id) {
  const s = (await kvGet(KEY)) || {}
  s[id] = now()
  await kvSet(KEY, s)
}

export async function alreadySeen(id) {
  const s = (await kvGet(KEY)) || {}
  return !!s[id]
}
