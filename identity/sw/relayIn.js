// FILE: identity/sw/relayIn.js

import { nip04Decrypt } from './nostr.js';
import { getDevice } from './deviceStore.js';
import { getIdentity, setIdentity } from './identityStore.js';
import { notifAdd, notifClear, notifRemove } from './notifs.js';
import { pendingAdd, pendingRemove } from './pending.js';
import { getSubId, getAppTag, subscribeOnRelayOpen as relaySubscribeOnRelayOpen } from './relayOut.js';
import { log, pokeUi } from './uiBus.js';
import { blockedAdd, blockedIs, blockedRemove } from './blocklist.js';
import { kvGet, kvSet } from './idb.js';

const REPLAY_WINDOW_SEC = 10 * 60;
const REPLAY_SKEW_SEC = 2 * 60;
const REPLAY_CAP = 400;

async function replayAccept(identityLabel, ev) {
  const id = String(ev?.id || '').trim();
  const ts = Number(ev?.created_at || 0);
  if (!identityLabel || !id || !ts) return false;

  const now = Math.floor(Date.now() / 1000);
  if (ts < now - REPLAY_WINDOW_SEC) return false;
  if (ts > now + REPLAY_SKEW_SEC) return false;

  const key = `replay:${identityLabel}`;
  const list = (await kvGet(key)) || [];
  const keep = [];
  let seen = false;

  for (const it of (Array.isArray(list) ? list : [])) {
    if (!it?.id || !it?.ts) continue;
    if (it.ts < now - REPLAY_WINDOW_SEC) continue;
    if (it.id === id) { seen = true; continue; }
    keep.push(it);
  }

  if (seen) return false;

  keep.unshift({ id, ts });
  if (keep.length > REPLAY_CAP) keep.length = REPLAY_CAP;
  await kvSet(key, keep);
  return true;
}


export async function subscribeOnRelayOpen(sw) {
  // handled by rpc (relay.status) using relayOut.subscribeOnRelayOpen
  // kept for compatibility if any caller uses it directly
  return;
}

