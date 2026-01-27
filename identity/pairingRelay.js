// pairingRelay.js
// Nostr relay for device pairing: pair-request + pair-accept.

import { bytesToBase64url } from './identityState.js';

const RELAY_URL = 'wss://relay.snort.social';
const PAIR_REQUEST_KIND = 30031;
const PAIR_ACCEPT_KIND  = 30032;

export function createPairingRelay({
  device,
  onStatus,
  onPairRequest,      // (payload: { pairingId, code, devicePk, ownerName }) => void
  onPairingComplete   // (payload: { identityId, identityKeyB64, pairingId }) => void
}) {
  const NT = window.NostrTools;
  if (!NT) throw new Error('nostr-tools missing');
  const nip04 = NT.nip04;

  let ws = null;
  let connected = false;

  function connect(ownerName) {
    if (ws) return;

    ws = new WebSocket(RELAY_URL, 'nostr');

    ws.onopen = () => {
      connected = true;

      ws.send(JSON.stringify([
        'REQ',
        'pair-accepts',
        { kinds: [PAIR_ACCEPT_KIND], '#p': [device.pk], limit: 20 }
      ]));

      if (ownerName) {
        ws.send(JSON.stringify([
          'REQ',
          'pair-requests',
          { kinds: [PAIR_REQUEST_KIND], '#u': [ownerName], limit: 50 }
        ]));
      }
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      setTimeout(() => connect(ownerName), 3000);
    };

    ws.onerror = (e) => {
      console.error('[pairingRelay] error', e);
    };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const [type, subId, evt] = msg;
      if (type !== 'EVENT' || !evt) return;

      if (evt.kind === PAIR_REQUEST_KIND && subId === 'pair-requests') {
        handlePairRequestEvent(evt);
      }
      if (evt.kind === PAIR_ACCEPT_KIND) {
        handlePairAcceptEvent(evt).catch(console.error);
      }
    };
  }

  function resubscribeForOwnerName(ownerName) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!ownerName) return;
    ws.send(JSON.stringify([
      'REQ',
      'pair-requests',
      { kinds: [PAIR_REQUEST_KIND], '#u': [ownerName], limit: 50 }
    ]));
  }

  function handlePairRequestEvent(evt) {
    try {
      const payload = JSON.parse(evt.content || '{}');
      const pairingId = payload.pairingId;
      const code      = payload.code;
      const devicePk  = payload.devicePk || (evt.tags.find(t => t[0] === 'p')?.[1] || '');
      const ownerNameTag = evt.tags.find(t => t[0] === 'u');
      const ownerName = ownerNameTag ? ownerNameTag[1] : '(unknown)';

      if (!pairingId || !code || !devicePk) return;

      onPairRequest && onPairRequest({ pairingId, code, devicePk, ownerName });
      onStatus && onStatus(`pair request from device (code ${code})`);
    } catch (e) {
      console.warn('[pairingRelay] invalid pair-request', e);
    }
  }

  async function handlePairAcceptEvent(evt) {
    const pairTag = evt.tags.find(t => t[0] === 'pair');
    const pTag    = evt.tags.find(t => t[0] === 'p');
    const pairingId = pairTag && pairTag[1];
    const targetPk  = pTag && pTag[1];
    if (!pairingId || !targetPk) return;
    if (targetPk !== device.pk) return;

    try {
      const plain = await nip04.decrypt(device.sk, evt.pubkey, evt.content);
      const payload = JSON.parse(plain);
      if (!payload.identityId || !payload.identityKey) return;

      onPairingComplete && onPairingComplete({
        identityId: payload.identityId,
        identityKeyB64: payload.identityKey,
        pairingId
      });
      onStatus && onStatus('pairing complete; identity loaded');
    } catch (e) {
      console.warn('[pairingRelay] failed to decrypt pair-accept', e);
    }
  }

  async function sendPairRequest(ownerName, pairingId, code) {
    if (!ownerName) {
      onStatus && onStatus('enter an owner name to search');
      return;
    }
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      onStatus && onStatus('pairing relay not ready');
      return;
    }

    const payload = {
      pairingId,
      code,
      devicePk: device.pk
    };

    const unsigned = {
      kind: PAIR_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['app', 'anarchy-identity'],
        ['type', 'pair-request'],
        ['u', ownerName],
        ['pair', pairingId],
        ['p', device.pk]
      ],
      content: JSON.stringify(payload),
      pubkey: device.pk
    };

    const id  = NT.getEventHash(unsigned);
    const sig = NT.getSignature(unsigned, device.sk);
    const event = { ...unsigned, id, sig };

    ws.send(JSON.stringify(['EVENT', event]));
    onStatus && onStatus('pair-request sent; waiting for approval');
  }

  async function approvePairRequest(pairingId, targetDevicePk, code, identityId, identityKeyBytes) {
    if (!identityId || !identityKeyBytes) {
      onStatus && onStatus('cannot approve: no owner identity loaded');
      return;
    }
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      onStatus && onStatus('pairing relay not ready');
      return;
    }

    const payload = {
      identityId,
      identityKey: bytesToBase64url(identityKeyBytes)
    };

    const cipher = await nip04.encrypt(device.sk, targetDevicePk, JSON.stringify(payload));

    const unsigned = {
      kind: PAIR_ACCEPT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['app', 'anarchy-identity'],
        ['type', 'pair-accept'],
        ['pair', pairingId],
        ['p', targetDevicePk]
      ],
      content: cipher,
      pubkey: device.pk
    };

    const id  = NT.getEventHash(unsigned);
    const sig = NT.getSignature(unsigned, device.sk);
    const event = { ...unsigned, id, sig };

    ws.send(JSON.stringify(['EVENT', event]));
    onStatus && onStatus(`approved pairing (code ${code})`);
  }

  function isConnected() {
    return connected;
  }

  return {
    connect,
    isConnected,
    resubscribeForOwnerName,
    sendPairRequest,
    approvePairRequest
  };
}
