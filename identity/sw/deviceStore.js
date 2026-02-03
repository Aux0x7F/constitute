// FILE: identity/sw/deviceStore.js

import { kvGet, kvSet } from './idb.js';
import { randomBytes, b64url } from './crypto.js';
import { ensureNostrKeys } from './nostr.js';

export async function ensureDevice() {
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

export async function getDevice() {
  return await ensureDevice();
}

export async function setThisDeviceLabel(label) {
  const dev = await ensureDevice();
  dev.label = label;
  await kvSet('device', dev);

  // also update identity device list if linked
  const ident = await kvGet('identity');
  if (ident?.linked && Array.isArray(ident.devices)) {
    const me = ident.devices.find(d => d.pk === dev.nostr.pk);
    if (me) me.label = label;
    await kvSet('identity', ident);
  }
}
