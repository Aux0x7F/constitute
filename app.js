import "constitute-ui/styles.css";
import {
  renderActionList,
  renderFirstPartyShell,
  setConnectionStateText,
} from "constitute-ui";
import { IdentityClient } from './identity/client.js';
import {
  SHELL_BOOT_FALLBACK_TIMEOUT_MS,
  SHELL_BOOT_RUNTIME_ATTACH_TIMEOUT_MS,
  describeShellResourceNameState,
  shellBootCanDismiss,
} from './app/loading.js';
import { createManagedApplianceModel } from './app/managed-appliances.js';
import { normalizePairCodeInput } from './app/pairing-ui.js';
import {
  buildRuntimeSnapshotView,
  renderRuntimeSnapshotView,
} from './app/runtime-ui.js';
import {
  PLATFORM_RUNTIME_BUILD_ID,
  RUNTIME_RUNNER_BRIDGE_POSTURE_PUT,
  RUNTIME_RUNNER_HOST_FULFILLMENT_PUT,
  RUNTIME_RUNNER_OPERATION_SUBMIT,
  runtimeSharedWorkerName,
  runtimeWorkerScriptUrl as accountRuntimeWorkerScriptUrl,
} from './runtime-contract.js';
import { RUNTIME_DIAGNOSTIC_OPERATOR_PLANES, attachRuntimeDiagnostics } from './runtime-diagnostics.js';
import {
  RELAY_RX_FORWARD_MAX_IN_FLIGHT,
  RELAY_RX_FORWARD_QUEUE_LIMIT,
  RELAY_RX_FORWARD_TIMEOUT_MS,
  relayRxIngressClassification,
  relayRxLanePriority,
} from './runtime-relay-admission.js';
import {
  browserStorageShellContext,
  deriveRuntimeShellState,
} from './runtime-shell-state.js';
import {
  accountRuntimeClientModule,
  accountRuntimeRunnerBridgeModule,
  accountSurfaceAttachContext,
} from './surface-app-contract.js';

const ACCOUNT_MAIN_HTML = `
  <section id="viewHome" class="activity hidden">
    <h1>Account</h1>
    <div class="card">
      <div class="cardTitle">Account</div>
      <div class="kv">
        <div class="k">Device</div>
        <div class="v" id="deviceDidSummary"></div>
      </div>
      <div class="kv">
        <div class="k">Protection</div>
        <div class="v" id="deviceSecuritySummary"></div>
      </div>
      <div class="kv">
        <div class="k">Signed in</div>
        <div class="v" id="identityLinkedSummary"></div>
      </div>
    </div>
  </section>

  <section id="viewSettings" class="activity hidden">
    <div class="tabs">
      <button class="tab" data-tab="devices">Devices</button>
      <button class="tab" data-tab="network">Zones</button>
    </div>

    <div id="tab_devices" class="tabpane hidden">
      <section id="pendingRequestsSection" class="hidden">
        <h2>Pending Requests</h2>
        <div id="pairingList" class="list"></div>
        <div id="pairingEmpty" class="small muted">No pending pairing requests.</div>
      </section>

      <section>
        <h2>Add Device</h2>
        <div class="card">
          <div class="cardTitle">Add Device</div>
          <div class="small muted">Enter the pairing code from a device you want to claim and link to this identity.</div>
          <div class="row u-mt-sm">
            <input id="pairCodeInput" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter code from new device" />
            <button id="btnClaimPairCode" class="pairClaimButton" type="button" aria-label="Claim">
              <span class="pairClaimButtonLabel">Claim</span>
              <span class="inlineSpinner pairClaimButtonSpinner hidden" aria-hidden="true"></span>
            </button>
          </div>
          <div id="pairCodeStatus" class="small muted u-mt-sm"></div>
        </div>
      </section>

      <section>
        <h2>This Device</h2>
        <div class="kv">
          <div class="k">This device DID</div>
          <div class="v" id="deviceDid"></div>
        </div>

        <label for="deviceLabel">This device label</label>
        <input id="deviceLabel" type="text" placeholder="device label" />

        <div class="row">
          <button id="btnSaveDeviceLabel" type="button">Save Device Label</button>
        </div>

        <h3>Linked Devices</h3>
        <div id="deviceList" class="list"></div>

        <h3>Blocked Devices</h3>
        <div id="blockedList" class="list"></div>
      </section>
    </div>

    <div id="tab_network" class="tabpane hidden">
      <h2>Zones</h2>

      <div class="card">
        <div class="cardTitle">Status</div>
        <div class="kv">
          <div class="k">Connection</div>
          <div class="v" id="networkStatusConnection">offline</div>
        </div>
        <div class="kv">
          <div class="k">Relay</div>
          <div class="v" id="networkStatusRelay">offline</div>
        </div>
        <div class="kv">
          <div class="k">Gateway</div>
          <div class="v" id="networkStatusGatewayMesh">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Services</div>
          <div class="v" id="networkStatusServices">unknown</div>
        </div>
        <div class="small muted" id="networkStatusDetail">Updates automatically.</div>
      </div>

      <div class="card">
        <div class="cardTitle">Runtime</div>
        <div class="kv">
          <div class="k">Catalog</div>
          <div class="v" id="runtimeServiceCatalogStatus">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Edge</div>
          <div class="v" id="runtimeEdgeStatus">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Queue</div>
          <div class="v" id="runtimeQueueStatus">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Projection</div>
          <div class="v" id="runtimeProjectionStatus">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Resource</div>
          <div class="v" id="runtimeResourceStatus">unknown</div>
        </div>
        <div class="kv">
          <div class="k">Retention</div>
          <div class="v" id="runtimeRetentionStatus">unknown</div>
        </div>
        <div class="small muted" id="runtimeStatusDetail">Runtime snapshot updates automatically.</div>
        <div id="runtimeServiceCatalogList" class="list u-mt-sm"></div>
      </div>

      <div class="card">
        <div class="cardTitle">Zones</div>
        <div class="small muted">Type a new zone name to create one, or paste a zone ID to join it.</div>
        <div class="row u-mt-sm">
          <input id="zoneCommandInput" type="text" placeholder="New zone name or zone ID" autocomplete="off" />
          <button id="zoneCommandButton" type="button" disabled>Create</button>
          <span id="zoneCommandSpinner" class="inlineSpinner hidden" aria-hidden="true"></span>
        </div>
        <div id="zoneCommandHelper" class="small muted u-mt-sm">Type a name to create a zone, or paste a zone ID to join one.</div>
      </div>

      <div id="zonesList" class="list"></div>

      <div class="card">
        <div class="cardTitle">Zone Devices <span id="peersCount" class="small muted"></span></div>
        <div id="peersList" class="list"></div>
      </div>
    </div>
  </section>

  <section id="viewOnboard" class="activity hidden">
    <h1>Onboarding</h1>

    <div id="obStepDevice" class="card hidden">
      <div class="cardTitle">Step 1 — Device security</div>
      <div class="small muted">Pick one. WebAuthn is recommended.</div>

      <div class="choiceRow" role="radiogroup" aria-label="Device security method">
        <button id="btnSecWebAuthn" type="button" class="choiceBtn" role="radio" aria-checked="false">
          <div class="choiceTitle">WebAuthn</div>
          <div class="choiceSub">Platform-backed key (preferred)</div>
        </button>

        <button id="btnSecSkip" type="button" class="choiceBtn" role="radio" aria-checked="false">
          <div class="choiceTitle">Skip</div>
          <div class="choiceSub">Software-only (fallback)</div>
        </button>
      </div>

      <div id="obDeviceStatus" class="small muted u-mt-sm"></div>

      <div class="row u-mt-md">
        <button id="btnObDeviceContinue" type="button">Continue</button>
      </div>
    </div>

    <div id="obStepIdentity" class="card hidden">
      <div class="cardTitle">Step 2 — Labels</div>
      <div class="small muted">Both are required.</div>

      <label for="obDeviceLabel">Device label</label>
      <input id="obDeviceLabel" type="text" placeholder="e.g. users-laptop" />

      <label for="obIdentityLabel">Identity label</label>
      <input id="obIdentityLabel" type="text" placeholder="e.g. some-unique-username" />

      <div class="tabs u-mt-sm">
        <button type="button" class="tab tab-active" data-mode="new">Create</button>
        <button type="button" class="tab" data-mode="existing">Join existing</button>
      </div>

      <div id="obPairCodeWrap" class="hidden u-mt-sm">
        <label for="obPairCode">Pairing code (recommended)</label>
        <input id="obPairCode" type="text" placeholder="Paste code from owner device" />
        <div class="small muted">If blank, a random code is generated and shown after request.</div>
      </div>

      <div class="row u-mt-md">
        <button id="btnObIdentityContinue" type="button">Continue</button>
      </div>

      <div id="existingInfo" class="small muted hidden u-mt-md"></div>
    </div>
  </section>
`;

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

const shell = renderFirstPartyShell(app, {
  appName: "Account",
  navItems: [
    { id: "home", label: "Home", active: true },
    { id: "devices", label: "Devices" },
    { id: "zones", label: "Zones" },
  ],
  mainHtml: ACCOUNT_MAIN_HTML,
  accountCenterTitle: "",
});

const panePathEl = shell.panePathEl;

const connWrap = shell.connWrapEl;
const connStateText = shell.connStateTextEl;
const connPopover = shell.connPopoverEl;
const bootSplashEl = document.getElementById('bootSplash');
const bootSplashTitleEl = document.getElementById('bootSplashTitle');
const bootSplashStatusEl = document.getElementById('bootSplashStatus');
const popConnection = shell.popConnectionEl;
const popConnectionReason = shell.popConnectionReasonEl;
const popRelay = shell.popRelayEl;
const popGateway = shell.popGatewayEl;
const popServices = shell.popServicesEl;

const btnMenu = shell.btnMenuEl;
const drawer = shell.drawerEl;
const drawerBackdrop = shell.drawerBackdropEl;
const btnDrawerClose = shell.btnDrawerCloseEl;
const navButtons = shell.navButtons;
const accountRailButton = shell.accountRailButtonEl;
const accountCenterMenu = shell.accountCenterMenuEl;
const accountCenterSummary = shell.accountCenterSummaryEl;
const accountCenterActions = shell.accountCenterActionsEl;
const identityHandle = shell.identityHandleEl;

const btnBell = shell.btnBellEl;
const notifMenu = shell.notifMenuEl;
const notifList = shell.notifListEl;
const btnNotifClear = shell.btnNotifClearEl;

const viewHome = document.getElementById('viewHome');
const viewSettings = document.getElementById('viewSettings');
const viewOnboard = document.getElementById('viewOnboard');

const tabButtons = Array.from(viewSettings.querySelectorAll('.tab'));
const tabPanes = {
  devices: document.getElementById('tab_devices'),
  network: document.getElementById('tab_network'),
};

const pendingRequestsSection = document.getElementById('pendingRequestsSection');
const deviceDid = document.getElementById('deviceDid');
const deviceLabel = document.getElementById('deviceLabel');
const btnSaveDeviceLabel = document.getElementById('btnSaveDeviceLabel');
const deviceList = document.getElementById('deviceList');
const blockedList = document.getElementById('blockedList');

const pairingList = document.getElementById('pairingList');
const pairingEmpty = document.getElementById('pairingEmpty');
const pairCodeInput = document.getElementById('pairCodeInput');
const btnClaimPairCode = document.getElementById('btnClaimPairCode');
const pairCodeStatus = document.getElementById('pairCodeStatus');

const networkStatusConnectionEl = document.getElementById('networkStatusConnection');
const networkStatusRelayEl = document.getElementById('networkStatusRelay');
const networkStatusGatewayMeshEl = document.getElementById('networkStatusGatewayMesh');
const networkStatusServicesEl = document.getElementById('networkStatusServices');
const networkStatusDetailEl = document.getElementById('networkStatusDetail');
const runtimeServiceCatalogStatusEl = document.getElementById('runtimeServiceCatalogStatus');
const runtimeServiceCatalogListEl = document.getElementById('runtimeServiceCatalogList');
const runtimeEdgeStatusEl = document.getElementById('runtimeEdgeStatus');
const runtimeQueueStatusEl = document.getElementById('runtimeQueueStatus');
const runtimeProjectionStatusEl = document.getElementById('runtimeProjectionStatus');
const runtimeResourceStatusEl = document.getElementById('runtimeResourceStatus');
const runtimeRetentionStatusEl = document.getElementById('runtimeRetentionStatus');
const runtimeStatusDetailEl = document.getElementById('runtimeStatusDetail');

const joinDeviceLabelEl = document.getElementById('joinDeviceLabel');

const deviceDidSummary = document.getElementById('deviceDidSummary');
const deviceSecuritySummary = document.getElementById('deviceSecuritySummary');
const identityLinkedSummary = document.getElementById('identityLinkedSummary');

const zoneCommandInput = document.getElementById('zoneCommandInput');
const zoneCommandButton = document.getElementById('zoneCommandButton');
const zoneCommandHelper = document.getElementById('zoneCommandHelper');
const zoneCommandSpinner = document.getElementById('zoneCommandSpinner');
const zonesList = document.getElementById('zonesList');
const peersCount = document.getElementById('peersCount');
const peersList = document.getElementById('peersList');

const obStepDevice = document.getElementById('obStepDevice');
const obStepIdentity = document.getElementById('obStepIdentity');
const btnObDeviceContinue = document.getElementById('btnObDeviceContinue');
const obDeviceLabel = document.getElementById('obDeviceLabel');
const obIdentityLabel = document.getElementById('obIdentityLabel');
const obPairCodeWrap = document.getElementById('obPairCodeWrap');
const obPairCode = document.getElementById('obPairCode');
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

const SHELL_BUILD_ID = '2026-04-06-runtime-stage3';
const RUNTIME_ATTACH_TIMEOUT_MS = 15_000;
const RUNTIME_WRITE_TIMEOUT_MS = 12_000;
const RUNTIME_SWARM_EDGE_ATTACH_RETRY_MS = 30_000;
const RUNTIME_SWARM_EDGE_ATTACH_MAX_RETRY_MS = 120_000;
const RUNTIME_STREAM_OPEN = 'runtime.stream.open';
const RUNTIME_STREAM_CONTROL = 'runtime.stream.control';
const RUNTIME_STREAM_CLOSE = 'runtime.stream.close';
const RUNTIME_AUTHORITY_DEVICE_PUT = 'runtime.authority.device.put';
const SWARM_EDGE_ATTACH = 'swarm.edge.attach';
const DEFAULT_PUBLIC_RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
]);

let relayState = 'offline';
let daemonState = 'unknown';
let swarmState = 'offline';
let accountCenterOpen = false;
let bootRefreshSettled = false;
let notificationsResolved = false;
let lastNotifications = [];

let lastDeviceState = null;
let lastIdentity = null;
let lastDirectory = [];
let lastZones = [];
let activeZoneKey = '';
let pendingZoneNav = false;
let lastPairClaimStatus = null;
let swarm = null;
let clientReady = false;
let swarmBootRequested = false;

const GATEWAY_EXTRA_ZONES_KEY = 'constitute.gateway.extraZones';
const MANAGED_APP_SURFACES = Object.freeze({
  nvr: 'constitute-nvr-ui',
  logging: 'constitute-logging-ui',
});
const GATEWAY_INVENTORY_REFRESH_TTL_MS = 15_000;
const GATEWAY_INVENTORY_STABLE_TTL_MS = 2 * 60 * 1000;
const GATEWAY_GRANT_VIEW_REFRESH_TTL_MS = 60_000;
const RELAY_BRIDGE_LEASE_KEY = 'constitute.relayBridge.owner';
const RELAY_BRIDGE_LEASE_MS = 12_000;
const RELAY_BRIDGE_HEARTBEAT_MS = 4_000;
const RELAY_WORKER_QUIET_TIMEOUT_MS = 1_500;

const APPLIANCE_DISCOVERY_MAX_AGE_MS = 60 * 60 * 1000;

let relayBridge = null;
let relayPoolSnapshot = { version: '', urls: [], relays: {}, state: 'offline', reason: '', ingress: null };
let runtimeBridge = null;
let runtimeRunnerBridge = null;
let runtimeRunnerBridgePostureKey = '';
let runtimeDiagnosticsAgent = null;
let runtimeAttached = false;
let runtimeStatusSnapshot = {
  buildId: '',
  updatedAt: 0,
  shell: null,
  services: {},
  managedAppliances: { owned: [], granted: [], discoverable: [] },
  resourceNames: {},
  projections: {},
  managedServiceIssue: null,
};
let runtimeSnapshotMaterializationBudget = null;
let runtimeSnapshotConsumerFloor = null;
let runtimeSnapshotMaterializationPosture = null;
let lastManagedServiceIssue = null;
let lastRuntimeShellStatusKey = '';
let runtimeAttachWarningLogged = false;
let shellRuntimeSnapshotMarked = false;
let bootSplashDismissed = false;
let runtimeEdgeAttachTarget = '';
let runtimeEdgeAttachInFlight = null;
let runtimeEdgeAttachAttemptedAt = 0;
let runtimeEdgeAttachBackoffUntil = 0;
let runtimeEdgeAttachFailureCount = 0;
let runtimeEdgeAttachLastWarnAt = 0;
let runtimeAuthorityDevicePk = '';
const resolvedResourceNames = new Map();
const urlParams = new URLSearchParams(window.location.search || '');
const accountBridgeMode = urlParams.get('bridge') === '1';
const shellBootDebugEnabled = urlParams.get('debug') === '1';

