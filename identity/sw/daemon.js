// FILE: identity/sw/daemon.js

import { kvGet, kvSet } from './idb.js';
import { randomBytes, b64url, b64urlToBytes, aesGcmEncrypt, aesGcmDecrypt } from './crypto.js';
import { ensureNostrKeys, signEventUnsigned, nip04Encrypt, nip04Decrypt } from './nostr.js';

const APP_TAG = 'constitute';
const te = new TextEncoder();

const SUB_ID = 'constitute_sub_v2';

function emit(sw, evt) {
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'evt', evt });
  });
}

function log(sw, ...args) {
  emit(sw, { type: 'log', message: args.map(String).join(' ') });
  console.log('[sw]', ...args);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sha256Hex(bytes) {
  // small helper for stable ids without pulling extra deps
  return crypto.subtle.digest('SHA-256', bytes).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

function stableRoomId(label) {
  // Identity label is user-facing; room id derived to avoid leaking raw label in AAD and for stable namespace.
  return sha256Hex(te.encode(`constitute:identity:${label || ''}`));
}

function isTruthy(x) {
  return !!x;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// ------------------------
// Persistent state keys
// ------------------------
const KV = {
  DEVICE: 'device.v1',
  IDENTITY: 'identity.v1',
  PROFILE: 'profile.v1',
  RELAY: 'relay.v1',
  NOTIFS: 'notifications.v1',
  PAIR_REQS: 'pairing.requests.v1',
};

// ------------------------
// Relay / Nostr plumbing
// ------------------------
let relayUrl = 'wss://relay.snort.social';
let relayState = { ok: true, state: 'idle', url: relayUrl, code: null, reason: '' };

function setRelayState(sw, patch) {
  relayState = { ...relayState, ...patch };
  emit(sw, { type: 'relay', ...relayState });
}

// ------------------------
// Device / identity state
// ------------------------
async function getDevice() {
  const d = (await kvGet(KV.DEVICE)) || null;
  return d;
}

async function setDevice(d) {
  await kvSet(KV.DEVICE, d);
  return d;
}

async function getIdentity() {
  const i = (await kvGet(KV.IDENTITY)) || {
    id: '',
    label: '',
    linked: false,
    devices: [],
    roomKeyB64: '', // symmetric key for room encryption (base64url)
    created_at: nowSec(),
    updated_at: nowSec(),
  };
  return i;
}

async function setIdentity(i) {
  i.updated_at = nowSec();
  await kvSet(KV.IDENTITY, i);
  return i;
}

async function getProfile() {
  return (await kvGet(KV.PROFILE)) || { name: '', about: '' };
}

async function setProfile(p) {
  await kvSet(KV.PROFILE, p);
  return p;
}

async function getNotifs() {
  return (await kvGet(KV.NOTIFS)) || [];
}

async function setNotifs(list) {
  await kvSet(KV.NOTIFS, list);
  return list;
}

async function getPairReqs() {
  return (await kvGet(KV.PAIR_REQS)) || [];
}

async function setPairReqs(list) {
  await kvSet(KV.PAIR_REQS, list);
  return list;
}

function deviceInIdentity(identity, { pk, did }) {
  const devs = identity.devices || [];
  return devs.some((d) => (pk && d.pk === pk) || (did && d.did === did));
}

function upsertDevice(identity, dev) {
  const devs = identity.devices || [];
  const out = [];
  let didAdd = true;
  for (const d of devs) {
    const same =
      (dev.pk && d.pk === dev.pk) ||
      (dev.did && d.did === dev.did);
    if (same) {
      didAdd = false;
      out.push({ ...d, ...dev, updated_at: nowSec() });
    } else {
      out.push(d);
    }
  }
  if (didAdd) out.push({ ...dev, added_at: nowSec(), updated_at: nowSec() });
  identity.devices = out;
  identity.linked = true;
  return identity;
}

// ------------------------
// Notifications
// ------------------------
function makeNotif({ kind = 'general', title = '', body = '', data = null }) {
  return {
    id: `n_${crypto.getRandomValues(new Uint32Array(4)).join('')}_${nowSec()}`,
    kind,
    title,
    body,
    data,
    created_at: nowSec(),
    read: false,
    cleared: false,
  };
}

async function addNotif(sw, n) {
  const list = await getNotifs();
  list.unshift(n);
  await setNotifs(list);
  emit(sw, { type: 'notify' });
}

async function clearNotifs(sw) {
  await setNotifs([]);
  emit(sw, { type: 'notify' });
}

// ------------------------
// Pair requests lifecycle
// ------------------------
function normalizeReq(r) {
  return {
    id: r.id || `pr_${crypto.getRandomValues(new Uint32Array(4)).join('')}_${nowSec()}`,
    identityLabel: r.identityLabel || '',
    identityId: r.identityId || '',
    devicePk: r.devicePk || '',
    deviceDid: r.deviceDid || '',
    deviceLabel: r.deviceLabel || '',
    code: r.code || '',
    status: r.status || 'pending', // pending | approved | rejected | dismissed
    created_at: r.created_at || nowSec(),
    updated_at: r.updated_at || nowSec(),
    resolved_at: r.resolved_at || 0,
  };
}

async function upsertPairReq(sw, reqPatch) {
  const list = await getPairReqs();
  const r = normalizeReq(reqPatch);
  const out = [];
  let replaced = false;
  for (const x of list) {
    if (x.id === r.id) {
      out.push({ ...x, ...r, updated_at: nowSec() });
      replaced = true;
    } else {
      out.push(x);
    }
  }
  if (!replaced) out.unshift(r);
  await setPairReqs(out);
  emit(sw, { type: 'notify' });
  return r;
}

async function resolvePairReq(sw, id, status) {
  const list = await getPairReqs();
  const out = [];
  for (const x of list) {
    if (x.id === id) {
      out.push({
        ...x,
        status,
        resolved_at: nowSec(),
        updated_at: nowSec(),
      });
    } else {
      out.push(x);
    }
  }
  await setPairReqs(out);
  emit(sw, { type: 'notify' });
}

async function dismissPairReq(sw, id) {
  await resolvePairReq(sw, id, 'dismissed');
}

async function listPendingPairReqs() {
  const [list, ident] = await Promise.all([getPairReqs(), getIdentity()]);
  const knownPks = new Set((ident.devices || []).map((d) => d.pk).filter(isTruthy));
  const knownDids = new Set((ident.devices || []).map((d) => d.did).filter(isTruthy));
  return list.filter((r) => {
    if (r.status !== 'pending') return false;
    if (r.devicePk && knownPks.has(r.devicePk)) return false;
    if (r.deviceDid && knownDids.has(r.deviceDid)) return false;
    return true;
  });
}

// ------------------------
// Room encryption helpers (AES-GCM)
// ------------------------
async function getRoomKeyBytes(identity) {
  if (!identity.roomKeyB64) return null;
  return b64urlToBytes(identity.roomKeyB64);
}

function makeAAD({ roomIdHex, kind, senderPk, created_at }) {
  // Bind ciphertext to room + type + sender + time
  return te.encode(`${roomIdHex}|${kind}|${senderPk || ''}|${created_at || 0}`);
}

async function encryptRoomPayload(identity, plaintextObj, aadMeta) {
  const key = await getRoomKeyBytes(identity);
  if (!key) throw new Error('missing_room_key');
  const pt = te.encode(JSON.stringify(plaintextObj));
  const aad = makeAAD(aadMeta);
  const { ivB64, ctB64 } = await aesGcmEncrypt(key, pt, aad);
  return { iv: ivB64, ct: ctB64, v: 1 };
}

async function decryptRoomPayload(identity, enc, aadMeta) {
  const key = await getRoomKeyBytes(identity);
  if (!key) throw new Error('missing_room_key');
  const aad = makeAAD(aadMeta);
  const ptBytes = await aesGcmDecrypt(key, enc.iv, enc.ct, aad);
  const txt = new TextDecoder().decode(ptBytes);
  return JSON.parse(txt);
}

function isRoomEncryptedKind(kind) {
  // Everything identity-scoped that isn't required for onboarding stays encrypted.
  // Plaintext kinds for onboarding/bootstrapping:
  // - pair_request / pair_approve / pair_reject / pair_resolved / identity_created
  return ![
    'pair_request',
    'pair_approve',
    'pair_reject',
    'pair_resolved',
    'identity_created',
  ].includes(kind);
}

// ------------------------
// Nostr event envelope
// ------------------------
function mkTags(identityLabel) {
  // app tag + identity label (label is not secret; content is encrypted)
  // We keep the label tag so devices can subscribe without knowing room key.
  return [
    ['t', APP_TAG],
    ['d', identityLabel || ''],
  ];
}

async function publishKind(sw, kind, payloadObj, opts = {}) {
  const identity = await getIdentity();
  if (!identity.label) throw new Error('no_identity_label');

  const keys = await ensureNostrKeys(sw);
  const created_at = nowSec();
  const roomIdHex = await stableRoomId(identity.label);

  let contentObj;
  if (isRoomEncryptedKind(kind)) {
    const enc = await encryptRoomPayload(
      identity,
      { kind, payload: payloadObj },
      { roomIdHex, kind, senderPk: keys.pubkey, created_at }
    );
    contentObj = { enc, kind: 'enc', room: roomIdHex };
  } else {
    contentObj = { kind, payload: payloadObj };
  }

  const unsigned = {
    kind: 1,
    created_at,
    tags: mkTags(identity.label),
    content: JSON.stringify(contentObj),
    pubkey: keys.pubkey,
  };

  const signed = await signEventUnsigned(keys, unsigned);
  // send via UI bridge to SharedWorker
  sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) c.postMessage({ type: 'relay.tx', data: JSON.stringify(['EVENT', signed]) });
  });

  return { ok: true };
}

