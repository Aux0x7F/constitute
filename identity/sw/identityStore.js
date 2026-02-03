// FILE: identity/sw/identityStore.js

import { kvGet, kvSet } from './idb.js';

export async function getIdentity() {
  return await kvGet('identity');
}

export async function setIdentity(identity) {
  await kvSet('identity', identity);
}

export async function getProfile() {
  return (await kvGet('profile')) || { name: '', about: '' };
}

export async function setProfile(p) {
  await kvSet('profile', p);
}

export async function setPendingJoinIdentityLabel(labelOrNull) {
  await kvSet('pendingJoinIdentityLabel', labelOrNull);
}
