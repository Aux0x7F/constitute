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
const viewMessages = document.getElementById('viewMessages');
const viewDirectory = document.getElementById('viewDirectory');
const viewSettings = document.getElementById('viewSettings');
const viewOnboard = document.getElementById('viewOnboard');

const tabButtons = Array.from(viewSettings.querySelectorAll('.tab'));
const tabPanes = {
  profile: document.getElementById('tab_profile'),
  devices: document.getElementById('tab_devices'),
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

const btnNewPairCode = document.getElementById('btnNewPairCode');
const pairCodeEl = document.getElementById('pairCode');

const joinIdentityLabelEl = document.getElementById('joinIdentityLabel');
const joinDeviceLabelEl = document.getElementById('joinDeviceLabel');
const btnJoin = document.getElementById('btnJoin');
const joinStatus = document.getElementById('joinStatus');

const deviceDidSummary = document.getElementById('deviceDidSummary');
const deviceSecuritySummary = document.getElementById('deviceSecuritySummary');
const identityLinkedSummary = document.getElementById('identityLinkedSummary');

// Messages UI
const btnNewConversation = document.getElementById('btnNewConversation');
const msgSearch = document.getElementById('msgSearch');
const messagesList = document.getElementById('messagesList');
const newConversationPanel = document.getElementById('newConversationPanel');
const directoryPickerList = document.getElementById('directoryPickerList');
const chatLink = document.getElementById('chatLink');
const btnCopyChatLink = document.getElementById('btnCopyChatLink');

const chatPanel = document.getElementById('chatPanel');
const chatTitle = document.getElementById('chatTitle');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');

// Directory app UI
const neighborhoodNameInput = document.getElementById('neighborhoodName');
const btnCreateNeighborhood = document.getElementById('btnCreateNeighborhood');
const neighborhoodsList = document.getElementById('neighborhoodsList');
const neighborhoodLink = document.getElementById('neighborhoodLink');
const btnCopyNeighborhoodLink = document.getElementById('btnCopyNeighborhoodLink');
const neighborhoodMembersList = document.getElementById('neighborhoodMembersList');

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
let activeChat = null; // { peerId, queueId, peerLabel }
const lastChatByPeer = new Map();
let lastNeighborhoods = [];
let activeNeighborhoodKey = '';

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
  viewMessages.classList.toggle('hidden', name !== 'messages');
  viewDirectory.classList.toggle('hidden', name !== 'directory');
  viewSettings.classList.toggle('hidden', name !== 'settings');
  viewOnboard.classList.toggle('hidden', name !== 'onboarding');
  panePathEl.textContent = name === 'home' ? '' : name;
}

