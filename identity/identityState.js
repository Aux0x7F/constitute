// identityState.js
// Holds owner identity (id + key) and profile state.
// Also handles localStorage + URL-hash association.

import { base64urlToBytes, bytesToBase64url } from './crypto.js';

const state = {
  identityId: null,
  identityKeyBytes: null,
  profile: null // { v, id, name, bio, devices: [{pk, name, did}] }
};

export function getIdentityId() {
  return state.identityId;
}

export function getIdentityKeyBytes() {
  return state.identityKeyBytes;
}

export function getProfile() {
  return state.profile;
}

export function setProfile(p) {
  state.profile = p;
}

// normalize devices[] into [{pk, name, did}, ...]
function normalizeDevices() {
  if (!state.profile) return;
  if (!Array.isArray(state.profile.devices)) {
    state.profile.devices = [];
    return;
  }
  const devs = state.profile.devices;
  for (let i = 0; i < devs.length; i++) {
    const d = devs[i];
    if (typeof d === 'string') {
      devs[i] = { pk: d, name: '', did: null };
    } else if (d && typeof d === 'object') {
      devs[i] = {
        pk: String(d.pk || ''),
        name: d.name || '',
        did: d.did || null
      };
    } else {
      devs[i] = { pk: '', name: '', did: null };
    }
  }
}

// ensure profile object matches current identityId, plus device entry
export function ensureProfile(devicePk, deviceDid) {
  if (!state.identityId) return null;

  if (!state.profile || state.profile.id !== state.identityId) {
    state.profile = {
      v: 1,
      id: state.identityId,
      name: '',
      bio: '',
      devices: []
    };
  }

  normalizeDevices();
  ensureDeviceEntry(devicePk, deviceDid);
  return state.profile;
}

export function ensureDeviceEntry(devicePk, deviceDid) {
  if (!state.profile) return;
  normalizeDevices();
  const devs = state.profile.devices;

  let existing = devs.find(d => d.pk === devicePk);
  if (!existing) {
    existing = { pk: devicePk, name: '', did: deviceDid || null };
    devs.push(existing);
  } else {
    if (deviceDid && !existing.did) {
      existing.did = deviceDid;
    }
  }
}

export function updateDeviceDid(devicePk, deviceDid) {
  if (!state.profile || !Array.isArray(state.profile.devices)) return;
  const dev = state.profile.devices.find(d => d.pk === devicePk);
  if (dev) {
    dev.did = deviceDid;
  }
}

// identity id + key setters

export function setIdentityFromBytes(id, keyBytes) {
  state.identityId = id;
  state.identityKeyBytes = keyBytes;
}

export function setIdentityFromB64(id, keyB64) {
  state.identityId = id;
  state.identityKeyBytes = base64urlToBytes(keyB64);
}

export function createNewIdentity() {
  const id = Math.random().toString(36).slice(2, 10);
  const key = crypto.getRandomValues(new Uint8Array(32));
  state.identityId = id;
  state.identityKeyBytes = key;
  state.profile = null;
  persistAssociation();
}

// localStorage association (owner id + key)

export function persistAssociation() {
  if (!state.identityId || !state.identityKeyBytes) return;
  localStorage.setItem('identity_owner_id', state.identityId);
  localStorage.setItem(
    'identity_owner_key',
    bytesToBase64url(state.identityKeyBytes)
  );
}

export function loadAssociationFromLocal() {
  const id = localStorage.getItem('identity_owner_id');
  const keyB64 = localStorage.getItem('identity_owner_key');
  if (!id || !keyB64) return false;
  try {
    state.identityId = id;
    state.identityKeyBytes = base64urlToBytes(keyB64);
    return true;
  } catch {
    return false;
  }
}

export function loadAssociationFromHash(hashString) {
  const hash = hashString || window.location.hash || '';
  const qs = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!qs) return false;

  const params = new URLSearchParams(qs);
  const id = params.get('id');
  const k = params.get('k');
  if (!id || !k) return false;

  try {
    state.identityId = id;
    state.identityKeyBytes = base64urlToBytes(k);
    persistAssociation();
    return true;
  } catch {
    return false;
  }
}

// profile cache key

export function getLocalProfileKey() {
  return state.identityId ? `identity-profile-${state.identityId}` : null;
}

// read from cache (if any) into profile, fix devices, ensure device entry

export function loadProfileFromCache(devicePk, deviceDid) {
  const key = getLocalProfileKey();
  if (!key) return null;
  const raw = localStorage.getItem(key);
  if (!raw) {
    state.profile = null;
    return null;
  }
  try {
    const profile = JSON.parse(raw);
    state.profile = profile;
    ensureProfile(devicePk, deviceDid);
    return state.profile;
  } catch {
    state.profile = null;
    return null;
  }
}

export function saveProfileToCache() {
  const key = getLocalProfileKey();
  if (!key || !state.profile) return;
  localStorage.setItem(key, JSON.stringify(state.profile));
}

export { base64urlToBytes, bytesToBase64url };
