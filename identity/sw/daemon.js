import { kvGet, kvSet } from './idb.js';
import { randomBytes, b64url, b64urlToBytes } from './crypto.js';
import { ensureNostrKeys, signEventUnsigned, nip04Encrypt, nip04Decrypt } from './nostr.js';

const APP_TAG = 'constitute';
const SUB_ID = 'constitute_sub_v2';

function emit(sw, evt) {
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'evt', evt });
  });
}
function status(sw, message) { emit(sw, { type: 'status', message }); }
function log(sw, message) { console.log('[SW]', message); emit(sw, { type: 'log', message }); }
function pokeUi(sw) { emit(sw, { type: 'notify' }); }

async function ensureDevice() {
  let dev = await kvGet('device');
  if (dev) return dev;

  const deviceId = b64url(randomBytes(8));
  const keys = ensureNostrKeys(null);

  dev = {
    deviceId,
    didMethod: 'nostr-soft',
    did: `did:device:nostr:${keys.pk}`,
    webauthnCredId: null,
    label: '',
    nostr: { pk: keys.pk, skHex: keys.skHex },
  };

  await kvSet('device', dev);
  return dev;
}

async function getIdentity() { return await kvGet('identity'); }
async function setIdentity(identity) { await kvSet('identity', identity); }

async function getProfile() { return (await kvGet('profile')) || { name: '', about: '' }; }
async function setProfile(p) { await kvSet('profile', p); }

function nowSec() { return Math.floor(Date.now() / 1000); }

function makePairCode() {
  return (Math.floor(Math.random() * 900000) + 100000).toString();
}

async function relaySend(sw, frameArr) {
  const frame = JSON.stringify(frameArr);
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'relay.tx', data: frame });
  });
}

async function subscribeOnRelayOpen(sw) {
  // We subscribe to app tag, and also to identity label if we know it (to cut spam).
  const ident = await getIdentity();
  const filters = [{ kinds: [1], '#t': [APP_TAG], limit: 200 }];

  if (ident?.label) {
    // identity scoping tag: ["i", "<label>"]
    filters.unshift({ kinds: [1], '#t': [APP_TAG], '#i': [ident.label], limit: 200 });
  }

  await relaySend(sw, ['REQ', SUB_ID, ...filters]);
  log(sw, 'sent REQ subscribe');
}

async function publishAppEvent(sw, payloadObj, extraTags = []) {
  const dev = await ensureDevice();

  const unsigned = {
    kind: 1,
    created_at: nowSec(),
    tags: [['t', APP_TAG], ...extraTags],
    content: JSON.stringify(payloadObj),
    pubkey: dev.nostr.pk,
  };

  const ev = signEventUnsigned(unsigned, dev.nostr.skHex);
  await relaySend(sw, ['EVENT', ev]);
  return ev.id;
}

// ----- Notifications / pairing storage -----

async function notifAdd(n) {
  const list = (await kvGet('notifications')) || [];
  list.unshift(n);
  while (list.length > 200) list.pop();
  await kvSet('notifications', list);
}

async function notifList() {
  return (await kvGet('notifications')) || [];
}

async function notifMarkRead(id) {
  const list = (await kvGet('notifications')) || [];
  for (const n of list) {
    if (n.id === id) n.read = true;
  }
  await kvSet('notifications', list);
}

async function pendingAdd(req) {
  const list = (await kvGet('pairPending')) || [];
  if (!list.some(x => x.id === req.id)) list.unshift(req);
  await kvSet('pairPending', list);
}

async function pendingList() {
  return (await kvGet('pairPending')) || [];
}

async function pendingRemove(id) {
  const list = (await kvGet('pairPending')) || [];
  await kvSet('pairPending', list.filter(x => x.id !== id));
}

async function getThisDeviceLabel() {
  const dev = await ensureDevice();
  return dev.label || '';
}

async function setThisDeviceLabel(label) {
  const dev = await ensureDevice();
  dev.label = label;
  await kvSet('device', dev);

  // also update identity device list if linked
  const ident = await getIdentity();
  if (ident?.linked && Array.isArray(ident.devices)) {
    const me = ident.devices.find(d => d.pk === dev.nostr.pk);
    if (me) me.label = label;
    await setIdentity(ident);
  }
}

// ----- Relay frame handling -----

async function handleRelayFrame(sw, raw) {
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
  if (subId !== SUB_ID || !ev) return;

  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const hasAppTag = tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === APP_TAG);
  if (!hasAppTag) return;

  // Parse payload
  let payload = null;
  try { payload = JSON.parse(ev.content || ''); } catch { return; }
  if (!payload?.type) return;

  const dev = await ensureDevice();
  const ident = await getIdentity();

  // Optional: identity scoping if we know label
  const identityTag = tags.find(t => Array.isArray(t) && t[0] === 'i');
  const scopedLabel = identityTag?.[1] || null;
  if (ident?.label && scopedLabel && scopedLabel !== ident.label) {
    // Not for our identity
    return;
  }

  if (payload.type === 'pair_request') {
    // Only show as pending if it targets our identity label
    if (!ident?.linked || !ident?.label) return;
    if (payload.identity !== ident.label) return;

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

  if (payload.type === 'pair_approve') {
    // If this device is the target, decrypt roomKey and link identity
    if (payload.toPk !== dev.nostr.pk) return;

    // Verify identity label matches what we’re trying to join
    const wanted = await kvGet('pendingJoinIdentityLabel');
    if (wanted && payload.identity !== wanted) {
      // ignore approvals for other identities
      return;
    }

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

      // Ensure this device exists in device list
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

      // clear pending join marker
      await kvSet('pendingJoinIdentityLabel', null);

      status(sw, `paired into ${payload.identity}`);
      pokeUi(sw);
    } catch (e) {
      log(sw, `pair_approve decrypt failed: ${String(e?.message || e)}`);
    }
    return;
  }

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

  if (payload.type === 'profile_update') {
    // If it’s our profile pubkey, accept update
    if (payload.pk !== dev.nostr.pk) return;
    await setProfile({ name: payload.name || '', about: payload.about || '' });
    pokeUi(sw);
    return;
  }
}

