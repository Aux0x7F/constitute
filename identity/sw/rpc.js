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
import { listZones, addZone, joinZone, publishZonePresence, publishZoneProbe, publishZoneList, publishZoneListRequest, publishZoneMeta, publishZoneMetaRequest, addSelfToZoneList, getZoneList, getZoneName, getPendingZoneKey, setPendingZoneKey, clearPendingZoneKey } from './zone.js';
import {
  makeIdentityRecord,
  makeDeviceRecord,
  putIdentityRecord,
  putDeviceRecord,
  resolveIdentityById,
  resolveDeviceByPk,
  resolveIdentityForDevice,
  listIdentityRecords,
  listDeviceRecords,
} from './swarm/index.js';

let presenceTimer = null;
let swarmPublishTimer = null;

function makePairCode() {
  return (Math.floor(Math.random() * 900000) + 100000).toString();
}

export async function handleRpc(sw, method, params, getRelayState, setRelayState) {
  const LIST_MAX_AGE_MS = 3 * 60 * 1000;
  async function startPresenceLoop() {
    if (presenceTimer) return;
    presenceTimer = setInterval(async () => {
      const ident = await getIdentity();
      const dev = await ensureDevice();
      const nbs = await listZones(ident || {});
      for (const n of nbs) {
        await publishZonePresence(sw, ident, dev, n.key).catch(() => {});
        const curr = await getZoneList(n.key);
        const age = Date.now() - Number(curr?.ts || 0);
        if (age > LIST_MAX_AGE_MS) {
          await publishZoneListRequest(sw, ident, n.key).catch(() => {});
        }
      }
    }, 90 * 1000);
  }

  async function startSwarmPublishLoop() {
    if (swarmPublishTimer) return;
    const SWARM_PUB_MS = 60 * 1000;
    const publish = async () => {
      const ident = await getIdentity();
      if (!ident?.linked) return;
      const irec = await makeIdentityRecord().catch(() => null);
      const drec = await makeDeviceRecord().catch(() => null);
      if (irec) await publishAppEvent(sw, { type: 'swarm_identity_record', record: irec }).catch(() => {});
      if (drec) await publishAppEvent(sw, { type: 'swarm_device_record', record: drec }).catch(() => {});
      log(sw, 'swarm discovery published');
    };
    await publish();
    swarmPublishTimer = setInterval(publish, SWARM_PUB_MS);
  }
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

  if (method === 'zones.pending.set') {
    const key = String(params?.key || '').trim();
    if (!key) throw new Error('missing key');
    return await setPendingZoneKey(key);
  }

  if (method === 'zones.pending.get') {
    return await getPendingZoneKey();
  }

  if (method === 'zones.pending.clear') {
    await clearPendingZoneKey();
    return { ok: true };
  }

  if (method === 'zones.list') {
    const ident = await getIdentity();
    return await listZones(ident || {});
  }

  if (method === 'zones.meta.request') {
    const key = String(params?.key || '').trim();
    if (!key) throw new Error('missing key');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    await publishZoneMetaRequest(sw, ident, key).catch(() => {});
    return { ok: true };
  }

  if (method === 'zones.list.request') {
    const key = String(params?.key || '').trim();
    if (!key) throw new Error('missing key');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    await publishZoneListRequest(sw, ident, key).catch(() => {});
    return { ok: true };
  }

  if (method === 'zones.add') {
    const name = String(params?.name || '').trim();
    if (!name) throw new Error('missing name');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    const dev = await ensureDevice();
    const res = await addZone(ident, name);
    if (res?.key) {
      await addSelfToZoneList(dev, res.key).catch(() => {});
      const list = await getZoneList(res.key);
      const zname = await getZoneName(res.key);
      await publishZonePresence(sw, ident, dev, res.key).catch(() => {});
      await publishZoneList(sw, ident, res.key, list.members, list.ts, zname).catch(() => {});
      await publishZoneMeta(sw, ident, res.key, name).catch(() => {});
      await publishAppEvent(sw, {
        type: 'zone_joined',
        identity: ident.label || '',
        zone: res.key,
        name,
      }, [['i', ident.label || '']]);
    }
    pokeUi(sw);
    return res;
  }

  if (method === 'zones.join') {
    const key = String(params?.key || '').trim();
    const name = String(params?.name || '').trim();
    if (!key) throw new Error('missing key');
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    const dev = await ensureDevice();
    const res = await joinZone(ident, key, name);
    if (res?.key) {
      await addSelfToZoneList(dev, res.key).catch(() => {});
      const list = await getZoneList(res.key);
      const zname = await getZoneName(res.key);
      await publishZonePresence(sw, ident, dev, res.key).catch(() => {});
      await publishZoneList(sw, ident, res.key, list.members, list.ts, zname).catch(() => {});
      if (name) await publishZoneMeta(sw, ident, res.key, name).catch(() => {});
      await publishZoneMetaRequest(sw, ident, res.key).catch(() => {});
      await publishAppEvent(sw, {
        type: 'zone_joined',
        identity: ident.label || '',
        zone: res.key,
        name,
      }, [['i', ident.label || '']]);
      await publishZoneListRequest(sw, ident, res.key).catch(() => {});
      await publishZoneProbe(sw, ident, res.key).catch(() => {});
    }
    pokeUi(sw);
    return res;
  }

  if (method === 'directory.list') {
    return await directoryList();
  }

  // --- swarm discovery (local cache, signed records) ---
  if (method === 'swarm.identity.record') {
    return await makeIdentityRecord();
  }
  if (method === 'swarm.device.record') {
    return await makeDeviceRecord();
  }
  if (method === 'swarm.identity.put') {
    return await putIdentityRecord(params?.record || null);
  }
  if (method === 'swarm.device.put') {
    return await putDeviceRecord(params?.record || null);
  }
  if (method === 'swarm.identity.get') {
    const id = String(params?.identityId || '').trim();
    if (!id) throw new Error('missing identityId');
    return await resolveIdentityById(id);
  }
  if (method === 'swarm.identity.list') {
    return await listIdentityRecords();
  }
  if (method === 'swarm.device.get') {
    const pk = String(params?.devicePk || '').trim();
    if (!pk) throw new Error('missing devicePk');
    return await resolveDeviceByPk(pk);
  }
  if (method === 'swarm.device.list') {
    return await listDeviceRecords();
  }
  if (method === 'swarm.identity.forDevice') {
    const pk = String(params?.devicePk || '').trim();
    if (!pk) throw new Error('missing devicePk');
    return await resolveIdentityForDevice(pk);
  }
  if (method === 'swarm.discovery.publish') {
    const ident = await getIdentity();
    if (!ident?.linked) throw new Error('no linked identity');
    const irec = await makeIdentityRecord().catch(() => null);
    const drec = await makeDeviceRecord().catch(() => null);
    if (irec) await publishAppEvent(sw, { type: 'swarm_identity_record', record: irec }).catch(() => {});
    if (drec) await publishAppEvent(sw, { type: 'swarm_device_record', record: drec }).catch(() => {});
    return { ok: true };
  }
  if (method === 'swarm.discovery.request') {
    await publishAppEvent(sw, { type: 'swarm_discovery_request', want: ['identity', 'device'] }).catch(() => {});
    return { ok: true };
  }
  if (method === 'swarm.signal.send') {
    const toPk = String(params?.toPk || '').trim();
    const signalType = String(params?.signalType || '').trim();
    const data = params?.data ?? null;
    const from = await ensureDevice();
    if (!toPk || !signalType) throw new Error('missing toPk or signalType');
    await publishAppEvent(sw, {
      type: 'swarm_signal',
      to: toPk,
      from: from.nostr.pk,
      signalType,
      data,
      ts: Date.now(),
    }, [['p', toPk]]);
    return { ok: true };
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

    const nbs = await listZones(ident || {});
    for (const n of nbs) {
      await publishZonePresence(sw, ident, dev, n.key).catch(() => {});
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
    const nbs = await listZones(ident || {});
    for (const n of nbs) {
      await publishZonePresence(sw, ident, dev, n.key).catch(() => {});
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

    log(sw, `pair_request sent identity=${identityLabel} code=${code}`);
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
      const nbs = await listZones(ident || {});
      for (const n of nbs) {
        await addSelfToZoneList(dev, n.key).catch(() => {});
        await publishZonePresence(sw, ident, dev, n.key).catch(() => {});
        const list = await getZoneList(n.key);
        await publishZoneList(sw, ident, n.key, list.members, list.ts, n.name || "").catch(() => {});
      }
      await startPresenceLoop();
      await startSwarmPublishLoop();
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
    log(sw, `pairing.approve start requestId=${rid}`);

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
