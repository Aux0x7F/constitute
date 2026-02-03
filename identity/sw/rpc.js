// FILE: identity/sw/rpc.js

import { kvSet } from './idb.js';
import { randomBytes, b64url, sha256B64Url } from './crypto.js';
import { ensureDevice, setThisDeviceLabel } from './deviceStore.js';
import { getIdentity, setIdentity, getProfile, setProfile, setPendingJoinIdentityLabel } from './identityStore.js';
import { notifList, notifMarkRead, notifRemove, notifClear } from './notifs.js';
import { pendingList, pendingRemove } from './pending.js';
import { log, status, pokeUi } from './uiBus.js';
import { relaySend, subscribeOnRelayOpen as subOpen, publishAppEvent } from './relayOut.js';
import { nip04Encrypt } from './nostr.js';
import { revokeDeviceAndRotate } from './revoke.js';
import { handleRelayFrame } from './relayIn.js';
import { blockedList, blockedRemove } from './blocklist.js';
import { directoryList } from './directory.js';
import { chatAdd, chatList } from './chatStore.js';
import { listNeighborhoods, addNeighborhood, joinNeighborhood, publishNeighborhoodPresence } from './neighborhood.js';

function makePairCode() {
  return (Math.floor(Math.random() * 900000) + 100000).toString();
}

async function chatQueueId(a, b) {
  const s = [String(a || ''), String(b || '')].sort().join('|');
  const h = await sha256B64Url(s);
  return h.slice(0, 20);
}

