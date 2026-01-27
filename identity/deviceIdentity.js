// deviceIdentity.js
// Per-device Nostr identity (one keypair per browser/device).

/**
 * Get or create a persistent device identity.
 * Stored in localStorage under 'identity_device_sk'.
 */
export function getOrCreateDeviceIdentity() {
  const NT = window.NostrTools;
  if (!NT) throw new Error('NostrTools not available');

  let sk = localStorage.getItem('identity_device_sk');
  if (!sk) {
    sk = NT.generatePrivateKey(); // hex
    localStorage.setItem('identity_device_sk', sk);
  }
  const pk = NT.getPublicKey(sk);
  return { sk, pk };
}