// ------------------------
// Relay RX handling
// ------------------------
async function handleRelayMessage(sw, frame) {
  // Expect nostr frames from UI -> SharedWorker -> SW (as JSON array)
  let msg;
  try { msg = JSON.parse(frame); } catch { return; }

  // We only care about EVENT frames for our subscription
  if (msg[0] === 'EVENT') {
    const ev = msg[2];
    if (!ev || typeof ev.content !== 'string') return;

    // filter app tag quickly
    const tags = Array.isArray(ev.tags) ? ev.tags : [];
    const hasApp = tags.some((t) => t[0] === 't' && t[1] === APP_TAG);
    if (!hasApp) return;

    const identity = await getIdentity();
    if (!identity.label) return;

    // match identity label
    const matchLabel = tags.some((t) => t[0] === 'd' && t[1] === identity.label);
    if (!matchLabel) return;

    // parse content
    let content;
    try { content = JSON.parse(ev.content); } catch { return; }

    // encrypted wrapper?
    if (content && content.kind === 'enc' && content.enc) {
      // Can't process without room key.
      if (!identity.roomKeyB64) return;

      try {
        const roomIdHex = content.room || (await stableRoomId(identity.label));
        const created_at = ev.created_at || 0;
        const senderPk = ev.pubkey || '';
        const inner = await decryptRoomPayload(identity, content.enc, {
          roomIdHex,
          kind: 'enc', // AAD uses wrapper kind to match encrypt call
          senderPk,
          created_at,
        });

        // inner = { kind, payload }
        if (!inner || !inner.kind) return;
        await dispatchRoomKind(sw, inner.kind, inner.payload, ev);
      } catch (e) {
        // Decryption errors should not crash daemon
        log(sw, 'decrypt failed', e?.message || e);
        return;
      }
      return;
    }

    // plaintext kinds
    if (content && content.kind) {
      await dispatchRoomKind(sw, content.kind, content.payload, ev);
    }
  }
}

