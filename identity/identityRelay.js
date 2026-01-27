// identityRelay.js
// Nostr relay for encrypted owner profile sync (IDENTITY_KIND).

import { encryptSym, decryptSym } from './crypto.js';
import {
  getIdentityId,
  getIdentityKeyBytes,
  getProfile,
  setProfile,
  ensureProfile,
  ensureDeviceEntry,
  saveProfileToCache
} from './identityState.js';

const RELAY_URL = 'wss://relay.snort.social';
const IDENTITY_KIND = 30030;

export function createIdentityRelay({ device, onStatus, onProfileChange }) {
  const NT = window.NostrTools;
  if (!NT) throw new Error('nostr-tools missing');
  let ws = null;
  let connected = false;

  function connect() {
    const id = getIdentityId();
    const keyBytes = getIdentityKeyBytes();
    if (!id || !keyBytes) return;
    if (ws) return;

    onStatus && onStatus('connecting to identity relay…');
    ws = new WebSocket(RELAY_URL, 'nostr');

    ws.onopen = () => {
      connected = true;
      onStatus && onStatus('connected; syncing profile…');
      const req = [
        'REQ',
        'id-profile',
        {
          kinds: [IDENTITY_KIND],
          '#id': [id],
          limit: 1
        }
      ];
      ws.send(JSON.stringify(req));
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      onStatus && onStatus('identity relay disconnected; retrying…');
      setTimeout(connect, 2000);
    };

    ws.onerror = (e) => {
      console.error('[identityRelay] error', e);
    };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const [type, subId, evt] = msg;
      if (type !== 'EVENT' || subId !== 'id-profile' || !evt) return;
      if (evt.kind !== IDENTITY_KIND) return;

      const keyBytesNow = getIdentityKeyBytes();
      const idNow = getIdentityId();
      if (!keyBytesNow || !idNow) return;

      try {
        const plain = await decryptSym(keyBytesNow, evt.content);
        const incoming = JSON.parse(plain);
        if (!incoming || incoming.id !== idNow) return;

        // Did the incoming profile already include this device?
        let hadMe = false;
        if (Array.isArray(incoming.devices)) {
          hadMe = incoming.devices.some(d => {
            if (typeof d === 'string') return d === device.pk;
            return d && d.pk === device.pk;
          });
        }

        setProfile(incoming);
        ensureProfile(device.pk, device.did);
        ensureDeviceEntry(device.pk, device.did);

        const updatedProfile = getProfile();
        saveProfileToCache();
        onProfileChange && onProfileChange(updatedProfile);

        if (!hadMe) {
          onStatus && onStatus('adding this device to identity…');
          await publishProfile();
        } else {
          onStatus && onStatus('profile synced');
        }
      } catch (e) {
        console.warn('[identityRelay] decrypt/parse identity failed', e);
      }
    };
  }

  async function publishProfile() {
    const id = getIdentityId();
    const keyBytes = getIdentityKeyBytes();
    if (!id || !keyBytes) return;
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;

    ensureProfile(device.pk, device.did);
    ensureDeviceEntry(device.pk, device.did);
    const profile = getProfile();
    if (!profile) return;

    saveProfileToCache();
    onProfileChange && onProfileChange(profile);

    const cipher = await encryptSym(keyBytes, JSON.stringify(profile));

    const unsigned = {
      kind: IDENTITY_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['app', 'anarchy-identity'],
        ['id', id]
      ],
      content: cipher,
      pubkey: device.pk
    };

    const eid = NT.getEventHash(unsigned);
    const sig = NT.getSignature(unsigned, device.sk);
    const event = { ...unsigned, id: eid, sig };

    ws.send(JSON.stringify(['EVENT', event]));
    onStatus && onStatus('profile saved');
  }

  function isConnected() {
    return connected;
  }

  return {
    connect,
    publishProfile,
    isConnected
  };
}
