export function randomBytes(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
