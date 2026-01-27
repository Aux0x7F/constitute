// identityState.js
// Holds owner identity (id + key) and profile state.
// Also handles localStorage + URL-hash association.

import { base64urlToBytes, bytesToBase64url } from './crypto.js';

const state = {
  identityId: null,
  identityKeyBytes: null,
  profile: null, // { v, id, name, bio, devices: [{pk, name}] }
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

// internal: normalize devices array into [{pk,name}, ...]
function normalizeDevices() {
  if (!state.profile) return;
  if (!Array.isArray(state.profile.devices)) {
    state.profile.devices = [];
    return;
  }
  const devs = state.profile.devices;
  for (let i = 0; i < devs.length; i++) {
    if (typeof devs[i] === 'string') {
      devs[i] = { pk: devs[i], name: '' };
    } else if (!devs[i] || typeof devs[i].pk !== 'string') {
      devs[i] = { pk: String(devs[i]?.pk || ''), name: devs[i]?.name || '' };
    }
  }
}

// ensure profile object matches current identityId,
// and ensure devices[] is a sane array
export function ensureProfile(devicePk) {
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
  ensureDeviceEntry(devicePk);
  return state.profile;
}

export function ensureDeviceEntry(devicePk) {
  if (!state.profile) return;
  normalizeDevices();
  const devs = state.profile.devices;
  const existing = devs.find(d => d.pk === devicePk);
  if (!existing) {
    devs.push({ pk: devicePk, name: '' });
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

export function loadProfileFromCache(devicePk) {
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
    ensureProfile(devicePk);
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

// helpers exported for other modules

export { base64urlToBytes, bytesToBase64url };
