export function randomBytes(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256B64Url(str) {
  const enc = new TextEncoder().encode(String(str || ''));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc));
  return b64url(hash);
}