function debugLog(...args) {
  if (!shellBootDebugEnabled) return;
  console.debug(...args);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

let shellBootFallbackTimer = null;
const managedAppliances = createManagedApplianceModel({
  applyHostedSnapshot: (record) => applyGatewayHostedSnapshot(record),
  getSwarmSeen: (pk) => (swarm ? swarm.getSwarmSeen(pk) : 0),
  applianceDiscoveryMaxAgeMs: APPLIANCE_DISCOVERY_MAX_AGE_MS,
});
const {
  applianceFreshness,
  applianceSeenAt,
  buildApplianceRecords,
  findGatewayHostedServiceRecord,
  formatAgeShort,
  formatReleaseMeta,
  isGatewayRecord,
  isNvrRecord,
  managedGatewayPkForRecord,
  managedServicePkForRecord,
  ownedPkSet,
  partitionApplianceRecords,
  summarizeAppliance,
} = managedAppliances;

function runtimeManagedApplianceBucket(scope) {
  const key = String(scope || '').trim();
  const bucket = runtimeStatusSnapshot?.managedAppliances?.[key];
  return Array.isArray(bucket) ? bucket : [];
}

function runtimeManagedApplianceRecords() {
  return [
    ...runtimeManagedApplianceBucket('owned'),
    ...runtimeManagedApplianceBucket('granted'),
    ...runtimeManagedApplianceBucket('discoverable'),
  ];
}

function runtimeServiceCatalogRecords() {
  const catalog = buildRuntimeSnapshotView(runtimeStatusSnapshot).catalog;
  const updatedAt = Number(runtimeStatusSnapshot?.serviceCatalog?.updatedAt || runtimeStatusSnapshot?.updatedAt || Date.now());
  return catalog
    .filter((service) => service.service && service.servicePk)
    .map((service) => ({
      devicePk: service.servicePk,
      servicePk: service.servicePk,
      deviceLabel: service.title,
      deviceKind: 'service',
      role: service.service,
      service: service.service,
      hostGatewayPk: service.hostGatewayPk,
      status: service.health,
      summary: service.summary,
      surfaceChannel: service.surfaceChannel,
      surfaceNodes: service.nodes,
      updatedAt,
      managedAvailabilityAuthority: 'runtime',
      managedAvailabilityUpdatedAt: updatedAt,
      managedAvailabilityGatewayPk: service.hostGatewayPk,
      runtimeCatalogRecord: true,
    }));
}

function currentSwarmDeviceRecords() {
  const liveRecords = Array.isArray(lastSwarmDevices) ? lastSwarmDevices : [];
  if (liveRecords.length > 0) return liveRecords;
  const cachedRecords = Array.isArray(swarm?.deviceCache) ? swarm.deviceCache : [];
  return cachedRecords;
}

function managedRecordKey(record) {
  const service = normalizeRole(record?.service || record?.slug || record?.name || '');
  const servicePk = String(record?.servicePk || record?.service_pk || record?.devicePk || record?.pk || '').trim();
  const gatewayPk = String(record?.hostGatewayPk || record?.host_gateway_pk || '').trim();
  if (service && service !== 'gateway') return ['service', gatewayPk, service, servicePk || service].join('|');
  const pk = String(record?.devicePk || record?.pk || record?.gatewayPk || '').trim();
  return ['gateway', pk || String(record?.label || record?.deviceLabel || '').trim()].join('|');
}

function managedRecordRichness(record) {
  const facts = record?.facts && typeof record.facts === 'object' ? record.facts : {};
  const health = record?.health && typeof record.health === 'object' ? record.health : {};
  const hosted = Array.isArray(record?.hostedServices || record?.hosted_services)
    ? (record.hostedServices || record.hosted_services)
    : [];
  const cameraDevices = [
    ...(Array.isArray(record?.cameraDevices || record?.cameras) ? (record.cameraDevices || record.cameras) : []),
    ...(Array.isArray(facts.cameraDevices || facts.cameras) ? (facts.cameraDevices || facts.cameras) : []),
    ...(Array.isArray(health.cameraDevices || health.cameras) ? (health.cameraDevices || health.cameras) : []),
  ];
  const sources = [
    ...(Array.isArray(record?.sources || record?.sourceIds) ? (record.sources || record.sourceIds) : []),
    ...(Array.isArray(facts.sources || facts.sourceIds) ? (facts.sources || facts.sourceIds) : []),
  ];
  return (hosted.length * 20)
    + (cameraDevices.length * 10)
    + (sources.length * 5)
    + Number(record?.cameraCount || record?.camera_count || facts.cameraCount || facts.configuredSources || 0)
    + (Object.keys(facts).length > 0 ? 3 : 0)
    + (String(record?.managedAvailabilityAuthority || '').toLowerCase() === 'gateway' ? 2 : 0);
}

function dedupeManagedRecords(records) {
  const sorted = (Array.isArray(records) ? records : [])
    .filter((record) => record && typeof record === 'object')
    .slice()
    .sort((left, right) => {
      const richnessDelta = managedRecordRichness(right) - managedRecordRichness(left);
      if (richnessDelta) return richnessDelta;
      return applianceSeenAt(right) - applianceSeenAt(left);
    });
  const out = [];
  const seen = new Set();
  for (const record of sorted) {
    const key = managedRecordKey(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

function identityOwnedDevicePks() {
  return Array.from(ownedPkSet(lastIdentity?.devices || []));
}

function runtimeOwnedDevicePks() {
  return runtimeManagedApplianceBucket('owned')
    .flatMap((record) => [
      record?.devicePk,
      record?.pk,
      record?.hostGatewayPk,
      record?.host_gateway_pk,
    ])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function currentManagedApplianceRecords(identityDevices = lastIdentity?.devices || [], swarmDevices = currentSwarmDeviceRecords()) {
  const runtimeRecords = runtimeManagedApplianceRecords();
  const catalogRecords = runtimeServiceCatalogRecords();
  const effectiveSwarmDevices = Array.isArray(swarmDevices) && swarmDevices.length > 0
    ? swarmDevices
    : currentSwarmDeviceRecords();
  const sourceRecords = buildApplianceRecords(identityDevices, effectiveSwarmDevices, grantedManagedServiceRecords());
  return dedupeManagedRecords([...sourceRecords, ...runtimeRecords, ...catalogRecords]);
}

function setBootSplash(title = 'Loading', status = '') {
  if (bootSplashDismissed || !bootSplashEl) return;
  if (bootSplashTitleEl) bootSplashTitleEl.textContent = title;
  if (bootSplashStatusEl) {
    const text = String(status || '').trim();
    bootSplashStatusEl.textContent = text;
    bootSplashStatusEl.hidden = !text;
  }
  document.body.classList.add('booting');
}

function dismissBootSplash() {
  if (bootSplashDismissed || !bootSplashEl) return;
  bootSplashDismissed = true;
  document.body.classList.remove('booting');
  window.setTimeout(() => {
    try { bootSplashEl.remove(); } catch {}
  }, 220);
}

function markShellBoot(stage) {
  const label = String(stage || '').trim();
  if (!label) return;
  try {
    performance.mark(`constitute:${label}`);
  } catch {}
  if (shellBootDebugEnabled) {
    try {
      console.debug('[boot]', label, Math.round(performance.now()));
    } catch {
      console.debug('[boot]', label);
    }
  }
}

function clearShellBootFallbackTimer() {
  if (!shellBootFallbackTimer) return;
  clearTimeout(shellBootFallbackTimer);
  shellBootFallbackTimer = null;
}

function tryDismissShellBootSplash(reason = '') {
  if (bootSplashDismissed) return true;
  const canDismiss = shellBootCanDismiss({
    runtimeAttached,
    fallbackExpired: !shellBootFallbackTimer,
  });
  if (!canDismiss) return false;
  markShellBoot(reason || (runtimeAttached ? 'shell.first-paint.snapshot' : 'shell.first-paint.fallback'));
  dismissBootSplash();
  return true;
}

function scheduleShellBootFallback() {
  clearShellBootFallbackTimer();
  shellBootFallbackTimer = setTimeout(() => {
    shellBootFallbackTimer = null;
    renderConnectionModel('boot-fallback');
    pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices || []);
    tryDismissShellBootSplash('shell.first-paint.fallback');
  }, SHELL_BOOT_FALLBACK_TIMEOUT_MS);
}

function bootFromRuntimeSnapshot() {
  scheduleShellBootFallback();
  runtimeBridge = startPlatformRuntimeBridge();
  if (!runtimeBridge) {
    markShellBoot('shell.runtime-attach.unavailable');
    return null;
  }
  runtimeBridge.whenReady(SHELL_BOOT_RUNTIME_ATTACH_TIMEOUT_MS)
    .then((snapshot) => {
      markShellBoot(snapshot ? 'shell.runtime-attached' : 'shell.runtime-attach.unavailable');
    })
    .catch((err) => {
      if (!runtimeAttachWarningLogged) {
        runtimeAttachWarningLogged = true;
        console.warn('[runtime] runtime attach bootstrap failed', err);
      }
      markShellBoot('shell.runtime-attach.timeout');
    });
  return runtimeBridge;
}

function bootSplashCopy(reason = '') {
  if (daemonState === 'online') {
    return {
      title: 'Loading',
      status: '',
    };
  }
  if (relayState === 'connecting') {
    return {
      title: 'Connecting',
      status: '',
    };
  }
  if (relayState === 'open') {
    return {
      title: 'Loading',
      status: '',
    };
  }
  if (!clientReady) {
    return {
      title: 'Starting',
      status: '',
    };
  }
  return {
    title: 'Loading',
    status: '',
  };
}

function conciseConnectionReason(summary) {
  if (summary.code === 'connected') return 'Everything is available.';
  if (summary.code === 'connected-limited') return 'Connected. Some transport paths are still settling.';
  if (summary.code === 'degraded') return 'Connected with limited reachability.';
  if (summary.code === 'connecting') return 'Starting local and network services.';
  return 'Waiting for local services.';
}

function describeShellResourceName(pk, fallback = '') {
  const key = String(pk || '').trim();
  const raw = String(fallback || shortPk(key)).trim() || '—';
  return describeShellResourceNameState({
    pk: key,
    fallback: raw,
    resolvedLabel: resolvedResourceNames.get(key) || '',
    runtimeAttached,
  });
}

function rememberResolvedResourceName(pk, label) {
  const key = String(pk || '').trim();
  const text = String(label || '').trim();
  if (!key || !text) return;
  resolvedResourceNames.set(key, text);
}

function absorbRuntimeSnapshot(snapshot) {
  runtimeStatusSnapshot = (snapshot && typeof snapshot === 'object') ? snapshot : runtimeStatusSnapshot;
  const names = runtimeStatusSnapshot?.resourceNames;
  if (names && typeof names === 'object') {
    for (const [pk, label] of Object.entries(names)) {
      rememberResolvedResourceName(pk, label);
    }
  }
  renderRuntimeStatusSnapshot();
  if (!shellRuntimeSnapshotMarked) {
    shellRuntimeSnapshotMarked = true;
    markShellBoot('shell.runtime-snapshot');
  }
}

function renderRuntimeStatusSnapshot() {
  renderRuntimeSnapshotView({
    catalogStatusEl: runtimeServiceCatalogStatusEl,
    catalogListEl: runtimeServiceCatalogListEl,
    edgeStatusEl: runtimeEdgeStatusEl,
    queueStatusEl: runtimeQueueStatusEl,
    projectionStatusEl: runtimeProjectionStatusEl,
    resourceStatusEl: runtimeResourceStatusEl,
    retentionStatusEl: runtimeRetentionStatusEl,
    runtimeStatusDetailEl,
  }, runtimeStatusSnapshot, document, {
    clientId: runtimeBridge?.clientId || 'runtime-shell',
    surface: 'shell',
    materializationBudget: runtimeSnapshotMaterializationBudget || undefined,
    consumerFloor: runtimeSnapshotConsumerFloor || undefined,
    materializationPosture: runtimeSnapshotMaterializationPosture || undefined,
  });
}

function updateBootSplash(reason = '') {
  if (bootSplashDismissed) return;
  const copy = bootSplashCopy(reason);
  setBootSplash(copy.title, copy.status);
}

let lastSwarmDevices = [];
const gatewayInventoryRefreshAt = new Map();
const gatewayInventoryStableAt = new Map();
const pendingGatewayServiceInstalls = new Map();
const pendingGatewayZoneSyncs = new Map();
const pendingGatewayGrantRequests = new Map();
const gatewayGrantViewCache = new Map();
const gatewayGrantViewInFlight = new Map();
const sharedManagedServicesByGatewayPk = new Map();
const ownedGatewayGrantInventoryByServiceKey = new Map();
const managedServiceActionStates = new Map();
const managedServiceActionTimers = new Map();
let gatewayExtraZonesByPk = {};
const ZONE_KEY_RE = /^[A-Za-z0-9_-]{20}$/;
const ZONE_COMMAND_DEBOUNCE_MS = 500;
const MANAGED_SERVICE_RESOLVE_TIMEOUT_MS = 6_000;
const MANAGED_SERVICE_RESOLVE_POLL_MS = 400;

const zoneCommandState = {
  draft: '',
  resolvedKey: '',
  resolvedName: '',
  mode: 'idle',
  helper: '',
  busy: false,
};
let zoneCommandDebounce = 0;

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
    const peerSet = new Set(peers);
    for (const pk of Array.from(this.channels.keys())) {
      if (!peerSet.has(pk)) this._dropPeer(pk);
    }
    for (const pk of Array.from(this.peers.keys())) {
      if (!peerSet.has(pk)) this._dropPeer(pk);
    }
    for (const pk of Array.from(this.connecting)) {
      if (!peerSet.has(pk)) this.connecting.delete(pk);
    }
    const key = peers.slice().sort().join(',');
    if (key === this.lastPeerKey) {
      this._updateState();
      return;
    }
    this.lastPeerKey = key;
    debugLog('[swarm] peers selected', peers);
    this.lastKnown = peers;
    this._persistLastKnown(peers);
    for (const pk of peers) {
      if (!this.peers.has(pk) && !this.connecting.has(pk) && this._canDial(pk)) {
        this.connecting.add(pk);
        debugLog('[swarm] dialing', pk);
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

  _dropPeer(pk) {
    this.connecting.delete(pk);
    const ch = this.channels.get(pk);
    if (ch) try { ch.close(); } catch {}
    this.channels.delete(pk);
    const pc = this.peers.get(pk);
    if (pc) try { pc.close(); } catch {}
    this.peers.delete(pk);
  }

  async _connectTo(pk) {
    const pc = new RTCPeerConnection({ iceServers: SWARM_ICE_SERVERS });
    this.peers.set(pk, pc);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      debugLog('[swarm] ice', pk);
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
    debugLog('[swarm] offer', pk);
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
    debugLog('[swarm] answer', pk);
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
      debugLog('[swarm] channel open', pk);
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
    debugLog('[swarm] msg', pk, msg?.type || 'unknown');
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
    debugLog('[swarm] signal', t, from);
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
      .filter((rec) => {
        const role = normalizeRole(rec?.role || rec?.type || '');
        const service = normalizeRole(rec?.service || '');
        return role === 'browser' && !service;
      })
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

function relaysOpenCount() {
  const relayUrls = Array.isArray(relayPoolSnapshot?.urls) ? relayPoolSnapshot.urls : [];
  return relayUrls.filter((relayUrl) => String(relayPoolSnapshot?.relays?.[relayUrl]?.state || '') === 'open').length;
}

function summarizeRelayNetwork() {
  const relayUrls = Array.isArray(relayPoolSnapshot?.urls) ? relayPoolSnapshot.urls : [];
  const openCount = relaysOpenCount();
  if (!relayUrls.length) {
    return { label: 'offline', code: 'offline', reason: 'No relay targets configured.', usable: false };
  }
  if (openCount === relayUrls.length) {
    return { label: `open (${openCount}/${relayUrls.length})`, code: 'healthy', reason: 'All configured relays are reachable.', usable: true };
  }
  if (openCount > 0) {
    return {
      label: `degraded (${openCount}/${relayUrls.length})`,
      code: 'degraded',
      reason: `${openCount} of ${relayUrls.length} relay targets are reachable.`,
      usable: true,
    };
  }
  if (relayState === 'connecting') {
    return { label: 'connecting', code: 'connecting', reason: 'Opening relay connections...', usable: false };
  }
  const aggregateReason = String(relayPoolSnapshot?.reason || '').trim();
  return {
    label: relayState || 'offline',
    code: 'offline',
    reason: aggregateReason || 'No relay targets are currently reachable.',
    usable: false,
  };
}

function ownedApplianceRecords() {
  const owned = ownedPkSet(lastIdentity?.devices || []);
  const records = currentManagedApplianceRecords(lastIdentity?.devices || [], lastSwarmDevices || []);
  return records.filter((rec) => {
    const pk = String(rec?.devicePk || rec?.pk || '').trim();
    const hostGatewayPk = String(rec?.hostGatewayPk || rec?.host_gateway_pk || '').trim();
    return owned.has(pk) || owned.has(hostGatewayPk);
  });
}

function freshestOwnedGatewayRecord() {
  const owned = ownedPkSet(lastIdentity?.devices || []);
  return ownedApplianceRecords().find((rec) => isGatewayRecord(rec) && owned.has(String(rec?.devicePk || rec?.pk || '').trim())) || null;
}

function pushUniqueGatewayCandidate(out, seen, record) {
  if (!record || typeof record !== 'object' || !isGatewayRecord(record)) return;
  const pk = String(record?.devicePk || record?.pk || '').trim();
  const edgeEndpoint = gatewayEdgeEndpointForRecord(record);
  const key = `${pk}|${edgeEndpoint}`;
  if (!pk || !edgeEndpoint || seen.has(key)) return;
  seen.add(key);
  out.push(record);
}

function bestSwarmEdgeGatewayRecord() {
  const owned = new Set([
    ...ownedPkSet(lastIdentity?.devices || []),
    ...runtimeOwnedDevicePks(),
  ]);
  const gatewayRefs = new Set(owned);
  const runtimeRecords = runtimeManagedApplianceRecords();
  const catalogRecords = runtimeServiceCatalogRecords();
  const swarmDeviceRecords = currentSwarmDeviceRecords();
  const builtRecords = buildApplianceRecords(lastIdentity?.devices || [], swarmDeviceRecords, grantedManagedServiceRecords());
  for (const rec of [...runtimeRecords, ...catalogRecords, ...builtRecords]) {
    const gatewayPk = managedGatewayPkForRecord(rec);
    if (gatewayPk) gatewayRefs.add(gatewayPk);
  }

  const candidates = [];
  const seen = new Set();
  for (const source of [runtimeRecords, swarmDeviceRecords, builtRecords, lastDirectory || []]) {
    for (const rec of Array.isArray(source) ? source : []) {
      pushUniqueGatewayCandidate(candidates, seen, rec);
    }
  }
  candidates.sort((left, right) => {
    const leftPk = String(left?.devicePk || left?.pk || '').trim();
    const rightPk = String(right?.devicePk || right?.pk || '').trim();
    const leftScore = gatewayRefs.has(leftPk) ? 1 : 0;
    const rightScore = gatewayRefs.has(rightPk) ? 1 : 0;
    return rightScore - leftScore || Number(applianceSeenAt(right) || 0) - Number(applianceSeenAt(left) || 0);
  });
  return candidates[0] || null;
}

function summarizeOwnedGateway() {
  const rec = freshestOwnedGatewayRecord();
  if (!rec) {
    return {
      code: 'offline',
      label: 'not found',
      reason: 'No owned gateway has been discovered yet.',
      usable: false,
      record: null,
    };
  }
  const seenAt = applianceSeenAt(rec);
  const freshness = applianceFreshness(seenAt);
  const gatewayPk = String(rec?.devicePk || rec?.pk || '').trim();
  const relayCount = Array.isArray(rec?.relays) ? rec.relays.length : 0;
  if (freshness.label === 'live' || freshness.label === 'recent') {
    return {
      code: 'healthy',
      label: freshness.label === 'live' ? 'online' : 'recent',
      reason: `${String(rec?.deviceLabel || 'Gateway').trim() || 'Gateway'} updated ${formatRelativeTime(seenAt)}${relayCount ? ` • ${relayCount} relay path${relayCount === 1 ? '' : 's'}` : ''}.`,
      usable: true,
      record: rec,
      gatewayPk,
    };
  }
  return {
    code: freshness.label === 'stale' ? 'stale' : 'offline',
    label: freshness.label,
    reason: `${String(rec?.deviceLabel || 'Gateway').trim() || 'Gateway'} last updated ${formatRelativeTime(seenAt)}.`,
    usable: freshness.label === 'stale',
    record: rec,
    gatewayPk,
  };
}

function summarizeGatewayMesh(gatewaySummary) {
  const gatewayPk = String(gatewaySummary?.gatewayPk || '').trim();
  if (!gatewayPk) {
    return { code: 'offline', label: 'unknown', reason: 'Gateway mesh is unavailable until an owned gateway is online.', usable: false };
  }
  const hit = (Array.isArray(lastDirectory) ? lastDirectory : []).find((entry) => String(entry?.devicePk || '').trim() === gatewayPk) || null;
  const swarmEndpoint = String(hit?.swarm || '').trim();
  const lastSeen = Number(hit?.lastSeen || 0);
  if (swarmEndpoint) {
    return {
      code: 'healthy',
      label: 'ready',
      reason: `Owned gateway is advertising mesh endpoint ${swarmEndpoint}${lastSeen ? ` • seen ${formatRelativeTime(lastSeen)}` : ''}.`,
      usable: true,
    };
  }
  if (gatewaySummary?.usable) {
    return {
      code: 'idle',
      label: 'idle',
      reason: 'Owned gateway is reachable, but no mesh endpoint is being advertised yet.',
      usable: true,
    };
  }
  return {
    code: 'offline',
    label: 'offline',
    reason: 'Gateway mesh is waiting on gateway reachability.',
    usable: false,
  };
}

function summarizeServices(gatewaySummary) {
  const runtimeView = buildRuntimeSnapshotView(runtimeStatusSnapshot);
  if (runtimeView.catalog.length > 0) {
    const unhealthy = runtimeView.catalog.filter((service) => {
      const health = String(service.health || '').trim().toLowerCase();
      return ['error', 'failed', 'rejected', 'offline', 'degraded'].includes(health);
    });
    const serviceNames = runtimeView.catalog.map((service) => service.title).filter(Boolean).slice(0, 3).join(', ');
    const more = runtimeView.catalog.length > 3 ? ` +${runtimeView.catalog.length - 3}` : '';
    const hasHealthy = runtimeView.catalog.some((service) => !unhealthy.includes(service));
    return {
      code: unhealthy.length ? 'degraded' : 'healthy',
      label: runtimeView.catalog.length === 1 ? runtimeView.catalog[0].health : `${runtimeView.catalog.length} services`,
      reason: `${serviceNames || 'Runtime service catalog'}${more} retained by runtime snapshot.`,
      usable: hasHealthy,
    };
  }
  const runtimeNvr = runtimeStatusSnapshot?.services?.nvr || null;
  const runtimeState = String(runtimeNvr?.state || '').trim().toLowerCase();
  if (runtimeNvr && runtimeState && runtimeState !== 'idle' && (Date.now() - Number(runtimeNvr.updatedAt || 0)) < GATEWAY_INVENTORY_STABLE_TTL_MS) {
    return {
      code: runtimeState || 'unknown',
      label: String(runtimeNvr.state || '').trim() || 'unknown',
      reason: String(runtimeNvr.reason || '').trim() || 'NVR runtime status available.',
      usable: ['online', 'live', 'connected', 'healthy'].includes(String(runtimeNvr.state || '').trim().toLowerCase()),
    };
  }
  if (runtimeStatusSnapshot?.managedServiceIssue?.service === 'nvr') {
    return {
      code: 'degraded',
      label: 'degraded',
      reason: String(runtimeStatusSnapshot.managedServiceIssue.reason || 'Managed NVR stream intent failed.').trim(),
      usable: false,
    };
  }
  const gatewayPk = String(gatewaySummary?.gatewayPk || '').trim();
  const recs = ownedApplianceRecords();
  const hostedNvr = gatewayPk ? findGatewayHostedServiceRecord(gatewayPk, recs, 'nvr') : null;
  if (hostedNvr) {
    const seenAt = applianceSeenAt(hostedNvr);
    const freshness = applianceFreshness(seenAt);
    const cameraCount = Number(hostedNvr?.cameraCount || hostedNvr?.camera_count || 0);
    const label = freshness.label === 'live' ? 'online' : freshness.label;
    return {
      code: freshness.label === 'offline' ? 'offline' : (freshness.label === 'stale' ? 'degraded' : 'healthy'),
      label,
      reason: `NVR advertised ${cameraCount ? `${cameraCount} camera${cameraCount === 1 ? '' : 's'}` : 'no cameras'} • updated ${formatRelativeTime(seenAt)}.`,
      usable: freshness.label !== 'offline',
    };
  }
  if (gatewaySummary?.usable) {
    return {
      code: 'offline',
      label: 'not found',
      reason: 'Owned gateway is reachable, but no hosted NVR inventory is being advertised.',
      usable: false,
    };
  }
  return {
    code: 'offline',
    label: 'offline',
    reason: 'Services depend on an owned gateway becoming reachable first.',
    usable: false,
  };
}

function summarizeBrowserPeerTransport() {
  if (swarmState === 'open') {
    return { code: 'healthy', label: 'open', reason: 'Browser peer transport has open peer channels.', usable: true };
  }
  if (swarmState === 'connecting') {
    return { code: 'connecting', label: 'connecting', reason: 'Browser peer transport is negotiating browser-to-browser links.', usable: false };
  }
  if (swarmState === 'disabled') {
    return { code: 'disabled', label: 'disabled', reason: 'Browser peer transport is not active for this session.', usable: false };
  }
  return { code: 'offline', label: swarmState || 'offline', reason: 'No browser peer channels are open right now.', usable: false };
}

function connectionSummary() {
  const relay = summarizeRelayNetwork();
  const gateway = summarizeOwnedGateway();
  const gatewayMesh = summarizeGatewayMesh(gateway);
  const services = summarizeServices(gateway);
  const browserPeerTransport = summarizeBrowserPeerTransport();

  let code = 'offline';
  let label = 'Offline';
  let reason = 'This device is not linked to an identity yet.';

  if (daemonState === 'online') {
    if (gateway.usable && services.usable) {
      code = 'connected';
      label = 'Connected';
      reason = 'Owned gateway and hosted services are available.';
      if (relay.code !== 'healthy') {
        code = 'connected-limited';
        label = 'Connected with limits';
        reason = relay.reason || services.reason || gateway.reason;
      }
    } else if (gateway.usable) {
      code = 'connected-limited';
      label = 'Connected with limits';
      reason = services.reason || gateway.reason;
    } else if (relay.usable) {
      code = 'degraded';
      label = 'Degraded';
      reason = gateway.reason || 'Relay is available, but owned gateway reachability is degraded.';
    } else if (relay.code === 'connecting') {
      code = 'connecting';
      label = 'Connecting';
      reason = relay.reason;
    } else {
      code = 'offline';
      label = 'Offline';
      reason = relay.reason || 'No usable control path is available.';
    }
  } else if (relay.code === 'connecting') {
    code = 'connecting';
    label = 'Connecting';
    reason = 'Bringing this device online.';
  }

  return { code, label, reason, relay, gateway, gatewayMesh, services, browserPeerTransport };
}

function connectionTextClass(code) {
  if (code === 'connected' || code === 'healthy') return 'connStateText-connected';
  if (code === 'connected-limited' || code === 'degraded' || code === 'connecting') return 'connStateText-limited';
  return 'connStateText-error';
}

function renderConnectionModel(reason = '') {
  const summary = connectionSummary();
  const shellState = deriveAccountShellState(summary);
  const conciseReason = shellState.connection.reason || conciseConnectionReason(summary);
  updateIdentityChrome(lastIdentity, shellState);
  if (connStateText) {
    setConnectionStateText(connStateText, {
      label: shellState.connection.label,
      toneClass: shellState.connection.toneClass || connectionTextClass(summary.code),
    });
  }
  if (networkStatusConnectionEl) networkStatusConnectionEl.textContent = shellState.connection.label;
  if (networkStatusRelayEl) networkStatusRelayEl.textContent = shellState.relay.state;
  if (networkStatusGatewayMeshEl) networkStatusGatewayMeshEl.textContent = shellState.gateway.gatewayPk || shellState.gateway.state;
  if (networkStatusServicesEl) {
    networkStatusServicesEl.textContent = shellState.services.count > 0
      ? `${shellState.services.count} available`
      : shellState.services.state;
  }
  if (networkStatusDetailEl) {
    networkStatusDetailEl.textContent = conciseReason;
  }

  if (popConnection) popConnection.textContent = shellState.connection.label;
  if (popConnectionReason) popConnectionReason.textContent = conciseReason;
  if (popRelay) popRelay.textContent = shellState.relay.state;
  if (popGateway) popGateway.textContent = shellState.gateway.gatewayPk || shellState.gateway.state;
  if (popServices) {
    popServices.textContent = shellState.services.count > 0
      ? `${shellState.services.count} available`
      : shellState.services.state;
  }
  renderAccountCenter();

  const runtimeShellStatus = buildRuntimeShellStatus(summary);
  const runtimeShellStatusKey = JSON.stringify(runtimeShellStatus);
  if (runtimeShellStatusKey !== lastRuntimeShellStatusKey) {
    lastRuntimeShellStatusKey = runtimeShellStatusKey;
    runtimeBridge?.pushStatus?.(runtimeShellStatus).catch(() => {});
  }
}

function deriveAccountShellState(summary = connectionSummary(), ident = lastIdentity) {
  const rawId = String(ident?.id || '').trim();
  const shellStatus = buildRuntimeShellStatus(summary);
  return deriveRuntimeShellState({
    shell: {
      ...shellStatus,
      identity: {
        ...shellStatus.identity,
        linked: Boolean(ident?.linked || rawId),
        identityId: rawId,
        label: String(ident?.label || '').trim(),
      },
    },
  }, { context: browserStorageShellContext() });
}

function buildRuntimeShellStatus(summary = connectionSummary()) {
  return {
    connection: {
      code: summary.code,
      label: summary.label,
      reason: summary.reason,
    },
    relay: {
      state: relayState,
      openCount: relaysOpenCount(),
      targetCount: Array.isArray(relayPoolSnapshot?.urls) ? relayPoolSnapshot.urls.length : 0,
      reason: summary.relay.reason,
    },
    identity: {
      state: daemonState,
      linked: Boolean(lastIdentity?.linked),
      identityId: String(lastIdentity?.id || '').trim(),
      devicePk: String(lastDeviceState?.pk || lastDeviceState?.devicePk || '').trim(),
      label: String(lastIdentity?.label || '').trim(),
    },
    ownedGateway: {
      state: summary.gateway.label,
      reason: summary.gateway.reason,
      gatewayPk: String(summary.gateway?.gatewayPk || '').trim(),
    },
    zones: {
      activeZoneKey: String(activeZoneKey || '').trim(),
      joined: (Array.isArray(lastZones) ? lastZones : []).map((zone) => ({
        key: String(zone?.key || '').trim(),
        name: String(zone?.name || '').trim(),
      })).filter((zone) => zone.key),
    },
    gatewayMesh: {
      state: summary.gatewayMesh.label,
      reason: summary.gatewayMesh.reason,
    },
    services: {
      state: summary.services.label,
      reason: summary.services.reason,
    },
    browserPeerTransport: {
      state: summary.browserPeerTransport.label,
      reason: summary.browserPeerTransport.reason,
    },
  };
}

function setRelayState(s, reason = '', meta = null) {
  relayState = String(s || 'offline');
  if (meta && typeof meta === 'object') {
    relayPoolSnapshot = {
      version: String(meta.version || relayPoolSnapshot.version || '').trim(),
      urls: Array.isArray(meta.urls) ? meta.urls.slice() : (relayPoolSnapshot.urls || []),
      relays: (meta.relays && typeof meta.relays === 'object') ? meta.relays : (relayPoolSnapshot.relays || {}),
      ingress: (meta.ingress && typeof meta.ingress === 'object') ? meta.ingress : (relayPoolSnapshot.ingress || null),
      state: relayState,
      reason: String(reason || '').trim(),
    };
  } else {
    relayPoolSnapshot = { ...relayPoolSnapshot, state: relayState, reason: String(reason || '').trim() };
  }
  window.__constituteRelayUrls = Array.isArray(relayPoolSnapshot?.urls) ? relayPoolSnapshot.urls.slice() : [];
  window.__constituteRelayStates = (relayPoolSnapshot?.relays && typeof relayPoolSnapshot.relays === 'object')
    ? { ...relayPoolSnapshot.relays }
    : {};
  window.__constituteRelayIngress = relayPoolSnapshot?.ingress || null;
  const relayUrls = Array.isArray(relayPoolSnapshot.urls) ? relayPoolSnapshot.urls : [];
  const openCount = relayUrls.filter((relayUrl) => String(relayPoolSnapshot?.relays?.[relayUrl]?.state || '') === 'open').length;
  if (popRelay) {
    popRelay.textContent = relayUrls.length > 0 ? `${relayState} (${openCount}/${relayUrls.length})` : relayState;
  }
  updateBootSplash(reason);
  renderConnectionModel(reason);
}

function formatRelativeTime(ts) {
  return formatAgeShort(ts);
}

function setDaemonState(s, reason = '') {
  daemonState = String(s || 'unknown');
  updateBootSplash(reason);
  renderConnectionModel(reason);
}

function setSwarmState(s, reason = '') {
  swarmState = String(s || 'offline');
  updateBootSplash(reason);
  renderConnectionModel(reason);
}

function showConnPopover() {
  if (connPopover) connPopover.classList.remove('hidden');
}
function hideConnPopover() {
  if (connPopover) connPopover.classList.add('hidden');
}
if (connWrap) {
  connWrap.addEventListener('mouseenter', showConnPopover);
  connWrap.addEventListener('mouseleave', hideConnPopover);
  connWrap.addEventListener('focusin', showConnPopover);
  connWrap.addEventListener('focusout', hideConnPopover);
}

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
function hasIdentityAndDevice() {
  const linked = Boolean(lastIdentity?.linked && String(lastIdentity?.id || '').trim());
  const hasDevice = Boolean(String(lastDeviceState?.pk || '').trim() || String(lastDeviceState?.did || '').trim());
  return linked && hasDevice;
}

function showActivity(name) {
  const requested = String(name || '').trim().toLowerCase();
  const normalized = requested === 'devices'
    ? 'settings'
    : (requested === 'zones' ? 'settings' : requested);
  const target = (normalized === 'onboarding' && hasIdentityAndDevice()) ? 'home' : normalized;
  viewHome.classList.toggle('hidden', target !== 'home');
  viewSettings.classList.toggle('hidden', target !== 'settings');
  viewOnboard.classList.toggle('hidden', target !== 'onboarding');
  if (requested === 'devices') setSettingsTab('devices');
  if (requested === 'zones') setSettingsTab('network');
  if (panePathEl) panePathEl.textContent = target === 'home' ? '' : (requested === 'devices' ? 'devices' : (requested === 'zones' ? 'zones' : target));
  for (const button of navButtons) {
    const activity = String(button.dataset.activity || '').trim().toLowerCase();
    button.classList.toggle('active', activity === requested || (requested === 'home' && activity === 'home'));
  }
}

function normalizeSettingsTabName(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (raw === 'network') return 'network';
  return 'devices';
}

function setSettingsTab(name) {
  const active = normalizeSettingsTabName(name);
  for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === active);
  for (const [k, el] of Object.entries(tabPanes)) {
    if (!el) continue;
    el.classList.toggle('hidden', k !== active);
  }
}

function currentIdentityHandle() {
  const label = String(lastIdentity?.label || '').trim();
  if (label) return `@${label}`;
  if (String(lastIdentity?.id || '').trim()) return '@linked';
  return '@unlinked';
}

function updateIdentityChrome(ident = lastIdentity, shellState = deriveAccountShellState(connectionSummary(), ident)) {
  if (!identityHandle) return;
  identityHandle.textContent = shellState.identity.handle;
  identityHandle.classList.toggle('identityHandle-linked', shellState.identity.linked);
  identityHandle.classList.toggle('identityHandle-unlinked', !shellState.identity.linked);
  identityHandle.title = shellState.identity.title;
  identityHandle.setAttribute('aria-label', shellState.identity.ariaLabel);
  renderAccountCenter();
}

function openAccountCenter() {
  accountCenterOpen = true;
  accountRailButton?.setAttribute('aria-expanded', 'true');
  accountCenterMenu?.classList.remove('hidden');
}

function closeAccountCenter() {
  accountCenterOpen = false;
  accountRailButton?.setAttribute('aria-expanded', 'false');
  accountCenterMenu?.classList.add('hidden');
}

function toggleAccountCenter() {
  if (accountCenterOpen) {
    closeAccountCenter();
    return;
  }
  openAccountCenter();
}

function renderAccountCenter() {
  if (!accountCenterSummary || !accountCenterActions) return;
  accountCenterSummary.replaceChildren();
  renderActionList(accountCenterActions, [
    {
      id: 'account.open_home',
      label: 'Open Account Center',
      description: 'Show the account overview.',
      onSelect: () => {
        closeAccountCenter();
        closeDrawer();
        showActivity('home');
      },
    },
  ]);
}


function setPairCodeStatus(msg, error = false) {
  if (!pairCodeStatus) return;
  pairCodeStatus.textContent = String(msg || '');
  pairCodeStatus.classList.toggle('warn', !!error);
}

function setPairClaimButtonBusy(busy) {
  if (!btnClaimPairCode) return;
  const label = btnClaimPairCode.querySelector('.pairClaimButtonLabel');
  const spinner = btnClaimPairCode.querySelector('.pairClaimButtonSpinner');
  btnClaimPairCode.disabled = !!busy;
  btnClaimPairCode.setAttribute('aria-busy', busy ? 'true' : 'false');
  btnClaimPairCode.setAttribute('aria-label', busy ? 'Claiming' : 'Claim');
  label?.classList.toggle('hidden', !!busy);
  spinner?.classList.toggle('hidden', !busy);
}

function setGatewayInstallStatus(msg, error = false) {
  const text = String(msg || '').trim();
  if (!text) return;
  addNotification(error ? 'bad' : 'neutral', 'Gateway service update', text);
}

function randomOpaqueId(prefix = 'id') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${token}`;
}

function relayWorkerScriptUrl() {
  const url = new URL('./relay.worker.js', window.location.href);
  url.searchParams.set('v', SHELL_BUILD_ID);
  return url.toString();
}

function browserPrefersDedicatedRelayWorker() {
  try {
    const ua = String(navigator.userAgent || '');
    return typeof SharedWorker === 'undefined' || /\bFirefox\//.test(ua);
  } catch {
    return typeof SharedWorker === 'undefined';
  }
}

function runtimeWorkerScriptUrl() {
  return accountRuntimeWorkerScriptUrl(window.location.origin);
}

function managedAppSurfaceCandidates(repoName) {
  const repo = String(repoName || '').trim();
  if (!repo) throw new Error('missing managed app repo');
  const target = new URL(window.location.origin);
  const primary = new URL(target);
  primary.pathname = `/${repo}/`;
  return [primary];
}

function managedSurfaceLooksBuilt(html) {
  const body = String(html || '');
  if (!body) return false;
  if (body.includes('/src/main.ts') || body.includes('./src/main.ts')) return false;
  return body.includes('/assets/') || body.includes('./assets/');
}

const managedAppSurfaceBaseUrlCache = new Map();

async function resolveManagedAppSurfaceBaseUrl(repoName) {
  const repo = String(repoName || '').trim();
  if (!repo) throw new Error('missing managed app repo');
  if (managedAppSurfaceBaseUrlCache.has(repo)) return managedAppSurfaceBaseUrlCache.get(repo);

  const promise = (async () => {
    const errors = [];
    for (const candidate of managedAppSurfaceCandidates(repo)) {
      try {
        const res = await fetch(candidate.toString(), {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'text/html' },
        });
        if (!res.ok) {
          errors.push(`${candidate.pathname} -> ${res.status}`);
          continue;
        }
        const html = await res.text();
        if (!managedSurfaceLooksBuilt(html)) {
          errors.push(`${candidate.pathname} -> source entrypoint`);
          continue;
        }
        return candidate;
      } catch (err) {
        errors.push(`${candidate.pathname} -> ${String(err?.message || err)}`);
      }
    }
    throw new Error(`surface_load: no built app surface found for ${repo} (${errors.join('; ') || 'no candidates'})`);
  })();

  managedAppSurfaceBaseUrlCache.set(repo, promise);
  try {
    return await promise;
  } catch (err) {
    managedAppSurfaceBaseUrlCache.delete(repo);
    throw err;
  }
}

async function buildManagedAppSurfaceUrl(repoName, opts = {}) {
  const target = new URL(await resolveManagedAppSurfaceBaseUrl(repoName));
  const params = new URLSearchParams();
  const activity = String(opts?.activity || '').trim();
  const settingsTab = String(opts?.settingsTab || '').trim();
  const camera = String(opts?.camera || '').trim();
  if (activity) params.set('activity', activity);
  if (settingsTab) params.set('settings', settingsTab);
  if (camera) params.set('camera', camera);
  target.hash = params.toString();
  return target.toString();
}

function settlePending(map, requestId, error, result) {
  const key = String(requestId || '').trim();
  if (!key) return false;
  const pending = map.get(key);
  if (!pending) return false;
  clearTimeout(pending.timer);
  map.delete(key);
  if (error) pending.reject(error);
  else pending.resolve(result);
  return true;
}

function createPendingRequest(map, requestId, label, timeoutMs = 20_000) {
  const key = String(requestId || '').trim();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(key);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    map.set(key, { resolve, reject, timer, createdAt: Date.now() });
  });
}

function observePendingRequest(promise) {
  const state = {
    error: null,
    promise: Promise.resolve(promise).catch((error) => {
      state.error = error;
      return undefined;
    }),
  };
  return state;
}

async function awaitObservedPendingRequest(state) {
  const result = await state.promise;
  if (state.error) throw state.error;
  return result;
}

function managedAppSurfaceRepoForService(service) {
  const key = normalizeRole(service || '');
  return MANAGED_APP_SURFACES[key] || '';
}

function isManagedFirstPartyApp(app) {
  const repo = String(app?.repo || '').trim().toLowerCase();
  return Object.values(MANAGED_APP_SURFACES).some((value) => value.toLowerCase() === repo);
}

function readRuntimeKvRecord(key) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };
    const timer = window.setTimeout(() => finish(null), 1_500);
    try {
      const req = indexedDB.open('constitute_db', 1);
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction('kv', 'readonly');
          const get = tx.objectStore('kv').get(key);
          get.onsuccess = () => {
            window.clearTimeout(timer);
            finish(get.result || null);
          };
          get.onerror = () => {
            window.clearTimeout(timer);
            finish(null);
          };
        } catch {
          window.clearTimeout(timer);
          finish(null);
        }
      };
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

async function pushRuntimeAuthorityDevice() {
  if (!runtimeBridge?.putRuntimeAuthorityDevice) return;
  const device = await readRuntimeKvRecord('device');
  const pk = String(device?.nostr?.pk || '').trim();
  const skHex = String(device?.nostr?.skHex || '').trim();
  if (!pk || !skHex) return;
  if (runtimeAuthorityDevicePk === pk) return;
  runtimeAuthorityDevicePk = pk;
  await runtimeBridge.putRuntimeAuthorityDevice(device);
}

function selectedRuntimeRunnerBridgeModule() {
  const refs = Array.isArray(accountSurfaceAttachContext?.moduleRefs)
    ? accountSurfaceAttachContext.moduleRefs
    : [];
  return refs.find((module) => String(module?.role || '').trim() === 'runtimeRunnerBridge') || null;
}

function runtimeRunnerDispatchAdapter() {
  const registration = globalThis.constituteRuntimeRunnerBridge && typeof globalThis.constituteRuntimeRunnerBridge === 'object'
    ? globalThis.constituteRuntimeRunnerBridge
    : null;
  const host = registration ? registration.fulfillDispatch : null;
  const direct = globalThis.constituteRuntimeRunnerFulfillDispatch || globalThis.__constituteRuntimeRunnerFulfillDispatch;
  if (typeof host === 'function') {
    return {
      fulfillDispatch: host,
      adapterRef: String(registration.adapterRef || 'adapter:runtime-runner-bridge:host-selected'),
      safeFacts: registration.safeFacts && typeof registration.safeFacts === 'object'
        ? registration.safeFacts
        : {},
    };
  }
  if (typeof direct === 'function') {
    return {
      fulfillDispatch: direct,
      adapterRef: 'adapter:runtime-runner-bridge:direct-global',
      safeFacts: {},
    };
  }
  return null;
}

function acceptedRuntimeRunnerDispatches(snapshot) {
  const entries = snapshot?.runnerOperations && typeof snapshot.runnerOperations === 'object'
    ? Object.values(snapshot.runnerOperations)
    : [];
  const seen = new Set();
  return entries.filter((entry) => {
    const operationId = String(entry?.operationId || entry?.runnerOperation?.operationId || '').trim();
    const state = String(entry?.state || entry?.hostFulfillmentPosture?.state || '').trim();
    if (!operationId || seen.has(operationId) || state !== 'accepted') return false;
    seen.add(operationId);
    return true;
  });
}

function runtimeRunnerBridgePostureStableKey(posture) {
  return JSON.stringify([
    String(posture?.bridgeRef || ''),
    String(posture?.state || ''),
    String(posture?.dispatchId || ''),
    String(posture?.operationId || ''),
    Number(posture?.fulfilledCount || 0),
    Number(posture?.skippedCount || 0),
    ...(Array.isArray(posture?.blockedReasons) ? posture.blockedReasons : []),
  ]);
}

function putRuntimeRunnerBridgePostureOnce(bridge, posture) {
  const key = runtimeRunnerBridgePostureStableKey(posture);
  if (!key || key === runtimeRunnerBridgePostureKey) return;
  runtimeRunnerBridgePostureKey = key;
  bridge.putRuntimeRunnerBridgePosture(posture).catch((err) => {
    console.warn('[runtime] runner bridge posture failed', err);
  });
}

function startRuntimeRunnerBridge(bridge, runtimeClient) {
  const selectedModule = selectedRuntimeRunnerBridgeModule();
  const createRuntimeRunnerBridge = accountRuntimeRunnerBridgeModule?.createRuntimeRunnerBridge;
  if (!selectedModule || typeof createRuntimeRunnerBridge !== 'function') return null;
  const bridgeRef = String(selectedModule.moduleRef || 'constitute-ui/runtime-runner-bridge@0.1.0');
  return createRuntimeRunnerBridge({
    runtimeClient,
    bridgeRef,
    runtimeRef: `runtime:${PLATFORM_RUNTIME_BUILD_ID}`,
    adapterRef: 'adapter:runtime-runner-bridge:host-selected',
    fulfillDispatch: async (context) => {
      const adapter = runtimeRunnerDispatchAdapter();
      if (!adapter) throw new Error('host runner adapter is not registered');
      return await adapter.fulfillDispatch(context);
    },
    onPosture: (posture) => {
      const adapter = runtimeRunnerDispatchAdapter();
      putRuntimeRunnerBridgePostureOnce(bridge, {
        ...posture,
        adapterRef: adapter?.adapterRef || posture.adapterRef,
        safeFacts: {
          ...(posture.safeFacts && typeof posture.safeFacts === 'object' ? posture.safeFacts : {}),
          ...(adapter?.safeFacts && typeof adapter.safeFacts === 'object' ? adapter.safeFacts : {}),
          hostAdapterRegistered: Boolean(adapter),
        },
      });
    },
  });
}

function observeRuntimeRunnerBridgeSnapshot(bridge, snapshot) {
  if (!runtimeRunnerBridge) return;
  const dispatches = acceptedRuntimeRunnerDispatches(snapshot);
  const adapter = runtimeRunnerDispatchAdapter();
  if (!adapter) {
    putRuntimeRunnerBridgePostureOnce(bridge, {
      kind: 'runtime.runner.bridge.posture',
      state: dispatches.length ? 'blocked' : 'idle',
      bridgeRef: String(selectedRuntimeRunnerBridgeModule()?.moduleRef || 'constitute-ui/runtime-runner-bridge@0.1.0'),
      runtimeRef: `runtime:${PLATFORM_RUNTIME_BUILD_ID}`,
      adapterRef: 'adapter:runtime-runner-bridge:host-selected',
      skippedCount: dispatches.length,
      blockedReasons: dispatches.length ? ['runtimeRunnerBridge:hostAdapterMissing'] : [],
      safeFacts: { hostAdapterRegistered: false },
      observedAt: Date.now(),
    });
    return;
  }
  runtimeRunnerBridge.processSnapshot(snapshot).catch((err) => {
    putRuntimeRunnerBridgePostureOnce(bridge, {
      kind: 'runtime.runner.bridge.posture',
      state: 'blocked',
      bridgeRef: String(selectedRuntimeRunnerBridgeModule()?.moduleRef || 'constitute-ui/runtime-runner-bridge@0.1.0'),
      runtimeRef: `runtime:${PLATFORM_RUNTIME_BUILD_ID}`,
      adapterRef: 'adapter:runtime-runner-bridge:host-selected',
      blockedReasons: [`runtimeRunnerBridge:${String(err?.message || err || 'failed')}`],
      observedAt: Date.now(),
    });
  });
}

function startPlatformRuntimeBridge() {
  if (typeof SharedWorker === 'undefined') {
    console.warn('[runtime] SharedWorker unavailable; managed app surfaces require the shared runtime');
    return null;
  }

  const clientId = randomOpaqueId('runtime-shell');
  const bridge = {
    clientId,
    port: null,
    client: null,
    snapshot: null,
    ready: false,
    readyPromise: null,
    resolveReady: null,
    rejectReady: null,
    attachTimedOut: false,
    attachError: null,
    close() {
      try { this.client?.close?.(); } catch {}
      if (runtimeRunnerBridge) runtimeRunnerBridge = null;
    },
  };
  bridge.readyPromise = new Promise((resolve, reject) => {
    bridge.resolveReady = resolve;
    bridge.rejectReady = reject;
  });
  bridge.whenReady = async (timeoutMs = RUNTIME_ATTACH_TIMEOUT_MS) => {
    if (bridge.ready) return bridge.snapshot;
    try {
      return await Promise.race([
        bridge.readyPromise,
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('runtime.attach timed out')), timeoutMs);
        }),
      ]);
    } catch (err) {
      bridge.attachTimedOut = true;
      bridge.attachError = err;
      throw err;
    }
  };

  bridge.whenReadyQuietly = async (timeoutMs = 1000) => {
    if (bridge.ready) return true;
    if (bridge.attachTimedOut) return false;
    try {
      await bridge.whenReady(timeoutMs);
      return bridge.ready;
    } catch {
      return false;
    }
  };

  const runtimeWriteWarnings = new Map();
  function warnRuntimeWriteFailure(key, err) {
    const now = Date.now();
    const prior = runtimeWriteWarnings.get(key) || { count: 0, lastAt: 0 };
    const next = { count: prior.count + 1, lastAt: now };
    runtimeWriteWarnings.set(key, next);
    if (now - prior.lastAt < 30_000) return;
    const suffix = next.count > 1 ? ` (${next.count} recent failures)` : '';
    console.warn(`[runtime] ${key} failed${suffix}`, err);
  }

  function runtimeCall(type, payload = {}, timeoutMs = 20_000) {
    return bridge.client?.call(type, payload, timeoutMs)
      || Promise.reject(new Error('shared runtime is unavailable'));
  }

  bridge.call = runtimeCall;
  bridge.submitRunnerOperation = async (runnerOperation, timeoutMs = RUNTIME_WRITE_TIMEOUT_MS) => {
    await bridge.whenReady();
    return await runtimeCall(RUNTIME_RUNNER_OPERATION_SUBMIT, { runnerOperation }, timeoutMs);
  };
  bridge.putRunnerHostFulfillmentPosture = async (
    hostFulfillmentPosture,
    runtimeReportMessageOrTimeoutMs = null,
    sourceDispatch = null,
    timeoutMs = RUNTIME_WRITE_TIMEOUT_MS,
  ) => {
    await bridge.whenReady();
    const runtimeReportMessage = runtimeReportMessageOrTimeoutMs
      && typeof runtimeReportMessageOrTimeoutMs === 'object'
      && !Array.isArray(runtimeReportMessageOrTimeoutMs)
      ? runtimeReportMessageOrTimeoutMs
      : null;
    const finalTimeoutMs = runtimeReportMessage ? timeoutMs : (runtimeReportMessageOrTimeoutMs || RUNTIME_WRITE_TIMEOUT_MS);
    return await runtimeCall(RUNTIME_RUNNER_HOST_FULFILLMENT_PUT, {
      hostFulfillmentPosture,
      ...(runtimeReportMessage ? { runtimeReportMessage } : {}),
      ...(sourceDispatch && typeof sourceDispatch === 'object' ? { sourceDispatch } : {}),
    }, finalTimeoutMs);
  };
  bridge.putRuntimeRunnerBridgePosture = async (posture, timeoutMs = RUNTIME_WRITE_TIMEOUT_MS) => {
    await bridge.whenReady();
    return await runtimeCall(RUNTIME_RUNNER_BRIDGE_POSTURE_PUT, { posture }, timeoutMs);
  };
  bridge.queueAppIntent = async (type, payload = {}, timeoutMs = RUNTIME_WRITE_TIMEOUT_MS) => {
    await bridge.whenReady();
    return await runtimeCall(type, { payload }, timeoutMs);
  };
  bridge.openStream = async (payload = {}) => {
    return await bridge.queueAppIntent(RUNTIME_STREAM_OPEN, payload);
  };
  bridge.controlStream = async (payload = {}) => {
    return await bridge.queueAppIntent(RUNTIME_STREAM_CONTROL, payload);
  };
  bridge.closeStream = async (payload = {}) => {
    return await bridge.queueAppIntent(RUNTIME_STREAM_CLOSE, payload);
  };
  bridge.attachSwarmEdge = async (payload = {}) => {
    await bridge.whenReady();
    return await runtimeCall(SWARM_EDGE_ATTACH, payload, RUNTIME_WRITE_TIMEOUT_MS);
  };
  bridge.pushStatus = async (status) => {
    if (!(await bridge.whenReadyQuietly())) return;
    await runtimeCall('runtime.status.put', { role: 'shell', status }, RUNTIME_WRITE_TIMEOUT_MS).catch((err) => {
      warnRuntimeWriteFailure('runtime.status.put', err);
    });
  };
  bridge.putManagedApplianceSourceSnapshot = async (sourceSnapshot) => {
    if (!(await bridge.whenReadyQuietly())) return;
    await runtimeCall('managedAppliances.sourceSnapshot.put', { sourceSnapshot }, RUNTIME_WRITE_TIMEOUT_MS).catch((err) => {
      warnRuntimeWriteFailure('managedAppliances.sourceSnapshot.put', err);
    });
  };
  bridge.putRuntimeAuthorityDevice = async (device) => {
    if (!(await bridge.whenReadyQuietly())) return;
    await runtimeCall(RUNTIME_AUTHORITY_DEVICE_PUT, { device }, RUNTIME_WRITE_TIMEOUT_MS).catch((err) => {
      runtimeAuthorityDevicePk = '';
      warnRuntimeWriteFailure(RUNTIME_AUTHORITY_DEVICE_PUT, err);
    });
  };

  function absorbBridgeRuntimeSnapshot(snapshot) {
    runtimeAttached = true;
    bridge.ready = true;
    bridge.attachTimedOut = false;
    bridge.attachError = null;
    bridge.snapshot = snapshot || null;
    absorbRuntimeSnapshot(snapshot || null);
    lastManagedServiceIssue = runtimeStatusSnapshot?.managedServiceIssue || null;
    bridge.resolveReady?.(bridge.snapshot);
    bridge.resolveReady = null;
    bridge.rejectReady = null;
    renderConnectionModel();
    pushRuntimeAuthorityDevice().catch(() => {});
    pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices || []);
    observeRuntimeRunnerBridgeSnapshot(bridge, bridge.snapshot);
    clearShellBootFallbackTimer();
    tryDismissShellBootSplash('shell.first-paint.snapshot');
  }

  function handleBridgeRuntimeMessage(msg) {
    if (runtimeDiagnosticsAgent?.handleMessage(msg)) return true;
    if (msg.type === 'runtime.attached' || msg.type === 'runtime.snapshot') return false;
    if (msg.type === 'runtime.broker.request') {
      handleRuntimeBrokerRequest(msg).catch((err) => {
        const kind = String(msg?.kind || '').trim();
        const responseTypes = {
          'gateway.grant.request': 'gateway.grant.response',
          'gateway.service.install.request': 'gateway.service.install.response',
          'gateway.zones.sync.request': 'gateway.zones.sync.response',
        };
        const responseType = responseTypes[kind] || 'runtime.broker.response';
        bridge.port?.postMessage({
          type: responseType,
          clientId,
          requestId: String(msg?.requestId || '').trim(),
          ok: false,
          error: String(err?.message || err),
        });
      });
      return true;
    }
    if (msg.type === 'runtime.ack') {
      if (msg.ok === false) {
        console.warn('[runtime]', String(msg.kind || '').trim() || 'ack', String(msg.error || 'failed'));
      }
      return true;
    }
    return false;
  }

  const runtimeClient = accountRuntimeClientModule.createRuntimeSurfaceClient({
    clientId,
    surface: 'shell',
    broker: true,
    workerUrl: runtimeWorkerScriptUrl(),
    workerName: runtimeSharedWorkerName(),
    attachTimeoutMs: RUNTIME_ATTACH_TIMEOUT_MS,
    callTimeoutMs: RUNTIME_WRITE_TIMEOUT_MS,
    attachContext: accountSurfaceAttachContext,
    onPort: (port) => {
      bridge.port = port;
      runtimeDiagnosticsAgent = attachRuntimeDiagnostics({
        port,
        surface: 'constitute-account',
        clientId,
        enabled: shellBootDebugEnabled,
        planes: RUNTIME_DIAGNOSTIC_OPERATOR_PLANES,
        minLevelByPlane: { diagnostic: 'warn' },
        denyKinds: ['projection.applied', 'projection.ignored'],
      });
    },
    onMessage: handleBridgeRuntimeMessage,
    onSnapshot: absorbBridgeRuntimeSnapshot,
    onMaterializationBudget: (budget) => {
      runtimeSnapshotMaterializationBudget = budget && typeof budget === 'object' ? budget : null;
    },
    onConsumerFloor: (floor) => {
      runtimeSnapshotConsumerFloor = floor && typeof floor === 'object' ? floor : null;
    },
    onMaterializationPosture: (posture) => {
      runtimeSnapshotMaterializationPosture = posture && typeof posture === 'object' ? posture : null;
    },
    onAttachTimeout: () => {
      bridge.attachTimedOut = true;
      bridge.attachError = new Error('runtime.attach timed out');
      bridge.rejectReady?.(bridge.attachError);
      bridge.rejectReady = null;
      bridge.resolveReady = null;
    },
    onAttachPosture: (posture) => {
      if (!posture || posture.severity === 'info') return;
      if (!runtimeAttachWarningLogged) {
        runtimeAttachWarningLogged = true;
        console.info('[runtime] SharedWorker attach fallback', {
          state: posture.state,
          severity: posture.severity,
          reason: posture.reason,
        });
      }
    },
    onAttachError: (err) => {
      bridge.attachTimedOut = true;
      bridge.attachError = err;
      bridge.resolveReady?.(null);
      bridge.resolveReady = null;
      bridge.rejectReady = null;
    },
    onWorkerError: (event) => {
      const error = new Error(String(event?.message || 'shared worker failure'));
      bridge.attachTimedOut = true;
      bridge.attachError = error;
      bridge.resolveReady?.(null);
      bridge.resolveReady = null;
      bridge.rejectReady = null;
    },
  });
  bridge.client = runtimeClient;
  runtimeRunnerBridge = startRuntimeRunnerBridge(bridge, runtimeClient);
  const port = runtimeClient.attach();
  if (!port) return null;
  bridge.port = port;
  return bridge;
}

async function handleRuntimeBrokerRequest(message) {
  const kind = String(message?.kind || '').trim();
  const requestId = String(message?.requestId || '').trim();
  if (!runtimeBridge || !requestId || !kind) return;
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
  if (kind === 'gateway.grant.request') {
    const record = {
      devicePk: String(payload?.servicePk || '').trim(),
      hostGatewayPk: String(payload?.gatewayPk || '').trim(),
      service: String(payload?.service || 'nvr').trim() || 'nvr',
    };
    const result = await requestGatewayGrantAction(record, {
      action: String(payload?.action || '').trim(),
      granteeIdentityId: String(payload?.granteeIdentityId || '').trim(),
      grantId: String(payload?.grantId || '').trim(),
      viewSources: Array.isArray(payload?.viewSources) ? payload.viewSources : [],
      controlSources: Array.isArray(payload?.controlSources) ? payload.controlSources : [],
    });
    runtimeBridge.port.postMessage({
      type: 'gateway.grant.response',
      clientId: runtimeBridge.clientId,
      requestId,
      ok: true,
      result,
    });
    return;
  }
  if (kind === 'gateway.service.install.request') {
    const result = await requestRemoteNvrInstall(payload.record || payload);
    runtimeBridge.port.postMessage({
      type: 'gateway.service.install.response',
      clientId: runtimeBridge.clientId,
      requestId,
      ok: true,
      result,
    });
    return;
  }
  if (kind === 'gateway.zones.sync.request') {
    const result = await requestGatewayZoneSync(payload.record || payload, Array.isArray(payload?.extraZoneKeys) ? payload.extraZoneKeys : []);
    runtimeBridge.port.postMessage({
      type: 'gateway.zones.sync.response',
      clientId: runtimeBridge.clientId,
      requestId,
      ok: true,
      result,
    });
    return;
  }
  throw new Error(`unsupported broker request: ${kind}`);
}

function summarizeInstallDetail(detail) {
  const raw = String(detail || '').trim();
  if (!raw) return '';
  return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
}

function handleGatewayServiceInstallStatusEvent(evt) {
  const requestId = String(evt?.requestId || '').trim();
  const status = String(evt?.status || '').trim().toLowerCase();
  const gatewayPk = String(evt?.gatewayPk || '').trim();
  const reason = String(evt?.reason || '').trim();
  const detail = summarizeInstallDetail(evt?.detail || '');

  const meta = pendingGatewayServiceInstalls.get(requestId) || null;
  const target = meta?.gatewayPk || gatewayPk || 'gateway';

  const base = `NVR install ${status || 'update'} for ${target.slice(0, 12)}...`;
  const reasonPart = reason ? ` (${reason})` : '';
  const detailPart = detail ? ` — ${detail}` : '';

  const isError = status === 'failed' || status === 'rejected';
  setGatewayInstallStatus(`${base}${reasonPart}${detailPart}`, isError);

  if (status === 'complete' || status === 'failed' || status === 'rejected') {
    if (requestId) pendingGatewayServiceInstalls.delete(requestId);
  }

  if (status === 'complete') {
    refreshAll().catch(() => {});
  }
}

function handleGatewayZoneSyncStatusEvent(evt) {
  const requestId = String(evt?.requestId || '').trim();
  const status = String(evt?.status || '').trim().toLowerCase();
  const gatewayPk = String(evt?.gatewayPk || '').trim();
  const reason = String(evt?.reason || '').trim();
  const detail = summarizeInstallDetail(evt?.detail || '');

  const meta = pendingGatewayZoneSyncs.get(requestId) || null;
  const target = meta?.gatewayPk || gatewayPk || 'gateway';

  const base = `Gateway zone sync ${status || 'update'} for ${target.slice(0, 12)}...`;
  const reasonPart = reason ? ` (${reason})` : '';
  const detailPart = detail ? ` — ${detail}` : '';

  const isError = status === 'failed' || status === 'rejected';
  setGatewayInstallStatus(`${base}${reasonPart}${detailPart}`, isError);

  if (status === 'complete' || status === 'failed' || status === 'rejected') {
    if (requestId) pendingGatewayZoneSyncs.delete(requestId);
  }

  if (status === 'complete') {
    refreshAll().catch(() => {});
  }
}

function handleGatewayGrantStatusEvent(evt) {
  const requestId = String(evt?.requestId || '').trim();
  const status = String(evt?.status || '').trim().toLowerCase();
  if (!requestId) return;

  if (status === 'failed' || status === 'rejected') {
    const detail = String(evt?.detail || evt?.reason || 'gateway grant request failed').trim();
    settlePending(pendingGatewayGrantRequests, requestId, new Error(detail || 'gateway grant request failed'));
    if (evt?.action && evt?.action !== 'list_shared' && evt?.action !== 'list_grants') {
      setGatewayInstallStatus(`Sharing ${String(evt.action)} failed: ${detail || 'request rejected'}`, true);
    }
    return;
  }

  if (status === 'complete') {
    const result = {
      requestId,
      gatewayPk: String(evt?.gatewayPk || '').trim(),
      servicePk: String(evt?.servicePk || '').trim(),
      service: String(evt?.service || '').trim(),
      action: String(evt?.action || '').trim().toLowerCase(),
      grant: evt?.grant ?? null,
      grants: Array.isArray(evt?.grants) ? evt.grants : [],
      sharedResources: Array.isArray(evt?.sharedResources) ? evt.sharedResources : [],
      availableCameras: Array.isArray(evt?.availableCameras) ? evt.availableCameras : [],
      ts: Number(evt?.ts || Date.now()),
    };
    settlePending(pendingGatewayGrantRequests, requestId, null, result);
    if (result.action && result.action !== 'list_shared' && result.action !== 'list_grants') {
      invalidateGatewayGrantViewCache({
        hostGatewayPk: result.gatewayPk,
        servicePk: result.servicePk,
        service: result.service,
      });
    }

    if (result.action === 'upsert') {
      const grantee = String(result?.grant?.granteeIdentityId || '').trim();
      setGatewayInstallStatus(`Shared Security Cameras${grantee ? ` with ${grantee}` : ''}.`, false);
    } else if (result.action === 'revoke') {
      const grantee = String(result?.grant?.granteeIdentityId || '').trim();
      setGatewayInstallStatus(`Revoked Security Cameras access${grantee ? ` for ${grantee}` : ''}.`, false);
    }
  }
}

function parseGatewayPayloadCandidate(value) {
  if (!value || typeof value !== 'object') return null;
  const directType = String(value.type || value.kind || '').trim();
  if (directType.startsWith('gateway_')) {
    return {
      ...value,
      type: directType,
    };
  }
  const nestedRecordContent = value?.record?.content;
  if (typeof nestedRecordContent === 'string' && nestedRecordContent) {
    try {
      return parseGatewayPayloadCandidate(JSON.parse(nestedRecordContent));
    } catch {}
  }
  const nestedContent = value?.content;
  if (typeof nestedContent === 'string' && nestedContent) {
    try {
      return parseGatewayPayloadCandidate(JSON.parse(nestedContent));
    } catch {}
  }
  return null;
}

function relayPayloadTargetsCurrentDevice(payload) {
  const localPk = String(lastDeviceState?.pk || '').trim();
  if (!localPk) return true;
  const devicePk = String(payload?.devicePk || '').trim();
  const toDevicePk = String(payload?.toDevicePk || '').trim();
  if (devicePk && devicePk === localPk) return true;
  if (toDevicePk && toDevicePk === localPk) return true;
  if (!devicePk && !toDevicePk) return true;
  return false;
}

function parseGatewayRelayPayload(frame) {
  if (typeof frame !== 'string' || !frame) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return null;
  const event = parsed[2];
  if (!event || typeof event !== 'object') return null;
  let outerPayload = null;
  try {
    outerPayload = JSON.parse(String(event.content || ''));
  } catch {
    return null;
  }
  const payload = parseGatewayPayloadCandidate(outerPayload);
  if (!payload) return null;
  if (!relayPayloadTargetsCurrentDevice(payload)) return null;
  return payload;
}

function handleGatewayRelayPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const type = String(payload.type || '').trim();
  if (!type) return false;
  if (type === 'gateway_grant_status') {
    handleGatewayGrantStatusEvent(payload);
    return true;
  }
  return false;
}

function parseUdpPeer(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  let candidate = raw;
  if (candidate.startsWith('udp://')) {
    candidate = candidate.slice('udp://'.length);
  }
  if (!candidate.includes(':')) return '';
  return candidate;
}

function gatewayDirectoryEntryForRecord(record) {
  const pk = String(record?.devicePk || record?.pk || '').trim();
  if (!pk) return null;
  const directory = Array.isArray(lastDirectory) ? lastDirectory : [];
  return directory.find((entry) => String(entry?.devicePk || '').trim() === pk) || null;
}

function gatewaySwarmPeerForRecord(record) {
  const hit = gatewayDirectoryEntryForRecord(record);
  if (!hit) return '';
  return parseUdpPeer(hit?.swarm || '');
}

function installZoneKeys() {
  const preferred = String(activeZoneKey || '').trim();
  const zones = Array.isArray(lastZones) ? lastZones : [];
  const keys = [];
  if (preferred) keys.push(preferred);
  for (const zone of zones) {
    const key = String(zone?.key || '').trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function loadGatewayExtraZones() {
  try {
    const raw = localStorage.getItem(GATEWAY_EXTRA_ZONES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    gatewayExtraZonesByPk = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    gatewayExtraZonesByPk = {};
  }
}

function saveGatewayExtraZones() {
  try {
    localStorage.setItem(GATEWAY_EXTRA_ZONES_KEY, JSON.stringify(gatewayExtraZonesByPk || {}));
  } catch {}
}

function parseZoneKeyList(input) {
  const values = String(input || '')
    .split(/[\s,]+/)
    .map((v) => normalizeZoneKey(v))
    .filter(Boolean);
  const keys = [];
  for (const key of values) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function gatewayExtraZonesForPk(pk) {
  const key = String(pk || '').trim();
  if (!key) return [];
  const value = gatewayExtraZonesByPk?.[key];
  if (!Array.isArray(value)) return [];
  return parseZoneKeyList(value.join(' '));
}

function setGatewayExtraZonesForPk(pk, zones) {
  const key = String(pk || '').trim();
  if (!key) return;
  const clean = parseZoneKeyList((Array.isArray(zones) ? zones : []).join(' '));
  if (clean.length === 0) {
    delete gatewayExtraZonesByPk[key];
  } else {
    gatewayExtraZonesByPk[key] = clean;
  }
  saveGatewayExtraZones();
}

async function prepareInstallEnrollment(target = 'device') {
  const kind = String(target || 'device').trim().toLowerCase() || 'device';
  const method = kind === 'gateway' ? 'pairing.prepareGatewayInstall' : 'pairing.prepareInstall';
  const res = await client.call(method, { target: kind }, { timeoutMs: 20000 });

  const identityLabel = String(res?.identityLabel || '').trim();
  const code = String(res?.code || '').trim();
  const codeHash = String(res?.codeHash || '').trim();
  const expiresAt = Number(res?.expiresAt || 0);

  if (!identityLabel || !code || !codeHash) {
    throw new Error('pairing bootstrap did not return complete material');
  }

  return {
    target: kind,
    identityLabel,
    code,
    codeHash,
    expiresAt,
    autoApprove: Boolean(res?.autoApprove),
    claimId: String(res?.claimId || '').trim(),
  };
}

async function prepareNvrInstallContext(record) {
  const identityId = String(lastIdentity?.id || '').trim();
  if (!identityId || !String(lastIdentity?.label || '').trim()) {
    throw new Error('link an identity before installing NVR');
  }

  const gatewayHostPlatform = normalizeRole(record?.hostPlatform || record?.host_platform || record?.platform || '');
  if (gatewayHostPlatform && gatewayHostPlatform !== 'linux' && gatewayHostPlatform !== 'fcos') {
    throw new Error('selected gateway host platform does not support NVR service installation');
  }

  const gatewayPeer = gatewaySwarmPeerForRecord(record);
  if (!gatewayPeer) throw new Error('gateway endpoint not discovered yet (wait for zone presence)');

  const zones = installZoneKeys();
  if (zones.length === 0) throw new Error('join a zone before installing NVR');

  const enrollment = await prepareInstallEnrollment('nvr');

  const gatewayHost = gatewayPeer.split(':')[0];
  const swarmEdgeEndpoint = gatewayHost ? `ws://${gatewayHost}:7448` : 'ws://127.0.0.1:7448';

  return {
    enrollment,
    gatewayPeer,
    swarmEdgeEndpoint,
    zones,
  };
}

function gatewayEdgeEndpointForRecord(record) {
  const explicit = String(
    record?.swarmEdgeEndpoint
    || record?.swarm_edge_endpoint
    || record?.edgeStreamEndpoint
    || record?.edge_stream_endpoint
    || record?.swarmEdge?.endpoint
    || '',
  ).trim();
  if (explicit) return explicit;
  const directoryEntry = gatewayDirectoryEntryForRecord(record);
  const directoryExplicit = String(
    directoryEntry?.swarmEdgeEndpoint
    || directoryEntry?.swarm_edge_endpoint
    || directoryEntry?.edgeStreamEndpoint
    || directoryEntry?.edge_stream_endpoint
    || directoryEntry?.swarmEdge?.endpoint
    || '',
  ).trim();
  if (directoryExplicit) return directoryExplicit;
  const peer = gatewaySwarmPeerForRecord(record);
  if (!peer) return '';
  const host = peer.startsWith('[')
    ? peer.slice(0, peer.indexOf(']') + 1)
    : peer.split(':')[0];
  return host ? `ws://${host}:7448` : '';
}

function normalizeSwarmEdgeZoneScope(value) {
  if (!value) return null;
  const source = (typeof value === 'object') ? value : { zoneId: value };
  const zoneId = String(
    source.zoneId
    || source.zone_id
    || source.zone
    || source.zoneKey
    || source.zone_key
    || source.key
    || '',
  ).trim();
  if (!zoneId || zoneId.startsWith('identity:')) return null;
  const ttl = Number(source.ttl || source.ttlSeconds || source.ttl_seconds || 30);
  const maxHops = Number(source.maxHops || source.max_hops || 2);
  return {
    zoneId,
    privacy: String(source.privacy || 'rawIds').trim() || 'rawIds',
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 30,
    maxHops: Number.isFinite(maxHops) && maxHops >= 0 ? maxHops : 2,
  };
}

function zoneScopeFromGatewayHostedServices(record) {
  const hostedServices = Array.isArray(record?.hostedServices || record?.hosted_services)
    ? (record.hostedServices || record.hosted_services)
    : [];
  for (const hosted of hostedServices) {
    const facts = hosted?.facts && typeof hosted.facts === 'object' ? hosted.facts : {};
    const health = hosted?.health && typeof hosted.health === 'object' ? hosted.health : {};
    const scope = normalizeSwarmEdgeZoneScope(hosted?.zoneScope || hosted?.zone_scope)
      || normalizeSwarmEdgeZoneScope(facts.zoneScope || facts.zone_scope)
      || normalizeSwarmEdgeZoneScope(health.zoneScope || health.zone_scope)
      || normalizeSwarmEdgeZoneScope(hosted?.zone || hosted?.zoneKey || hosted?.zone_key);
    if (scope) return scope;
  }
  return null;
}

function swarmEdgeAttachZoneScopeForGateway(record) {
  const directoryEntry = gatewayDirectoryEntryForRecord(record);
  return normalizeSwarmEdgeZoneScope(record?.zoneScope || record?.zone_scope)
    || normalizeSwarmEdgeZoneScope(directoryEntry?.zoneScope || directoryEntry?.zone_scope)
    || normalizeSwarmEdgeZoneScope(directoryEntry?.zone || directoryEntry?.zoneKey || directoryEntry?.zone_key)
    || zoneScopeFromGatewayHostedServices(record)
    || normalizeSwarmEdgeZoneScope(activeZoneKey)
    || { zoneId: 'default', privacy: 'rawIds', ttl: 30, maxHops: 2 };
}

function runtimeEdgeMemberRef() {
  const candidates = [
    runtimeAuthorityDevicePk,
    lastDeviceState?.pk,
    lastDeviceState?.devicePk,
  ];
  for (const candidate of candidates) {
    const ref = String(candidate || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(ref)) return ref;
  }
  return '';
}

async function attachRuntimeSwarmEdgeIfAvailable() {
  if (accountBridgeMode) return;
  if (!runtimeBridge?.attachSwarmEdge) return;
  const gateway = bestSwarmEdgeGatewayRecord() || freshestOwnedGatewayRecord();
  const edgeEndpoint = gatewayEdgeEndpointForRecord(gateway);
  if (!edgeEndpoint) return;
  const memberRef = runtimeEdgeMemberRef();
  if (!memberRef) return;
  const zoneScope = swarmEdgeAttachZoneScopeForGateway(gateway);
  const target = `${edgeEndpoint}|${memberRef}|${zoneScope.zoneId || ''}`;
  const edge = runtimeStatusSnapshot?.edge || {};
  const now = Date.now();
  const recentlyAttemptedSameTarget = runtimeEdgeAttachTarget === target && (now - runtimeEdgeAttachAttemptedAt) < RUNTIME_SWARM_EDGE_ATTACH_RETRY_MS;
  if (runtimeEdgeAttachTarget === target && String(edge.endpoint || '') === edgeEndpoint) {
    return;
  }
  if (runtimeEdgeAttachTarget === target && runtimeEdgeAttachBackoffUntil > now) return;
  if (recentlyAttemptedSameTarget) return;
  if (runtimeEdgeAttachInFlight === target) return;
  runtimeEdgeAttachInFlight = target;
  runtimeEdgeAttachTarget = target;
  runtimeEdgeAttachAttemptedAt = now;
  try {
    await runtimeBridge.attachSwarmEdge({ swarmEdgeEndpoint: edgeEndpoint, memberRef, zoneScope });
    runtimeEdgeAttachFailureCount = 0;
    runtimeEdgeAttachBackoffUntil = 0;
  } catch (err) {
    runtimeEdgeAttachFailureCount += 1;
    runtimeEdgeAttachBackoffUntil = Date.now() + Math.min(
      RUNTIME_SWARM_EDGE_ATTACH_MAX_RETRY_MS,
      RUNTIME_SWARM_EDGE_ATTACH_RETRY_MS * runtimeEdgeAttachFailureCount,
    );
    if (Date.now() - runtimeEdgeAttachLastWarnAt > 30_000) {
      runtimeEdgeAttachLastWarnAt = Date.now();
      console.warn('[runtime] shared edge attach failed', err);
    }
  } finally {
    if (runtimeEdgeAttachInFlight === target) runtimeEdgeAttachInFlight = null;
  }
}


async function requestGatewayZoneSync(record, extraZoneKeys = []) {
  const gatewayPk = String(record?.devicePk || record?.pk || '').trim();
  if (!gatewayPk) throw new Error('gateway device pk missing');

  const identityId = String(lastIdentity?.id || '').trim();
  if (!identityId || !String(lastIdentity?.label || '').trim()) {
    throw new Error('link an identity before syncing gateway zones');
  }

  const zoneKeys = installZoneKeys();
  if (zoneKeys.length === 0) throw new Error('join at least one zone before syncing gateway zones');

  const extraKeys = parseZoneKeyList((Array.isArray(extraZoneKeys) ? extraZoneKeys : []).join(' '));

  const payload = {
    gatewayDevicePk: gatewayPk,
    identityId,
    zone: String(zoneKeys[0] || ''),
    zoneKeys,
    extraZoneKeys: extraKeys,
  };

  const response = await client.call('gateway.zones.sync', payload, { timeoutMs: 20000 });
  const requestId = String(response?.requestId || '').trim();
  if (requestId) {
    pendingGatewayZoneSyncs.set(requestId, {
      gatewayPk,
      requestedAt: Date.now(),
      zoneKeys,
      extraZoneKeys: extraKeys,
    });
  }

  return { requestId, zoneKeys, extraZoneKeys: extraKeys };
}

async function requestRemoteNvrInstall(record) {
  const gatewayPk = String(record?.devicePk || record?.pk || '').trim();
  if (!gatewayPk) throw new Error('gateway device pk missing');

  const prepared = await prepareNvrInstallContext(record);
  const identityId = String(lastIdentity?.id || '').trim();
  if (!identityId) throw new Error('identity is not linked');

  const payload = {
    gatewayDevicePk: gatewayPk,
    service: 'nvr',
    action: 'install',
    identityId,
    pairIdentity: prepared.enrollment.identityLabel,
    pairCode: prepared.enrollment.code,
    pairCodeHash: prepared.enrollment.codeHash,
    zone: String(prepared.zones?.[0] || ''),
    zoneKeys: prepared.zones,
    authorizedDevicePks: collectAuthorizedIdentityDevicePks(),
    swarmPeers: [prepared.gatewayPeer, '127.0.0.1:4040'].filter((v, i, arr) => v && arr.indexOf(v) === i),
    swarmEdgeEndpoint: prepared.swarmEdgeEndpoint,
    allowUnsignedDebugHello: false,
    reolinkAutoprovision: true,
    timeoutSecs: 900,
  };

  const response = await client.call('gateway.service.install', payload, { timeoutMs: 20000 });
  const requestId = String(response?.requestId || '').trim();
  if (requestId) {
    pendingGatewayServiceInstalls.set(requestId, {
      gatewayPk,
      requestedAt: Date.now(),
    });
  }

  return {
    requestId,
    enrollment: prepared.enrollment,
  };
}

function findManagedServiceRecordForService(service = 'logging') {
  const targetService = String(service || 'logging').trim().toLowerCase() || 'logging';
  const records = currentManagedApplianceRecords(lastIdentity?.devices || [], lastSwarmDevices || []);
  const owned = new Set([
    ...ownedPkSet(lastIdentity?.devices || []),
    ...runtimeOwnedDevicePks(),
  ]);
  const hosted = records.find((rec) => {
    if (String(rec?.service || '').trim().toLowerCase() !== targetService) return false;
    const gatewayPk = managedGatewayPkForRecord(rec);
    const servicePk = managedServicePkForRecord(rec);
    return Boolean(servicePk) && (owned.has(gatewayPk) || rec?.grantedRecord === true || rec?.sharedProjection === true);
  }) || records.find((rec) => {
    if (String(rec?.service || '').trim().toLowerCase() !== targetService) return false;
    return Boolean(managedGatewayPkForRecord(rec)) && Boolean(managedServicePkForRecord(rec));
  });
  if (hosted) return hosted;
  const projectedService = retainedProjectionServiceRecord(targetService);
  const recordWithoutServicePk = records.find((rec) => {
    if (String(rec?.service || '').trim().toLowerCase() !== targetService) return false;
    return Boolean(managedGatewayPkForRecord(rec));
  });
  if (projectedService?.servicePk && recordWithoutServicePk) {
    return {
      ...recordWithoutServicePk,
      servicePk: projectedService.servicePk,
      hostGatewayPk: managedGatewayPkForRecord(recordWithoutServicePk) || projectedService.hostGatewayPk,
      service: targetService,
    };
  }
  const gateway = freshestOwnedGatewayRecord();
  const gatewayPk = managedGatewayPkForRecord(gateway);
  if (!gatewayPk && !projectedService?.hostGatewayPk) return null;
  if (!projectedService?.servicePk) return null;
  return {
    role: targetService,
    service: targetService,
    hostGatewayPk: gatewayPk || projectedService.hostGatewayPk,
    servicePk: projectedService.servicePk,
    devicePk: `${targetService}:${gatewayPk || projectedService.hostGatewayPk}`,
    deviceLabel: projectedService.label || targetService,
    hostedSynthetic: true,
  };
}

async function discoverManagedServiceRecordForService(service = 'logging') {
  const targetService = String(service || 'logging').trim().toLowerCase() || 'logging';
  let record = findManagedServiceRecordForService(targetService);
  if (record) return record;

  const records = currentManagedApplianceRecords(lastIdentity?.devices || [], lastSwarmDevices || []);
  const owned = ownedPkSet(lastIdentity?.devices || []);
  const gatewayPks = Array.from(new Set(
    records
      .filter((rec) => isGatewayRecord(rec))
      .map((rec) => String(rec?.devicePk || rec?.pk || '').trim())
      .filter((pk) => pk && owned.has(pk)),
  ));
  if (gatewayPks.length === 0) return null;

  await Promise.all(gatewayPks.map((gatewayPk) => requestGatewayInventoryRefresh(gatewayPk, { force: true }).catch(() => false)));
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < MANAGED_SERVICE_RESOLVE_TIMEOUT_MS) {
    await refreshManagedApplianceProjection({ refreshGrantViews: false }).catch(() => []);
    record = findManagedServiceRecordForService(targetService);
    if (record) return record;
    await new Promise((resolve) => window.setTimeout(resolve, MANAGED_SERVICE_RESOLVE_POLL_MS));
  }
  return findManagedServiceRecordForService(targetService);
}

function retainedProjectionServiceRecord(service = 'logging') {
  const targetService = String(service || 'logging').trim().toLowerCase() || 'logging';
  const projections = runtimeStatusSnapshot?.projections && typeof runtimeStatusSnapshot.projections === 'object'
    ? runtimeStatusSnapshot.projections
    : {};
  for (const projection of Object.values(projections)) {
    if (!projection || typeof projection !== 'object') continue;
    if (String(projection?.service || '').trim().toLowerCase() !== targetService) continue;
    const servicePk = String(projection?.servicePk || projection?.service_pk || '').trim();
    if (!servicePk) continue;
    return {
      service: targetService,
      servicePk,
      hostGatewayPk: String(projection?.hostGatewayPk || projection?.host_gateway_pk || '').trim(),
      label: String(projection?.display?.name || projection?.displayName || projection?.label || targetService).trim(),
    };
  }
  return null;
}

function managedServiceProjectionKey(record) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const servicePk = managedServicePkForRecord(record);
  const service = String(record?.service || 'nvr').trim().toLowerCase() || 'nvr';
  return [gatewayPk, servicePk, service].filter(Boolean).join('|');
}

function managedServiceActionKey(record) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const service = String(record?.service || 'nvr').trim().toLowerCase() || 'nvr';
  return [gatewayPk, service].filter(Boolean).join('|');
}

function rerenderManagedDevices() {
  if (!lastIdentity) return;
  pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices || []);
}

function clearManagedServiceActionTimer(key) {
  const timer = managedServiceActionTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    managedServiceActionTimers.delete(key);
  }
}

