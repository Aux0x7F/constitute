// FILE: identity/sw/relayIn.js

import { nip04Decrypt } from './nostr.js';
import { getDevice, getThisDeviceLabel } from './deviceStore.js';
import { getIdentity, setIdentity, getPendingJoinIdentityLabel, setPendingJoinIdentityLabel } from './identityStore.js';
import { notifAdd, notifClear } from './notifs.js';
import { pendingAdd, pendingRemove } from './pending.js';
import { getSubId, getAppTag } from './relayOut.js';
import { log, status, pokeUi } from './uiBus.js';

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

  let payload = null;
  try { payload = JSON.parse(ev.content || ''); } catch { return; }
  if (!payload?.type) return;

  const dev = await getDevice();
  const ident = await getIdentity();

  // optional identity scoping
  const identityTag = tags.find(t => Array.isArray(t) && t[0] === 'i');
  const scopedLabel = identityTag?.[1] || null;
  if (ident?.label && scopedLabel && scopedLabel !== ident.label) return;

  // --- Pair request ---
  if (payload.type === 'pair_request') {
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;

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
      created_at: ev.created_at,
    };
    await pendingAdd(req);

    await notifAdd({
      id: `n-${reqId}`,
      kind: 'pairing',
      title: 'Pairing request',
      body: `${payload.deviceLabel || 'device'} wants to join ${payload.identity} (code ${payload.code})`,
      ts: Date.now(),
      read: false,
    });

    pokeUi(sw);
    return;
  }

  // --- Pair approve ---
  if (payload.type === 'pair_approve') {
    if (payload.toPk !== dev.nostr.pk) return;

    const wanted = await getPendingJoinIdentityLabel();
    if (wanted && payload.identity !== wanted) return;

    try {
      const plaintext = await nip04Decrypt(dev.nostr.skHex, payload.fromPk, payload.encryptedRoomKey);
      const obj = JSON.parse(plaintext);
      if (!obj?.roomKeyB64 || !obj?.identityId) throw new Error('bad approval payload');

      const newIdent = {
        id: obj.identityId,
        label: payload.identity,
        roomKeyB64: obj.roomKeyB64,
        linked: true,
        devices: obj.devices || [],
      };

      const meLabel = await getThisDeviceLabel();
      const exists = newIdent.devices.some(d => d.pk === dev.nostr.pk);
      if (!exists) newIdent.devices.push({ pk: dev.nostr.pk, did: dev.did, label: meLabel });

      await setIdentity(newIdent);

      await notifAdd({
        id: `n-approve-${payload.identity}-${payload.code}`,
        kind: 'pairing',
        title: 'Device paired',
        body: `Joined identity ${payload.identity}`,
        ts: Date.now(),
        read: false,
      });

      await setPendingJoinIdentityLabel(null);

      status(sw, `paired into ${payload.identity}`);
      pokeUi(sw);
    } catch (e) {
      log(sw, `pair_approve decrypt failed: ${String(e?.message || e)}`);
    }
    return;
  }

  // --- Pair reject ---
  if (payload.type === 'pair_reject') {
    if (payload.toPk !== dev.nostr.pk) return;
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

    const targetPk = payload.targetPk;
    if (!targetPk) return;

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
