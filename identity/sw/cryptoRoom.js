import { randomBytes, b64url, b64urlToBytes, aesGcmEncrypt, aesGcmDecrypt } from './crypto.js'

const te = new TextEncoder()
const td = new TextDecoder()

export function ensureRoomKey(identity) {
  if (!identity.roomKeyB64) identity.roomKeyB64 = b64url(randomBytes(32))
  return identity
}

export function rotateRoomKey(identity) {
  identity.roomKeyB64 = b64url(randomBytes(32))
  return identity.roomKeyB64
}

export async function encryptRoom(identity, obj, aad) {
  const key = b64urlToBytes(identity.roomKeyB64)
  const pt = te.encode(JSON.stringify(obj))
  return await aesGcmEncrypt(key, pt, te.encode(aad))
}

export async function decryptRoom(identity, enc, aad) {
  const key = b64urlToBytes(identity.roomKeyB64)
  const pt = await aesGcmDecrypt(key, enc.iv, enc.ct, te.encode(aad))
  return JSON.parse(td.decode(pt))
}