function setManagedServiceActionState(record, state = null, ttlMs = 0) {
  const key = managedServiceActionKey(record);
  if (!key) return;
  clearManagedServiceActionTimer(key);
  if (!state) {
    managedServiceActionStates.delete(key);
  } else {
    managedServiceActionStates.set(key, {
      ...state,
      updatedAt: Date.now(),
    });
    if (ttlMs > 0) {
      const timer = window.setTimeout(() => {
        managedServiceActionTimers.delete(key);
        managedServiceActionStates.delete(key);
        rerenderManagedDevices();
      }, ttlMs);
      managedServiceActionTimers.set(key, timer);
    }
  }
  rerenderManagedDevices();
}

function managedServiceActionStateForRecord(record) {
  const key = managedServiceActionKey(record);
  if (!key) return null;
  return managedServiceActionStates.get(key) || null;
}

function grantedManagedServiceRecords() {
  const out = [];
  for (const records of sharedManagedServicesByGatewayPk.values()) {
    if (!Array.isArray(records)) continue;
    for (const record of records) out.push(record);
  }
  return out;
}

function getGrantInventoryForService(record) {
  const key = managedServiceProjectionKey(record);
  if (!key) return null;
  return ownedGatewayGrantInventoryByServiceKey.get(key) || null;
}

