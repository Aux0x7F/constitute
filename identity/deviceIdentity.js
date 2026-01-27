// deviceIdentity.js
// Manages per-device identity:
// - nostr keypair (secp256k1, used by nostr-tools)
// - device DID (soft default, optional WebAuthn/TPM-backed)

const DEVICE_KEY_KEY   = 'device_nostr_keypair';
const DEVICE_META_KEY  = 'device_meta';

function createNostrKeypair() {
  const NT = window.NostrTools;
  if (!NT) throw new Error('nostr-tools missing for device keys');
  const sk = NT.generatePrivateKey();
  const pk = NT.getPublicKey(sk);
  return { sk, pk };
}

function loadDeviceMeta() {
  try {
    const raw = localStorage.getItem(DEVICE_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDeviceMeta(meta) {
  localStorage.setItem(DEVICE_META_KEY, JSON.stringify(meta));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function getOrCreateDeviceIdentity() {
  const NT = window.NostrTools;
  if (!NT) throw new Error('nostr-tools missing');

  // 1) Load or create nostr keypair
  let kp;
  const raw = localStorage.getItem(DEVICE_KEY_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      kp = { sk: parsed.sk, pk: parsed.pk };
    } catch {
      kp = createNostrKeypair();
      localStorage.setItem(DEVICE_KEY_KEY, JSON.stringify(kp));
    }
  } else {
    kp = createNostrKeypair();
    localStorage.setItem(DEVICE_KEY_KEY, JSON.stringify(kp));
  }

  // 2) Load / init device metadata (DID)
  const meta = loadDeviceMeta();

  if (!meta.deviceId || !meta.did || !meta.didMethod) {
    const deviceId = meta.deviceId || Math.random().toString(36).slice(2, 10);

    // Soft DID derived from nostr pubkey by default.
    // You can change scheme later (e.g. did:swarm:...) without breaking structure.
    const did = `did:device:nostr:${kp.pk}`;

    const updated = {
      ...meta,
      deviceId,
      did,
      didMethod: 'nostr-soft',
      createdAt: meta.createdAt || Date.now()
    };
    saveDeviceMeta(updated);
    return {
      sk: kp.sk,
      pk: kp.pk,
      deviceId,
      did,
      didMethod: updated.didMethod
    };
  }

  return {
    sk: kp.sk,
    pk: kp.pk,
    deviceId: meta.deviceId,
    did: meta.did,
    didMethod: meta.didMethod
  };
}

/**
 * Try to upgrade device DID to a WebAuthn / TPM-backed credential.
 * - Creates a platform authenticator credential.
 * - DOES NOT replace the nostr keypair.
 * - Sets didMethod = "webauthn", did = "did:device:webauthn:<credIdB64url>"
 *
 * Must be called from a user gesture (button click) on HTTPS / localhost.
 */
export async function upgradeDeviceDidWithWebAuthn() {
  if (!('credentials' in navigator) || !('create' in navigator.credentials)) {
    throw new Error('WebAuthn not supported on this platform / context');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const meta = loadDeviceMeta();
  const deviceId = meta.deviceId || Math.random().toString(36).slice(2, 10);
  const userIdBytes = new TextEncoder().encode(deviceId);

  const publicKeyOptions = {
    challenge,
    rp: {
      name: 'Anarchy Identity',
      id: window.location.hostname
    },
    user: {
      id: userIdBytes,
      name: deviceId,
      displayName: deviceId
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 }
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'preferred'
    },
    timeout: 60000,
    attestation: 'direct'
  };

  const cred = await navigator.credentials.create({ publicKey: publicKeyOptions });
  if (!cred || cred.type !== 'public-key') {
    throw new Error('WebAuthn credential creation failed or was cancelled');
  }

  const rawId = new Uint8Array(cred.rawId);
  const credIdB64 = base64url(rawId);

  const newDid = `did:device:webauthn:${credIdB64}`;

  const updatedMeta = {
    ...meta,
    deviceId,
    did: newDid,
    didMethod: 'webauthn',
    webauthnCredId: credIdB64,
    upgradedAt: Date.now()
  };
  saveDeviceMeta(updatedMeta);

  return {
    deviceId,
    did: newDid,
    didMethod: 'webauthn'
  };
}
