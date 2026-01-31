import { nip04Encrypt } from './nostr.js'
import { getIdentity, setIdentity } from './identityStore.js'
import { ensureRoomKey, rotateRoomKey } from './cryptoRoom.js'
import { publishKind } from './relayOut.js'

export async function distributeRoomKey(sw, identity, excludePk = null) {
  const keys = await self.ensureNostrKeys(sw)
  for (const d of identity.devices) {
    if (!d.pk || d.pk === excludePk) continue
    const cipher = await nip04Encrypt(keys, d.pk, identity.roomKeyB64)
    await publishKind(sw, 'room_key_update', { devicePk: d.pk, cipher })
  }
}

export async function revokeDevice(sw, pk) {
  const identity = await getIdentity()
  identity.devices = identity.devices.filter(d => d.pk !== pk)

  rotateRoomKey(identity)
  await setIdentity(identity)

  await distributeRoomKey(sw, identity, pk)
  await publishKind(sw, 'device_revoked', { pk })
  return { ok:true }
}
