import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip04,
} from 'https://cdn.jsdelivr.net/npm/nostr-tools@2.7.2/+esm';

export function ensureNostrKeys(existing) {
  if (existing?.skHex && existing?.pk) return existing;
  const sk = generateSecretKey(); // Uint8Array
  const pk = getPublicKey(sk);    // hex
  return { skHex: bytesToHex(sk), pk };
}

export function bytesToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function signEventUnsigned(unsignedEvent, skHex) {
  const sk = hexToBytes(skHex);
  return finalizeEvent(unsignedEvent, sk);
}

export async function nip04Encrypt(skHex, recipientPkHex, plaintext) {
  return await nip04.encrypt(skHex, recipientPkHex, plaintext);
}

export async function nip04Decrypt(skHex, senderPkHex, ciphertext) {
  return await nip04.decrypt(skHex, senderPkHex, ciphertext);
}