function buildGrantedManagedServiceRecord(shared, fallbackGatewayPk = '') {
  if (!shared || typeof shared !== 'object') return null;
  const gatewayPk = String(shared.gatewayPk || fallbackGatewayPk || '').trim();
  const servicePk = String(shared.servicePk || '').trim();
  if (!gatewayPk || !servicePk) return null;
  const service = String(shared.service || 'nvr').trim() || 'nvr';
  const viewSources = Array.isArray(shared.viewSources)
    ? shared.viewSources.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const controlSources = Array.isArray(shared.controlSources)
    ? shared.controlSources.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    devicePk: servicePk,
    deviceLabel: String(shared.serviceLabel || 'Security Cameras').trim() || 'Security Cameras',
    deviceKind: 'service',
    role: service,
    service,
    hostGatewayPk: gatewayPk,
    serviceVersion: String(shared.serviceVersion || '').trim(),
    updatedAt: Date.now(),
    status: String(shared.status || 'shared').trim() || 'shared',
    sharedProjection: true,
    grantedScope: {
      viewSources,
      controlSources,
      cameras: Array.isArray(shared.cameras) ? shared.cameras : [],
    },
  };
}

function shouldOwnGatewayGrantViewRefresh() {
  return !relayBridge || relayBridge.isOwner?.() === true;
}

