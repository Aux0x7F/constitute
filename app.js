import { IdentityClient } from './identity/client.js';

const panePathEl = document.getElementById('panePath');

const connWrap = document.getElementById('connWrap');
const connDot = document.getElementById('connDot');
const connStateText = document.getElementById('connStateText');
const connLog = document.getElementById('connLog');
const connPopover = document.getElementById('connPopover');
const popRelay = document.getElementById('popRelay');
const popDaemon = document.getElementById('popDaemon');

const btnMenu = document.getElementById('btnMenu');
const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const btnDrawerClose = document.getElementById('btnDrawerClose');

const btnBell = document.getElementById('btnBell');
const notifMenu = document.getElementById('notifMenu');
const notifList = document.getElementById('notifList');
const btnNotifClear = document.getElementById('btnNotifClear');

const viewHome = document.getElementById('viewHome');
const viewSettings = document.getElementById('viewSettings');
const viewOnboard = document.getElementById('viewOnboard');

const tabButtons = Array.from(viewSettings.querySelectorAll('.tab'));
const tabPanes = {
  profile: document.getElementById('tab_profile'),
  devices: document.getElementById('tab_devices'),
  peers: document.getElementById('tab_peers'),
  pairing: document.getElementById('tab_pairing'),
  identity: document.getElementById('tab_identity'),
};

const profileName = document.getElementById('profileName');
const profileAbout = document.getElementById('profileAbout');
const btnSaveProfile = document.getElementById('btnSaveProfile');

const deviceDid = document.getElementById('deviceDid');
const deviceLabel = document.getElementById('deviceLabel');
const btnSaveDeviceLabel = document.getElementById('btnSaveDeviceLabel');
const deviceList = document.getElementById('deviceList');
const blockedList = document.getElementById('blockedList');

const pairingList = document.getElementById('pairingList');
const pairingEmpty = document.getElementById('pairingEmpty');

const identityLabelEl = document.getElementById('identityLabel');
const identityIdEl = document.getElementById('identityId');
const identityLinkedEl = document.getElementById('identityLinked');

const joinDeviceLabelEl = document.getElementById('joinDeviceLabel');

const deviceDidSummary = document.getElementById('deviceDidSummary');
const deviceSecuritySummary = document.getElementById('deviceSecuritySummary');
const identityLinkedSummary = document.getElementById('identityLinkedSummary');

// Peers UI
const zoneNameInput = document.getElementById('zoneName');
const btnCreateZone = document.getElementById('btnCreateZone');
const zonesList = document.getElementById('zonesList');
const zoneLink = document.getElementById('zoneLink');
const btnCopyZoneLink = document.getElementById('btnCopyZoneLink');
const zoneJoinKey = document.getElementById('zoneJoinKey');
const btnJoinZone = document.getElementById('btnJoinZone');
const peersCount = document.getElementById('peersCount');
const peersList = document.getElementById('peersList');

// Onboarding elements
const obStepDevice = document.getElementById('obStepDevice');
const obStepIdentity = document.getElementById('obStepIdentity');
const btnObDeviceContinue = document.getElementById('btnObDeviceContinue');
const obDeviceLabel = document.getElementById('obDeviceLabel');
const obIdentityLabel = document.getElementById('obIdentityLabel');
const btnObIdentityContinue = document.getElementById('btnObIdentityContinue');
const existingInfo = document.getElementById('existingInfo');
const obModeTabs = Array.from(obStepIdentity.querySelectorAll('.tab'));

const btnSecWebAuthn = document.getElementById('btnSecWebAuthn');
const btnSecSkip = document.getElementById('btnSecSkip');
const obDeviceStatus = document.getElementById('obDeviceStatus');

let relayState = 'offline';
let daemonState = 'unknown';
let connDerived = 'offline';
const connStateLog = []; // newest first

let lastDeviceState = null;
let lastIdentity = null;
let lastDirectory = [];
let lastZones = [];
let activeZoneKey = '';
let pendingZoneNav = false;

function _deriveConnState() {
  const r = relayState;
  const d = daemonState;

  if (d !== 'online') {
    if (r === 'open') return 'degraded';
    if (r === 'connecting') return 'connecting';
    return 'disconnected';
  }

  if (r === 'open') return 'connected';
  if (r === 'connecting') return 'connecting';
  if (r === 'error' || r === 'closed') return 'error';
  return 'disconnected';
}

