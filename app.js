import { IdentityClient } from './identity/client.js';

const panePathEl = document.getElementById('panePath');

const connWrap = document.getElementById('connWrap');
const connDot = document.getElementById('connDot');
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
const notifDot = document.getElementById('notifDot');
const btnNotifClear = document.getElementById('btnNotifClear');

const viewHome = document.getElementById('viewHome');
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

const pairingList = document.getElementById('pairingList');
const pairingEmpty = document.getElementById('pairingEmpty');

const identityLabelEl = document.getElementById('identityLabel');
const identityIdEl = document.getElementById('identityId');
const identityLinkedEl = document.getElementById('identityLinked');

const obStepDevice = document.getElementById('obStepDevice');
const obStepIdentity = document.getElementById('obStepIdentity');
const deviceDidSummary = document.getElementById('deviceDidSummary');
const deviceSecuritySummary = document.getElementById('deviceSecuritySummary');
const btnObDeviceContinue = document.getElementById('btnObDeviceContinue');
const obDeviceLabel = document.getElementById('obDeviceLabel');
const obIdentityLabel = document.getElementById('obIdentityLabel');
const btnObIdentityContinue = document.getElementById('btnObIdentityContinue');
const existingInfo = document.getElementById('existingInfo');
const obModeTabs = Array.from(obStepIdentity.querySelectorAll('.tab'));

let relayState = 'offline';
let daemonState = 'unknown';

function setRelayState(s) {
  relayState = String(s || 'offline');
  popRelay.textContent = relayState;

  connDot.classList.remove('conn-off', 'conn-open', 'conn-err', 'conn-conn');
  if (relayState === 'open') connDot.classList.add('conn-open');
  else if (relayState === 'connecting') connDot.classList.add('conn-conn');
  else if (relayState === 'error' || relayState === 'closed') connDot.classList.add('conn-err');
  else connDot.classList.add('conn-off');
}

function setDaemonState(s) {
  daemonState = String(s || 'unknown');
  popDaemon.textContent = daemonState;
}

// immediate popover behavior (not browser tooltip)
function showConnPopover() { connPopover.classList.remove('hidden'); }
function hideConnPopover() { connPopover.classList.add('hidden'); }

connWrap.addEventListener('mouseenter', showConnPopover);
connWrap.addEventListener('mouseleave', hideConnPopover);
connWrap.addEventListener('focusin', showConnPopover);
connWrap.addEventListener('focusout', hideConnPopover);

function hideAllViews() {
  viewHome.classList.add('hidden');
  viewSettings.classList.add('hidden');
  viewOnboard.classList.add('hidden');
}

let currentActivity = 'home';
let currentSettingsTab = 'profile';

function capitalize(s) { return (s || '').slice(0,1).toUpperCase() + (s || '').slice(1); }

function panePathForState() {
  if (currentActivity === 'home') return 'Home';
  if (currentActivity === 'onboard') return 'Onboarding';
  if (currentActivity === 'settings') return `Settings / ${capitalize(currentSettingsTab)}`;
  return 'Home';
}
function syncPanePath() { panePathEl.textContent = panePathForState(); }

function showActivity(activity) {
  currentActivity = activity;
  hideAllViews();
  if (activity === 'home') viewHome.classList.remove('hidden');
  if (activity === 'settings') viewSettings.classList.remove('hidden');
  if (activity === 'onboard') viewOnboard.classList.remove('hidden');
  syncPanePath();
}

function setSettingsTab(tab) {
  currentSettingsTab = tab;
  tabButtons.forEach(b => b.classList.toggle('tab-active', b.dataset.tab === tab));
  Object.entries(tabPanes).forEach(([k, el]) => el.classList.toggle('hidden', k !== tab));
  syncPanePath();
}

function openDrawer() { drawer.classList.remove('hidden'); drawerBackdrop.classList.remove('hidden'); }
function closeDrawer() { drawer.classList.add('hidden'); drawerBackdrop.classList.add('hidden'); }

function toggleNotifMenu(show) { notifMenu.classList.toggle('hidden', !show); }

