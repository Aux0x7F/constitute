// FILE: identity/sw/revoke.js

import { randomBytes, b64url } from './crypto.js';
import { nip04Encrypt } from './nostr.js';
import { ensureDevice } from './deviceStore.js';
import { getIdentity, setIdentity } from './identityStore.js';
import { publishAppEvent } from './relayOut.js';
import { blockedAdd } from './blocklist.js';

export async function revokeDeviceAndRotate(sw, targetPk) {
  const ident = await getIdentity();
  if (!ident?.linked || !ident?.label || !ident?.roomKeyB64) {
    throw new Error('no linked identity');
  }

  // Persist blacklist entry locally first.
  await blockedAdd({ pk: targetPk, reason: 'revoked' });

  // Remove target from known devices.
  ident.devices = (ident.devices || []).filter(d => d.pk !== targetPk);

  // Rotate key.
  ident.roomKeyB64 = b64url(randomBytes(32));
  await setIdentity(ident);

  // Notify all devices (including revoked, so everyone converges).
  await publishAppEvent(sw, {
    type: 'device_revoked',
    identity: ident.label,
    targetPk,
  }, [['i', ident.label]]);

  // Also broadcast a block signal so other devices can add to their local blacklist.
  await publishAppEvent(sw, {
    type: 'device_blocked',
    identity: ident.label,
    targetPk,
    reason: 'revoked',
  }, [['i', ident.label]]);

  // Push new room key to remaining devices via nip04 encrypted envelope.
  const dev = await ensureDevice();
  const payload = JSON.stringify({
    identityId: ident.id,
    roomKeyB64: ident.roomKeyB64,
  });

  for (const d of (ident.devices || [])) {
    if (!d?.pk) continue;
    const encryptedRoomKey = await nip04Encrypt(dev.nostr.skHex, d.pk, payload);
    await publishAppEvent(sw, {
      type: 'room_key_update',
      identity: ident.label,
      toPk: d.pk,
      fromPk: dev.nostr.pk,
      encryptedRoomKey,
    }, [['i', ident.label], ['p', d.pk]]);
  }

  return { ok: true };
}