function gatewayGrantViewRequestKey(record, opts = {}) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const servicePk = String(opts?.servicePk ?? managedServicePkForRecord(record) ?? '').trim();
  const service = String(opts?.service || record?.service || 'nvr').trim() || 'nvr';
  const action = String(opts?.action || '').trim().toLowerCase();
  if (!gatewayPk || !action) return '';
  return [gatewayPk, servicePk, service, action].join('|');
}

function invalidateGatewayGrantViewCache(record = null) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const servicePk = String(record?.servicePk || managedServicePkForRecord(record) || '').trim();
  for (const key of Array.from(gatewayGrantViewCache.keys())) {
    if (gatewayPk && !key.startsWith(`${gatewayPk}|`)) continue;
    if (servicePk && !key.includes(`|${servicePk}|`)) continue;
    gatewayGrantViewCache.delete(key);
  }
}

async function requestGatewayGrantAction(record, opts = {}) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const servicePk = String(opts?.servicePk ?? managedServicePkForRecord(record) ?? '').trim();
  const service = String(opts?.service || record?.service || 'nvr').trim() || 'nvr';
  const action = String(opts?.action || '').trim().toLowerCase();
  if (!gatewayPk) throw new Error('host gateway is not known for this service yet');
  if (!action) throw new Error('missing grant action');
  const requestId = String(opts?.requestId || '').trim() || randomOpaqueId('gw-grant');
  const pending = createPendingRequest(pendingGatewayGrantRequests, requestId, `gateway ${action}`, 12_000);
  const observedPending = observePendingRequest(pending);
  try {
    await client.call('gateway.grants.request', {
      requestId,
      gatewayPk,
      servicePk,
      service,
      action,
      granteeIdentityId: String(opts?.granteeIdentityId || '').trim(),
      grantId: String(opts?.grantId || '').trim(),
      viewSources: Array.isArray(opts?.viewSources) ? opts.viewSources : [],
      controlSources: Array.isArray(opts?.controlSources) ? opts.controlSources : [],
    }, { timeoutMs: 20_000 });
  } catch (err) {
    settlePending(pendingGatewayGrantRequests, requestId, err);
    throw err;
  }
  return await awaitObservedPendingRequest(observedPending);
}