export async function handleRpc(sw, method, params, getRelayState, setRelayState) {
  // --- device state ---
  if (method === 'device.getState') {
    const dev = await ensureDevice();
    const ident = await getIdentity();
    return {
      did: dev.did,
      didMethod: dev.didMethod,
      identityLinked: !!ident?.linked,
      pk: dev.nostr?.pk,
    };
  }

  if (method === 'device.wantWebAuthnUpgrade') {
    const dev = await ensureDevice();
    if (dev.didMethod === 'webauthn' && dev.webauthnCredId) return { ok: false };
    return { ok: true, deviceIdHint: dev.deviceId };
  }

  if (method === 'device.setWebAuthn') {
    const dev = await ensureDevice();
    const credIdB64 = String(params?.credIdB64 || '').trim();
    if (!credIdB64) throw new Error('missing credIdB64');

    dev.didMethod = 'webauthn';
    dev.webauthnCredId = credIdB64;
    dev.did = `did:device:webauthn:${credIdB64}`;
    await kvSet('device', dev);
    return { did: dev.did, didMethod: dev.didMethod };
  }

  if (method === 'device.noteWebAuthnSkipped') {
    status(sw, 'WebAuthn skipped');
    return { ok: true };
  }

  if (method === 'device.getLabel') {
    const dev = await ensureDevice();
    return { label: dev.label || '' };
  }

  if (method === 'device.setLabel') {
    const label = String(params?.label || '').trim();
    if (!label) throw new Error('missing label');
    await setThisDeviceLabel(label);
    const ident = await getIdentity();
    if (ident?.linked && ident?.label) {
      const dev = await ensureDevice();
      ident.devices = Array.isArray(ident.devices) ? ident.devices : [];
      for (const d of ident.devices) {
        if (d?.pk === dev.nostr.pk) {
          d.label = label;
          d.did = dev.did || d.did || '';
        }
      }
      await setIdentity(ident);

      await publishAppEvent(sw, {
        type: 'device_label_update',
        identity: ident.label,
        devicePk: dev.nostr.pk,
        deviceDid: dev.did,
        deviceLabel: label,
      }, [['i', ident.label]]);
    }
    pokeUi(sw);
    return { ok: true };
  }

  // --- profile ---
  if (method === 'profile.get') return await getProfile();
  if (method === 'profile.set') {
    const name = String(params?.name || '').trim();
    const about = String(params?.about || '').trim();
    await setProfile({ name, about });
    pokeUi(sw);
    return { ok: true };
  }

  // --- identity ---
  if (method === 'identity.get') {
    const ident = await getIdentity();
    return ident || { id: '', label: '', linked: false, devices: [], roomKeyB64: '' };
  }

  if (method === 'neighborhoods.list') {
    const ident = await getIdentity();
    return await listNeighborhoods(ident || {});
  }

  if (method === 'neighborhoods.add') {
    const name = String(params?.name || '').trim();
    if (!name) throw new Error('missing name');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    const dev = await ensureDevice();
    const res = await addNeighborhood(ident, name);
    if (res?.key) await publishNeighborhoodPresence(sw, ident, dev, res.key).catch(() => {});
    pokeUi(sw);
    return res;
  }

  if (method === 'neighborhoods.join') {
    const key = String(params?.key || '').trim();
    const name = String(params?.name || '').trim();
    if (!key) throw new Error('missing key');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    const dev = await ensureDevice();
    const res = await joinNeighborhood(ident, key, name);
    if (res?.key) await publishNeighborhoodPresence(sw, ident, dev, res.key).catch(() => {});
    pokeUi(sw);
    return res;
  }

  if (method === 'directory.list') {
    return await directoryList();
  }

  if (method === 'identity.create') {
    // REQUIRED: must not already have a linked identity on this device
    const existing = await getIdentity();
    if (existing?.linked) {
      throw new Error(`identity already exists on this device (${existing.label || 'unknown'})`);
    }

    const dev = await ensureDevice();
    const identityLabel = String(params?.identityLabel || '').trim();
    const deviceLabel = String(params?.deviceLabel || '').trim();
    if (!deviceLabel) throw new Error('device label required');
    if (!identityLabel) throw new Error('identity label required');

    dev.label = deviceLabel;
    await kvSet('device', dev);

    const roomKey = randomBytes(32);
    const ident = {
      id: `id-${b64url(randomBytes(12))}`,
      label: identityLabel,
      roomKeyB64: b64url(roomKey),
      linked: true,
      devices: [{ did: dev.did, pk: dev.nostr.pk, label: deviceLabel }],
    };
    await setIdentity(ident);

    await publishAppEvent(sw, {
      type: 'identity_created',
      identity: identityLabel,
      identityId: ident.id,
      devicePk: dev.nostr.pk,
      deviceLabel,
    }, [['i', identityLabel]]);

    const nbs = await listNeighborhoods(ident || {});
    for (const n of nbs) {
      await publishNeighborhoodPresence(sw, ident, dev, n.key).catch(() => {});
    }

    status(sw, 'identity created');
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'identity.setLabel') {
    const identityLabel = String(params?.identityLabel || '').trim();
    if (!identityLabel) throw new Error('identity label required');

    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');

    const prev = ident.label || '';
    ident.label = identityLabel;
    await setIdentity(ident);

    const dev = await ensureDevice();
    const nbs = await listNeighborhoods(ident || {});
    for (const n of nbs) {
      await publishNeighborhoodPresence(sw, ident, dev, n.key).catch(() => {});
    }

    await publishAppEvent(sw, {
      type: 'identity_label_update',
      identity: prev,
      newLabel: identityLabel,
    }, [['i', prev]]);

    status(sw, 'identity label updated');
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'identity.newPairCode') {
    const ident = await getIdentity();
    if (!ident?.linked || !ident?.label) throw new Error('no linked identity');
    const code = makePairCode();
    await kvSet('pairCode', { code, ts: Date.now() });
    return { code };
  }

  if (method === 'identity.requestPair') {
    const dev = await ensureDevice();
    const identityLabel = String(params?.identityLabel || '').trim();
    let code = String(params?.code || '').trim();
    const deviceLabel = String(params?.deviceLabel || '').trim();
    if (!identityLabel) throw new Error('identity label required');
    if (!deviceLabel) throw new Error('device label required');

    // If caller didn't provide a code, generate one on the joining device.
    if (!code) code = makePairCode();

    dev.label = deviceLabel;
    await kvSet('device', dev);
    await setPendingJoinIdentityLabel(identityLabel);

    await publishAppEvent(sw, {
      type: 'pair_request',
      identity: identityLabel,
      code,
      devicePk: dev.nostr.pk,
      deviceDid: dev.did,
      deviceLabel,
    }, [['i', identityLabel]]);

    status(sw, 'pair request sent');
    pokeUi(sw);
    return { ok: true, code };
  }

  // --- notifications ---
  if (method === 'notifications.list') return await notifList();

  if (method === 'notifications.read') {
    const id = String(params?.id || '').trim();
    if (!id) throw new Error('missing id');
    await notifMarkRead(id);
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'notifications.remove') {
    const id = String(params?.id || '').trim();
    if (!id) throw new Error('missing id');
    await notifRemove(id);
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'notifications.clear') {
    const ident = await getIdentity();
    await notifClear();

    if (ident?.linked && ident?.label) {
      await publishAppEvent(sw, { type: 'notifications_clear', identity: ident.label }, [['i', ident.label]]);
    }
    pokeUi(sw);
    return { ok: true };
  }

  // --- blocked devices ---
  if (method === 'blocked.list') return await blockedList();
  if (method === 'blocked.remove') {
    const pk = String(params?.pk || '').trim();
    const did = String(params?.did || '').trim();
    if (!pk && !did) throw new Error('missing pk or did');
    return await blockedRemove({ pk, did });
  }

  // --- relay pipe ---
  if (method === 'relay.status') {
    const state = String(params?.state || '');
    const url = String(params?.url || '');
    if (state && state !== getRelayState()) {
      setRelayState(state);
      log(sw, `relay state -> ${state} ${url}`);
    }
    if (state === 'open') {
      const ident = await getIdentity();
      const dev = await ensureDevice();
      await subOpen(sw, ident, (m) => log(sw, m));
      const nbs = await listNeighborhoods(ident || {});
      for (const n of nbs) {
        await publishNeighborhoodPresence(sw, ident, dev, n.key).catch(() => {});
      }
    }
    return { ok: true };
  }

  if (method === 'relay.rx') {
    await handleRelayFrame(sw, params?.data || '');
    return { ok: true };
  }

  if (method === 'relay.tx') {
    const frame = String(params?.data || '');
    relaySend(sw, frame);
    return { ok: true };
  }

  // --- pairing ---
  if (method === 'pairing.list') return await pendingList();

  if (method === 'pairing.reject') {
    const rid = String(params?.requestId || '');
    if (!rid) throw new Error('missing requestId');

    const reqs = await pendingList();
    const r = reqs.find(x => x.id === rid);
    if (!r) throw new Error('request not found');

    const dev = await ensureDevice();

    await publishAppEvent(sw, {
      type: 'pair_reject',
      identity: r.identityLabel,
      code: r.code,
      toPk: r.devicePk,
      fromPk: dev.nostr.pk,
    }, [['i', r.identityLabel], ['p', r.devicePk]]);

    await publishAppEvent(sw, {
      type: 'pair_resolved',
      identity: r.identityLabel,
      requestId: rid,
      code: r.code,
      devicePk: r.devicePk,
      status: 'rejected',
    }, [['i', r.identityLabel], ['p', r.devicePk]]);

    await pendingRemove(rid);
    await notifRemove(`n-pair-${rid}`);
    status(sw, 'rejected');
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'pairing.approve') {
    const rid = String(params?.requestId || '');
    if (!rid) throw new Error('missing requestId');

    const ident = await getIdentity();
    if (!ident?.linked || !ident?.roomKeyB64) throw new Error('no linked identity on this device');

    const reqs = await pendingList();
    const r = reqs.find(x => x.id === rid);
    if (!r) throw new Error('request not found');

    // ✅ FIX: add device BEFORE sending the encrypted payload so the joiner sees itself.
    ident.devices = Array.isArray(ident.devices) ? ident.devices : [];
    const exists = ident.devices.some(d => d.pk === r.devicePk);
    if (!exists) {
      ident.devices.push({ pk: r.devicePk, did: r.deviceDid || '', label: r.deviceLabel || '' });
      await setIdentity(ident);
    }

    const dev = await ensureDevice();

    const payload = JSON.stringify({
      identityId: ident.id,
      roomKeyB64: ident.roomKeyB64,
      devices: ident.devices,
    });

    const encryptedRoomKey = await nip04Encrypt(dev.nostr.skHex, r.devicePk, payload);

    await publishAppEvent(sw, {
      type: 'pair_approve',
      identity: r.identityLabel,
      code: r.code,
      toPk: r.devicePk,
      fromPk: dev.nostr.pk,
      encryptedRoomKey,
    }, [['i', r.identityLabel], ['p', r.devicePk]]);

    await publishAppEvent(sw, {
      type: 'pair_resolved',
      identity: r.identityLabel,
      requestId: rid,
      code: r.code,
      devicePk: r.devicePk,
      status: 'approved',
    }, [['i', r.identityLabel], ['p', r.devicePk]]);

    await pendingRemove(rid);
    await notifRemove(`n-pair-${rid}`);

    status(sw, 'approved');
    pokeUi(sw);
    return { ok: true };
  }

  // --- chat ---
  if (method === 'chat.open') {
    const peerIdentityId = String(params?.peerIdentityId || '').trim();
    if (!peerIdentityId) throw new Error('missing peerIdentityId');
    const ident = await getIdentity();
    if (!ident?.linked || !ident?.id) throw new Error('no linked identity');
    const queueId = await chatQueueId(ident.id, peerIdentityId);
    const messages = await chatList(queueId);
    return { queueId, messages };
  }

  if (method === 'chat.list') {
    const queueId = String(params?.queueId || '').trim();
    if (!queueId) throw new Error('missing queueId');
    return await chatList(queueId);
  }

  if (method === 'chat.send') {
    const peerIdentityId = String(params?.peerIdentityId || '').trim();
    const body = String(params?.body || '').trim();
    if (!peerIdentityId) throw new Error('missing peerIdentityId');
    if (!body) throw new Error('missing body');

    const ident = await getIdentity();
    if (!ident?.linked || !ident?.id) throw new Error('no linked identity');

    const queueId = await chatQueueId(ident.id, peerIdentityId);
    const ts = Date.now();

    const payload = {
      type: 'chat_message',
      identity: ident.label || '',
      identityId: ident.id,
      toIdentityId: peerIdentityId,
      queueId,
      body,
      ts,
    };

    const evId = await publishAppEvent(sw, payload, [
      ['app', 'chat'],
      ['q', queueId],
      ['i', ident.label || ''],
    ]);

    await chatAdd(queueId, {
      id: evId,
      queueId,
      fromIdentityId: ident.id,
      toIdentityId: peerIdentityId,
      fromLabel: ident.label || '',
      body,
      ts,
    });

    pokeUi(sw);
    return { ok: true, queueId, id: evId };
  }

  // --- revoke + rotate (kept) ---
  if (method === 'devices.revoke' || method === 'device.revoke') {
    const pk = String(params?.pk || '').trim();
    if (!pk) throw new Error('missing pk');
    const res = await revokeDeviceAndRotate(sw, pk);
    status(sw, 'device revoked');
    pokeUi(sw);
    return res;
  }

  throw new Error(`unknown method: ${method}`);
}