async function dispatchRoomKind(sw, kind, payload, ev) {
  switch (kind) {
    case 'pair_request':
      return onPairRequest(sw, payload, ev);
    case 'pair_approve':
      return onPairApprove(sw, payload, ev);
    case 'pair_reject':
      return onPairReject(sw, payload, ev);
    case 'pair_resolved':
      return onPairResolved(sw, payload, ev);
    case 'identity_created':
      return onIdentityCreated(sw, payload, ev);

    // room-encrypted kinds (examples / future)
    case 'profile_set':
      return onProfileSet(sw, payload, ev);
    case 'device_label_set':
      return onDeviceLabelSet(sw, payload, ev);

    default:
      // ignore unknown kinds
      return;
  }
}

// ------------------------
// Handlers
// ------------------------
async function onIdentityCreated(sw, payload) {
  // Payload might include room key envelope for creator's other devices; for now creator sets locally.
  emit(sw, { type: 'notify' });
}

async function onPairRequest(sw, payload) {
  // payload: { requestId, devicePk, deviceDid, deviceLabel, identityLabel, code, created_at }
  const identity = await getIdentity();
  if (!identity.label) return;
  if (payload.identityLabel && payload.identityLabel !== identity.label) return;

  // Ignore if already in identity
  if (deviceInIdentity(identity, { pk: payload.devicePk, did: payload.deviceDid })) return;

  const req = await upsertPairReq(sw, {
    id: payload.requestId,
    identityLabel: identity.label,
    identityId: identity.id,
    devicePk: payload.devicePk,
    deviceDid: payload.deviceDid,
    deviceLabel: payload.deviceLabel,
    code: payload.code,
    status: 'pending',
    created_at: payload.created_at || nowSec(),
  });

  await addNotif(sw, makeNotif({
    kind: 'pairing',
    title: 'Pairing request',
    body: req.deviceLabel ? `Request from: ${req.deviceLabel}` : 'New device wants to join',
    data: { requestId: req.id },
  }));

  emit(sw, { type: 'notify' });
}

