import { IdentityClient } from './identity/client.js';

const panePathEl = document.getElementById('panePath');

const connWrap = document.getElementById('connWrap');
const connDot = document.getElementById('connDot');
const connStateText = document.getElementById('connStateText');
const connLog = document.getElementById('connLog');
const connPopover = document.getElementById('connPopover');
const popRelay = document.getElementById('popRelay');
const popDaemon = document.getElementById('popDaemon');
const popSwarm = document.getElementById('popSwarm');
const popSwarmCache = document.getElementById('popSwarmCache');

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

const SWARM_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // TODO: Add TURN here for NATs that block P2P.
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
];

let relayState = 'offline';
let daemonState = 'unknown';
let swarmState = 'offline';
let connDerived = 'offline';
const connStateLog = []; // newest first

let lastDeviceState = null;
let lastIdentity = null;
let lastDirectory = [];
let lastZones = [];
let activeZoneKey = '';
let pendingZoneNav = false;
let swarm = null;
let clientReady = false;
let swarmBootRequested = false;

class SwarmTransport {
  constructor({ client, onState }) {
    this.client = client;
    this.onState = onState || (() => {});
    this.localPk = '';
    this.peers = new Map(); // pk -> RTCPeerConnection
    this.channels = new Map(); // pk -> RTCDataChannel
    this.connecting = new Set();
    this.backoff = new Map(); // pk -> nextAt
    this.maxPeers = 6;
    this.lastKnown = [];
    this.lastPeerKey = '';
    this.success = new Map(); // pk -> lastOkMs
    this.identityCache = [];
    this.deviceCache = [];
    this.identityCacheTs = 0;
    this.deviceCacheTs = 0;
    this.swarmSeen = new Map(); // pk -> lastSeenMs
    this.cacheTtlMs = 24 * 60 * 60 * 1000;
  }

  setLocalPk(pk) {
    this.localPk = String(pk || '').trim();
  }

  async setPeers(list) {
    if (typeof RTCPeerConnection === 'undefined') {
      this.onState('error');
      return;
    }
    const peers = this._selectPeers(list);
    const key = peers.slice().sort().join(',');
    if (key === this.lastPeerKey) {
      this._updateState();
      return;
    }
    this.lastPeerKey = key;
    console.log('[swarm] peers selected', peers);
    this.lastKnown = peers;
    this._persistLastKnown(peers);
    for (const pk of peers) {
      if (!this.peers.has(pk) && !this.connecting.has(pk) && this._canDial(pk)) {
        this.connecting.add(pk);
        console.log('[swarm] dialing', pk);
        this._connectTo(pk).catch(() => {});
      }
    }
    this._updateState();
  }

  _updateState() {
    const openCount = Array.from(this.channels.values()).filter(c => c && c.readyState === 'open').length;
    if (openCount > 0) this.onState('open');
    else if (this.connecting.size > 0) this.onState('connecting');
    else this.onState('offline');
  }