async function requestGatewayGrantViewAction(record, opts = {}) {
  const action = String(opts?.action || '').trim().toLowerCase();
  if (action !== 'list_shared' && action !== 'list_grants') {
    return await requestGatewayGrantAction(record, opts);
  }
  const key = gatewayGrantViewRequestKey(record, opts);
  if (!key) return await requestGatewayGrantAction(record, opts);
  const now = Date.now();
  const cached = gatewayGrantViewCache.get(key);
  if (cached && (now - Number(cached.updatedAt || 0)) < GATEWAY_GRANT_VIEW_REFRESH_TTL_MS) {
    return cached.result;
  }
  const existing = gatewayGrantViewInFlight.get(key);
  if (existing) return await existing;
  const pending = requestGatewayGrantAction(record, opts)
    .then((result) => {
      gatewayGrantViewCache.set(key, { updatedAt: Date.now(), result });
      return result;
    })
    .finally(() => {
      gatewayGrantViewInFlight.delete(key);
    });
  gatewayGrantViewInFlight.set(key, pending);
  return await pending;
}

async function refreshGatewayGrantViews(identityDevices, swarmDevices, opts = {}) {
  if (opts?.force !== true && !shouldOwnGatewayGrantViewRefresh()) return;
  const owned = ownedPkSet(identityDevices);
  const applianceRecords = currentManagedApplianceRecords(identityDevices, swarmDevices);
  const nextShared = new Map();
  const nextGrantInventory = new Map();

  for (const rec of applianceRecords) {
    if (!isGatewayRecord(rec)) continue;
    const gatewayPk = managedGatewayPkForRecord(rec);
    if (!gatewayPk) continue;
    const seenAt = Number(applianceSeenAt(rec) || 0);
    const isFreshEnough = seenAt && (Date.now() - seenAt) <= APPLIANCE_DISCOVERY_MAX_AGE_MS;

    try {
      if (isFreshEnough) {
        const sharedResult = await requestGatewayGrantViewAction(rec, {
          action: 'list_shared',
          service: 'nvr',
        });
        const sharedRecords = Array.isArray(sharedResult?.sharedResources)
          ? sharedResult.sharedResources
              .map((entry) => buildGrantedManagedServiceRecord(entry, gatewayPk))
              .filter(Boolean)
          : [];
        nextShared.set(gatewayPk, sharedRecords);
      }
    } catch {}

    const isOwnedGateway = owned.has(gatewayPk) || owned.has(String(rec?.devicePk || rec?.pk || '').trim());
    if (!isOwnedGateway) continue;
    const hostedNvr = findGatewayHostedServiceRecord(gatewayPk, applianceRecords, 'nvr');
    if (!hostedNvr) continue;
    try {
      const grantsResult = await requestGatewayGrantViewAction(hostedNvr, {
        action: 'list_grants',
        service: 'nvr',
      });
      nextGrantInventory.set(managedServiceProjectionKey(hostedNvr), {
        grants: Array.isArray(grantsResult?.grants) ? grantsResult.grants : [],
        availableCameras: Array.isArray(grantsResult?.availableCameras) ? grantsResult.availableCameras : [],
        updatedAt: Date.now(),
      });
    } catch {}
  }

  sharedManagedServicesByGatewayPk.clear();
  for (const [gatewayPk, records] of nextShared.entries()) {
    sharedManagedServicesByGatewayPk.set(gatewayPk, records);
  }

  ownedGatewayGrantInventoryByServiceKey.clear();
  for (const [key, value] of nextGrantInventory.entries()) {
    ownedGatewayGrantInventoryByServiceKey.set(key, value);
  }
}

function managedPopupSplashHtml(title = 'Connecting', status = '') {
  const nextStatus = String(status || '').trim();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(87, 209, 191, 0.16), transparent 30%),
        radial-gradient(circle at top right, rgba(247, 185, 85, 0.10), transparent 22%),
        linear-gradient(180deg, #0a0f18 0%, #080b11 100%);
      color: #eef2f8;
      font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
    }
    .bootSplashCard {
      width: min(28rem, calc(100vw - 3rem));
      padding: 1.5rem 1.35rem;
      border-radius: 1.4rem;
      border: 1px solid rgba(176, 193, 217, 0.14);
      background: rgba(15, 21, 33, 0.84);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
      text-align: center;
      backdrop-filter: blur(14px);
    }
    .bootSpinner {
      width: 2.6rem;
      height: 2.6rem;
      margin: 0 auto 1rem;
      border-radius: 999px;
      border: 3px solid rgba(87, 209, 191, 0.18);
      border-top-color: rgba(87, 209, 191, 0.96);
      animation: bootSpin 0.9s linear infinite;
    }
    .bootSplashTitle {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 700;
      line-height: 1.1;
      animation: bootLift 1.15s ease-in-out infinite alternate;
    }
    .bootSplashStatus {
      margin: 0.55rem 0 0;
      color: rgba(238, 242, 248, 0.72);
      font-size: 0.98rem;
      line-height: 1.45;
    }
    @keyframes bootSpin { to { transform: rotate(360deg); } }
    @keyframes bootLift {
      from { transform: translateY(0) scale(1); text-shadow: 0 0 0 rgba(87, 209, 191, 0); }
      to { transform: translateY(-2px) scale(1.015); text-shadow: 0 10px 28px rgba(87, 209, 191, 0.18); }
    }
  </style>
</head>
<body>
  <div class="bootSplashCard" aria-live="polite" role="status">
    <div class="bootSpinner" aria-hidden="true"></div>
    <p class="bootSplashTitle">${escapeHtml(title)}</p>
    <p class="bootSplashStatus"${nextStatus ? '' : ' hidden'}>${escapeHtml(nextStatus)}</p>
  </div>
