export function randomBytes(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlToBytes(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function aesGcmEncrypt(keyBytes, plaintextBytes, aadBytes = null) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const alg = { name: 'AES-GCM', iv };
  if (aadBytes) alg.additionalData = aadBytes;

  const ct = new Uint8Array(await crypto.subtle.encrypt(alg, key, plaintextBytes));
  return { ivB64: b64url(iv), ctB64: b64url(ct) };
}

export async function aesGcmDecrypt(keyBytes, ivB64, ctB64, aadBytes = null) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const iv = b64urlToBytes(ivB64);
  const ct = b64urlToBytes(ctB64);
  const alg = { name: 'AES-GCM', iv };
  if (aadBytes) alg.additionalData = aadBytes;

  const pt = new Uint8Array(await crypto.subtle.decrypt(alg, key, ct));
  return pt;
}