  async _connectTo(pk) {
    const pc = new RTCPeerConnection({ iceServers: SWARM_ICE_SERVERS });
    this.peers.set(pk, pc);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      console.log('[swarm] ice', pk);
      this._sendSignal(pk, 'ice', e.candidate).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        this._cleanup(pk);
      }
      this._updateState();
    };

    const dc = pc.createDataChannel('swarm');
    this._attachChannel(pk, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('[swarm] offer', pk);
    await this._sendSignal(pk, 'offer', offer);
  }

  async _acceptFrom(pk, offer) {
    let pc = this.peers.get(pk);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: SWARM_ICE_SERVERS });
      this.peers.set(pk, pc);
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        this._sendSignal(pk, 'ice', e.candidate).catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
          this._cleanup(pk);
        }
        this._updateState();
      };
      pc.ondatachannel = (e) => this._attachChannel(pk, e.channel);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('[swarm] answer', pk);
    await this._sendSignal(pk, 'answer', answer);
  }

  async _handleAnswer(pk, answer) {
    const pc = this.peers.get(pk);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async _handleIce(pk, cand) {
    const pc = this.peers.get(pk);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
  }

  _attachChannel(pk, dc) {
    this.channels.set(pk, dc);
    dc.onopen = async () => {
      this.connecting.delete(pk);
      this.backoff.delete(pk);
      this._recordSuccess(pk);
      this._markSeen(pk);
      console.log('[swarm] channel open', pk);
      await this._sendRecords(dc);
      this._updateState();
    };
    dc.onclose = () => {
      this._cleanup(pk);
      this._updateState();
    };
    dc.onmessage = (e) => this._onChannelMessage(pk, e.data);
  }

  async _sendRecords(dc) {
    const irec = await this.client.call('swarm.identity.record', {}, { timeoutMs: 20000 }).catch(() => null);
    const drec = await this.client.call('swarm.device.record', {}, { timeoutMs: 20000 }).catch(() => null);
    dc.send(JSON.stringify({ type: 'swarm_records', identityRecord: irec, deviceRecord: drec }));
  }

  async _onChannelMessage(pk, data) {
    let msg;
    try { msg = JSON.parse(String(data || '')); } catch { return; }
    this._markSeen(pk);
    console.log('[swarm] msg', pk, msg?.type || 'unknown');
    if (msg.type === 'swarm_records') {
      if (msg.identityRecord) await this.client.call('swarm.identity.put', { record: msg.identityRecord }, { timeoutMs: 20000 }).catch(() => {});
      if (msg.deviceRecord) await this.client.call('swarm.device.put', { record: msg.deviceRecord }, { timeoutMs: 20000 }).catch(() => {});
      return;
    }
    if (msg.type === 'swarm_request') {
      await this._sendRecords(this.channels.get(pk));
      return;
    }
  }

  async _sendSignal(toPk, signalType, data) {
    return await this.client.call('swarm.signal.send', { toPk, signalType, data }, { timeoutMs: 20000 });
  }

  async onSignal(evt) {
    const from = String(evt?.from || '').trim();
    if (!from || from === this.localPk) return;
    const t = evt?.signalType;
    console.log('[swarm] signal', t, from);
    if (t === 'offer') return await this._acceptFrom(from, evt.data);
    if (t === 'answer') return await this._handleAnswer(from, evt.data);
    if (t === 'ice') return await this._handleIce(from, evt.data);
  }

  _cleanup(pk) {
    this.connecting.delete(pk);
    this._backoff(pk);
    const ch = this.channels.get(pk);
    if (ch) try { ch.close(); } catch {}
    this.channels.delete(pk);
    const pc = this.peers.get(pk);
    if (pc) try { pc.close(); } catch {}
    this.peers.delete(pk);
  }

  _selectPeers(list) {
    const arr = (Array.isArray(list) ? list : [])
      .map(r => String(r?.devicePk || '').trim())
      .filter(Boolean)
      .filter(pk => pk !== this.localPk);
    if (arr.length <= this.maxPeers) return arr;
    const scored = arr.map(pk => ({
      pk,
      score: this.success.get(pk) || 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(this.maxPeers, Math.max(2, Math.floor(this.maxPeers / 2)))).map(x => x.pk);
    const rest = scored.slice(top.length).map(x => x.pk);
    const shuffled = rest.sort(() => Math.random() - 0.5);
    const pick = top.concat(shuffled.slice(0, this.maxPeers - top.length));
    return pick;
  }

  _backoff(pk) {
    const now = Date.now();
    const next = now + 30_000 + Math.floor(Math.random() * 20_000);
    this.backoff.set(pk, next);
  }

  _canDial(pk) {
    const nextAt = this.backoff.get(pk) || 0;
    return Date.now() >= nextAt;
  }

  _persistLastKnown(peers) {
    try { localStorage.setItem('swarm.lastPeers', JSON.stringify(peers)); } catch {}
  }

  _recordSuccess(pk) {
    this.success.set(pk, Date.now());
    this._persistSuccess();
  }

  _persistSuccess() {
    try {
      const arr = Array.from(this.success.entries());
      localStorage.setItem('swarm.peerSuccess', JSON.stringify(arr));
    } catch {}
  }

  loadSuccess() {
    try {
      const raw = localStorage.getItem('swarm.peerSuccess');
      const arr = JSON.parse(raw || '[]');
      if (Array.isArray(arr)) {
        this.success = new Map(arr.filter(x => Array.isArray(x) && x.length === 2));
      }
    } catch {}
  }

  cacheIdentityRecords(list) {
    const arr = Array.isArray(list) ? list : [];
    this.identityCache = arr;
    this.identityCacheTs = Date.now();
    try {
      localStorage.setItem('swarm.identityCache', JSON.stringify({ ts: this.identityCacheTs, records: arr }));
    } catch {}
  }

  loadIdentityCache() {
    try {
      const raw = localStorage.getItem('swarm.identityCache');
      const obj = JSON.parse(raw || '{}');
      const arr = Array.isArray(obj?.records) ? obj.records : [];
      const ts = Number(obj?.ts || 0);
      if (ts && Date.now() - ts < this.cacheTtlMs) {
        this.identityCache = arr;
        this.identityCacheTs = ts;
      }
    } catch {}
    return this.identityCache;
  }

  cacheDeviceRecords(list) {
    const arr = Array.isArray(list) ? list : [];
    this.deviceCache = arr;
    this.deviceCacheTs = Date.now();
    try {
      localStorage.setItem('swarm.deviceCache', JSON.stringify({ ts: this.deviceCacheTs, records: arr }));
    } catch {}
  }

  loadDeviceCache() {
    try {
      const raw = localStorage.getItem('swarm.deviceCache');
      const obj = JSON.parse(raw || '{}');
      const arr = Array.isArray(obj?.records) ? obj.records : [];
      const ts = Number(obj?.ts || 0);
      if (ts && Date.now() - ts < this.cacheTtlMs) {
        this.deviceCache = arr;
        this.deviceCacheTs = ts;
      }
    } catch {}
    return this.deviceCache;
  }

  loadLastKnown() {
    try {
      const raw = localStorage.getItem('swarm.lastPeers');
      const arr = JSON.parse(raw || '[]');
      if (Array.isArray(arr)) this.lastKnown = arr;
    } catch {}
    return this.lastKnown;
  }

  getFallbackPeers() {
    const preferred = this.lastKnown && this.lastKnown.length > 0
      ? this.lastKnown
      : (this.deviceCache || []).map(d => String(d?.devicePk || '').trim()).filter(Boolean);
    return preferred;
  }

  _markSeen(pk) {
    const k = String(pk || '').trim();
    if (!k) return;
    this.swarmSeen.set(k, Date.now());
  }

  getSwarmSeen(pk) {
    return this.swarmSeen.get(pk) || 0;
  }

  getCacheAges() {
    return {
      identity: this.identityCacheTs ? Date.now() - this.identityCacheTs : 0,
      device: this.deviceCacheTs ? Date.now() - this.deviceCacheTs : 0,
    };
  }
}

function _deriveConnState() {
  const r = relayState;
  const d = daemonState;
  const s = swarmState;

  if (d !== 'online') {
    if (r === 'connecting') return 'connecting';
    return 'disconnected';
  }

  if (r === 'open' && s === 'open') return 'connected';
  if (r === 'open' && (s === 'offline' || s === 'error' || s === 'disabled')) return 'degraded';
  if (s === 'open' && (r === 'offline' || r === 'error' || r === 'closed')) return 'swarm-only';
  if (r === 'connecting' || s === 'connecting') return 'connecting';
  if (r === 'error' || r === 'closed') return 'error';
  return 'disconnected';
}

function _deriveConnLabel() {
  const r = relayState;
  const d = daemonState;
  const s = swarmState;

  if (d !== 'online') {
    if (r === 'connecting') return 'Connecting to nostr...';
    return 'Disconnected';
  }

  if (r === 'connecting') return 'Connecting to nostr...';
  if (r === 'open' && s === 'connecting') return 'Connecting to swarm...';
  if (r === 'open' && s === 'open') return 'Fully connected';
  if (r === 'open' && (s === 'offline' || s === 'error' || s === 'disabled')) return 'Partially connected';
  if (s === 'open' && (r === 'offline' || r === 'error' || r === 'closed')) return 'Swarm only';
  if (r === 'error' || r === 'closed') return 'Disconnected';
  return 'Disconnected';
}

function _pushConnLog(reason = '') {
  const state = _deriveConnState();
  const label = _deriveConnLabel();
  connStateText.textContent = label;
  if (state === connDerived && connStateLog.length > 0) return;

  connDerived = state;

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

  _setConnDot();
  _pushConnLog(reason);
}

function formatAge(ms) {
  if (!ms || ms < 0) return 'n/a';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function setDaemonState(s, reason = '') {
  daemonState = String(s || 'unknown');
  popDaemon.textContent = daemonState;
  _pushConnLog(reason);
}

function setSwarmState(s, reason = '') {
  swarmState = String(s || 'offline');
  if (popSwarm) popSwarm.textContent = swarmState;
  if (popSwarmCache && swarm) {
    const ages = swarm.getCacheAges();
    const oldest = Math.max(ages.identity || 0, ages.device || 0);
    popSwarmCache.textContent = oldest ? `${formatAge(oldest)} old` : 'n/a';
  }
  _setConnDot();
  _pushConnLog(reason);
}

function _setConnDot() {
  connDot.classList.remove('conn-off', 'conn-open', 'conn-err', 'conn-conn');
  if (relayState === 'open' || swarmState === 'open') connDot.classList.add('conn-open');
  else if (relayState === 'connecting' || swarmState === 'connecting') connDot.classList.add('conn-conn');
  else if (relayState === 'error' || relayState === 'closed') connDot.classList.add('conn-err');
  else connDot.classList.add('conn-off');
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
        const nostrSeen = Number(e.lastSeen || 0);
        const swarmSeen = swarm ? swarm.getSwarmSeen(e.devicePk) : 0;
        const sources = [
          nostrSeen ? 'nostr' : '',
          swarmSeen ? 'swarm' : '',
        ].filter(Boolean).join(' + ') || 'unknown';
        row.innerHTML = `
          <div class="itemTitle">${escapeHtml(e.devicePk || '')}</div>
          <div class="itemMeta">Source: ${escapeHtml(sources)}</div>
          <div class="itemMeta">Nostr seen ${nostrSeen ? new Date(nostrSeen).toLocaleString() : 'n/a'}</div>
          <div class="itemMeta">Swarm seen ${swarmSeen ? new Date(swarmSeen).toLocaleString() : 'n/a'}</div>
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
    const nostrSeen = Number(e.lastSeen || 0);
    const swarmSeen = swarm ? swarm.getSwarmSeen(e.devicePk) : 0;
    const sources = [
      nostrSeen ? 'nostr' : '',
      swarmSeen ? 'swarm' : '',
    ].filter(Boolean).join(' + ') || 'unknown';
    item.innerHTML = `
      <div class="itemTitle">${escapeHtml(e.devicePk || '')}</div>
      <div class="itemMeta">Source: ${escapeHtml(sources)}</div>
      <div class="itemMeta">Nostr seen ${nostrSeen ? new Date(nostrSeen).toLocaleString() : 'n/a'}</div>
      <div class="itemMeta">Swarm seen ${swarmSeen ? new Date(swarmSeen).toLocaleString() : 'n/a'}</div>
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
  const swarmDevices = await client.call('swarm.device.list', {}, { timeoutMs: 20000 }).catch(() => []);
  const swarmIdentities = await client.call('swarm.identity.list', {}, { timeoutMs: 20000 }).catch(() => []);
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
  if (swarm && ident?.linked) {
    swarm.setLocalPk(st.pk || '');
    swarm.setPeers(swarmDevices || []);
    swarm.cacheIdentityRecords(swarmIdentities || []);
    swarm.cacheDeviceRecords(swarmDevices || []);
    if (!swarmBootRequested) {
      swarmBootRequested = true;
      client.call('swarm.discovery.request', {}, { timeoutMs: 20000 }).catch(() => {});
    }
  } else {
    setSwarmState('disabled');
  }

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
      if (clientReady) {
        client.call('relay.status', {
          state: msg.state,
          url: msg.url || '',
          code: msg.code ?? null,
          reason: msg.reason ?? ''
        }, { timeoutMs: 20000 }).catch((e) => console.error('relay.status rpc failed', e));
      }
      return;
    }
    if (msg.type === 'relay.rx' && typeof msg.data === 'string') {
      if (clientReady) {
        client.call('relay.rx', { data: msg.data, url: msg.url || '' }, { timeoutMs: 20000 })
          .catch((e) => console.error('relay.rx rpc failed', e));
      }
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
  // Default to onboarding until SW state is confirmed.
  showActivity('onboarding');
  setOnboardStep(1);

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
      if (evt?.type === 'swarm_signal') {
        if (swarm) swarm.onSignal(evt).catch(() => {});
      }
      if (evt?.type === 'notify') refreshAll().catch(() => {});
    }
  });

  await client.ready().catch((e) => console.error(e));
  clientReady = client.isServiceWorkerAvailable();
  if (clientReady) {
    startSharedRelayPipe(client, 'wss://relay.snort.social');
  } else {
    setDaemonState('offline', 'sw unavailable');
  }

  swarm = new SwarmTransport({ client, onState: (s) => setSwarmState(s) });
  swarm.loadSuccess();
  swarm.loadIdentityCache();
  swarm.loadDeviceCache();
  swarm.loadLastKnown();
  const fallbackPeers = swarm.getFallbackPeers();
  if (fallbackPeers && fallbackPeers.length > 0) {
    swarm.setPeers(fallbackPeers.map(pk => ({ devicePk: pk })));
  }

  wireUi();
  _pushConnLog('init');

  // Default radio selection: webauthn if supported
  setSecurityChoice('webauthn');

  try {
    await refreshAll();
    const linked = await ensureOnboardingFlow();
    if (linked) {
      setSettingsTab('profile');
      await postIdentityLinkedFlow();
    } else {
      await applyUrlParams();
    }
  } catch (e) {
    console.error('refreshAll failed', e);
    setDaemonState('offline', 'rpc failed');
    showActivity('onboarding');
    setOnboardStep(1);
  }

  // Health check: if SW drops, fall back to onboarding.
  setInterval(async () => {
    try {
      await client.call('device.getState', {}, { timeoutMs: 5000 });
      setDaemonState('online', 'rpc ok');
    } catch {
      setDaemonState('offline', 'rpc fail');
      showActivity('onboarding');
      setOnboardStep(1);
    }
  }, 10000);
})();