</body>
</html>`;
}

async function openNvrControlPanel(record, opts = {}) {
  let popup = null;
  try {
    lastManagedServiceIssue = null;
    publishRuntimeManagedApplianceState();
    setManagedServiceActionState(record, {
      state: 'resolving',
      message: 'Resolving current Security Cameras availability…',
    });
    popup = window.open('', '_blank');
    if (popup && !popup.closed) {
      popup.document.open();
      popup.document.write(managedPopupSplashHtml('Connecting'));
      popup.document.close();
    }

    const resolvedRecord = await resolveManagedServiceForAccess(record, { serviceLabel: 'Security Cameras' });
    setManagedServiceActionState(record, {
      state: 'opening',
      message: 'Opening Security Cameras…',
    });
    if (popup && !popup.closed) {
      popup.document.open();
      popup.document.write(managedPopupSplashHtml('Connecting'));
      popup.document.close();
    }

    if (!runtimeBridge?.openStream) {
      throw new Error('shared browser runtime is unavailable; reload Constitute Account and try again');
    }
    const gatewayPk = managedGatewayPkForRecord(resolvedRecord);
    const servicePk = managedServicePkForRecord(resolvedRecord);
    if (!gatewayPk) throw new Error('host gateway is not known for this service yet');
    if (!servicePk) throw new Error('service public key is missing');
    await runtimeBridge.openStream({
      intentId: randomOpaqueId('nvr-stream'),
      nodeRef: String(opts?.camera || 'live-preview').trim() || 'live-preview',
      capabilityRef: 'media.stream.preview',
      params: {
        activity: String(opts?.activity || '').trim(),
        settingsTab: String(opts?.settingsTab || '').trim(),
        camera: String(opts?.camera || '').trim(),
      },
    });

    const url = await buildManagedAppSurfaceUrl(
      managedAppSurfaceRepoForService('nvr'),
      opts,
    );
    if (popup && !popup.closed) {
      popup.location.replace(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setGatewayInstallStatus('Opened Security Cameras.', false);
    setManagedServiceActionState(record, null);
  } catch (err) {
    lastManagedServiceIssue = {
      service: 'nvr',
      state: 'error',
      stage: String(err?.message || '').split(':')[0] || 'stream_intent',
      reason: String(err?.message || err),
      updatedAt: Date.now(),
    };
    publishRuntimeManagedApplianceState();
    setGatewayInstallStatus(`NVR control panel failed: ${String(err?.message || err)}`, true);
    runtimeBridge?.pushStatus?.(buildRuntimeShellStatus()).catch(() => {});
    setManagedServiceActionState(record, {
      state: 'error',
      message: String(err?.message || err),
    }, 7_500);
    if (popup && !popup.closed) {
      popup.document.title = 'Security Cameras Stream Failed';
      popup.document.body.innerHTML = `<pre style="font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding:16px; color:#fca5a5; background:#0b1220;">Stream intent failed: ${escapeHtml(String(err?.message || err))}</pre>`;
    }
  }
}

function shouldRefreshGatewayInventory(gatewayPk) {
  const pk = String(gatewayPk || '').trim();
  if (!pk) return false;
  const stableAt = Number(gatewayInventoryStableAt.get(pk) || 0);
  if (stableAt && (Date.now() - stableAt) < GATEWAY_INVENTORY_STABLE_TTL_MS) {
    return false;
  }
  const lastAt = Number(gatewayInventoryRefreshAt.get(pk) || 0);
  return (Date.now() - lastAt) >= GATEWAY_INVENTORY_REFRESH_TTL_MS;
}

async function requestGatewayInventoryRefresh(gatewayPk, opts = {}) {
  const pk = String(gatewayPk || '').trim();
  const force = opts?.force === true;
  if (!pk || (!force && !shouldRefreshGatewayInventory(pk))) return false;
  gatewayInventoryRefreshAt.set(pk, Date.now());
  if (force) gatewayInventoryStableAt.delete(pk);
  try {
    await client.call('swarm.record.request', {
      want: ['device'],
      devicePk: pk,
    }, { timeoutMs: 20_000 });
    return true;
  } catch (err) {
    console.warn('[managed] gateway inventory request failed', pk, err);
    return false;
  }
}

async function refreshManagedApplianceProjection(opts = {}) {
  if (!client) return [];
  const refreshGrantViews = opts?.refreshGrantViews === true;
  const swarmDevices = await client.call('swarm.device.list', {}, { timeoutMs: 20_000 }).catch(() => lastSwarmDevices || []);
  lastSwarmDevices = Array.isArray(swarmDevices) ? swarmDevices : [];
  if (refreshGrantViews) {
    await refreshGatewayGrantViews(lastIdentity?.devices || [], lastSwarmDevices).catch(() => {});
  }
  pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices);
  renderConnectionModel('managed inventory refresh');
  return lastSwarmDevices;
}

function isFreshManagedServiceRecord(record) {
  const freshness = applianceFreshness(applianceSeenAt(record));
  return freshness.label === 'live' || freshness.label === 'recent';
}

function resolvedManagedServiceRecord(record, applianceRecords = []) {
  const records = Array.isArray(applianceRecords) ? applianceRecords : [];
  const gatewayPk = managedGatewayPkForRecord(record);
  const requestedServicePk = managedServicePkForRecord(record);
  const service = String(record?.service || 'nvr').trim().toLowerCase() || 'nvr';
  let direct = null;
  if (requestedServicePk) {
    direct = records.find((candidate) => {
      if (String(candidate?.service || '').trim().toLowerCase() !== service) return false;
      if (managedServicePkForRecord(candidate) !== requestedServicePk) return false;
      const candidateGatewayPk = managedGatewayPkForRecord(candidate);
      return !gatewayPk || !candidateGatewayPk || candidateGatewayPk === gatewayPk;
    }) || null;
  }
  if (direct && isFreshManagedServiceRecord(direct)) return direct;
  if (gatewayPk) {
    const hosted = findGatewayHostedServiceRecord(gatewayPk, records, service);
    if (hosted && isFreshManagedServiceRecord(hosted)) return withManagedServiceAccessKeys(hosted, record);
    return hosted ? withManagedServiceAccessKeys(hosted, record) : direct;
  }
  return direct;
}

function withManagedServiceAccessKeys(record, fallbackRecord) {
  const source = (record && typeof record === 'object') ? record : {};
  const fallback = (fallbackRecord && typeof fallbackRecord === 'object') ? fallbackRecord : {};
  const gatewayPk = managedGatewayPkForRecord(source) || managedGatewayPkForRecord(fallback);
  const servicePk = managedServicePkForRecord(source) || managedServicePkForRecord(fallback);
  return {
    ...source,
    hostGatewayPk: gatewayPk || String(source?.hostGatewayPk || source?.host_gateway_pk || '').trim(),
    servicePk,
  };
}

function isGatewayAuthoritativeManagedServiceRecord(record) {
  return String(record?.managedAvailabilityAuthority || '').trim().toLowerCase() === 'gateway';
}

async function resolveManagedServiceForAccess(record, opts = {}) {
  const gatewayPk = managedGatewayPkForRecord(record);
  const serviceLabel = String(opts?.serviceLabel || 'Security Cameras').trim() || 'Security Cameras';
  const requireGatewayAuthority = opts?.requireGatewayAuthority !== false;
  if (!gatewayPk) {
    throw new Error(`${serviceLabel} is not attached to a gateway yet.`);
  }
  let candidate = resolvedManagedServiceRecord(
    record,
    currentManagedApplianceRecords(lastIdentity?.devices || [], lastSwarmDevices || []),
  );
  if (candidate && isFreshManagedServiceRecord(candidate) && (!requireGatewayAuthority || isGatewayAuthoritativeManagedServiceRecord(candidate))) {
    return candidate;
  }

  await requestGatewayInventoryRefresh(gatewayPk, { force: true }).catch(() => false);
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < MANAGED_SERVICE_RESOLVE_TIMEOUT_MS) {
    await refreshManagedApplianceProjection({ refreshGrantViews: false }).catch(() => {});
    candidate = resolvedManagedServiceRecord(
      record,
      currentManagedApplianceRecords(lastIdentity?.devices || [], lastSwarmDevices || []),
    );
    if (candidate && isFreshManagedServiceRecord(candidate) && (!requireGatewayAuthority || isGatewayAuthoritativeManagedServiceRecord(candidate))) {
      return candidate;
    }
    await new Promise((resolve) => window.setTimeout(resolve, MANAGED_SERVICE_RESOLVE_POLL_MS));
  }

  if (candidate && isGatewayAuthoritativeManagedServiceRecord(candidate)) {
    return candidate;
  }

  if (candidate && !requireGatewayAuthority) {
    return candidate;
  }

  if (candidate && !isGatewayAuthoritativeManagedServiceRecord(candidate)) {
    throw new Error(`${serviceLabel} is not published as a gateway-hosted service yet.`);
  }

  const seenAt = candidate ? applianceSeenAt(candidate) : 0;
  const detail = candidate && seenAt
    ? `Last update ${formatRelativeTime(seenAt)}.`
    : 'The gateway has not refreshed this service yet.';
  throw new Error(`${serviceLabel} is not available right now. ${detail}`.trim());
}

function pushRuntimeManagedApplianceSourceSnapshot(identityDevices, swarmDevices) {
  if (!runtimeBridge?.putManagedApplianceSourceSnapshot) return;
  const publish = () => {
    const effectiveSwarmDevices = Array.isArray(swarmDevices) && swarmDevices.length > 0
      ? swarmDevices
      : currentSwarmDeviceRecords();
    runtimeBridge.putManagedApplianceSourceSnapshot({
      identityDevices: Array.isArray(identityDevices) ? identityDevices : [],
      swarmDevices: effectiveSwarmDevices,
      grantedRecords: grantedManagedServiceRecords(),
      managedServiceIssue: lastManagedServiceIssue || null,
    });
    pushRuntimeAuthorityDevice().catch(() => {});
    attachRuntimeSwarmEdgeIfAvailable().catch(() => {});
  };
  publish();
  if (!runtimeBridge.ready) {
    window.setTimeout(publish, 350);
    window.setTimeout(publish, 1_500);
  }
}

function publishRuntimeManagedApplianceState() {
  pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices || []);
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function applyGatewayHostedSnapshot(record) {
  return record;
}

function pageAllowsInsecureRelayUrls() {
  try {
    const u = new URL(window.location.href);
    return u.protocol === 'http:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function normalizeRelayCandidate(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return '';
  if (parsed.protocol === 'ws:' && !pageAllowsInsecureRelayUrls()) return '';
  const host = String(parsed.hostname || '').trim().toLowerCase();
  if (!host || host === 'gateway.example' || host.includes('replace-host') || host.endsWith('.example')) return '';
  parsed.hash = '';
  return parsed.toString();
}

function collectOwnedGatewayRelayUrls(identityDevices, swarmDevices) {
  const owned = ownedPkSet(identityDevices);
  const out = [];
  for (const rec of (Array.isArray(swarmDevices) ? swarmDevices : [])) {
    if (!isGatewayRecord(rec)) continue;
    const pk = String(rec?.devicePk || rec?.pk || '').trim();
    if (!pk || !owned.has(pk)) continue;
    const relays = Array.isArray(rec?.relays) ? rec.relays : [];
    for (const relayUrl of relays) {
      const normalized = normalizeRelayCandidate(relayUrl);
      if (normalized && !out.includes(normalized)) out.push(normalized);
    }
  }
  return out;
}

function desiredRelayUrls(identityDevices = [], swarmDevices = []) {
  const candidates = [...DEFAULT_PUBLIC_RELAYS, ...collectOwnedGatewayRelayUrls(identityDevices, swarmDevices)];
  const out = [];
  for (const relayUrl of candidates) {
    const normalized = normalizeRelayCandidate(relayUrl);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
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

function renderNotifications() {
  clear(notifList);
  const unread = (lastNotifications || []).filter(n => !n.read);
  btnBell.classList.toggle('has-unread', unread.length !== 0);
  if (btnNotifClear) btnNotifClear.disabled = !notificationsResolved || lastNotifications.length === 0;

  if (!notificationsResolved) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `
      <div class="cuLoadingRow">
        <span class="cuSpinner" aria-hidden="true"></span>
        <span>Loading notifications…</span>
      </div>
    `;
    notifList.appendChild(d);
    return;
  }

  if (!lastNotifications || lastNotifications.length === 0) {
    const d = document.createElement('div');
    d.className = 'item';
    d.textContent = 'No notifications.';
    notifList.appendChild(d);
    return;
  }

  for (const n of lastNotifications) {
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
        setSettingsTab('devices');
      }
      await refreshAll();
      if (n.kind === 'pairing') {
        showActivity('settings');
        setSettingsTab('devices');
      }
    };
    notifList.appendChild(it);
  }
}

function renderPairRequests(reqs, identityDevices) {
  const pending = Array.isArray(reqs) ? reqs : [];

  clear(pairingList);
  if (pairingEmpty) pairingEmpty.textContent = 'No pending pairing requests.';
  if (pendingRequestsSection) pendingRequestsSection.classList.toggle('hidden', pending.length === 0);
  if (pairingEmpty) pairingEmpty.classList.toggle('hidden', pending.length !== 0);

  for (const r of pending) {
    const item = document.createElement('div');
    item.className = 'item';

    const top = document.createElement('div');
    top.className = 'itemTop';

    const left = document.createElement('div');
    const codeMeta = r.code
      ? `code ${r.code}`
      : (r.codeHash ? `code# ${String(r.codeHash).slice(0, 12)}…` : 'code n/a');
    left.innerHTML = `
      <div class="itemTitle">${escapeHtml(r.identityLabel || '(no identity label)')}</div>
      <div class="itemMeta">Device: ${escapeHtml(r.deviceLabel || '(no label)')} • pk ${escapeHtml((r.devicePk || '').slice(0, 12))}… • ${escapeHtml(codeMeta)}</div>
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
        setPairCodeStatus(`Approve failed: ${String(e?.message || e)}`, true);
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
        setPairCodeStatus(`Reject failed: ${String(e?.message || e)}`, true);
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

function renderPairClaimStatus(claimStatus, reqs = []) {
  const state = String(claimStatus?.state || '').trim();
  if ((Array.isArray(reqs) && reqs.length > 0) || state === 'matched') {
    setPairCodeStatus('Pairing request received. Review and approve it below.');
    return;
  }
  if (state === 'expired') {
    setPairCodeStatus('Pairing code expired. Enter a fresh code from the device.', true);
    return;
  }
  if (state === 'failed') {
    setPairCodeStatus(String(claimStatus?.message || 'Pairing claim failed. Try again.'), true);
    return;
  }
  if (state === 'active') {
    setPairCodeStatus('Claim sent. Wait for the pairing request, then approve it below.');
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

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'inlineLabelInput';
    labelInput.value = String(d0?.label || '');
    labelInput.placeholder = 'New device label';
    labelInput.setAttribute('aria-label', `Label for ${String(d0?.pk || '').slice(0, 12)}`);
    actions.appendChild(labelInput);

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.textContent = 'Save Label';
    btnSave.onclick = async () => {
      const next = String(labelInput.value || '').trim();
      if (!next) return;
      btnSave.disabled = true;
      const original = btnSave.textContent;
      btnSave.textContent = 'Saving…';
      try {
        const selfPk = String(lastDeviceState?.pk || '').trim();
        if (d0?.pk && d0.pk === selfPk) {
          await client.call('device.setLabel', { label: next }, { timeoutMs: 20000 });
        } else {
          await client.call('devices.setLabel', { pk: d0?.pk || '', label: next }, { timeoutMs: 20000 });
        }
        await refreshAll();
      } catch (e) {
        console.error(e);
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = original;
      }
    };
    actions.appendChild(btnSave);

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

function shortPk(value, head = 12, tail = 6) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
}

function titleCaseWords(value) {
  return String(value || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function peerSummaryTitle(entry) {
  const label = String(entry?.deviceLabel || entry?.label || entry?.identityLabel || entry?.name || '').trim();
  if (label) return label;
  const role = String(entry?.role || '').trim().toLowerCase();
  const service = String(entry?.service || '').trim().toLowerCase();
  const summary = service && service !== 'none'
    ? titleCaseWords(service)
    : (role ? titleCaseWords(role) : 'Device');
  const pk = shortPk(entry?.devicePk || '', 10, 4);
  return pk ? `${summary} • ${pk}` : summary;
}

function renderZones(list) {
  clear(zonesList);
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    activeZoneKey = '';
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
        const role = String(e.role || '').trim();
        const serviceVersion = String(e.serviceVersion || '').trim();
        const roleLine = serviceVersion ? `${role || 'unknown'} (${serviceVersion})` : (role || 'unknown');
        const releaseMeta = formatReleaseMeta(e.releaseChannel, e.releaseTrack, e.releaseBranch);
        const releaseLine = releaseMeta ? `<div class="itemMeta">Release: ${escapeHtml(releaseMeta)}</div>` : '';
        const pkMeta = shortPk(e.devicePk || '', 12, 6);
        row.innerHTML = `
          <div class="itemTitle">${escapeHtml(peerSummaryTitle(e))}</div>
          <div class="itemMeta">pk ${escapeHtml(pkMeta || String(e.devicePk || ''))}</div>
          <div class="itemMeta">Source: ${escapeHtml(sources)}</div>
          <div class="itemMeta">Role: ${escapeHtml(roleLine)}</div>
          ${releaseLine}
          <div class="itemMeta">Nostr seen ${nostrSeen ? new Date(nostrSeen).toLocaleString() : 'n/a'}</div>
          <div class="itemMeta">Swarm seen ${swarmSeen ? new Date(swarmSeen).toLocaleString() : 'n/a'}</div>
        `;
        listEl.appendChild(row);
      }
    }
    item.onclick = () => {
      activeZoneKey = key;
      renderPeers(lastDirectory);
    };
    zonesList.appendChild(item);
  }
  if (activeZoneKey && !arr.some((zone) => String(zone?.key || '').trim() === activeZoneKey)) {
    activeZoneKey = '';
  }
  if (!activeZoneKey && arr[0]?.key) {
    activeZoneKey = arr[0].key;
  }
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
    const role = String(e.role || '').trim();
    const serviceVersion = String(e.serviceVersion || '').trim();
    const roleLine = serviceVersion ? `${role || 'unknown'} (${serviceVersion})` : (role || 'unknown');
    const releaseMeta = formatReleaseMeta(e.releaseChannel, e.releaseTrack, e.releaseBranch);
    const releaseLine = releaseMeta ? `<div class="itemMeta">Release: ${escapeHtml(releaseMeta)}</div>` : '';
    const pkMeta = shortPk(e.devicePk || '', 12, 6);
    item.innerHTML = `
      <div class="itemTitle">${escapeHtml(peerSummaryTitle(e))}</div>
      <div class="itemMeta">pk ${escapeHtml(pkMeta || String(e.devicePk || ''))}</div>
      <div class="itemMeta">Source: ${escapeHtml(sources)}</div>
      <div class="itemMeta">Role: ${escapeHtml(roleLine)}</div>
      ${releaseLine}
      <div class="itemMeta">Nostr seen ${nostrSeen ? new Date(nostrSeen).toLocaleString() : 'n/a'}</div>
      <div class="itemMeta">Swarm seen ${swarmSeen ? new Date(swarmSeen).toLocaleString() : 'n/a'}</div>
    `;
    peersList.appendChild(item);
  }
}

// onboarding: security radio choice
let onboardingSecurityChoice = null; // 'webauthn' | 'skip'
let onboardingStep = 1;

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
let refreshAllInflight = null;
let refreshAllQueued = false;
let refreshAllTimer = null;

async function runRefreshAll() {
  if (refreshAllInflight) {
    refreshAllQueued = true;
    return await refreshAllInflight;
  }
  refreshAllInflight = (async () => {
    try {
      await refreshAll();
    } finally {
      refreshAllInflight = null;
      if (refreshAllQueued) {
        refreshAllQueued = false;
        runRefreshAll().catch(() => {});
      }
    }
  })();
  return await refreshAllInflight;
}

function scheduleRefreshAll(delayMs = 150) {
  clearTimeout(refreshAllTimer);
  refreshAllTimer = setTimeout(() => {
    refreshAllTimer = null;
    runRefreshAll().catch(() => {});
  }, delayMs);
}

function ensureOnboardingState(ident) {
  if (!ident?.linked) {
    showActivity('onboarding');
    setOnboardStep(onboardingStep);
  }
}

async function refreshAll() {
  const core = await refreshCoreState();
  await refreshExtendedState(core);
  return { st: core.st, ident: core.ident };
}

function applyCoreRefreshState({ st, ident, myLabel }) {
  lastDeviceState = st;
  lastIdentity = ident;
  relayBridge?.updateAdmissionContext?.();
  setDaemonState('online', 'rpc ok');
  deviceDid.textContent = st.did || '';
  deviceDidSummary.textContent = String(myLabel?.label || 'This device').trim() || 'This device';
  deviceSecuritySummary.textContent = st.didMethod === 'webauthn' ? 'Protected' : 'Basic';
  identityLinkedSummary.textContent = ident?.linked ? currentIdentityHandle() : 'Not signed in';
  updateIdentityChrome(ident);
  deviceLabel.value = myLabel?.label || '';
  renderDeviceList(ident?.devices || []);
  pushRuntimeManagedApplianceSourceSnapshot(ident?.devices || [], lastSwarmDevices);
  ensureOnboardingState(ident);
  renderConnectionModel('refresh');
}

async function refreshCoreState() {
  // SEQUENTIAL (not Promise.all) to avoid SW starvation/timeouts.
  const st = await client.call('device.getState', {}, { timeoutMs: 20000 });
  const ident = await client.call('identity.get', {}, { timeoutMs: 20000 });
  const myLabel = await client.call('device.getLabel', {}, { timeoutMs: 20000 });
  applyCoreRefreshState({ st, ident, myLabel });
  markShellBoot('shell.core-refresh.complete');
  return { st, ident, myLabel };
}

async function refreshExtendedState(core = null) {
  const st = core?.st || lastDeviceState || await client.call('device.getState', {}, { timeoutMs: 20000 });
  const ident = core?.ident || lastIdentity || await client.call('identity.get', {}, { timeoutMs: 20000 });
  const reqs = await client.call('pairing.list', {}, { timeoutMs: 20000 });
  const pairClaimStatus = await client.call('pairing.claimStatus', {}, { timeoutMs: 20000 }).catch(() => null);
  const blocked = await client.call('blocked.list', {}, { timeoutMs: 20000 });
  const directory = await client.call('directory.list', {}, { timeoutMs: 20000 });
  const zones = await client.call('zones.list', {}, { timeoutMs: 20000 });
  const rpcSwarmDevices = await client.call('swarm.device.list', {}, { timeoutMs: 20000 }).catch(() => []);
  const swarmDevices = Array.isArray(rpcSwarmDevices) && rpcSwarmDevices.length > 0
    ? rpcSwarmDevices
    : currentSwarmDeviceRecords();
  const swarmIdentities = await client.call('swarm.identity.list', {}, { timeoutMs: 20000 }).catch(() => []);
  const notifs = await client.call('notifications.list', {}, { timeoutMs: 20000 });

  lastDirectory = directory || [];
  lastZones = zones || [];
  relayBridge?.updateAdmissionContext?.();
  lastPairClaimStatus = pairClaimStatus || null;
  lastSwarmDevices = swarmDevices || [];
  lastNotifications = Array.isArray(notifs) ? notifs : [];
  notificationsResolved = true;
  await refreshGatewayGrantViews(ident?.devices || [], lastSwarmDevices).catch(() => {});
  relayBridge?.updateTargets(desiredRelayUrls(ident?.devices || [], lastSwarmDevices), 'refresh');

  for (const z of (lastZones || [])) {
    const n = String(z?.name || '').trim();
    if (!n || n === 'Joined' || n.startsWith('Zone ')) {
      client.call('zones.meta.request', { key: z.key }, { timeoutMs: 20000 }).catch(() => {});
      client.call('zones.list.request', { key: z.key }, { timeoutMs: 20000 }).catch(() => {});
    }
  }

  renderBlockedList(blocked || []);
  renderZones(lastZones);
  renderPeers(lastDirectory);
  updateZoneCommandUi();
  pushRuntimeManagedApplianceSourceSnapshot(ident?.devices || [], lastSwarmDevices);
  renderPairRequests(reqs || [], ident?.devices || []);
  renderPairClaimStatus(lastPairClaimStatus, reqs || []);
  renderNotifications();

  const applianceRecords = currentManagedApplianceRecords(ident?.devices || [], lastSwarmDevices);
  const ownedGatewayPksNeedingRefresh = applianceRecords
    .filter((rec) => isGatewayRecord(rec))
    .map((rec) => summarizeAppliance(rec, ownedPkSet(ident?.devices || []).has(String(rec?.devicePk || rec?.pk || '').trim())))
    .filter((info) => info.owned)
    .filter((info) => Object.keys(MANAGED_APP_SURFACES).some((service) => !findGatewayHostedServiceRecord(info.pk, applianceRecords, service)))
    .map((info) => info.pk);
  for (const gatewayPk of ownedGatewayPksNeedingRefresh) {
    requestGatewayInventoryRefresh(gatewayPk).catch(() => {});
  }
  if (swarm && ident?.linked) {
    swarm.setLocalPk(st.pk || '');
    swarm.setPeers(swarmDevices || []);
    swarm.cacheIdentityRecords(swarmIdentities || []);
    swarm.cacheDeviceRecords(swarmDevices || []);
    if (!swarmBootRequested) {
      swarmBootRequested = true;
      client.call('swarm.record.request', { want: ['identity', 'device'] }, { timeoutMs: 20000 })
        .catch(() => {});
    }
  } else {
    setSwarmState('disabled');
  }

  renderConnectionModel('extended-refresh');
  markShellBoot('shell.extended-refresh.complete');
  return { st, ident };
}

function setOnboardStep(n) {
  onboardingStep = n === 2 ? 2 : 1;
  obStepDevice.classList.toggle('hidden', onboardingStep !== 1);
  obStepIdentity.classList.toggle('hidden', onboardingStep !== 2);
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
  const ident = lastIdentity || await client.call('identity.get', {}, { timeoutMs: 20000 }).catch(() => null);
  const st = lastDeviceState || await client.call('device.getState', {}, { timeoutMs: 20000 }).catch(() => null);
  const linked = Boolean(ident?.linked && String(ident?.id || '').trim());
  const hasDevice = Boolean(String(st?.pk || '').trim() || String(st?.did || '').trim());
  if (linked && hasDevice) return true;
  showActivity('onboarding');
  setOnboardStep(onboardingStep);
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
    setSettingsTab('network');
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

function zoneRecordByKey(key) {
  const target = String(key || '').trim();
  if (!target) return null;
  return (Array.isArray(lastZones) ? lastZones : []).find((zone) => String(zone?.key || '').trim() === target) || null;
}

function zoneNameExists(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return false;
  return (Array.isArray(lastZones) ? lastZones : []).some((zone) => String(zone?.name || '').trim().toLowerCase() === target);
}

function syntheticZoneName(key) {
  const raw = String(key || '').trim();
  if (!raw) return 'Zone';
  return `Zone ${raw.slice(0, 8)}`;
}

function zoneCommandResolvedShareName(key) {
  const zone = zoneRecordByKey(key);
  return String(zone?.name || '').trim() || syntheticZoneName(key);
}

function updateZoneCommandUi() {
  if (!zoneCommandInput || !zoneCommandButton || !zoneCommandHelper) return;
  const mode = String(zoneCommandState.mode || 'idle');
  const busy = Boolean(zoneCommandState.busy);
  zoneCommandSpinner?.classList.toggle('hidden', !busy);
  zoneCommandButton.disabled = busy || mode === 'idle';
  zoneCommandButton.textContent = busy
    ? 'Checking...'
    : (mode === 'join' ? 'Join' : (mode === 'copy' ? 'Copy ID' : 'Create'));
  zoneCommandHelper.textContent = zoneCommandState.helper || 'Type a name to create a zone, or paste a zone ID to join one.';
  zoneCommandHelper.classList.toggle('warn', Boolean(zoneCommandState.error));
}

async function evaluateZoneCommandInput(rawInput) {
  zoneCommandState.draft = String(rawInput || '');
  zoneCommandState.resolvedKey = '';
  zoneCommandState.resolvedName = '';
  zoneCommandState.mode = 'idle';
  zoneCommandState.helper = '';
  zoneCommandState.busy = false;
  zoneCommandState.error = false;

  const raw = String(rawInput || '').trim();
  if (!raw) {
    updateZoneCommandUi();
    return;
  }

  const normalizedKey = normalizeZoneKey(raw);
  if (ZONE_KEY_RE.test(normalizedKey)) {
    zoneCommandState.mode = 'resolving';
    zoneCommandState.busy = true;
    zoneCommandState.helper = 'Checking zone ID…';
    updateZoneCommandUi();

    const existingZone = zoneRecordByKey(normalizedKey);
    if (!existingZone) {
      await client.call('zones.meta.request', { key: normalizedKey }, { timeoutMs: 20_000 }).catch(() => {});
      await client.call('zones.list.request', { key: normalizedKey }, { timeoutMs: 20_000 }).catch(() => {});
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    const resolvedZone = zoneRecordByKey(normalizedKey);
    const resolvedName = String(resolvedZone?.name || '').trim() || syntheticZoneName(normalizedKey);
    zoneCommandState.busy = false;
    zoneCommandState.resolvedKey = normalizedKey;
    zoneCommandState.resolvedName = resolvedName;
    zoneCommandState.mode = resolvedZone ? 'copy' : 'join';
    zoneCommandState.helper = resolvedZone
      ? 'Already joined here. Click Copy ID to share it again.'
      : 'Ready to join this zone. The name may update after join.';
    zoneCommandInput.value = resolvedName;
    updateZoneCommandUi();
    return;
  }

  if (zoneNameExists(raw)) {
    zoneCommandState.error = true;
    zoneCommandState.helper = 'That zone name is already in use on this device.';
    updateZoneCommandUi();
    return;
  }

  zoneCommandState.mode = 'create';
  zoneCommandState.helper = 'Ready to create and join this zone.';
  updateZoneCommandUi();
}

function scheduleZoneCommandEvaluation() {
  if (!zoneCommandInput) return;
  if (zoneCommandDebounce) {
    clearTimeout(zoneCommandDebounce);
    zoneCommandDebounce = 0;
  }
  zoneCommandState.busy = false;
  zoneCommandState.error = false;
  zoneCommandState.mode = 'idle';
  zoneCommandState.helper = '';
  zoneCommandState.resolvedKey = '';
  zoneCommandState.resolvedName = '';
  updateZoneCommandUi();
  zoneCommandDebounce = window.setTimeout(() => {
    zoneCommandDebounce = 0;
    evaluateZoneCommandInput(zoneCommandInput.value).catch((err) => {
      zoneCommandState.busy = false;
      zoneCommandState.mode = 'idle';
      zoneCommandState.error = true;
      zoneCommandState.helper = `Zone validation failed: ${String(err?.message || err)}`;
      updateZoneCommandUi();
    });
  }, ZONE_COMMAND_DEBOUNCE_MS);
}

async function submitZoneCommand() {
  if (!zoneCommandInput || !zoneCommandButton || zoneCommandState.busy) return;
  if (zoneCommandDebounce) {
    clearTimeout(zoneCommandDebounce);
    zoneCommandDebounce = 0;
  }
  let mode = String(zoneCommandState.mode || 'idle');
  if (mode === 'idle') {
    await evaluateZoneCommandInput(zoneCommandInput.value);
    mode = String(zoneCommandState.mode || 'idle');
  }
  if (mode === 'idle' || zoneCommandState.busy) return;

  if (mode === 'copy') {
    const key = String(zoneCommandState.resolvedKey || '').trim();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      zoneCommandState.helper = 'Copied zone ID.';
      zoneCommandState.error = false;
      updateZoneCommandUi();
    } catch (err) {
      zoneCommandState.helper = `Copy failed: ${String(err?.message || err)}`;
      zoneCommandState.error = true;
      updateZoneCommandUi();
    }
    return;
  }

  if (mode === 'create') {
    const name = String(zoneCommandInput.value || zoneCommandState.draft || '').trim();
    if (!name) return;
    zoneCommandState.busy = true;
    zoneCommandState.helper = 'Creating zone…';
    zoneCommandState.error = false;
    updateZoneCommandUi();
    try {
      const created = await client.call('zones.add', { name }, { timeoutMs: 20_000 });
      const key = normalizeZoneKey(created?.key || '');
      await refreshAll();
      zoneCommandState.busy = false;
      zoneCommandState.mode = 'copy';
      zoneCommandState.resolvedKey = key;
      zoneCommandState.resolvedName = name;
      zoneCommandState.helper = 'Zone created. Click Copy ID to share it.';
      zoneCommandInput.value = key;
      activeZoneKey = key || activeZoneKey;
      renderPeers(lastDirectory);
      updateZoneCommandUi();
      return;
    } catch (err) {
      zoneCommandState.busy = false;
      zoneCommandState.mode = 'idle';
      zoneCommandState.error = true;
      zoneCommandState.helper = `Create failed: ${String(err?.message || err)}`;
      updateZoneCommandUi();
      return;
    }
  }

  if (mode === 'join') {
    const key = String(zoneCommandState.resolvedKey || '').trim();
    if (!key) return;
    zoneCommandState.busy = true;
    zoneCommandState.helper = 'Joining zone…';
    zoneCommandState.error = false;
    updateZoneCommandUi();
    try {
      const existing = zoneRecordByKey(key);
      const shareName = existing ? String(existing?.name || '').trim() : '';
      await client.call('zones.join', { key, name: shareName }, { timeoutMs: 20_000 });
      await refreshAll();
      zoneCommandState.busy = false;
      zoneCommandState.mode = 'copy';
      zoneCommandState.resolvedKey = key;
      zoneCommandState.resolvedName = zoneCommandResolvedShareName(key);
      zoneCommandState.helper = 'Joined this zone. Click Copy ID to share it again.';
      zoneCommandInput.value = zoneCommandState.resolvedName;
      activeZoneKey = key;
      renderPeers(lastDirectory);
      updateZoneCommandUi();
      return;
    } catch (err) {
      zoneCommandState.busy = false;
      zoneCommandState.mode = 'idle';
      zoneCommandState.error = true;
      zoneCommandState.helper = `Join failed: ${String(err?.message || err)}`;
      updateZoneCommandUi();
    }
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
    setSettingsTab('network');
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
  if (accountRailButton) {
    accountRailButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleAccountCenter();
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (accountCenterOpen && target instanceof Node && !accountCenterMenu.contains(target) && !accountRailButton.contains(target)) {
      closeAccountCenter();
    }
  });

  // drawer nav
  for (const b of navButtons) {
    b.addEventListener('click', () => {
      showActivity(b.dataset.activity);
      closeDrawer();
    });
  }

  // settings tabs
  for (const b of tabButtons) b.addEventListener('click', () => setSettingsTab(b.dataset.tab));

  if (pairCodeInput) {
    pairCodeInput.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text') || '';
      const normalized = normalizePairCodeInput(text);
      if (!normalized) return;
      event.preventDefault();
      pairCodeInput.value = normalized;
      setPairCodeStatus('');
    });
    pairCodeInput.addEventListener('input', () => {
      const normalized = normalizePairCodeInput(pairCodeInput.value);
      if (normalized !== pairCodeInput.value) pairCodeInput.value = normalized;
      if (pairCodeStatus?.textContent) setPairCodeStatus('');
    });
    pairCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        btnClaimPairCode?.click();
      }
    });
  }

  if (btnClaimPairCode) {
    btnClaimPairCode.onclick = async () => {
      const code = normalizePairCodeInput(pairCodeInput?.value || '');
      if (pairCodeInput) pairCodeInput.value = code;
      if (!code) {
        setPairCodeStatus('Enter a code from the new device.', true);
        return;
      }
      setPairClaimButtonBusy(true);
      setPairCodeStatus('');
      try {
        const claim = await client.call('pairing.claimCode', { code }, { timeoutMs: 20000 });
        lastPairClaimStatus = { state: 'active', ...claim };
        renderPairClaimStatus(lastPairClaimStatus);
      } catch (e) {
        setPairCodeStatus(`Claim failed: ${String(e?.message || e)}`, true);
      } finally {
        setPairClaimButtonBusy(false);
      }
    };
  }

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

  if (zoneCommandInput) {
    zoneCommandInput.addEventListener('input', () => {
      zoneCommandState.draft = String(zoneCommandInput.value || '');
      scheduleZoneCommandEvaluation();
    });
    zoneCommandInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitZoneCommand().catch((err) => {
          zoneCommandState.busy = false;
          zoneCommandState.mode = 'idle';
          zoneCommandState.error = true;
          zoneCommandState.helper = `Zone action failed: ${String(err?.message || err)}`;
          updateZoneCommandUi();
        });
      }
    });
  }
  if (zoneCommandButton) {
    zoneCommandButton.addEventListener('click', () => {
      submitZoneCommand().catch((err) => {
        zoneCommandState.busy = false;
        zoneCommandState.mode = 'idle';
        zoneCommandState.error = true;
        zoneCommandState.helper = `Zone action failed: ${String(err?.message || err)}`;
        updateZoneCommandUi();
      });
    });
  }
  updateZoneCommandUi();

  // onboarding mode tabs
  let mode = 'new';
  obModeTabs.forEach(t => {
    t.onclick = () => {
      obModeTabs.forEach(x => x.classList.remove('tab-active'));
      t.classList.add('tab-active');
      mode = t.dataset.mode === 'existing' ? 'existing' : 'new';
      existingInfo.classList.toggle('hidden', true);
      if (obPairCodeWrap) obPairCodeWrap.classList.toggle('hidden', mode !== 'existing');
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
      const code = String(obPairCode?.value || '').trim();

      const res = await client.call('identity.requestPair', {
        identityLabel: ilabel,
        deviceLabel: dlabel,
        code: code || undefined,
      }, { timeoutMs: 20000 });

      const usedCode = String(res?.code || code || '').trim();
      existingInfo.textContent = usedCode
        ? `Pairing code: ${usedCode}. Ask the owner to enter this in Settings > Devices > Add Device, then approve.`
        : 'Waiting for owner claim and approval…';
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

function startSharedRelayPipe(client, initialRelayUrls) {
  const ownerId = randomOpaqueId('relay-bridge');
  let relayBridgeOwner = false;
  let heartbeatTimer = null;
  let targetKey = '';
  let relayRuntime = null;
  let workerQuietTimer = null;
  let lastRelayRuntimeMessageAt = 0;
  let relayRxForwardInFlight = 0;
  let relayRxForwardDropped = 0;
  let relayRxForwardFiltered = 0;
  let relayRxForwardDeferred = 0;
  let relayRxForwardLastWarnAt = 0;
  let relayRxForwardSequence = 0;
  const relayRxForwardQueue = [];
  const relayRxAppIngressCounters = {
    accepted: 0,
    filtered: 0,
    deferred: 0,
    dropped: 0,
    forwarded: 0,
    acceptedByLane: {},
    acceptedByReason: {},
    filteredByReason: {},
    droppedByReason: {},
  };

  function clearWorkerQuietTimer() {
    if (!workerQuietTimer) return;
    clearTimeout(workerQuietTimer);
    workerQuietTimer = null;
  }

  function teardownRelayRuntime(reason = '') {
    clearWorkerQuietTimer();
    if (!relayRuntime) return;
    try {
      relayRuntime.postMessage?.({ type: 'relay.close' });
    } catch {}
    try {
      relayRuntime.close?.();
    } catch {}
    relayRuntime = null;
  }

  function readRelayBridgeLease() {
    try {
      const raw = localStorage.getItem(RELAY_BRIDGE_LEASE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeRelayBridgeLease() {
    const next = {
      ownerId,
      expiresAt: Date.now() + RELAY_BRIDGE_LEASE_MS,
    };
    try {
      localStorage.setItem(RELAY_BRIDGE_LEASE_KEY, JSON.stringify(next));
    } catch {}
    return next;
  }

  function updateRelayBridgeOwner(reason = '') {
    const lease = readRelayBridgeLease();
    const now = Date.now();
    const shouldOwn = !lease || Number(lease.expiresAt || 0) <= now || lease.ownerId === ownerId;
    if (shouldOwn) writeRelayBridgeLease();
    const nextOwner = shouldOwn;
    if (nextOwner !== relayBridgeOwner) {
      relayBridgeOwner = nextOwner;
    }
    return relayBridgeOwner;
  }

  function startRelayBridgeHeartbeat() {
    updateRelayBridgeOwner('init');
    heartbeatTimer = setInterval(() => {
      updateRelayBridgeOwner('heartbeat');
    }, RELAY_BRIDGE_HEARTBEAT_MS);
    window.addEventListener('storage', (ev) => {
      if (ev.key === RELAY_BRIDGE_LEASE_KEY) updateRelayBridgeOwner('storage');
    });
    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeatTimer);
      if (!relayBridgeOwner) return;
      const lease = readRelayBridgeLease();
      if (lease?.ownerId === ownerId) {
        try { localStorage.removeItem(RELAY_BRIDGE_LEASE_KEY); } catch {}
      }
    });
  }

  function warnRelayRxForward(message, error = null) {
    const now = Date.now();
    if (now - relayRxForwardLastWarnAt < 30_000) return;
    relayRxForwardLastWarnAt = now;
    const suffixParts = [];
    if (relayRxForwardDropped > 0) suffixParts.push(`${relayRxForwardDropped} dropped while busy`);
    if (relayRxForwardDeferred > 0) suffixParts.push(`${relayRxForwardDeferred} deferred by lane`);
    if (relayRxForwardQueue.length > 0) suffixParts.push(`${relayRxForwardQueue.length} queued`);
    if (relayRxForwardFiltered > 0) suffixParts.push(`${relayRxForwardFiltered} filtered before SW`);
    const workerFiltered = Number(relayPoolSnapshot?.ingress?.counters?.filtered || 0);
    if (workerFiltered > 0) suffixParts.push(`${workerFiltered} filtered before app`);
    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(', ')})` : '';
    console.warn(`[relay.rx] ${message}${suffix}`, error || '');
  }

  function incrementRelayRxAppCounter(bucket, classification = null) {
    const target = relayRxAppIngressCounters[bucket];
    if (typeof target === 'number') relayRxAppIngressCounters[bucket] = target + 1;
    const lane = String(classification?.lane || 'unknown');
    const reason = String(classification?.reason || 'unknown');
    if (bucket === 'accepted') {
      relayRxAppIngressCounters.acceptedByLane[lane] = (relayRxAppIngressCounters.acceptedByLane[lane] || 0) + 1;
      relayRxAppIngressCounters.acceptedByReason[reason] = (relayRxAppIngressCounters.acceptedByReason[reason] || 0) + 1;
    } else if (bucket === 'filtered') {
      relayRxAppIngressCounters.filteredByReason[reason] = (relayRxAppIngressCounters.filteredByReason[reason] || 0) + 1;
    } else if (bucket === 'dropped') {
      relayRxAppIngressCounters.droppedByReason[reason] = (relayRxAppIngressCounters.droppedByReason[reason] || 0) + 1;
    }
    publishRelayRxAppIngress();
  }

  function publishRelayRxAppIngress() {
    window.__constituteRelayAppIngress = {
      kind: 'app.ingress.posture',
      observedAt: Date.now(),
      inFlight: relayRxForwardInFlight,
      queued: relayRxForwardQueue.length,
      counters: {
        accepted: relayRxAppIngressCounters.accepted,
        filtered: relayRxAppIngressCounters.filtered,
        deferred: relayRxAppIngressCounters.deferred,
        dropped: relayRxAppIngressCounters.dropped,
        forwarded: relayRxAppIngressCounters.forwarded,
      },
      acceptedByLane: { ...relayRxAppIngressCounters.acceptedByLane },
      acceptedByReason: { ...relayRxAppIngressCounters.acceptedByReason },
      filteredByReason: { ...relayRxAppIngressCounters.filteredByReason },
      droppedByReason: { ...relayRxAppIngressCounters.droppedByReason },
    };
  }

  function classifyRelayRxIngress(data) {
    return relayRxIngressClassification(data, {
      context: relayAdmissionContext(),
      isAppHandled: (raw) => Boolean(parseGatewayRelayPayload(raw)),
    });
  }

  function relayAdmissionContext() {
    const memberRef = String(lastDeviceState?.pk || lastDeviceState?.devicePk || '').trim();
    return {
      memberRef,
      subscriberRef: memberRef || String(ownerId || '').trim(),
      identity: String(lastIdentity?.label || '').trim(),
      ownerId,
      zoneKeys: installZoneKeys(),
      surface: 'constitute-account',
    };
  }

  function publishRelayAdmissionContext() {
    relayRuntime?.postMessage?.({
      type: 'relay.context',
      context: relayAdmissionContext(),
    });
  }

  function findRelayRxEvictionIndex(nextPriority) {
    let worstIndex = -1;
    let worstPriority = nextPriority;
    let worstSequence = -1;
    relayRxForwardQueue.forEach((entry, index) => {
      if (entry.priority < worstPriority) return;
      if (entry.priority === worstPriority && entry.sequence <= worstSequence) return;
      worstPriority = entry.priority;
      worstSequence = entry.sequence;
      worstIndex = index;
    });
    return worstIndex;
  }

  function beginRelayRxForward(entry) {
    relayRxForwardInFlight += 1;
    incrementRelayRxAppCounter('forwarded', entry.classification);
    const msg = entry.msg;
    client.call('relay.rx', {
      data: msg.data,
      url: msg.url || '',
      admission: entry.classification.admission,
    }, { timeoutMs: RELAY_RX_FORWARD_TIMEOUT_MS })
      .catch((e) => warnRelayRxForward('rpc failed', e))
      .finally(() => {
        relayRxForwardInFlight = Math.max(0, relayRxForwardInFlight - 1);
        publishRelayRxAppIngress();
        drainRelayRxForwardQueue();
      });
  }

  function drainRelayRxForwardQueue() {
    while (relayRxForwardInFlight < RELAY_RX_FORWARD_MAX_IN_FLIGHT && relayRxForwardQueue.length > 0) {
      let nextIndex = 0;
      for (let i = 1; i < relayRxForwardQueue.length; i += 1) {
        const candidate = relayRxForwardQueue[i];
        const current = relayRxForwardQueue[nextIndex];
        if (candidate.priority < current.priority || (candidate.priority === current.priority && candidate.sequence < current.sequence)) {
          nextIndex = i;
        }
      }
      const [entry] = relayRxForwardQueue.splice(nextIndex, 1);
      beginRelayRxForward(entry);
    }
  }

  function forwardRelayRxToServiceWorker(msg) {
    // Keep app ingress aligned with the SW relay replay window before
    // expensive client.call forwarding consumes the bounded SW RPC slots.
    const classification = classifyRelayRxIngress(msg.data);
    if (!classification.accepted) {
      relayRxForwardFiltered += 1;
      incrementRelayRxAppCounter('filtered', classification);
      return;
    }
    incrementRelayRxAppCounter('accepted', classification);
    const entry = {
      msg,
      classification,
      priority: classification.priority,
      sequence: relayRxForwardSequence += 1,
      enqueuedAt: Date.now(),
    };
    if (relayRxForwardInFlight >= RELAY_RX_FORWARD_MAX_IN_FLIGHT) {
      relayRxForwardDeferred += 1;
      incrementRelayRxAppCounter('deferred', classification);
    }
    if (relayRxForwardQueue.length >= RELAY_RX_FORWARD_QUEUE_LIMIT) {
      const evictionIndex = findRelayRxEvictionIndex(entry.priority);
      if (evictionIndex < 0) {
        relayRxForwardDropped += 1;
        incrementRelayRxAppCounter('dropped', classification);
        warnRelayRxForward('service worker ingress saturated');
        return;
      }
      const [evicted] = relayRxForwardQueue.splice(evictionIndex, 1);
      relayRxForwardDropped += 1;
      incrementRelayRxAppCounter('dropped', evicted?.classification || classification);
      warnRelayRxForward('service worker ingress saturated');
    }
    relayRxForwardQueue.push(entry);
    publishRelayRxAppIngress();
    drainRelayRxForwardQueue();
  }

  function handleRelayRuntimeMessage(msg) {
    lastRelayRuntimeMessageAt = Date.now();
    if (msg.type === 'relay.ingress.status') {
      if (msg.ingress && typeof msg.ingress === 'object') {
        relayPoolSnapshot = { ...relayPoolSnapshot, ingress: msg.ingress };
        window.__constituteRelayIngress = msg.ingress;
      }
      return;
    }
    if (msg.type === 'relay.status') {
      const reason = [msg.reason || '', msg.code != null ? `code=${msg.code}` : ''].filter(Boolean).join(' ');
      if (msg.state === 'error' || msg.state === 'closed') {
        console.warn('[relay.worker]', msg.state, reason || '(no reason)');
      }
      const relayUrls = Array.isArray(msg.urls) ? msg.urls : (msg.url ? [msg.url] : []);
      const relayDetails = (msg.relays && typeof msg.relays === 'object')
        ? msg.relays
        : ((msg.url || '')
          ? {
              [msg.url]: {
                state: msg.state,
                code: msg.code ?? null,
                reason: msg.reason ?? '',
              },
            }
          : {});
      setRelayState(msg.state, reason, {
        version: String(msg.version || '').trim(),
        urls: relayUrls,
        relays: relayDetails,
        ingress: msg.ingress || relayPoolSnapshot.ingress || null,
      });
      if (bootRefreshSettled && clientReady && relayBridgeOwner) {
        client.call('relay.status', {
          state: msg.state,
          url: msg.url || '',
          urls: relayUrls,
          relays: relayDetails,
          ingress: msg.ingress || relayPoolSnapshot.ingress || null,
          code: msg.code ?? null,
          reason: msg.reason ?? ''
        }, { timeoutMs: 20000 }).catch((e) => console.error('relay.status rpc failed', e));
      }
      return;
    }
    if (msg.type === 'relay.rx' && typeof msg.data === 'string') {
      const gatewayPayload = parseGatewayRelayPayload(msg.data);
      if (gatewayPayload) {
        handleGatewayRelayPayload(gatewayPayload);
      }
      // During boot, let the shell recover local identity/device state first.
      // Once boot settles, relay ingress can flow back into the SW queue.
      if (bootRefreshSettled && clientReady && relayBridgeOwner) {
        forwardRelayRxToServiceWorker(msg);
      }
    }
  }

  function scheduleQuietFallback() {
    clearWorkerQuietTimer();
    workerQuietTimer = setTimeout(() => {
      if (!relayRuntime || relayRuntime.mode !== 'shared') return;
      if (lastRelayRuntimeMessageAt > 0) return;
      console.warn('[relay.bridge] shared worker quiet; falling back to dedicated runtime');
      startRelayRuntime('shared-timeout');
      if (targetKey) {
        relayRuntime?.postMessage?.({ type: 'relay.connect', urls: targetKey.split('\n').filter(Boolean), context: relayAdmissionContext() });
      }
    }, RELAY_WORKER_QUIET_TIMEOUT_MS);
  }

  function createSharedRelayRuntime() {
    const scriptUrl = relayWorkerScriptUrl();
    const worker = new SharedWorker(scriptUrl, {
      type: 'module',
      name: `constitute-account-relay-${SHELL_BUILD_ID}`,
    });
    const port = worker.port;
    port.start();
    port.onmessage = (ev) => handleRelayRuntimeMessage(ev.data || {});
    port.onmessageerror = (ev) => console.error('[relay.bridge] shared worker messageerror', ev);
    return {
      mode: 'shared',
      scriptUrl,
      postMessage: (msg) => port.postMessage(msg),
      close: () => {
        try { port.onmessage = null; } catch {}
        try { port.postMessage({ type: 'relay.close' }); } catch {}
      },
    };
  }

  function createDedicatedRelayRuntime() {
    const scriptUrl = relayWorkerScriptUrl();
    const worker = new Worker(scriptUrl, {
      type: 'module',
      name: `constitute-account-relay-dedicated-${SHELL_BUILD_ID}`,
    });
    worker.onmessage = (ev) => handleRelayRuntimeMessage(ev.data || {});
    worker.onerror = (ev) => console.error('[relay.bridge] dedicated worker error', ev?.message || ev);
    worker.onmessageerror = (ev) => console.error('[relay.bridge] dedicated worker messageerror', ev);
    return {
      mode: 'dedicated',
      scriptUrl,
      postMessage: (msg) => worker.postMessage(msg),
      close: () => worker.terminate(),
    };
  }

  function startRelayRuntime(reason = 'init') {
    teardownRelayRuntime(`restart:${reason}`);
    lastRelayRuntimeMessageAt = 0;
    const preferDedicated = browserPrefersDedicatedRelayWorker();
    try {
      relayRuntime = preferDedicated ? createDedicatedRelayRuntime() : createSharedRelayRuntime();
    } catch (err) {
      console.warn('[relay.bridge] shared worker unavailable; using dedicated runtime', err);
      relayRuntime = createDedicatedRelayRuntime();
    }
    if (relayRuntime.mode === 'shared') scheduleQuietFallback();
    publishRelayAdmissionContext();
    relayRuntime.postMessage({ type: 'relay.status' });
    return relayRuntime;
  }

  function updateTargets(urls, reason = 'update') {
    const targets = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const nextKey = targets.join('\n');
    if (nextKey === targetKey) return false;
    targetKey = nextKey;
    relayRuntime?.postMessage?.({ type: 'relay.connect', urls: targets, context: relayAdmissionContext() });
    return true;
  }

  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (relayBridgeOwner && m.type === 'relay.tx' && typeof m.data === 'string') {
      relayRuntime?.postMessage?.({ type: 'relay.send', frame: m.data });
    }
  });

  startRelayBridgeHeartbeat();
  startRelayRuntime('init');
  publishRelayAdmissionContext();
  updateTargets(initialRelayUrls, 'init');

  async function flushBootState() {
    if (!clientReady || !updateRelayBridgeOwner('flush')) return false;
    const relayUrls = Array.isArray(relayPoolSnapshot?.urls) ? relayPoolSnapshot.urls : [];
    const relayDetails = (relayPoolSnapshot?.relays && typeof relayPoolSnapshot.relays === 'object')
      ? relayPoolSnapshot.relays
      : {};
    try {
      await client.call('relay.status', {
        state: relayPoolSnapshot?.state || relayState,
        url: '',
        urls: relayUrls,
        relays: relayDetails,
        ingress: relayPoolSnapshot?.ingress || null,
        code: null,
        reason: relayPoolSnapshot?.reason || '',
      }, { timeoutMs: 20000 });
    } catch (e) {
      console.error('relay.status rpc failed', e);
      return false;
    }
    return true;
  }

  return {
    updateTargets,
    updateAdmissionContext: publishRelayAdmissionContext,
    flushBootState,
    isOwner: () => relayBridgeOwner,
    close: () => teardownRelayRuntime('api-close'),
  };
}