function startSharedRelayPipe(client, relayUrl) {
  const w = new SharedWorker('./relay.worker.js');
  const port = w.port;
  port.start();

  port.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'relay.status') {
      setRelayState(msg.state);
      try {
        await client.call('relay.status', {
          state: msg.state,
          url: msg.url || '',
          code: msg.code ?? null,
          reason: msg.reason ?? ''
        });
      } catch {}
      return;
    }
    if (msg.type === 'relay.rx' && typeof msg.data === 'string') {
      try { await client.call('relay.rx', { data: msg.data, url: msg.url || '' }); } catch {}
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

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderNotifications(notifs) {
  clear(notifList);

  const unread = notifs.filter(n => !n.read);
  const pairingUnread = notifs.filter(n => n.kind === 'pairing' && !n.read);
  notifDot.classList.toggle('hidden', pairingUnread.length === 0);

  if (notifs.length === 0) {
    const d = document.createElement('div');
    d.className = 'ddItem';
    d.innerHTML = `<div class="ddTitle">No notifications</div><div class="ddBody">You’re all caught up.</div>`;
    notifList.appendChild(d);
    btnNotifClear.disabled = true;
    return;
  }

  btnNotifClear.disabled = unread.length === 0;

  for (const n of notifs.slice(0, 50)) {
    const d = document.createElement('div');
    d.className = 'ddItem';
    d.innerHTML = `
      <div class="ddTitle">${escapeHtml(n.title)}</div>
      <div class="ddBody">${escapeHtml(n.body || '')}</div>
    `;
    d.onclick = async () => {
      try { await client.call('notifications.markRead', { id: n.id }); } catch {}
      await refreshAll();

      // If it’s a pairing notification, just take them to Settings (Pairing tab) by clicking it.
      if (n.kind === 'pairing') {
        showActivity('settings');
        setSettingsTab('pairing');
      }
      toggleNotifMenu(false);
    };
    notifList.appendChild(d);
  }
}

/**
 * Filter to pending-only:
 * - drop anything with state/resolved markers
 * - drop anything where the requesting device is already in identity.devices
 */
function filterPendingPairRequests(reqs, identityDevices) {
  const knownPks = new Set((identityDevices || []).map(d => d.pk).filter(Boolean));
  const knownDids = new Set((identityDevices || []).map(d => d.did).filter(Boolean));

  return (reqs || []).filter(r => {
    // common “resolved” shapes
    if (r.status && r.status !== 'pending') return false;
    if (r.state && r.state !== 'pending') return false;
    if (r.resolved === true) return false;
    if (r.approved === true || r.rejected === true) return false;

    // if the device is already present, this is stale
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

    const btnX = document.createElement('button');
    btnX.className = 'danger';
    btnX.textContent = '×';

    btnApprove.onclick = async () => {
      try { await client.call('pairing.approve', { requestId: r.id }); } catch (e) { console.error(e); }
      await refreshAll();
    };

    btnReject.onclick = async () => {
      try { await client.call('pairing.reject', { requestId: r.id }); } catch (e) { console.error(e); }
      await refreshAll();
    };

    btnX.onclick = async () => {
      try { await client.call('pairing.dismiss', { requestId: r.id }); } catch (e) { console.error(e); }
      await refreshAll();
    };

    actions.append(btnApprove, btnReject, btnX);
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
    d.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="itemTitle">${escapeHtml(d0.label || '(no label)')}</div>
          <div class="itemMeta">${escapeHtml((d0.did || '').slice(0, 42))}${(d0.did||'').length>42?'…':''}</div>
          <div class="itemMeta">pk ${escapeHtml((d0.pk || '').slice(0, 12))}…</div>
        </div>
      </div>
    `;
    deviceList.appendChild(d);
  }
}

let client;

async function refreshAll() {
  const [st, ident, prof, reqs, notifs, myLabel] = await Promise.all([
    client.call('device.getState', {}, { timeoutMs: 7000 }),
    client.call('identity.get', {}, { timeoutMs: 7000 }),
    client.call('profile.get', {}, { timeoutMs: 7000 }),
    client.call('pairing.list', {}, { timeoutMs: 7000 }),
    client.call('notifications.list', {}, { timeoutMs: 7000 }),
    client.call('device.getLabel', {}, { timeoutMs: 7000 }),
  ]);

  // if SW calls work, daemon is online
  setDaemonState('online');

  deviceDid.textContent = st.did || '';
  deviceDidSummary.textContent = st.did || '(none)';
  deviceSecuritySummary.textContent = st.didMethod === 'webauthn' ? 'platform-backed' : 'software-only';

  identityLabelEl.textContent = ident?.label || '';
  identityIdEl.textContent = ident?.id || '';
  identityLinkedEl.textContent = ident?.linked ? 'yes' : 'no';

  profileName.value = prof?.name || '';
  profileAbout.value = prof?.about || '';

  deviceLabel.value = myLabel?.label || '';

  renderDeviceList(ident?.devices || []);
  renderPairRequests(reqs || [], ident?.devices || []);
  renderNotifications(notifs || []);

  return { st, ident, prof, reqs, notifs, myLabel };
}

function setOnboardStep(n) {
  obStepDevice.classList.toggle('hidden', n !== 1);
  obStepIdentity.classList.toggle('hidden', n !== 2);
}

async function waitForPairAcceptance({ identityLabel, myDevicePk, timeoutMs = 90000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // refresh identity state
    const ident = await client.call('identity.get', {}, { timeoutMs: 7000 }).catch(() => null);

    // success conditions (supports either model)
    if (ident?.linked === true) return true;
    const devs = ident?.devices || [];
    if (myDevicePk && devs.some(d => d.pk === myDevicePk)) return true;

    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

async function ensureOnboardingFlow() {
  const ident0 = await client.call('identity.get', {}, { timeoutMs: 7000 });
  if (ident0?.linked) { showActivity('home'); return; }

  showActivity('onboard');
  setOnboardStep(1);

  btnObDeviceContinue.onclick = async () => {
    setOnboardStep(2);
  };

  let mode = 'new';
  obModeTabs.forEach(t => {
    t.onclick = () => {
      obModeTabs.forEach(x => x.classList.remove('tab-active'));
      t.classList.add('tab-active');
      mode = t.dataset.mode === 'existing' ? 'existing' : 'new';
      existingInfo.classList.toggle('hidden', mode !== 'existing');
    };
  });

  btnObIdentityContinue.onclick = async () => {
    const dlabel = obDeviceLabel.value.trim();
    const ilabel = obIdentityLabel.value.trim();

    if (!dlabel) { obDeviceLabel.focus(); return; }
    if (mode === 'existing' && !ilabel) { obIdentityLabel.focus(); return; }

    if (mode === 'new') {
      await client.call('identity.create', { identityLabel: ilabel, deviceLabel: dlabel }, { timeoutMs: 9000 });
      showActivity('home');
      await refreshAll();
      return;
    }

    // existing identity: send request, then wait for approval and auto-continue
    existingInfo.classList.remove('hidden');

    // get our device pk so we can detect inclusion
    const st = await client.call('device.getState', {}, { timeoutMs: 7000 });
    const myDevicePk = st?.pk || null;

    await client.call('identity.requestPair', { identityLabel: ilabel, deviceLabel: dlabel }, { timeoutMs: 9000 });

    const ok = await waitForPairAcceptance({ identityLabel: ilabel, myDevicePk, timeoutMs: 90000 });
    if (ok) {
      showActivity('home');
      await refreshAll();
      return;
    }

    // if it times out, just leave them here (no extra chatter)
    // they can retry or open Settings/Pairing on another device.
  };
}

function wireUi() {
  btnMenu.onclick = openDrawer;
  drawerBackdrop.onclick = () => { closeDrawer(); toggleNotifMenu(false); hideConnPopover(); };
  btnDrawerClose.onclick = closeDrawer;

  document.querySelectorAll('.navitem').forEach(btn => {
    btn.onclick = async () => {
      closeDrawer();
      const act = btn.dataset.activity;
      if (act === 'home') showActivity('home');
      if (act === 'settings') showActivity('settings');
      await refreshAll();
    };
  });

  tabButtons.forEach(b => b.onclick = async () => {
    setSettingsTab(b.dataset.tab);
    await refreshAll();
  });

  btnBell.onclick = () => toggleNotifMenu(notifMenu.classList.contains('hidden'));

  btnNotifClear.onclick = async () => {
    // Try native clear first, otherwise mark all read.
    try {
      await client.call('notifications.clear', {});
    } catch {
      const notifs = await client.call('notifications.list', {}).catch(() => []);
      for (const n of (notifs || [])) {
        try { await client.call('notifications.markRead', { id: n.id }); } catch {}
      }
    }
    await refreshAll();
  };

  document.addEventListener('click', (e) => {
    const inside = notifMenu.contains(e.target) || btnBell.contains(e.target);
    if (!inside) toggleNotifMenu(false);
  });

  btnSaveProfile.onclick = async () => {
    await client.call('profile.set', { name: profileName.value.trim(), about: profileAbout.value.trim() }, { timeoutMs: 9000 });
    await refreshAll();
  };

  btnSaveDeviceLabel.onclick = async () => {
    await client.call('device.setLabel', { label: deviceLabel.value.trim() }, { timeoutMs: 9000 });
    await refreshAll();
  };
}

(async () => {
  setRelayState('offline');
  setDaemonState('unknown');

  client = new IdentityClient({
    onEvent: (evt) => {
      if (evt?.type === 'log') console.log('[sw]', evt.message);
      if (evt?.type === 'notify') refreshAll().catch(() => {});
    }
  });

  await client.ready();

  startSharedRelayPipe(client, 'wss://relay.snort.social');

  wireUi();

  showActivity('home');
  setSettingsTab('profile');

  await refreshAll();
  await ensureOnboardingFlow();
})();