async function onPairApprove(sw, payload) {
  // payload: { requestId, devicePk, deviceDid, roomKeyCipher, approverPk, created_at }
  const identity = await getIdentity();
  const device = await getDevice();
  if (!device) return;

  // Only process if this approval is for us
  if (payload.devicePk && device.pk && payload.devicePk !== device.pk) return;
  if (payload.deviceDid && device.did && payload.deviceDid !== device.did) return;

  // Decrypt room key if provided (NIP-04 ciphertext)
  if (payload.roomKeyCipher) {
    const keys = await ensureNostrKeys(sw);
    try {
      const roomKeyB64 = await nip04Decrypt(keys, payload.approverPk, payload.roomKeyCipher);
      identity.roomKeyB64 = roomKeyB64;
    } catch (e) {
      log(sw, 'room key decrypt failed', e?.message || e);
    }
  }

  // Resolve request locally
  if (payload.requestId) {
    await resolvePairReq(sw, payload.requestId, 'approved');
  }

  // Ensure we are in identity devices and mark linked
  upsertDevice(identity, {
    pk: device.pk,
    did: device.did,
    label: device.label || '',
  });
  identity.linked = true;
  await setIdentity(identity);

  await addNotif(sw, makeNotif({
    kind: 'pairing',
    title: 'Paired',
    body: 'This device was approved and joined the identity.',
    data: { requestId: payload.requestId || null },
  }));

  emit(sw, { type: 'notify' });
}

async function onPairReject(sw, payload) {
  const device = await getDevice();
  if (!device) return;

  if (payload.devicePk && device.pk && payload.devicePk !== device.pk) return;
  if (payload.deviceDid && device.did && payload.deviceDid !== device.did) return;

  if (payload.requestId) await resolvePairReq(sw, payload.requestId, 'rejected');

  await addNotif(sw, makeNotif({
    kind: 'pairing',
    title: 'Pairing rejected',
    body: 'Another device rejected this pairing request.',
    data: { requestId: payload.requestId || null },
  }));

  emit(sw, { type: 'notify' });
}

async function onPairResolved(sw, payload) {
  // payload: { requestId, status }
  if (!payload?.requestId) return;
  await resolvePairReq(sw, payload.requestId, payload.status || 'dismissed');
  emit(sw, { type: 'notify' });
}

async function onProfileSet(sw, payload) {
  // payload: { name, about }
  const p = await getProfile();
  const next = { ...p, ...payload };
  await setProfile(next);
  emit(sw, { type: 'notify' });
}

async function onDeviceLabelSet(sw, payload) {
  // payload: { pk, did, label }
  const identity = await getIdentity();
  const dev = identity.devices?.find((d) => (payload.pk && d.pk === payload.pk) || (payload.did && d.did === payload.did));
  if (!dev) return;
  dev.label = payload.label || dev.label;
  dev.updated_at = nowSec();
  await setIdentity(identity);
  emit(sw, { type: 'notify' });
}

// ------------------------
// Outbound ops
// ------------------------
async function ensureRoomKey(identity) {
  if (identity.roomKeyB64) return identity;
  const keyBytes = randomBytes(32);
  identity.roomKeyB64 = b64url(keyBytes);
  return identity;
}