function _pushConnLog(reason = '') {
  const state = _deriveConnState();
  if (state === connDerived && connStateLog.length > 0) return;

  connDerived = state;
  connStateText.textContent = state;

  connStateLog.unshift({ ts: Date.now(), state, reason: String(reason || '') });
  while (connStateLog.length > 25) connStateLog.pop();

  renderConnLog();
}

function renderConnLog() {
  connLog.innerHTML = '';
  for (const e of connStateLog) {
    const row = document.createElement('div');
    row.className = 'connLogItem';
    const t = new Date(e.ts);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    row.innerHTML = `
      <span>${hh}:${mm}:${ss}</span>
      <span class="connLogState">${escapeHtml(e.state)}</span>
    `;
    connLog.appendChild(row);
  }
}

function setRelayState(s, reason = '') {
  relayState = String(s || 'offline');
  popRelay.textContent = relayState;

  connDot.classList.remove('conn-off', 'conn-open', 'conn-err', 'conn-conn');
  if (relayState === 'open') connDot.classList.add('conn-open');
  else if (relayState === 'connecting') connDot.classList.add('conn-conn');
  else if (relayState === 'error' || relayState === 'closed') connDot.classList.add('conn-err');
  else connDot.classList.add('conn-off');

  _pushConnLog(reason);
}

function setDaemonState(s, reason = '') {
  daemonState = String(s || 'unknown');
  popDaemon.textContent = daemonState;
  _pushConnLog(reason);
}

function showConnPopover() { connPopover.classList.remove('hidden'); }
function hideConnPopover() { connPopover.classList.add('hidden'); }
connWrap.addEventListener('mouseenter', showConnPopover);
connWrap.addEventListener('mouseleave', hideConnPopover);
connWrap.addEventListener('focusin', showConnPopover);
connWrap.addEventListener('focusout', hideConnPopover);

// drawer
function openDrawer() {
  drawer.classList.remove('hidden');
  drawerBackdrop.classList.remove('hidden');
}
function closeDrawer() {
  drawer.classList.add('hidden');
  drawerBackdrop.classList.add('hidden');
}
btnMenu.addEventListener('click', openDrawer);
btnDrawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

// notifications
function toggleNotifMenu() {
  notifMenu.classList.toggle('hidden');
}
btnBell.addEventListener('click', toggleNotifMenu);
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!notifMenu.contains(t) && !btnBell.contains(t)) notifMenu.classList.add('hidden');
});

// activities
function showActivity(name) {
  viewHome.classList.toggle('hidden', name !== 'home');
  viewSettings.classList.toggle('hidden', name !== 'settings');
  viewOnboard.classList.toggle('hidden', name !== 'onboarding');
  panePathEl.textContent = name === 'home' ? '' : name;
}

function setSettingsTab(name) {
  for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === name);
  for (const [k, el] of Object.entries(tabPanes)) el.classList.toggle('hidden', k !== name);
}

