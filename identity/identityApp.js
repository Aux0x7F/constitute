// identityApp.js
// Orchestrates UI, identity state, identity relay, and pairing relay.

import { getOrCreateDeviceIdentity } from './deviceIdentity.js';
import {
  getIdentityId,
  getIdentityKeyBytes,
  setIdentityFromBytes,
  setIdentityFromB64,
  createNewIdentity,
  persistAssociation,
  loadAssociationFromLocal,
  loadAssociationFromHash,
  getProfile,
  setProfile,
  ensureProfile,
  loadProfileFromCache,
  saveProfileToCache,
  bytesToBase64url
} from './identityState.js';
import { createIdentityRelay } from './identityRelay.js';
import { createPairingRelay } from './pairingRelay.js';

export function initIdentityApp() {
  const NT = window.NostrTools;
  if (!NT) {
    const status = document.getElementById('status');
    if (status) status.textContent = 'nostr-tools not loaded';
    return;
  }

  // DOM
  const statusEl        = document.getElementById('status');
  const panePathEl      = document.getElementById('panePath');
  const btnMenu         = document.getElementById('btnMenu');
  const menuDropdown    = document.getElementById('menuDropdown');

  const onboardView     = document.getElementById('onboardView');
  const homeView        = document.getElementById('homeView');
  const settingsView    = document.getElementById('settingsView');

  const btnCreateOwner  = document.getElementById('btnCreateOwner');
  const ownerNameInput  = document.getElementById('ownerNameSearch');
  const btnRequestPair  = document.getElementById('btnRequestPair');
  const pairCodeDisplay = document.getElementById('pairCodeDisplay');

  const displayNameEl   = document.getElementById('displayName');
  const bioEl           = document.getElementById('bio');
  const identityUrlEl   = document.getElementById('identityUrl');
  const copyLinkBtn     = document.getElementById('copyLink');

  const devicePkEl      = document.getElementById('devicePk');
  const deviceNameEl    = document.getElementById('deviceName');
  const devicesListEl   = document.getElementById('devicesList');
  const pairRequestsEl  = document.getElementById('pairRequests');

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  // device identity (this browser)
  const device = getOrCreateDeviceIdentity();
  devicePkEl.textContent = device.pk;

  // pane / activity switching
  let activeActivity = 'home'; // 'home' | 'settings'
  function showOnboarding() {
    onboardView.classList.remove('hidden');
    homeView.classList.add('hidden');
    settingsView.classList.add('hidden');
    btnMenu.style.display = 'none';
    panePathEl.textContent = 'Onboarding';
  }
  function showActivity(activity) {
    onboardView.classList.add('hidden');
    homeView.classList.toggle('hidden', activity !== 'home');
    settingsView.classList.toggle('hidden', activity !== 'settings');
    btnMenu.style.display = 'inline-block';
    activeActivity = activity;
    panePathEl.textContent = activity === 'home' ? 'Home' : 'Home / Settings';
  }

  btnMenu.addEventListener('click', () => {
    const visible = menuDropdown.style.display === 'block';
    menuDropdown.style.display = visible ? 'none' : 'block';
  });
  menuDropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-activity]');
    if (!btn) return;
    const activity = btn.getAttribute('data-activity');
    menuDropdown.style.display = 'none';
    if (!getIdentityId() || !getIdentityKeyBytes()) return;
    showActivity(activity);
  });
  document.addEventListener('click', (e) => {
    if (!btnMenu.contains(e.target) && !menuDropdown.contains(e.target)) {
      menuDropdown.style.display = 'none';
    }
  });

  // profile rendering

  function renderProfile() {
    const profile = getProfile();
    if (!profile) {
      displayNameEl.value = '';
      bioEl.value = '';
      devicesListEl.textContent = '(none recorded yet)';
      deviceNameEl.value = '';
      return;
    }

    displayNameEl.value = profile.name || '';
    bioEl.value         = profile.bio  || '';

    const devices = Array.isArray(profile.devices) ? profile.devices : [];
    if (!devices.length) {
      devicesListEl.textContent = '(none recorded yet)';
    } else {
      devicesListEl.innerHTML = devices
        .map(d => d.name ? `${d.name} (${d.pk})` : d.pk)
        .join('<br>');
    }

    const me = devices.find(d => d.pk === device.pk);
    deviceNameEl.value = me && me.name ? me.name : '';
    updateIdentityUrlInUI();
  }

  function updateIdentityUrlInUI() {
    const id = getIdentityId();
    const keyBytes = getIdentityKeyBytes();
    if (!id || !keyBytes) return;
    const keyParam = bytesToBase64url(keyBytes);
    const base = `${window.location.origin}${window.location.pathname}`;
    const link = `${base}#id=${encodeURIComponent(id)}&k=${encodeURIComponent(keyParam)}`;
    identityUrlEl.value = link;
  }

  copyLinkBtn.addEventListener('click', async () => {
    if (!identityUrlEl.value) return;
    try {
      await navigator.clipboard.writeText(identityUrlEl.value);
      setStatus('link copied');
      setTimeout(() => setStatus(''), 800);
    } catch {
      setStatus('copy failed; copy manually');
    }
  });

  // identity relay

  const identityRelay = createIdentityRelay({
    device,
    onStatus: setStatus,
    onProfileChange: () => {
      renderProfile();
    }
  });

  // pairing relay

  const pendingRequests = new Map(); // pairingId -> {code, devicePk}
  let currentPairingId   = null;
  let currentPairingCode = null;

  const pairingRelay = createPairingRelay({
    device,
    onStatus: setStatus,
    onPairRequest: ({ pairingId, code, devicePk }) => {
      if (pendingRequests.has(pairingId)) return;
      pendingRequests.set(pairingId, { code, devicePk });
      addPairRequestToUI(pairingId, code, devicePk);
    },
    onPairingComplete: ({ identityId, identityKeyB64, pairingId }) => {
      // accept pairing; set identity + profile
      setIdentityFromB64(identityId, identityKeyB64);
      persistAssociation();
      // reset profile so we re-sync
      setProfile(null);
      loadProfileFromCache(device.pk);
      startWithOwnerIdentity();
      currentPairingId = null;
      currentPairingCode = null;
      pairCodeDisplay.textContent = '(none)';
    }
  });

  function addPairRequestToUI(pairingId, code, devicePk) {
  const div = document.createElement('div');
  div.className = 'pair-request';
  div.dataset.pairingId = pairingId;
  div.innerHTML = `
    <div><span class="pill">device</span> ${devicePk}</div>
    <div>code: <strong>${code}</strong></div>
    <div style="margin-top:4px; display:flex; gap:6px;">
      <button type="button" class="approve-btn">approve</button>
      <button type="button" class="ignore-btn">✕ ignore</button>
    </div>
  `;

  const approveBtn = div.querySelector('.approve-btn');
  const ignoreBtn  = div.querySelector('.ignore-btn');

  approveBtn.addEventListener('click', () => {
    const id = getIdentityId();
    const keyBytes = getIdentityKeyBytes();
    pairingRelay.approvePairRequest(
      pairingId,
      devicePk,
      code,
      id,
      keyBytes
    ).then(() => {
      const el = pairRequestsEl.querySelector(`[data-pairing-id="${pairingId}"]`);
      if (el) el.remove();
      pendingRequests.delete(pairingId);
    }).catch(console.error);
  });

  ignoreBtn.addEventListener('click', () => {
    const el = pairRequestsEl.querySelector(`[data-pairing-id="${pairingId}"]`);
    if (el) el.remove();
    pendingRequests.delete(pairingId);
    setStatus(`pair request ignored (code ${code})`);
  });

  pairRequestsEl.appendChild(div);
}


  // local edits -> schedule save

  let suppressChange = false;
  let saveTimeout = null;
  function scheduleSave() {
    if (!getIdentityId() || !getIdentityKeyBytes()) return;
    if (suppressChange) {
      suppressChange = false;
      return;
    }
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      ensureProfile(device.pk);
      saveProfileToCache();
      identityRelay.publishProfile().catch(console.error);

      // resubscribe pairing requests if owner name changed
      const profile = getProfile();
      const ownerName = profile && profile.name ? profile.name : '';
      pairingRelay.resubscribeForOwnerName(ownerName);
    }, 600);
  }

  displayNameEl.addEventListener('input', () => {
    if (!getIdentityId() || !getIdentityKeyBytes()) return;
    ensureProfile(device.pk);
    const profile = getProfile();
    profile.name = displayNameEl.value || '';
    scheduleSave();
  });

  bioEl.addEventListener('input', () => {
    if (!getIdentityId() || !getIdentityKeyBytes()) return;
    ensureProfile(device.pk);
    const profile = getProfile();
    profile.bio = bioEl.value || '';
    scheduleSave();
  });

  deviceNameEl.addEventListener('input', () => {
    if (!getIdentityId() || !getIdentityKeyBytes()) return;
    ensureProfile(device.pk);
    const profile = getProfile();
    const devs = profile.devices || [];
    const me = devs.find(d => d.pk === device.pk);
    if (me) me.name = deviceNameEl.value || '';
    scheduleSave();
  });

  // pairing flows

  btnRequestPair.addEventListener('click', () => {
    const name = ownerNameInput.value.trim();
    if (!name) {
      setStatus('enter an owner name to search');
      return;
    }
    currentPairingId   = Math.random().toString(36).slice(2, 12);
    currentPairingCode = (Math.floor(Math.random() * 900000) + 100000).toString();

    pairCodeDisplay.textContent = currentPairingCode;
    pairingRelay.sendPairRequest(name, currentPairingId, currentPairingCode)
      .catch(console.error);
  });

  // owner lifecycle

  function startWithOwnerIdentity() {
    showActivity('home');
    ensureProfile(device.pk);
    loadProfileFromCache(device.pk);
    renderProfile();
    updateIdentityUrlInUI();
    identityRelay.connect();
    const profile = getProfile();
    const ownerName = profile && profile.name ? profile.name : '';
    pairingRelay.connect(ownerName);
    setStatus('owner identity ready; syncing…');
  }

  btnCreateOwner.addEventListener('click', () => {
    createNewIdentity();
    persistAssociation();
    startWithOwnerIdentity();
  });

  // boot sequence

  const hasLocal = loadAssociationFromLocal();
  const hasHash  = !hasLocal && loadAssociationFromHash(window.location.hash);

  pairingRelay.connect(null); // start listening for accept events regardless

  if (hasLocal || hasHash) {
    startWithOwnerIdentity();
  } else {
    showOnboarding();
  }
}