function setSettingsTab(name) {
  for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === name);
  for (const [k, el] of Object.entries(tabPanes)) el.classList.toggle('hidden', k !== name);
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

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
      try { await client.call('pairing.approve', { requestId: r.id }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
      await refreshAll();
    };

    btnReject.onclick = async () => {
      try { await client.call('pairing.reject', { requestId: r.id }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
      await refreshAll();
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

function renderDirectory(list, targetEl, { onSelect } = {}) {
  // TODO: Directory not populating until a message is sent; investigate presence publish/subscribe
  // timing and ensure directory updates render immediately on receipt.
  clear(targetEl);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No identities discovered yet.';
    targetEl.appendChild(d);
    return;
  }
  for (const e of arr) {
    const item = document.createElement('div');
    item.className = 'item';
    const label = e.identityLabel || '(unknown)';
    const id = e.identityId || '';
    item.innerHTML = `
      <div class="itemTitle">${escapeHtml(label)}</div>
      <div class="itemMeta">${escapeHtml(id)}</div>
      <div class="itemMeta">Last seen ${new Date(e.lastSeen || Date.now()).toLocaleString()}</div>
    `;
    item.onclick = () => onSelect && onSelect(id, label);
    targetEl.appendChild(item);
  }
}

async function openChat(peerId, peerLabel = '') {
  // TODO: Receiving devices not seeing new messages; ensure chat.open + renderChat refresh
  // reacts to inbound chat_message events without requiring manual refresh.
  if (!peerId) return;
  const res = await client.call('chat.open', { peerIdentityId: peerId }, { timeoutMs: 20000 });
  activeChat = { peerId, queueId: res?.queueId || '', peerLabel: peerLabel || peerId };
  chatPanel.classList.remove('hidden');
  chatTitle.textContent = `Chat: ${activeChat.peerLabel}`;
  renderChat(res?.messages || []);
}

function renderChat(messages) {
  // TODO: UX clarity: show conversation header + participants + last seen; refine empty states.
  clear(chatMessages);
  const arr = Array.isArray(messages) ? messages : [];
  if (arr.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No messages yet.';
    chatMessages.appendChild(d);
    return;
  }
  const last = arr[arr.length - 1];
  if (activeChat?.peerId && last) {
    lastChatByPeer.set(activeChat.peerId, last);
  }
  for (const m of arr) {
    const div = document.createElement('div');
    const isMe = m.fromIdentityId && lastIdentity?.id && m.fromIdentityId === lastIdentity.id;
    div.className = `chatMsg${isMe ? ' me' : ''}`;
    div.innerHTML = `
      <div>${escapeHtml(m.body || '')}</div>
      <div class="chatMeta">${escapeHtml(m.fromLabel || m.fromIdentityId || '')} • ${new Date(m.ts || Date.now()).toLocaleString()}</div>
    `;
    chatMessages.appendChild(div);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderMessagesList(list) {
  // TODO: Messages UI is confusing; consider splitting "Directory" and "Conversations" views
  // and only showing identities with existing chats in the conversations list.
  clear(messagesList);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No identities discovered yet.';
    messagesList.appendChild(d);
    return;
  }
  for (const e of arr) {
    const item = document.createElement('div');
    item.className = 'item';
    const label = e.identityLabel || '(unknown)';
    const id = e.identityId || '';
    const last = lastChatByPeer.get(id);
    item.innerHTML = `
      <div class="msgRow">
        <div>
          <div class="itemTitle">${escapeHtml(label)}</div>
          <div class="itemMeta">${escapeHtml(id)}</div>
          <div class="msgMeta">${escapeHtml(last?.body || '')}</div>
        </div>
        <div class="itemActions">
          <button type="button" title="Message">✉</button>
        </div>
      </div>
    `;
    const btn = item.querySelector('button');
    btn.onclick = (ev) => {
      ev.stopPropagation();
      showActivity('messages');
      openChat(id, label);
    };
    item.onclick = () => {
      showActivity('messages');
      openChat(id, label);
    };
    messagesList.appendChild(item);
  }
}

function renderNeighborhoods(list) {
  clear(neighborhoodsList);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No neighborhoods yet.';
    neighborhoodsList.appendChild(d);
    return;
  }
  for (const n of arr) {
    const item = document.createElement('div');
    item.className = 'item';
    const name = n.name || '(unnamed)';
    const key = n.key || '';
    item.innerHTML = `
      <div class="itemTitle">${escapeHtml(name)}</div>
      <div class="itemMeta">${escapeHtml(key)}</div>
    `;
    item.onclick = () => {
      activeNeighborhoodKey = key;
      renderNeighborhoodMembers();
      setNeighborhoodLink(key);
    };
    neighborhoodsList.appendChild(item);
  }
  if (!activeNeighborhoodKey && arr[0]?.key) {
    activeNeighborhoodKey = arr[0].key;
    renderNeighborhoodMembers();
    setNeighborhoodLink(activeNeighborhoodKey);
  }
}

function setNeighborhoodLink(key) {
  if (!key) { neighborhoodLink.textContent = ''; return; }
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = `${base}?nb=${encodeURIComponent(key)}`;
  neighborhoodLink.textContent = url;
}

function renderNeighborhoodMembers() {
  clear(neighborhoodMembersList);
  const arr = Array.isArray(lastDirectory) ? lastDirectory : [];
  const members = arr.filter(e => !activeNeighborhoodKey || e.neighborhood === activeNeighborhoodKey);
  if (members.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No members discovered yet.';
    neighborhoodMembersList.appendChild(d);
    return;
  }
  for (const e of members) {
    const item = document.createElement('div');
    item.className = 'item';
    const label = e.identityLabel || '(unknown)';
    const id = e.identityId || '';
    item.innerHTML = `
      <div class="msgRow">
        <div>
          <div class="itemTitle">${escapeHtml(label)}</div>
          <div class="itemMeta">${escapeHtml(id)}</div>
        </div>
        <div class="itemActions">
          <button type="button" title="Message">✉</button>
        </div>
      </div>
    `;
    const btn = item.querySelector('button');
    btn.onclick = (ev) => {
      ev.stopPropagation();
      showActivity('messages');
      openChat(id, label);
    };
    neighborhoodMembersList.appendChild(item);
  }
}

function primaryNeighborhoodKey() {
  if (Array.isArray(lastNeighborhoods) && lastNeighborhoods.length > 0) {
    return String(lastNeighborhoods[0]?.key || '');
  }
  return '';
}

function buildChatLink(identityId) {
  const id = String(identityId || '').trim();
  if (!id) return '';
  const base = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams();
  params.set('chat', id);
  const nb = primaryNeighborhoodKey();
  if (nb) params.set('nb', nb);
  return `${base}?${params.toString()}`;
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

async function refreshAll() {
  // SEQUENTIAL (not Promise.all) to avoid SW starvation/timeouts.
  const st = await client.call('device.getState', {}, { timeoutMs: 20000 });
  const ident = await client.call('identity.get', {}, { timeoutMs: 20000 });
  const prof = await client.call('profile.get', {}, { timeoutMs: 20000 });
  const reqs = await client.call('pairing.list', {}, { timeoutMs: 20000 });
  const blocked = await client.call('blocked.list', {}, { timeoutMs: 20000 });
  const directory = await client.call('directory.list', {}, { timeoutMs: 20000 });
  const neighborhoods = await client.call('neighborhoods.list', {}, { timeoutMs: 20000 });
  const notifs = await client.call('notifications.list', {}, { timeoutMs: 20000 });
  const myLabel = await client.call('device.getLabel', {}, { timeoutMs: 20000 });

  lastDeviceState = st;
  lastIdentity = ident;
  lastDirectory = directory || [];
  lastNeighborhoods = neighborhoods || [];

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
  renderMessagesList(lastDirectory);
  renderDirectory(lastDirectory, directoryPickerList, { onSelect: (id, label) => {
    newConversationPanel.classList.add('hidden');
    openChat(id, label);
  }});
  renderNeighborhoods(lastNeighborhoods);
  renderNeighborhoodMembers();
  if (chatLink) chatLink.textContent = buildChatLink(ident?.id || '');
  renderPairRequests(reqs || [], ident?.devices || []);
  renderNotifications(notifs || []);

  if (activeChat?.peerId) {
    const res = await client.call('chat.open', { peerIdentityId: activeChat.peerId }, { timeoutMs: 20000 }).catch(() => null);
    if (res?.queueId) {
      activeChat.queueId = res.queueId;
      renderChat(res?.messages || []);
    }
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
  if (ident?.linked) {
    showActivity('home');
    return;
  }
  showActivity('onboarding');
  setOnboardStep(1);
}

async function applyUrlParams() {
  const params = new URLSearchParams(window.location.search || '');
  const nb = params.get('nb');
  let didJoin = false;
  if (nb) {
    try {
      await client.call('neighborhoods.join', { key: nb, name: 'Joined' }, { timeoutMs: 20000 });
      didJoin = true;
    } catch {}
  }
  if (didJoin) await refreshAll();
  const chat = params.get('chat');
  if (chat && lastIdentity?.linked) {
    showActivity('messages');
    await openChat(chat, chat);
  }
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

  btnNewPairCode.onclick = async () => {
    try {
      const res = await client.call('identity.newPairCode', {}, { timeoutMs: 20000 });
      pairCodeEl.textContent = res?.code || '';
    } catch (e) { console.error(e); }
  };

  btnJoin.onclick = async () => {
    joinStatus.textContent = 'Requesting…';
    const identityLabel = joinIdentityLabelEl.value.trim();
    const dlabel = joinDeviceLabelEl.value.trim();
    if (!identityLabel) { joinIdentityLabelEl.focus(); joinStatus.textContent = ''; return; }
    if (!dlabel) { joinDeviceLabelEl.focus(); joinStatus.textContent = ''; return; }

    try {
      const myDevicePk = lastDeviceState?.pk || null;

      const res = await client.call('identity.requestPair', { identityLabel, deviceLabel: dlabel }, { timeoutMs: 20000 });
      joinStatus.textContent = res?.ok
        ? `Requested. Share code ${res?.code || ''} with the owner and wait for approval…`
        : 'Failed.';
      if (res?.ok) {
        const ok = await waitForPairAcceptance({ identityLabel, myDevicePk, timeoutMs: 90000 });
        joinStatus.textContent = ok ? '' : 'Timed out. Try again.';
        if (ok) {
          showActivity('home');
          await refreshAll();
        }
      }
    } catch (e) {
      console.error(e);
      joinStatus.textContent = String(e?.message || e);
    }
  };

  btnNotifClear.onclick = async () => {
    try { await client.call('notifications.clear', {}, { timeoutMs: 20000 }); } catch {}
    await refreshAll();
  };

  btnNewConversation.onclick = () => {
    newConversationPanel.classList.toggle('hidden');
  };

  btnCopyChatLink.onclick = async () => {
    const link = buildChatLink(lastIdentity?.id || '');
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch {}
  };

  btnCreateNeighborhood.onclick = async () => {
    const name = String(neighborhoodNameInput.value || '').trim();
    if (!name) return;
    try { await client.call('neighborhoods.add', { name }, { timeoutMs: 20000 }); } catch (e) { console.error(e); }
    neighborhoodNameInput.value = '';
    await refreshAll();
  };

  btnCopyNeighborhoodLink.onclick = async () => {
    const link = String(neighborhoodLink.textContent || '').trim();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch {}
  };

  msgSearch.addEventListener('input', () => {
    const q = msgSearch.value.trim().toLowerCase();
    const filtered = (lastDirectory || []).filter(e => {
      const a = String(e.identityLabel || '').toLowerCase();
      const b = String(e.identityId || '').toLowerCase();
      return !q || a.includes(q) || b.includes(q);
    });
    renderDirectory(filtered, directoryPickerList, { onSelect: (id, label) => {
      newConversationPanel.classList.add('hidden');
      openChat(id, label);
    }});
  });

  chatSend.onclick = async () => {
    if (!activeChat?.peerId) return;
    const body = String(chatInput.value || '').trim();
    if (!body) return;
    try {
      await client.call('chat.send', { peerIdentityId: activeChat.peerId, body }, { timeoutMs: 20000 });
      chatInput.value = '';
      await refreshAll();
    } catch (e) { console.error(e); }
  };
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatSend.click();
    }
  });

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
        showActivity('home');
        await refreshAll();
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
        showActivity('home');
        await refreshAll();
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
      if (evt?.type === 'log') console.log('[sw]', evt.message);
      if (evt?.type === 'notify') refreshAll().catch(() => {});
    }
  });

  startSharedRelayPipe(client, 'wss://relay.snort.social');
  await client.ready().catch((e) => console.error(e));

  wireUi();
  _pushConnLog('init');

  showActivity('home');
  setSettingsTab('profile');

  // Default radio selection: webauthn if supported
  setSecurityChoice('webauthn');

  await refreshAll();
  await ensureOnboardingFlow();
  await applyUrlParams();
})();