function clear(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function renderNotifications(notifs) {
  clear(notifList);
  const unread = (notifs || []).filter(n => !n.read);
  btnBell.classList.toggle('has-unread', unread.length !== 0);

  if (!notifs || notifs.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No notifications.';
    notifList.appendChild(d);
    return;
  }

  for (const n of notifs) {
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="itemTitle">${escapeHtml(n.title || '')}${n.read ? '' : ' •'}</div>
      <div class="itemMeta">${escapeHtml(n.body || '')}</div>
      <div class="itemMeta">${new Date(n.ts || Date.now()).toLocaleString()}</div>
    `;
    it.onclick = async () => {
      try { await client.call('notifications.remove', { id: n.id }, { timeoutMs: 12000 }); } catch {}
      if (n.kind === 'pairing') {
        notifMenu.classList.add('hidden');
        showActivity('settings');
        setSettingsTab('pairing');
      }
      await refreshAll();
      if (n.kind === 'pairing') {
        showActivity('settings');
        setSettingsTab('pairing');
      }
    };
    notifList.appendChild(it);
  }
}

function filterPendingPairRequests(reqs, identityDevices) {
  const knownPks = new Set((identityDevices || []).map(d => d.pk).filter(Boolean));
  const knownDids = new Set((identityDevices || []).map(d => d.did).filter(Boolean));

  return (reqs || []).filter(r => {
    if (r.status && r.status !== 'pending') return false;
    if (r.state && r.state !== 'pending') return false;
    if (r.resolved === true) return false;
    if (r.approved === true || r.rejected === true) return false;
    if (r.devicePk && knownPks.has(r.devicePk)) return false;
    if (r.deviceDid && knownDids.has(r.deviceDid)) return false;
    return true;
  });
}

function renderPairRequests(reqs, identityDevices) {
  const pending = filterPendingPairRequests(reqs, identityDevices);

  clear(pairingList);
  pairingEmpty.classList.toggle('hidden', pending.length !== 0);

  for (const r of pending) {
    const item = document.createElement('div');
    item.className = 'item';

    const top = document.createElement('div');
    top.className = 'itemTop';

    const left = document.createElement('div');
    left.innerHTML = `
      <div class="itemTitle">${escapeHtml(r.identityLabel || '(no identity label)')}</div>
      <div class="itemMeta">Device: ${escapeHtml(r.deviceLabel || '(no label)')} • pk ${escapeHtml((r.devicePk || '').slice(0, 12))}… • code ${escapeHtml(r.code || '')}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'itemActions';

    const btnApprove = document.createElement('button');
    btnApprove.className = 'ok';
    btnApprove.textContent = 'Approve';

    const btnReject = document.createElement('button');
    btnReject.className = 'danger';
    btnReject.textContent = 'Reject';

    btnApprove.onclick = async () => {
      try {
        btnApprove.disabled = true;
        btnApprove.textContent = 'Approving…';
        await client.call('pairing.approve', { requestId: r.id }, { timeoutMs: 20000 });
        await refreshAll();
      } catch (e) {
        console.error(e);
        pairingEmpty.textContent = `Approve failed: ${String(e?.message || e)}`;
        pairingEmpty.classList.remove('hidden');
      } finally {
        btnApprove.disabled = false;
        btnApprove.textContent = 'Approve';
      }
    };

    btnReject.onclick = async () => {
      try {
        btnReject.disabled = true;
        btnReject.textContent = 'Rejecting…';
        await client.call('pairing.reject', { requestId: r.id }, { timeoutMs: 20000 });
        await refreshAll();
      } catch (e) {
        console.error(e);
        pairingEmpty.textContent = `Reject failed: ${String(e?.message || e)}`;
        pairingEmpty.classList.remove('hidden');
      } finally {
        btnReject.disabled = false;
        btnReject.textContent = 'Reject';
      }
    };

    actions.append(btnApprove, btnReject);
    top.append(left, actions);
    item.append(top);
    pairingList.appendChild(item);
  }
}

function renderDeviceList(devs) {
  clear(deviceList);
  if (!devs || devs.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No devices yet.';
    deviceList.appendChild(d);
    return;
  }
  for (const d0 of devs) {
    const d = document.createElement('div');
    d.className = 'item';
    const top = document.createElement('div');
    top.className = 'itemTop';

    const info = document.createElement('div');
    info.innerHTML = `
      <div class="itemTitle">${escapeHtml(d0.label || '(no label)')}</div>
      <div class="itemMeta">${escapeHtml((d0.did || '').slice(0, 42))}${(d0.did||'').length>42?'…':''}</div>
      <div class="itemMeta">pk ${escapeHtml((d0.pk || '').slice(0, 12))}…</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'itemActions';

    if (d0?.pk) {
      const btnRevoke = document.createElement('button');
      btnRevoke.className = 'danger';
      btnRevoke.textContent = 'X';
      btnRevoke.title = 'Revoke device';
      btnRevoke.onclick = async () => {
        try { await client.call('device.revoke', { pk: d0.pk }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
        await refreshAll();
      };
      actions.appendChild(btnRevoke);
    }

    top.append(info, actions);
    d.appendChild(top);
    deviceList.appendChild(d);
  }
}

function renderBlockedList(list) {
  clear(blockedList);
  if (!list || list.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No blocked devices.';
    blockedList.appendChild(d);
    return;
  }
  for (const b of list) {
    const item = document.createElement('div');
    item.className = 'item';
    const top = document.createElement('div');
    top.className = 'itemTop';

    const info = document.createElement('div');
    const ts = b?.ts ? new Date(b.ts).toLocaleString() : '';
    info.innerHTML = `
      <div class="itemTitle">${escapeHtml(b?.reason || 'blocked')}</div>
      <div class="itemMeta">pk ${escapeHtml((b?.pk || '').slice(0, 12))}…</div>
      <div class="itemMeta">${escapeHtml(b?.did || '')}</div>
      <div class="itemMeta">${escapeHtml(ts)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'itemActions';
    if (b?.pk || b?.did) {
      const btnUnblock = document.createElement('button');
      btnUnblock.className = 'danger';
      btnUnblock.textContent = 'X';
      btnUnblock.title = 'Unblock device';
      btnUnblock.onclick = async () => {
        try { await client.call('blocked.remove', { pk: b?.pk || '', did: b?.did || '' }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
        await refreshAll();
      };
      actions.appendChild(btnUnblock);
    }

    top.append(info, actions);
    item.appendChild(top);
    blockedList.appendChild(item);
  }
}

function renderZones(list) {
  clear(zonesList);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No zones yet.';
    zonesList.appendChild(d);
    return;
  }
  for (const z of arr) {
    const item = document.createElement('div');
    item.className = 'card';
    const name = z.name || '(unnamed)';
    const key = z.key || '';
    const zoneMembers = (Array.isArray(lastDirectory) ? lastDirectory : []).filter(e => e.devicePk && e.zone === key);
    item.innerHTML = `
      <div class="cardTitle">${escapeHtml(name)}</div>
      <div class="itemMeta">${escapeHtml(key)}</div>
      <div class="small muted" style="margin-top:.35rem;">Peers: ${zoneMembers.length}</div>
      <div class="list" data-zone-list="${escapeHtml(key)}"></div>
    `;
    const listEl = item.querySelector(`[data-zone-list="${escapeHtml(key)}"]`);
    if (zoneMembers.length === 0) {
      const d = document.createElement('div');
      d.className = 'item';
      d.textContent = 'No devices discovered yet.';
      listEl.appendChild(d);
    } else {
      for (const e of zoneMembers) {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `
          <div class="itemTitle">${escapeHtml(e.devicePk || '')}</div>
          <div class="itemMeta">Last seen ${new Date(e.lastSeen || Date.now()).toLocaleString()}</div>
        `;
        listEl.appendChild(row);
      }
    }
    item.onclick = () => {
      activeZoneKey = key;
      setZoneLink(key);
      renderPeers(lastDirectory);
    };
    zonesList.appendChild(item);
  }
  if (!activeZoneKey && arr[0]?.key) {
    activeZoneKey = arr[0].key;
    setZoneLink(activeZoneKey);
  }
}

function setZoneLink(key) {
  if (!zoneLink) return;
  if (!key) { zoneLink.textContent = ''; return; }
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = `${base}?zone=${encodeURIComponent(key)}`;
  zoneLink.textContent = url;
}

function renderPeers(list) {
  if (!peersList) return;
  clear(peersList);
  const arr = Array.isArray(list) ? list : [];
  const deviceEntries = arr.filter(e => e.devicePk && (!activeZoneKey || e.zone === activeZoneKey));
  if (peersCount) peersCount.textContent = `${deviceEntries.length} devices`;
  if (deviceEntries.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No devices discovered yet.';
    peersList.appendChild(d);
    return;
  }
  for (const e of deviceEntries) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="itemTitle">${escapeHtml(e.devicePk || '')}</div>
      <div class="itemMeta">Last seen ${new Date(e.lastSeen || Date.now()).toLocaleString()}</div>
    `;
    peersList.appendChild(item);
  }
}

// onboarding: security radio choice
let onboardingSecurityChoice = null; // 'webauthn' | 'skip'

function setSecurityChoice(which) {
  onboardingSecurityChoice = which;
  btnSecWebAuthn.classList.toggle('selected', which === 'webauthn');
  btnSecSkip.classList.toggle('selected', which === 'skip');
  btnSecWebAuthn.setAttribute('aria-checked', which === 'webauthn' ? 'true' : 'false');
  btnSecSkip.setAttribute('aria-checked', which === 'skip' ? 'true' : 'false');
}

btnSecWebAuthn?.addEventListener('click', () => setSecurityChoice('webauthn'));
btnSecSkip?.addEventListener('click', () => setSecurityChoice('skip'));

let client;

function ensureOnboardingState(ident) {
  if (!ident?.linked) {
    showActivity('onboarding');
    setOnboardStep(1);
  }
}

async function refreshAll() {
  // SEQUENTIAL (not Promise.all) to avoid SW starvation/timeouts.
  const st = await client.call('device.getState', {}, { timeoutMs: 20000 });
  const ident = await client.call('identity.get', {}, { timeoutMs: 20000 });
  const prof = await client.call('profile.get', {}, { timeoutMs: 20000 });
  const reqs = await client.call('pairing.list', {}, { timeoutMs: 20000 });
  const blocked = await client.call('blocked.list', {}, { timeoutMs: 20000 });
  const directory = await client.call('directory.list', {}, { timeoutMs: 20000 });
  const zones = await client.call('zones.list', {}, { timeoutMs: 20000 });
  const notifs = await client.call('notifications.list', {}, { timeoutMs: 20000 });
  const myLabel = await client.call('device.getLabel', {}, { timeoutMs: 20000 });

  lastDeviceState = st;
  lastIdentity = ident;
  lastDirectory = directory || [];
  lastZones = zones || [];

  // If we only have a key, try to resolve the human name via peers.
  for (const z of (lastZones || [])) {
    const n = String(z?.name || '').trim();
    if (!n || n === 'Joined' || n.startsWith('Zone ')) {
      client.call('zones.meta.request', { key: z.key }, { timeoutMs: 20000 }).catch(() => {});
      client.call('zones.list.request', { key: z.key }, { timeoutMs: 20000 }).catch(() => {});
    }
  }

  setDaemonState('online', 'rpc ok');

  deviceDid.textContent = st.did || '';
  deviceDidSummary.textContent = st.did || '(none)';
  deviceSecuritySummary.textContent = st.didMethod === 'webauthn' ? 'platform-backed' : 'software-only';
  identityLinkedSummary.textContent = ident?.linked ? 'yes' : 'no';

  identityLabelEl.textContent = ident?.label || '';
  identityIdEl.textContent = ident?.id || '';
  identityLinkedEl.textContent = ident?.linked ? 'yes' : 'no';

  profileName.value = ident?.label || '';
  profileAbout.value = prof?.about || '';

  deviceLabel.value = myLabel?.label || '';

  renderDeviceList(ident?.devices || []);
  renderBlockedList(blocked || []);
  renderZones(lastZones);
  renderPeers(lastDirectory);
  renderPairRequests(reqs || [], ident?.devices || []);
  renderNotifications(notifs || []);
  ensureOnboardingState(ident);

  return { st, ident };
}

function setOnboardStep(n) {
  obStepDevice.classList.toggle('hidden', n !== 1);
  obStepIdentity.classList.toggle('hidden', n !== 2);
}

async function waitForPairAcceptance({ identityLabel, myDevicePk, timeoutMs = 90000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ident = await client.call('identity.get', {}, { timeoutMs: 20000 }).catch(() => null);
    if (ident?.linked && ident?.label === identityLabel) {
      const list = Array.isArray(ident.devices) ? ident.devices : [];
      if (!myDevicePk) return true;
      if (list.some(d => d?.pk === myDevicePk)) return true;
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

async function ensureOnboardingFlow() {
  const ident = await client.call('identity.get', {}, { timeoutMs: 20000 }).catch(() => null);
  if (ident?.linked) return true;
  showActivity('onboarding');
  setOnboardStep(1);
  return false;
}

async function applyPendingZone() {
  if (!lastIdentity?.linked) return;
  const pending = await client.call('zones.pending.get', {}, { timeoutMs: 20000 }).catch(() => '');
  const key = normalizeZoneKey(pending);
  if (!key) return;
    try { await client.call('zones.join', { key }, { timeoutMs: 20000 }); } catch {}
  try { await client.call('zones.pending.clear', {}, { timeoutMs: 20000 }); } catch {}
  await refreshAll();
  if (pendingZoneNav) {
    showActivity('settings');
    setSettingsTab('peers');
    pendingZoneNav = false;
    return true;
  }
  return false;
}

function normalizeZoneKey(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (!raw.includes('://')) return raw;
  try {
    const u = new URL(raw);
    return u.searchParams.get('zone') || '';
  } catch {
    return '';
  }
}

async function applyUrlParams() {
  const params = new URLSearchParams(window.location.search || '');
  const zone = normalizeZoneKey(params.get('zone'));
  let didJoin = false;
  if (zone) {
    try {
      if (!lastIdentity?.linked) {
        await client.call('zones.pending.set', { key: zone }, { timeoutMs: 20000 });
        pendingZoneNav = true;
      } else {
        await client.call('zones.join', { key: zone }, { timeoutMs: 20000 });
        didJoin = true;
      }
    } catch {}
  }
  if (didJoin) {
    await refreshAll();
    try { await client.call('zones.pending.clear', {}, { timeoutMs: 20000 }); } catch {}
    showActivity('settings');
    setSettingsTab('peers');
    return true;
  }
  return false;
}

async function postIdentityLinkedFlow() {
  const didUrlNav = await applyUrlParams();
  const didPendingNav = await applyPendingZone();
  if (didUrlNav || didPendingNav || pendingZoneNav) return;
  showActivity('home');
}

async function runWebAuthnSetup() {
  obDeviceStatus.textContent = 'Starting WebAuthn…';
  const want = await client.call('device.wantWebAuthnUpgrade', {}, { timeoutMs: 20000 });
  if (!want?.ok) {
    obDeviceStatus.textContent = 'Already platform-backed.';
    return true;
  }

  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Constitute' },
      user: {
        id: new TextEncoder().encode(want.deviceIdHint || String(Date.now())),
        name: 'device',
        displayName: 'device',
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    }
  });

  const rawId = new Uint8Array(cred.rawId);
  const credIdB64 = b64url(rawId);
  await client.call('device.setWebAuthn', { credIdB64 }, { timeoutMs: 20000 });
  obDeviceStatus.textContent = 'WebAuthn set.';
  return true;
}

function wireUi() {
  // drawer nav
  for (const b of drawer.querySelectorAll('.navbtn')) {
    b.addEventListener('click', () => {
      showActivity(b.dataset.activity);
      closeDrawer();
    });
  }

  // settings tabs
  for (const b of tabButtons) b.addEventListener('click', () => setSettingsTab(b.dataset.tab));

  btnSaveProfile.onclick = async () => {
    try {
      const label = profileName.value.trim();
      if (label) {
        await client.call('identity.setLabel', { identityLabel: label }, { timeoutMs: 20000 });
      }
      await client.call('profile.set', { name: label, about: profileAbout.value }, { timeoutMs: 20000 });
      await refreshAll();
    } catch (e) { console.error(e); }
  };

  btnSaveDeviceLabel.onclick = async () => {
    try {
      await client.call('device.setLabel', { label: deviceLabel.value }, { timeoutMs: 20000 });
      await refreshAll();
    } catch (e) { console.error(e); }
  };

  btnNotifClear.onclick = async () => {
    try { await client.call('notifications.clear', {}, { timeoutMs: 20000 }); } catch {}
    await refreshAll();
  };

  btnCreateZone.onclick = async () => {
    const name = String(zoneNameInput.value || '').trim();
    if (!name) return;
    try { await client.call('zones.add', { name }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
    zoneNameInput.value = '';
    await refreshAll();
  };

  btnCopyZoneLink.onclick = async () => {
    const link = String(zoneLink.textContent || '').trim();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch {}
  };

  btnJoinZone.onclick = async () => {
    const key = normalizeZoneKey(zoneJoinKey.value);
    if (!key) return;
    try { await client.call('zones.join', { key }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
    zoneJoinKey.value = '';
    await refreshAll();
  };

  // onboarding mode tabs
  let mode = 'new';
  obModeTabs.forEach(t => {
    t.onclick = () => {
      obModeTabs.forEach(x => x.classList.remove('tab-active'));
      t.classList.add('tab-active');
      mode = t.dataset.mode === 'existing' ? 'existing' : 'new';
      existingInfo.classList.toggle('hidden', true);
    };
  });

  // onboarding step1: enforce radio selection
  btnObDeviceContinue.onclick = async () => {
    if (!onboardingSecurityChoice) {
      obDeviceStatus.textContent = 'Pick WebAuthn or Skip.';
      return;
    }

    try {
      if (onboardingSecurityChoice === 'webauthn') {
        await runWebAuthnSetup();
      } else {
        await client.call('device.noteWebAuthnSkipped', {}, { timeoutMs: 20000 });
        obDeviceStatus.textContent = 'Using software-only keys.';
      }
      setOnboardStep(2);
    } catch (e) {
      console.error(e);
      obDeviceStatus.textContent = `Failed: ${String(e?.message || e)}`;
    }
  };

  // onboarding step2: require both labels (always)
  btnObIdentityContinue.onclick = async () => {
    const dlabel = obDeviceLabel.value.trim();
    const ilabel = obIdentityLabel.value.trim();

    if (!dlabel) { obDeviceLabel.focus(); return; }
    if (!ilabel) { obIdentityLabel.focus(); return; }

    try {
      // Preflight: if already linked, block "create" but allow "join existing".
      const current = await client.call('identity.get', {}, { timeoutMs: 20000 }).catch(() => null);
      if (current?.linked && mode === 'new') {
        existingInfo.classList.remove('hidden');
        existingInfo.textContent = `Identity already exists on this device (${current.label || 'unknown'}).`;
        return;
      }
      if (current?.linked && mode === 'existing') {
        existingInfo.classList.remove('hidden');
        existingInfo.textContent = `Current identity will be replaced after approval (${current.label || 'unknown'}).`;
      }

        if (mode === 'new') {
          await client.call('identity.create', { identityLabel: ilabel, deviceLabel: dlabel }, { timeoutMs: 20000 });
          await refreshAll();
          await postIdentityLinkedFlow();
          return;
        }

      existingInfo.classList.remove('hidden');
      existingInfo.textContent = 'Requesting pairing…';

      const myDevicePk = lastDeviceState?.pk || null;

      const res = await client.call('identity.requestPair', { identityLabel: ilabel, deviceLabel: dlabel }, { timeoutMs: 20000 });

      existingInfo.textContent = `Waiting for approval… Share code ${res?.code || ''} with the owner.`;
      const ok = await waitForPairAcceptance({ identityLabel: ilabel, myDevicePk, timeoutMs: 90000 });

        if (ok) {
          existingInfo.textContent = '';
          await refreshAll();
          await postIdentityLinkedFlow();
          return;
        }

      existingInfo.textContent = 'Timed out. Approve on the other device and try again.';
    } catch (e) {
      console.error(e);
      existingInfo.classList.remove('hidden');
      existingInfo.textContent = String(e?.message || e);
    }
  };
}

function startSharedRelayPipe(client, relayUrl) {
  const w = new SharedWorker('./relay.worker.js');
  const port = w.port;
  port.start();

  port.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'relay.status') {
      setRelayState(msg.state, msg.reason || '');
      client.call('relay.status', {
        state: msg.state,
        url: msg.url || '',
        code: msg.code ?? null,
        reason: msg.reason ?? ''
      }, { timeoutMs: 20000 }).catch(() => {});
      return;
    }
    if (msg.type === 'relay.rx' && typeof msg.data === 'string') {
      client.call('relay.rx', { data: msg.data, url: msg.url || '' }, { timeoutMs: 20000 }).catch(() => {});
      return;
    }
  };

  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'relay.tx' && typeof m.data === 'string') {
      port.postMessage({ type: 'relay.send', frame: m.data });
    }
  });

  port.postMessage({ type: 'relay.connect', url: relayUrl });
  return port;
}

(async function main() {
  client = new IdentityClient({
    onEvent: (evt) => {
      if (evt?.type === 'log') {
        const msg = String(evt.message || '');
        if (msg.startsWith('[zone_list] payload list: ')) {
          const raw = msg.replace('[zone_list] payload list: ', '');
          try { console.log('[sw][zone_list payload]', JSON.parse(raw)); }
          catch { console.log('[sw][zone_list payload]', raw); }
          return;
        }
        if (msg.startsWith('[zone_list] interpreted name: ')) {
          const raw = msg.replace('[zone_list] interpreted name: ', '');
          console.log('[sw][zone_list name]', raw);
          return;
        }
        console.log('[sw]', msg);
      }
      if (evt?.type === 'notify') refreshAll().catch(() => {});
    }
  });

  startSharedRelayPipe(client, 'wss://relay.snort.social');
  await client.ready().catch((e) => console.error(e));

  wireUi();
  _pushConnLog('init');

  // Default radio selection: webauthn if supported
  setSecurityChoice('webauthn');

  await refreshAll();
  const linked = await ensureOnboardingFlow();
  if (linked) {
    setSettingsTab('profile');
    await postIdentityLinkedFlow();
  } else {
    await applyUrlParams();
  }
})();
