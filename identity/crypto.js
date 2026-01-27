// crypto.js
// Symmetric AES-GCM helpers + base64url helpers.

/**
 * Convert a Uint8Array to a base64url string.
 */
export function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Convert a base64url string to Uint8Array.
 */
export function base64urlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt a plaintext string with AES-GCM using a raw 32-byte key.
 * Returns base64url string (IV + ciphertext combined).
 */
export async function encryptSym(keyBytes, plain) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return bytesToBase64url(combined);
}

/**
 * Decrypt a base64url (IV + ciphertext) with AES-GCM.
 */
export async function decryptSym(keyBytes, b64url) {
  const combined = base64urlToBytes(b64url);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