(async function main() {
  // Keep activity panes hidden until identity/device gating completes.
  panePathEl.textContent = '';
  setBootSplash();
  markShellBoot('shell.boot.start');

  client = new IdentityClient({
    debug: shellBootDebugEnabled,
    onEvent: (evt) => {
      if (evt?.type === 'log') {
        return;
      }
      if (evt?.type === 'swarm_signal') {
        if (swarm) swarm.onSignal(evt).catch(() => {});
      }
      if (evt?.type === 'gateway_service_install_status') {
        handleGatewayServiceInstallStatusEvent(evt);
      }
      if (evt?.type === 'gateway_zone_sync_status') {
        handleGatewayZoneSyncStatusEvent(evt);
      }
      if (evt?.type === 'gateway_grant_status') {
        handleGatewayGrantStatusEvent(evt);
      }
      if (evt?.type === 'notify') scheduleRefreshAll();
    }
  });

  bootFromRuntimeSnapshot();

  swarm = new SwarmTransport({ client, onState: (s) => setSwarmState(s) });
  swarm.loadSuccess();
  swarm.loadIdentityCache();
  swarm.loadDeviceCache();
  lastSwarmDevices = currentSwarmDeviceRecords();
  pushRuntimeManagedApplianceSourceSnapshot(lastIdentity?.devices || [], lastSwarmDevices);
  swarm.loadLastKnown();
  const fallbackPeers = swarm.getFallbackPeers();
  if (fallbackPeers && fallbackPeers.length > 0) {
    swarm.setPeers(fallbackPeers.map(pk => ({ devicePk: pk })));
  }

  loadGatewayExtraZones();
  wireUi();
  renderConnectionModel('init');
  renderNotifications();

  // Default radio selection: webauthn if supported
  setSecurityChoice('webauthn');

  try {
    await client.ready();
    clientReady = client.isServiceWorkerAvailable();
    markShellBoot('shell.client-ready');
    if (clientReady) {
      if (!relayBridge) {
        relayBridge = startSharedRelayPipe(client, desiredRelayUrls([], []));
      } else {
        relayBridge.updateTargets?.(desiredRelayUrls(lastIdentity?.devices || [], lastSwarmDevices || []), 'client-ready');
      }
    } else {
      setDaemonState('offline', 'sw unavailable');
    }

    let core = null;
    try {
      core = await refreshCoreState();
      bootRefreshSettled = true;
      relayBridge?.flushBootState?.();
      clearShellBootFallbackTimer();
      tryDismissShellBootSplash('shell.first-paint.core');
    } catch (coreError) {
      console.warn('shell core refresh failed', coreError);
      setDaemonState('offline', 'rpc failed');
      bootRefreshSettled = true;
      clearShellBootFallbackTimer();
      renderConnectionModel('core-refresh-failed');
      tryDismissShellBootSplash('shell.first-paint.core-failed');
      scheduleRefreshAll(3000);
      return;
    }

    const linked = await ensureOnboardingFlow();
    if (linked) {
      setSettingsTab('devices');
      await postIdentityLinkedFlow();
    } else {
      await applyUrlParams();
    }

    void refreshExtendedState(core).catch((err) => {
      console.error('refreshExtendedState failed', err);
      renderConnectionModel('extended-refresh-failed');
    });
  } catch (e) {
    console.error('shell client boot failed', e);
    setDaemonState('offline', 'rpc failed');
    bootRefreshSettled = true;
    clearShellBootFallbackTimer();
    tryDismissShellBootSplash('shell.first-paint.error');
  }

  // Health check: if SW drops, fall back to onboarding.
  setInterval(async () => {
    try {
      await client.call('device.getState', {}, { timeoutMs: 5000 });
      setDaemonState('online', 'rpc ok');
    } catch {
      setDaemonState('offline', 'rpc fail');
      renderConnectionModel('health-check-failed');
    }
  }, 10000);
})();