export async function handleRelayFrame(sw, raw) {
  const s = String(raw || '');
  if (!s) return;

  let msg;
  try { msg = JSON.parse(s); } catch { return; }
  const [type] = msg;

  if (type === 'NOTICE') { log(sw, `NOTICE: ${String(msg[1] || '').slice(0, 160)}`); return; }
  if (type === 'EOSE') { return; }
  if (type !== 'EVENT') return;

  const subId = msg[1];
  const ev = msg[2];
  if (subId !== getSubId() || !ev) return;

  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const hasAppTag = tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === getAppTag());
  if (!hasAppTag) return;

  // Drop frames from blocked senders (minimal implicit trust).
  // NOTE: This is separate from payload.devicePk checks below.
  const senderPk = String(ev.pubkey || '').trim();
  if (senderPk && await blockedIs({ pk: senderPk })) return;

  let payload = null;
  try { payload = JSON.parse(ev.content || ''); } catch { return; }
  if (!payload?.type) return;

  const dev = await getDevice();
  const ident = await getIdentity();

  // optional identity scoping
  const identityTag = tags.find(t => Array.isArray(t) && t[0] === 'i');
  const scopedLabel = identityTag?.[1] || null;
  if (ident?.label && scopedLabel && scopedLabel !== ident.label) return;

  const replayIdentity = String(payload.identity || scopedLabel || '').trim();
  if (replayIdentity) {
    const ok = await replayAccept(replayIdentity, ev);
    if (!ok) return;
  }

  // --- Device blocked / unblocked (blacklist convergence) ---
  if (payload.type === 'device_blocked') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;
    const targetPk = String(payload.targetPk || '').trim();
    if (!targetPk) return;

    await blockedAdd({ pk: targetPk, reason: payload.reason || 'blocked' });

    // Remove any pending requests from that device
    await pendingRemove(`${payload.identity}:${payload.code || ''}:${targetPk}`).catch(() => {});

    pokeUi(sw);
    return;
  }

  if (payload.type === 'device_unblocked') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;
    const targetPk = String(payload.targetPk || '').trim();
    if (!targetPk) return;
    await blockedRemove({ pk: targetPk });
    pokeUi(sw);
    return;
  }

  // --- Identity label update ---
  if (payload.type === 'identity_label_update') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;
    const nextLabel = String(payload.newLabel || '').trim();
    if (!nextLabel) return;
    ident.label = nextLabel;
    await setIdentity(ident);
    await relaySubscribeOnRelayOpen(sw, ident).catch(() => {});
    pokeUi(sw);
    return;
  }

  // --- Device label update ---
  if (payload.type === 'device_label_update') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;
    const targetPk = String(payload.devicePk || '').trim();
    if (!targetPk) return;
    ident.devices = Array.isArray(ident.devices) ? ident.devices : [];
    for (const d of ident.devices) {
      if (d?.pk === targetPk) {
        d.label = String(payload.deviceLabel || d.label || '').trim();
        if (payload.deviceDid) d.did = String(payload.deviceDid || d.did || '').trim();
      }
    }
    await setIdentity(ident);
    pokeUi(sw);
    return;
  }

  // --- Pair request ---
  if (payload.type === 'pair_request') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;

    // Ignore requests from blocked devices.
    if (await blockedIs({ pk: payload.devicePk, did: payload.deviceDid })) return;

    const known = new Set((ident.devices || []).map(d => d.pk).filter(Boolean));
    if (payload.devicePk && known.has(payload.devicePk)) {
      const staleId = `${payload.identity}:${payload.code}:${payload.devicePk}`;
      await pendingRemove(staleId);
      return;
    }

    const reqId = `${payload.identity}:${payload.code}:${payload.devicePk}`;
    const req = {
      id: reqId,
      identityLabel: payload.identity,
      code: payload.code,
      devicePk: payload.devicePk,
      deviceDid: payload.deviceDid,
      deviceLabel: payload.deviceLabel || '',
      ts: Date.now(),
      status: 'pending',
    };
    await pendingAdd(req);

    await notifAdd({
      id: `n-pair-${reqId}`,
      kind: 'pairing',
      title: 'Pairing request',
      body: `${req.deviceLabel || 'Device'} wants to join ${payload.identity} (code ${payload.code})`,
      ts: Date.now(),
      read: false,
    });

    pokeUi(sw);
    return;
  }

  // --- Pair approve (encrypted room key) ---
  if (payload.type === 'pair_approve') {
    if (payload.toPk !== dev.nostr.pk) return;

    try {
      const plaintext = await nip04Decrypt(dev.nostr.skHex, payload.fromPk, payload.encryptedRoomKey);
      const obj = JSON.parse(plaintext);

      // Adopt identity
      await setIdentity({
        id: String(obj.identityId || ''),
        label: String(payload.identity || ''),
        roomKeyB64: String(obj.roomKeyB64 || ''),
        linked: true,
        devices: Array.isArray(obj.devices) ? obj.devices : [],
      });

      await notifAdd({
        id: `n-approve-${payload.identity}-${payload.code}`,
        kind: 'pairing',
        title: 'Pairing approved',
        body: `Approved for ${payload.identity} (code ${payload.code})`,
        ts: Date.now(),
        read: false,
      });

      pokeUi(sw);
    } catch (e) {
      log(sw, `pair_approve decrypt failed: ${String(e?.message || e)}`);
    }
    return;
  }

  // --- Pair reject ---
  if (payload.type === 'pair_reject') {
    if (payload.toPk !== dev.nostr.pk) return;

    // Add blocker for the identity that rejected us (defensive).
    if (payload.fromPk) await blockedAdd({ pk: payload.fromPk, reason: 'rejected_by' });

    await notifAdd({
      id: `n-reject-${payload.identity}-${payload.code}`,
      kind: 'pairing',
      title: 'Pairing rejected',
      body: `Request rejected for ${payload.identity} (code ${payload.code})`,
      ts: Date.now(),
      read: false,
    });

    pokeUi(sw);
    return;
  }

  // --- Pair resolved ---
  if (payload.type === 'pair_resolved') {
    if (!ident?.label || payload.identity !== ident.label) return;
    const rid = String(payload.requestId || '');
    if (rid) await pendingRemove(rid);
    if (rid) await notifRemove(`n-pair-${rid}`).catch(() => {});
    if (payload.devicePk && payload.code) {
      const alt = `${payload.identity}:${payload.code}:${payload.devicePk}`;
      await pendingRemove(alt);
    }
    pokeUi(sw);
    return;
  }

  // --- Notifications clear ---
  if (payload.type === 'notifications_clear') {
    if (!ident?.label || payload.identity !== ident.label) return;
    await notifClear();
    pokeUi(sw);
    return;
  }

  // --- Room key update (PHASE-1 rotation distribution) ---
  if (payload.type === 'room_key_update') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;
    if (payload.toPk !== dev.nostr.pk) return;

    try {
      const plaintext = await nip04Decrypt(dev.nostr.skHex, payload.fromPk, payload.encryptedRoomKey);
      const obj = JSON.parse(plaintext);
      if (!obj?.roomKeyB64) throw new Error('bad key update payload');

      ident.roomKeyB64 = obj.roomKeyB64;
      await setIdentity(ident);
      pokeUi(sw);
    } catch (e) {
      log(sw, `room_key_update decrypt failed: ${String(e?.message || e)}`);
    }
    return;
  }

  // --- Device revoked (PHASE-1 convergence) ---
  if (payload.type === 'device_revoked') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;

    const targetPk = String(payload.targetPk || '').trim();
    if (!targetPk) return;

    // Add to local blacklist.
    await blockedAdd({ pk: targetPk, reason: 'revoked' });

    // If it’s us: unlink immediately (we will not receive new keys)
    if (targetPk === dev.nostr.pk) {
      await setIdentity({
        id: '',
        label: '',
        roomKeyB64: '',
        linked: false,
        devices: [],
      });
      await notifAdd({
        id: `n-revoked-${Date.now()}`,
        kind: 'security',
        title: 'Device revoked',
        body: 'This device was removed from the identity.',
        ts: Date.now(),
        read: false,
      });
      pokeUi(sw);
      return;
    }

    // Otherwise remove from our known devices list
    ident.devices = (ident.devices || []).filter(d => d.pk !== targetPk);
    await setIdentity(ident);
    pokeUi(sw);
    return;
  }
}