async function createIdentity(sw, { identityLabel, deviceLabel }) {
  const device = await getDevice();
  const keys = await ensureNostrKeys(sw);

  // ensure local device state
  if (deviceLabel) {
    device.label = deviceLabel;
    await setDevice(device);
  }

  const identity = await getIdentity();
  identity.label = identityLabel || identity.label || '';
  if (!identity.id) identity.id = `id_${crypto.getRandomValues(new Uint32Array(4)).join('')}`;

  // generate room key now
  await ensureRoomKey(identity);

  upsertDevice(identity, {
    pk: device.pk || keys.pubkey,
    did: device.did,
    label: device.label || '',
  });

  identity.linked = true;
  await setIdentity(identity);

  // announce identity created (plaintext)
  await publishKind(sw, 'identity_created', { identityLabel: identity.label, identityId: identity.id });

  await addNotif(sw, makeNotif({
    kind: 'general',
    title: 'Identity created',
    body: identity.label ? `Created: ${identity.label}` : 'Created an identity',
  }));

  emit(sw, { type: 'notify' });
  return { ok: true };
}

async function requestPair(sw, { identityLabel, deviceLabel }) {
  const identity = await getIdentity();
  const device = await getDevice();
  const keys = await ensureNostrKeys(sw);

  if (!identity.label && identityLabel) {
    identity.label = identityLabel;
    await setIdentity(identity);
  }

  if (deviceLabel) {
    device.label = deviceLabel;
    await setDevice(device);
  }

  const requestId = `pr_${crypto.getRandomValues(new Uint32Array(4)).join('')}_${nowSec()}`;
  const code = Math.random().toString(36).slice(2, 8);

  await upsertPairReq(sw, {
    id: requestId,
    identityLabel: identity.label || identityLabel || '',
    identityId: identity.id || '',
    devicePk: keys.pubkey,
    deviceDid: device.did,
    deviceLabel: device.label || '',
    code,
    status: 'pending',
    created_at: nowSec(),
  });

  await publishKind(sw, 'pair_request', {
    requestId,
    identityLabel: identity.label || identityLabel || '',
    devicePk: keys.pubkey,
    deviceDid: device.did,
    deviceLabel: device.label || '',
    code,
    created_at: nowSec(),
  });

  emit(sw, { type: 'notify' });
  return { ok: true, requestId, code };
}

async function approvePair(sw, { requestId }) {
  const identity = await getIdentity();
  const keys = await ensureNostrKeys(sw);
  const reqs = await getPairReqs();
  const req = reqs.find((r) => r.id === requestId);
  if (!req) return { ok: false, error: 'request_not_found' };
  if (req.status !== 'pending') return { ok: true, already: true };

  // ensure room key exists
  await ensureRoomKey(identity);
  await setIdentity(identity);

  // encrypt room key for new device using NIP-04 (approver -> devicePk)
  let roomKeyCipher = '';
  try {
    roomKeyCipher = await nip04Encrypt(keys, req.devicePk, identity.roomKeyB64);
  } catch (e) {
    log(sw, 'nip04 encrypt failed', e?.message || e);
  }

  // mark resolved locally at source (fixes stale pending)
  await resolvePairReq(sw, requestId, 'approved');

  // add device to identity
  upsertDevice(identity, {
    pk: req.devicePk,
    did: req.deviceDid,
    label: req.deviceLabel || '',
  });
  await setIdentity(identity);

  // publish approval (plaintext) so joining device can decrypt key
  await publishKind(sw, 'pair_approve', {
    requestId,
    identityLabel: identity.label,
    devicePk: req.devicePk,
    deviceDid: req.deviceDid,
    approverPk: keys.pubkey,
    roomKeyCipher,
    created_at: nowSec(),
  });

  // publish resolved marker (optional) so other devices can clear their pending list deterministically
  await publishKind(sw, 'pair_resolved', { requestId, status: 'approved', created_at: nowSec() });

  await addNotif(sw, makeNotif({
    kind: 'pairing',
    title: 'Device approved',
    body: req.deviceLabel ? `Approved: ${req.deviceLabel}` : 'Approved a device',
    data: { requestId },
  }));

  emit(sw, { type: 'notify' });
  return { ok: true };
}