// ----- API -----

export function startDaemon(sw) {
  status(sw, 'identity daemon online');

  let relayState = 'idle';

  sw.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'req') return;

    const { id, method, params } = msg;

    (async () => {
      try {
        const result = await handle(sw, method, params, () => relayState, (s) => relayState = s);
        e.source.postMessage({ type: 'res', id, ok: true, result });
      } catch (err) {
        e.source.postMessage({ type: 'res', id, ok: false, error: String(err?.message || err) });
      }
    })();
  });
}

async function handle(sw, method, params, getRelayState, setRelayState) {
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
    status(sw, `WebAuthn skipped`);
    return { ok: true };
  }

  if (method === 'device.getLabel') {
    const dev = await ensureDevice();
    return { label: dev.label || '' };
  }

  if (method === 'device.setLabel') {
    const label = String(params?.label || '').trim();
    if (!label) throw new Error('label required');
    await setThisDeviceLabel(label);
    status(sw, 'label updated');
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'relay.status') {
    const state = String(params?.state || '');
    const url = String(params?.url || '');
    if (state && state !== getRelayState()) {
      setRelayState(state);
      log(sw, `relay state -> ${state} ${url}`);
    }
    if (state === 'open') await subscribeOnRelayOpen(sw);
    return { ok: true };
  }

  if (method === 'relay.rx') {
    await handleRelayFrame(sw, String(params?.data || ''));
    return { ok: true };
  }

  if (method === 'identity.get') {
    const ident = await getIdentity();
    return {
      linked: !!ident?.linked,
      id: ident?.id || '',
      label: ident?.label || '',
      devices: ident?.devices || [],
    };
  }

  if (method === 'identity.create') {
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

    status(sw, 'identity created');
    pokeUi(sw);
    return { ok: true };
  }

  if (method === 'identity.requestPair') {
    const dev = await ensureDevice();
    const identityLabel = String(params?.identityLabel || '').trim();
    const deviceLabel = String(params?.deviceLabel || '').trim();
    if (!identityLabel) throw new Error('identity label required');
    if (!deviceLabel) throw new Error('device label required');

    dev.label = deviceLabel;
    await kvSet('device', dev);

    const code = makePairCode();

    // remember what identity we're trying to join so we can accept approval
    await kvSet('pendingJoinIdentityLabel', identityLabel);

    await publishAppEvent(sw, {
      type: 'pair_request',
      identity: identityLabel,
      code,
      deviceLabel,
      deviceDid: dev.did,
      devicePk: dev.nostr.pk,
    }, [['i', identityLabel], ['p', dev.nostr.pk]]);

    status(sw, `pair request sent (${code})`);
    pokeUi(sw);
    return { code };
  }

  // Settings: Profile
  if (method === 'profile.get') {
    return await getProfile();
  }

  if (method === 'profile.set') {
    const name = String(params?.name || '').trim();
    const about = String(params?.about || '').trim();
    await setProfile({ name, about });

    const dev = await ensureDevice();
    // publish signed profile update (not secret)
    await publishAppEvent(sw, {
      type: 'profile_update',
      pk: dev.nostr.pk,
      name,
      about,
    }, [['p', dev.nostr.pk]]);

    status(sw, 'profile saved');
    pokeUi(sw);
    return { ok: true };
  }

  // Notifications
  if (method === 'notifications.list') {
    const list = await notifList();
    // return newest first, include unread
    return list;
  }

  if (method === 'notifications.markRead') {
    const id = String(params?.id || '');
    if (!id) throw new Error('missing id');
    await notifMarkRead(id);
    pokeUi(sw);
    return { ok: true };
  }

  // Pairing list + actions
  if (method === 'pairing.list') {
    return await pendingList();
  }

  if (method === 'pairing.dismiss') {
    const rid = String(params?.requestId || '');
    if (!rid) throw new Error('missing requestId');
    await pendingRemove(rid);
    pokeUi(sw);
    return { ok: true };
  }

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

    await pendingRemove(rid);
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

    const dev = await ensureDevice();

    // Build approval payload with room key + device list
    const payload = JSON.stringify({
      identityId: ident.id,
      roomKeyB64: ident.roomKeyB64,
      devices: ident.devices || [],
    });

    // Encrypt room key payload to the requester device
    const encryptedRoomKey = await nip04Encrypt(dev.nostr.skHex, r.devicePk, payload);

    await publishAppEvent(sw, {
      type: 'pair_approve',
      identity: r.identityLabel,
      code: r.code,
      toPk: r.devicePk,
      fromPk: dev.nostr.pk,
      encryptedRoomKey,
    }, [['i', r.identityLabel], ['p', r.devicePk]]);

    // Update local identity devices list to include requester
    const exists = (ident.devices || []).some(d => d.pk === r.devicePk);
    if (!exists) {
      ident.devices.push({ pk: r.devicePk, did: r.deviceDid || '', label: r.deviceLabel || '' });
      await setIdentity(ident);
    }

    await pendingRemove(rid);

    await notifAdd({
      id: `n-approved-${rid}`,
      kind: 'pairing',
      title: 'Approved pairing',
      body: `${r.deviceLabel || 'device'} added to ${r.identityLabel}`,
      ts: Date.now(),
      read: false,
    });

    status(sw, 'approved');
    pokeUi(sw);
    return { ok: true };
  }

  throw new Error(`unknown method: ${method}`);
}