async function rejectPair(sw, { requestId }) {
  const identity = await getIdentity();
  const keys = await ensureNostrKeys(sw);
  const reqs = await getPairReqs();
  const req = reqs.find((r) => r.id === requestId);
  if (!req) return { ok: false, error: 'request_not_found' };
  if (req.status !== 'pending') return { ok: true, already: true };

  await resolvePairReq(sw, requestId, 'rejected');

  await publishKind(sw, 'pair_reject', {
    requestId,
    identityLabel: identity.label,
    devicePk: req.devicePk,
    deviceDid: req.deviceDid,
    approverPk: keys.pubkey,
    created_at: nowSec(),
  });

  await publishKind(sw, 'pair_resolved', { requestId, status: 'rejected', created_at: nowSec() });

  await addNotif(sw, makeNotif({
    kind: 'pairing',
    title: 'Device rejected',
    body: req.deviceLabel ? `Rejected: ${req.deviceLabel}` : 'Rejected a device',
    data: { requestId },
  }));

  emit(sw, { type: 'notify' });
  return { ok: true };
}

async function dismissPair(sw, { requestId }) {
  await dismissPairReq(self, requestId);
  return { ok: true };
}

// ------------------------
// RPC
// ------------------------
async function handleCall(sw, method, params) {
  switch (method) {
    case 'device.getState': {
      const device = await getDevice();
      const keys = await ensureNostrKeys(sw);
      return { did: device?.did || '', didMethod: device?.didMethod || 'soft', pk: keys.pubkey };
    }
    case 'device.getLabel': {
      const device = await getDevice();
      return { label: device?.label || '' };
    }
    case 'device.setLabel': {
      const device = await getDevice();
      device.label = String(params?.label || '');
      await setDevice(device);

      // publish to room (encrypted) so others can see updated label
      const keys = await ensureNostrKeys(sw);
      await publishKind(sw, 'device_label_set', { pk: keys.pubkey, did: device.did, label: device.label });

      return { ok: true };
    }
    case 'identity.get': {
      return await getIdentity();
    }
    case 'identity.create': {
      return await createIdentity(sw, params || {});
    }
    case 'identity.requestPair': {
      return await requestPair(sw, params || {});
    }
    case 'pairing.list': {
      return await listPendingPairReqs();
    }
    case 'pairing.approve': {
      return await approvePair(sw, params || {});
    }
    case 'pairing.reject': {
      return await rejectPair(sw, params || {});
    }
    case 'pairing.dismiss': {
      return await dismissPairReq(sw, params?.requestId);
    }
    case 'profile.get': {
      return await getProfile();
    }
    case 'profile.set': {
      const next = { name: String(params?.name || ''), about: String(params?.about || '') };
      await setProfile(next);

      // publish to room (encrypted)
      await publishKind(sw, 'profile_set', next);

      return { ok: true };
    }
    case 'notifications.list': {
      return await getNotifs();
    }
    case 'notifications.markRead': {
      const id = params?.id;
      const list = await getNotifs();
      for (const n of list) if (n.id === id) n.read = true;
      await setNotifs(list);
      emit(sw, { type: 'notify' });
      return { ok: true };
    }
    case 'notifications.clear': {
      await clearNotifs(sw);
      return { ok: true };
    }
    case 'relay.rx': {
      if (typeof params?.data === 'string') await handleRelayMessage(sw, params.data);
      return { ok: true };
    }
    case 'relay.status': {
      // UI informs SW about worker connection state for indicator
      setRelayState(sw, {
        state: params?.state || relayState.state,
        url: params?.url || relayState.url,
        ok: true,
        code: params?.code ?? null,
        reason: params?.reason ?? '',
      });
      return { ok: true };
    }
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

// ------------------------
// SW lifecycle
// ------------------------
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type !== 'req') return;
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  Promise.resolve()
    .then(() => handleCall(self, method, params))
    .then((result) => e.source?.postMessage({ type: 'res', id, ok: true, result }))
    .catch((err) => e.source?.postMessage({ type: 'res', id, ok: false, error: String(err?.message || err) }));
});

// ------------------------
// Boot: ensure device + keys exist
// ------------------------
(async () => {
  const device = (await getDevice()) || {
    did: `did:soft:${crypto.getRandomValues(new Uint32Array(4)).join('')}`,
    didMethod: 'soft',
    pk: '',
    label: '',
    created_at: nowSec(),
  };
  await setDevice(device);
  // generate nostr keys if needed
  await ensureNostrKeys(self);
  log(self, 'identity daemon online');
})();
