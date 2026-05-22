import {
  AGREEMENT,
  FABRIC,
  PROJECTION,
  SERVICE_REGISTRY,
  SWARM,
  STREAM_SESSION_LIFECYCLE_PHASE,
  applyProjectionDelta,
  assertActionAuthorityExercise,
  assertActionAuthorityGrant,
  assertProjectionDelta,
  assertAccessGroup,
  assertAccessEpoch,
  assertAuthorityGrantRevocationPosture,
  assertAuthorityMultiIdentityProof,
  assertAuthorityRootOperation,
  assertEventAdmissionEnvelope,
  assertEventFabricAccessClass,
  assertEventFabricProcessorContract,
  assertCybersecProcessorSeed,
  assertConsumerFloor,
  assertContractTarget,
  assertContractTargetRegistryPosture,
  assertMaterializationBudget,
  assertPrivateContentEnvelope,
  assertProjectionPolicy,
  assertProjectionRecord,
  assertProjectionSnapshot,
  assertServiceRegistryClaim,
  assertServiceRegistryMaterialization,
  assertHostFabricFulfillmentPlan,
  assertHostFabricMemberContribution,
  assertLifecyclePlanPosture,
  assertResolvedMemberRef,
  assertSubstrateAssociationHandoff,
  assertProjectionRepairPosture,
  assertResourcePosture,
  assertResourceProfile,
  assertRetentionReleasePosture,
  assertRoutePromise,
  assertRuntimeActivationRequest,
  assertSelfCapabilityAssessment,
  assertMediaFulfillmentEvidence,
  assertMediaTransportObservation,
  assertContributionLifecycle,
  assertStreamSessionCandidate,
  assertSubscriptionContract,
  assertSwarmActivation,
  assertSwarmFrame,
  assertSwarmInteraction,
  makeLogEventEnvelope,
  openEnvelope,
  makeProjectionRepairRequest,
  makeSwarmFrame,
  pubkeyFromSecretKey,
  sealEnvelope,
  eventPlaneForRecordKind,
  streamSessionLifecycleRecordFromCarrier,
  streamSessionLifecyclePhase,
} from "constitute-protocol";
import { deriveRuntimeShellState } from "./runtime-shell-state.js";

const RUNTIME_VERSION = Object.freeze({ major: 2, minor: 57 });
const RUNTIME_WORKER_BUILD_ID = `runtime-${RUNTIME_VERSION.major}.${RUNTIME_VERSION.minor}`;
const APPLIANCE_DISCOVERY_MAX_AGE_MS = 60 * 60 * 1000;
const RUNTIME_STATE_KEY = `runtime.shared.state.v${RUNTIME_VERSION.major}`;
const RUNTIME_META_KEY = `runtime.shared.meta.v${RUNTIME_VERSION.major}`;
const SERVICE_CATALOG_GET = 'service.catalog.get';
const SERVICE_NODE_GET = 'service.node.get';
const PROJECTION_GET = 'projection.get';
const PROJECTION_PUT = 'projection.put';
const PROJECTION_POLICY_PUT = 'projection.policy.put';
const RUNTIME_AUTHORITY_DEVICE_PUT = 'runtime.authority.device.put';
const RUNTIME_AUTHORITY_POSTURE_GET = 'runtime.authority.posture.get';
const RUNTIME_AUTHORITY_RECORDS_REDUCE = 'runtime.authority.records.reduce';
const RUNTIME_MEDIA_TRANSPORT_PROFILE_GET = 'runtime.media.transport.profile.get';
const RUNTIME_MEDIA_TRANSPORT_OBSERVATION_PUT = 'runtime.media.transport.observation.put';
const RUNTIME_MEDIA_FULFILLMENT_EVIDENCE_PUT = 'runtime.media.fulfillment.evidence.put';
const RUNTIME_RESOURCE_SAMPLE_GET = 'runtime.resource.sample.get';
const RUNTIME_RESOURCE_PROFILE_GET = 'runtime.resource.profile.get';
const RUNTIME_RESOURCE_PROFILE_PUT = 'runtime.resource.profile.put';
const RUNTIME_RETENTION_RELEASE_EVALUATE = 'runtime.retention.release.evaluate';
const SWARM_FRAME_QUEUE = 'swarm.frame.queue';
const SWARM_QUEUE_GET = 'swarm.queue.get';
const SWARM_EDGE_ATTACH = 'swarm.edge.attach';
const SWARM_EDGE_DISCONNECT = 'swarm.edge.disconnect';
const SWARM_EDGE_TEST_CONNECT = 'swarm.edge.test.connect';
const SWARM_EDGE_TEST_DISCONNECT = 'swarm.edge.test.disconnect';
const SWARM_EDGE_TEST_RECEIVE = 'swarm.edge.test.receive';
const SWARM_EDGE_SENT_GET = 'swarm.edge.sent.get';
const SWARM_EDGE_ACK = 'swarm.edge.ack';
const SWARM_EDGE_REJECT = 'swarm.edge.reject';
const CONTRIBUTION_LIFECYCLE_LIMIT = 100;
const RUNTIME_DIAGNOSTICS_SUBSCRIBE = 'runtime.diagnostics.subscribe';
const RUNTIME_DIAGNOSTICS_UNSUBSCRIBE = 'runtime.diagnostics.unsubscribe';
const RUNTIME_DIAGNOSTICS_COMMAND = 'runtime.diagnostics.command';
const RUNTIME_DIAGNOSTIC_EVENT = 'runtime.diagnostic.event';
const RUNTIME_DIAGNOSTIC_COMMAND_RESULT = 'runtime.diagnostic.command.result';
const RUNTIME_DIAGNOSTICS_CHANNEL = 'runtime.diagnostics';
const RUNTIME_DIAGNOSTIC_RING_LIMIT = 300;
const RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT = 30;
const RUNTIME_DIAGNOSTIC_REPLAY_LIMIT = 80;
const RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT = 8;
const RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT = 600;
const RUNTIME_DIAGNOSTIC_DEFAULT_REPLAY_LIMIT = 80;
const RUNTIME_DIRECTORY_OBSERVE_CHANNEL = 'swarm.directory';
const RUNTIME_DIRECTORY_OBSERVE_MIN_INTERVAL_MS = 10_000;
const BYTES_GIB = 1024 * 1024 * 1024;
const RESOURCE_PROFILE_DEFINITIONS = Object.freeze({
  thinClient: Object.freeze({
    id: 'thinClient',
    label: 'Thin client',
    memoryBudgetBytes: 1 * BYTES_GIB,
    storageBudgetBytes: 1 * BYTES_GIB,
    hotTtlMs: 30_000,
    warmTtlMs: 5 * 60_000,
    caps: Object.freeze({ diagnostics: 120, projections: 128, mediaTracks: 2, liveStreams: 1, devBridgeSessions: 0 }),
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    memoryBudgetBytes: 1.5 * BYTES_GIB,
    storageBudgetBytes: 2 * BYTES_GIB,
    hotTtlMs: 90_000,
    warmTtlMs: 15 * 60_000,
    caps: Object.freeze({ diagnostics: RUNTIME_DIAGNOSTIC_RING_LIMIT, projections: 256, mediaTracks: 4, liveStreams: 2, devBridgeSessions: 2 }),
  }),
  offlineFirst: Object.freeze({
    id: 'offlineFirst',
    label: 'Offline first',
    memoryBudgetBytes: 2 * BYTES_GIB,
    storageBudgetBytes: 0,
    storageReserveBytes: 1 * BYTES_GIB,
    storageBudgetPolicy: 'deviceAvailableMinusReserve',
    hotTtlMs: 5 * 60_000,
    warmTtlMs: 60 * 60_000,
    caps: Object.freeze({ diagnostics: RUNTIME_DIAGNOSTIC_RING_LIMIT, projections: 1024, mediaTracks: 4, liveStreams: 2, devBridgeSessions: 1 }),
  }),
  archiveNode: Object.freeze({
    id: 'archiveNode',
    label: 'Archive node',
    memoryBudgetBytes: 1 * BYTES_GIB,
    storageBudgetBytes: 900 * BYTES_GIB,
    hotTtlMs: 5 * 60_000,
    warmTtlMs: 24 * 60 * 60_000,
    caps: Object.freeze({ diagnostics: RUNTIME_DIAGNOSTIC_RING_LIMIT, projections: 4096, mediaTracks: 2, liveStreams: 1, devBridgeSessions: 0 }),
  }),
  operatorDev: Object.freeze({
    id: 'operatorDev',
    label: 'Operator dev',
    memoryBudgetBytes: 2 * BYTES_GIB,
    storageBudgetBytes: 4 * BYTES_GIB,
    hotTtlMs: 5 * 60_000,
    warmTtlMs: 30 * 60_000,
    caps: Object.freeze({ diagnostics: RUNTIME_DIAGNOSTIC_RING_LIMIT, projections: 512, mediaTracks: 6, liveStreams: 3, devBridgeSessions: 8 }),
  }),
});
const RESOURCE_POSTURE_STATES = Object.freeze({
  WITHIN_BUDGET: 'withinBudget',
  PRESSURE: 'pressure',
  OVER_BUDGET: 'overBudget',
  SWEEPING: 'sweeping',
  BLOCKED: 'blocked',
});
const RUNTIME_APP_INTENT = Object.freeze({
  CAPABILITY_RESOLVE: 'runtime.capability.resolve',
  CHANNEL_RESOLVE: 'runtime.channel.resolve',
  PROJECTION_OBSERVE: 'runtime.projection.observe',
  STREAM_OPEN: 'runtime.stream.open',
  STREAM_CONTROL: 'runtime.stream.control',
  STREAM_CLOSE: 'runtime.stream.close',
  STREAM_RECOVERY_REQUEST: 'runtime.stream.recovery.request',
  STORAGE_PIN: 'runtime.storage.pin',
  DIAGNOSTIC_LOG: 'runtime.diagnostics.log',
});
const NVR_SERVICE_ID = 'nvr';
const NVR_STREAM_CHANNEL = 'nvr.streams';
const RUNTIME_SWARM_RECEIVE_CAPABILITY_REFS = [
  SWARM.CORE_CAPABILITY.SWARM_EDGE_ATTACH,
  SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
  SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
  SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL,
  SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
  SWARM.CORE_CAPABILITY.PROJECTION_DELTA_APPLY,
  SWARM.CORE_CAPABILITY.ROUTE_OBSERVATION_PUBLISH,
  SWARM.CORE_CAPABILITY.STORAGE_PIN,
  'service.intent.invoke',
];
const RUNTIME_SWARM_RECEIVE_CHANNEL_REFS = [
  RUNTIME_DIRECTORY_OBSERVE_CHANNEL,
  'swarm.route',
  'nvr.streams',
  'nvr.surface',
  'nvr.health',
  'nvr.cameras',
  'nvr.cameraNetwork',
  'logging.surface',
  'logging.events',
  'logging.health',
  'logging.dashboard',
  'storage.pin.intent',
  'storage.pin.attestation',
];
const PROJECTION_SNAPSHOT_APPLY = 'projection.snapshot.apply';
const PROJECTION_DELTA_APPLY = 'projection.delta.apply';
const PROJECTION_SYNC_REQUEST_TIMEOUT_MS = 45_000;
const PROJECTION_SYNC_RETRY_MS = 5_000;
const PROJECTION_REPAIR_REQUEST_LIMIT = 32;
const SERVICE_ADMISSION_TIMEOUT_MS = 12_000;
const DEFAULT_LOGGING_SYNC_TARGET_COUNT = 2_500;
const DEFAULT_LOGGING_POLICY_ID = 'logging.default.72h.low';
const RUNTIME_LOGGING_PROJECTION_SERVICE_PK = 'runtime:logging:local-safe-diagnostics';
const RUNTIME_LOGGING_PROJECTION_CHANNELS = new Set(['logging.events', 'logging.health', 'logging.dashboard']);
const RUNTIME_MEDIA_TRANSPORT_PROFILE_ID = 'runtime.media.browser-webrtc.default';
const RUNTIME_MEDIA_TRANSPORT_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
]);

const DB_NAME = 'constitute_db';
const DB_VER = 1;
const BACKUP_CACHE = 'constitute_kv_backup_v1';
const BACKUP_PREFIX = '/__constitute_kv__/';
const IDB_OPERATION_TIMEOUT_MS = 1500;
const AUTHORITY_POSTURE_STORAGE_LOOKUP_TIMEOUT_MS = 250;
const AUTHORITY_STORAGE_HYDRATION_TIMEOUT_MS = 2500;
const PENDING_AUTHORITY_INTENT_LIMIT = 64;
let runtimeHydrationWarningLogged = false;
let runtimeAuthorityStorageHydrationWarningLogged = false;
const inboundEnvelopeReplayIds = new Set();
let runtimeAuthorityDevice = null;
let runtimeAuthorityPostureState = {
  state: 'waitingAuthority',
  ready: false,
  authorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
  reason: 'runtime authority has not been handed off by account',
  source: 'startup',
  updatedAt: 0,
};
let runtimeAuthorityStorageHydrationPromise = null;
const pendingAuthorityIntents = new Map();
const pendingRouteIntents = new Map();
let flushingPendingAuthorityIntents = false;
let flushingPendingRouteIntents = false;
let runtimeResourceProfileId = 'balanced';
let runtimeResourceProfileOverrides = {};

function withTimeout(label, work, timeoutMs = IDB_OPERATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = self.setTimeout(() => {
      reject(new Error(`${label}: timed out`));
    }, timeoutMs);
    Promise.resolve()
      .then(work)
      .then((value) => {
        self.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        self.clearTimeout(timer);
        reject(error);
      });
  });
}

function openDB() {
  return withTimeout('indexedDB.open', () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB.open blocked'));
  }));
}

async function withDbRetry(label, work, attempts = 2) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const db = await openDB();
      return await work(db);
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 30 * (index + 1)));
      }
    }
  }
  throw new Error(`${label}: ${String(lastError?.message || lastError || 'database failure')}`);
}

async function kvGet(key) {
  const label = `kvGet(${String(key || '')})`;
  try {
    const value = await withDbRetry(label, async (db) => await withTimeout(`${label}.tx`, () => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`${label}: transaction aborted`));
      const st = tx.objectStore('kv');
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })));
    if (typeof value !== 'undefined') return value;
  } catch {
    // Fall through to the same backup cache used by the identity service worker.
  }
  return await backupGet(key);
}

async function kvSet(key, value) {
  const label = `kvSet(${String(key || '')})`;
  let idbError = null;
  try {
    await withDbRetry(label, async (db) => await withTimeout(`${label}.tx`, () => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`${label}: transaction aborted`));
    })));
  } catch (error) {
    idbError = error;
  }
  const backupOk = await backupSet(key, value);
  if (idbError && !backupOk) {
    throw new Error(`${label}: ${String(idbError?.message || idbError || 'database failure')}`);
  }
  return {
    ok: true,
    backend: idbError ? 'cacheBackup' : backupOk ? 'indexedDbAndCacheBackup' : 'indexedDb',
    degraded: Boolean(idbError),
    error: idbError ? String(idbError?.message || idbError || 'database failure') : '',
  };
}

async function kvDelete(key) {
  const label = `kvDelete(${String(key || '')})`;
  await withDbRetry(label, async (db) => await withTimeout(`${label}.tx`, () => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error(`${label}: transaction aborted`));
  })));
  await backupDelete(key);
}

function backupRequestForKey(key) {
  return new Request(`${BACKUP_PREFIX}${encodeURIComponent(String(key || ''))}`);
}

function runtimeCaches() {
  if (typeof caches !== 'undefined') return caches;
  if (typeof self !== 'undefined' && self.caches) return self.caches;
  return null;
}

async function backupGet(key) {
  const api = runtimeCaches();
  if (!api?.open) return undefined;
  try {
    const cache = await api.open(BACKUP_CACHE);
    const hit = await cache.match(backupRequestForKey(key));
    if (!hit) return undefined;
    const raw = await hit.json().catch(() => null);
    if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'v')) return undefined;
    return raw.v;
  } catch {
    return undefined;
  }
}

async function backupSet(key, value) {
  const api = runtimeCaches();
  if (!api?.open) return false;
  try {
    const cache = await api.open(BACKUP_CACHE);
    await cache.put(
      backupRequestForKey(key),
      new Response(JSON.stringify({ v: value }), { headers: { 'content-type': 'application/json' } }),
    );
    return true;
  } catch {
    return false;
  }
}

async function backupDelete(key) {
  const api = runtimeCaches();
  if (!api?.open) return;
  try {
    const cache = await api.open(BACKUP_CACHE);
    await cache.delete(backupRequestForKey(key));
  } catch {}
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function isGatewayRecord(rec) {
  const role = normalizeRole(rec?.role || rec?.type || '');
  const service = normalizeRole(rec?.service || '');
  return role === 'gateway' || service === 'gateway';
}

function isNvrRecord(rec) {
  const role = normalizeRole(rec?.role || rec?.type || '');
  const service = normalizeRole(rec?.service || '');
  return role === 'nvr' || service === 'nvr';
}

function isManagedServiceRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (isGatewayRecord(rec)) return false;
  const deviceKind = normalizeRole(rec?.deviceKind || rec?.device_kind || '');
  const service = normalizeRole(rec?.service || '');
  const hostGatewayPk = String(rec?.hostGatewayPk || rec?.host_gateway_pk || '').trim();
  const servicePk = String(rec?.servicePk || rec?.service_pk || '').trim();
  return Boolean(service && service !== 'none' && (deviceKind === 'service' || hostGatewayPk || servicePk));
}

function ownedPkSet(identityDevices) {
  return new Set(
    (Array.isArray(identityDevices) ? identityDevices : [])
      .map((d) => String(d?.pk || d?.devicePk || '').trim())
      .filter(Boolean),
  );
}

const endpoints = new Map();
const pendingBrokerRequests = new Map();
const projectionPolicies = new Map();
const pendingProjectionSyncRequests = new Map();
const retainedProjections = new Map();
const outboundSwarmFrames = new Map();
const serviceAdmissionTimeoutTimers = new Map();
const mediaFulfillmentPostures = new Map();
const streamRecoveryPostures = new Map();
const runtimeEvents = [];
const diagnosticLoggingSubscriberIds = new Set();
const diagnosticAdmissionCounters = {
  forwarded: 0,
  filtered: 0,
  replayed: 0,
  replayFiltered: 0,
};
const runtimeSessionId = randomOpaqueId('runtime-session');
const runtimeStatus = {
  shell: null,
  services: {},
};
const managedState = {
  sourceSnapshot: {
    identityDevices: [],
    swarmDevices: [],
    grantedRecords: [],
    managedServiceIssue: null,
  },
  applianceSnapshot: {
    owned: [],
    granted: [],
    discoverable: [],
  },
  resourceNames: {},
  managedServiceIssue: null,
  hostedGatewaySnapshots: {},
};

let brokerClientId = '';
let runtimeUpdatedAt = 0;
let hydratePromise = null;
let persistTimer = 0;
let projectionSyncTimer = 0;
let diagnosticLoggingEnabled = false;
let diagnosticLoggingWindowStartedAt = 0;
let diagnosticLoggingWindowCount = 0;
let diagnosticLoggingFlushTimer = 0;
const diagnosticLoggingBacklog = [];
const diagnosticLoggingBacklogIds = new Set();
const diagnosticLoggingBacklogById = new Map();
const diagnosticLoggingQueuedEventIds = new Set();
let runtimeDirectoryObserveLastQueuedAt = 0;
let runtimeDirectoryObserveInFlight = false;
const swarmEdge = {
  mode: 'detached',
  connected: false,
  endpoint: '',
  sessionId: '',
  memberRef: '',
  zoneScope: null,
  socket: null,
  sentFrames: [],
  rejections: [],
  repairRequests: [],
  routeObservations: [],
  contributionLifecycles: [],
};
let liveSwarmEdgeAttachInFlight = null;
let liveSwarmEdgeAttachInFlightTarget = '';

const RUNTIME_SAFE_CLONE_MATERIALIZATION_BUDGET = Object.freeze(assertMaterializationBudget({
  kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
  budgetId: 'runtime.worker.safe-clone.local',
  sourceAuthority: 'runtime.worker',
  consumerRef: 'runtime.worker.local-boundary',
  payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
  copyRole: SWARM.MATERIALIZATION_COPY_ROLE.BUFFER,
  transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
  privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
  state: SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET,
  limits: { scope: 'local-runtime-boundary' },
  snapshotPolicy: { mode: 'point-copy' },
  deltaPolicy: { mode: 'not-applicable' },
  coalescing: { key: 'call-site' },
  cardinality: { posture: 'call-site-owned' },
  schema: {
    state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
    version: 'runtime.safeClone.v1',
  },
  issuedAt: 1,
}));

function nowMs() {
  return Date.now();
}

function copyMaterializedValue(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.slice ? value.slice(0) : value;
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [key, next] of value.entries()) out.set(copyMaterializedValue(key, seen), copyMaterializedValue(next, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const next of value.values()) out.add(copyMaterializedValue(next, seen));
    return out;
  }
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const next of value) out.push(copyMaterializedValue(next, seen));
    return out;
  }
  const out = {};
  seen.set(value, out);
  for (const [key, next] of Object.entries(value)) out[key] = copyMaterializedValue(next, seen);
  return out;
}

function safeClone(value, materializationBudget = RUNTIME_SAFE_CLONE_MATERIALIZATION_BUDGET) {
  if (value == null) return value;
  if (materializationBudget?.transferMode === SWARM.MATERIALIZATION_TRANSFER_MODE.REFERENCE_ONLY) return value;
  try {
    return copyMaterializedValue(value);
  } catch {
    return value;
  }
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

function withoutUpdatedAt(value) {
  const out = value && typeof value === 'object' ? safeClone(value) : {};
  delete out.updatedAt;
  return out;
}

function isLocalhostRuntime() {
  try {
    const host = String(self.location?.hostname || '').trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return (value && typeof value === 'object') ? value : {};
}

function uniqueTrimmedStrings(values) {
  const out = [];
  for (const value of normalizeArray(values)) {
    const trimmed = String(value || '').trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

const DIAGNOSTIC_REDACTED = '[redacted]';
const DIAGNOSTIC_SENSITIVE_KEY_RE = /(?:payload|body|envelope|secret|credential|password|token|private|decrypted|grant|sdp|candidate|url|uri|authorization|capabilityid|servicecapability)/i;
const DIAGNOSTIC_SENSITIVE_VALUE_RE = /\b(?:rtsp|rtsps|http|https|ws|wss):\/\//i;
const diagnosticCommandNonces = new Set();
const runtimeDiagnosticCommands = new Set([
  'dumpRecentEvents',
  'routeExplain',
  'projectionExplain',
  'activationExplain',
  'resourceSample',
  'requestProjectionRepair',
  'flushDiagnosticsToLogging',
  'openTestActivation',
  'closeTestActivation',
]);

function sanitizeDiagnosticValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (DIAGNOSTIC_SENSITIVE_VALUE_RE.test(value)) return DIAGNOSTIC_REDACTED;
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (DIAGNOSTIC_SENSITIVE_KEY_RE.test(String(key || ''))) {
        out[key] = DIAGNOSTIC_REDACTED;
        continue;
      }
      out[key] = sanitizeDiagnosticValue(entry, depth + 1);
    }
    return out;
  }
  return String(value);
}

function diagnosticLevelFor(kind, detail = {}) {
  const explicit = String(detail.level || '').trim().toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(explicit)) return explicit;
  const text = `${kind} ${detail?.error?.code || ''} ${detail?.error?.message || ''} ${detail?.message || ''}`.toLowerCase();
  if (/reject|failed|failure|error|replay|denied|invalid/.test(text)) return 'error';
  if (/unreachable|degraded|repair|timeout|stale|warn/.test(text)) return 'warn';
  if (/attach|queued|sent|projection|route|adapter/.test(text)) return 'info';
  if (/\back\b/.test(text)) return 'info';
  if (/\baccepted\b/.test(text)) return 'info';
  return 'debug';
}

function pickDiagnosticField(detail, ...names) {
  for (const name of names) {
    const value = String(detail?.[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function canonicalDiagnosticEvent(kind, detail = {}) {
  const source = normalizeObject(detail);
  const eventKind = String(kind || source.kind || '').trim() || 'runtime.event';
  const safeDetail = sanitizeDiagnosticValue(source);
  return {
    eventId: String(source.eventId || source.diagnosticId || '').trim() || randomOpaqueId('runtime-event'),
    recordKind: 'runtime.diagnostic.event',
    channelId: RUNTIME_DIAGNOSTICS_CHANNEL,
    kind: eventKind,
    level: diagnosticLevelFor(eventKind, source),
    observedAt: Number(source.observedAt || source.occurredAt || 0) || nowMs(),
    buildId: RUNTIME_WORKER_BUILD_ID,
    runtimeSessionId,
    surface: String(source.surface || '').trim(),
    clientId: String(source.clientId || '').trim(),
    frameId: pickDiagnosticField(source, 'frameId', 'ackedFrameId'),
    correlationId: pickDiagnosticField(source, 'correlationId', 'requestId'),
    requestId: pickDiagnosticField(source, 'requestId'),
    activationId: pickDiagnosticField(source, 'activationId'),
    routePromiseId: pickDiagnosticField(source, 'routePromiseId'),
    projectionKey: pickDiagnosticField(source, 'projectionKey'),
    projectionId: pickDiagnosticField(source, 'projectionId'),
    service: pickDiagnosticField(source, 'service'),
    channelRef: pickDiagnosticField(source, 'channelId', 'channelRef'),
    capabilityRef: pickDiagnosticField(source, 'capabilityRef', 'capability'),
    safeFacts: safeDetail,
    detail: safeDetail,
  };
}

function diagnosticSnapshot() {
  return {
    buildId: RUNTIME_WORKER_BUILD_ID,
    runtimeSessionId,
    channelId: RUNTIME_DIAGNOSTICS_CHANNEL,
    capabilities: ['runtime.diagnostics.observe', 'runtime.diagnostics.command', 'runtime.resource.sample'],
    eventCount: runtimeEvents.length,
    eventAdmission: {
      ...diagnosticAdmissionCounters,
    },
    loggingSink: {
      enabled: diagnosticLoggingEnabled,
      rateLimitPerMinute: RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT,
      backlogCount: diagnosticLoggingBacklog.length,
      materializationBudget: diagnosticLoggingBacklogMaterializationBudget(),
    },
    materialization: diagnosticMaterializationSnapshot(),
    commandChannel: {
      enabled: true,
      commands: Array.from(runtimeDiagnosticCommands),
    },
  };
}

function diagnosticMaterializationSnapshot() {
  const summaries = [];
  const loggingBudget = diagnosticLoggingBacklogMaterializationBudget();
  summaries.push({
    clientId: 'runtime',
    surface: 'diagnostic-logging-sink',
    budgetId: loggingBudget.budgetId,
    payloadClass: loggingBudget.payloadClass,
    copyRole: loggingBudget.copyRole,
    transferMode: loggingBudget.transferMode,
    state: loggingBudget.state,
    consumerFloor: safeClone(loggingBudget.consumerFloor || null),
  });
  for (const endpoint of endpoints.values()) {
    const clientId = String(endpoint.clientId || '').trim();
    const surface = String(endpoint.diagnosticSurface || endpoint.surface || '').trim();
    for (const budget of [
      endpoint?.runtimeSnapshotMaterializationBudget,
      endpoint?.diagnosticMaterializationBudget,
    ]) {
      if (!budget) continue;
      summaries.push({
        clientId,
        surface,
        budgetId: budget.budgetId,
        payloadClass: budget.payloadClass,
        copyRole: budget.copyRole,
        transferMode: budget.transferMode,
        state: budget.state,
        consumerFloor: safeClone(budget.consumerFloor || null),
      });
    }
    const commandBudget = endpoint?.diagnosticCommandMaterializationBudget;
    if (commandBudget) {
      summaries.push({
        clientId,
        surface,
        budgetId: commandBudget.budgetId,
        payloadClass: commandBudget.payloadClass,
        copyRole: commandBudget.copyRole,
        transferMode: commandBudget.transferMode,
        state: commandBudget.state,
        consumerFloor: safeClone(commandBudget.consumerFloor || null),
      });
    }
  }
  return summaries;
}

function materializationStateRank(state) {
  const normalized = String(state || '').trim();
  const ranks = {
    [SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET]: 0,
    [SWARM.RESOURCE_POSTURE_STATE.PRESSURE]: 1,
    [SWARM.RESOURCE_POSTURE_STATE.OVER_BUDGET]: 2,
    [SWARM.RESOURCE_POSTURE_STATE.SWEEPING]: 2,
    [SWARM.RESOURCE_POSTURE_STATE.BLOCKED]: 3,
    [SWARM.RESOURCE_POSTURE_STATE.UNAVAILABLE]: 3,
  };
  return Object.prototype.hasOwnProperty.call(ranks, normalized) ? ranks[normalized] : 3;
}

function materializationWorstState(budgets) {
  let state = SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET;
  for (const budget of normalizeArray(budgets)) {
    const nextState = String(budget?.state || SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET).trim();
    if (materializationStateRank(nextState) > materializationStateRank(state)) state = nextState;
  }
  return state;
}

function materializationBudgetSummary(budget) {
  if (!budget) return null;
  return {
    budgetId: String(budget.budgetId || '').trim(),
    consumerRef: String(budget.consumerRef || '').trim(),
    payloadClass: String(budget.payloadClass || '').trim(),
    copyRole: String(budget.copyRole || '').trim(),
    transferMode: String(budget.transferMode || '').trim(),
    privacyTier: String(budget.privacyTier || '').trim(),
    state: String(budget.state || SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET).trim(),
    blockedReasons: normalizeArray(budget.blockedReasons).map((entry) => String(entry || '').trim()).filter(Boolean),
    retentionClass: String(budget.retentionClass || '').trim(),
    referenceRefs: normalizeArray(budget.referenceRefs).map((entry) => String(entry || '').trim()).filter(Boolean),
    limits: budget.limits && typeof budget.limits === 'object' ? safeClone(budget.limits) : {},
    snapshotPolicy: budget.snapshotPolicy && typeof budget.snapshotPolicy === 'object' ? safeClone(budget.snapshotPolicy) : {},
    deltaPolicy: budget.deltaPolicy && typeof budget.deltaPolicy === 'object' ? safeClone(budget.deltaPolicy) : {},
    coalescing: budget.coalescing && typeof budget.coalescing === 'object' ? safeClone(budget.coalescing) : {},
    cardinality: budget.cardinality && typeof budget.cardinality === 'object' ? safeClone(budget.cardinality) : {},
    releaseAfter: Number(budget.releaseAfter || 0) || 0,
    expiresAt: Number(budget.expiresAt || 0) || 0,
    consumerFloor: budget.consumerFloor ? {
      floorId: String(budget.consumerFloor.floorId || '').trim(),
      lagState: String(budget.consumerFloor.lagState || '').trim(),
      ackFloor: String(budget.consumerFloor.ackFloor || '').trim(),
      witnessFloor: String(budget.consumerFloor.witnessFloor || '').trim(),
      compactionFloor: String(budget.consumerFloor.compactionFloor || '').trim(),
    } : null,
  };
}

function materializationStateForCount(count, limit) {
  const value = Math.max(0, Number(count || 0) || 0);
  const cap = Math.max(0, Number(limit || 0) || 0);
  if (!cap) return SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET;
  if (value > cap) return SWARM.RESOURCE_POSTURE_STATE.OVER_BUDGET;
  if (value >= cap * 0.8) return SWARM.RESOURCE_POSTURE_STATE.PRESSURE;
  return SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET;
}

function runtimeMaterializationConsumerFloor({
  materializationId,
  consumerRef = 'runtime.read-model',
  subjectRef = '',
  cursor = '',
  count = 0,
  sampledAt = nowMs(),
  replayMode = 'snapshot',
  duplicatePolicy = 'replaceLatest',
  lagState = SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP,
  reason = '',
}) {
  const normalizedId = String(materializationId || '').trim();
  const normalizedCursor = String(cursor || count || 0);
  const floor = {
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${normalizedId}`,
    consumerRef: String(consumerRef || 'runtime.read-model').trim() || 'runtime.read-model',
    materializationId: normalizedId,
    subjectRef: String(subjectRef || normalizedId).trim() || normalizedId,
    lagState,
    cursor: normalizedCursor,
    ackFloor: normalizedCursor,
    witnessFloor: normalizedCursor,
    compactionFloor: normalizedCursor,
    eventTimeFloor: sampledAt,
    observedTimeFloor: sampledAt,
    replay: { mode: replayMode, count: Number(count || 0) || 0 },
    redelivery: { mode: replayMode, duplicatePolicy },
    sampledAt,
    expiresAt: sampledAt + 60_000,
  };
  if (reason) floor.reason = reason;
  return assertConsumerFloor(floor);
}

function runtimeReadModelMaterializationBudget({
  budgetId,
  subjectRef,
  count = 0,
  limit = 0,
  payloadClass = SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
  copyRole = SWARM.MATERIALIZATION_COPY_ROLE.PROJECTION,
  transferMode = SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
  privacyTier = SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
  snapshotMode = 'runtime-snapshot-section',
  deltaMode = 'runtime-delta',
  coalescingKey = '',
  retentionClass = 'ephemeral.runtime-read-model',
  schemaVersion = '',
  sampledAt = nowMs(),
}) {
  const state = materializationStateForCount(count, limit);
  const blockedReasons = state === SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET
    ? []
    : [`${String(budgetId || 'runtime.materialization').replace(/[^a-z0-9]+/gi, '.')}.pressure`];
  const normalizedBudgetId = String(budgetId || '').trim();
  const cursor = String(count || 0);
  const reason = blockedReasons[0] || '';
  const budget = {
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: normalizedBudgetId,
    sourceAuthority: `runtime:${runtimeSessionId}`,
    consumerRef: 'runtime.read-model',
    payloadClass,
    copyRole,
    transferMode,
    privacyTier,
    state,
    limits: {
      count: Number(count || 0) || 0,
      limit: Number(limit || 0) || 0,
      fanout: endpoints.size,
    },
    snapshotPolicy: { mode: snapshotMode },
    deltaPolicy: { mode: deltaMode },
    coalescing: { key: coalescingKey || normalizedBudgetId, duplicatePolicy: 'replaceLatest' },
    cardinality: { maxCount: Number(limit || 0) || 0, keySpace: coalescingKey || normalizedBudgetId },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: schemaVersion || `${normalizedBudgetId}.v1`,
    },
    consumerFloor: runtimeMaterializationConsumerFloor({
      materializationId: normalizedBudgetId,
      subjectRef,
      cursor,
      count,
      sampledAt,
      replayMode: snapshotMode,
      duplicatePolicy: 'replaceLatest',
      lagState: state === SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET
        ? SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP
        : SWARM.MATERIALIZATION_LAG_STATE.LAGGING,
      reason,
    }),
    blockedReasons,
    retentionClass,
    issuedAt: sampledAt,
    releaseAfter: sampledAt + 60_000,
    expiresAt: sampledAt + 5 * 60_000,
  };
  return assertMaterializationBudget(budget);
}

function runtimeReadModelMaterializationBudgets(sampledAt = nowMs()) {
  const profile = runtimeResourceProfile();
  const caps = normalizeObject(profile.caps);
  const edgeObservationCount = swarmEdge.rejections.length
    + swarmEdge.repairRequests.length
    + swarmEdge.routeObservations.length
    + swarmEdge.contributionLifecycles.length;
  return [
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.queue.outbound',
      subjectRef: 'runtime.swarmQueue',
      count: outboundSwarmFrames.size,
      limit: PENDING_AUTHORITY_INTENT_LIMIT,
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.CONTROL,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.BUFFER,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
      snapshotMode: 'bounded-queue-snapshot',
      deltaMode: 'queue-status-delta',
      coalescingKey: 'frameId',
      retentionClass: 'ephemeral.runtime-queue',
      sampledAt,
    }),
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.swarmEdge.observations',
      subjectRef: 'runtime.swarmEdge',
      count: edgeObservationCount,
      limit: 100 + PROJECTION_REPAIR_REQUEST_LIMIT + CONTRIBUTION_LIFECYCLE_LIMIT + 100,
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.EVIDENCE,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
      snapshotMode: 'bounded-edge-observation-rings',
      deltaMode: 'edge-observation-delta',
      coalescingKey: 'routePromiseId|frameId|repairId|contributionId',
      retentionClass: 'ephemeral.runtime-edge-evidence',
      sampledAt,
    }),
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.activations.read-model',
      subjectRef: 'runtime.activationResolutions',
      count: pendingAuthorityIntents.size + pendingRouteIntents.size + outboundSwarmFrames.size,
      limit: PENDING_AUTHORITY_INTENT_LIMIT * 3,
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.PROJECTION,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
      snapshotMode: 'activation-read-model',
      deltaMode: 'activation-posture-delta',
      coalescingKey: 'activationId|routePromiseId|frameId',
      retentionClass: 'ephemeral.runtime-activation-posture',
      sampledAt,
    }),
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.media.fulfillment',
      subjectRef: 'runtime.mediaFulfillment',
      count: mediaFulfillmentPostures.size,
      limit: Math.max(1, Number(caps.mediaTracks || 4) || 4) * 4,
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.EVIDENCE,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
      snapshotMode: 'media-evidence-posture',
      deltaMode: 'media-evidence-delta',
      coalescingKey: 'sessionId|activationId|evidenceKind',
      retentionClass: 'ephemeral.runtime-media-evidence',
      sampledAt,
    }),
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.stream.recovery',
      subjectRef: 'runtime.streamRecovery',
      count: streamRecoveryPostures.size,
      limit: Math.max(1, Number(caps.liveStreams || 2) || 2) * 4,
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.BUFFER,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
      snapshotMode: 'stream-recovery-posture',
      deltaMode: 'stream-recovery-delta',
      coalescingKey: 'sessionId|activationId',
      retentionClass: 'ephemeral.runtime-stream-recovery',
      sampledAt,
    }),
    runtimeReadModelMaterializationBudget({
      budgetId: 'runtime.retained.catalog',
      subjectRef: 'runtime.catalog',
      count: Object.keys(managedState.applianceSnapshot?.owned || {}).length
        + Object.keys(managedState.applianceSnapshot?.granted || {}).length
        + Object.keys(managedState.applianceSnapshot?.discoverable || {}).length
        + Object.keys(runtimeStatus.services || {}).length,
      limit: Math.max(1, Number(caps.projections || 256) || 256),
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.CACHE,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
      snapshotMode: 'retained-catalog-read-model',
      deltaMode: 'catalog-delta',
      coalescingKey: 'serviceRef|applianceRef|catalogKey',
      retentionClass: 'ephemeral.runtime-catalog',
      sampledAt,
    }),
  ];
}

function runtimeProjectionStoreConsumerFloor(sampledAt = nowMs()) {
  const materializationId = 'runtime.projections.retained';
  const currentRevision = Array.from(retainedProjections.values()).reduce((max, projection) => {
    const coverage = projectionCoverage(projection);
    return Math.max(max, Number(coverage.revision || 0) || 0);
  }, 0);
  const cursor = String(currentRevision || retainedProjections.size);
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${materializationId}`,
    consumerRef: 'runtime.read-model',
    materializationId,
    subjectRef: 'runtime.projections',
    lagState: SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP,
    cursor,
    ackFloor: cursor,
    witnessFloor: cursor,
    compactionFloor: cursor,
    eventTimeFloor: sampledAt,
    observedTimeFloor: sampledAt,
    replay: { mode: 'projection-store', projectionCount: retainedProjections.size },
    redelivery: { mode: 'snapshot-repair', duplicatePolicy: 'projectionKey' },
    sampledAt,
    expiresAt: sampledAt + 60_000,
  });
}

function runtimeProjectionStoreMaterializationBudget(sampledAt = nowMs()) {
  const profile = runtimeResourceProfile();
  const projectionLimit = Math.max(1, Number(profile?.caps?.projections || 256) || 256);
  const projectionCountValue = retainedProjections.size;
  const state = projectionCountValue > projectionLimit
    ? SWARM.RESOURCE_POSTURE_STATE.OVER_BUDGET
    : projectionCountValue >= projectionLimit * 0.8
      ? SWARM.RESOURCE_POSTURE_STATE.PRESSURE
      : SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET;
  const blockedReasons = state === SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET
    ? []
    : ['projectionStoreMaterializationPressure'];
  return assertMaterializationBudget({
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: 'runtime.projections.retained',
    sourceAuthority: `runtime:${runtimeSessionId}`,
    consumerRef: 'runtime.read-model',
    payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
    copyRole: SWARM.MATERIALIZATION_COPY_ROLE.CACHE,
    transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.REFERENCE_ONLY,
    privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
    state,
    limits: {
      projectionCount: projectionCountValue,
      projectionPolicyCount: projectionPolicies.size,
      maxProjectionCount: projectionLimit,
    },
    snapshotPolicy: { mode: 'retained-projection-store' },
    deltaPolicy: { mode: 'projection-delta-apply' },
    coalescing: { key: 'projectionKey', duplicatePolicy: 'replaceLatest' },
    cardinality: {
      maxProjectionCount: projectionLimit,
      keySpace: 'projectionId|channelId|scope',
    },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: 'runtime.projections.retained.v1',
    },
    consumerFloor: runtimeProjectionStoreConsumerFloor(sampledAt),
    referenceRefs: ['runtime.projections.retained'],
    blockedReasons,
    retentionClass: 'ephemeral.runtime-projection-cache',
    issuedAt: sampledAt,
    releaseAfter: sampledAt + 60_000,
    expiresAt: sampledAt + 5 * 60_000,
  });
}

function runtimeEventRingConsumerFloor(sampledAt = nowMs()) {
  const materializationId = 'runtime.events.ring';
  const last = runtimeEvents[runtimeEvents.length - 1] || null;
  const cursor = String(last?.eventId || runtimeEvents.length);
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${materializationId}`,
    consumerRef: 'runtime.diagnostics.read-model',
    materializationId,
    subjectRef: RUNTIME_DIAGNOSTICS_CHANNEL,
    lagState: SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP,
    cursor,
    ackFloor: String(runtimeEvents.length),
    witnessFloor: String(runtimeEvents.length),
    compactionFloor: String(Math.max(0, runtimeEvents.length - RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT)),
    eventTimeFloor: Number(last?.observedAt || 0) || sampledAt,
    observedTimeFloor: sampledAt,
    replay: { mode: SWARM.EVENT_DELIVERY_MODE.REPLAY, replayLimit: RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT },
    redelivery: { mode: 'ring-snapshot', duplicatePolicy: 'eventId' },
    sampledAt,
    expiresAt: sampledAt + 60_000,
  });
}

function runtimeEventRingMaterializationBudget(sampledAt = nowMs()) {
  const state = runtimeEvents.length >= RUNTIME_DIAGNOSTIC_RING_LIMIT
    ? SWARM.RESOURCE_POSTURE_STATE.PRESSURE
    : SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET;
  return assertMaterializationBudget({
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: 'runtime.events.ring',
    sourceAuthority: `runtime:${runtimeSessionId}`,
    consumerRef: 'runtime.diagnostics.read-model',
    payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
    copyRole: SWARM.MATERIALIZATION_COPY_ROLE.BUFFER,
    transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
    privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
    state,
    limits: {
      eventCount: runtimeEvents.length,
      snapshotEventCount: Math.min(runtimeEvents.length, RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT),
      ringLimit: RUNTIME_DIAGNOSTIC_RING_LIMIT,
    },
    snapshotPolicy: { mode: 'bounded-ring-tail' },
    deltaPolicy: { mode: 'append-only-coalesced' },
    coalescing: { key: 'eventId' },
    cardinality: {
      maxEventCount: RUNTIME_DIAGNOSTIC_RING_LIMIT,
      highCardinalityOverflow: 'dropOldest',
    },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: 'runtime.events.ring.v1',
    },
    consumerFloor: runtimeEventRingConsumerFloor(sampledAt),
    blockedReasons: state === SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET ? [] : ['runtimeEventRingPressure'],
    retentionClass: 'ephemeral.runtime-diagnostics',
    issuedAt: sampledAt,
    releaseAfter: sampledAt + 60_000,
    expiresAt: sampledAt + 5 * 60_000,
  });
}

function runtimeMaterializationSummary(sampledAt = nowMs()) {
  const readModelBudgets = runtimeReadModelMaterializationBudgets(sampledAt);
  const budgets = [
    runtimeProjectionStoreMaterializationBudget(sampledAt),
    runtimeEventRingMaterializationBudget(sampledAt),
    diagnosticLoggingBacklogMaterializationBudget(sampledAt),
    ...readModelBudgets,
    ...Array.from(endpoints.values())
      .map((endpoint) => endpoint?.runtimeSnapshotMaterializationBudget)
      .filter(Boolean),
  ];
  const state = materializationWorstState(budgets);
  const budgetSummaries = budgets.map((budget) => materializationBudgetSummary(budget)).filter(Boolean);
  const countBy = (field) => budgetSummaries.reduce((out, budget) => {
    const key = String(budget?.[field] || 'unknown').trim() || 'unknown';
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  const readModels = [];
  for (const budget of budgetSummaries) {
    if (!String(budget.budgetId || '').startsWith('runtime.')) continue;
    readModels.push({
      budgetId: budget.budgetId,
      payloadClass: budget.payloadClass,
      copyRole: budget.copyRole,
      transferMode: budget.transferMode,
      state: budget.state,
      subjectRef: String(budget.consumerFloor?.materializationId || budget.budgetId || '').trim(),
      count: Number(budget.limits?.count ?? budget.limits?.projectionCount ?? budget.limits?.eventCount ?? 0) || 0,
      limit: Number(budget.limits?.limit ?? budget.limits?.maxProjectionCount ?? budget.limits?.ringLimit ?? 0) || 0,
    });
  }
  return {
    kind: 'runtime.materialization.summary',
    state,
    reason: state === SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET
      ? ''
      : budgetSummaries
        .flatMap((budget) => budget.blockedReasons)
        .filter(Boolean)
        .join(', '),
    budgets: budgetSummaries,
    readModels,
    byPayloadClass: countBy('payloadClass'),
    byCopyRole: countBy('copyRole'),
    byTransferMode: countBy('transferMode'),
    byState: countBy('state'),
    fanout: endpoints.size,
    projectionCount: retainedProjections.size,
    projectionPolicyCount: projectionPolicies.size,
    runtimeEventCount: runtimeEvents.length,
    diagnosticLoggingBacklogCount: diagnosticLoggingBacklog.length,
    sampledAt,
  };
}

function runtimeSnapshotConsumerFloor(endpoint, sampledAt = nowMs()) {
  const clientId = String(endpoint?.clientId || 'runtime-surface').trim() || 'runtime-surface';
  const materializationId = `materialization:${clientId}:runtime-snapshot`;
  const runtimeFloor = Math.max(0, Number(runtimeUpdatedAt || sampledAt));
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${materializationId}`,
    consumerRef: clientId,
    materializationId,
    subjectRef: 'runtime.snapshot',
    lagState: SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP,
    cursor: String(runtimeFloor),
    ackFloor: String(runtimeFloor),
    witnessFloor: String(runtimeFloor),
    compactionFloor: String(runtimeFloor),
    eventTimeFloor: runtimeFloor,
    observedTimeFloor: Math.max(sampledAt, runtimeFloor),
    replay: { mode: 'snapshot', replayLimit: 1 },
    redelivery: { mode: 'replace', duplicatePolicy: 'coalesceByConsumer' },
    sampledAt,
  });
}

function runtimeSnapshotDeliveryLimits(endpoint) {
  const subscription = endpoint?.snapshotSubscription && typeof endpoint.snapshotSubscription === 'object'
    ? endpoint.snapshotSubscription
    : {};
  const replayLimit = Number(subscription.replayLimit ?? RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT);
  const snapshotMaxBytes = Number(subscription.snapshotMaxBytes || 512 * 1024);
  return {
    replayLimit: Number.isFinite(replayLimit)
      ? Math.max(0, Math.min(RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT, replayLimit))
      : RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT,
    snapshotMaxBytes: Number.isFinite(snapshotMaxBytes) && snapshotMaxBytes > 0 ? snapshotMaxBytes : 512 * 1024,
    deliveryMode: String(subscription.mode || 'push'),
  };
}

function objectEntryCount(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function estimatedRuntimeSnapshotBytes(snapshot) {
  const eventCount = normalizeArray(snapshot.runtimeEvents).length;
  const projectionCountValue = objectEntryCount(snapshot.projections);
  const queueCount = objectEntryCount(snapshot.swarmQueue);
  const activationCount = objectEntryCount(snapshot.activationResolutions);
  const mediaCount = objectEntryCount(snapshot.mediaFulfillment);
  const recoveryCount = objectEntryCount(snapshot.streamRecovery);
  const serviceCountValue = normalizeArray(snapshot.serviceCatalog?.services).length
    || objectEntryCount(snapshot.services);
  return 48 * 1024
    + eventCount * 1536
    + projectionCountValue * 4096
    + queueCount * 2048
    + activationCount * 2048
    + mediaCount * 1536
    + recoveryCount * 768
    + serviceCountValue * 2048;
}

function materializeRuntimeSnapshotForEndpoint(snapshot, endpoint, sampledAt = nowMs()) {
  const next = {
    ...snapshot,
    runtimeEvents: normalizeArray(snapshot.runtimeEvents),
  };
  const limits = runtimeSnapshotDeliveryLimits(endpoint);
  const sourceEventCount = next.runtimeEvents.length;
  let droppedByReplayLimit = 0;
  if (sourceEventCount > limits.replayLimit) {
    next.runtimeEvents = next.runtimeEvents.slice(-limits.replayLimit);
    droppedByReplayLimit = sourceEventCount - next.runtimeEvents.length;
  }
  let estimatedSnapshotBytes = estimatedRuntimeSnapshotBytes(next);
  let droppedByByteCount = 0;
  while (next.runtimeEvents.length > 0 && estimatedSnapshotBytes > limits.snapshotMaxBytes) {
    next.runtimeEvents.shift();
    droppedByByteCount += 1;
    estimatedSnapshotBytes = estimatedRuntimeSnapshotBytes(next);
  }
  const deliveredRuntimeEventCount = normalizeArray(next.runtimeEvents).length;
  next.materialization = {
    ...(next.materialization && typeof next.materialization === 'object' ? next.materialization : {}),
    delivery: {
      kind: 'runtime.snapshot.materialization.delivery',
      estimateMode: 'bounded-counts',
      consumerRef: String(endpoint?.clientId || 'runtime-surface').trim() || 'runtime-surface',
      sourceRuntimeEventCount: sourceEventCount,
      deliveredRuntimeEventCount,
      droppedByReplayLimit,
      droppedByByteCount,
      estimatedSnapshotBytes,
      snapshotMaxBytes: limits.snapshotMaxBytes,
      replayLimit: limits.replayLimit,
      sampledAt,
    },
  };
  return {
    snapshot: next,
    delivery: next.materialization.delivery,
  };
}

function runtimeSnapshotMaterializationBudget(endpoint, sampledAt = nowMs(), delivery = {}) {
  const clientId = String(endpoint?.clientId || 'runtime-surface').trim() || 'runtime-surface';
  const limits = runtimeSnapshotDeliveryLimits(endpoint);
  const materializationId = `materialization:${clientId}:runtime-snapshot`;
  const estimatedSnapshotBytes = Number(delivery.estimatedSnapshotBytes || 0) || 0;
  const droppedByByteCount = Number(delivery.droppedByByteCount || 0) || 0;
  const state = estimatedSnapshotBytes > limits.snapshotMaxBytes
    ? SWARM.RESOURCE_POSTURE_STATE.OVER_BUDGET
    : (droppedByByteCount > 0 ? SWARM.RESOURCE_POSTURE_STATE.PRESSURE : SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET);
  const blockedReasons = [
    ...(estimatedSnapshotBytes > limits.snapshotMaxBytes ? ['runtimeSnapshotByteCapExceeded'] : []),
    ...(droppedByByteCount > 0 ? ['runtimeSnapshotByteCapApplied'] : []),
  ];
  return assertMaterializationBudget({
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: materializationId,
    sourceAuthority: 'runtime:shared',
    consumerRef: clientId,
    payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
    copyRole: SWARM.MATERIALIZATION_COPY_ROLE.PROJECTION,
    transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
    privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
    state,
    limits: {
      maxFanout: endpoints.size || 1,
      snapshotMaxBytes: limits.snapshotMaxBytes,
      replayLimit: limits.replayLimit,
      deliveryMode: limits.deliveryMode,
      estimatedSnapshotBytes,
      sourceRuntimeEventCount: Number(delivery.sourceRuntimeEventCount || 0) || 0,
      deliveredRuntimeEventCount: Number(delivery.deliveredRuntimeEventCount || 0) || 0,
      droppedByReplayLimit: Number(delivery.droppedByReplayLimit || 0) || 0,
      droppedByByteCount,
    },
    snapshotPolicy: {
      mode: 'baselineAndRepair',
      initialDelivery: 'runtime.attached',
      repairDelivery: 'runtime.snapshot',
    },
    deltaPolicy: {
      mode: 'coalescedSnapshotUntilDeltaClient',
      coalescingKey: clientId,
    },
    coalescing: {
      key: clientId,
      duplicatePolicy: 'replaceLatest',
    },
    cardinality: {
      maxProjectionCount: 64,
      maxRuntimeEventCount: RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT,
    },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: RUNTIME_WORKER_BUILD_ID,
    },
    consumerFloor: runtimeSnapshotConsumerFloor(endpoint, sampledAt),
    blockedReasons,
    retentionClass: 'ephemeral.runtime-snapshot',
    issuedAt: sampledAt,
    expiresAt: sampledAt + 60_000,
  });
}

function refreshRuntimeSnapshotMaterialization(endpoint, delivery = {}) {
  if (!endpoint) return null;
  const sampledAt = nowMs();
  endpoint.runtimeSnapshotMaterializationBudget = runtimeSnapshotMaterializationBudget(endpoint, sampledAt, delivery);
  return endpoint.runtimeSnapshotMaterializationBudget;
}

function diagnosticLevelRank(level) {
  const value = String(level || '').trim().toLowerCase();
  if (value === 'error' || value === 'critical') return 40;
  if (value === 'warn' || value === 'warning') return 30;
  if (value === 'info') return 20;
  if (value === 'debug') return 10;
  return 10;
}

function diagnosticClaimedSeverity(level) {
  const value = String(level || '').trim().toLowerCase();
  if (value === 'warn') return 'warning';
  if (['debug', 'info', 'notice', 'warning', 'error', 'critical'].includes(value)) return value;
  return 'debug';
}

function diagnosticPlaneForEvent(event) {
  const kind = String(event?.kind || '').trim();
  return eventPlaneForRecordKind(kind, event);
}

function diagnosticEventPriority(event, plane) {
  const planePriority = {
    [SWARM.EVENT_PLANE.AUTHORITY]: 10,
    [SWARM.EVENT_PLANE.ROUTE]: 20,
    [SWARM.EVENT_PLANE.ACTIVATION]: 30,
    [SWARM.EVENT_PLANE.PROJECTION_REPAIR]: 35,
    [SWARM.EVENT_PLANE.CONTRIBUTION]: 38,
    [SWARM.EVENT_PLANE.RETENTION]: 40,
    [SWARM.EVENT_PLANE.PROJECTION]: 55,
    [SWARM.EVENT_PLANE.DIAGNOSTIC]: 70,
    [SWARM.EVENT_PLANE.LOGGING_REPLAY]: 80,
    [SWARM.EVENT_PLANE.BULK_RETAINED_DATA]: 90,
    [SWARM.EVENT_PLANE.DEV_BRIDGE]: 95,
  }[plane] ?? 80;
  const level = diagnosticLevelRank(event?.level || 'debug');
  return Math.max(1, planePriority - Math.floor(level / 10));
}

function normalizeDiagnosticSubscription(message = {}, endpoint = null) {
  const issuedAt = nowMs();
  const source = normalizeObject(message.subscription);
  const planes = Array.isArray(source.planes)
    ? source.planes
    : Array.isArray(message.planes)
      ? message.planes
      : Object.values(SWARM.EVENT_PLANE);
  const cost = {
    ...normalizeObject(source.cost),
    ...normalizeObject(message.cost),
  };
  if (message.minLevel !== undefined && cost.minLevel === undefined) cost.minLevel = message.minLevel;
  if (message.minLevelByPlane !== undefined && cost.minLevelByPlane === undefined) {
    cost.minLevelByPlane = safeClone(message.minLevelByPlane);
  }
  if (message.denyKinds !== undefined && cost.denyKinds === undefined) {
    cost.denyKinds = safeClone(message.denyKinds);
  }
  const replayLimit = Math.min(
    RUNTIME_DIAGNOSTIC_RING_LIMIT,
    Math.max(0, Number(message.limit || source.window?.replayLimit || RUNTIME_DIAGNOSTIC_DEFAULT_REPLAY_LIMIT)),
  );
  const subscription = {
    kind: SWARM.RECORD_KIND.SUBSCRIPTION_CONTRACT,
    subscriptionId: String(source.subscriptionId || message.subscriptionId || `runtime-diagnostics:${message.clientId || endpoint?.clientId || randomOpaqueId('subscriber')}`).trim(),
    subscriberRef: String(source.subscriberRef || message.clientId || endpoint?.clientId || 'runtime-diagnostics').trim(),
    publisherRef: String(source.publisherRef || `runtime:${runtimeSessionId}`).trim(),
    planes,
    subjectSelector: {
      ...normalizeObject(source.subjectSelector),
      recordKind: RUNTIME_DIAGNOSTIC_EVENT,
    },
    audience: {
      ...normalizeObject(source.audience),
      surface: String(message.surface || endpoint?.surface || '').trim(),
      clientId: String(message.clientId || endpoint?.clientId || '').trim(),
    },
    window: {
      ...normalizeObject(source.window),
      replayLimit,
    },
    cost,
    proof: {
      requirement: SWARM.EVENT_PROOF_REQUIREMENT.NONE,
      ...normalizeObject(source.proof),
    },
    delivery: {
      mode: SWARM.EVENT_DELIVERY_MODE.PUSH,
      ...normalizeObject(source.delivery),
    },
    backpressure: {
      behavior: SWARM.EVENT_BACKPRESSURE_BEHAVIOR.DROP,
      ...normalizeObject(source.backpressure),
    },
    capabilityRefs: source.capabilityRefs,
    authorityRefs: source.authorityRefs,
    issuedAt: Number(source.issuedAt || issuedAt),
    expiresAt: Number(source.expiresAt || 0) || undefined,
  };
  return assertSubscriptionContract(subscription);
}

function diagnosticKindDenied(kind, subscription) {
  const denyKinds = normalizeArray(subscription?.cost?.denyKinds);
  const eventKind = String(kind || '').trim();
  return denyKinds.some((entry) => {
    const rule = String(entry || '').trim();
    if (!rule) return false;
    if (rule.endsWith('*')) return eventKind.startsWith(rule.slice(0, -1));
    return eventKind === rule;
  });
}

function diagnosticEventMatchesSubscription(event, subscription) {
  const plane = diagnosticPlaneForEvent(event);
  if (subscription && !normalizeArray(subscription.planes).includes(plane)) {
    return { accepted: false, plane, reason: 'planeNotSubscribed' };
  }
  if (diagnosticKindDenied(event?.kind, subscription)) {
    return { accepted: false, plane, reason: 'kindDenied' };
  }
  const cost = normalizeObject(subscription?.cost);
  const minLevelByPlane = normalizeObject(cost.minLevelByPlane);
  const minLevel = String(minLevelByPlane[plane] || cost.minLevel || 'debug').trim();
  if (diagnosticLevelRank(event?.level) < diagnosticLevelRank(minLevel)) {
    return { accepted: false, plane, reason: 'belowMinLevel' };
  }
  return { accepted: true, plane, reason: 'subscribed' };
}

function diagnosticAdmissionForEvent(event, endpoint, match) {
  const decision = match.accepted
    ? SWARM.EVENT_ADMISSION_DECISION.FORWARD
    : SWARM.EVENT_ADMISSION_DECISION.DROP;
  const observedAt = nowMs();
  const subscription = endpoint?.diagnosticSubscription || null;
  return assertEventAdmissionEnvelope({
    kind: SWARM.RECORD_KIND.EVENT_ADMISSION,
    admissionId: `${String(event?.eventId || randomOpaqueId('event')).trim()}:diagnostic-admission:${String(endpoint?.clientId || '').trim() || 'anonymous'}`,
    plane: match.plane,
    laneId: `runtime.diagnostics.${match.plane}`,
    subscriptionId: subscription?.subscriptionId,
    publisherRef: `runtime:${runtimeSessionId}`,
    subscriberRef: String(endpoint?.clientId || subscription?.subscriberRef || '').trim() || 'runtime-diagnostics',
    subject: {
      eventId: String(event?.eventId || '').trim(),
      kind: String(event?.kind || '').trim(),
      channelRef: String(event?.channelRef || '').trim(),
      frameId: String(event?.frameId || '').trim(),
      projectionKey: String(event?.projectionKey || '').trim(),
    },
    audience: {
      surface: String(endpoint?.diagnosticSurface || endpoint?.surface || '').trim(),
      clientId: String(endpoint?.clientId || '').trim(),
    },
    claimedSeverity: diagnosticClaimedSeverity(event?.level),
    effectivePriority: diagnosticEventPriority(event, match.plane),
    decision,
    proofRequirement: SWARM.EVENT_PROOF_REQUIREMENT.NONE,
    proofState: SWARM.EVENT_PROOF_STATE.NOT_REQUIRED,
    reason: match.reason,
    observedAt,
    expiresAt: observedAt + 30_000,
  });
}

function diagnosticEventsForSubscription(subscription, limit) {
  const selected = [];
  let filtered = 0;
  for (let index = runtimeEvents.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = runtimeEvents[index];
    const match = diagnosticEventMatchesSubscription(event, subscription);
    if (match.accepted) selected.push(safeClone(event));
    else filtered += 1;
  }
  diagnosticAdmissionCounters.replayed += selected.length;
  diagnosticAdmissionCounters.replayFiltered += filtered;
  return selected.reverse();
}

function diagnosticCommandQuery(args = {}) {
  const sinceMs = Number(args.sinceMs || 0);
  const since = sinceMs > 0 ? nowMs() - sinceMs : Number(args.since || 0);
  return {
    since,
    surface: String(args.surface || '').trim(),
    kind: String(args.kind || '').trim(),
    level: String(args.level || '').trim().toLowerCase(),
    limit: Math.min(RUNTIME_DIAGNOSTIC_RING_LIMIT, Math.max(1, Number(args.limit || 80))),
  };
}

function diagnosticCommandSubscription(query, endpoint, command = 'dumpRecentEvents') {
  const clientId = String(endpoint?.clientId || 'runtime-diagnostic-command').trim() || 'runtime-diagnostic-command';
  const issuedAt = nowMs();
  const inherited = endpoint?.diagnosticSubscription && typeof endpoint.diagnosticSubscription === 'object'
    ? endpoint.diagnosticSubscription
    : {};
  return assertSubscriptionContract({
    kind: SWARM.RECORD_KIND.SUBSCRIPTION_CONTRACT,
    subscriptionId: `runtime-diagnostics-command:${clientId}:${String(command || 'query').trim() || 'query'}`,
    subscriberRef: clientId,
    publisherRef: `runtime:${runtimeSessionId}`,
    planes: normalizeArray(inherited.planes).length ? inherited.planes : Object.values(SWARM.EVENT_PLANE),
    subjectSelector: {
      recordKind: RUNTIME_DIAGNOSTIC_EVENT,
      ...(query.surface ? { surface: query.surface } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.level ? { level: query.level } : {}),
    },
    audience: {
      surface: String(endpoint?.diagnosticSurface || endpoint?.surface || '').trim(),
      clientId,
    },
    window: {
      replayLimit: query.limit,
      ...(query.since ? { since: query.since } : {}),
    },
    cost: {
      ...normalizeObject(inherited.cost),
      queryMode: 'command',
    },
    proof: {
      requirement: SWARM.EVENT_PROOF_REQUIREMENT.NONE,
    },
    delivery: {
      mode: SWARM.EVENT_DELIVERY_MODE.REPLAY,
    },
    backpressure: {
      behavior: SWARM.EVENT_BACKPRESSURE_BEHAVIOR.DROP,
    },
    issuedAt,
    expiresAt: issuedAt + 60_000,
  });
}

function diagnosticEventMatchesCommandQuery(event, subscription, query) {
  const match = diagnosticEventMatchesSubscription(event, subscription);
  if (!match.accepted) return match;
  if (query.since && Number(event.observedAt || 0) < query.since) {
    return { accepted: false, plane: match.plane, reason: 'beforeQueryWindow' };
  }
  if (query.surface && String(event.surface || '').trim() !== query.surface) {
    return { accepted: false, plane: match.plane, reason: 'surfaceMismatch' };
  }
  if (query.kind && String(event.kind || '').trim() !== query.kind) {
    return { accepted: false, plane: match.plane, reason: 'kindMismatch' };
  }
  if (query.level && String(event.level || '').trim().toLowerCase() !== query.level) {
    return { accepted: false, plane: match.plane, reason: 'levelMismatch' };
  }
  return match;
}

function materializeRecentDiagnosticEvents(args = {}, endpoint = null, command = 'dumpRecentEvents') {
  const query = diagnosticCommandQuery(args);
  const subscription = diagnosticCommandSubscription(query, endpoint, command);
  const selected = [];
  let filtered = 0;
  for (let index = runtimeEvents.length - 1; index >= 0 && selected.length < query.limit; index -= 1) {
    const event = runtimeEvents[index];
    const match = diagnosticEventMatchesCommandQuery(event, subscription, query);
    if (match.accepted) selected.push(safeClone(event));
    else filtered += 1;
  }
  diagnosticAdmissionCounters.replayed += selected.length;
  diagnosticAdmissionCounters.replayFiltered += filtered;
  const events = selected.reverse();
  const materializationBudget = diagnosticReplayMaterializationBudget(subscription, events, filtered);
  if (endpoint) endpoint.diagnosticCommandMaterializationBudget = materializationBudget;
  return {
    events,
    filteredCount: filtered,
    materializationBudget,
    consumerFloor: materializationBudget.consumerFloor,
  };
}

function diagnosticReplayConsumerFloor(subscription, events = [], filtered = 0, sampledAt = nowMs()) {
  const consumerRef = String(subscription?.subscriberRef || 'runtime-diagnostics').trim() || 'runtime-diagnostics';
  const subscriptionId = String(subscription?.subscriptionId || '').trim();
  const materializationId = subscriptionId
    ? `materialization:${subscriptionId}:runtime-diagnostics`
    : `materialization:runtime-diagnostics:${consumerRef}`;
  const first = events[0] || null;
  const last = events[events.length - 1] || null;
  const eventTimeFloor = Number(first?.observedAt || 0) || undefined;
  const observedTimeFloor = Number(last?.observedAt || 0) || undefined;
  const lagState = filtered > 0
    ? SWARM.MATERIALIZATION_LAG_STATE.LAGGING
    : SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP;
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${materializationId}`,
    consumerRef,
    subscriptionId: subscriptionId || undefined,
    materializationId,
    subjectRef: RUNTIME_DIAGNOSTICS_CHANNEL,
    cursor: String(last?.eventId || '').trim() || undefined,
    eventTimeFloor,
    observedTimeFloor,
    lagState,
    reason: filtered > 0 ? 'diagnostic replay filtered before materialization' : undefined,
    redelivery: {
      mode: SWARM.EVENT_DELIVERY_MODE.REPLAY,
      filtered,
    },
    replay: {
      replayedCount: events.length,
      replayLimit: Number(subscription?.window?.replayLimit || 0) || events.length,
    },
    sampledAt,
    expiresAt: sampledAt + 60_000,
  });
}

function diagnosticReplayMaterializationBudget(subscription, events = [], filtered = 0, sampledAt = nowMs()) {
  const subscriptionId = String(subscription?.subscriptionId || '').trim();
  const consumerRef = String(subscription?.subscriberRef || 'runtime-diagnostics').trim() || 'runtime-diagnostics';
  const materializationId = subscriptionId
    ? `materialization:${subscriptionId}:runtime-diagnostics`
    : `materialization:runtime-diagnostics:${consumerRef}`;
  const pressure = filtered > 0 || events.length >= Number(subscription?.window?.replayLimit || RUNTIME_DIAGNOSTIC_REPLAY_LIMIT);
  return assertMaterializationBudget({
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: materializationId,
    sourceAuthority: `runtime:${runtimeSessionId}`,
    consumerRef,
    subscriberRef: consumerRef,
    payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
    copyRole: SWARM.MATERIALIZATION_COPY_ROLE.EVIDENCE,
    transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
    privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
    state: pressure ? SWARM.RESOURCE_POSTURE_STATE.PRESSURE : SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET,
    limits: {
      maxEvents: Number(subscription?.window?.replayLimit || RUNTIME_DIAGNOSTIC_REPLAY_LIMIT),
      maxRingEvents: RUNTIME_DIAGNOSTIC_RING_LIMIT,
      maxSnapshotEvents: RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT,
    },
    snapshotPolicy: {
      mode: 'baseline-repair',
      maxEvents: RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT,
    },
    deltaPolicy: {
      mode: 'push',
      coalesce: true,
    },
    coalescing: {
      key: 'plane|kind|channelRef|projectionKey|activationId',
      windowMs: 250,
    },
    cardinality: {
      labelLimit: 12,
      overflow: 'encryptedDetailRef',
    },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: 'runtime.diagnostics.v1',
    },
    consumerFloor: diagnosticReplayConsumerFloor(subscription, events, filtered, sampledAt),
    blockedReasons: pressure ? ['diagnosticReplayPressure'] : [],
    retentionClass: 'ephemeral',
    issuedAt: sampledAt,
    releaseAfter: sampledAt + 60_000,
    expiresAt: sampledAt + 5 * 60_000,
  });
}

function normalizeResourceProfileId(value) {
  const id = String(value || '').trim();
  if (id === 'custom') return 'custom';
  return RESOURCE_PROFILE_DEFINITIONS[id] ? id : 'balanced';
}

function runtimeResourceProfile(input = {}) {
  const requestedId = normalizeResourceProfileId(input.id || input.profileId || runtimeResourceProfileId);
  const base = RESOURCE_PROFILE_DEFINITIONS[requestedId === 'custom' ? 'balanced' : requestedId]
    || RESOURCE_PROFILE_DEFINITIONS.balanced;
  const overrides = requestedId === 'custom'
    ? { ...runtimeResourceProfileOverrides, ...normalizeObject(input.overrides) }
    : {};
  const caps = {
    ...safeClone(base.caps || {}),
    ...normalizeObject(overrides.caps),
  };
  return {
    ...safeClone(base),
    ...safeClone(overrides),
    id: requestedId,
    label: String(overrides.label || (requestedId === 'custom' ? 'Custom' : base.label) || requestedId).trim(),
    caps,
  };
}

function setRuntimeResourceProfile(input = {}) {
  const source = normalizeObject(input.profile || input.payload || input);
  const id = normalizeResourceProfileId(source.id || source.profileId);
  runtimeResourceProfileId = id;
  runtimeResourceProfileOverrides = id === 'custom' ? safeClone(normalizeObject(source.overrides || source)) : {};
  if (id !== 'custom') runtimeResourceProfileOverrides = {};
  return runtimeResourceProfile();
}

function numericOrUnavailable(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function runtimeMemoryEstimate(profile) {
  const memory = typeof performance !== 'undefined' && performance?.memory
    ? performance.memory
    : self?.performance?.memory;
  const usedHeapBytes = numericOrUnavailable(memory?.usedJSHeapSize);
  const totalHeapBytes = numericOrUnavailable(memory?.totalJSHeapSize);
  return {
    state: usedHeapBytes == null ? 'unavailable' : 'available',
    usedHeapBytes,
    totalHeapBytes,
    budgetBytes: Number(profile.memoryBudgetBytes || 0) || 0,
  };
}

function runtimeStorageEstimate(profile) {
  return {
    state: 'unavailable',
    usageBytes: null,
    quotaBytes: null,
    budgetBytes: Number(profile.storageBudgetBytes || 0) || 0,
    budgetPolicy: String(profile.storageBudgetPolicy || 'fixed').trim(),
    reserveBytes: Number(profile.storageReserveBytes || 0) || 0,
  };
}

function runtimeEndpointCounts() {
  const entries = Array.from(endpoints.values());
  return {
    activeRuntimeClients: entries.length,
    sharedWorkerPorts: entries.length,
    diagnosticSubscribers: entries.filter((entry) => entry?.diagnostics).length,
    brokerClients: entries.filter((entry) => entry?.broker).length,
    surfaces: uniqueTrimmedStrings(entries.map((entry) => entry?.surface || entry?.diagnosticSurface)),
  };
}

function currentSwarmWebSocketCount() {
  const socket = swarmEdge.socket;
  if (!socket) return 0;
  const readyState = Number(socket.readyState);
  return readyState === 0 || readyState === 1 ? 1 : 0;
}

function runtimeResourceCounts() {
  const endpointCounts = runtimeEndpointCounts();
  return {
    ...endpointCounts,
    devBridgeSessions: 0,
    eventSourceClients: 0,
    webSockets: currentSwarmWebSocketCount(),
    peerConnections: 0,
    mediaTracks: 0,
    retryLoops: Number(Boolean(diagnosticLoggingFlushTimer)) + Number(runtimeDirectoryObserveInFlight),
    pendingCommands: pendingBrokerRequests.size + pendingProjectionSyncRequests.size,
    pendingResults: 0,
    pendingAuthorityIntents: pendingAuthorityIntents.size,
    pendingRouteIntents: pendingRouteIntents.size,
    swarmQueue: outboundSwarmFrames.size,
    edgeSentRing: swarmEdge.sentFrames.length,
    diagnosticRing: runtimeEvents.length,
    diagnosticRingLimit: RUNTIME_DIAGNOSTIC_RING_LIMIT,
    diagnosticLoggingBacklog: diagnosticLoggingBacklog.length,
    diagnosticAdmissionForwarded: diagnosticAdmissionCounters.forwarded,
    diagnosticAdmissionFiltered: diagnosticAdmissionCounters.filtered,
    diagnosticReplayForwarded: diagnosticAdmissionCounters.replayed,
    diagnosticReplayFiltered: diagnosticAdmissionCounters.replayFiltered,
    projectionCount: retainedProjections.size,
    projectionPolicyCount: projectionPolicies.size,
  };
}

function compareResourceBudget(counts, memory, storage, profile) {
  const caps = normalizeObject(profile.caps);
  const reasons = [];
  let over = false;
  let pressure = false;
  const checkCap = (name, value, cap) => {
    const count = Number(value || 0);
    const limit = Number(cap || 0);
    if (!limit) return;
    if (count > limit) {
      over = true;
      reasons.push(`${name}.overBudget`);
    } else if (count >= limit * 0.8) {
      pressure = true;
      reasons.push(`${name}.pressure`);
    }
  };
  checkCap('diagnostics', counts.diagnosticRing, caps.diagnostics);
  checkCap('projections', counts.projectionCount, caps.projections);
  checkCap('mediaTracks', counts.mediaTracks, caps.mediaTracks);
  checkCap('liveStreams', counts.webSockets, caps.liveStreams);
  checkCap('devBridgeSessions', counts.devBridgeSessions, caps.devBridgeSessions);
  if (memory.usedHeapBytes != null && memory.budgetBytes > 0) {
    if (memory.usedHeapBytes > memory.budgetBytes) {
      over = true;
      reasons.push('memory.overBudget');
    } else if (memory.usedHeapBytes >= memory.budgetBytes * 0.8) {
      pressure = true;
      reasons.push('memory.pressure');
    }
  }
  if (storage.usageBytes != null && storage.budgetBytes > 0) {
    if (storage.usageBytes > storage.budgetBytes) {
      over = true;
      reasons.push('storage.overBudget');
    } else if (storage.usageBytes >= storage.budgetBytes * 0.8) {
      pressure = true;
      reasons.push('storage.pressure');
    }
  }
  return {
    state: over ? RESOURCE_POSTURE_STATES.OVER_BUDGET : pressure ? RESOURCE_POSTURE_STATES.PRESSURE : RESOURCE_POSTURE_STATES.WITHIN_BUDGET,
    reasons,
  };
}

function protocolResourceBudgets(profile) {
  return {
    memoryBudgetBytes: Number(profile.memoryBudgetBytes || 0) || 0,
    storageBudgetBytes: Number(profile.storageBudgetBytes || 0) || 0,
    storageBudgetPolicy: String(profile.storageBudgetPolicy || 'fixed').trim(),
    storageReserveBytes: Number(profile.storageReserveBytes || 0) || 0,
    hotTtlMs: Number(profile.hotTtlMs || 0) || 0,
    warmTtlMs: Number(profile.warmTtlMs || 0) || 0,
  };
}

function protocolResourceProfileRecord(profile, issuedAt) {
  const profileId = String(profile.id || 'balanced').trim() || 'balanced';
  const profileClass = Object.values(SWARM.RESOURCE_PROFILE_CLASS || {}).includes(profileId)
    ? profileId
    : SWARM.RESOURCE_PROFILE_CLASS.CUSTOM;
  return assertResourceProfile({
    kind: SWARM.RECORD_KIND.RESOURCE_PROFILE,
    profileId,
    profileClass,
    budgets: protocolResourceBudgets(profile),
    caps: safeClone(profile.caps || {}),
    ownerRef: 'account.center',
    issuedAt,
  });
}

function protocolResourcePostureRecord({ counts, budgets, posture, profile, sampledAt }) {
  const state = Object.values(SWARM.RESOURCE_POSTURE_STATE || {}).includes(String(posture?.state || '').trim())
    ? String(posture.state).trim()
    : SWARM.RESOURCE_POSTURE_STATE.UNAVAILABLE;
  return assertResourcePosture({
    kind: SWARM.RECORD_KIND.RESOURCE_POSTURE,
    postureId: `resource-posture:${runtimeSessionId}:${sampledAt}`,
    profileId: String(profile.id || 'balanced').trim() || 'balanced',
    state,
    counts: safeClone(counts || {}),
    budgets: safeClone(budgets || {}),
    blockedReasons: normalizeArray(posture?.reasons).map((entry) => String(entry || '').trim()).filter(Boolean),
    sampledAt,
  });
}

function runtimeResourceSample() {
  const profile = runtimeResourceProfile();
  const counts = runtimeResourceCounts();
  const memory = runtimeMemoryEstimate(profile);
  const storage = runtimeStorageEstimate(profile);
  const posture = compareResourceBudget(counts, memory, storage, profile);
  const observedAt = nowMs();
  const budgets = {
    ...protocolResourceBudgets(profile),
    caps: safeClone(profile.caps || {}),
  };
  return {
    sampleKind: 'runtime.resource.sample',
    debugOnly: true,
    observedAt,
    buildId: RUNTIME_WORKER_BUILD_ID,
    runtimeSessionId,
    activeProfile: {
      id: profile.id,
      label: profile.label,
    },
    budgets,
    counts,
    memory,
    storage,
    posture: {
      ...posture,
      cleanupAllowed: false,
      cleanupReason: 'retention posture must allow release before sweeping',
    },
    protocol: {
      profile: protocolResourceProfileRecord(profile, observedAt),
      posture: protocolResourcePostureRecord({ counts, budgets, posture, profile, sampledAt: observedAt }),
    },
  };
}

function runtimeResourcePostureSummary() {
  const sample = runtimeResourceSample();
  const posture = normalizeObject(sample.posture);
  const state = String(posture.state || RESOURCE_POSTURE_STATES.WITHIN_BUDGET).trim() || RESOURCE_POSTURE_STATES.WITHIN_BUDGET;
  const reasons = normalizeArray(posture.reasons).map((entry) => String(entry || '').trim()).filter(Boolean);
  return {
    kind: 'runtime.resource.postureSummary',
    state,
    reason: reasons.join(', '),
    profileId: String(sample.activeProfile?.id || 'balanced').trim() || 'balanced',
    cleanupAllowed: false,
    cleanupReason: 'retention posture must allow release before sweeping',
    evidenceRefs: [`resource.sample:${sample.observedAt}`],
    protocolRef: sample.protocol?.posture?.postureId || '',
    sampledAt: sample.observedAt,
  };
}

function runtimeRetentionPostureSummary() {
  return {
    kind: 'runtime.retention.postureSummary',
    state: 'releaseRequired',
    reason: 'local release requires explicit retention release posture',
    releaseRequired: true,
    destructiveAction: false,
  };
}

function retentionRank(retentionClass) {
  const normalized = String(retentionClass || '').trim();
  const ranks = {
    ephemeral: 0,
    disposable: 1,
    session: 1,
    cache: 2,
    local: 3,
    durable: 4,
    archive: 5,
    immortal: 6,
  };
  return Object.prototype.hasOwnProperty.call(ranks, normalized) ? ranks[normalized] : ranks.durable;
}

function normalizeRetentionClass(value, fallback = 'durable') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function retentionReleaseEvaluation(input = {}) {
  const source = normalizeObject(input.payload || input);
  const policy = normalizeObject(source.policy || source.retentionPolicy);
  const residency = normalizeObject(source.residency || source.localResidency);
  const pins = normalizeArray(source.pins).filter((pin) => normalizeObject(pin).active !== false);
  const fulfillments = normalizeArray(source.fulfillments);
  const overlays = normalizeArray(source.overlays).filter((overlay) => normalizeObject(overlay).active !== false);
  const validUntil = Number(source.validUntil || policy.validUntil || 0) || undefined;
  const releaseAfter = Number(source.releaseAfter || policy.releaseAfter || 0) || undefined;
  const requireWitness = source.requireWitness === true || policy.requireWitness === true;
  const witnessRefs = uniqueTrimmedStrings([source.witnessRef, ...(Array.isArray(source.witnessRefs) ? source.witnessRefs : [])]);
  const supersessionRefs = uniqueTrimmedStrings([source.supersessionRef, ...(Array.isArray(source.supersessionRefs) ? source.supersessionRefs : [])]);
  const retractionRefs = uniqueTrimmedStrings([source.retractionRef, ...(Array.isArray(source.retractionRefs) ? source.retractionRefs : [])]);
  const revocationRefs = uniqueTrimmedStrings([source.revocationRef, ...(Array.isArray(source.revocationRefs) ? source.revocationRefs : [])]);
  let effectiveClass = normalizeRetentionClass(policy.class || policy.retentionClass, 'durable');
  for (const overlay of overlays) {
    const overlayClass = normalizeRetentionClass(overlay.class || overlay.retentionClass, '');
    if (overlayClass && retentionRank(overlayClass) > retentionRank(effectiveClass)) effectiveClass = overlayClass;
  }
  for (const pin of pins) {
    const pinClass = normalizeRetentionClass(pin.class || pin.retentionClass, 'immortal');
    if (retentionRank(pinClass) > retentionRank(effectiveClass)) effectiveClass = pinClass;
  }
  const disposable = ['ephemeral', 'disposable', 'session'].includes(effectiveClass);
  const fulfilled = fulfillments.some((fulfillment) => {
    const record = normalizeObject(fulfillment);
    return ['fulfilled', 'satisfied', 'complete'].includes(String(record.state || record.status || '').trim());
  });
  const liveRoot = source.liveRoot === true || residency.liveRoot === true;
  const blockers = [];
  if (validUntil && validUntil > nowMs() && supersessionRefs.length === 0 && retractionRefs.length === 0 && revocationRefs.length === 0) {
    blockers.push('validity.active');
  }
  if (releaseAfter && releaseAfter > nowMs()) blockers.push('releaseAfter.pending');
  if (requireWitness && witnessRefs.length === 0) blockers.push('witness.missing');
  if (pins.length > 0) blockers.push('activePin');
  if (!disposable && !fulfilled) blockers.push('fulfillment.missing');
  if (liveRoot) blockers.push('liveRoot');
  const freeable = blockers.length === 0;
  const evaluatedAt = nowMs();
  const ownerRefs = uniqueTrimmedStrings([
    source.ownerRef,
    policy.ownerRef,
    ...(Array.isArray(source.ownerRefs) ? source.ownerRefs : []),
    'runtime:browser',
  ]);
  const holderRefs = uniqueTrimmedStrings([
    source.holderRef,
    residency.holderRef,
    ...(Array.isArray(source.holderRefs) ? source.holderRefs : []),
  ]);
  const fulfillmentRefs = uniqueTrimmedStrings(fulfillments.map((fulfillment) => {
    const record = normalizeObject(fulfillment);
    return record.fulfillmentRef || record.fulfillmentId || record.holder || record.storageMemberRef || '';
  }));
  const residencyLayers = uniqueTrimmedStrings([
    residency.layer,
    residency.residencyLayer,
    source.residencyLayer,
    ...(Array.isArray(source.residencyLayers) ? source.residencyLayers : []),
    'browserHotCache',
  ]);
  const policyRefs = uniqueTrimmedStrings([
    source.policyRef,
    policy.policyRef,
    policy.policyId ? `policy:${policy.policyId}` : '',
    `policy:runtime.retention.${effectiveClass}`,
    ...(Array.isArray(source.policyRefs) ? source.policyRefs : []),
  ]);
  const overlayRefs = uniqueTrimmedStrings([
    ...overlays.map((overlay) => {
      const record = normalizeObject(overlay);
      return record.overlayRef || record.overlayId || '';
    }),
    ...(Array.isArray(source.overlayRefs) ? source.overlayRefs : []),
    overlays.length ? '' : 'overlay:none',
  ]);
  const releasePosture = assertRetentionReleasePosture({
    kind: SWARM.RECORD_KIND.RETENTION_RELEASE,
    evaluationId: String(source.evaluationId || `retention-release:${runtimeSessionId}:${evaluatedAt}`).trim(),
    subjectRef: String(source.subjectRef || source.subject || 'unknown').trim() || 'unknown',
    effectiveRetention: effectiveClass,
    state: freeable ? SWARM.RETENTION_RELEASE_STATE.FREEABLE : SWARM.RETENTION_RELEASE_STATE.RELEASE_BLOCKED,
    policyRefs,
    overlayRefs,
    ownerRefs,
    holderRefs,
    fulfillmentRefs,
    residencyLayers,
    witnessRefs,
    supersessionRefs,
    retractionRefs,
    revocationRefs,
    blockers: blockers.map((code) => ({ code })),
    validUntil,
    releaseAfter,
    evaluatedAt,
  });
  return {
    subjectRef: String(source.subjectRef || source.subject || '').trim(),
    state: freeable ? 'freeable' : 'releaseBlocked',
    freeable,
    effectiveRetention: {
      class: effectiveClass,
      rank: retentionRank(effectiveClass),
    },
    policy: safeClone(policy),
    overlays: safeClone(overlays),
    pins: safeClone(pins),
    fulfillments: safeClone(fulfillments),
    residency: safeClone(residency),
    blockers,
    destructiveAction: false,
    releasePosture,
    reason: freeable
      ? 'local release is allowed by effective retention posture'
      : 'local release blocked by effective retention posture',
  };
}

function broadcastDiagnosticEvent(event) {
  for (const endpoint of endpoints.values()) {
    if (!endpoint?.diagnostics) continue;
    const match = diagnosticEventMatchesSubscription(event, endpoint.diagnosticSubscription);
    const admission = diagnosticAdmissionForEvent(event, endpoint, match);
    if (!match.accepted) {
      diagnosticAdmissionCounters.filtered += 1;
      continue;
    }
    diagnosticAdmissionCounters.forwarded += 1;
    endpointPost(endpoint, {
      type: RUNTIME_DIAGNOSTIC_EVENT,
      event: safeClone(event),
      admission,
      diagnostics: diagnosticSnapshot(),
    });
  }
}

function diagnosticLoggingRouteReady() {
  if (!swarmEdge.connected) return false;
  const liveRoute = liveEdgeRouteForService({
    service: 'logging',
    capability: 'logging.events.ingest',
    channelId: 'logging.events',
  });
  return Boolean(liveRoute?.memberRef && liveRoute?.zoneScope?.zoneId);
}

function routeBaselineObserveNeeded() {
  if (pendingRouteIntents.size > 0) return true;
  for (const entry of outboundSwarmFrames.values()) {
    if (routeObservationNeedsZoneBaseline(entry?.routeObservation)) return true;
    const state = String(entry?.routingScope?.state || '').trim();
    if (
      state === SWARM.ROUTING_SCOPE_STATE.SYNCING
      || state === SWARM.ROUTING_SCOPE_STATE.MISSING
    ) {
      return true;
    }
  }
  return false;
}

function shouldQueueRuntimeDirectoryObserve() {
  if (!swarmEdge.connected) return false;
  const needsLoggingRoute = diagnosticLoggingEnabled || diagnosticLoggingBacklog.length > 0;
  const needsRouteBaseline = routeBaselineObserveNeeded();
  if (!needsLoggingRoute && !needsRouteBaseline) return false;
  if (runtimeDirectoryObserveInFlight) return false;
  if (!needsRouteBaseline && diagnosticLoggingRouteReady()) return false;
  const now = nowMs();
  return !runtimeDirectoryObserveLastQueuedAt
    || now - runtimeDirectoryObserveLastQueuedAt >= RUNTIME_DIRECTORY_OBSERVE_MIN_INTERVAL_MS;
}

async function queueRuntimeDirectoryObserve(reason = 'route.discovery') {
  if (!shouldQueueRuntimeDirectoryObserve()) return false;
  runtimeDirectoryObserveInFlight = true;
  runtimeDirectoryObserveLastQueuedAt = nowMs();
  try {
    const authority = await runtimeDeviceAuthority();
    const issuedAt = nowMs();
    const expiresAt = issuedAt + 60_000;
    const nonce = randomOpaqueId('directory-observe-nonce');
    const frame = makeSwarmFrame({
      kind: SWARM.FRAME_KIND.CHANNEL_OBSERVE,
      issuer: authority.publicKey,
      audience: { directory: 'capability' },
      zoneScope: appIntentZoneScope({ zoneScope: swarmEdge.zoneScope }, { requirePropagation: true }),
      issuedAt,
      expiresAt,
      nonce,
      correlationId: randomOpaqueId('runtime-directory'),
      channelId: RUNTIME_DIRECTORY_OBSERVE_CHANNEL,
      recordRef: { kind: 'projection.snapshot', id: RUNTIME_DIRECTORY_OBSERVE_CHANNEL },
      capability: SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
      body: {
        encoding: SWARM.BODY_ENCODING.CAAC,
        envelope: sealEnvelope({
          kind: 'runtime.directory.observe',
          claims: {
            method: 'runtime.directory.observe',
            channelId: RUNTIME_DIRECTORY_OBSERVE_CHANNEL,
            reason: String(reason || 'route.discovery').trim(),
            requesterRef: authority.publicKey,
            issuedAt,
            expiresAt,
            nonce,
          },
          issuerSecretKey: authority.secretKey,
          recipientPks: [authority.publicKey],
          issuedAt,
          expiresAt,
        }),
      },
    });
    queueSwarmFrame({
      frame,
      retryPolicy: { onReject: 'preserve' },
    });
    recordRuntimeEvent('runtime.directory.observe.requested', {
      frameId: frame.frameId,
      correlationId: frame.correlationId,
      channelId: frame.channelId,
      capability: frame.capability,
      reason: String(reason || 'route.discovery').trim(),
    });
    return true;
  } catch (error) {
    recordRuntimeEvent('runtime.directory.observe.failed', {
      level: 'warn',
      error: { message: String(error?.message || error || 'directory observe failed') },
      reason: String(reason || 'route.discovery').trim(),
    });
    return false;
  } finally {
    runtimeDirectoryObserveInFlight = false;
  }
}

function requestRuntimeDirectoryObserve(reason) {
  void queueRuntimeDirectoryObserve(reason);
}

function diagnosticLoggingBacklogConsumerFloor(sampledAt = nowMs()) {
  const first = diagnosticLoggingBacklog[0] || null;
  const last = diagnosticLoggingBacklog[diagnosticLoggingBacklog.length - 1] || null;
  const pressure = diagnosticLoggingBacklog.length >= RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT
    || diagnosticLoggingWindowCount >= RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT;
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: 'floor:runtime.diagnostic-logging.backlog',
    consumerRef: 'runtime.diagnostic-logging.sink',
    materializationId: 'runtime.diagnostic-logging.backlog',
    subjectRef: RUNTIME_DIAGNOSTICS_CHANNEL,
    cursor: String(last?.eventId || '').trim() || undefined,
    ackFloor: String(diagnosticLoggingBacklog.length),
    witnessFloor: String(diagnosticLoggingQueuedEventIds.size),
    compactionFloor: String(Math.max(0, diagnosticLoggingBacklog.length - RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT)),
    eventTimeFloor: Number(first?.observedAt || 0) || undefined,
    observedTimeFloor: Number(last?.observedAt || 0) || sampledAt,
    lagState: pressure ? SWARM.MATERIALIZATION_LAG_STATE.LAGGING : SWARM.MATERIALIZATION_LAG_STATE.CAUGHT_UP,
    reason: pressure ? 'diagnostic logging backlog is at materialization pressure' : undefined,
    replay: {
      mode: SWARM.EVENT_DELIVERY_MODE.REPLAY,
      backlogLimit: RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT,
    },
    redelivery: {
      mode: 'logging-sink-retry',
      duplicatePolicy: 'eventId',
    },
    sampledAt,
    expiresAt: sampledAt + 60_000,
  });
}

function diagnosticLoggingBacklogMaterializationBudget(sampledAt = nowMs()) {
  const pressure = diagnosticLoggingBacklog.length >= RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT
    || diagnosticLoggingWindowCount >= RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT;
  return assertMaterializationBudget({
    kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
    budgetId: 'runtime.diagnostic-logging.backlog',
    sourceAuthority: `runtime:${runtimeSessionId}`,
    consumerRef: 'runtime.diagnostic-logging.sink',
    subscriberRef: diagnosticLoggingSubscriberIds.size ? Array.from(diagnosticLoggingSubscriberIds).sort().join(',') : undefined,
    payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.EVIDENCE,
    copyRole: SWARM.MATERIALIZATION_COPY_ROLE.BUFFER,
    transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
    privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_FACTS,
    state: pressure ? SWARM.RESOURCE_POSTURE_STATE.PRESSURE : SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET,
    limits: {
      maxBacklogEvents: RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT,
      maxQueuedEvents: RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT,
      backlogCount: diagnosticLoggingBacklog.length,
      queuedCount: diagnosticLoggingQueuedEventIds.size,
      routeReady: diagnosticLoggingRouteReady(),
    },
    snapshotPolicy: { mode: 'bounded-backlog' },
    deltaPolicy: { mode: 'rate-limited-drain' },
    coalescing: { key: 'eventId' },
    cardinality: {
      eventIdIndex: 'map',
      maxEventIds: RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT,
      highCardinalityOverflow: 'dropOldest',
    },
    schema: {
      state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT,
      version: 'runtime.diagnostic-logging.backlog.v1',
    },
    consumerFloor: diagnosticLoggingBacklogConsumerFloor(sampledAt),
    blockedReasons: pressure ? ['diagnosticLoggingBacklogPressure'] : [],
    retentionClass: 'ephemeral.diagnostic-logging',
    issuedAt: sampledAt,
    releaseAfter: sampledAt + 60_000,
    expiresAt: sampledAt + 5 * 60_000,
  });
}

function diagnosticLoggingEventSafeForSink(event) {
  if (!event || typeof event !== 'object') return false;
  if (!String(event.eventId || '').trim()) return false;
  if (String(event?.kind || '').startsWith('diagnostic.logging.')) return false;
  return true;
}

function diagnosticLoggingEventEligible(event) {
  if (!diagnosticLoggingEnabled) return false;
  if (!diagnosticLoggingEventSafeForSink(event)) return false;
  if (diagnosticLoggingQueuedEventIds.has(event?.eventId)) return false;
  return true;
}

function enqueueDiagnosticLoggingBacklog(event) {
  if (!diagnosticLoggingEventEligible(event)) return false;
  const eventId = String(event.eventId || '').trim();
  if (diagnosticLoggingBacklogById.has(eventId)) return false;
  const materialized = safeClone(event, diagnosticLoggingBacklogMaterializationBudget());
  diagnosticLoggingBacklog.push(materialized);
  diagnosticLoggingBacklogIds.add(eventId);
  diagnosticLoggingBacklogById.set(eventId, materialized);
  while (diagnosticLoggingBacklog.length > RUNTIME_DIAGNOSTIC_LOG_BACKLOG_LIMIT) {
    const dropped = diagnosticLoggingBacklog.shift();
    const droppedId = String(dropped?.eventId || '').trim();
    diagnosticLoggingBacklogIds.delete(droppedId);
    diagnosticLoggingBacklogById.delete(droppedId);
  }
  return true;
}

function removeDiagnosticLoggingBacklogEvent(eventId) {
  const key = String(eventId || '').trim();
  if (!key || !diagnosticLoggingBacklogById.has(key)) return;
  const entry = diagnosticLoggingBacklogById.get(key);
  diagnosticLoggingBacklogIds.delete(key);
  diagnosticLoggingBacklogById.delete(key);
  const index = diagnosticLoggingBacklog.indexOf(entry);
  if (index >= 0) diagnosticLoggingBacklog.splice(index, 1);
}

function enableDiagnosticLoggingSink(ownerId = '') {
  const owner = String(ownerId || '').trim();
  if (owner) diagnosticLoggingSubscriberIds.add(owner);
  diagnosticLoggingEnabled = true;
  for (const event of runtimeEvents) enqueueDiagnosticLoggingBacklog(event);
  requestRuntimeDirectoryObserve('diagnostic.logging.enable');
  scheduleDiagnosticLoggingFlush(10);
}

function disableDiagnosticLoggingSink(ownerId = '') {
  const owner = String(ownerId || '').trim();
  if (owner) diagnosticLoggingSubscriberIds.delete(owner);
  if (diagnosticLoggingSubscriberIds.size > 0) return;
  diagnosticLoggingEnabled = false;
  diagnosticLoggingBacklog.splice(0, diagnosticLoggingBacklog.length);
  diagnosticLoggingBacklogIds.clear();
  diagnosticLoggingBacklogById.clear();
  diagnosticLoggingQueuedEventIds.clear();
  diagnosticLoggingWindowStartedAt = 0;
  diagnosticLoggingWindowCount = 0;
  if (diagnosticLoggingFlushTimer) {
    self.clearTimeout(diagnosticLoggingFlushTimer);
    diagnosticLoggingFlushTimer = 0;
  }
}

function shouldQueueDiagnosticLoggingEvent(event) {
  if (!diagnosticLoggingEventEligible(event)) return false;
  const now = nowMs();
  if (!diagnosticLoggingWindowStartedAt || now - diagnosticLoggingWindowStartedAt > 60_000) {
    diagnosticLoggingWindowStartedAt = now;
    diagnosticLoggingWindowCount = 0;
  }
  if (diagnosticLoggingWindowCount >= RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT) return false;
  diagnosticLoggingWindowCount += 1;
  return true;
}

let diagnosticLoggingInFlight = false;
let runtimeControlPlaneBusyUntil = 0;

function markRuntimeControlPlaneBusy(durationMs = 5000) {
  runtimeControlPlaneBusyUntil = Math.max(runtimeControlPlaneBusyUntil, nowMs() + Math.max(250, Number(durationMs || 0)));
}

function clearRuntimeControlPlaneBusy() {
  runtimeControlPlaneBusyUntil = 0;
}

function runtimeControlPlaneBusy() {
  return runtimeControlPlaneBusyUntil > nowMs();
}

function scheduleDiagnosticLoggingFlush(delayMs = 1000) {
  if (diagnosticLoggingFlushTimer) return;
  diagnosticLoggingFlushTimer = self.setTimeout(() => {
    diagnosticLoggingFlushTimer = 0;
    flushDiagnosticLoggingEvents();
  }, Math.max(10, Number(delayMs || 0)));
}

function runtimeDiagnosticLogEvent(event) {
  const observedAt = Number(event.observedAt || 0) || nowMs();
  const occurredAt = observedAt > 9_999_999_999
    ? Math.floor(observedAt / 1000)
    : Math.floor(observedAt);
  return makeLogEventEnvelope({
    occurredAt,
    producer: {
      service: 'runtime',
      component: 'browser-runtime',
      instanceId: runtimeSessionId,
    },
    category: 'worker',
    severity: event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'info',
    outcome: event.level === 'error' ? 'failed' : event.level === 'warn' ? 'degraded' : 'observed',
    subject: {
      kind: 'runtime.diagnostic',
      id: event.eventId,
    },
    correlation: {
      correlationId: event.correlationId || event.requestId || event.frameId || event.eventId,
    },
    tags: ['runtime', 'diagnostic', event.kind].filter(Boolean),
    safeFacts: sanitizeDiagnosticValue({
      eventId: event.eventId,
      kind: event.kind,
      level: event.level,
      buildId: event.buildId,
      runtimeSessionId: event.runtimeSessionId,
      surface: event.surface,
      clientId: event.clientId,
      frameId: event.frameId,
      correlationId: event.correlationId,
      requestId: event.requestId,
      activationId: event.activationId,
      routePromiseId: event.routePromiseId,
      projectionKey: event.projectionKey,
      channelRef: event.channelRef,
      capabilityRef: event.capabilityRef,
      detail: event.detail,
    }),
  });
}

function runtimeDiagnosticLogEventsForProjection(limit = DEFAULT_LOGGING_SYNC_TARGET_COUNT) {
  const max = Math.min(RUNTIME_DIAGNOSTIC_RING_LIMIT, Math.max(1, Number(limit || DEFAULT_LOGGING_SYNC_TARGET_COUNT)));
  const selected = [];
  for (let index = runtimeEvents.length - 1; index >= 0 && selected.length < max; index -= 1) {
    const event = runtimeEvents[index];
    if (diagnosticLoggingEventSafeForSink(event)) selected.push(runtimeDiagnosticLogEvent(event));
  }
  return selected.reverse();
}

function runtimeLoggingSeverityCounts(logEvents) {
  const counts = { critical: 0, error: 0, warning: 0, warn: 0, info: 0 };
  for (const event of logEvents) {
    const severity = String(event?.severity || 'info').trim().toLowerCase();
    if (severity === 'critical') counts.critical += 1;
    else if (severity === 'error') counts.error += 1;
    else if (severity === 'warning' || severity === 'warn') {
      counts.warning += 1;
      counts.warn += 1;
    } else counts.info += 1;
  }
  return counts;
}

function runtimeLoggingSecurityAccessGroup(issuedAt = nowMs()) {
  const serviceRef = `service:logging:${RUNTIME_LOGGING_PROJECTION_SERVICE_PK}`;
  return assertAccessGroup({
    kind: SWARM.RECORD_KIND.ACCESS_GROUP,
    groupId: 'access-group:runtime.logging.security.default',
    ownerRef: serviceRef,
    subjectRef: 'logging.events.encryptedDetail',
    contentClasses: ['encryptedDetail', 'diagnosticDetail'],
    memberRefs: [serviceRef, 'constitute-security'],
    adminRefs: [serviceRef],
    currentEpochId: 'access-epoch:runtime.logging.security.default:1',
    partitionRefs: ['partition:event-fabric:runtime-logging-security'],
    policyRefs: ['policy:runtime.logging.security.default'],
    safeFacts: {
      purpose: 'securityReplay',
      retentionWindow: '90d',
      source: 'runtime.safeDiagnostics',
      readability: 'futureEpochsOnly',
    },
    issuedAt,
  });
}

function runtimeLoggingSecurityAccessEpoch(issuedAt = nowMs()) {
  const serviceRef = `service:logging:${RUNTIME_LOGGING_PROJECTION_SERVICE_PK}`;
  return assertAccessEpoch({
    kind: SWARM.RECORD_KIND.ACCESS_EPOCH,
    epochId: 'access-epoch:runtime.logging.security.default:1',
    groupId: 'access-group:runtime.logging.security.default',
    sequence: 1,
    changeKind: 'create',
    memberRefs: [serviceRef, 'constitute-security'],
    addedMemberRefs: ['constitute-security'],
    removedMemberRefs: [],
    partitionRefs: ['partition:event-fabric:runtime-logging-security'],
    keyRef: 'key-ref:runtime.logging.security.default:epoch:1',
    proofRefs: ['profile:runtime.logging.security.default'],
    safeFacts: {
      purpose: 'securityReplay',
      contentClasses: ['encryptedDetail', 'diagnosticDetail'],
      source: 'runtime.safeDiagnostics',
    },
    issuedAt,
    expiresAt: issuedAt + 90 * 24 * 60 * 60 * 1000,
  });
}

function runtimeLoggingEventFabricAccessClasses(issuedAt = nowMs()) {
  const groupRef = 'access-group:runtime.logging.security.default';
  return [
    assertEventFabricAccessClass({
      kind: SWARM.RECORD_KIND.EVENT_FABRIC_ACCESS_CLASS,
      classId: 'event-class:runtime.logging.security.encrypted-detail',
      contentClass: 'encryptedDetail',
      privacyTier: 'domainEncrypted',
      eventClasses: [
        'security.audit',
        'runtime.diagnostic',
        'service.event',
        'storage.access',
        'media.path',
      ],
      accessGroupRefs: [groupRef],
      processorRoleRefs: ['role:logging.processor', 'role:security.processor'],
      storageClass: 'runtime.safeDiagnostics',
      retentionClass: 'rolling.security-evidence',
      safeFactPolicy: 'indexOnly',
      indexPolicy: {
        bitemporal: true,
        safeKeys: ['kind', 'level', 'channelId', 'service', 'surface'],
        highCardinalityOverflow: 'encryptedDetailRef',
      },
      safeFacts: {
        processorAgreement: 'runtime-logging-security-replay',
        detailCustody: 'encryptedDetailRef',
      },
      issuedAt,
    }),
    assertEventFabricAccessClass({
      kind: SWARM.RECORD_KIND.EVENT_FABRIC_ACCESS_CLASS,
      classId: 'event-class:runtime.logging.security.diagnostic-detail',
      contentClass: 'diagnosticDetail',
      privacyTier: 'domainEncrypted',
      eventClasses: ['runtime.diagnostic'],
      accessGroupRefs: [groupRef],
      processorRoleRefs: ['role:logging.processor', 'role:security.processor'],
      storageClass: 'runtime.safeDiagnostics',
      retentionClass: 'rolling.diagnostic-detail',
      safeFactPolicy: 'minimal',
      indexPolicy: {
        bitemporal: true,
        safeKeys: ['kind', 'level', 'channelId'],
        highCardinalityOverflow: 'encryptedDetailRef',
      },
      safeFacts: {
        processorAgreement: 'runtime-diagnostic-replay',
        detailCustody: 'encryptedDetailRef',
      },
      issuedAt,
    }),
  ];
}

function runtimeLoggingProcessorFloor(materializationId, consumerRef, issuedAt = nowMs()) {
  return assertConsumerFloor({
    kind: SWARM.RECORD_KIND.CONSUMER_FLOOR,
    floorId: `floor:${materializationId}`,
    consumerRef,
    materializationId,
    subjectRef: 'event-fabric:runtime.logging.default',
    cursor: String(runtimeEvents.length),
    ackFloor: String(runtimeEvents.length),
    witnessFloor: String(runtimeEvents.length),
    compactionFloor: 'runtime.safeDiagnostics',
    eventTimeFloor: runtimeEvents.length ? Number(runtimeEvents[0]?.observedAt || runtimeEvents[0]?.issuedAt || 0) : issuedAt,
    observedTimeFloor: issuedAt,
    lagState: 'caughtUp',
    redelivery: { mode: 'runtimeProjectionReplay', duplicatePolicy: 'eventId' },
    replay: { mode: 'boundedRuntimeDiagnostics' },
    evidenceRefs: ['runtime.safeDiagnostics'],
    sampledAt: issuedAt,
    expiresAt: issuedAt + 60_000,
  });
}

function runtimeLoggingEventFabricProcessorContracts(accessClasses, issuedAt = nowMs()) {
  const accessClassRefs = accessClasses.map((entry) => entry.classId).filter(Boolean).sort();
  const inputEventClasses = [...new Set(accessClasses.flatMap((entry) => entry.eventClasses || []))].sort();
  const inputContentClasses = [...new Set(accessClasses.map((entry) => entry.contentClass).filter(Boolean))].sort();
  const accessGroupRefs = ['access-group:runtime.logging.security.default'];
  return [
    assertEventFabricProcessorContract({
      kind: SWARM.RECORD_KIND.EVENT_FABRIC_PROCESSOR_CONTRACT,
      processorContractId: 'processor-contract:runtime.logging.dashboard',
      fabricRef: 'event-fabric:runtime.logging.default',
      processorRef: `service:logging:${RUNTIME_LOGGING_PROJECTION_SERVICE_PK}`,
      processorRoleRef: 'role:logging.processor',
      state: 'ready',
      inputAccessClassRefs: accessClassRefs,
      inputEventClasses,
      inputContentClasses,
      outputRefs: ['projection:logging.events', 'projection:logging.dashboard', 'projection:logging.health'],
      storageRefs: ['runtime.safeDiagnostics'],
      accessGroupRefs,
      consumerFloor: runtimeLoggingProcessorFloor('runtime.logging.dashboard.projection', 'runtime.projection.store', issuedAt),
      bitemporalPolicy: {
        eventTimeField: 'occurredAt',
        observedTimeField: 'observedAt',
      },
      schemaPolicy: {
        currentVersion: 'constitute.logging.dashboard.v1',
        unknownVersionPosture: 'ignore',
      },
      compactionPolicy: {
        snapshotCadence: 'bounded',
        compactionFloor: 'runtime.safeDiagnostics',
      },
      cardinalityPolicy: {
        maxLabelValues: 250,
        highCardinalityOverflow: 'encryptedDetailRef',
      },
      encryptedDetailCustody: {
        state: 'referenceOnly',
        accessGroupRefs,
      },
      samplingPolicy: {
        state: 'adaptive',
        degradeBefore: ['authority', 'route', 'activation'],
      },
      safeFacts: {
        purpose: 'runtimeDashboardProjection',
        detailCustody: 'encryptedDetailRef',
      },
      evidenceRefs: ['runtime.safeDiagnostics'],
      issuedAt,
      expiresAt: issuedAt + 60_000,
    }),
    assertEventFabricProcessorContract({
      kind: SWARM.RECORD_KIND.EVENT_FABRIC_PROCESSOR_CONTRACT,
      processorContractId: 'processor-contract:runtime.logging.security',
      fabricRef: 'event-fabric:runtime.logging.default',
      processorRef: 'constitute-security',
      processorRoleRef: 'role:security.processor',
      state: 'ready',
      inputAccessClassRefs: accessClassRefs,
      inputEventClasses,
      inputContentClasses,
      outputRefs: ['security:evidence:runtime.logging.default', 'storage:runtime.logging.security.archive'],
      storageRefs: ['runtime.safeDiagnostics'],
      accessGroupRefs,
      consumerFloor: runtimeLoggingProcessorFloor('runtime.logging.security.evidence', 'constitute-security', issuedAt),
      bitemporalPolicy: {
        eventTimeField: 'occurredAt',
        observedTimeField: 'observedAt',
      },
      schemaPolicy: {
        currentVersion: 'runtime.logging.security.evidence.v1',
        unknownVersionPosture: 'ignore',
      },
      compactionPolicy: {
        snapshotCadence: 'retention-window',
        compactionFloor: 'retention-window:90d',
      },
      cardinalityPolicy: {
        rawDetail: 'byObjectRef',
        safeFacts: 'indexedSummary',
        highCardinalityOverflow: 'encryptedDetailRef',
      },
      encryptedDetailCustody: {
        state: 'referenceOnly',
        accessGroupRefs,
      },
      samplingPolicy: {
        state: 'fullWithinRetention',
        degradeBefore: ['authority', 'route', 'activation'],
      },
      safeFacts: {
        purpose: 'runtimeSecurityReplay',
        detailCustody: 'encryptedDetailRef',
      },
      evidenceRefs: ['runtime.safeDiagnostics'],
      issuedAt,
      expiresAt: issuedAt + 90 * 24 * 60 * 60 * 1000,
    }),
  ];
}

function runtimeLoggingSecurityProcessorSeed(accessClasses, processorContracts, issuedAt = nowMs()) {
  const accessClassRefs = accessClasses.map((entry) => entry.classId).filter(Boolean).sort();
  const inputEventClasses = [...new Set(accessClasses.flatMap((entry) => entry.eventClasses || []))].sort();
  const inputContentClasses = [...new Set(accessClasses.map((entry) => entry.contentClass).filter(Boolean))].sort();
  const processorContractRefs = processorContracts
    .filter((contract) => contract.processorRoleRef === 'role:security.processor')
    .map((contract) => contract.processorContractId)
    .filter(Boolean)
    .sort();
  const accessGroupRefs = ['access-group:runtime.logging.security.default'];
  return assertCybersecProcessorSeed({
    kind: SWARM.RECORD_KIND.SECURITY_PROCESSOR_SEED,
    seedId: 'security-seed:runtime.logging.default',
    fabricRef: 'event-fabric:runtime.logging.default',
    processorRef: 'constitute-security',
    processorRoleRef: 'role:security.processor',
    state: 'ready',
    threatAnalysisRole: 'eventFabricThreatAnalysis',
    inputAccessClassRefs: accessClassRefs,
    inputEventClasses,
    inputContentClasses,
    accessGroupRefs,
    processorContractRefs,
    evidenceProfileRefs: ['runtime.logging.security.default'],
    materializationBudgetRefs: ['runtime.logging.security.evidence'],
    storageRefs: ['runtime.safeDiagnostics'],
    detailRefs: ['encrypted-detail:runtime.logging.default'],
    alertOutputRefs: ['security:alerts:runtime.logging.default'],
    evidenceHoldRefs: ['security:evidence-hold:runtime.logging.default'],
    retentionHoldRefs: ['retention:security-hold:runtime.logging.default'],
    encryptedDetailCustody: {
      state: 'referenceOnly',
      accessGroupRefs,
      detailRefs: ['encrypted-detail:runtime.logging.default'],
    },
    semanticBoundaries: {
      logging: 'mayConsumeMaterializations',
      storage: 'ciphertextFulfillmentOnly',
      eventDomain: 'doesNotOwn',
    },
    safeFacts: {
      purpose: 'runtimeSecurityThreatAnalysis',
      detailCustody: 'encryptedDetailRef',
      alerting: 'seeded',
    },
    evidenceRefs: ['runtime.safeDiagnostics'],
    issuedAt,
    expiresAt: issuedAt + 90 * 24 * 60 * 60 * 1000,
  });
}

function runtimeLoggingEventFabricPosture(issuedAt = nowMs()) {
  const accessGroup = runtimeLoggingSecurityAccessGroup(issuedAt);
  const accessEpoch = runtimeLoggingSecurityAccessEpoch(issuedAt);
  const accessClasses = runtimeLoggingEventFabricAccessClasses(issuedAt);
  const processorContracts = runtimeLoggingEventFabricProcessorContracts(accessClasses, issuedAt);
  const securityProcessorSeeds = [runtimeLoggingSecurityProcessorSeed(accessClasses, processorContracts, issuedAt)];
  return {
    accessGroups: [accessGroup],
    accessEpochs: [accessEpoch],
    accessClasses,
    processorContracts,
    securityProcessorSeeds,
    contentClasses: accessGroup.contentClasses,
    processorRoles: ['role:logging.processor', 'role:security.processor'],
    currentEpochId: accessGroup.currentEpochId,
  };
}

function runtimeLoggingProjectionNodePath(policy, channelId) {
  const explicit = String(policy?.nodePath || '').trim();
  if (explicit) return explicit;
  if (channelId === 'logging.health') return 'health';
  if (channelId === 'logging.dashboard') return 'dashboard';
  return 'events';
}

function runtimeLoggingProjectionChannelForNodePath(nodePath) {
  const target = String(nodePath || 'events').trim().toLowerCase();
  if (target === 'health') return 'logging.health';
  if (target === 'dashboard') return 'logging.dashboard';
  return 'logging.events';
}

function runtimeLoggingProjectionPayload(policy) {
  const channelId = String(policy?.channelId || '').trim();
  const nodePath = runtimeLoggingProjectionNodePath(policy, channelId);
  const targetCount = nodePath === 'events'
    ? syncTargetCountForPolicy(policy)
    : DEFAULT_LOGGING_SYNC_TARGET_COUNT;
  const logEvents = runtimeDiagnosticLogEventsForProjection(targetCount);
  const severityCounts = runtimeLoggingSeverityCounts(logEvents);
  const coverage = {
    materializedCount: nodePath === 'events' ? logEvents.length : 1,
    targetCount: nodePath === 'events' ? logEvents.length : 1,
    completionRatio: 1,
    syncState: 'completeEnough',
    oldestObservedAt: logEvents.length ? Number(logEvents[0]?.occurredAt || 0) : 0,
    newestObservedAt: logEvents.length ? Number(logEvents.at(-1)?.occurredAt || 0) : 0,
  };
  if (nodePath === 'health') {
    return {
      nodePath,
      coverage,
      health: {
        ok: true,
        runtimeSessionId,
        eventCount: runtimeEvents.length,
        materializedCount: logEvents.length,
        loggingSink: diagnosticLoggingEnabled
          ? (diagnosticLoggingRouteReady() ? 'routed' : 'buffering')
          : 'local-runtime',
        storageStatus: diagnosticLoggingRouteReady() ? 'routed' : 'local-retained',
      },
    };
  }
  if (nodePath === 'dashboard') {
    const criticalShortlist = [];
    for (const event of logEvents) {
      if (!['critical', 'error', 'warning', 'warn'].includes(String(event?.severity || '').trim().toLowerCase())) continue;
      criticalShortlist.push(event);
      if (criticalShortlist.length >= 8) break;
    }
    const eventFabric = runtimeLoggingEventFabricPosture(nowMs());
    return {
      nodePath,
      coverage,
      severityCounts,
      criticalShortlist,
      storage: {
        status: diagnosticLoggingRouteReady() ? 'routed' : 'local-retained',
        archiveContainerId: '',
      },
      eventFabric,
    };
  }
  return {
    nodePath,
    coverage,
    events: logEvents,
    policy: safeClone(policy),
  };
}

function synthesizeRuntimeLoggingProjection(policy) {
  const channelId = String(policy?.channelId || '').trim();
  const service = String(policy?.service || '').trim();
  if (service !== 'logging' || !RUNTIME_LOGGING_PROJECTION_CHANNELS.has(channelId)) return null;
  const nodePath = runtimeLoggingProjectionNodePath(policy, channelId);
  const observedAt = nowMs();
  const payload = runtimeLoggingProjectionPayload(policy);
  const eventFabric = payload?.eventFabric || {};
  return storeProjectionRecord({
    channelId,
    service: 'logging',
    servicePk: RUNTIME_LOGGING_PROJECTION_SERVICE_PK,
    policyId: String(policy?.policyId || DEFAULT_LOGGING_POLICY_ID).trim() || DEFAULT_LOGGING_POLICY_ID,
    projectionId: channelId,
    nodePath,
    revision: observedAt,
    freshness: {
      state: 'fresh',
      updatedAt: observedAt,
      staleAfter: observedAt + 10_000,
    },
    sourceRefs: ['runtime.safeDiagnostics'],
    safeFacts: {
      source: 'runtime.safeDiagnostics',
      debugOnly: false,
      runtimeSessionId,
      eventFabricAccessGroups: Array.isArray(eventFabric.accessGroups) ? eventFabric.accessGroups.length : 0,
      eventFabricAccessClasses: Array.isArray(eventFabric.accessClasses) ? eventFabric.accessClasses.length : 0,
      eventFabricProcessorContracts: Array.isArray(eventFabric.processorContracts) ? eventFabric.processorContracts.length : 0,
      securityProcessorSeeds: Array.isArray(eventFabric.securityProcessorSeeds) ? eventFabric.securityProcessorSeeds.length : 0,
    },
    encryptedDetailRefs: [],
    diagnostics: [],
    payload,
  });
}

function maybeQueueDiagnosticLoggingEvent(event) {
  if (!diagnosticLoggingEnabled) return;
  enqueueDiagnosticLoggingBacklog(event);
  if (!diagnosticLoggingRouteReady()) {
    requestRuntimeDirectoryObserve('diagnostic.logging.backlog');
    scheduleDiagnosticLoggingFlush();
    return;
  }
  flushDiagnosticLoggingEvents();
}

function flushDiagnosticLoggingEvents() {
  if (!diagnosticLoggingEnabled) return;
  if (!diagnosticLoggingRouteReady()) {
    requestRuntimeDirectoryObserve('diagnostic.logging.flush');
    scheduleDiagnosticLoggingFlush(2000);
    return;
  }
  if (runtimeControlPlaneBusy()) {
    scheduleDiagnosticLoggingFlush(2000);
    return;
  }
  if (diagnosticLoggingInFlight) return;
  const event = diagnosticLoggingBacklog.find((entry) => shouldQueueDiagnosticLoggingEvent(entry));
  if (!event) return;
  diagnosticLoggingInFlight = true;
  diagnosticLoggingQueuedEventIds.add(event.eventId);
  void queueDiagnosticLoggingEvent(event).then(() => {
    removeDiagnosticLoggingBacklogEvent(event.eventId);
    diagnosticLoggingInFlight = false;
    scheduleDiagnosticLoggingFlush(250);
  }).catch((error) => {
    diagnosticLoggingInFlight = false;
    diagnosticLoggingQueuedEventIds.delete(event.eventId);
    const failure = canonicalDiagnosticEvent('diagnostic.logging.sink.failed', {
      error: { message: String(error?.message || error || 'diagnostic logging sink failed') },
      level: 'warn',
    });
    runtimeEvents.push(failure);
    if (runtimeEvents.length > RUNTIME_DIAGNOSTIC_RING_LIMIT) {
      runtimeEvents.splice(0, runtimeEvents.length - RUNTIME_DIAGNOSTIC_RING_LIMIT);
    }
    broadcastDiagnosticEvent(failure);
    scheduleDiagnosticLoggingFlush(2000);
  });
}

function queueDiagnosticLoggingEvent(event) {
  return queueRuntimeAppIntent(RUNTIME_APP_INTENT.DIAGNOSTIC_LOG, {
    requestId: `diag-${event.eventId}`,
    payload: {
      service: 'logging',
      nodeRef: 'runtime.diagnostics',
      channelId: 'logging.events',
      capabilityRef: 'logging.events.ingest',
      recordKind: 'logging.event',
      payload: {
        recordKind: 'logging.event',
        record: runtimeDiagnosticLogEvent(event),
      },
      retryPolicy: { onReject: 'preserve' },
    },
  });
}

function recordRuntimeEvent(kind, detail = {}) {
  const event = canonicalDiagnosticEvent(kind, detail);
  runtimeEvents.push(event);
  if (runtimeEvents.length > RUNTIME_DIAGNOSTIC_RING_LIMIT) {
    runtimeEvents.splice(0, runtimeEvents.length - RUNTIME_DIAGNOSTIC_RING_LIMIT);
  }
  broadcastDiagnosticEvent(event);
  maybeQueueDiagnosticLoggingEvent(event);
  return event;
}

function touchRuntime() {
  runtimeUpdatedAt = nowMs();
}

function retainedProjectionObject() {
  const out = {};
  for (const [key, projection] of retainedProjections.entries()) {
    const cloned = safeClone(projection);
    out[key] = cloned;
    const channelId = String(projection?.channelId || '').trim();
    if (channelId && !out[channelId]) out[channelId] = cloned;
    const servicePk = String(projection?.servicePk || projection?.service_pk || '').trim();
    const service = String(projection?.service || '').trim();
    if ((servicePk || service) && channelId) {
      const serviceChannelKey = [servicePk || service, channelId].join('|');
      if (!out[serviceChannelKey]) out[serviceChannelKey] = cloned;
    }
  }
  return out;
}

function retainedProjectionStoreObject() {
  return Object.fromEntries(Array.from(retainedProjections.entries()).map(([key, projection]) => [key, safeClone(projection)]));
}

function retainedProjectionCoverageObject() {
  return Object.fromEntries(Array.from(retainedProjections.entries()).map(([key, projection]) => [key, projectionCoverage(projection)]));
}

function projectionPolicyObject() {
  return Object.fromEntries(Array.from(projectionPolicies.entries()).map(([key, policy]) => [key, safeClone(policy)]));
}

function swarmQueueObject() {
  return Object.fromEntries(Array.from(outboundSwarmFrames.entries()).map(([frameId, entry]) => [frameId, safeClone(entry)]));
}

function edgeSnapshot() {
  return {
    mode: swarmEdge.mode,
    connected: swarmEdge.connected,
    endpoint: swarmEdge.endpoint,
    sessionId: swarmEdge.sessionId,
    memberRef: swarmEdge.memberRef,
    zoneScope: safeClone(swarmEdge.zoneScope),
    queuedCount: outboundSwarmFrames.size,
    sentCount: swarmEdge.sentFrames.length,
    rejections: swarmEdge.rejections.map((entry) => safeClone(entry)),
    repairRequests: swarmEdge.repairRequests.map((entry) => safeClone(entry)),
    routeObservations: swarmEdge.routeObservations.map((entry) => safeClone(entry)),
    contributionLifecycles: swarmEdge.contributionLifecycles.map((entry) => safeClone(entry)),
  };
}

function activationResolutionObject() {
  const out = {};
  for (const entry of pendingAuthorityIntents.values()) {
    const key = String(entry.activationId || entry.requestId || '').trim();
    if (!key) continue;
    out[key] = {
      activationId: key,
      interactionId: String(entry.interactionId || '').trim(),
      routePromiseId: String(entry.routePromiseId || '').trim(),
      frameId: '',
      state: String(entry.state || 'waitingAuthority').trim(),
      nodeRef: String(entry.nodeRef || '').trim(),
      capabilityRef: String(entry.capabilityRef || '').trim(),
      channelId: String(entry.channelId || '').trim(),
      zoneScope: safeClone(entry.zoneScope || null),
      routingScope: safeClone(entry.routingScope || entry.authoritySummary?.routingScope || null),
      audience: safeClone(entry.audience || null),
      authoritySummary: safeClone(entry.authoritySummary || null),
      attempts: Number(entry.attempts || 0),
      routeObservation: null,
      lastError: entry.lastError ? safeClone(entry.lastError) : null,
      blockedAuthorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
      authorityLifecycleState: String(entry.authorityLifecycleState || '').trim(),
      updatedAt: Number(entry.updatedAt || entry.queuedAt || 0),
    };
  }
  for (const entry of pendingRouteIntents.values()) {
    const key = String(entry.activationId || entry.requestId || '').trim();
    if (!key) continue;
    out[key] = {
      activationId: key,
      interactionId: String(entry.interactionId || '').trim(),
      routePromiseId: String(entry.routePromiseId || '').trim(),
      frameId: '',
      state: String(entry.state || 'waitingRouteBaseline').trim(),
      nodeRef: String(entry.nodeRef || '').trim(),
      capabilityRef: String(entry.capabilityRef || '').trim(),
      channelId: String(entry.channelId || '').trim(),
      zoneScope: safeClone(entry.zoneScope || null),
      routingScope: safeClone(entry.routingScope || entry.authoritySummary?.routingScope || null),
      audience: safeClone(entry.audience || null),
      authoritySummary: safeClone(entry.authoritySummary || null),
      attempts: Number(entry.attempts || 0),
      routeObservation: null,
      lastError: entry.lastError ? safeClone(entry.lastError) : null,
      blockedAuthorityDomain: '',
      authorityLifecycleState: 'ready',
      updatedAt: Number(entry.updatedAt || entry.queuedAt || 0),
    };
  }
  for (const entry of outboundSwarmFrames.values()) {
    const frame = entry?.frame || {};
    const recordRef = frame.recordRef || frame.record_ref || {};
    const key = String(
      frame.correlationId
        || recordRef.id
        || entry.frameId
        || frame.frameId
        || '',
    ).trim();
    if (!key) continue;
    const routeObservation = entry.routeObservation && typeof entry.routeObservation === 'object'
      ? entry.routeObservation
      : null;
    const mediaFulfillment = entry.mediaFulfillment && typeof entry.mediaFulfillment === 'object'
      ? entry.mediaFulfillment
      : null;
    const mediaState = String(mediaFulfillment?.state || '').trim();
    const mediaPostureState = String(mediaFulfillment?.postureState || '').trim();
    const recordKind = queuedSwarmFrameRecordKind(entry);
    const rawState = String(routeObservation?.state || entry.status || 'queued').trim() || 'queued';
    const admissionTimedOut = String(entry.status || '').trim() === 'serviceAdmissionTimedOut';
    const signalDeliveryState = queuedSwarmFrameSignalDeliveryState(entry, rawState);
    const state = entry.serviceRejected
      ? 'serviceRejected'
      : mediaState === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED
        ? mediaPostureState || 'mediaBlocked'
        : mediaState === SWARM.MEDIA_FULFILLMENT_STATE.RELEASED
          ? 'released'
          : mediaState === SWARM.MEDIA_FULFILLMENT_STATE.USABLE
            ? 'adapterLive'
            : mediaState === SWARM.MEDIA_FULFILLMENT_STATE.PENDING && mediaPostureState === 'waitingRender'
              ? 'waitingRender'
              : entry.serviceAnswer
              ? 'answerMaterialized'
            : entry.serviceAccepted
              ? 'waitingServiceAnswer'
              : admissionTimedOut
                ? 'serviceAdmissionTimedOut'
                : signalDeliveryState
                  ? signalDeliveryState
                  : routeObservationReachedMember(rawState)
                    ? 'waitingServiceAcceptance'
                    : routeObservationCarrierStatus(rawState);
    out[key] = {
      activationId: key,
      interactionId: String(entry.interactionId || '').trim(),
      routePromiseId: String(entry.routePromiseId || routeObservation?.routePromiseId || '').trim(),
      frameId: String(entry.frameId || frame.frameId || '').trim(),
      state,
      recordKind,
      nodeRef: String(recordRef.id || '').trim(),
      capabilityRef: String(frame.capability || '').trim(),
      channelId: String(frame.channelId || '').trim(),
      zoneScope: safeClone(frame.zoneScope || null),
      routingScope: safeClone(entry.routingScope || entry.authoritySummary?.routingScope || entry.interaction?.routingScope || null),
      audience: safeClone(frame.audience || null),
      authoritySummary: safeClone(entry.authoritySummary || null),
      attempts: Number(entry.attempts || 0),
      routeObservation: routeObservation ? safeClone(routeObservation) : null,
      routeDelivery: routeDeliveryPosture(entry),
      serviceAccepted: entry.serviceAccepted === true,
      serviceAdmission: entry.serviceAdmission ? safeClone(entry.serviceAdmission) : null,
      serviceRejected: entry.serviceRejected === true,
      serviceReject: entry.serviceReject ? safeClone(entry.serviceReject) : null,
      serviceAnswer: entry.serviceAnswer ? safeClone(entry.serviceAnswer) : null,
      contributionLifecycle: entry.contributionLifecycle ? safeClone(entry.contributionLifecycle) : null,
      contributionWitnessedAt: Number(entry.contributionWitnessedAt || 0) || 0,
      mediaFulfillment: mediaFulfillment ? safeClone(mediaFulfillment) : null,
      mediaState,
      mediaPostureState,
      responseState: signalDeliveryState ? 'notRequired' : entry.serviceRejected ? 'rejected' : entry.serviceAnswer ? 'materialized' : entry.serviceAccepted ? 'waitingServiceAnswer' : admissionTimedOut ? 'serviceAdmissionTimedOut' : '',
      lastError: entry.lastError ? safeClone(entry.lastError) : null,
      updatedAt: Number(entry.mediaFulfillmentAt || entry.contributionWitnessedAt || entry.serviceAnswerAt || entry.serviceAcceptedAt || entry.serviceAdmissionTimedOutAt || entry.routeObservedAt || entry.rejectedAt || entry.ackedAt || entry.sentAt || entry.queuedAt || 0),
    };
  }
  return out;
}

function defaultSwarmBody() {
  return {
    encoding: SWARM.BODY_ENCODING.CAAC,
    envelope: {
      envelopeId: randomOpaqueId('caac'),
    },
  };
}

function isHexPublicKey(value) {
  return /^[0-9a-fA-F]{64}$/.test(String(value || '').trim());
}

function pushUniqueHexPublicKey(out, value) {
  const key = String(value || '').trim();
  if (!isHexPublicKey(key) || out.includes(key)) return;
  out.push(key);
}

function rawRuntimeAuthorityDevice(value) {
  const device = value?.device && typeof value.device === 'object' ? value.device : value;
  return device && typeof device === 'object' && !Array.isArray(device) ? device : null;
}

function runtimeAuthorityEvidence(value) {
  const device = rawRuntimeAuthorityDevice(value);
  if (!device) {
    return {
      device: null,
      secretKey: '',
      storedPk: '',
      publicKey: '',
      identityId: '',
      expiresAt: 0,
      revokedAt: 0,
    };
  }
  const nostr = device.nostr && typeof device.nostr === 'object' ? device.nostr : {};
  const secretKey = String(nostr.skHex || nostr.sk || device.skHex || '').trim();
  const storedPk = String(nostr.pk || device.pk || '').trim();
  let publicKey = '';
  let error = '';
  if (secretKey) {
    try {
      publicKey = pubkeyFromSecretKey(secretKey);
    } catch (caught) {
      error = String(caught?.message || caught || 'invalid runtime device key');
    }
  }
  const expiresAt = Number(device.expiresAt || device.expires_at || device.authorityExpiresAt || 0) || 0;
  const revokedAt = Number(device.revokedAt || device.revoked_at || 0) || 0;
  return {
    device,
    nostr,
    secretKey,
    storedPk,
    publicKey,
    identityId: String(device.identityId || device.identity_id || device.ownerIdentityId || '').trim(),
    expiresAt,
    revokedAt,
    error,
  };
}

function setRuntimeAuthorityPosture(posture) {
  runtimeAuthorityPostureState = {
    state: String(posture?.state || 'waitingAuthority').trim() || 'waitingAuthority',
    ready: posture?.state === 'ready',
    authorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
    devicePk: String(posture?.devicePk || '').trim(),
    identityId: String(posture?.identityId || '').trim(),
    reason: String(posture?.reason || '').trim(),
    source: String(posture?.source || '').trim(),
    blockedAuthorityDomain: posture?.state === 'ready' ? '' : SWARM.AUTHORITY_DOMAIN.RUNTIME,
    expiresAt: Number(posture?.expiresAt || 0) || 0,
    revokedAt: Number(posture?.revokedAt || 0) || 0,
    updatedAt: nowMs(),
  };
  return runtimeAuthorityPostureState;
}

function storageUnavailableForRuntimeAuthority() {
  return typeof indexedDB === 'undefined' && !runtimeCaches()?.open;
}

async function hydrateRuntimeAuthorityDeviceFromStorage(reason = 'storage.hydrate') {
  if (runtimeAuthorityStorageHydrationPromise) return runtimeAuthorityStorageHydrationPromise;
  runtimeAuthorityStorageHydrationPromise = (async () => {
    try {
      const stored = rawRuntimeAuthorityDevice(await withTimeout(
        'runtime.authority.storage.hydrate',
        () => kvGet('device'),
        AUTHORITY_STORAGE_HYDRATION_TIMEOUT_MS,
      ));
      if (!stored || runtimeAuthorityDevice) return null;
      const normalized = normalizeRuntimeAuthorityDevice(stored);
      if (!normalized) return null;
      runtimeAuthorityDevice = safeClone(normalized);
      setRuntimeAuthorityPosture({
        state: 'ready',
        reason: 'runtime device authority ready',
        source: reason,
        devicePk: String(normalized?.nostr?.pk || '').trim(),
        identityId: String(normalized?.identityId || normalized?.identity_id || normalized?.ownerIdentityId || '').trim(),
        expiresAt: Number(normalized?.expiresAt || normalized?.expires_at || 0) || 0,
      });
      recordRuntimeEvent('runtime.authority.device.ready', {
        devicePk: String(normalized?.nostr?.pk || '').trim(),
        source: reason,
      });
      broadcastSnapshot();
      void flushPendingAuthorityIntents('runtime.authority.storage.hydrated');
      return normalized;
    } catch (error) {
      if (!runtimeAuthorityStorageHydrationWarningLogged) {
        runtimeAuthorityStorageHydrationWarningLogged = true;
        recordRuntimeEvent('runtime.authority.device.storage_degraded', {
          level: 'warn',
          reason: 'storageLookupTimedOut',
          error: String(error?.message || error || 'runtime authority storage lookup failed'),
        });
      }
      return null;
    } finally {
      runtimeAuthorityStorageHydrationPromise = null;
    }
  })();
  return runtimeAuthorityStorageHydrationPromise;
}

async function runtimeAuthorityPosture() {
  let source = 'memory';
  let device = rawRuntimeAuthorityDevice(runtimeAuthorityDevice);
  if (!device) {
    source = 'storage.cache';
    if (storageUnavailableForRuntimeAuthority()) {
      return setRuntimeAuthorityPosture({
        state: 'unavailable',
        reason: 'runtime authority storage unavailable',
        source,
      });
    }
    void hydrateRuntimeAuthorityDeviceFromStorage('storage.hydrate').catch(() => null);
    try {
      device = rawRuntimeAuthorityDevice(await withTimeout(
        'runtime.authority.storage.lookup',
        () => kvGet('device'),
        AUTHORITY_POSTURE_STORAGE_LOOKUP_TIMEOUT_MS,
      ));
    } catch (error) {
      source = 'storage.pending';
      return setRuntimeAuthorityPosture({
        state: 'waitingAuthority',
        reason: 'runtime authority storage lookup pending',
        source,
      });
    }
  }
  const evidence = runtimeAuthorityEvidence(device);
  if (!evidence.device) {
    return setRuntimeAuthorityPosture({
      state: 'waitingAuthority',
      reason: 'runtime authority has not been handed off by account',
      source,
    });
  }
  if (evidence.revokedAt > 0) {
    return setRuntimeAuthorityPosture({
      state: 'revoked',
      reason: 'runtime device authority was revoked',
      source,
      devicePk: evidence.storedPk || evidence.publicKey,
      identityId: evidence.identityId,
      revokedAt: evidence.revokedAt,
    });
  }
  if (evidence.expiresAt > 0 && evidence.expiresAt <= nowMs()) {
    return setRuntimeAuthorityPosture({
      state: 'expired',
      reason: 'runtime device authority expired',
      source,
      devicePk: evidence.storedPk || evidence.publicKey,
      identityId: evidence.identityId,
      expiresAt: evidence.expiresAt,
    });
  }
  if (evidence.error) {
    return setRuntimeAuthorityPosture({
      state: 'ambiguous',
      reason: evidence.error,
      source,
      devicePk: evidence.storedPk,
      identityId: evidence.identityId,
    });
  }
  if (!evidence.secretKey) {
    return setRuntimeAuthorityPosture({
      state: 'waitingAuthority',
      reason: 'cached runtime device evidence does not include signing authority',
      source,
      devicePk: evidence.storedPk,
      identityId: evidence.identityId,
    });
  }
  if (evidence.storedPk && evidence.storedPk !== evidence.publicKey) {
    return setRuntimeAuthorityPosture({
      state: 'ambiguous',
      reason: 'runtime device authority public key does not match signing key',
      source,
      devicePk: evidence.storedPk,
      identityId: evidence.identityId,
    });
  }
  if (!runtimeAuthorityDevice) runtimeAuthorityDevice = normalizeRuntimeAuthorityDevice(evidence.device);
  return setRuntimeAuthorityPosture({
    state: 'ready',
    reason: 'runtime device authority ready',
    source,
    devicePk: evidence.publicKey,
    identityId: evidence.identityId,
    expiresAt: evidence.expiresAt,
  });
}

async function runtimeDeviceAuthority() {
  const posture = await runtimeAuthorityPosture();
  if (posture.state !== 'ready') {
    throw new Error(`runtime authority ${posture.state}: ${posture.reason || 'not ready'}`);
  }
  const device = normalizeRuntimeAuthorityDevice(runtimeAuthorityDevice)
    || normalizeRuntimeAuthorityDevice(await kvGet('device').catch(() => null));
  if (device && !runtimeAuthorityDevice) runtimeAuthorityDevice = safeClone(device);
  const secretKey = String(device?.nostr?.skHex || '').trim();
  const storedPk = String(device?.nostr?.pk || '').trim();
  if (!secretKey) {
    throw new Error('runtime authority waitingAuthority: signing key unavailable');
  }
  const publicKey = pubkeyFromSecretKey(secretKey);
  if (storedPk && storedPk !== publicKey) {
    throw new Error('runtime authority ambiguous: public key mismatch');
  }
  return {
    device,
    publicKey,
    secretKey,
  };
}

function normalizeRuntimeAuthorityDevice(value) {
  const evidence = runtimeAuthorityEvidence(value);
  const device = evidence.device;
  if (!device) return null;
  const nostr = evidence.nostr || {};
  const secretKey = evidence.secretKey;
  if (!secretKey) return null;
  if (evidence.error) throw new Error(evidence.error);
  if (evidence.storedPk && evidence.storedPk !== evidence.publicKey) {
    throw new Error('runtime authority ambiguous: public key mismatch');
  }
  return {
    ...safeClone(device),
    nostr: {
      ...safeClone(nostr),
      pk: evidence.publicKey,
      skHex: secretKey,
    },
  };
}

async function handleRuntimeAuthorityDevicePut(message) {
  let device;
  try {
    device = normalizeRuntimeAuthorityDevice(message.device || message.payload || message);
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'invalid runtime device authority') };
  }
  if (!device) return { ok: false, error: 'runtime device authority missing device key' };
  runtimeAuthorityDevice = safeClone(device);
  setRuntimeAuthorityPosture({
    state: 'ready',
    reason: 'runtime device authority ready',
    source: 'account.bridge',
    devicePk: String(device?.nostr?.pk || '').trim(),
    identityId: String(device?.identityId || device?.identity_id || device?.ownerIdentityId || '').trim(),
    expiresAt: Number(device?.expiresAt || device?.expires_at || 0) || 0,
  });
  const persistResult = await kvSet('device', device).catch((error) => {
    recordRuntimeEvent('runtime.authority.device.persist_failed', {
      error: String(error?.message || error || 'device authority persist failed'),
    });
    return null;
  });
  if (persistResult?.degraded) {
    recordRuntimeEvent('runtime.authority.device.persist_degraded', {
      level: 'warn',
      backend: persistResult.backend,
      error: persistResult.error,
      reason: 'indexedDbWriteTimedOut',
    });
  }
  recordRuntimeEvent('runtime.authority.device.ready', {
    devicePk: String(device?.nostr?.pk || '').trim(),
    source: 'account.bridge',
  });
  broadcastSnapshot();
  void flushPendingAuthorityIntents('runtime.authority.device.ready');
  return { ok: true, result: { devicePk: String(device?.nostr?.pk || '').trim(), posture: safeClone(runtimeAuthorityPostureState) } };
}

function runtimeAuthorityRecordRef(record) {
  const kind = String(record?.kind || record?.recordKind || '').trim();
  switch (kind) {
    case SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION:
      return String(record?.operationId || '').trim();
    case SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT:
      return String(record?.grantId || '').trim();
    case SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE:
      return String(record?.exerciseId || '').trim();
    case SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE:
      return String(record?.revocationId || '').trim();
    case SWARM.RECORD_KIND.ACCESS_GROUP:
      return String(record?.groupId || '').trim();
    case SWARM.RECORD_KIND.ACCESS_EPOCH:
      return String(record?.epochId || '').trim();
    case SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE:
      return String(record?.envelopeId || '').trim();
    case SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF:
      return String(record?.proofId || '').trim();
    case SWARM.RECORD_KIND.EVENT_FABRIC_ACCESS_CLASS:
      return String(record?.classId || '').trim();
    default:
      break;
  }
  return String(
    record?.operationId
    || record?.grantId
    || record?.exerciseId
    || record?.revocationId
    || record?.groupId
    || record?.epochId
    || record?.envelopeId
    || record?.proofId
    || record?.classId
    || record?.id
    || '',
  ).trim();
}

function runtimeAuthorityRecordsFromMessage(message) {
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
  if (Array.isArray(message?.records)) return message.records;
  if (Array.isArray(payload.records)) return payload.records;
  if (message?.record && typeof message.record === 'object') return [message.record];
  if (payload.record && typeof payload.record === 'object') return [payload.record];
  return [];
}

function authorityPlane(state = 'blocked', reason = '', extra = {}) {
  return {
    state,
    reason: String(reason || '').trim(),
    refs: [],
    blockedReasons: [],
    ...extra,
  };
}

function markAuthorityPlaneReady(plane, ref) {
  if (ref && !plane.refs.includes(ref)) plane.refs.push(ref);
  if (plane.state !== 'blocked') {
    plane.state = 'ready';
  } else if (!plane.blockedReasons.length) {
    plane.state = 'ready';
    plane.reason = '';
  }
}

function markAuthorityPlaneBlocked(plane, reason) {
  const value = String(reason || '').trim();
  if (value && !plane.blockedReasons.includes(value)) plane.blockedReasons.push(value);
  if (plane.state !== 'ready') {
    plane.state = 'blocked';
    plane.reason = plane.reason || value;
  } else {
    plane.state = 'degraded';
    plane.reason = plane.reason || value;
  }
}

function validateAuthorityReductionRecord(record) {
  const kind = String(record?.kind || record?.recordKind || '').trim();
  switch (kind) {
    case SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION:
      return assertAuthorityRootOperation(record);
    case SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT:
      return assertActionAuthorityGrant(record);
    case SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE:
      return assertActionAuthorityExercise(record);
    case SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE:
      return assertAuthorityGrantRevocationPosture(record);
    case SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF:
      return assertAuthorityMultiIdentityProof(record);
    case SWARM.RECORD_KIND.ACCESS_GROUP:
      return assertAccessGroup(record);
    case SWARM.RECORD_KIND.ACCESS_EPOCH:
      return assertAccessEpoch(record);
    case SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE:
      return assertPrivateContentEnvelope(record);
    case SWARM.RECORD_KIND.EVENT_FABRIC_ACCESS_CLASS:
      return assertEventFabricAccessClass(record);
    case SWARM.RECORD_KIND.EVENT_FABRIC_PROCESSOR_CONTRACT:
      return assertEventFabricProcessorContract(record);
    case SWARM.RECORD_KIND.SECURITY_PROCESSOR_SEED:
      return assertCybersecProcessorSeed(record);
    default:
      throw new Error(`unsupported authority record kind: ${kind || 'missing'}`);
  }
}

function provedAuthorityCheck(check) {
  return check?.state === AGREEMENT.AUTHORITY_PROOF_STATE.PROVED;
}

function authorityGrantUsable(state) {
  return [
    AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
    AGREEMENT.ACTION_GRANT_STATE.APPLIED,
  ].includes(state);
}

function authorityRecordExpired(record, now) {
  const expiresAt = Number(record?.expiresAt || 0) || 0;
  return expiresAt > 0 && expiresAt <= now;
}

function effectiveRevokedGrantRefs(records, now) {
  const revoked = new Set();
  for (const record of records) {
    if (record?.kind !== SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE) continue;
    if (![AGREEMENT.ACTION_GRANT_STATE.APPLIED, AGREEMENT.ACTION_GRANT_STATE.REVOKED].includes(record.state)) continue;
    const effectiveAt = Number(record.effectiveAt || record.issuedAt || 0) || 0;
    if (effectiveAt > now) continue;
    for (const ref of uniqueTrimmedStrings([
      record.targetGrantRef,
      ...normalizeArray(record.affectedGrantRefs),
    ])) {
      revoked.add(ref);
    }
  }
  return revoked;
}

function usableAuthorityGrantMap(records, revokedGrantRefs, now) {
  const grants = new Map();
  for (const record of records) {
    if (record?.kind !== SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT) continue;
    const ref = runtimeAuthorityRecordRef(record);
    if (!ref) continue;
    if (authorityRecordExpired(record, now)) continue;
    if (revokedGrantRefs.has(ref)) continue;
    if (!authorityGrantUsable(record.state)) continue;
    grants.set(ref, record);
  }
  return grants;
}

function authorityGrantRootAdminUsable(grant) {
  if (!grant) return false;
  const action = String(grant.action || '').trim();
  return grant.elevated === true || action.startsWith('authority.root.');
}

function rootOperationAdminGrantUsable(record, usableGrantMap) {
  for (const grantRef of uniqueTrimmedStrings(record?.adminGrantRefs)) {
    const grant = usableGrantMap.get(grantRef);
    if (!grant) continue;
    if (authorityGrantRootAdminUsable(grant)) return true;
  }
  return false;
}

function collectUnusableRootAdminGrantRefs(target, refs, usableGrantMap) {
  for (const ref of uniqueTrimmedStrings(refs)) {
    const grant = usableGrantMap.get(ref);
    if (!ref || authorityGrantRootAdminUsable(grant) || target.includes(ref)) continue;
    target.push(ref);
  }
}

function collectAuthorityRefs(target, values) {
  for (const ref of normalizeArray(values)) {
    if (ref && !target.includes(ref)) target.push(ref);
  }
}

function rootOperationBucket(operation) {
  switch (operation) {
    case AGREEMENT.ROOT_OPERATION.ADD_ROOT:
      return 'addRootRefs';
    case AGREEMENT.ROOT_OPERATION.REFRESH_ROOT:
      return 'refreshRootRefs';
    case AGREEMENT.ROOT_OPERATION.ROTATE_ROOT:
      return 'rotateRootRefs';
    case AGREEMENT.ROOT_OPERATION.REVOKE_ROOT:
      return 'revokeRootRefs';
    case AGREEMENT.ROOT_OPERATION.ENROLL_DEVICE:
      return 'enrollDeviceRefs';
    case AGREEMENT.ROOT_OPERATION.REVOKE_DEVICE:
      return 'revokeDeviceRefs';
    default:
      return '';
  }
}

const RUNTIME_AUTHORITY_PROOF_ROW_DEFINITIONS = Object.freeze([
  {
    check: AGREEMENT.AUTHORITY_PROOF_CHECK.SYNC,
    plane: AGREEMENT.PLANE.DELIVERY_WITNESS,
    actionabilityKey: 'canSync',
    missingReason: 'syncWitnessMissing',
  },
  {
    check: AGREEMENT.AUTHORITY_PROOF_CHECK.READ,
    plane: AGREEMENT.PLANE.ACCESS_AUTHORITY,
    actionabilityKey: 'canRead',
    missingReason: 'accessAuthorityMissing',
  },
  {
    check: AGREEMENT.AUTHORITY_PROOF_CHECK.WRITE_REDUCE,
    plane: AGREEMENT.PLANE.ACTION_AUTHORITY,
    actionabilityKey: 'canWriteReduce',
    missingReason: 'actionAuthorityMissing',
  },
  {
    check: AGREEMENT.AUTHORITY_PROOF_CHECK.REVOKE_EXPIRE,
    plane: AGREEMENT.PLANE.ACTION_AUTHORITY,
    actionabilityKey: 'canRevokeExpire',
    missingReason: 'revokeExpireMissing',
  },
]);

function runtimeAuthorityProofRow(definition, reduction) {
  return {
    check: definition.check,
    plane: definition.plane,
    state: 'blocked',
    actionable: false,
    targetRefs: [],
    grantRefs: [],
    accessGroupRefs: [],
    accessEpochRefs: [],
    exerciseRefs: [],
    evidenceRefs: [],
    expiresAt: 0,
    blockedReason: definition.missingReason,
    updatedAt: reduction.updatedAt,
  };
}

function mergeAuthorityProofRow(row, check) {
  const state = String(check?.state || '').trim();
  if (row.state !== AGREEMENT.AUTHORITY_PROOF_STATE.PROVED || state === AGREEMENT.AUTHORITY_PROOF_STATE.PROVED) {
    row.state = state || row.state;
  }
  if (check?.targetRef && !row.targetRefs.includes(check.targetRef)) row.targetRefs.push(check.targetRef);
  for (const ref of normalizeArray(check?.grantRefs)) {
    if (ref && !row.grantRefs.includes(ref)) row.grantRefs.push(ref);
  }
  for (const ref of normalizeArray(check?.accessGroupRefs)) {
    if (ref && !row.accessGroupRefs.includes(ref)) row.accessGroupRefs.push(ref);
  }
  for (const ref of normalizeArray(check?.accessEpochRefs)) {
    if (ref && !row.accessEpochRefs.includes(ref)) row.accessEpochRefs.push(ref);
  }
  for (const ref of normalizeArray(check?.exerciseRefs)) {
    if (ref && !row.exerciseRefs.includes(ref)) row.exerciseRefs.push(ref);
  }
  for (const ref of normalizeArray(check?.evidenceRefs)) {
    if (ref && !row.evidenceRefs.includes(ref)) row.evidenceRefs.push(ref);
  }
  row.expiresAt = Math.max(row.expiresAt, Number(check?.expiresAt || 0) || 0);
  row.blockedReason = String(check?.blockedReason || '').trim() || row.blockedReason;
  return row;
}

function runtimeAuthorityRefCoverage(refs = []) {
  const coverage = {
    contractRefs: [],
    serviceRefs: [],
    eventFabricRefs: [],
    storageRefs: [],
    sourceRefs: [],
    buildRefs: [],
    appRefs: [],
    moduleRefs: [],
    runnerRefs: [],
    otherRefs: [],
  };
  const push = (bucket, ref) => {
    if (ref && !coverage[bucket].includes(ref)) coverage[bucket].push(ref);
  };
  for (const ref of uniqueTrimmedStrings(refs)) {
    if (ref.startsWith('contract:')) push('contractRefs', ref);
    else if (ref.startsWith('service:')) push('serviceRefs', ref);
    else if (ref.startsWith('event-fabric:')) push('eventFabricRefs', ref);
    else if (ref.startsWith('storage:')) push('storageRefs', ref);
    else if (ref.startsWith('source:')) push('sourceRefs', ref);
    else if (ref.startsWith('build:')) push('buildRefs', ref);
    else if (ref.startsWith('app:')) push('appRefs', ref);
    else if (ref.startsWith('module:')) push('moduleRefs', ref);
    else if (ref.startsWith('runner:')) push('runnerRefs', ref);
    else push('otherRefs', ref);
  }
  return coverage;
}

function runtimeAuthorityWalletPosture(validRecords, reduction) {
  const proofRecords = validRecords.filter((record) => record.kind === SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF);
  const rows = RUNTIME_AUTHORITY_PROOF_ROW_DEFINITIONS.map((definition) => runtimeAuthorityProofRow(definition, reduction));
  const rowByCheck = new Map(rows.map((row) => [row.check, row]));
  for (const proof of proofRecords) {
    for (const check of normalizeArray(proof.checks)) {
      const row = rowByCheck.get(check?.check);
      if (!row) continue;
      mergeAuthorityProofRow(row, check);
    }
  }
  for (const definition of RUNTIME_AUTHORITY_PROOF_ROW_DEFINITIONS) {
    const row = rowByCheck.get(definition.check);
    row.actionable = Boolean(reduction.actionability[definition.actionabilityKey]);
    if (row.actionable && row.state === 'blocked') {
      row.state = AGREEMENT.AUTHORITY_PROOF_STATE.DEGRADED;
      row.blockedReason = 'proofCheckMissing';
    }
    if (row.state === AGREEMENT.AUTHORITY_PROOF_STATE.PROVED) row.blockedReason = '';
  }
  const primaryProof = proofRecords[0] || {};
  const subjectRefs = uniqueTrimmedStrings(proofRecords.flatMap((record) => normalizeArray(record.subjectRefs)));
  return {
    kind: 'runtime.authority.wallet.posture',
    state: reduction.state,
    ownerIdentityRef: String(primaryProof.ownerIdentityRef || '').trim(),
    granteeIdentityRef: String(primaryProof.granteeIdentityRef || '').trim(),
    granteeMemberRef: String(primaryProof.granteeMemberRef || '').trim(),
    subjectRefs,
    subjectCoverage: runtimeAuthorityRefCoverage(subjectRefs),
    resourceCoverage: runtimeAuthorityRefCoverage(reduction.actionAuthority.resourceRefs),
    actionGrantRefs: safeClone(reduction.actionAuthority.grantRefs),
    actionExerciseRefs: safeClone(reduction.actionAuthority.exerciseRefs),
    accessGroupRefs: safeClone(reduction.accessAuthority.accessGroupRefs),
    accessEpochRefs: safeClone(reduction.accessAuthority.accessEpochRefs),
    privateEnvelopeRefs: safeClone(reduction.accessAuthority.privateEnvelopeRefs),
    revocationRefs: safeClone(reduction.actionAuthority.revocationRefs),
    proofRefs: uniqueTrimmedStrings(proofRecords.map((record) => record.proofId)),
    rows,
    actionability: safeClone(reduction.actionability),
    blockedReasons: safeClone(reduction.blockedReasons),
    updatedAt: reduction.updatedAt,
  };
}

function reduceRuntimeAuthorityRecords(message = {}) {
  const records = runtimeAuthorityRecordsFromMessage(message);
  const now = nowMs();
  const validRecords = [];
  const reduction = {
    kind: 'runtime.authority.reduction',
    state: 'blocked',
    actionAuthority: authorityPlane('blocked', 'action authority missing', {
      grantRefs: [],
      exerciseRefs: [],
      rootOperationRefs: [],
      revocationRefs: [],
      expiredGrantRefs: [],
      revokedGrantRefs: [],
      actions: [],
      resourceRefs: [],
    }),
    accessAuthority: authorityPlane('blocked', 'access authority missing', {
      accessGroupRefs: [],
      accessEpochRefs: [],
      privateEnvelopeRefs: [],
      contentClasses: [],
      currentEpochRefs: [],
      futureReadable: false,
      rawReadable: false,
    }),
    deliveryWitness: authorityPlane('blocked', 'delivery witness missing', {
      proofRefs: [],
      witnessRefs: [],
    }),
    rootDeviceAuthority: authorityPlane('notRequired', '', {
      operationRefs: [],
      addRootRefs: [],
      refreshRootRefs: [],
      rotateRootRefs: [],
      revokeRootRefs: [],
      enrollDeviceRefs: [],
      revokeDeviceRefs: [],
      rootRefs: [],
      deviceRefs: [],
      adminGrantRefs: [],
      unusableAdminGrantRefs: [],
      notificationRefs: [],
      evidenceRefs: [],
      blockedOperationRefs: [],
    }),
    materialization: authorityPlane('notRequired', '', {
      eventFabricAccessClassRefs: [],
      processorRoleRefs: [],
    }),
    actionability: {
      canSync: false,
      canRead: false,
      canWriteReduce: false,
      canRevokeExpire: false,
      canAct: false,
      futureReadable: false,
      rawReadable: false,
      canUseActionGrant: false,
    },
    recordRefs: [],
    invalidRecords: [],
    blockedReasons: [],
    updatedAt: now,
  };

  for (const [index, raw] of records.entries()) {
    let record;
    try {
      record = validateAuthorityReductionRecord(raw);
    } catch (error) {
      const reason = String(error?.message || error || 'invalid authority record').trim();
      reduction.invalidRecords.push({ index, kind: String(raw?.kind || raw?.recordKind || '').trim(), reason });
      reduction.blockedReasons.push(reason);
      continue;
    }
    validRecords.push(record);
  }

  const revokedGrantRefs = effectiveRevokedGrantRefs(validRecords, now);
  const usableGrantMap = usableAuthorityGrantMap(validRecords, revokedGrantRefs, now);

  for (const record of validRecords) {

    const ref = runtimeAuthorityRecordRef(record);
    if (ref && !reduction.recordRefs.includes(ref)) reduction.recordRefs.push(ref);

    switch (record.kind) {
      case SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION:
        if (authorityGrantUsable(record.state)) {
          if (!rootOperationAdminGrantUsable(record, usableGrantMap)) {
            markAuthorityPlaneBlocked(reduction.actionAuthority, 'adminGrantUnavailable');
            markAuthorityPlaneBlocked(reduction.rootDeviceAuthority, 'adminGrantUnavailable');
            if (ref && !reduction.rootDeviceAuthority.blockedOperationRefs.includes(ref)) {
              reduction.rootDeviceAuthority.blockedOperationRefs.push(ref);
            }
            collectUnusableRootAdminGrantRefs(
              reduction.rootDeviceAuthority.unusableAdminGrantRefs,
              record.adminGrantRefs,
              usableGrantMap,
            );
            break;
          }
          markAuthorityPlaneReady(reduction.actionAuthority, ref);
          markAuthorityPlaneReady(reduction.rootDeviceAuthority, ref);
          if (!reduction.actionAuthority.rootOperationRefs.includes(ref)) reduction.actionAuthority.rootOperationRefs.push(ref);
          if (!reduction.rootDeviceAuthority.operationRefs.includes(ref)) reduction.rootDeviceAuthority.operationRefs.push(ref);
          const bucket = rootOperationBucket(record.operation);
          if (bucket && !reduction.rootDeviceAuthority[bucket].includes(ref)) reduction.rootDeviceAuthority[bucket].push(ref);
          collectAuthorityRefs(reduction.rootDeviceAuthority.rootRefs, record.rootRefs);
          collectAuthorityRefs(reduction.rootDeviceAuthority.deviceRefs, record.deviceRefs);
          collectAuthorityRefs(reduction.rootDeviceAuthority.adminGrantRefs, record.adminGrantRefs);
          collectAuthorityRefs(reduction.rootDeviceAuthority.notificationRefs, record.notificationRefs);
          collectAuthorityRefs(reduction.rootDeviceAuthority.evidenceRefs, record.evidenceRefs);
        } else {
          markAuthorityPlaneBlocked(reduction.actionAuthority, record.blockedReason || record.state);
          markAuthorityPlaneBlocked(reduction.rootDeviceAuthority, record.blockedReason || record.state);
        }
        break;
      case SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT:
        if (authorityRecordExpired(record, now)) {
          if (ref && !reduction.actionAuthority.expiredGrantRefs.includes(ref)) reduction.actionAuthority.expiredGrantRefs.push(ref);
          markAuthorityPlaneBlocked(reduction.actionAuthority, 'grantExpired');
        } else if (revokedGrantRefs.has(ref)) {
          if (ref && !reduction.actionAuthority.revokedGrantRefs.includes(ref)) reduction.actionAuthority.revokedGrantRefs.push(ref);
          markAuthorityPlaneBlocked(reduction.actionAuthority, 'grantRevoked');
        } else if (authorityGrantUsable(record.state)) {
          markAuthorityPlaneReady(reduction.actionAuthority, ref);
          if (!reduction.actionAuthority.grantRefs.includes(ref)) reduction.actionAuthority.grantRefs.push(ref);
          if (record.action && !reduction.actionAuthority.actions.includes(record.action)) reduction.actionAuthority.actions.push(record.action);
          if (record.resourceRef && !reduction.actionAuthority.resourceRefs.includes(record.resourceRef)) reduction.actionAuthority.resourceRefs.push(record.resourceRef);
          reduction.actionability.canUseActionGrant = true;
        } else {
          markAuthorityPlaneBlocked(reduction.actionAuthority, record.blockedReason || record.state);
        }
        break;
      case SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE:
        if (authorityGrantUsable(record.state)) {
          markAuthorityPlaneReady(reduction.actionAuthority, ref);
          if (!reduction.actionAuthority.exerciseRefs.includes(ref)) reduction.actionAuthority.exerciseRefs.push(ref);
        } else {
          markAuthorityPlaneBlocked(reduction.actionAuthority, record.blockedReason || record.state);
        }
        break;
      case SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE:
        markAuthorityPlaneReady(reduction.actionAuthority, ref);
        if (!reduction.actionAuthority.revocationRefs.includes(ref)) reduction.actionAuthority.revocationRefs.push(ref);
        for (const grantRef of uniqueTrimmedStrings([record.targetGrantRef, ...normalizeArray(record.affectedGrantRefs)])) {
          if (revokedGrantRefs.has(grantRef) && !reduction.actionAuthority.revokedGrantRefs.includes(grantRef)) {
            reduction.actionAuthority.revokedGrantRefs.push(grantRef);
          }
        }
        reduction.actionability.canRevokeExpire = true;
        break;
      case SWARM.RECORD_KIND.ACCESS_GROUP:
        markAuthorityPlaneReady(reduction.accessAuthority, ref);
        if (!reduction.accessAuthority.accessGroupRefs.includes(ref)) reduction.accessAuthority.accessGroupRefs.push(ref);
        for (const contentClass of normalizeArray(record.contentClasses)) {
          if (contentClass && !reduction.accessAuthority.contentClasses.includes(contentClass)) reduction.accessAuthority.contentClasses.push(contentClass);
        }
        if (record.currentEpochId && !reduction.accessAuthority.currentEpochRefs.includes(record.currentEpochId)) {
          reduction.accessAuthority.currentEpochRefs.push(record.currentEpochId);
        }
        reduction.accessAuthority.futureReadable = true;
        reduction.actionability.futureReadable = true;
        break;
      case SWARM.RECORD_KIND.ACCESS_EPOCH:
        markAuthorityPlaneReady(reduction.accessAuthority, ref);
        if (!reduction.accessAuthority.accessEpochRefs.includes(ref)) reduction.accessAuthority.accessEpochRefs.push(ref);
        reduction.accessAuthority.futureReadable = true;
        reduction.actionability.futureReadable = true;
        break;
      case SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE:
        markAuthorityPlaneReady(reduction.accessAuthority, ref);
        if (!reduction.accessAuthority.privateEnvelopeRefs.includes(ref)) reduction.accessAuthority.privateEnvelopeRefs.push(ref);
        if (record.contentClass && !reduction.accessAuthority.contentClasses.includes(record.contentClass)) reduction.accessAuthority.contentClasses.push(record.contentClass);
        reduction.accessAuthority.rawReadable = true;
        reduction.actionability.rawReadable = true;
        break;
      case SWARM.RECORD_KIND.EVENT_FABRIC_ACCESS_CLASS:
        reduction.materialization.state = 'ready';
        if (ref && !reduction.materialization.refs.includes(ref)) reduction.materialization.refs.push(ref);
        if (!reduction.materialization.eventFabricAccessClassRefs.includes(ref)) reduction.materialization.eventFabricAccessClassRefs.push(ref);
        for (const roleRef of normalizeArray(record.processorRoleRefs)) {
          if (roleRef && !reduction.materialization.processorRoleRefs.includes(roleRef)) reduction.materialization.processorRoleRefs.push(roleRef);
        }
        break;
      case SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF:
        if (record.state !== AGREEMENT.AUTHORITY_PROOF_STATE.PROVED) {
          markAuthorityPlaneBlocked(reduction.actionAuthority, normalizeArray(record.blockedReasons)[0] || record.state);
        }
        if (ref && !reduction.deliveryWitness.proofRefs.includes(ref)) reduction.deliveryWitness.proofRefs.push(ref);
        for (const check of normalizeArray(record.checks)) {
          if (check.check === AGREEMENT.AUTHORITY_PROOF_CHECK.SYNC && provedAuthorityCheck(check)) {
            reduction.actionability.canSync = true;
            markAuthorityPlaneReady(reduction.deliveryWitness, ref);
          }
          if (check.check === AGREEMENT.AUTHORITY_PROOF_CHECK.READ && provedAuthorityCheck(check)) {
            reduction.actionability.canRead = true;
            markAuthorityPlaneReady(reduction.accessAuthority, ref);
            for (const groupRef of normalizeArray(check.accessGroupRefs)) {
              if (groupRef && !reduction.accessAuthority.accessGroupRefs.includes(groupRef)) reduction.accessAuthority.accessGroupRefs.push(groupRef);
            }
          }
          if (check.check === AGREEMENT.AUTHORITY_PROOF_CHECK.WRITE_REDUCE && provedAuthorityCheck(check)) {
            reduction.actionability.canWriteReduce = true;
            markAuthorityPlaneReady(reduction.actionAuthority, ref);
          }
          if (check.check === AGREEMENT.AUTHORITY_PROOF_CHECK.REVOKE_EXPIRE && provedAuthorityCheck(check)) {
            reduction.actionability.canRevokeExpire = true;
            markAuthorityPlaneReady(reduction.actionAuthority, ref);
          }
        }
        break;
      default:
        break;
    }
  }

  reduction.actionability.canAct = reduction.actionability.canUseActionGrant || reduction.actionability.canWriteReduce || reduction.actionability.canRevokeExpire;
  reduction.actionability.canRead = reduction.actionability.canRead && reduction.accessAuthority.state !== 'blocked';

  const missing = [];
  if (!records.length) missing.push('authorityRecordsMissing');
  if (!reduction.actionability.canSync) missing.push('syncWitnessMissing');
  if (!reduction.actionability.canAct) missing.push('actionAuthorityMissing');
  if (!reduction.actionability.canRead && !reduction.actionability.rawReadable && !reduction.actionability.futureReadable) missing.push('accessAuthorityMissing');

  reduction.blockedReasons = uniqueTrimmedStrings([
    ...reduction.blockedReasons,
    ...missing,
    ...reduction.actionAuthority.blockedReasons,
    ...reduction.accessAuthority.blockedReasons,
    ...reduction.deliveryWitness.blockedReasons,
    ...reduction.rootDeviceAuthority.blockedReasons,
  ]);
  if (reduction.invalidRecords.length) {
    reduction.state = 'blocked';
  } else if (missing.length) {
    reduction.state = records.length ? 'degraded' : 'blocked';
  } else {
    reduction.state = 'ready';
  }

  if (reduction.actionAuthority.state === 'blocked' && reduction.actionAuthority.refs.length) reduction.actionAuthority.state = 'degraded';
  if (reduction.accessAuthority.state === 'blocked' && reduction.accessAuthority.refs.length) reduction.accessAuthority.state = 'degraded';
  if (reduction.deliveryWitness.state === 'blocked' && reduction.deliveryWitness.refs.length) reduction.deliveryWitness.state = 'degraded';
  reduction.walletPosture = runtimeAuthorityWalletPosture(validRecords, reduction);

  return reduction;
}

function handleRuntimeAuthorityRecordsReduce(message) {
  const result = reduceRuntimeAuthorityRecords(message);
  recordRuntimeEvent('runtime.authority.records.reduced', {
    state: result.state,
    recordCount: runtimeAuthorityRecordsFromMessage(message).length,
    actionAuthorityState: result.actionAuthority.state,
    accessAuthorityState: result.accessAuthority.state,
    deliveryWitnessState: result.deliveryWitness.state,
    canSync: result.actionability.canSync,
    canRead: result.actionability.canRead,
    canWriteReduce: result.actionability.canWriteReduce,
    canRevokeExpire: result.actionability.canRevokeExpire,
  });
  return { ok: true, result };
}

function appIntentRecipientPks(intent, authority) {
  const recipients = [];
  for (const value of normalizeArray(intent?.recipientPks)) {
    pushUniqueHexPublicKey(recipients, value);
  }
  pushUniqueHexPublicKey(recipients, intent?.recipientPk);
  pushUniqueHexPublicKey(recipients, intent?.memberRef);
  pushUniqueHexPublicKey(recipients, intent?.routeMemberRef);
  pushUniqueHexPublicKey(recipients, intent?.serviceMemberRef);
  pushUniqueHexPublicKey(recipients, intent?.servicePk);
  pushUniqueHexPublicKey(recipients, intent?.recipientServicePk);
  pushUniqueHexPublicKey(recipients, intent?.gatewayPk);
  if (recipients.length === 0) {
    pushUniqueHexPublicKey(recipients, authority.publicKey);
  }
  return recipients;
}

function normalizeSwarmRetryPolicy(value) {
  const source = value && typeof value === 'object' ? value : {};
  const onReject = String(source.onReject || 'preserve').trim().toLowerCase();
  return {
    onReject: onReject === 'drop' || onReject === 'remove' ? 'drop' : 'preserve',
    maxAttempts: Math.max(1, Number(source.maxAttempts || 3)),
  };
}

function swarmFrameFromMessage(message) {
  const source = message.frame && typeof message.frame === 'object'
    ? message.frame
    : message.payload && typeof message.payload === 'object'
      ? message.payload
      : message;
  const body = source.body && typeof source.body === 'object' ? safeClone(source.body) : defaultSwarmBody();
  const frame = source.frameId
    ? assertSwarmFrame(safeClone(source))
    : makeSwarmFrame({
        kind: source.kind || SWARM.FRAME_KIND.SERVICE_INTENT,
        issuer: source.issuer || source.browserDevicePk || source.devicePk,
        audience: source.audience,
        zoneScope: source.zoneScope,
        issuedAt: source.issuedAt,
        expiresAt: source.expiresAt,
        nonce: source.nonce,
        correlationId: source.correlationId,
        channelId: source.channelId,
        recordRef: source.recordRef,
        capability: source.capability || SWARM.CORE_CAPABILITY.SERVICE_INTENT_INVOKE,
        body,
      });
  if (frame.body?.encoding !== SWARM.BODY_ENCODING.CAAC && frame.body?.encoding !== SWARM.BODY_ENCODING.PUBLIC) {
    throw new Error('unsupported swarm frame body');
  }
  return frame;
}

function postLiveEdgeRecord(record) {
  const socket = swarmEdge.socket;
  if (!socket || socket.readyState !== 1) return false;
  socket.send(JSON.stringify(record));
  return true;
}

function sendEdgeFrame(entry) {
  const record = { type: 'swarm.frame', frame: safeClone(entry.frame) };
  if (swarmEdge.mode === 'live') {
    return postLiveEdgeRecord(record);
  }
  if (swarmEdge.mode === 'test') {
    return true;
  }
  return false;
}

const SWARM_QUEUE_TERMINAL_STATUSES = new Set(['closed', 'dropped', 'expired', 'failed', 'rejected', 'released']);
const ROUTE_MEMBER_REACH_STATES = new Set([
  'delivered',
  'memberWritten',
  'memberRead',
]);
const ROUTE_SIGNAL_CARRIER_STATES = new Set([
  ...ROUTE_MEMBER_REACH_STATES,
  'accepted',
]);

function queuedSwarmFrameExpiresAt(entry) {
  return Number(entry?.frame?.expiresAt || entry?.frame?.expires_at || 0) || 0;
}

function queuedSwarmFrameTerminal(entry) {
  return SWARM_QUEUE_TERMINAL_STATUSES.has(String(entry?.status || '').trim());
}

function queuedSwarmFrameRecordKind(entry) {
  return String(entry?.frame?.recordRef?.kind || entry?.frame?.record_ref?.kind || '').trim();
}

function queuedSwarmFrameRequiresServiceAdmission(entry) {
  return queuedSwarmFrameRecordKind(entry) === 'stream.session.offer';
}

function routeObservationReachedMember(rawState = '') {
  return ROUTE_MEMBER_REACH_STATES.has(String(rawState || '').trim());
}

function routeObservationCarriedSignal(rawState = '') {
  return ROUTE_SIGNAL_CARRIER_STATES.has(String(rawState || '').trim());
}

function routeObservationCarrierStatus(rawState = '') {
  const state = String(rawState || '').trim();
  return state === 'accepted' ? 'routeAccepted' : state;
}

function queuedSwarmFrameSignalDeliveryState(entry, rawState = '') {
  const recordKind = queuedSwarmFrameRecordKind(entry);
  if (recordKind === 'stream.session.offer') return '';
  if (!routeObservationCarriedSignal(rawState)) return '';
  if (recordKind === 'stream.session.candidate') return 'candidateSignalDelivered';
  if (recordKind === 'stream.session.close') return 'streamCloseDelivered';
  if (recordKind === 'stream.session.control') return 'streamControlDelivered';
  return '';
}

function serviceAdmissionDueAt(entry) {
  const observedAt = Number(entry?.routeObservedAt || 0) || 0;
  return observedAt > 0 ? observedAt + SERVICE_ADMISSION_TIMEOUT_MS : 0;
}

function routeDeliveryPosture(entry = {}) {
  const observation = entry?.routeObservation && typeof entry.routeObservation === 'object' ? entry.routeObservation : {};
  const rawObservation = observation.raw && typeof observation.raw === 'object' ? observation.raw : {};
  const deliveredTo = uniqueTrimmedStrings([
    ...normalizeArray(observation.deliveredTo),
    ...normalizeArray(rawObservation.deliveredTo || rawObservation.delivered_to),
  ]);
  const propagation = normalizeArray(entry?.ack?.propagation)
    .filter((target) => target && typeof target === 'object')
    .map((target) => ({
      memberRef: String(target.memberRef || target.member_ref || '').trim(),
      memberKind: String(target.memberKind || target.member_kind || '').trim(),
      zoneId: String(target.zoneId || target.zone_id || '').trim(),
      channelIds: uniqueTrimmedStrings(target.channelIds || target.channel_ids || []),
      capabilities: uniqueTrimmedStrings(target.capabilities || []),
    }))
    .filter((target) => target.memberRef);
  const memberKinds = uniqueTrimmedStrings(propagation.map((target) => target.memberKind));
  return {
    deliveredTo,
    deliveredCount: deliveredTo.length,
    propagationCount: propagation.length,
    memberKinds,
    serviceDeliveryCount: propagation.filter((target) => target.memberKind === 'service').length,
    browserDeliveryCount: propagation.filter((target) => target.memberKind === 'browser').length,
    gatewayDeliveryCount: propagation.filter((target) => target.memberKind === 'gateway').length,
  };
}

function clearServiceAdmissionTimeout(entry) {
  const frameId = String(entry?.frameId || '').trim();
  if (!frameId) return;
  const timer = serviceAdmissionTimeoutTimers.get(frameId);
  if (timer) self.clearTimeout(timer);
  serviceAdmissionTimeoutTimers.delete(frameId);
}

function markServiceAdmissionTimedOut(entry, observedAt = nowMs()) {
  if (!entry || queuedSwarmFrameTerminal(entry)) return false;
  if (!queuedSwarmFrameRequiresServiceAdmission(entry)) return false;
  if (entry.serviceAccepted || entry.serviceRejected || entry.serviceAnswer) return false;
  const status = String(entry.status || '').trim();
  if (!routeObservationReachedMember(status) && status !== 'serviceAdmissionTimedOut') return false;
  const dueAt = serviceAdmissionDueAt(entry);
  if (!dueAt || dueAt > observedAt) return false;
  clearServiceAdmissionTimeout(entry);
  entry.status = 'serviceAdmissionTimedOut';
  entry.serviceAdmissionTimedOutAt = observedAt;
  entry.lastError = {
    code: 'service.admission.timeout',
    message: 'member reach observed but no service witness arrived before timeout',
    retryable: true,
    timeoutMs: SERVICE_ADMISSION_TIMEOUT_MS,
  };
  recordRuntimeEvent('service.admission.timeout', {
    level: 'warn',
    frameId: entry.frameId,
    correlationId: entry.frame?.correlationId || '',
    activationId: String(entry.activationId || '').trim(),
    routePromiseId: String(entry.routePromiseId || '').trim(),
    timeoutMs: SERVICE_ADMISSION_TIMEOUT_MS,
    routeDelivery: routeDeliveryPosture(entry),
  });
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return true;
}

function scheduleServiceAdmissionTimeout(entry) {
  if (!entry || queuedSwarmFrameTerminal(entry)) return;
  if (!queuedSwarmFrameRequiresServiceAdmission(entry)) return;
  if (entry.serviceAccepted || entry.serviceRejected || entry.serviceAnswer) {
    clearServiceAdmissionTimeout(entry);
    return;
  }
  const status = String(entry.status || '').trim();
  if (!routeObservationReachedMember(status)) return;
  const dueAt = serviceAdmissionDueAt(entry);
  if (!dueAt) return;
  const frameId = String(entry.frameId || '').trim();
  if (!frameId || serviceAdmissionTimeoutTimers.has(frameId)) return;
  const delayMs = Math.max(0, dueAt - nowMs());
  const timer = self.setTimeout(() => {
    serviceAdmissionTimeoutTimers.delete(frameId);
    const current = findQueuedFrame(frameId);
    if (current) markServiceAdmissionTimedOut(current);
  }, delayMs);
  serviceAdmissionTimeoutTimers.set(frameId, timer);
}

function refreshQueuedSwarmFrameForRetry(entry, reason = 'retry') {
  if (!entry?.frame || typeof entry.frame !== 'object') return null;
  const previousFrameId = String(entry.frameId || entry.frame.frameId || '').trim();
  clearServiceAdmissionTimeout(entry);
  const now = nowMs();
  const expiresAt = Number(entry.frame.expiresAt || 0) || 0;
  if (expiresAt && expiresAt <= now) return null;
  const refreshedFrame = makeSwarmFrame({
    kind: entry.frame.kind,
    issuer: entry.frame.issuer,
    audience: entry.frame.audience,
    zoneScope: entry.frame.zoneScope,
    issuedAt: now,
    expiresAt: entry.frame.expiresAt,
    nonce: randomOpaqueId('retry-nonce'),
    correlationId: entry.frame.correlationId,
    channelId: entry.frame.channelId,
    recordRef: entry.frame.recordRef,
    capability: entry.frame.capability,
    body: entry.frame.body,
    ack: entry.frame.ack,
  });
  if (previousFrameId && outboundSwarmFrames.get(previousFrameId) === entry) {
    outboundSwarmFrames.delete(previousFrameId);
  }
  entry.previousFrameId = previousFrameId;
  entry.frameId = refreshedFrame.frameId;
  entry.frame = refreshedFrame;
  outboundSwarmFrames.set(refreshedFrame.frameId, entry);
  recordRuntimeEvent('frame.retry.prepared', {
    frameId: refreshedFrame.frameId,
    previousFrameId,
    correlationId: refreshedFrame.correlationId || '',
    channelId: refreshedFrame.channelId || '',
    capability: refreshedFrame.capability || '',
    reason: String(reason || 'retry').trim(),
  });
  return refreshedFrame;
}

function markQueuedSwarmFrameExpired(entry, observedAt = nowMs()) {
  if (!entry || queuedSwarmFrameTerminal(entry)) return false;
  const expiresAt = queuedSwarmFrameExpiresAt(entry);
  if (!expiresAt || expiresAt > observedAt) return false;
  entry.status = 'expired';
  clearServiceAdmissionTimeout(entry);
  entry.retrySuppressed = true;
  entry.routeObservedAt = observedAt;
  entry.lastError = {
    code: 'activation.expired',
    message: 'activation attempt expired before terminal delivery',
    retryable: false,
  };
  return true;
}

function shouldSendQueuedSwarmEntry(entry) {
  markQueuedSwarmFrameExpired(entry);
  if (queuedSwarmFrameTerminal(entry)) return false;
  const status = String(entry?.status || '').trim();
  return status === 'queued' || status === 'retrying';
}

function routeObservationNeedsZoneBaseline(observation) {
  const state = String(observation?.state || '').trim();
  if (state !== 'observingUnreachable' && state !== 'unreachableFor') return false;
  const failedPredicates = normalizeArray(observation?.failedPredicates || observation?.failed_predicates)
    .map((entry) => String(entry || '').trim());
  return failedPredicates.some((predicate) => predicate === 'zeroPropagation' || predicate === 'noMemberInZone');
}

function queueRouteRepairsFromZoneBaseline(reason = 'zone-baseline') {
  let repaired = 0;
  for (const entry of Array.from(outboundSwarmFrames.values())) {
    markQueuedSwarmFrameExpired(entry);
    if (queuedSwarmFrameTerminal(entry)) continue;
    if (!routeObservationNeedsZoneBaseline(entry?.routeObservation)) continue;
    const policy = normalizeSwarmRetryPolicy(entry.retryPolicy);
    const attempts = Number(entry.attempts || 0);
    if (attempts >= policy.maxAttempts) continue;
    entry.status = 'retrying';
    entry.retrySuppressed = false;
    entry.retryReason = reason;
    entry.queuedAt = nowMs();
    const routingBaseline = directoryRoutingBaseline({
      zoneScope: entry.frame?.zoneScope,
      channelId: entry.frame?.channelId,
      capability: entry.frame?.capability,
      servicePk: entry.frame?.audience?.servicePk,
      service: entry.frame?.audience?.service,
      serviceRef: entry.frame?.audience?.serviceRef,
    });
    if (routingBaseline?.state) {
      entry.routingScope = {
        ...(entry.routingScope && typeof entry.routingScope === 'object' ? safeClone(entry.routingScope) : {
          kind: SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE,
          required: true,
          zoneScope: safeClone(entry.frame?.zoneScope || null),
        }),
        ...safeClone(routingBaseline),
      };
      if (entry.authoritySummary && typeof entry.authoritySummary === 'object') {
        entry.authoritySummary.routingScope = safeClone(entry.routingScope);
      }
    }
    const refreshed = refreshQueuedSwarmFrameForRetry(entry, reason);
    if (!refreshed) continue;
    repaired += 1;
    recordRuntimeEvent('route.repair.queued', {
      frameId: entry.frameId,
      previousFrameId: entry.previousFrameId || '',
      correlationId: entry.frame?.correlationId || '',
      activationId: entry.activationId || '',
      routePromiseId: entry.routePromiseId || '',
      reason,
      attempt: attempts + 1,
      routingScope: entry.routingScope ? safeClone(entry.routingScope) : null,
    });
  }
  if (repaired > 0) {
    touchRuntime();
    schedulePersist();
    sendQueuedSwarmFrames();
    broadcastSnapshot();
  }
  return repaired;
}

function sendQueuedSwarmFrames() {
  if (!swarmEdge.connected) return;
  for (const entry of outboundSwarmFrames.values()) {
    if (!shouldSendQueuedSwarmEntry(entry)) continue;
    if (!sendEdgeFrame(entry)) continue;
    const now = nowMs();
    entry.status = 'sent';
    entry.sentAt = now;
    entry.attempts = Number(entry.attempts || 0) + 1;
    swarmEdge.sentFrames.push({
      frameId: entry.frame.frameId,
      kind: entry.frame.kind,
      correlationId: entry.frame.correlationId || '',
      channelId: entry.frame.channelId || '',
      frame: safeClone(entry.frame),
      sentAt: now,
      attempt: entry.attempts,
    });
    recordRuntimeEvent('frame.sent', {
      frameId: entry.frame.frameId,
      kind: entry.frame.kind,
      correlationId: entry.frame.correlationId || '',
      channelId: entry.frame.channelId || '',
      capability: entry.frame.capability || '',
      attempt: entry.attempts,
    });
  }
  touchRuntime();
  schedulePersist();
  broadcast({ type: 'swarm.edge.sent', frames: swarmEdge.sentFrames.map((entry) => safeClone(entry)) });
  broadcastSnapshot();
}

function queueCorrelationIds(entry) {
  const out = [];
  for (const value of [
    entry?.frameId,
    entry?.activationId,
    entry?.interactionId,
    entry?.routePromiseId,
    entry?.frame?.frameId,
    entry?.frame?.correlationId,
  ]) {
    const id = String(value || '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function findQueuedFrameForRouteObservation(observation) {
  const candidates = [
    observation?.frameId,
    observation?.ackedFrameId,
    observation?.correlationId,
    observation?.activationId,
    observation?.routePromiseId,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const direct = findQueuedFrame(candidate);
    if (direct) return direct;
  }
  for (const entry of outboundSwarmFrames.values()) {
    const ids = queueCorrelationIds(entry);
    if (candidates.some((candidate) => ids.includes(candidate))) return entry;
  }
  return null;
}

function normalizeRouteObservation(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const state = String(source.state || source.status || '').trim() || 'observed';
  const failedPredicates = normalizeArray(source.failedPredicates || source.failed_predicates || source.predicates)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const candidateMembers = normalizeArray(source.candidateMembers || source.candidate_members || source.candidates)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => safeClone(entry));
  const deliveredTo = uniqueTrimmedStrings(source.deliveredTo || source.delivered_to || []);
  return {
    observationId: String(source.observationId || source.observation_id || '').trim() || randomOpaqueId('route-observation'),
    state,
    frameId: String(source.frameId || source.frame_id || source.ackedFrameId || source.acked_frame_id || '').trim(),
    correlationId: String(source.correlationId || source.correlation_id || '').trim(),
    routePromiseId: String(source.routePromiseId || source.route_promise_id || '').trim(),
    activationId: String(source.activationId || source.activation_id || '').trim(),
    deliveredTo,
    failedPredicates,
    candidateMembers,
    message: String(source.message || source.reason || source.detail || '').trim(),
    retryable: source.retryable === true,
    observedAt: Number(source.observedAt || source.observed_at || 0) || nowMs(),
    raw: safeClone(source),
  };
}

function recordRouteObservation(value) {
  const observation = normalizeRouteObservation(value);
  const entry = findQueuedFrameForRouteObservation(observation);
  let ignoredReason = '';
  if (entry) {
    const state = observation.state;
    if (state === 'expired') {
      entry.routeObservation = safeClone(observation);
      entry.routeObservedAt = observation.observedAt;
      entry.status = 'expired';
      clearServiceAdmissionTimeout(entry);
      entry.retrySuppressed = true;
      entry.lastError = {
        code: 'activation.expired',
        message: observation.message || 'activation attempt expired before terminal delivery',
        retryable: false,
      };
    } else if (markQueuedSwarmFrameExpired(entry, observation.observedAt) || queuedSwarmFrameTerminal(entry)) {
      ignoredReason = 'terminalActivation';
    } else {
      entry.routeObservation = safeClone(observation);
      entry.routeObservedAt = observation.observedAt;
      if (routeObservationReachedMember(state)) {
        entry.status = state;
        scheduleServiceAdmissionTimeout(entry);
      } else if (state === 'accepted') {
        if (!routeObservationReachedMember(entry.status)) {
          entry.status = 'routeAccepted';
        }
      }
      else if (state === 'closed' || state === 'released') {
        clearServiceAdmissionTimeout(entry);
        entry.status = state;
      }
      else if (state === 'rejected') {
        clearServiceAdmissionTimeout(entry);
        entry.status = observation.retryable ? 'rejected' : 'failed';
        entry.lastError = {
          code: 'route.rejected',
          message: observation.message || 'route rejected',
          retryable: observation.retryable,
        };
      } else if (state === 'observingUnreachable' || state === 'unreachableFor') {
        entry.status = state;
        entry.lastError = {
          code: 'route.unreachable',
          message: observation.message || observation.failedPredicates.join(', ') || 'route currently unreachable',
          retryable: true,
        };
      } else if (state === 'degraded') {
        entry.status = 'degraded';
      }
    }
  }
  swarmEdge.routeObservations.push(observation);
  if (swarmEdge.routeObservations.length > 100) {
    swarmEdge.routeObservations.splice(0, swarmEdge.routeObservations.length - 100);
  }
  touchRuntime();
  recordRuntimeEvent(ignoredReason ? 'route.observation.ignored' : 'route.observation', {
    frameId: observation.frameId,
    correlationId: observation.correlationId,
    activationId: String(entry?.activationId || observation.activationId || '').trim(),
    routePromiseId: String(entry?.routePromiseId || observation.routePromiseId || '').trim(),
    interactionId: String(entry?.interactionId || '').trim(),
    state: observation.state,
    ignoredReason,
    currentStatus: String(entry?.status || '').trim(),
    failedPredicates: observation.failedPredicates,
    deliveredTo: observation.deliveredTo,
    deliveredCount: observation.deliveredTo.length,
    candidateMembers: observation.candidateMembers,
    candidateCount: observation.candidateMembers.length,
    routeDelivery: entry ? routeDeliveryPosture(entry) : null,
    authoritySummary: entry?.authoritySummary ? safeClone(entry.authoritySummary) : null,
    message: observation.message,
  });
  schedulePersist();
  broadcast({ type: 'swarm.edge.routeObservation', observation: safeClone(observation) });
  broadcastSnapshot();
  return observation;
}

function routeObservationFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  const recordRefKind = String(frame?.recordRef?.kind || frame?.record_ref?.kind || '').trim();
  const recordKind = String(payload.recordKind || payload.record_kind || payload.kind || recordRefKind || '').trim();
  if (payload.routeObservation && typeof payload.routeObservation === 'object') return payload.routeObservation;
  if (payload.route_observation && typeof payload.route_observation === 'object') return payload.route_observation;
  if (recordKind === 'route.observation') {
    if (payload.record && typeof payload.record === 'object') return payload.record;
    return payload;
  }
  return null;
}

function streamLifecycleRecordFromOpenedFrame(frame) {
  return streamSessionLifecycleRecordFromCarrier(frame);
}

function mediaTransportObservationFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  const recordRefKind = String(frame?.recordRef?.kind || frame?.record_ref?.kind || '').trim();
  const recordKind = String(payload.recordKind || payload.record_kind || payload.kind || recordRefKind || '').trim();
  if (recordKind !== SWARM.RECORD_KIND.MEDIA_TRANSPORT_OBSERVATION) return null;
  const record = payload.record && typeof payload.record === 'object' ? payload.record : payload;
  return assertMediaTransportObservation(record);
}

function contributionLifecycleFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  const recordRefKind = String(frame?.recordRef?.kind || frame?.record_ref?.kind || '').trim();
  const recordKind = String(payload.recordKind || payload.record_kind || payload.kind || recordRefKind || '').trim();
  if (recordKind !== SWARM.RECORD_KIND.CONTRIBUTION_LIFECYCLE) return null;
  const record = payload.record && typeof payload.record === 'object' ? payload.record : payload;
  return assertContributionLifecycle(record);
}

function findQueuedFrameForContributionLifecycle(record) {
  const candidates = uniqueTrimmedStrings([
    record?.parentRef,
    record?.subjectRef,
    record?.targetContributionRef,
    ...normalizeArray(record?.witnessRefs),
    ...normalizeArray(record?.evidenceRefs),
  ]);
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const direct = findQueuedFrame(candidate);
    if (direct) return direct;
  }
  for (const entry of outboundSwarmFrames.values()) {
    const ids = queueCorrelationIds(entry);
    if (candidates.some((candidate) => ids.includes(candidate))) return entry;
  }
  return null;
}

function rememberContributionLifecycle(record) {
  const contributionId = String(record?.contributionId || '').trim();
  if (!contributionId) return;
  const index = swarmEdge.contributionLifecycles.findIndex((entry) => String(entry?.contributionId || '').trim() === contributionId);
  if (index >= 0) swarmEdge.contributionLifecycles.splice(index, 1);
  swarmEdge.contributionLifecycles.push(safeClone(record));
  while (swarmEdge.contributionLifecycles.length > CONTRIBUTION_LIFECYCLE_LIMIT) swarmEdge.contributionLifecycles.shift();
}

function reduceContributionLifecycleRecord(record, openedFrame = {}) {
  rememberContributionLifecycle(record);
  const observedAt = Number(record.observedAt || record.issuedAt || 0) || nowMs();
  const entry = findQueuedFrameForContributionLifecycle(record);
  if (entry) {
    entry.contributionLifecycle = safeClone(record);
    if (
      record.contributionType === SWARM.CONTRIBUTION_TYPE.WITNESS
      || record.state === SWARM.CONTRIBUTION_STATE.WITNESSED
    ) {
      entry.contributionWitnessedAt = observedAt;
    }
  }
  recordRuntimeEvent('contribution.lifecycle.applied', {
    frameId: String(openedFrame?.frameId || '').trim(),
    correlationId: String(openedFrame?.correlationId || '').trim(),
    contributionId: String(record.contributionId || '').trim(),
    contributionType: String(record.contributionType || '').trim(),
    state: String(record.state || SWARM.CONTRIBUTION_STATE.ACTIVE).trim(),
    parentRef: String(record.parentRef || '').trim(),
    subjectRef: String(record.subjectRef || '').trim(),
    targetContributionRef: String(record.targetContributionRef || '').trim(),
    writerRef: String(record.writerRef || '').trim(),
    role: String(record.role || '').trim(),
    activationId: String(entry?.activationId || '').trim(),
    routePromiseId: String(entry?.routePromiseId || '').trim(),
    witnessed: Boolean(entry?.contributionWitnessedAt),
  });
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return record;
}

function handleContributionLifecycleFrame(openedFrame) {
  const record = contributionLifecycleFromOpenedFrame(openedFrame);
  if (!record) return false;
  reduceContributionLifecycleRecord(record, openedFrame);
  return true;
}

function mediaFulfillmentStateForTransportObservation(record) {
  const state = String(record?.state || '').trim();
  if (state === SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.CONNECTED) return SWARM.MEDIA_FULFILLMENT_STATE.USABLE;
  if (
    state === SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.FAILED
    || state === SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.BLOCKED
  ) {
    return SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED;
  }
  if (
    state === SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.CLOSED
    || state === SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.RELEASED
  ) {
    return SWARM.MEDIA_FULFILLMENT_STATE.RELEASED;
  }
  return SWARM.MEDIA_FULFILLMENT_STATE.PENDING;
}

function blockedReasonForTransportObservation(record) {
  const state = String(record?.state || '').trim();
  if (
    state !== SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.FAILED
    && state !== SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.BLOCKED
  ) {
    return '';
  }
  return String(record?.blockedReason || record?.reason || record?.connectionState || 'mediaTransportBlocked').trim();
}

function fulfillmentEvidenceFromTransportObservation(record, openedFrame) {
  const fulfillmentState = mediaFulfillmentStateForTransportObservation(record);
  const safeFacts = {
    observationId: String(record.observationId || '').trim(),
    participantRole: String(record.participantRole || '').trim(),
    observationState: String(record.state || '').trim(),
    connectionState: String(record.connectionState || '').trim(),
    iceConnectionState: String(record.iceConnectionState || '').trim(),
    selectedPairState: String(record.selectedPairState || '').trim(),
    inboundRtpState: String(record.inboundRtpState || '').trim(),
    renderState: String(record.renderState || '').trim(),
    reason: String(record.reason || '').trim(),
  };
  const evidence = {
    kind: SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
    evidenceId: `media-observation:${String(record.observationId || openedFrame?.frameId || randomOpaqueId('media-observation')).trim()}`,
    evidenceKind: SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE,
    state: fulfillmentState,
    sessionId: String(record.sessionId || '').trim(),
    activationId: String(record.activationId || '').trim() || undefined,
    correlationId: String(openedFrame?.correlationId || openedFrame?.frameId || '').trim() || undefined,
    routePromiseId: String(record.routePromiseId || '').trim() || undefined,
    participantRef: String(record.participantRef || '').trim(),
    adapterRef: String(record.participantRole || '').trim() === SWARM.MEDIA_TRANSPORT_PARTICIPANT_ROLE.BROWSER
      ? String(record.participantRef || '').trim()
      : undefined,
    serviceRef: String(record.participantRole || '').trim() === SWARM.MEDIA_TRANSPORT_PARTICIPANT_ROLE.SERVICE
      ? String(record.participantRef || '').trim()
      : undefined,
    safeFacts,
    evidenceRefs: uniqueTrimmedStrings([record.observationId, record.pathId, openedFrame?.frameId]),
    observedAt: Number(record.observedAt || 0) || nowMs(),
    expiresAt: Number(record.expiresAt || 0) || undefined,
    ...(blockedReasonForTransportObservation(record) ? { blockedReason: blockedReasonForTransportObservation(record) } : {}),
  };
  return assertMediaFulfillmentEvidence(evidence);
}

function reduceMediaTransportObservationRecord(observation, openedFrame = {}) {
  const evidence = fulfillmentEvidenceFromTransportObservation(observation, openedFrame);
  const posture = reduceMediaFulfillmentEvidence(evidence);
  recordRuntimeEvent('media.transport.observation', {
    level: posture.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED ? 'warn' : 'info',
    frameId: String(openedFrame?.frameId || '').trim(),
    correlationId: String(openedFrame?.correlationId || '').trim(),
    sessionId: posture.sessionId,
    activationId: posture.activationId,
    routePromiseId: String(observation.routePromiseId || '').trim(),
    participantRef: String(observation.participantRef || '').trim(),
    participantRole: String(observation.participantRole || '').trim(),
    observationState: String(observation.state || '').trim(),
    fulfillmentState: posture.state,
    visibleFrame: posture.visibleFrame,
    trackLive: posture.trackLive,
    transportUsable: posture.transportUsable,
  });
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return posture;
}

function handleMediaTransportObservationFrame(openedFrame) {
  const observation = mediaTransportObservationFromOpenedFrame(openedFrame);
  if (!observation) return false;
  reduceMediaTransportObservationRecord(observation, openedFrame);
  return true;
}

function findQueuedFrameForStreamLifecycle(frame, record) {
  const constraints = record?.constraints && typeof record.constraints === 'object' ? record.constraints : {};
  const recordRef = frame?.recordRef || frame?.record_ref || {};
  const candidates = [
    frame?.correlationId,
    frame?.correlation_id,
    frame?.frameId,
    frame?.frame_id,
    record?.activationId,
    record?.activation_id,
    record?.routePromiseId,
    record?.route_promise_id,
    constraints.routePromiseId,
    constraints.route_promise_id,
    record?.sessionId,
    record?.session_id,
    recordRef.id,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    const entry = findQueuedFrame(candidate);
    if (entry) return entry;
  }
  for (const entry of outboundSwarmFrames.values()) {
    const ids = queueCorrelationIds(entry);
    if (candidates.some((candidate) => ids.includes(candidate))) return entry;
  }
  return null;
}

function handleStreamSessionLifecycleFrame(openedFrame) {
  const lifecycle = streamLifecycleRecordFromOpenedFrame(openedFrame);
  if (!lifecycle) return false;
  const { recordKind, record } = lifecycle;
  const phase = lifecycle.phase || streamSessionLifecyclePhase(recordKind);
  const entry = findQueuedFrameForStreamLifecycle(openedFrame, record);
  if (!entry) {
    recordRuntimeEvent('stream.lifecycle.unbound', {
      frameId: String(openedFrame?.frameId || '').trim(),
      correlationId: String(openedFrame?.correlationId || '').trim(),
      recordKind,
      sessionId: String(record?.sessionId || record?.session_id || '').trim(),
    });
    return false;
  }
  if (queuedSwarmFrameTerminal(entry)) {
    recordRuntimeEvent('stream.lifecycle.ignored', {
      frameId: entry.frameId,
      recordKind,
      ignoredReason: 'terminalActivation',
      currentStatus: String(entry.status || '').trim(),
    });
    return true;
  }
  const observedAt = nowMs();
  if (phase === STREAM_SESSION_LIFECYCLE_PHASE.ADMISSION) {
    clearServiceAdmissionTimeout(entry);
    entry.status = 'serviceAccepted';
    entry.serviceAccepted = true;
    entry.serviceAcceptedAt = observedAt;
    entry.serviceAdmission = safeClone(record);
    entry.lastError = undefined;
    recordRuntimeEvent('service.accepted', {
      frameId: entry.frameId,
      correlationId: String(openedFrame?.correlationId || '').trim(),
      activationId: String(entry.activationId || '').trim(),
      routePromiseId: String(entry.routePromiseId || record?.constraints?.routePromiseId || '').trim(),
      sessionId: String(record?.sessionId || '').trim(),
      admittedBy: String(record?.admittedBy || '').trim(),
    });
  } else if (phase === STREAM_SESSION_LIFECYCLE_PHASE.REJECT) {
    clearServiceAdmissionTimeout(entry);
    entry.status = 'serviceRejected';
    entry.serviceRejected = true;
    entry.rejectedAt = observedAt;
    entry.serviceReject = safeClone(record);
    entry.lastError = {
      reason: String(record?.reasonCode || record?.reason || 'serviceRejected').trim(),
      recordKind,
    };
    recordRuntimeEvent('service.rejected', {
      frameId: entry.frameId,
      correlationId: String(openedFrame?.correlationId || '').trim(),
      activationId: String(entry.activationId || '').trim(),
      routePromiseId: String(entry.routePromiseId || record?.constraints?.routePromiseId || '').trim(),
      sessionId: String(record?.sessionId || '').trim(),
      rejectedBy: String(record?.rejectedBy || '').trim(),
      reasonCode: String(record?.reasonCode || record?.reason || 'serviceRejected').trim(),
    });
  } else if (phase === STREAM_SESSION_LIFECYCLE_PHASE.ANSWER) {
    clearServiceAdmissionTimeout(entry);
    entry.serviceAccepted = true;
    if (!entry.serviceAcceptedAt) entry.serviceAcceptedAt = observedAt;
    entry.serviceAnswer = safeClone(record);
    entry.serviceAnswerAt = observedAt;
    if (entry.status !== 'serviceAccepted') entry.status = 'serviceAccepted';
    recordRuntimeEvent('service.response.materialized', {
      frameId: entry.frameId,
      correlationId: String(openedFrame?.correlationId || '').trim(),
      activationId: String(entry.activationId || '').trim(),
      routePromiseId: String(entry.routePromiseId || '').trim(),
      recordKind,
      sessionId: String(record?.sessionId || '').trim(),
    });
  }
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return true;
}

function projectionSnapshotFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  const direct = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null;
  if (direct && String(direct.projectionId || '').trim()) return direct;
  if (frame?.kind === SWARM.FRAME_KIND.PROJECTION_SNAPSHOT && payload && String(payload.projectionId || '').trim()) return payload;
  return null;
}

function projectionDeltaFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  const direct = payload.delta && typeof payload.delta === 'object' ? payload.delta : null;
  if (direct && String(direct.projectionId || '').trim()) return direct;
  if (frame?.kind === SWARM.FRAME_KIND.PROJECTION_DELTA && payload && String(payload.projectionId || '').trim()) return payload;
  return null;
}

function runtimeProjectionResponseFromOpenedFrame(frame) {
  const payload = frame?.body?.payload && typeof frame.body.payload === 'object' ? frame.body.payload : {};
  if (!payload || typeof payload !== 'object') return null;
  const result = payload.result && typeof payload.result === 'object' ? payload.result : null;
  const projection = result?.projection || payload.projection || null;
  if (!projection || typeof projection !== 'object') return null;
  return {
    requestId: String(payload.requestId || payload.request_id || frame.correlationId || frame.frameId || '').trim(),
    ok: payload.ok !== false,
    result: { projection },
  };
}

function handleProjectionInboxFrame(openedFrame) {
  const snapshot = projectionSnapshotFromOpenedFrame(openedFrame);
  if (snapshot) {
    try {
      const result = handleProjectionSnapshotApply({ snapshot });
      recordRuntimeEvent('projection.inbox.applied', {
        frameId: openedFrame.frameId,
        kind: 'snapshot',
        projectionId: String(snapshot.projectionId || '').trim(),
        policyId: String(snapshot.policyId || '').trim(),
      });
      scheduleDiagnosticLoggingFlush(10);
      return { handled: true, result };
    } catch (error) {
      recordRuntimeEvent('projection.inbox.ignored', {
        frameId: openedFrame.frameId,
        kind: 'snapshot',
        projectionId: String(snapshot.projectionId || '').trim(),
        error: String(error?.message || error || 'invalid projection snapshot'),
      });
      return { handled: true, result: { ok: false, error: String(error?.message || error || 'invalid projection snapshot') } };
    }
  }
  const delta = projectionDeltaFromOpenedFrame(openedFrame);
  if (delta) {
    try {
      const result = handleProjectionDeltaApply({ delta });
      recordRuntimeEvent('projection.inbox.applied', {
        frameId: openedFrame.frameId,
        kind: 'delta',
        projectionId: String(delta.projectionId || '').trim(),
        policyId: String(delta.policyId || '').trim(),
      });
      scheduleDiagnosticLoggingFlush(10);
      return { handled: true, result };
    } catch (error) {
      recordRuntimeEvent('projection.inbox.ignored', {
        frameId: openedFrame.frameId,
        kind: 'delta',
        projectionId: String(delta.projectionId || '').trim(),
        error: String(error?.message || error || 'invalid projection delta'),
      });
      return { handled: true, result: { ok: false, error: String(error?.message || error || 'invalid projection delta') } };
    }
  }
  const response = runtimeProjectionResponseFromOpenedFrame(openedFrame);
  if (response) {
    const result = handleRuntimeProjectionSyncResponse(response);
    recordRuntimeEvent('projection.inbox.response', {
      frameId: openedFrame.frameId,
      requestId: response.requestId,
      handled: Boolean(result),
      ok: result?.ok !== false,
    });
    return { handled: true, result: result || { ok: false, error: 'projection response had no pending observer' } };
  }
  return { handled: false };
}

function isPlaceholderRuntimeMemberRef(value) {
  const text = String(value || '').trim();
  return !text || text === 'browser-runtime' || text === 'account-runtime';
}

function resolvedRuntimeAuthorityMemberRef() {
  return resolvedMemberPkFromCandidates(
    runtimeAuthorityPostureState?.devicePk,
    runtimeAuthorityDevice?.nostr?.pk,
    runtimeAuthorityDevice?.pk,
    runtimeAuthorityDevice?.devicePk,
  );
}

function isMissingImplicitEdgeMemberRef(source) {
  return !String(source?.memberRef || '').trim();
}

function edgeAttachWaitingAuthorityMessage() {
  const state = String(runtimeAuthorityPostureState?.state || 'waitingAuthority').trim() || 'waitingAuthority';
  const reason = String(runtimeAuthorityPostureState?.reason || 'runtime authority memberRef is not ready').trim();
  return `runtime authority ${state}: missingRuntimeAuthorityMemberRef${reason ? ` (${reason})` : ''}`;
}

function resolvedEdgeMemberRefFromMessage(source) {
  const memberRef = String(source?.memberRef || '').trim();
  if (!memberRef) {
    const authorityRef = resolvedRuntimeAuthorityMemberRef();
    if (authorityRef) return authorityRef;
  }
  const resolved = resolvedMemberPkFromRef(memberRef);
  if (!resolved || isPlaceholderRuntimeMemberRef(memberRef)) {
    throw new Error('resolved swarm edge memberRef is required');
  }
  return resolved;
}

async function edgeHelloFromMessage(message) {
  const source = message?.payload && typeof message.payload === 'object' ? message.payload : message;
  const memberRef = resolvedEdgeMemberRefFromMessage(source);
  const zoneScope = appIntentZoneScope(source);
  const lastProjectionRevisions = {};
  for (const [projectionId, projection] of retainedProjections.entries()) {
    lastProjectionRevisions[projectionId] = Number(projection?.revision || 0);
  }
  return {
    memberKind: 'browser-runtime',
    memberRef,
    zoneScope,
    supportedVersions: [SWARM.FRAME_VERSION],
    lastAckedFrameId: String(source.lastAckedFrameId || '').trim() || undefined,
    lastProjectionRevisions,
    capabilityRefs: uniqueTrimmedStrings([
      ...RUNTIME_SWARM_RECEIVE_CAPABILITY_REFS,
      ...normalizeArray(source.capabilityRefs),
    ]),
    channelRefs: uniqueTrimmedStrings([
      ...RUNTIME_SWARM_RECEIVE_CHANNEL_REFS,
      ...normalizeArray(source.channelRefs),
    ]),
    promiseRefs: uniqueTrimmedStrings(normalizeArray(source.promiseRefs)),
    nonce: String(source.nonce || '').trim() || randomOpaqueId('edge-nonce'),
    issuedAt: Number(source.issuedAt || 0) || nowMs(),
    sealedClaims: source.sealedClaims && typeof source.sealedClaims === 'object'
      ? safeClone(source.sealedClaims)
      : {
          encoding: SWARM.BODY_ENCODING.CAAC,
          envelope: {
            envelopeId: randomOpaqueId('caac-edge'),
            memberRef,
          },
        },
  };
}

function runtimeReplayCache() {
  return {
    has(id) {
      return inboundEnvelopeReplayIds.has(String(id || ''));
    },
    add(id) {
      inboundEnvelopeReplayIds.add(String(id || ''));
    },
  };
}

async function openRuntimeFrameBody(frame) {
  if (frame?.body?.encoding !== SWARM.BODY_ENCODING.CAAC || !frame?.body?.envelope) {
    return frame;
  }
  const authority = await runtimeDeviceAuthority();
  const opened = openEnvelope(frame.body.envelope, authority.secretKey, {
    now: nowMs(),
    replayCache: runtimeReplayCache(),
  });
  return {
    ...frame,
    body: {
      ...frame.body,
      envelope: {
        envelopeId: String(frame.body.envelope.envelopeId || '').trim(),
        kind: String(frame.body.envelope.kind || '').trim(),
        issuerPk: String(frame.body.envelope.issuerPk || '').trim(),
        opened: true,
      },
      payload: opened,
    },
  };
}

async function handleEdgeWireFrame(frame, wireMessage = {}) {
  if (!frame || typeof frame !== 'object') return;
  if (frame.kind === SWARM.FRAME_KIND.ACK) {
    for (const observation of normalizeArray(wireMessage.routeObservations || wireMessage.route_observations)) {
      if (observation && typeof observation === 'object') recordRouteObservation(observation);
    }
    handleSwarmEdgeAck({
      frame,
      correlationId: frame.correlationId || frame?.ack?.ackedFrameId || '',
      propagation: wireMessage.propagation,
      bridge: wireMessage.bridge,
    });
    return;
  }
  if (frame.kind === SWARM.FRAME_KIND.REJECT) {
    for (const observation of normalizeArray(wireMessage.routeObservations || wireMessage.route_observations)) {
      if (observation && typeof observation === 'object') recordRouteObservation(observation);
    }
    handleSwarmEdgeReject({
      frame,
      correlationId: frame.correlationId || frame?.ack?.ackedFrameId || '',
      bridge: wireMessage.bridge,
      routeObservations: wireMessage.routeObservations || wireMessage.route_observations,
    });
    return;
  }
  const unsealedPayload = frame?.body?.payload || null;
  if (
    unsealedPayload
    && String(frame?.recordRef?.kind || frame?.record_ref?.kind || '').trim() === 'route.observation'
  ) {
    const routeObservation = routeObservationFromOpenedFrame(frame);
    if (routeObservation) {
      recordRouteObservation(routeObservation);
      return;
    }
  }
  let openedFrame = frame;
  try {
    openedFrame = await openRuntimeFrameBody(frame);
  } catch (error) {
    broadcast({
      type: 'swarm.edge.reject',
      rejection: {
        correlationId: String(frame?.correlationId || frame?.frameId || '').trim(),
        error: {
          code: 'caacOpenFailed',
          message: String(error?.message || error || 'failed to open CAAC frame'),
          retryable: false,
        },
      },
    });
    return;
  }
  const payload = openedFrame?.body?.payload || openedFrame?.body?.envelope?.payload || null;
  const routeObservation = routeObservationFromOpenedFrame(openedFrame);
  if (routeObservation) {
    recordRouteObservation(routeObservation);
    return;
  }
  if (handleContributionLifecycleFrame(openedFrame)) {
    return;
  }
  handleStreamSessionLifecycleFrame(openedFrame);
  if (handleMediaTransportObservationFrame(openedFrame)) {
    return;
  }
  const projectionInbox = handleProjectionInboxFrame(openedFrame);
  if (projectionInbox.handled) {
    return;
  }
  broadcast({ type: 'swarm.edge.frame', frame: safeClone(openedFrame) });
}

async function handleEdgeWireMessage(raw) {
  let message = raw;
  if (typeof raw === 'string') {
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
  }
  const type = String(message?.type || '').trim();
  if (type === 'swarm.edge.accept') {
    swarmEdge.sessionId = String(message?.accept?.sessionId || message?.sessionId || '').trim();
    swarmEdge.connected = true;
    clearRuntimeControlPlaneBusy();
    const acceptedZoneScope = normalizeServiceZoneScope(message?.accept?.zoneScope || message?.accept?.zone_scope || message?.zoneScope || message?.zone_scope);
    if (acceptedZoneScope) swarmEdge.zoneScope = acceptedZoneScope;
    recordRuntimeEvent('adapter.edge.accepted', {
      sessionId: swarmEdge.sessionId,
      zoneScope: swarmEdge.zoneScope,
    });
    touchRuntime();
    broadcast({ type: 'swarm.edge.accept', edge: edgeSnapshot() });
    sendQueuedSwarmFrames();
    requestRuntimeDirectoryObserve('edge.accept');
    void flushPendingRouteIntents('edge.accept');
    scheduleDiagnosticLoggingFlush(10);
    broadcastSnapshot();
    return;
  }
  if (type === 'swarm.frame') {
    await handleEdgeWireFrame(message.frame, message);
    return;
  }
  if (type === 'swarm.edge.reject') {
    const handled = handleSwarmEdgeReject(message);
    if (!handled?.ok) {
      const rejection = {
        frameId: String(message.frameId || '').trim(),
        correlationId: String(message.correlationId || '').trim(),
        error: structuredRejectError(message),
        preserved: false,
        rejectedAt: nowMs(),
      };
      swarmEdge.rejections.push(rejection);
      recordRuntimeEvent('frame.reject', {
        frameId: rejection.frameId,
        correlationId: rejection.correlationId,
        error: rejection.error,
        preserved: false,
      });
      touchRuntime();
      schedulePersist();
      broadcast({ type: 'swarm.edge.reject', rejection: safeClone(rejection) });
      broadcastSnapshot();
    }
    return;
  }
  if (type === 'swarm.edge.close') {
    swarmEdge.connected = false;
    swarmEdge.sessionId = '';
    recordRuntimeEvent('adapter.edge.closed', {
      reasonCode: String(message?.reasonCode || '').trim(),
    });
    touchRuntime();
    broadcast({ type: 'swarm.edge.close', reasonCode: String(message?.reasonCode || '').trim() });
    broadcastSnapshot();
  }
}

function closeSwarmEdgeSocket() {
  const socket = swarmEdge.socket;
  swarmEdge.socket = null;
  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close?.();
    } catch {}
  }
}

function sameEdgeZoneScope(left, right) {
  return String(left?.zoneId || '').trim() === String(right?.zoneId || '').trim()
    && String(left?.privacy || '').trim() === String(right?.privacy || '').trim()
    && Number(left?.ttl || 0) === Number(right?.ttl || 0)
    && Number(left?.maxHops || 0) === Number(right?.maxHops || 0);
}

function edgeEndpointDiagnosticFacts(endpoint) {
  try {
    const parsed = new URL(String(endpoint || ''));
    return {
      endpointScheme: parsed.protocol.replace(/:$/, ''),
      endpointHost: parsed.hostname,
      endpointPort: parsed.port || (parsed.protocol === 'wss:' ? '443' : parsed.protocol === 'ws:' ? '80' : ''),
    };
  } catch {
    return {};
  }
}

async function attachLiveSwarmEdge(message) {
  const source = message?.payload && typeof message.payload === 'object' ? message.payload : message;
  const socketEndpoint = String(source.swarmEdgeEndpoint || source.edgeEndpoint || source.endpoint || '').trim();
  if (!socketEndpoint) {
    recordRuntimeEvent('adapter.edge.attach.failed', { error: { message: 'missing swarm edge endpoint' }, level: 'error' });
    return { ok: false, error: 'missing swarm edge endpoint' };
  }
  if (typeof WebSocket !== 'function') {
    recordRuntimeEvent('adapter.edge.attach.failed', { error: { message: 'WebSocket unavailable in runtime worker' }, level: 'error' });
    return { ok: false, error: 'WebSocket unavailable in runtime worker' };
  }
  markRuntimeControlPlaneBusy(15_000);
  if (isMissingImplicitEdgeMemberRef(source)) {
    await runtimeAuthorityPosture().catch(() => null);
  }
  let memberRef = '';
  try {
    memberRef = resolvedEdgeMemberRefFromMessage(source);
  } catch (error) {
    const waitingAuthority = isMissingImplicitEdgeMemberRef(source);
    const message = waitingAuthority
      ? edgeAttachWaitingAuthorityMessage()
      : String(error?.message || error || 'resolved swarm edge memberRef is required');
    if (waitingAuthority) {
      const requestedZoneScope = appIntentZoneScope(source);
      closeSwarmEdgeSocket();
      swarmEdge.mode = 'pendingAuthority';
      swarmEdge.connected = false;
      swarmEdge.endpoint = socketEndpoint;
      swarmEdge.sessionId = '';
      swarmEdge.memberRef = '';
      swarmEdge.zoneScope = safeClone(requestedZoneScope);
      recordRuntimeEvent('adapter.edge.attach.blocked', {
        level: 'info',
        state: String(runtimeAuthorityPostureState?.state || 'waitingAuthority').trim() || 'waitingAuthority',
        blockedReason: 'missingRuntimeAuthorityMemberRef',
        retryable: true,
        error: { message },
        ...edgeEndpointDiagnosticFacts(socketEndpoint),
        zoneScope: requestedZoneScope,
      });
      touchRuntime();
      broadcastSnapshot();
      return {
        ok: false,
        error: message,
        state: 'waitingAuthority',
        blockedReason: 'missingRuntimeAuthorityMemberRef',
        retryable: true,
        result: edgeSnapshot(),
      };
    }
    recordRuntimeEvent('adapter.edge.attach.failed', {
      error: { message },
      level: 'error',
    });
    return { ok: false, error: message };
  }
  const requestedZoneScope = appIntentZoneScope(source);
  const attachTarget = `${socketEndpoint}|${memberRef}|${stableJson(requestedZoneScope)}`;
  if (liveSwarmEdgeAttachInFlight && liveSwarmEdgeAttachInFlightTarget === attachTarget) {
    return await liveSwarmEdgeAttachInFlight;
  }
  liveSwarmEdgeAttachInFlightTarget = attachTarget;
  liveSwarmEdgeAttachInFlight = attachLiveSwarmEdgeResolved(source, {
    socketEndpoint,
    memberRef,
    zoneScope: requestedZoneScope,
  });
  try {
    return await liveSwarmEdgeAttachInFlight;
  } finally {
    if (liveSwarmEdgeAttachInFlightTarget === attachTarget) {
      liveSwarmEdgeAttachInFlightTarget = '';
      liveSwarmEdgeAttachInFlight = null;
    }
  }
}

async function attachLiveSwarmEdgeResolved(source, resolved) {
  const socketEndpoint = resolved.socketEndpoint;
  const hello = await edgeHelloFromMessage({
    ...source,
    memberRef: resolved.memberRef,
    zoneScope: resolved.zoneScope,
  });
  const existingSocket = swarmEdge.socket;
  if (
    existingSocket
    && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)
    && swarmEdge.endpoint === socketEndpoint
    && swarmEdge.memberRef === hello.memberRef
    && sameEdgeZoneScope(swarmEdge.zoneScope, hello.zoneScope)
  ) {
    return { ok: true, result: edgeSnapshot() };
  }
  closeSwarmEdgeSocket();
  swarmEdge.mode = 'live';
  swarmEdge.endpoint = socketEndpoint;
  swarmEdge.connected = false;
  swarmEdge.sessionId = '';
  swarmEdge.memberRef = hello.memberRef;
  swarmEdge.zoneScope = safeClone(hello.zoneScope);
  const socket = new WebSocket(socketEndpoint);
  swarmEdge.socket = socket;
  socket.onopen = () => {
    postLiveEdgeRecord({ type: 'swarm.edge.hello', hello });
  };
  socket.onmessage = (event) => {
    void handleEdgeWireMessage(event?.data);
  };
  socket.onerror = () => {
    swarmEdge.connected = false;
    markRuntimeControlPlaneBusy(3000);
    recordRuntimeEvent('adapter.edge.error', {
      level: 'warn',
      message: 'edge websocket unavailable',
      ...edgeEndpointDiagnosticFacts(socketEndpoint),
      memberRef: hello.memberRef,
      zoneScope: swarmEdge.zoneScope,
    });
    broadcast({ type: 'swarm.edge.error', edge: edgeSnapshot() });
    broadcastSnapshot();
  };
  socket.onclose = (event) => {
    swarmEdge.connected = false;
    markRuntimeControlPlaneBusy(3000);
    swarmEdge.sessionId = '';
    swarmEdge.zoneScope = null;
    swarmEdge.memberRef = '';
    if (swarmEdge.socket === socket) swarmEdge.socket = null;
    recordRuntimeEvent('adapter.edge.closed', {
      ...edgeEndpointDiagnosticFacts(socketEndpoint),
      memberRef: hello.memberRef,
      closeCode: Number(event?.code || 0) || 0,
      closeReason: String(event?.reason || '').trim(),
      wasClean: event?.wasClean === true,
      zoneScope: hello.zoneScope,
    });
    broadcast({ type: 'swarm.edge.closed', edge: edgeSnapshot() });
    broadcastSnapshot();
  };
  touchRuntime();
  recordRuntimeEvent('adapter.edge.attach', {
    ...edgeEndpointDiagnosticFacts(socketEndpoint),
    zoneScope: hello.zoneScope,
    memberRef: hello.memberRef,
  });
  broadcastSnapshot();
  return { ok: true, result: edgeSnapshot() };
}

function queueSwarmFrame(message) {
  const frame = swarmFrameFromMessage(message);
  const existing = outboundSwarmFrames.get(frame.frameId);
  const entry = existing || {
    frameId: frame.frameId,
    frame,
    status: 'queued',
    queuedAt: nowMs(),
    attempts: 0,
    retryPolicy: normalizeSwarmRetryPolicy(message.retryPolicy || message?.payload?.retryPolicy),
  };
  if (existing) {
    entry.frame = frame;
    entry.retryPolicy = normalizeSwarmRetryPolicy(message.retryPolicy || message?.payload?.retryPolicy || existing.retryPolicy);
  }
  if (message.activationId) entry.activationId = String(message.activationId || '').trim();
  if (message.interactionId) entry.interactionId = String(message.interactionId || '').trim();
  if (message.routePromiseId) entry.routePromiseId = String(message.routePromiseId || '').trim();
  if (message.authoritySummary && typeof message.authoritySummary === 'object') {
    entry.authoritySummary = safeClone(message.authoritySummary);
  }
  if (message.routingScope && typeof message.routingScope === 'object') {
    entry.routingScope = safeClone(message.routingScope);
  } else if (entry.authoritySummary?.routingScope && typeof entry.authoritySummary.routingScope === 'object') {
    entry.routingScope = safeClone(entry.authoritySummary.routingScope);
  }
  if (message.interaction && typeof message.interaction === 'object') {
    entry.interaction = safeClone(message.interaction);
  }
  if (message.swarmActivation && typeof message.swarmActivation === 'object') {
    entry.swarmActivation = safeClone(message.swarmActivation);
  }
  outboundSwarmFrames.set(frame.frameId, entry);
  recordRuntimeEvent('frame.queued', {
    frameId: frame.frameId,
    kind: frame.kind,
    correlationId: frame.correlationId || '',
    channelId: frame.channelId || '',
    capability: frame.capability || '',
  });
  touchRuntime();
  schedulePersist();
  sendQueuedSwarmFrames();
  broadcastSnapshot();
  return { ok: true, result: safeClone(entry) };
}

function appIntentPayload(message) {
  const source = message?.payload && typeof message.payload === 'object'
    ? message.payload
    : message?.intent && typeof message.intent === 'object'
      ? message.intent
      : {};
  return safeClone(source);
}

function appIntentFrameKind(method, intent) {
  const explicit = String(intent?.frameKind || intent?.kind || '').trim();
  if (explicit && Object.values(SWARM.FRAME_KIND).includes(explicit)) return explicit;
  switch (method) {
    case RUNTIME_APP_INTENT.DIAGNOSTIC_LOG:
      return SWARM.FRAME_KIND.RECORD_PUBLISH;
    case RUNTIME_APP_INTENT.CHANNEL_RESOLVE:
    case RUNTIME_APP_INTENT.PROJECTION_OBSERVE:
      return SWARM.FRAME_KIND.CHANNEL_OBSERVE;
    case RUNTIME_APP_INTENT.STREAM_OPEN:
      return SWARM.FRAME_KIND.STREAM_INTENT;
    case RUNTIME_APP_INTENT.STREAM_CONTROL:
    case RUNTIME_APP_INTENT.STREAM_CLOSE:
      return SWARM.FRAME_KIND.STREAM_CONTROL;
    case RUNTIME_APP_INTENT.STORAGE_PIN:
      return SWARM.FRAME_KIND.STORAGE_PIN_INTENT;
    case RUNTIME_APP_INTENT.CAPABILITY_RESOLVE:
    default:
      return SWARM.FRAME_KIND.SERVICE_INTENT;
  }
}

function appIntentCapability(method, intent) {
  const explicit = String(intent?.capabilityRef || intent?.capability || '').trim();
  if (explicit) return explicit;
  switch (method) {
    case RUNTIME_APP_INTENT.DIAGNOSTIC_LOG:
      return 'logging.events.ingest';
    case RUNTIME_APP_INTENT.PROJECTION_OBSERVE:
      return SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE;
    case RUNTIME_APP_INTENT.STREAM_OPEN:
      return SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER;
    case RUNTIME_APP_INTENT.STREAM_CONTROL:
    case RUNTIME_APP_INTENT.STREAM_CLOSE:
      return SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL;
    case RUNTIME_APP_INTENT.STORAGE_PIN:
      return SWARM.CORE_CAPABILITY.STORAGE_PIN;
    case RUNTIME_APP_INTENT.CHANNEL_RESOLVE:
    case RUNTIME_APP_INTENT.CAPABILITY_RESOLVE:
    default:
      return method;
  }
}

function isRuntimeStreamIntent(method) {
  return method === RUNTIME_APP_INTENT.STREAM_OPEN
    || method === RUNTIME_APP_INTENT.STREAM_CONTROL
    || method === RUNTIME_APP_INTENT.STREAM_CLOSE;
}

function streamServiceContractBaseline(method, intent, derived = null) {
  if (!isRuntimeStreamIntent(method)) return null;
  const service = String(
    intent?.service
      || derived?.service
      || (isRuntimeStreamIntent(method) ? NVR_SERVICE_ID : '')
      || '',
  ).trim().toLowerCase();
  if (service !== NVR_SERVICE_ID) return null;
  const capability = String(intent?.capabilityRef || intent?.capability || appIntentCapability(method, intent)).trim();
  const streamCapabilities = new Set([
    SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
    SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
    SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL,
  ]);
  if (capability && !streamCapabilities.has(capability)) return null;
  return {
    service: NVR_SERVICE_ID,
    nodeRef: NVR_STREAM_CHANNEL,
    channelId: NVR_STREAM_CHANNEL,
    capability: capability || SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
  };
}

function appIntentChannelId(method, intent) {
  const explicit = String(intent?.channelId || intent?.channel || intent?.projectionId || '').trim();
  if (explicit) return explicit;
  const selectedNodeChannel = String(
    intent?.selectedNode?.channelId
      || intent?.selectedNode?.channel
      || intent?.selectedNode?.backingChannel
      || '',
  ).trim();
  if (selectedNodeChannel) return selectedNodeChannel;
  const contractBaseline = streamServiceContractBaseline(method, intent);
  if (contractBaseline?.channelId) return contractBaseline.channelId;
  if (method === RUNTIME_APP_INTENT.DIAGNOSTIC_LOG) return 'logging.events';
  if (method === RUNTIME_APP_INTENT.STORAGE_PIN) return 'storage.pin';
  if (isRuntimeStreamIntent(method)) return '';
  return method;
}

function streamIntentNodeChannel(method, intent) {
  if (!isRuntimeStreamIntent(method)) return '';
  const contractBaseline = streamServiceContractBaseline(method, intent);
  if (contractBaseline?.channelId) return contractBaseline.channelId;
  const nodeRef = String(intent?.nodeRef || intent?.nodeId || '').trim();
  if (!nodeRef || nodeRef.includes('://')) return '';
  if (/^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i.test(nodeRef)) return nodeRef;
  return '';
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function appIntentZoneScope(intent, options = {}) {
  const requirePropagation = Boolean(options.requirePropagation);
  const source = intent?.zoneScope && typeof intent.zoneScope === 'object' ? intent.zoneScope : {};
  const fallback = swarmEdge.zoneScope && typeof swarmEdge.zoneScope === 'object' ? swarmEdge.zoneScope : {};
  const sourceZoneId = String(source.zoneId || intent?.zoneId || '').trim();
  const fallbackZoneId = String(fallback.zoneId || '').trim();
  const sourceIsLocalOnly = sourceZoneId.startsWith('identity:') || sourceZoneId === 'runtime.local' || sourceZoneId === 'local';
  const useFallback = sourceIsLocalOnly && fallbackZoneId;
  const scope = useFallback ? fallback : source;
  const ttl = scope.ttl || (!useFallback ? intent?.ttl : undefined) || fallback.ttl || (requirePropagation ? 30 : 1);
  const maxHops = scope.maxHops ?? (!useFallback ? intent?.maxHops : undefined) ?? fallback.maxHops ?? (requirePropagation ? 2 : 0);
  return {
    zoneId: String(scope.zoneId || (useFallback ? '' : intent?.zoneId) || fallback.zoneId || 'local').trim() || 'local',
    privacy: String(scope.privacy || fallback.privacy || '').trim() || undefined,
    ttl: requirePropagation ? positiveNumber(ttl, 30) : positiveNumber(ttl, 1),
    maxHops: requirePropagation ? positiveNumber(maxHops, 2) : nonNegativeNumber(maxHops, 0),
  };
}

function zoneScopeLooksLocalOnly(zoneScope) {
  const zoneId = String(zoneScope?.zoneId || '').trim();
  return !zoneId || zoneId === 'local' || zoneId === 'runtime.local' || zoneId.startsWith('identity:');
}

function runtimeRetainedDiscoveryScope() {
  const runtimeDiscovery = runtimeStatus.discovery && typeof runtimeStatus.discovery === 'object' ? runtimeStatus.discovery : {};
  const runtimeZones = runtimeStatus.zones && typeof runtimeStatus.zones === 'object' ? runtimeStatus.zones : {};
  const shell = runtimeStatus.shell && typeof runtimeStatus.shell === 'object' ? runtimeStatus.shell : {};
  const shellDiscovery = shell.discovery && typeof shell.discovery === 'object' ? shell.discovery : {};
  const zones = shell.zones && typeof shell.zones === 'object' ? shell.zones : {};
  return normalizeServiceZoneScope(runtimeDiscovery.scope || runtimeDiscovery.discoveryScope || runtimeDiscovery.discovery_scope)
    || normalizeServiceZoneScope(runtimeStatus.discoveryScope || runtimeStatus.discovery_scope)
    || normalizeServiceZoneScope({
      zoneId: runtimeZones.activeZoneKey || runtimeZones.active_zone_key,
      privacy: 'rawIds',
    })
    || firstServiceZoneScopeFromList(runtimeZones.joined)
    || firstServiceZoneScopeFromList(runtimeZones.zoneKeys || runtimeZones.zone_keys)
    || normalizeServiceZoneScope(shellDiscovery.scope || shellDiscovery.discoveryScope || shellDiscovery.discovery_scope)
    || normalizeServiceZoneScope(shell.discoveryScope || shell.discovery_scope)
    || normalizeServiceZoneScope({
      zoneId: zones.activeZoneKey || zones.active_zone_key,
      privacy: 'rawIds',
    })
    || firstServiceZoneScopeFromList(zones.joined)
    || firstServiceZoneScopeFromList(zones.zoneKeys || zones.zone_keys);
}

function routeChannelMatches(candidate, targetChannel) {
  const channelId = String(candidate?.channelId || candidate?.channel_id || '').trim();
  const channelRefs = normalizeArray(candidate?.channelRefs || candidate?.channel_refs)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return !targetChannel || channelId === targetChannel || channelRefs.includes(targetChannel);
}

function routeCapabilityMatches(candidate, targetCapability) {
  const capability = String(candidate?.capability || candidate?.capabilityRef || candidate?.capability_ref || '').trim();
  const capabilityRefs = normalizeArray(candidate?.capabilityRefs || candidate?.capability_refs)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return !targetCapability || capability === targetCapability || capabilityRefs.includes(targetCapability);
}

function routeServiceMatches(candidate, { servicePk = '', service = '', serviceRef = '' } = {}) {
  const targetServicePk = String(servicePk || '').trim();
  const targetService = String(service || '').trim().toLowerCase();
  const targetServiceRef = String(serviceRef || '').trim();
  const candidateServiceRef = String(candidate?.serviceRef || candidate?.service_ref || '').trim();
  const candidateServicePk = String(candidate?.servicePk || candidate?.service_pk || '').trim() || servicePkFromServiceRef(candidateServiceRef);
  const candidateService = String(candidate?.service || candidate?.service_id || '').trim().toLowerCase();
  const candidateChannel = String(candidate?.channelId || candidate?.channel_id || '').trim().toLowerCase();
  const channelImpliesService = Boolean(targetService && candidateChannel && (
    candidateChannel === targetService
    || candidateChannel.startsWith(`${targetService}.`)
  ));
  const candidateHasServiceIdentity = Boolean(candidateServicePk || candidateServiceRef || candidateService);
  if (targetServicePk && candidateHasServiceIdentity && candidateServicePk !== targetServicePk && !serviceRefMatches(candidateServiceRef, targetServicePk)) return false;
  if (targetServicePk && !candidateHasServiceIdentity && !channelImpliesService) return false;
  if (targetServiceRef && candidateHasServiceIdentity && candidateServiceRef && candidateServiceRef !== targetServiceRef && !serviceRefMatches(candidateServiceRef, targetServicePk)) return false;
  if (targetService && candidateService && candidateService !== targetService && !candidateServiceRef.toLowerCase().includes(targetService) && !channelImpliesService) return false;
  if (targetService && !candidateHasServiceIdentity && !channelImpliesService) return false;
  return true;
}

function directoryRoutingBaseline({ zoneScope, channelId = '', capability = '', servicePk = '', service = '', serviceRef = '' } = {}) {
  const zoneId = String(zoneScope?.zoneId || '').trim();
  if (!zoneId || zoneScopeLooksLocalOnly(zoneScope)) return null;
  const targetChannel = String(channelId || '').trim();
  const targetCapability = String(capability || '').trim();
  const targetServicePk = String(servicePk || '').trim();
  const targetService = String(service || '').trim().toLowerCase();
  const targetServiceRef = String(serviceRef || '').trim();
  const candidateServiceScore = (candidate) => {
    const candidateServiceRef = String(candidate?.serviceRef || candidate?.service_ref || '').trim();
    const candidateServicePk = String(candidate?.servicePk || candidate?.service_pk || '').trim() || servicePkFromServiceRef(candidateServiceRef);
    const candidateService = String(candidate?.service || candidate?.service_id || '').trim().toLowerCase();
    let score = 0;
    if (targetServicePk && (candidateServicePk === targetServicePk || serviceRefMatches(candidateServiceRef, targetServicePk))) score += 100;
    if (targetServiceRef && candidateServiceRef && (candidateServiceRef === targetServiceRef || serviceRefMatches(candidateServiceRef, targetServicePk))) score += 80;
    if (targetService && candidateService === targetService) score += 40;
    if (candidateServicePk || candidateServiceRef || candidateService) score += 10;
    return score;
  };
  let sawDirectory = false;
  let sawDiscoveryScope = false;
  let sawPreferredScope = false;
  let best = null;
  for (const [projectionKey, projection] of retainedProjections.entries()) {
    const projectionId = String(projection?.projectionId || '').trim();
    if (projectionId && projectionId !== RUNTIME_DIRECTORY_OBSERVE_CHANNEL) continue;
    const payload = projection?.payload && typeof projection.payload === 'object' ? projection.payload : {};
    const directory = payload.directory && typeof payload.directory === 'object'
      ? payload.directory
      : payload.state?.directory && typeof payload.state.directory === 'object'
        ? payload.state.directory
        : null;
    if (!directory) continue;
    sawDirectory = true;
    const updatedAt = Number(
      projection?.freshness?.updatedAt
        || projection?.updatedAt
        || projection?.issuedAt
        || projection?.revision
        || 0,
    ) || nowMs();
    const baselineRef = `projection:${projectionId || RUNTIME_DIRECTORY_OBSERVE_CHANNEL}:${projectionKey}`;
    const advertisements = normalizeArray(directory.advertisements);
    const candidates = normalizeArray(directory.entries).map((entry) => {
      const memberRef = resolvedMemberPkFromRef(entry?.memberRef || entry?.member_ref || '');
      if (!memberRef) return null;
      const advertisement = advertisements.find((ad) => {
        if (!ad || typeof ad !== 'object') return false;
        return resolvedMemberPkFromRef(ad.memberRef || ad.member_ref || '') === memberRef;
      }) || null;
      return { entry: { ...entry, memberRef }, advertisement };
    }).filter(Boolean);
    for (const { entry, advertisement } of candidates) {
      const entryZoneScope = normalizeServiceZoneScope(entry?.zoneScope || entry?.zone_scope || advertisement?.zoneScope || advertisement?.zone_scope);
      const entryZoneId = String(entryZoneScope?.zoneId || '').trim();
      if (entryZoneId) sawDiscoveryScope = true;
      const preferredScope = Boolean(entryZoneId && entryZoneId === zoneId);
      if (preferredScope) sawPreferredScope = true;
      const candidate = { ...safeClone(advertisement || {}), ...safeClone(entry || {}) };
      if (!routeChannelMatches(candidate, targetChannel)) continue;
      if (!routeCapabilityMatches(candidate, targetCapability)) continue;
      if (!routeServiceMatches(candidate, { servicePk: targetServicePk, service: targetService, serviceRef: targetServiceRef })) continue;
      const selectedZoneScope = entryZoneScope || zoneScope;
      const selected = {
        state: SWARM.ROUTING_SCOPE_STATE.READY,
        source: 'swarm.directory',
        baselineRef,
        selectedMemberRef: String(entry?.memberRef || '').trim(),
        serviceMemberRef: String(entry?.memberRef || '').trim(),
        zoneScope: selectedZoneScope,
        updatedAt,
        score: candidateServiceScore(candidate) + (preferredScope ? 30 : entryZoneId ? 5 : 0),
      };
      if (!best || selected.score > best.score) best = selected;
    }
  }
  if (best) {
    const { score, ...baseline } = best;
    return baseline;
  }
  if (!sawDirectory) return null;
  return {
    state: SWARM.ROUTING_SCOPE_STATE.SYNCING,
    source: sawPreferredScope
      ? 'swarm.directory.partial'
      : sawDiscoveryScope
        ? 'swarm.directory.pendingCoverage'
        : 'swarm.directory.pendingDiscovery',
    baselineRef: `projection:${RUNTIME_DIRECTORY_OBSERVE_CHANNEL}`,
    blockedReason: sawPreferredScope || sawDiscoveryScope
      ? SWARM.ROUTING_BLOCKED_REASON.NO_MEMBER_IN_ZONE
      : SWARM.ROUTING_BLOCKED_REASON.MISSING_ZONE_BASELINE,
    updatedAt: nowMs(),
  };
}

function appIntentRoutingScopeRequired(method, intent) {
  const explicitKind = String(intent?.routingScope?.kind || intent?.routingScopeKind || '').trim();
  if (explicitKind === SWARM.ROUTING_SCOPE_KIND.LOCAL) return false;
  if (explicitKind && explicitKind !== SWARM.ROUTING_SCOPE_KIND.LOCAL) return true;
  return isRuntimeStreamIntent(method)
    || method === RUNTIME_APP_INTENT.DIAGNOSTIC_LOG
    || method === RUNTIME_APP_INTENT.PROJECTION_OBSERVE
    || method === RUNTIME_APP_INTENT.STORAGE_PIN
    || Boolean(appIntentChannelId(method, intent));
}

function runtimeStreamRequiresLiveEdge(method, channelId) {
  return isRuntimeStreamIntent(method) && String(channelId || '').trim() === NVR_STREAM_CHANNEL;
}

function streamLiveEdgePosture() {
  return {
    edgeAccepted: swarmEdge.connected === true,
    edgeMode: String(swarmEdge.mode || '').trim(),
    edgeSessionId: String(swarmEdge.sessionId || '').trim(),
    edgeEndpoint: String(swarmEdge.endpoint || '').trim(),
    edgeMemberRef: String(swarmEdge.memberRef || '').trim(),
  };
}

function applyStreamEdgeActionability(method, channelId, routingScope) {
  const scope = routingScope && typeof routingScope === 'object' ? routingScope : {};
  if (!runtimeStreamRequiresLiveEdge(method, channelId)) return scope;
  const edge = streamLiveEdgePosture();
  if (edge.edgeAccepted) {
    return {
      ...scope,
      ...edge,
    };
  }
  const baseState = String(scope.state || '').trim();
  const blockedReason = SWARM.ROUTING_BLOCKED_REASON.EDGE_NOT_ACCEPTED || 'edgeNotAccepted';
  if (
    baseState === SWARM.ROUTING_SCOPE_STATE.READY
    || baseState === SWARM.ROUTING_SCOPE_STATE.NOT_REQUIRED
  ) {
    return {
      ...scope,
      ...edge,
      state: SWARM.ROUTING_SCOPE_STATE.SYNCING,
      source: 'edgeSession.pending',
      blockedReason,
      updatedAt: nowMs(),
    };
  }
  return {
    ...scope,
    ...edge,
    edgeBlockedReason: blockedReason,
  };
}

function appIntentRoutingScopePosture(method, intent, options = {}) {
  const channelId = String(options.channelId || appIntentChannelId(method, intent)).trim();
  if (intent?.routingScope && typeof intent.routingScope === 'object') {
    return applyStreamEdgeActionability(method, channelId, safeClone(intent.routingScope));
  }
  const required = options.required ?? appIntentRoutingScopeRequired(method, intent);
  const explicitKind = String(intent?.routingScopeKind || '').trim();
  const kind = explicitKind || (required ? SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE : SWARM.ROUTING_SCOPE_KIND.LOCAL);
  if (!required) {
    return {
      kind,
      required: false,
      state: SWARM.ROUTING_SCOPE_STATE.NOT_REQUIRED,
      source: 'runtime.local',
      updatedAt: nowMs(),
    };
  }
  if (kind !== SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE) {
    return {
      kind,
      required: true,
      state: SWARM.ROUTING_SCOPE_STATE.READY,
      source: 'explicitRoutingScope',
      updatedAt: nowMs(),
    };
  }
  const derived = deriveServiceContextForIntent(method, intent);
  const selectedNode = derived?.selectedNode && typeof derived.selectedNode === 'object' ? derived.selectedNode : null;
  const intentZoneScope = normalizeServiceZoneScope(intent?.zoneScope);
  const selectedNodeZoneScope = normalizeServiceZoneScope(selectedNode?.zoneScope || selectedNode?.zone_scope);
  const derivedZoneScope = normalizeServiceZoneScope(derived?.zoneScope || derived?.zone_scope);
  const edgeZoneScope = normalizeServiceZoneScope(swarmEdge.zoneScope);
  const retainedDiscoveryScope = runtimeRetainedDiscoveryScope();
  let zoneScope = intentZoneScope
    || selectedNodeZoneScope
    || derivedZoneScope
    || edgeZoneScope
    || retainedDiscoveryScope;
  const zoneScopeSource = intentZoneScope
    ? 'intent'
    : selectedNodeZoneScope || derivedZoneScope
      ? 'retainedServiceBaseline'
      : edgeZoneScope
        ? 'edgeSession'
        : retainedDiscoveryScope
          ? 'retainedDiscoveryBaseline'
          : 'runtime.route';
  const explicitZoneScopeSource = String(intent?.zoneScopeSource || intent?.zone_scope_source || '').trim();
  if (
    zoneScope
    && (zoneScopeLooksLocalOnly(zoneScope) || (isRuntimeStreamIntent(method) && Number(zoneScope.maxHops || 0) <= 0))
  ) {
    zoneScope = appIntentZoneScope({ ...intent, zoneScope }, { requirePropagation: true });
  }
  if (!zoneScope || zoneScopeLooksLocalOnly(zoneScope)) {
    return {
      kind,
      required: true,
      state: SWARM.ROUTING_SCOPE_STATE.MISSING,
      source: 'runtime.route',
      blockedReason: SWARM.ROUTING_BLOCKED_REASON.MISSING_ZONE_BASELINE,
      updatedAt: nowMs(),
    };
  }
  const capability = String(options.capability || appIntentCapability(method, intent)).trim();
  const servicePk = String(intent?.servicePk || derived?.servicePk || '').trim();
  const service = String(intent?.service || derived?.service || '').trim();
  const serviceRef = String(intent?.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const directoryBaseline = directoryRoutingBaseline({ zoneScope, channelId, capability, servicePk, service, serviceRef });
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef
    , intent?.routeMemberRef
    , intent?.memberRef
    , directoryBaseline?.serviceMemberRef
    , derived?.serviceMemberRef
    , derived?.routeMemberRef
    , derived?.liveEdgeRoute?.memberRef
    , servicePk
  );
  return applyStreamEdgeActionability(method, channelId, {
    kind,
    required: true,
    state: directoryBaseline?.state || SWARM.ROUTING_SCOPE_STATE.SYNCING,
    zoneScope: directoryBaseline?.zoneScope || zoneScope,
    source: directoryBaseline?.source || explicitZoneScopeSource || zoneScopeSource,
    baselineRef: directoryBaseline?.baselineRef || (servicePk ? `service:${servicePk}` : `discovery:${zoneScope.zoneId}`),
    ...(serviceMemberRef ? { serviceMemberRef, selectedMemberRef: serviceMemberRef } : {}),
    ...(directoryBaseline?.blockedReason ? { blockedReason: directoryBaseline.blockedReason } : {}),
    updatedAt: directoryBaseline?.updatedAt || nowMs(),
  });
}

function appIntentAudience(method, intent) {
  if (intent?.audience && typeof intent.audience === 'object') return safeClone(intent.audience);
  const derived = deriveServiceContextForIntent(method, intent);
  const service = String(intent?.service || derived?.service || '').trim();
  const servicePk = String(intent?.servicePk || intent?.recipientServicePk || derived?.servicePk || '').trim();
  const serviceRef = String(intent?.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef
    , intent?.routeMemberRef
    , intent?.memberRef
    , derived?.serviceMemberRef
    , derived?.routeMemberRef
    , derived?.liveEdgeRoute?.memberRef
    , servicePk
  );
  const gatewayRef = String(intent?.gatewayPk || intent?.gatewayRef || derived?.hostGatewayPk || '').trim();
  const capability = String(intent?.capabilityRef || intent?.capability || appIntentCapability(method, intent)).trim();
  const audienceRefs = uniqueTrimmedStrings([serviceMemberRef, servicePk, serviceRef, defaultServiceRefForPk(servicePk), defaultServiceRefForService(service, servicePk)]);
  if (servicePk || serviceRef || serviceMemberRef || gatewayRef || capability) {
    return {
      ...(serviceMemberRef ? { memberRef: serviceMemberRef, serviceMemberRef } : {}),
      ...(servicePk ? { servicePk } : {}),
      ...(serviceRef ? { serviceRef } : {}),
      ...(gatewayRef ? { gatewayRef } : {}),
      ...(capability ? { capability } : {}),
      ...(audienceRefs.length ? { audienceRefs } : {}),
    };
  }
  return undefined;
}

function defaultIdentityId() {
  return String(
    runtimeStatus.shell?.identity?.identityId
      || runtimeStatus.shell?.identityId
      || normalizeArray(managedState.sourceSnapshot?.identityDevices)[0]?.identityId
      || normalizeArray(managedState.sourceSnapshot?.identityDevices)[0]?.ownerIdentityId
      || '',
  ).trim();
}

function deriveServiceContextForIntent(method, intent) {
  const requestedService = String(intent?.service || intent?.serviceRef || '').trim().toLowerCase() || (
    isRuntimeStreamIntent(method)
      ? 'nvr'
      : ''
  );
  const requestedCapability = String(intent?.capabilityRef || intent?.capability || '').trim();
  const requestedNode = String(intent?.nodeRef || intent?.nodeId || '').trim().toLowerCase();
  const services = serviceCatalog().services;
  for (const service of services) {
    if (requestedService && String(service.service || '').trim().toLowerCase() !== requestedService) continue;
    if (!requestedCapability && !requestedNode) return service;
    const selectedNode = normalizeArray(service.nodes).find((node) => {
      const nodeIds = [
        node.path,
        node.nodeId,
        node.label,
      ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      const capabilities = normalizeArray(node.capabilities).map((value) => String(value || '').trim());
      return (!requestedNode || nodeIds.includes(requestedNode))
        && (!requestedCapability || capabilities.includes(requestedCapability));
    }) || (requestedCapability ? normalizeArray(service.nodes).find((node) => {
      const capabilities = normalizeArray(node.capabilities).map((value) => String(value || '').trim());
      return capabilities.includes(requestedCapability);
    }) : null);
    if (selectedNode) {
      return mergeLiveEdgeRouteDescriptor(
        { ...service, selectedNode: safeClone(selectedNode) },
        {
          capability: requestedCapability,
          channelId: String(selectedNode.channelId || selectedNode.channel || selectedNode.backingChannel || '').trim(),
        },
      );
    }
  }
  const fallback = services.find((service) => !requestedService || String(service.service || '').trim().toLowerCase() === requestedService) || null;
  if (!fallback) {
    const liveRoute = liveEdgeRouteForService({
      servicePk: String(intent?.servicePk || intent?.recipientServicePk || '').trim(),
      service: requestedService,
      capability: requestedCapability,
      channelId: streamIntentNodeChannel(method, intent),
    });
    if (!liveRoute) return null;
    return {
      service: requestedService || 'edge',
      servicePk: liveRoute.servicePk,
      serviceRef: liveRoute.serviceRef || defaultServiceRefForService(requestedService || 'edge', liveRoute.servicePk),
      serviceMemberRef: liveRoute.memberRef,
      routeMemberRef: liveRoute.memberRef,
      hostGatewayPk: '',
      zoneScope: liveRoute.zoneScope,
      location: null,
      aliases: [],
      surfaceChannel: '',
      summary: '',
      health: {},
      nodes: liveRoute.channelId ? [{
        path: requestedNode || liveRoute.channelId,
        nodeId: requestedNode || liveRoute.channelId,
        label: requestedNode || liveRoute.channelId,
        description: '',
        channelId: liveRoute.channelId,
        zoneScope: liveRoute.zoneScope,
        capabilities: [liveRoute.capability].filter(Boolean),
      }] : [],
      selectedNode: liveRoute.channelId ? {
        path: requestedNode || liveRoute.channelId,
        nodeId: requestedNode || liveRoute.channelId,
        label: requestedNode || liveRoute.channelId,
        description: '',
        channelId: liveRoute.channelId,
        zoneScope: liveRoute.zoneScope,
        capabilities: [liveRoute.capability].filter(Boolean),
      } : null,
      liveEdgeRoute: liveRoute,
    };
  }
  const contractBaseline = streamServiceContractBaseline(method, intent, fallback);
  const contractSelectedNode = contractBaseline
    ? {
        path: contractBaseline.nodeRef,
        nodeId: contractBaseline.nodeRef,
        label: contractBaseline.nodeRef,
        description: '',
        channelId: contractBaseline.channelId,
        zoneScope: fallback.zoneScope || null,
        capabilities: [contractBaseline.capability].filter(Boolean),
      }
    : null;
  return mergeLiveEdgeRouteDescriptor(
    contractSelectedNode
      ? {
          ...fallback,
          selectedNode: contractSelectedNode,
          nodes: normalizeArray(fallback.nodes).length ? fallback.nodes : [contractSelectedNode],
        }
      : fallback,
    {
      capability: requestedCapability || contractBaseline?.capability || '',
      channelId: contractBaseline?.channelId || '',
    },
  );
}

function appIntentActivationId(method, intent, requestId = '') {
  return String(
    intent?.activationId
      || intent?.intentId
      || intent?.sessionId
      || intent?.requestId
      || requestId
      || `${method}:${randomOpaqueId('activation')}`,
  ).trim();
}

function appIntentNodeRef(method, intent) {
  const contractBaseline = streamServiceContractBaseline(method, intent);
  if (contractBaseline?.nodeRef) return contractBaseline.nodeRef;
  const explicit = String(intent?.nodeRef || intent?.nodeId || '').trim();
  if (explicit) return explicit;
  const sourceIds = normalizeArray(intent?.sourceIds || intent?.sources || intent?.offer?.sourceIds || intent?.payload?.sourceIds)
    .concat(String(intent?.sourceId || intent?.payload?.sourceId || '').trim() ? [intent?.sourceId || intent?.payload?.sourceId] : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  if (sourceIds.length > 0) return sourceIds[0];
  if (method === RUNTIME_APP_INTENT.STREAM_OPEN || method === RUNTIME_APP_INTENT.STREAM_CONTROL || method === RUNTIME_APP_INTENT.STREAM_CLOSE) {
    return 'media.stream.preview';
  }
  if (method === RUNTIME_APP_INTENT.STORAGE_PIN) return 'storage.pin';
  if (method === RUNTIME_APP_INTENT.PROJECTION_OBSERVE) return String(intent?.projectionId || 'projection.observe').trim();
  return method;
}

function withoutActivationForbiddenFields(value) {
  if (!value || typeof value !== 'object') return value;
  const forbidden = new Set(SWARM.ACTIVATION_FORBIDDEN_FIELDS || []);
  if (Array.isArray(value)) return value.map((entry) => withoutActivationForbiddenFields(entry));
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key)) continue;
    out[key] = withoutActivationForbiddenFields(entry);
  }
  return out;
}

function appIntentActivationParams(method, intent) {
  const params = intent?.params && typeof intent.params === 'object'
    ? safeClone(intent.params)
    : intent?.payload && typeof intent.payload === 'object'
      ? safeClone(intent.payload)
      : {};
  const sourceIds = normalizeArray(intent?.sourceIds || intent?.sources || intent?.offer?.sourceIds || params.sourceIds)
    .concat(String(intent?.sourceId || params.sourceId || '').trim() ? [intent?.sourceId || params.sourceId] : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  if (sourceIds.length) params.sourceIds = Array.from(new Set(sourceIds));
  const transport = String(intent?.transport || params.transport || '').trim();
  if (transport) params.transport = transport;
  if (intent?.offer && typeof intent.offer === 'object') params.offer = safeClone(intent.offer);
  if (normalizeArray(intent?.candidates).length) params.candidates = safeClone(normalizeArray(intent.candidates));
  if (method === RUNTIME_APP_INTENT.STREAM_CLOSE) params.release = true;
  return withoutActivationForbiddenFields(params);
}

function appIntentActivationRecord(method, intent, authority, issuedAt, expiresAt, requestId) {
  const record = {
    kind: SWARM.RECORD_KIND.RUNTIME_ACTIVATION_REQUEST,
    activationId: appIntentActivationId(method, intent, requestId),
    nodeRef: appIntentNodeRef(method, intent),
    capabilityRef: appIntentCapability(method, intent),
    params: appIntentActivationParams(method, intent),
    requesterRef: String(intent?.requesterRef || authority.publicKey).trim(),
    timeoutMs: positiveNumber(intent?.timeoutMs || intent?.timeoutPreferenceMs, 90_000),
    issuedAt,
    expiresAt,
  };
  assertRuntimeActivationRequest(record);
  return record;
}

function appIntentResolvedRoute(method, intent) {
  const derived = deriveServiceContextForIntent(method, intent);
  const selectedNode = derived?.selectedNode && typeof derived.selectedNode === 'object' ? derived.selectedNode : null;
  const contractBaseline = streamServiceContractBaseline(method, intent, derived);
  const resolvedNodeRef = contractBaseline?.nodeRef || appIntentNodeRef(method, intent);
  const intentZoneScope = normalizeServiceZoneScope(intent?.zoneScope);
  const selectedNodeZoneScope = normalizeServiceZoneScope(selectedNode?.zoneScope || selectedNode?.zone_scope);
  const derivedZoneScope = normalizeServiceZoneScope(derived?.zoneScope || derived?.zone_scope);
  const edgeZoneScope = normalizeServiceZoneScope(swarmEdge.zoneScope);
  const retainedDiscoveryScope = runtimeRetainedDiscoveryScope();
  const zoneScope = intentZoneScope
    || selectedNodeZoneScope
    || derivedZoneScope
    || edgeZoneScope
    || retainedDiscoveryScope;
  const zoneScopeSource = intentZoneScope
    ? 'intent'
    : selectedNodeZoneScope || derivedZoneScope
      ? 'retainedServiceBaseline'
      : edgeZoneScope
        ? 'edgeSession'
        : retainedDiscoveryScope
          ? 'retainedDiscoveryBaseline'
          : '';
  const servicePk = String(intent?.servicePk || derived?.servicePk || '').trim();
  const service = String(intent?.service || derived?.service || 'nvr').trim();
  const serviceRef = String(intent?.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef
    , intent?.routeMemberRef
    , intent?.memberRef
    , derived?.serviceMemberRef
    , derived?.routeMemberRef
    , derived?.liveEdgeRoute?.memberRef
    , servicePk
  );
  return {
    ...intent,
    nodeRef: resolvedNodeRef,
    service,
    servicePk,
    serviceRef,
    ...(serviceMemberRef ? { serviceMemberRef, routeMemberRef: serviceMemberRef, memberRef: serviceMemberRef } : {}),
    gatewayPk: String(intent?.gatewayPk || derived?.hostGatewayPk || '').trim(),
    identityId: String(intent?.identityId || derived?.identityId || defaultIdentityId()).trim(),
    capability: appIntentCapability(method, intent),
    selectedNode,
    ...(zoneScope ? { zoneScope, zoneScopeSource } : {}),
    channelId: String(
      intent?.channelId
      || selectedNode?.channelId
      || selectedNode?.channel
      || selectedNode?.backingChannel
      || derived?.liveEdgeRoute?.channelId
      || contractBaseline?.channelId
      || streamIntentNodeChannel(method, intent)
      || '',
    ).trim(),
  };
}

function appIntentRecordRef(method, intent, activation = null) {
  if (intent?.recordRef && typeof intent.recordRef === 'object') return safeClone(intent.recordRef);
  if (method === RUNTIME_APP_INTENT.DIAGNOSTIC_LOG) {
    const eventId = String(intent?.payload?.record?.eventId || intent?.eventId || intent?.requestId || '').trim();
    if (eventId) {
      return {
        kind: 'logging.event',
        id: eventId,
        revision: 1,
      };
    }
  }
  const id = String(
    activation?.activationId
    || intent?.activationId
    || intent?.intentId
    || intent?.requestId
    || intent?.sessionId
    || intent?.projectionId
    || intent?.channelId
    || '',
  ).trim();
  if (!id) return undefined;
  return {
    kind: appIntentRecordKind(method, intent),
    id,
  };
}

function appIntentRecordKind(method, intent) {
  const explicit = String(intent?.recordKind || intent?.record_kind || '').trim();
  if (explicit) return explicit;
  if (method === RUNTIME_APP_INTENT.STREAM_OPEN) return 'stream.session.offer';
  if (method === RUNTIME_APP_INTENT.STREAM_CLOSE) return 'stream.session.close';
  if (method === RUNTIME_APP_INTENT.STREAM_CONTROL) {
    const payload = intent?.payload && typeof intent.payload === 'object' ? intent.payload : {};
    if (intent?.candidateId || payload.candidate || payload.candidateId) return 'stream.session.candidate';
    return 'stream.session.control';
  }
  return SWARM.RECORD_KIND.RUNTIME_ACTIVATION_REQUEST;
}

function appIntentSignalType(method, intent) {
  const explicit = String(intent?.signalType || intent?.signal_type || '').trim();
  if (explicit) return explicit;
  if (method === RUNTIME_APP_INTENT.STREAM_OPEN) return 'offer';
  if (method === RUNTIME_APP_INTENT.STREAM_CLOSE) return 'close';
  if (method === RUNTIME_APP_INTENT.STREAM_CONTROL) {
    const payload = intent?.payload && typeof intent.payload === 'object' ? intent.payload : {};
    if (intent?.candidateId || payload.candidate || payload.candidateId) return 'candidate';
    return 'control';
  }
  return 'intent';
}

function appIntentRoutePromise(method, intent, authority, issuedAt, expiresAt, activation) {
  if (
    method !== RUNTIME_APP_INTENT.STREAM_OPEN
    && method !== RUNTIME_APP_INTENT.STREAM_CONTROL
    && method !== RUNTIME_APP_INTENT.STREAM_CLOSE
  ) {
    return null;
  }
  const service = String(intent?.service || '').trim();
  const servicePk = String(intent?.servicePk || '').trim();
  const serviceRef = String(intent?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef,
    intent?.routeMemberRef,
    intent?.memberRef,
    servicePk,
  );
  const gatewayRef = String(intent?.gatewayPk || intent?.gatewayRef || '').trim();
  const identityRef = String(intent?.identityId || '').trim();
  const zoneScope = appIntentZoneScope(intent, { requirePropagation: true });
  const returnZoneScope = normalizeServiceZoneScope(swarmEdge.zoneScope);
  const audienceRefs = uniqueTrimmedStrings([
    serviceMemberRef,
    servicePk,
    defaultServiceRefForPk(servicePk),
    defaultServiceRefForService(service, servicePk),
  ]);
  const routePromise = {
    kind: SWARM.RECORD_KIND.ROUTE_PROMISE,
    promiseId: String(intent?.routePromiseId || `route:${activation.activationId}`).trim(),
    activationId: activation.activationId,
    nodeRef: activation.nodeRef,
    capabilityRef: activation.capabilityRef,
    requesterRef: activation.requesterRef || authority.publicKey,
    ...(serviceMemberRef ? { serviceMemberRef } : {}),
    servicePk,
    channelId: appIntentChannelId(method, intent),
    zoneScope,
    ...(returnZoneScope ? { returnZoneScope } : {}),
    audienceRefs,
    authorityRefs: [identityRef ? `identity:${identityRef}` : '', authority.publicKey].filter(Boolean),
    routePolicy: {
      delivery: 'targetMember',
      transport: String(intent?.transport || intent?.params?.transport || 'edge').trim() || 'edge',
    },
    pathRefs: [gatewayRef ? `gateway:${gatewayRef}` : '', serviceMemberRef].filter(Boolean),
    issuedAt,
    expiresAt,
    releasePolicy: {
      onClose: true,
      leaseMs: Math.max(1, expiresAt - issuedAt),
    },
  };
  assertRoutePromise(routePromise);
  return routePromise;
}

function appIntentAuthorityClaims(method, intent, authority, issuedAt, expiresAt, nonce) {
  const source = intent?.authority && typeof intent.authority === 'object' ? intent.authority : {};
  const grantedScope = intent?.grantedScope && typeof intent.grantedScope === 'object' ? intent.grantedScope : {};
  const intentSourceIds = normalizeArray(intent?.sourceIds || intent?.sources)
    .concat(String(intent?.sourceId || '').trim() ? [intent.sourceId] : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const derived = deriveServiceContextForIntent(method, intent);
  const service = String(intent?.service || source.service || derived?.service || 'nvr').trim();
  const servicePk = String(intent?.servicePk || source.servicePk || derived?.servicePk || '').trim();
  const gatewayPk = String(intent?.gatewayPk || source.gatewayPk || derived?.hostGatewayPk || '').trim();
  const identityId = String(intent?.identityId || source.identityId || derived?.identityId || defaultIdentityId()).trim();
  if (
    (method === RUNTIME_APP_INTENT.STREAM_OPEN || method === RUNTIME_APP_INTENT.STREAM_CONTROL || method === RUNTIME_APP_INTENT.STREAM_CLOSE)
    && (!servicePk || !gatewayPk || !identityId)
  ) {
    throw new Error('runtime could not resolve stream service, gateway, or identity authority');
  }
  return {
    capabilityId: String(intent?.capabilityId || intent?.intentId || intent?.requestId || nonce).trim(),
    gatewayPk,
    servicePk,
    service,
    identityId,
    devicePk: authority.publicKey,
    capability: appIntentCapability(method, intent),
    owner: Boolean(intent?.owner ?? source.owner ?? grantedScope.owner),
    viewSources: normalizeArray(intent?.viewSources || source.viewSources || grantedScope.viewSources || intentSourceIds).map((entry) => String(entry || '').trim()).filter(Boolean),
    controlSources: normalizeArray(intent?.controlSources || source.controlSources || grantedScope.controlSources || intentSourceIds).map((entry) => String(entry || '').trim()).filter(Boolean),
    issuedAt,
    expiresAt,
    nonce,
  };
}

function runtimeMemberRef(authority, intent = {}) {
  return resolvedMemberPkFromCandidates(
    intent?.runtimeMemberRef,
    intent?.coordinatorRef,
    swarmEdge.memberRef,
    authority?.publicKey,
  );
}

function swarmInteractionId(method, intent, activation) {
  return String(
    intent?.interactionId
      || intent?.swarmInteractionId
      || `interaction:${method}:${activation.activationId}`,
  ).trim();
}

function appIntentAuthoritySummary(method, intent, authority) {
  const derived = deriveServiceContextForIntent(method, intent);
  const identityId = String(intent?.identityId || derived?.identityId || defaultIdentityId()).trim();
  const service = String(intent?.service || derived?.service || '').trim();
  const servicePk = String(intent?.servicePk || derived?.servicePk || '').trim();
  const serviceRef = String(intent?.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef,
    intent?.routeMemberRef,
    intent?.memberRef,
    derived?.serviceMemberRef,
    derived?.routeMemberRef,
    derived?.liveEdgeRoute?.memberRef,
    servicePk,
  );
  const gatewayPk = String(intent?.gatewayPk || intent?.gatewayRef || derived?.hostGatewayPk || '').trim();
  const runtimeRef = runtimeMemberRef(authority, intent);
  const storageMemberRef = String(intent?.storageMemberRef || 'member:storage:indexeddb:runtime-cache').trim();
  const isStream = isRuntimeStreamIntent(method);
  const routingScope = appIntentRoutingScopePosture(method, intent);
  return {
    routingScope,
    requester: {
      domain: SWARM.AUTHORITY_DOMAIN.IDENTITY,
      state: identityId ? 'ready' : 'missingGrant',
      identityRef: identityId ? `identity:${identityId}` : '',
      grantRefs: identityId ? [`grant:identity:${identityId}:runtime-session`] : [],
    },
    runtime: {
      domain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
      state: runtimeRef ? 'delegated' : 'missingRuntimeMember',
      memberRef: runtimeRef,
      deviceRef: authority?.publicKey || '',
    },
    gateway: {
      domain: SWARM.AUTHORITY_DOMAIN.GATEWAY,
      state: gatewayPk ? 'waitingAdmission' : (isStream ? 'missingGatewayGrant' : 'notRequired'),
      gatewayRef: gatewayPk ? `gateway:${gatewayPk}` : '',
    },
    service: {
      domain: SWARM.AUTHORITY_DOMAIN.SERVICE,
      state: servicePk || serviceRef ? 'waitingAcceptance' : (isStream ? 'missingServiceGrant' : 'notRequired'),
      service,
      serviceRef,
      serviceMemberRef,
      servicePk,
    },
    storage: {
      domain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
      state: 'cacheOnly',
      memberRef: storageMemberRef,
      identityAuthority: false,
    },
    recovery: {
      root: 'deviceRoot',
      route: 'storageRoute',
      activeLeaseRestored: false,
    },
  };
}

function appIntentInteractionRecord(method, intent, authority, activation, routePromise, issuedAt) {
  const interactionId = swarmInteractionId(method, intent, activation);
  const runtimeRef = runtimeMemberRef(authority, intent);
  const derived = deriveServiceContextForIntent(method, intent);
  const gatewayPk = String(intent?.gatewayPk || intent?.gatewayRef || derived?.hostGatewayPk || '').trim();
  const service = String(intent?.service || derived?.service || '').trim();
  const servicePk = String(intent?.servicePk || derived?.servicePk || '').trim();
  const serviceRef = String(intent?.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    intent?.serviceMemberRef,
    intent?.routeMemberRef,
    intent?.memberRef,
    derived?.serviceMemberRef,
    derived?.routeMemberRef,
    derived?.liveEdgeRoute?.memberRef,
    servicePk,
  );
  const capabilityRef = appIntentCapability(method, intent);
  const channelId = appIntentChannelId(method, intent);
  const routingScope = appIntentRoutingScopePosture(method, intent, { channelId, capability: capabilityRef });
  const participants = [
    {
      role: SWARM.INTERACTION_ROLE.REQUESTER,
      memberRef: activation.requesterRef || runtimeRef,
      capabilityRefs: [capabilityRef],
      channelRefs: channelId ? [channelId] : [],
      authorityRefs: ['identity:runtime-session'].filter(Boolean),
      contractView: { view: 'runtimeIntent' },
      safeFacts: { requester: 'runtimeClient' },
    },
    {
      role: SWARM.INTERACTION_ROLE.COORDINATOR,
      memberRef: runtimeRef,
      capabilityRefs: [capabilityRef],
      channelRefs: channelId ? [channelId] : [],
      authorityRefs: ['runtime:session'].filter(Boolean),
      contractView: { view: 'preparedActivation' },
      safeFacts: { delegatedRuntimeMember: Boolean(runtimeRef) },
    },
    {
      role: SWARM.INTERACTION_ROLE.STORAGE,
      memberRef: runtimeRef,
      capabilityRefs: [SWARM.CORE_CAPABILITY.STORAGE_PIN],
      channelRefs: ['storage.pin'],
      authorityRefs: ['runtime:cache'],
      contractView: {
        view: 'cacheOnly',
        storageRef: String(intent?.storageMemberRef || 'storage:indexeddb:runtime-cache').trim(),
      },
      safeFacts: { identityAuthority: false, storageHolder: 'browserRuntime' },
    },
  ];
  if (gatewayPk) {
    participants.push({
      role: SWARM.INTERACTION_ROLE.ROUTER,
      memberRef: gatewayPk,
      capabilityRefs: [capabilityRef],
      channelRefs: channelId ? [channelId] : [],
      authorityRefs: [`gateway:${gatewayPk}:admission`],
      contractView: { view: 'gatewayAdmission' },
      safeFacts: { authorityDomain: SWARM.AUTHORITY_DOMAIN.GATEWAY },
    });
  }
  if (serviceMemberRef) {
    participants.push({
      role: SWARM.INTERACTION_ROLE.EXECUTOR,
      memberRef: serviceMemberRef,
      capabilityRefs: [capabilityRef],
      channelRefs: channelId ? [channelId] : [],
      authorityRefs: serviceRef ? [`${serviceRef}:serviceGrant`] : [],
      contractView: { view: 'serviceContract', service },
      safeFacts: { authorityDomain: SWARM.AUTHORITY_DOMAIN.SERVICE },
    });
  }
  if (method === RUNTIME_APP_INTENT.DIAGNOSTIC_LOG && serviceMemberRef) {
    participants.push({
      role: SWARM.INTERACTION_ROLE.OBSERVER,
      memberRef: serviceMemberRef,
      capabilityRefs: ['logging.events.ingest'],
      channelRefs: ['logging.events'],
      authorityRefs: ['logging:observe'],
      contractView: { view: 'safeEvidenceOnly' },
      safeFacts: { controlPlane: false },
    });
  }
  const record = {
    kind: SWARM.RECORD_KIND.SWARM_INTERACTION,
    interactionId,
    contractRef: String(intent?.contractRef || routePromise?.channelId || channelId || method).trim(),
    interactionKind: isRuntimeStreamIntent(method) ? 'activation' : method,
    state: SWARM.INTERACTION_STATE.PREPARED,
    participants,
    capabilityRefs: [capabilityRef],
    channelRefs: channelId ? [channelId] : [],
    routingScope,
    authority: {
      domains: [
        SWARM.AUTHORITY_DOMAIN.IDENTITY,
        SWARM.AUTHORITY_DOMAIN.RUNTIME,
        ...(gatewayPk ? [SWARM.AUTHORITY_DOMAIN.GATEWAY] : []),
        ...(serviceRef || servicePk || service ? [SWARM.AUTHORITY_DOMAIN.SERVICE] : []),
      ],
      grantRefs: normalizeArray(routePromise?.authorityRefs),
    },
    safeFacts: {
      method,
      activationId: activation.activationId,
      routePromiseId: routePromise?.promiseId || '',
      routingScopeState: routingScope.state,
      routingScopeKind: routingScope.kind,
    },
    issuedAt,
  };
  assertSwarmInteraction(record);
  return record;
}

function appIntentSwarmActivationRecord(activation, interaction, authoritySummary, issuedAt, expiresAt) {
  const record = {
    kind: SWARM.RECORD_KIND.SWARM_ACTIVATION,
    activationId: activation.activationId,
    interactionId: interaction.interactionId,
    nodeRef: activation.nodeRef,
    capabilityRef: activation.capabilityRef,
    requesterRef: activation.requesterRef,
    runtimeMemberRef: String(authoritySummary?.runtime?.memberRef || '').trim(),
    state: SWARM.INTERACTION_STATE.PREPARED,
    authoritySummary: safeClone(authoritySummary),
    safeFacts: {
      activationKind: 'runtimePreparedInteraction',
      routeCritical: true,
      routingScope: safeClone(authoritySummary?.routingScope || null),
    },
    issuedAt,
    expiresAt,
  };
  assertSwarmActivation(record);
  return record;
}

function streamCandidateEndpointEvidence(candidate) {
  const text = String(candidate?.candidate || '').trim();
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 8) return null;
  const protocol = String(parts[2] || '').trim().toLowerCase();
  if (protocol !== 'udp' && protocol !== 'tcp') return null;
  const address = String(parts[4] || '').trim();
  const port = Number.parseInt(String(parts[5] || ''), 10);
  const typIndex = parts.findIndex((part) => part === 'typ');
  const candidateType = typIndex >= 0 ? String(parts[typIndex + 1] || '').trim() : '';
  if (!address || !Number.isInteger(port) || port < 1 || port > 65_535 || !candidateType) return null;
  return {
    protocol,
    address,
    port,
    candidateType,
  };
}

function runtimeStreamCandidateRecord(intent, candidatePayload, issuedAt, idx = 0) {
  const candidate = candidatePayload?.candidate && typeof candidatePayload.candidate === 'object'
    ? candidatePayload.candidate
    : candidatePayload;
  const endpoint = streamCandidateEndpointEvidence(candidate);
  const record = {
    kind: SWARM.STREAM_RECORD_KIND.CANDIDATE,
    candidateId: String(
      candidatePayload?.candidateId
        || intent?.candidateId
        || `candidate:${String(intent?.sessionId || intent?.nonce || 'stream').trim()}:${idx}`,
    ).trim(),
    sessionId: String(intent?.sessionId || candidatePayload?.sessionId || '').trim(),
    transport: String(intent?.transport || candidatePayload?.transport || 'webrtc').trim() || 'webrtc',
    candidateRole: 'browser',
    actionability: endpoint ? 'usable' : 'blocked',
    ...(endpoint ? { endpoint } : { blockedReason: 'missingCandidateEndpoint' }),
    payload: safeClone(candidatePayload || {}),
    issuedAt,
  };
  assertStreamSessionCandidate(record);
  return record;
}

function runtimeCandidatePayloads(intent, payload) {
  const out = [];
  if (payload?.candidate) out.push(payload);
  for (const candidate of normalizeArray(intent?.candidates)) {
    if (candidate && typeof candidate === 'object') {
      out.push({ candidate });
    }
  }
  for (const candidate of normalizeArray(payload?.candidates)) {
    if (candidate && typeof candidate === 'object') {
      out.push({ candidate });
    }
  }
  return out;
}

function appIntentClaims(method, intent, authority, issuedAt, expiresAt, nonce, activation) {
  const payload = intent?.payload && typeof intent.payload === 'object'
    ? safeClone(intent.payload)
    : intent?.params && typeof intent.params === 'object'
      ? safeClone(intent.params)
      : {};
  const routePromise = appIntentRoutePromise(method, intent, authority, issuedAt, expiresAt, activation);
  const authoritySummary = appIntentAuthoritySummary(method, intent, authority);
  const interaction = appIntentInteractionRecord(method, intent, authority, activation, routePromise, issuedAt);
  const swarmActivation = appIntentSwarmActivationRecord(activation, interaction, authoritySummary, issuedAt, expiresAt);
  const claims = {
    method,
    signalType: appIntentSignalType(method, intent),
    activation: safeClone(activation),
    interaction: safeClone(interaction),
    swarmActivation: safeClone(swarmActivation),
    authoritySummary: safeClone(authoritySummary),
    authority: appIntentAuthorityClaims(method, intent, authority, issuedAt, expiresAt, nonce),
    payload,
    record: safeClone(activation),
  };
  const candidatePayloads = runtimeCandidatePayloads(intent, payload);
  if (candidatePayloads.length) {
    const candidateRecords = candidatePayloads.map((candidatePayload, idx) => (
      runtimeStreamCandidateRecord(intent, candidatePayload, issuedAt, idx)
    ));
    const blocked = candidateRecords.find((record) => record.actionability === 'blocked');
    if (blocked) {
      throw new Error(String(blocked.blockedReason || 'stream candidate is not actionable'));
    }
    claims.candidateRecords = candidateRecords;
    if (method === RUNTIME_APP_INTENT.STREAM_CONTROL && appIntentSignalType(method, intent) === 'candidate') {
      claims.record = safeClone(candidateRecords[0]);
    }
  }
  if (routePromise) {
    claims.routePromise = safeClone(routePromise);
    claims.routePromiseId = routePromise.promiseId;
  }
  if (intent?.offer && typeof intent.offer === 'object') claims.offer = safeClone(intent.offer);
  if (normalizeArray(intent?.candidates).length) claims.candidates = safeClone(normalizeArray(intent.candidates));
  if (normalizeArray(payload?.candidates).length) claims.candidates = safeClone(normalizeArray(payload.candidates));
  return claims;
}

function appIntentBody(method, intent, authority, issuedAt, expiresAt, nonce, activation) {
  const recordKind = appIntentRecordKind(method, intent);
  const envelope = sealEnvelope({
    kind: recordKind,
    claims: appIntentClaims(method, intent, authority, issuedAt, expiresAt, nonce, activation),
    issuerSecretKey: authority.secretKey,
    recipientPks: appIntentRecipientPks(intent, authority),
    issuedAt,
    expiresAt,
    envelopeId: String(intent?.envelopeId || '').trim() || undefined,
  });
  return {
    encoding: SWARM.BODY_ENCODING.CAAC,
    envelope,
  };
}

function blockedRuntimeAuthoritySummary(method, intent, posture) {
  const summary = appIntentAuthoritySummary(method, intent, { publicKey: '' });
  summary.runtime = {
    ...safeClone(summary.runtime || {}),
    domain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
    state: String(posture?.state || 'waitingAuthority').trim() || 'waitingAuthority',
    ready: false,
    memberRef: String(posture?.devicePk || '').trim(),
    deviceRef: String(posture?.devicePk || '').trim(),
    blockedAuthorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
    missingGrantReason: String(posture?.reason || 'runtime authority not ready').trim(),
  };
  summary.blocked = true;
  summary.blockedAuthorityDomain = SWARM.AUTHORITY_DOMAIN.RUNTIME;
  summary.authorityLifecycleState = summary.runtime.state;
  return summary;
}

function routingScopeReadyForActivation(method, intent, routingScope) {
  if (!isRuntimeStreamIntent(method)) return true;
  const channelId = String(appIntentChannelId(method, intent)).trim();
  if (channelId !== NVR_STREAM_CHANNEL) return true;
  if (swarmEdge.connected !== true) return false;
  const state = String(routingScope?.state || '').trim();
  return state === SWARM.ROUTING_SCOPE_STATE.READY || state === SWARM.ROUTING_SCOPE_STATE.NOT_REQUIRED;
}

function routeWaitingStateForRoutingScope(routingScope) {
  const blockedReason = String(routingScope?.blockedReason || '').trim();
  if (
    blockedReason === SWARM.ROUTING_BLOCKED_REASON.NO_MEMBER_IN_ZONE
    || blockedReason === SWARM.ROUTING_BLOCKED_REASON.ZERO_PROPAGATION
    || blockedReason === SWARM.ROUTING_BLOCKED_REASON.AUDIENCE_MISMATCH
  ) {
    return 'waitingMemberCandidate';
  }
  return 'waitingRouteBaseline';
}

function runtimePostureFacet(state, reason = '', extras = {}) {
  const facet = {
    state,
    ...safeClone(normalizeObject(extras)),
  };
  const text = String(reason || '').trim();
  if (text) facet.reason = text;
  return facet;
}

function resourceFacetForSelfCapability() {
  const sample = runtimeResourceSample();
  const state = String(sample?.posture?.state || RESOURCE_POSTURE_STATES.WITHIN_BUDGET).trim();
  const reasons = normalizeArray(sample?.posture?.reasons).map((entry) => String(entry || '').trim()).filter(Boolean);
  if (state === RESOURCE_POSTURE_STATES.OVER_BUDGET || state === RESOURCE_POSTURE_STATES.BLOCKED) {
    return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.DEGRADED, reasons.join(', ') || 'runtime resource posture is over budget', {
      evidenceRefs: [`resource.sample:${sample.observedAt}`],
    });
  }
  if (state === RESOURCE_POSTURE_STATES.PRESSURE) {
    return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.DEGRADED, reasons.join(', ') || 'runtime resource posture is under pressure', {
      evidenceRefs: [`resource.sample:${sample.observedAt}`],
    });
  }
  return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.READY, '', {
    evidenceRefs: [`resource.sample:${sample.observedAt}`],
  });
}

function routingFacetForSelfCapability(method, routingScope) {
  if (!appIntentRoutingScopeRequired(method, {})) {
    return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.NOT_REQUIRED);
  }
  const state = String(routingScope?.state || '').trim();
  if (state === SWARM.ROUTING_SCOPE_STATE.READY) return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.READY);
  if (state === SWARM.ROUTING_SCOPE_STATE.NOT_REQUIRED) return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.NOT_REQUIRED);
  if (state === SWARM.ROUTING_SCOPE_STATE.SYNCING || state === SWARM.ROUTING_SCOPE_STATE.STALE) {
    return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.MISSING, String(routingScope?.blockedReason || `route baseline is ${state}`).trim(), {
      evidenceRefs: String(routingScope?.baselineRef || '').trim() ? [String(routingScope.baselineRef).trim()] : [],
    });
  }
  return runtimePostureFacet(SWARM.POSTURE_FACET_STATE.MISSING, String(routingScope?.blockedReason || state || 'route baseline is missing').trim(), {
    evidenceRefs: String(routingScope?.baselineRef || '').trim() ? [String(routingScope.baselineRef).trim()] : [],
  });
}

function selfCapabilityStatusFromFacets(facets) {
  const values = Object.values(facets || {});
  if (values.some((facet) => facet?.state === SWARM.POSTURE_FACET_STATE.BLOCKED || facet?.state === SWARM.POSTURE_FACET_STATE.MISSING)) {
    return SWARM.SELF_CAPABILITY_STATUS.BLOCKED;
  }
  if (values.some((facet) => facet?.state === SWARM.POSTURE_FACET_STATE.DEGRADED || facet?.state === SWARM.POSTURE_FACET_STATE.UNKNOWN)) {
    return SWARM.SELF_CAPABILITY_STATUS.DEGRADED;
  }
  return SWARM.SELF_CAPABILITY_STATUS.AVAILABLE;
}

function selfCapabilityRunlevelFromFacets(facets, fallbackState) {
  const state = String(fallbackState || '').trim();
  if (state === 'waitingAuthority') return SWARM.PARTICIPANT_RUNLEVEL.LOCAL_CACHE;
  if (facets?.authority?.state !== SWARM.POSTURE_FACET_STATE.READY) return SWARM.PARTICIPANT_RUNLEVEL.LOCAL_CACHE;
  if (facets?.route?.state === SWARM.POSTURE_FACET_STATE.READY) return SWARM.PARTICIPANT_RUNLEVEL.ROUTE_READY;
  if (swarmEdge.connected) return SWARM.PARTICIPANT_RUNLEVEL.EDGE_ATTACHED;
  if (state === 'waitingResolution') return SWARM.PARTICIPANT_RUNLEVEL.AUTHORITY_READY;
  if (state === 'resolved') return SWARM.PARTICIPANT_RUNLEVEL.INTERACTIVE;
  return SWARM.PARTICIPANT_RUNLEVEL.DEGRADED;
}

function blockedReasonsFromFacets(facets) {
  return uniqueTrimmedStrings(Object.entries(facets || {})
    .filter(([, facet]) => facet?.state === SWARM.POSTURE_FACET_STATE.BLOCKED || facet?.state === SWARM.POSTURE_FACET_STATE.MISSING)
    .map(([name, facet]) => String(facet?.reason || `${name}.${facet?.state || 'blocked'}`).trim()));
}

function runtimeSelfCapabilityAssessment({
  method,
  activationId,
  capability,
  posture,
  state,
  nodeRef,
  channelId,
  service,
  servicePk,
  serviceRef,
  serviceMemberRef,
  routingScope,
  updatedAt,
}) {
  const authorityReady = posture?.ready === true;
  const facets = {
    authority: authorityReady
      ? runtimePostureFacet(SWARM.POSTURE_FACET_STATE.READY, '', {
          authorityRefs: String(posture?.devicePk || '').trim() ? [String(posture.devicePk).trim()] : [],
        })
      : runtimePostureFacet(SWARM.POSTURE_FACET_STATE.BLOCKED, String(posture?.reason || 'runtime authority is not ready').trim(), {
          authorityRefs: String(posture?.devicePk || '').trim() ? [String(posture.devicePk).trim()] : [],
        }),
    resource: resourceFacetForSelfCapability(),
    policy: runtimePostureFacet(SWARM.POSTURE_FACET_STATE.READY),
    directory: (service || servicePk || serviceRef)
      ? runtimePostureFacet(serviceMemberRef || !isRuntimeStreamIntent(method) ? SWARM.POSTURE_FACET_STATE.READY : SWARM.POSTURE_FACET_STATE.MISSING, serviceMemberRef || !isRuntimeStreamIntent(method) ? '' : 'service member has not resolved from directory')
      : runtimePostureFacet(SWARM.POSTURE_FACET_STATE.MISSING, 'service has not resolved'),
    route: routingFacetForSelfCapability(method, routingScope),
    adapter: runtimePostureFacet(SWARM.POSTURE_FACET_STATE.NOT_REQUIRED),
    retention: runtimePostureFacet(SWARM.POSTURE_FACET_STATE.NOT_REQUIRED),
    domain: nodeRef && channelId
      ? runtimePostureFacet(SWARM.POSTURE_FACET_STATE.READY)
      : runtimePostureFacet(SWARM.POSTURE_FACET_STATE.MISSING, nodeRef ? 'channel has not resolved' : 'node has not resolved'),
  };
  const status = selfCapabilityStatusFromFacets(facets);
  const participantRef = resolvedMemberPkFromCandidates(posture?.devicePk);
  const assessment = {
    kind: SWARM.RECORD_KIND.PARTICIPANT_SELF_CAPABILITY,
    assessmentId: `self-capability:${activationId}`,
    participantRef,
    participantKind: 'browserRuntime',
    ...(serviceRef ? { serviceRef } : {}),
    ...(serviceMemberRef ? { serviceMemberRef } : {}),
    ...(nodeRef ? { subjectRef: nodeRef } : {}),
    capabilityRef: capability,
    actions: [isRuntimeStreamIntent(method) ? SWARM.SELF_CAPABILITY_ACTION.REQUEST : SWARM.SELF_CAPABILITY_ACTION.OBSERVE],
    status,
    runlevel: selfCapabilityRunlevelFromFacets(facets, state),
    facets,
    blockedReasons: blockedReasonsFromFacets(facets),
    evidenceRefs: [activationId].filter(Boolean),
    authorityRefs: String(posture?.devicePk || '').trim() ? [String(posture.devicePk).trim()] : [],
    updatedAt,
  };
  if (!participantRef) {
    return {
      ...assessment,
      kind: 'runtime.selfCapability.localPosture',
      contractReady: false,
      blockedReasons: uniqueTrimmedStrings([...assessment.blockedReasons, 'runtimeParticipantUnresolved']),
    };
  }
  return assertSelfCapabilityAssessment(assessment);
}

function messageWithActivationId(message, activationId) {
  const cloned = safeClone(message || {});
  const payload = cloned.payload && typeof cloned.payload === 'object'
    ? { ...cloned.payload }
    : cloned.intent && typeof cloned.intent === 'object'
      ? { ...cloned.intent }
      : {};
  payload.activationId = String(payload.activationId || activationId || '').trim();
  cloned.payload = payload;
  return cloned;
}

function pendingRouteIntent(method, message, context) {
  const {
    resolvedIntent,
    activation,
    routePromise,
    interaction,
    swarmActivation,
    authoritySummary,
    routingScope,
    channelId,
  } = context;
  const activationId = String(activation?.activationId || '').trim();
  const state = routeWaitingStateForRoutingScope(routingScope);
  const entry = {
    requestId: String(resolvedIntent?.requestId || message?.requestId || '').trim(),
    method,
    message: messageWithActivationId(message, activationId),
    intent: safeClone(resolvedIntent),
    activationId,
    interactionId: String(interaction?.interactionId || '').trim(),
    routePromiseId: String(routePromise?.promiseId || '').trim(),
    state,
    nodeRef: String(activation?.nodeRef || '').trim(),
    capabilityRef: String(activation?.capabilityRef || '').trim(),
    channelId: String(channelId || '').trim(),
    zoneScope: safeClone(resolvedIntent?.zoneScope || routingScope?.zoneScope || null),
    routingScope: safeClone(routingScope || null),
    audience: safeClone(appIntentAudience(method, resolvedIntent) || null),
    authoritySummary: safeClone(authoritySummary || null),
    interaction: safeClone(interaction || null),
    swarmActivation: safeClone(swarmActivation || null),
    queuedAt: nowMs(),
    updatedAt: nowMs(),
    expiresAt: Number(activation?.expiresAt || resolvedIntent?.expiresAt || 0),
    attempts: 0,
    lastError: {
      reason: String(routingScope?.blockedReason || routingScope?.state || 'route baseline not ready').trim(),
      routingScopeState: String(routingScope?.state || '').trim(),
    },
  };
  pendingRouteIntents.set(activationId, entry);
  while (pendingRouteIntents.size > PENDING_AUTHORITY_INTENT_LIMIT) {
    const first = pendingRouteIntents.keys().next().value;
    pendingRouteIntents.delete(first);
  }
  recordRuntimeEvent('interaction.prepared', {
    activationId,
    interactionId: entry.interactionId,
    routePromiseId: entry.routePromiseId,
    channelId,
    capability: appIntentCapability(method, resolvedIntent),
    state,
    authoritySummary,
    routingScope,
    blockedReason: entry.lastError.reason,
  });
  requestRuntimeDirectoryObserve(state);
  broadcastSnapshot();
  return {
    ok: true,
    result: {
      activationId,
      interactionId: entry.interactionId,
      routePromiseId: entry.routePromiseId,
      state,
      pendingRoute: true,
      routingScope,
      authoritySummary,
      reason: entry.lastError.reason,
    },
  };
}

function pendingRuntimeAuthorityIntent(method, message, posture) {
  const intent = appIntentPayload(message);
  const requestId = String(intent.requestId || message.requestId || '').trim();
  const issuedAt = Number(intent.issuedAt || 0) || nowMs();
  const expiresAt = Number(intent.expiresAt || 0) || (issuedAt + 90_000);
  const pendingRequesterRef = resolvedMemberPkFromCandidates(
    intent.requesterRef,
    intent.requester_ref,
    posture?.devicePk,
  );
  const pendingIntent = {
    ...intent,
    requesterRef: pendingRequesterRef,
  };
  const resolvedIntent = appIntentResolvedRoute(method, pendingIntent);
  const channelId = appIntentChannelId(method, resolvedIntent);
  if (isRuntimeStreamIntent(method) && !channelId) {
    throw new Error('runtime could not resolve stream route channel');
  }
  const activation = pendingRequesterRef
    ? appIntentActivationRecord(method, resolvedIntent, { publicKey: pendingRequesterRef }, issuedAt, expiresAt, requestId)
    : {
      activationId: appIntentActivationId(method, resolvedIntent, requestId),
      nodeRef: appIntentNodeRef(method, resolvedIntent),
      capabilityRef: appIntentCapability(method, resolvedIntent),
      requesterRef: '',
      params: appIntentActivationParams(method, resolvedIntent),
      issuedAt,
      expiresAt,
    };
  const activationId = String(activation.activationId || requestId || randomOpaqueId('activation')).trim();
  const interactionId = swarmInteractionId(method, resolvedIntent, activation);
  const routingScope = appIntentRoutingScopePosture(method, resolvedIntent, { channelId, capability: activation.capabilityRef });
  const authoritySummary = blockedRuntimeAuthoritySummary(method, resolvedIntent, posture);
  authoritySummary.routingScope = routingScope;
  const entry = {
    requestId,
    method,
    message: safeClone(message),
    intent: safeClone(resolvedIntent),
    activationId,
    interactionId,
    state: 'waitingAuthority',
    authorityLifecycleState: String(posture?.state || 'waitingAuthority').trim() || 'waitingAuthority',
    blockedAuthorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
    nodeRef: activation.nodeRef,
    capabilityRef: activation.capabilityRef,
    channelId,
    zoneScope: safeClone(resolvedIntent.zoneScope || null),
    routingScope,
    audience: safeClone(appIntentAudience(method, resolvedIntent)),
    authoritySummary,
    queuedAt: issuedAt,
    updatedAt: nowMs(),
    expiresAt,
    attempts: 0,
    lastError: {
      reason: String(posture?.reason || 'runtime authority not ready').trim(),
      authorityLifecycleState: String(posture?.state || 'waitingAuthority').trim() || 'waitingAuthority',
    },
  };
  pendingAuthorityIntents.set(activationId, entry);
  while (pendingAuthorityIntents.size > PENDING_AUTHORITY_INTENT_LIMIT) {
    const first = pendingAuthorityIntents.keys().next().value;
    pendingAuthorityIntents.delete(first);
  }
  recordRuntimeEvent('interaction.prepared', {
    activationId,
    interactionId,
    channelId,
    capability: appIntentCapability(method, resolvedIntent),
    state: 'waitingAuthority',
    authoritySummary,
    routingScope,
    blockedAuthorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
    authorityLifecycleState: entry.authorityLifecycleState,
    reason: entry.lastError.reason,
  });
  broadcastSnapshot();
  return {
    ok: true,
    result: {
      activationId,
      interactionId,
      state: 'waitingAuthority',
      pendingAuthority: true,
      blockedAuthorityDomain: SWARM.AUTHORITY_DOMAIN.RUNTIME,
      authorityLifecycleState: entry.authorityLifecycleState,
      authoritySummary,
      routingScope,
      reason: entry.lastError.reason,
    },
  };
}

async function flushPendingAuthorityIntents(reason = 'authority.ready') {
  if (flushingPendingAuthorityIntents || pendingAuthorityIntents.size === 0) return;
  flushingPendingAuthorityIntents = true;
  try {
    const posture = await runtimeAuthorityPosture();
    if (posture.state !== 'ready') return;
    for (const [activationId, entry] of Array.from(pendingAuthorityIntents.entries())) {
      if (Number(entry.expiresAt || 0) > 0 && Number(entry.expiresAt || 0) <= nowMs()) {
        pendingAuthorityIntents.set(activationId, {
          ...entry,
          state: 'expired',
          updatedAt: nowMs(),
          lastError: { reason: 'pending activation expired before runtime authority became ready' },
        });
        continue;
      }
      pendingAuthorityIntents.delete(activationId);
      try {
        const queued = await queueRuntimeAppIntent(entry.method, entry.message);
        recordRuntimeEvent('interaction.repaired', {
          activationId,
          interactionId: entry.interactionId,
          level: 'info',
          reason,
          repairedState: queued?.result?.state || queued?.result?.status || 'queued',
          frameId: queued?.result?.frameId || queued?.result?.frame?.frameId || '',
        });
      } catch (error) {
        pendingAuthorityIntents.set(activationId, {
          ...entry,
          state: 'repairPending',
          attempts: Number(entry.attempts || 0) + 1,
          updatedAt: nowMs(),
          lastError: { reason: String(error?.message || error || 'pending activation repair failed') },
        });
        recordRuntimeEvent('interaction.repair.failed', {
          activationId,
          interactionId: entry.interactionId,
          reason: String(error?.message || error || 'pending activation repair failed'),
        });
      }
    }
  } finally {
    flushingPendingAuthorityIntents = false;
    broadcastSnapshot();
  }
}

async function flushPendingRouteIntents(reason = 'route.ready') {
  if (flushingPendingRouteIntents || pendingRouteIntents.size === 0) return;
  flushingPendingRouteIntents = true;
  try {
    for (const [activationId, entry] of Array.from(pendingRouteIntents.entries())) {
      if (Number(entry.expiresAt || 0) > 0 && Number(entry.expiresAt || 0) <= nowMs()) {
        pendingRouteIntents.set(activationId, {
          ...entry,
          state: 'expired',
          updatedAt: nowMs(),
          lastError: { reason: 'pending activation expired before route baseline became ready' },
        });
        continue;
      }
      const resolvedIntent = appIntentResolvedRoute(entry.method, entry.intent || appIntentPayload(entry.message));
      const channelId = appIntentChannelId(entry.method, resolvedIntent);
      const routingScope = appIntentRoutingScopePosture(entry.method, resolvedIntent, {
        channelId,
        capability: appIntentCapability(entry.method, resolvedIntent),
      });
      if (!routingScopeReadyForActivation(entry.method, resolvedIntent, routingScope)) {
        pendingRouteIntents.set(activationId, {
          ...entry,
          state: routeWaitingStateForRoutingScope(routingScope),
          routingScope,
          updatedAt: nowMs(),
          lastError: {
            reason: String(routingScope?.blockedReason || routingScope?.state || 'route baseline not ready').trim(),
            routingScopeState: String(routingScope?.state || '').trim(),
          },
        });
        continue;
      }
      pendingRouteIntents.delete(activationId);
      try {
        const queued = await queueRuntimeAppIntent(entry.method, entry.message);
        recordRuntimeEvent('interaction.repaired', {
          activationId,
          interactionId: entry.interactionId,
          level: 'info',
          reason,
          repairedState: queued?.result?.state || queued?.result?.status || 'queued',
          frameId: queued?.result?.frameId || queued?.result?.frame?.frameId || '',
        });
      } catch (error) {
        pendingRouteIntents.set(activationId, {
          ...entry,
          state: 'repairPending',
          attempts: Number(entry.attempts || 0) + 1,
          updatedAt: nowMs(),
          lastError: { reason: String(error?.message || error || 'pending route activation repair failed') },
        });
        recordRuntimeEvent('interaction.repair.failed', {
          activationId,
          interactionId: entry.interactionId,
          reason: String(error?.message || error || 'pending route activation repair failed'),
        });
      }
    }
  } finally {
    flushingPendingRouteIntents = false;
    broadcastSnapshot();
  }
}

async function resolveRuntimeCapability(message) {
  const intent = appIntentPayload(message);
  const requestId = String(intent.requestId || message.requestId || '').trim();
  const issuedAt = Number(intent.issuedAt || 0) || nowMs();
  const expiresAt = Number(intent.expiresAt || 0) || (issuedAt + 90_000);
  const capability = String(intent.capabilityRef || intent.capability || '').trim() || RUNTIME_APP_INTENT.CAPABILITY_RESOLVE;
  const resolutionMethod = capability === SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW
    || capability === SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER
    || capability === SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL
    ? RUNTIME_APP_INTENT.STREAM_OPEN
    : RUNTIME_APP_INTENT.CAPABILITY_RESOLVE;
  const resolvedIntent = appIntentResolvedRoute(resolutionMethod, {
    ...intent,
    capabilityRef: capability,
  });
  const derived = deriveServiceContextForIntent(resolutionMethod, resolvedIntent);
  const selectedNode = derived?.selectedNode && typeof derived.selectedNode === 'object' ? derived.selectedNode : null;
  const nodeRef = String(
    resolvedIntent.nodeRef
      || selectedNode?.nodeId
      || selectedNode?.path
      || selectedNode?.label
      || appIntentNodeRef(resolutionMethod, resolvedIntent)
      || '',
  ).trim();
  const channelId = String(
    resolvedIntent.channelId
      || selectedNode?.channelId
      || selectedNode?.channel
      || selectedNode?.backingChannel
      || appIntentChannelId(resolutionMethod, resolvedIntent)
      || '',
  ).trim();
  const service = String(resolvedIntent.service || derived?.service || '').trim();
  const servicePk = String(resolvedIntent.servicePk || derived?.servicePk || '').trim();
  const serviceRef = String(resolvedIntent.serviceRef || derived?.serviceRef || '').trim() || defaultServiceRefForService(service, servicePk);
  const serviceMemberRef = resolvedMemberPkFromCandidates(
    resolvedIntent.serviceMemberRef,
    resolvedIntent.routeMemberRef,
    resolvedIntent.memberRef,
    derived?.serviceMemberRef,
    derived?.routeMemberRef,
    derived?.liveEdgeRoute?.memberRef,
    servicePk,
  );
  const routingScope = appIntentRoutingScopePosture(resolutionMethod, resolvedIntent, { channelId, capability });
  const posture = await runtimeAuthorityPosture();
  const authorityReady = posture?.ready === true;
  const routeReady = routingScopeReadyForActivation(resolutionMethod, resolvedIntent, routingScope);
  const state = !service && !servicePk
    ? 'waitingResolution'
    : !nodeRef || !channelId
      ? 'waitingResolution'
      : !authorityReady
        ? 'waitingAuthority'
        : !routeReady
        ? routeWaitingStateForRoutingScope(routingScope)
        : 'resolved';
  const authorityState = String(posture?.state || 'unavailable').trim() || 'unavailable';
  const activationId = appIntentActivationId(resolutionMethod, resolvedIntent, requestId);
  const resolvedAt = nowMs();
  const selfCapability = runtimeSelfCapabilityAssessment({
    method: resolutionMethod,
    activationId,
    capability,
    posture,
    state,
    nodeRef,
    channelId,
    service,
    servicePk,
    serviceRef,
    serviceMemberRef,
    routingScope,
    updatedAt: resolvedAt,
  });
  const result = {
    local: true,
    state,
    requestId,
    activationId,
    nodeRef,
    capabilityRef: capability,
    channelId,
    service,
    servicePk,
    serviceRef,
    ...(serviceMemberRef ? { serviceMemberRef, routeMemberRef: serviceMemberRef } : {}),
    gatewayPk: String(resolvedIntent.gatewayPk || derived?.hostGatewayPk || '').trim(),
    identityId: String(resolvedIntent.identityId || derived?.identityId || defaultIdentityId()).trim(),
    routingScope,
    authorityLifecycleState: authorityState,
    selfCapability,
    resolvedActivationEnvelope: {
      kind: 'runtime.resolvedActivationEnvelope',
      activationId,
      requesterRef: resolvedMemberPkFromCandidates(resolvedIntent.requesterRef, posture?.devicePk),
      authority: {
        runtime: {
          state: authorityState,
          ready: posture?.ready === true,
          devicePk: String(posture?.devicePk || '').trim(),
        },
      },
      service,
      servicePk,
      serviceRef,
      ...(serviceMemberRef ? { serviceMemberRef, routeMemberRef: serviceMemberRef } : {}),
      nodeRef,
      capabilityRef: capability,
      channelId,
      sourceIds: normalizeArray(resolvedIntent.sourceIds || resolvedIntent.sources || resolvedIntent.offer?.sourceIds || resolvedIntent.payload?.sourceIds)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
      routingScope,
      issuedAt,
      expiresAt,
      resolvedAt,
    },
  };
  recordRuntimeEvent('runtime.capability.resolved', {
    activationId,
    state,
    service,
    servicePk,
    serviceRef,
    serviceMemberRef,
    nodeRef,
    capability,
    channelId,
    routingScope,
    authorityLifecycleState: authorityState,
    selfCapabilityStatus: String(selfCapability?.status || '').trim(),
    selfCapabilityRunlevel: String(selfCapability?.runlevel || '').trim(),
    selfCapabilityContractReady: selfCapability?.contractReady !== false,
    blockedReasons: safeClone(selfCapability?.blockedReasons || []),
  });
  broadcastSnapshot();
  return { ok: true, result };
}

async function queueRuntimeAppIntent(method, message) {
  const intent = appIntentPayload(message);
  const requestId = String(intent.requestId || message.requestId || '').trim();
  const posture = await runtimeAuthorityPosture();
  if (posture.state !== 'ready') {
    return pendingRuntimeAuthorityIntent(method, message, posture);
  }
  const authority = await runtimeDeviceAuthority();
  const issuedAt = Number(intent.issuedAt || 0) || nowMs();
  const expiresAt = Number(intent.expiresAt || 0) || (issuedAt + 90_000);
  const nonce = String(intent.nonce || '').trim() || randomOpaqueId('nonce');
  const resolvedIntent = appIntentResolvedRoute(method, intent);
  const activation = appIntentActivationRecord(method, resolvedIntent, authority, issuedAt, expiresAt, requestId);
  const channelId = appIntentChannelId(method, resolvedIntent);
  if (isRuntimeStreamIntent(method) && !channelId) {
    throw new Error('runtime could not resolve stream route channel');
  }
  const routingScope = appIntentRoutingScopePosture(method, resolvedIntent, { channelId, capability: appIntentCapability(method, resolvedIntent) });
  const routePromise = appIntentRoutePromise(method, resolvedIntent, authority, issuedAt, expiresAt, activation);
  const authoritySummary = appIntentAuthoritySummary(method, resolvedIntent, authority);
  authoritySummary.routingScope = routingScope;
  const interaction = appIntentInteractionRecord(method, resolvedIntent, authority, activation, routePromise, issuedAt);
  const swarmActivation = appIntentSwarmActivationRecord(activation, interaction, authoritySummary, issuedAt, expiresAt);
  if (!routingScopeReadyForActivation(method, resolvedIntent, routingScope)) {
    return pendingRouteIntent(method, message, {
      resolvedIntent,
      activation,
      routePromise,
      interaction,
      swarmActivation,
      authoritySummary,
      routingScope,
      channelId,
    });
  }
  const frame = makeSwarmFrame({
    kind: appIntentFrameKind(method, resolvedIntent),
    issuer: authority.publicKey,
    audience: appIntentAudience(method, resolvedIntent),
    zoneScope: appIntentZoneScope({ ...resolvedIntent, zoneScope: routingScope?.zoneScope || resolvedIntent.zoneScope }, { requirePropagation: true }),
    issuedAt,
    expiresAt,
    nonce,
    correlationId: requestId || activation.activationId || nonce,
    channelId,
    recordRef: appIntentRecordRef(method, resolvedIntent, activation),
    capability: appIntentCapability(method, resolvedIntent),
    body: appIntentBody(method, resolvedIntent, authority, issuedAt, expiresAt, nonce, activation),
  });
  recordRuntimeEvent('interaction.prepared', {
    activationId: activation.activationId,
    interactionId: interaction.interactionId,
    routePromiseId: routePromise?.promiseId || '',
    channelId,
    capability: appIntentCapability(method, resolvedIntent),
    authoritySummary,
    routingScope,
  });
  return queueSwarmFrame({
    frame,
    retryPolicy: message.retryPolicy || intent.retryPolicy || { onReject: 'preserve' },
    activationId: activation.activationId,
    interactionId: interaction.interactionId,
    routePromiseId: routePromise?.promiseId || '',
    authoritySummary,
    routingScope,
    interaction,
    swarmActivation,
  });
}

function findQueuedFrame(correlationId) {
  const target = String(correlationId || '').trim();
  if (!target) return null;
  if (outboundSwarmFrames.has(target)) return outboundSwarmFrames.get(target);
  for (const entry of outboundSwarmFrames.values()) {
    if (queueCorrelationIds(entry).includes(target)) return entry;
  }
  return null;
}

function handleSwarmEdgeAck(message) {
  const correlationId = String(message?.frame?.correlationId || message.correlationId || message.frameId || '').trim();
  const entry = findQueuedFrame(correlationId);
  if (!entry) return { ok: false, error: 'queued frame not found' };
  if (markQueuedSwarmFrameExpired(entry) || queuedSwarmFrameTerminal(entry)) {
    recordRuntimeEvent('frame.ack.ignored', {
      frameId: entry.frameId,
      correlationId,
      ignoredReason: 'terminalActivation',
      currentStatus: String(entry.status || '').trim(),
    });
    touchRuntime();
    schedulePersist();
    broadcastSnapshot();
    return {
      ok: true,
      result: {
        frameId: entry.frameId,
        correlationId,
        ignored: true,
        status: String(entry.status || '').trim(),
      },
    };
  }
  const propagation = Array.isArray(message.propagation) ? safeClone(message.propagation) : [];
  const bridge = message.bridge && typeof message.bridge === 'object' ? safeClone(message.bridge) : null;
  entry.status = 'accepted';
  entry.ackedAt = nowMs();
  entry.ack = { correlationId, propagation, bridge, ackedAt: entry.ackedAt };
  recordRuntimeEvent('frame.ack', {
    frameId: entry.frameId,
    correlationId,
    propagationCount: propagation.length,
  });
  if (propagation.length === 0 && String(entry?.frame?.audience || entry?.frame?.capability || entry?.frame?.channelId || '').trim()) {
    recordRouteObservation({
      state: 'observingUnreachable',
      frameId: entry.frameId,
      correlationId,
      failedPredicates: ['zeroPropagation'],
      message: 'frame accepted at edge intake but no eligible route member was selected',
      retryable: true,
    });
  }
  touchRuntime();
  schedulePersist();
  broadcast({ type: 'swarm.edge.ack', frameId: entry.frameId, correlationId, propagation, bridge });
  broadcastSnapshot();
  return { ok: true, result: { frameId: entry.frameId, correlationId, propagation, bridge } };
}

function structuredRejectError(message) {
  const error = message.error && typeof message.error === 'object'
    ? message.error
    : message?.frame?.body?.error && typeof message.frame.body.error === 'object'
      ? message.frame.body.error
      : {};
  const ackReason = String(message?.frame?.ack?.reasonCode || message?.frame?.ack?.reason_code || '').trim();
  const detail = String(message.detail || '').trim();
  return {
    code: String(error.code || message.reasonCode || ackReason || 'gateway.reject').trim(),
    message: String(error.message || message.reason || detail || ackReason || 'frame rejected').trim(),
    retryable: error.retryable !== undefined ? error.retryable === true : message.retryable === true,
  };
}

function handleSwarmEdgeReject(message) {
  const correlationId = String(message?.frame?.correlationId || message.correlationId || message.frameId || '').trim();
  const entry = findQueuedFrame(correlationId);
  if (!entry) return { ok: false, error: 'queued frame not found' };
  if (markQueuedSwarmFrameExpired(entry) || queuedSwarmFrameTerminal(entry)) {
    recordRuntimeEvent('frame.reject.ignored', {
      frameId: entry.frameId,
      correlationId,
      ignoredReason: 'terminalActivation',
      currentStatus: String(entry.status || '').trim(),
    });
    touchRuntime();
    schedulePersist();
    broadcastSnapshot();
    return {
      ok: true,
      result: {
        frameId: entry.frameId,
        correlationId,
        ignored: true,
        status: String(entry.status || '').trim(),
      },
    };
  }
  const error = structuredRejectError(message);
  const policy = normalizeSwarmRetryPolicy(message.retryPolicy || entry.retryPolicy);
  const replayLike = ['replay', 'replayedFrame', 'replayed_frame'].includes(String(error.code || '').trim());
  const preserve = !replayLike && error.retryable !== false && policy.onReject !== 'drop';
  entry.status = preserve ? 'rejected' : 'dropped';
  entry.rejectedAt = nowMs();
  entry.lastError = error;
  entry.retrySuppressed = true;
  const rejection = {
    frameId: entry.frameId,
    correlationId,
    error,
    preserved: preserve,
    retrySuppressed: true,
    rejectedAt: entry.rejectedAt,
  };
  swarmEdge.rejections.push(rejection);
  if (!preserve) {
    clearServiceAdmissionTimeout(entry);
    outboundSwarmFrames.delete(entry.frameId);
  }
  recordRuntimeEvent('frame.reject', {
    frameId: entry.frameId,
    correlationId,
    error,
    preserved: preserve,
    retrySuppressed: true,
  });
  touchRuntime();
  schedulePersist();
  broadcast({ type: 'swarm.edge.reject', rejection: safeClone(rejection) });
  broadcastSnapshot();
  return { ok: true, result: safeClone(rejection) };
}

function serviceRecordService(record) {
  return String(record?.service || record?.role || '').trim().toLowerCase();
}

function serviceRecordServicePk(record) {
  return String(record?.servicePk || record?.service_pk || record?.devicePk || record?.pk || '').trim();
}

function serviceRecordMemberRef(record) {
  return resolvedMemberPkFromCandidates(
    record?.swarmEdge?.memberRef
    , record?.swarmEdge?.member_ref
    , record?.swarm_edge?.memberRef
    , record?.swarm_edge?.member_ref
    , record?.memberRef
    , record?.member_ref
    , record?.serviceMemberRef
    , record?.service_member_ref
    , record?.facts?.swarmEdge?.memberRef
    , record?.facts?.swarm_edge?.member_ref
    , record?.servicePk
    , record?.service_pk
    , record?.devicePk
    , record?.pk
  );
}

function serviceRecordServiceRef(record) {
  return String(record?.serviceRef || record?.service_ref || '').trim()
    || defaultServiceRefForService(serviceRecordService(record), serviceRecordServicePk(record));
}

function serviceRecordHostGatewayPk(record) {
  return String(record?.hostGatewayPk || record?.host_gateway_pk || record?.gatewayPk || record?.gateway_pk || '').trim();
}

function serviceRecordIdentityId(record) {
  const facts = record?.facts && typeof record.facts === 'object' ? record.facts : {};
  return String(
    record?.identityId
    || record?.identity_id
    || record?.ownerIdentityId
    || record?.owner_identity_id
    || facts.identityId
    || facts.identity_id
    || facts.ownerIdentityId
    || facts.owner_identity_id
    || '',
  ).trim();
}

function serviceRecordSurfaceChannel(record) {
  return String(record?.surfaceChannel || record?.surface_channel || '').trim();
}

function serviceRecordAliases(record) {
  const aliases = normalizeArray(record?.aliases || record?.serviceAliases || record?.service_aliases)
    .map((alias) => String(alias || '').trim())
    .filter(Boolean);
  const label = String(record?.deviceLabel || record?.label || record?.serviceLabel || record?.name || '').trim();
  const service = serviceRecordService(record);
  return Array.from(new Set([label, service, ...aliases].filter(Boolean)));
}

function serviceRecordLocation(record) {
  const source = record?.location && typeof record.location === 'object' ? record.location : {};
  const gatewayPk = serviceRecordHostGatewayPk(record) || String(source.gatewayPk || source.gateway_pk || '').trim();
  const label = String(
    source.label
      || record?.hostGatewayLabel
      || record?.host_gateway_label
      || managedState.resourceNames?.[gatewayPk]
      || '',
  ).trim();
  const locationId = String(source.locationId || source.location_id || label || gatewayPk || '').trim();
  if (!locationId && !gatewayPk && !label) return null;
  return {
    locationId,
    label: label || locationId || gatewayPk,
    gatewayPk,
  };
}

function serviceRecordSummary(record) {
  return String(record?.summary || record?.description || '').trim();
}

function serviceRecordHealth(record) {
  const health = record?.health && typeof record.health === 'object' ? record.health : {};
  return safeClone(health);
}

function serviceRecordLegacyPathFallback(record) {
  const fallback = record?.legacyPathFallback || record?.legacy_path_fallback;
  return fallback && typeof fallback === 'object' ? safeClone(fallback) : null;
}

function serviceRecordGatewayAssociationPosture(record) {
  const posture = record?.gatewayAssociationPosture || record?.gateway_association_posture;
  return posture && typeof posture === 'object' ? posture : null;
}

function serviceRecordHostFabricPosture(record) {
  const posture = serviceRecordGatewayAssociationPosture(record);
  if (!posture) return null;
  try {
    const substrateAssociationHandoff = assertSubstrateAssociationHandoff(safeClone(
      posture.substrateAssociationHandoff || posture.substrate_association_handoff,
    ));
    const gatewayAssociationContribution = assertHostFabricMemberContribution(safeClone(
      posture.gatewayAssociationContribution || posture.gateway_association_contribution,
    ));
    const lifecyclePlan = assertLifecyclePlanPosture(safeClone(
      posture.lifecyclePlan || posture.lifecycle_plan,
    ));
    const fulfillmentPlan = assertHostFabricFulfillmentPlan(safeClone(
      posture.fulfillmentPlan || posture.fulfillment_plan,
    ));
    const blockedReasons = uniqueTrimmedStrings([
      ...normalizeArray(substrateAssociationHandoff.blockedReasons),
      ...normalizeArray(gatewayAssociationContribution.blockedReasons),
      ...normalizeArray(lifecyclePlan.blockedReasons),
      ...normalizeArray(fulfillmentPlan.blockedReasons),
      ...normalizeArray(fulfillmentPlan.missingRoleRefs).map((ref) => `missing:${ref}`),
    ]);
    const evidenceRefs = uniqueTrimmedStrings([
      ...normalizeArray(substrateAssociationHandoff.evidenceRefs),
      ...normalizeArray(gatewayAssociationContribution.evidenceRefs),
      ...normalizeArray(lifecyclePlan.evidenceRefs),
      ...normalizeArray(fulfillmentPlan.evidenceRefs),
    ]);
    return {
      state: fulfillmentPlan.state || lifecyclePlan.state || gatewayAssociationContribution.state,
      fabricRef: fulfillmentPlan.fabricRef || gatewayAssociationContribution.fabricRef || substrateAssociationHandoff.fabricRef,
      hostRef: fulfillmentPlan.hostRef || gatewayAssociationContribution.hostRef || substrateAssociationHandoff.hostRef,
      associationHandoffRef: fulfillmentPlan.associationHandoffRef || substrateAssociationHandoff.handoffId,
      gatewayAssociationRefs: normalizeArray(substrateAssociationHandoff.gatewayAssociationRefs),
      memberContributionRefs: normalizeArray(fulfillmentPlan.memberContributionRefs),
      lifecyclePlanRefs: normalizeArray(fulfillmentPlan.lifecyclePlanRefs),
      requiredRoleRefs: normalizeArray(fulfillmentPlan.requiredRoleRefs),
      missingRoleRefs: normalizeArray(fulfillmentPlan.missingRoleRefs),
      blockedReasons,
      evidenceRefs,
      substrateAssociationHandoff,
      gatewayAssociationContribution,
      lifecyclePlan,
      fulfillmentPlan,
    };
  } catch (error) {
    recordRuntimeEvent('runtime.msa.gateway_association.ignored', {
      level: 'warn',
      service: serviceRecordService(record),
      servicePk: serviceRecordServicePk(record),
      hostGatewayPk: serviceRecordHostGatewayPk(record),
      error: { message: String(error?.message || error) },
    });
    return null;
  }
}

function normalizeServiceZoneScope(value) {
  if (!value) return null;
  const source = value && typeof value === 'object' ? value : { zoneId: value };
  const zoneId = String(
    source.zoneId
    || source.zone_id
    || source.zone
    || source.zoneKey
    || source.zone_key
    || source.key
    || '',
  ).trim();
  if (!zoneId || zoneId.startsWith('identity:') || zoneId === 'runtime.local' || zoneId === 'local') return null;
  return {
    zoneId,
    privacy: String(source.privacy || 'rawIds').trim() || 'rawIds',
    ttl: positiveNumber(source.ttl || source.ttlSeconds || source.ttl_seconds, 30),
    maxHops: nonNegativeNumber(source.maxHops ?? source.max_hops, 2),
  };
}

function firstServiceZoneScopeFromList(value) {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const scope = normalizeServiceZoneScope(entry);
    if (scope) return scope;
  }
  return null;
}

function serviceRecordZoneScope(record) {
  if (!record || typeof record !== 'object') return null;
  const facts = record.facts && typeof record.facts === 'object' ? record.facts : {};
  const health = record.health && typeof record.health === 'object' ? record.health : {};
  return normalizeServiceZoneScope(record.zoneScope || record.zone_scope)
    || normalizeServiceZoneScope(facts.zoneScope || facts.zone_scope)
    || normalizeServiceZoneScope(health.zoneScope || health.zone_scope)
    || normalizeServiceZoneScope({
      zoneId: record.zoneId || record.zone_id || record.zoneKey || record.zone_key || record.zone,
      privacy: record.zonePrivacy || record.zone_privacy,
    })
    || normalizeServiceZoneScope({
      zoneId: facts.zoneId || facts.zone_id || facts.zoneKey || facts.zone_key || facts.zone,
      privacy: facts.zonePrivacy || facts.zone_privacy,
    })
    || firstServiceZoneScopeFromList(record.zones)
    || firstServiceZoneScopeFromList(facts.zones)
    || firstServiceZoneScopeFromList(health.zones);
}

function serviceRecordNodeCandidates(record) {
  const facts = record?.facts && typeof record.facts === 'object' ? record.facts : {};
  const health = record?.health && typeof record.health === 'object' ? record.health : {};
  const candidates = [];
  for (const source of [
    record?.nodeDescriptors,
    record?.node_descriptors,
    facts.nodeDescriptors,
    facts.node_descriptors,
    health.nodeDescriptors,
    health.node_descriptors,
    record?.nodes,
    facts.nodes,
    health.nodes,
  ]) {
    for (const node of normalizeArray(source)) {
      candidates.push(node);
    }
  }
  return candidates;
}

function capabilitiesFromNode(node) {
  const direct = normalizeArray(node?.capabilities)
    .map((capability) => String(capability || '').trim())
    .filter(Boolean);
  const fieldCapabilities = normalizeArray(node?.fields)
    .flatMap((field) => normalizeArray(field?.capabilities))
    .map((capability) => String(capability || '').trim())
    .filter(Boolean);
  return Array.from(new Set([...direct, ...fieldCapabilities]));
}

function normalizeServiceNodeDescriptor(node, fallbackZoneScope = null) {
  if (typeof node === 'string') {
    const path = node.trim();
    if (!path) return null;
    return {
      path,
      nodeId: path,
      label: path,
      description: '',
      channelId: '',
      zoneScope: fallbackZoneScope || null,
      capabilities: [],
    };
  }
  if (!node || typeof node !== 'object') return null;
  const path = String(node.path || node.nodePath || node.node_path || node.nodeId || node.node_id || node.label || '').trim();
  const nodeId = String(node.nodeId || node.node_id || path).trim();
  const label = String(node.label || path || nodeId).trim();
  const channelId = String(node.channelId || node.channel_id || node.channel || node.backingChannel || node.backing_channel || '').trim();
  if (!path && !nodeId && !label && !channelId) return null;
  return {
    path: path || nodeId || label || channelId,
    nodeId: nodeId || path || label || channelId,
    label: label || path || nodeId || channelId,
    description: String(node.description || '').trim(),
    channelId,
    zoneScope: normalizeServiceZoneScope(node.zoneScope || node.zone_scope) || fallbackZoneScope || null,
    capabilities: capabilitiesFromNode(node),
  };
}

function serviceRecordNodes(record) {
  const fallbackZoneScope = serviceRecordZoneScope(record);
  const seen = new Set();
  const out = [];
  for (const node of serviceRecordNodeCandidates(record)) {
    const normalized = normalizeServiceNodeDescriptor(node, fallbackZoneScope);
    if (!normalized) continue;
    const key = [normalized.path, normalized.nodeId, normalized.channelId].filter(Boolean).join('|');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(normalized);
  }
  return out;
}

function hostedServiceRecords() {
  const out = [];
  const seen = new Set();
  for (const bucket of Object.values(managedState.applianceSnapshot || {})) {
    for (const record of normalizeArray(bucket)) {
      if (isManagedServiceRecord(record)) {
        const service = serviceRecordService(record);
        const servicePk = serviceRecordServicePk(record);
        const key = [servicePk, service, serviceRecordHostGatewayPk(record)].filter(Boolean).join('|');
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(safeClone(record));
        }
      }
      const hostGatewayPk = String(record?.devicePk || record?.pk || '').trim();
      const hostGatewayLabel = String(record?.deviceLabel || record?.label || '').trim();
      const hostGatewayZoneScope = serviceRecordZoneScope(record);
      for (const hosted of normalizeHostedServices(record?.hostedServices || record?.hosted_services)) {
        const merged = {
          ...hosted,
          hostGatewayPk: serviceRecordHostGatewayPk(hosted) || hostGatewayPk,
          hostGatewayLabel: hosted.hostGatewayLabel || hostGatewayLabel,
          identityId: serviceRecordIdentityId(hosted) || serviceRecordIdentityId(record) || undefined,
          zoneScope: serviceRecordZoneScope(hosted) || hostGatewayZoneScope || undefined,
          gatewayAssociationPosture: serviceRecordGatewayAssociationPosture(hosted)
            || serviceRecordGatewayAssociationPosture(record)
            || undefined,
        };
        const service = serviceRecordService(merged);
        const servicePk = serviceRecordServicePk(merged);
        const key = [servicePk, service, serviceRecordHostGatewayPk(merged)].filter(Boolean).join('|');
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(safeClone(merged));
        }
      }
    }
  }
  return out.filter((record) => serviceRecordService(record) && serviceRecordServicePk(record));
}

function serviceDescriptorFromRecord(record) {
  const surfaceChannel = serviceRecordSurfaceChannel(record);
  return {
    service: serviceRecordService(record),
    servicePk: serviceRecordServicePk(record),
    serviceRef: serviceRecordServiceRef(record),
    serviceMemberRef: serviceRecordMemberRef(record),
    hostGatewayPk: serviceRecordHostGatewayPk(record),
    identityId: serviceRecordIdentityId(record),
    zoneScope: serviceRecordZoneScope(record),
    location: serviceRecordLocation(record),
    aliases: serviceRecordAliases(record),
    surfaceChannel,
    summary: serviceRecordSummary(record),
    health: serviceRecordHealth(record),
    hostFabric: serviceRecordHostFabricPosture(record),
    legacyPathFallback: serviceRecordLegacyPathFallback(record),
    nodes: serviceRecordNodes(record),
  };
}

function serviceRegistryClaimFromDescriptor(descriptor, issuedAt = nowMs()) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const service = String(descriptor.service || '').trim();
  const servicePk = String(descriptor.servicePk || '').trim();
  const hostGatewayPk = String(descriptor.hostGatewayPk || '').trim();
  if (!service || !servicePk || !hostGatewayPk) return null;
  const serviceRef = String(descriptor.serviceRef || `service:${service}:${servicePk}`).trim();
  const zoneScope = normalizeServiceZoneScope(descriptor.zoneScope);
  const scopeRef = zoneScope?.zoneId ? `zone:${zoneScope.zoneId}` : 'scope:runtime-retained-services';
  const channelRefs = uniqueTrimmedStrings([
    descriptor.surfaceChannel,
    ...normalizeArray(descriptor.nodes).map((node) => node?.channelId || node?.backingChannel),
  ]);
  const nodeRefs = uniqueTrimmedStrings(normalizeArray(descriptor.nodes).map((node) => node?.nodeId || node?.path));
  const capabilityRefs = uniqueTrimmedStrings(normalizeArray(descriptor.nodes).flatMap((node) => normalizeArray(node?.capabilities)));
  try {
    return assertServiceRegistryClaim({
      kind: SWARM.RECORD_KIND.SERVICE_REGISTRY_CLAIM,
      claimId: `service-registry-claim:${service}:${servicePk}`,
      schemaVersion: SERVICE_REGISTRY.SCHEMA_VERSION,
      claimKind: SERVICE_REGISTRY.CLAIM_KIND.SERVICE,
      state: SERVICE_REGISTRY.CLAIM_STATE.CLAIMED,
      ownerRef: serviceRef,
      writerRef: `gateway:${hostGatewayPk}`,
      subjectRef: serviceRef,
      scopeRef,
      service,
      servicePk,
      serviceRef,
      memberRef: descriptor.serviceMemberRef || descriptor.routeMemberRef || servicePk,
      hostGatewayPk,
      capabilityRefs,
      channelRefs,
      nodeRefs,
      surfaceRefs: descriptor.surfaceChannel ? [descriptor.surfaceChannel] : [],
      evidenceRefs: uniqueTrimmedStrings([
        descriptor.liveEdgeRoute?.memberRef ? `swarm.directory:${descriptor.liveEdgeRoute.memberRef}` : '',
        descriptor.surfaceChannel ? `projection:${descriptor.surfaceChannel}` : '',
        descriptor.hostFabric?.associationHandoffRef,
        ...normalizeArray(descriptor.hostFabric?.memberContributionRefs),
        ...normalizeArray(descriptor.hostFabric?.lifecyclePlanRefs),
        ...normalizeArray(descriptor.hostFabric?.evidenceRefs),
      ]),
      safeFacts: {
        service,
        surfaceChannel: descriptor.surfaceChannel || '',
        hostFabricState: descriptor.hostFabric?.state || '',
        legacyPathFallbackState: descriptor.legacyPathFallback?.state || '',
      },
      issuedAt,
      expiresAt: issuedAt + 90_000,
    });
  } catch (error) {
    recordRuntimeEvent('service.registry.claim.ignored', {
      level: 'warn',
      service,
      servicePk,
      error: { message: String(error?.message || error) },
    });
    return null;
  }
}

function directoryEntriesForServiceRegistry(issuedAt = nowMs()) {
  const out = [];
  const seen = new Set();
  for (const directory of liveDirectoryPayloads()) {
    for (const entry of normalizeArray(directory.entries)) {
      const memberRef = String(entry?.memberRef || entry?.member_ref || '').trim();
      const channelId = String(entry?.channelId || entry?.channel_id || '').trim();
      const capabilityRef = String(entry?.capabilityRef || entry?.capability || '').trim();
      const serviceRef = String(entry?.serviceRef || entry?.service_ref || '').trim();
      const subjectRef = serviceRef || (memberRef ? `member:${memberRef}` : '');
      if (!subjectRef || !channelId) continue;
      const entryId = String(entry?.entryId || entry?.entry_id || `directory-entry:${memberRef}:${capabilityRef}:${channelId}`).trim();
      if (seen.has(entryId)) continue;
      seen.add(entryId);
      try {
        out.push(assertDirectoryEntry({
          kind: SWARM.RECORD_KIND.DIRECTORY_ENTRY,
          entryId,
          subjectRef,
          source: 'memberRecord',
          ...(capabilityRef ? { capabilityRef } : {}),
          channelId,
          issuedAt: Number(entry?.issuedAt || entry?.issued_at || issuedAt),
        }));
      } catch {
        // Directory entries are an optimization for materialization coverage; invalid
        // edge claims should not block retained service descriptors.
      }
    }
  }
  return out;
}

function serviceRegistryMaterializationFromServices(services, issuedAt = nowMs()) {
  const registryServices = normalizeArray(services).filter((descriptor) => (
    String(descriptor?.service || '').trim()
    && String(descriptor?.servicePk || '').trim()
    && String(descriptor?.hostGatewayPk || '').trim()
    && String(descriptor?.surfaceChannel || '').trim()
  ));
  const claims = registryServices
    .map((descriptor) => serviceRegistryClaimFromDescriptor(descriptor, issuedAt))
    .filter(Boolean);
  const entries = directoryEntriesForServiceRegistry(issuedAt);
  const registry = {
    kind: SWARM.RECORD_KIND.SERVICE_REGISTRY_MATERIALIZATION,
    registryId: 'service-registry:runtime',
    schemaVersion: SERVICE_REGISTRY.SCHEMA_VERSION,
    scopeRef: 'runtime:local',
    state: claims.length || entries.length
      ? SERVICE_REGISTRY.MATERIALIZATION_STATE.READY
      : SERVICE_REGISTRY.MATERIALIZATION_STATE.PARTIAL,
    revision: issuedAt,
    claimRefs: claims.map((claim) => claim.claimId),
    participantRefs: uniqueTrimmedStrings(claims.map((claim) => claim.writerRef)),
    serviceRefs: uniqueTrimmedStrings(claims.map((claim) => claim.serviceRef)),
    services: registryServices,
    entries,
    coverage: {
      materializedCount: claims.length,
      targetCount: claims.length,
      completionRatio: 1,
      syncState: PROJECTION.SYNC_STATE.COMPLETE_ENOUGH,
    },
    freshness: { state: PROJECTION.FRESHNESS.FRESH, updatedAt: issuedAt },
    issuedAt,
  };
  return assertServiceRegistryMaterialization(registry);
}

function surfaceFromProjection(projection) {
  const surface = projection?.payload?.surface && typeof projection.payload.surface === 'object'
    ? projection.payload.surface
    : projection?.surface && typeof projection.surface === 'object'
      ? projection.surface
      : null;
  return surface ? safeClone(surface) : null;
}

function retainedSurfaceForDescriptor(descriptor) {
  const surfaceChannel = String(descriptor?.surfaceChannel || '').trim();
  const servicePk = String(descriptor?.servicePk || '').trim();
  const service = String(descriptor?.service || '').trim();
  if (!surfaceChannel) return null;
  for (const projection of retainedProjections.values()) {
    if (String(projection?.channelId || '').trim() !== surfaceChannel) continue;
    if (servicePk && String(projection?.servicePk || projection?.service_pk || '').trim() !== servicePk) continue;
    if (!servicePk && service && String(projection?.service || '').trim() !== service) continue;
    const surface = surfaceFromProjection(projection);
    if (surface) return surface;
  }
  return null;
}

function serviceCatalog() {
  const updatedAt = runtimeUpdatedAt || nowMs();
  const services = hostedServiceRecords().map((record) => {
    const descriptor = serviceDescriptorFromRecord(record);
    const surface = retainedSurfaceForDescriptor(descriptor);
    return {
      ...descriptor,
      summary: String(surface?.summary || descriptor.summary || '').trim(),
      health: surface?.health && typeof surface.health === 'object' ? safeClone(surface.health) : descriptor.health,
      legacyPathFallback: descriptor.legacyPathFallback || null,
      healthNode: String(surface?.healthNode || '').trim(),
      nodes: Array.isArray(surface?.nodes)
        ? surface.nodes.map((node) => ({
            path: String(node?.path || node?.nodePath || node?.nodeId || '').trim(),
            nodeId: String(node?.nodeId || '').trim(),
            label: String(node?.label || node?.path || node?.nodeId || '').trim(),
            description: String(node?.description || '').trim(),
            channelId: String(node?.channelId || node?.channel || node?.backingChannel || '').trim(),
            zoneScope: normalizeServiceZoneScope(node?.zoneScope || node?.zone_scope) || descriptor.zoneScope || null,
            capabilities: capabilitiesFromNode(node),
          }))
        : descriptor.nodes
            .map((node) => normalizeServiceNodeDescriptor(node, descriptor.zoneScope || null))
            .filter(Boolean),
      surface: surface || null,
    };
  });
  return {
    updatedAt,
    services,
    registry: serviceRegistryMaterializationFromServices(services, updatedAt),
  };
}

function pushValidatedRecord(out, seen, candidate, idKeys, validator, eventKind) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
  try {
    const record = validator(safeClone(candidate));
    const id = idKeys
      .map((key) => String(record?.[key] || '').trim())
      .find(Boolean)
      || JSON.stringify(record);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(record);
    }
  } catch (error) {
    recordRuntimeEvent(eventKind, {
      level: 'warn',
      error: { message: String(error?.message || error) },
    });
  }
}

function runtimeHostFabricRecordsFromCatalog(catalog) {
  const fulfillmentPlans = [];
  const memberContributions = [];
  const lifecyclePlans = [];
  const seenPlans = new Set();
  const seenContributions = new Set();
  const seenLifecyclePlans = new Set();
  for (const service of normalizeArray(catalog?.services)) {
    const fabric = service?.hostFabric && typeof service.hostFabric === 'object' ? service.hostFabric : {};
    pushValidatedRecord(
      fulfillmentPlans,
      seenPlans,
      fabric.fulfillmentPlan,
      ['planId'],
      assertHostFabricFulfillmentPlan,
      'runtime.target.fabric_plan.ignored',
    );
    pushValidatedRecord(
      memberContributions,
      seenContributions,
      fabric.gatewayAssociationContribution,
      ['contributionId'],
      assertHostFabricMemberContribution,
      'runtime.target.fabric_contribution.ignored',
    );
    pushValidatedRecord(
      lifecyclePlans,
      seenLifecyclePlans,
      fabric.lifecyclePlan,
      ['lifecyclePlanId'],
      assertLifecyclePlanPosture,
      'runtime.target.lifecycle_plan.ignored',
    );
  }
  return { fulfillmentPlans, memberContributions, lifecyclePlans };
}

function targetSlot(slotRef, state, platformFitState, candidateFulfillmentRefs = [], extra = {}) {
  const selectedFulfillmentRef = String(extra.selectedFulfillmentRef || candidateFulfillmentRefs[0] || '').trim();
  return {
    slotRef,
    state,
    platformFitState,
    candidateFulfillmentRefs: uniqueTrimmedStrings(candidateFulfillmentRefs),
    ...(selectedFulfillmentRef ? { selectedFulfillmentRef } : {}),
    sourceRefs: uniqueTrimmedStrings(extra.sourceRefs || []),
    buildRefs: uniqueTrimmedStrings(extra.buildRefs || []),
    platformRefs: uniqueTrimmedStrings(extra.platformRefs || []),
    adapterRefs: uniqueTrimmedStrings(extra.adapterRefs || []),
    proofRequirementRefs: uniqueTrimmedStrings(extra.proofRequirementRefs || []),
    proofRefs: uniqueTrimmedStrings(extra.proofRefs || []),
    evidenceRefs: uniqueTrimmedStrings(extra.evidenceRefs || []),
    blockedReasons: uniqueTrimmedStrings(extra.blockedReasons || []),
    safeFacts: extra.safeFacts && typeof extra.safeFacts === 'object' ? safeClone(extra.safeFacts) : undefined,
  };
}

function runtimeContractTargetSource(catalog, sampledAt = nowMs()) {
  const services = normalizeArray(catalog?.services);
  const fabricRecords = runtimeHostFabricRecordsFromCatalog(catalog);
  const serviceRefs = uniqueTrimmedStrings(services.map((service) => service?.serviceRef));
  const serviceFulfillmentRefs = serviceRefs.map((ref) => `fulfillment:${ref}`);
  const gatewayFulfillmentRefs = uniqueTrimmedStrings(
    fabricRecords.memberContributions
      .filter((contribution) => contribution.role === FABRIC.MEMBER_ROLE.GATEWAY_ASSOCIATION)
      .map((contribution) => contribution.contributionId),
  );
  const runtimeRef = `runtime:${RUNTIME_WORKER_BUILD_ID}`;
  const targetRef = 'contract-target:desktop-windows-dev:msa-transition';
  const registryRef = 'contract-target-registry:desktop-windows-dev:msa-transition';
  const missingSlotRefs = ['slot:native-client'];
  const slotPostures = [
    targetSlot(
      'slot:runtime',
      FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE,
      FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.COMPATIBLE,
      [runtimeRef],
      {
        platformRefs: ['platform:browser-shared-worker'],
        adapterRefs: ['adapter:runtime-shared-worker'],
        evidenceRefs: [`evidence:${runtimeRef}`],
      },
    ),
    targetSlot(
      'slot:surface',
      FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE,
      FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.COMPATIBLE,
      ['surface:first-party-browser'],
      {
        platformRefs: ['platform:browser-window'],
        adapterRefs: ['adapter:runtime-surface-client'],
        evidenceRefs: ['evidence:surface:runtime-attach'],
      },
    ),
    targetSlot(
      'slot:gateway-association',
      gatewayFulfillmentRefs.length
        ? FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE
        : FABRIC.CONTRACT_TARGET_SLOT_STATE.DEGRADED,
      gatewayFulfillmentRefs.length
        ? FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.COMPATIBLE
        : FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.DEGRADED,
      gatewayFulfillmentRefs,
      {
        evidenceRefs: fabricRecords.memberContributions.flatMap((contribution) => normalizeArray(contribution.evidenceRefs)),
        blockedReasons: gatewayFulfillmentRefs.length ? [] : ['gatewayAssociationContributionMissing'],
      },
    ),
    targetSlot(
      'slot:service-catalog',
      serviceFulfillmentRefs.length
        ? FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE
        : FABRIC.CONTRACT_TARGET_SLOT_STATE.DEGRADED,
      serviceFulfillmentRefs.length
        ? FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.COMPATIBLE
        : FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.DEGRADED,
      serviceFulfillmentRefs,
      {
        sourceRefs: ['projection:swarm.directory', 'projection:retained.services'],
        evidenceRefs: ['evidence:runtime:service-catalog'],
        blockedReasons: serviceFulfillmentRefs.length ? [] : ['serviceCatalogEmpty'],
      },
    ),
    targetSlot(
      'slot:native-client',
      FABRIC.CONTRACT_TARGET_SLOT_STATE.MISSING,
      FABRIC.CONTRACT_TARGET_PLATFORM_FIT_STATE.UNKNOWN,
      [],
      {
        blockedReasons: ['nativeClientNotPresentOnDesktopDevTarget'],
      },
    ),
  ];
  const degradedSlotRefs = slotPostures
    .filter((slot) => slot.state === FABRIC.CONTRACT_TARGET_SLOT_STATE.DEGRADED)
    .map((slot) => slot.slotRef);
  const blockedReasons = uniqueTrimmedStrings([
    ...slotPostures.flatMap((slot) => normalizeArray(slot.blockedReasons)),
  ]);
  const target = assertContractTarget({
    kind: SWARM.RECORD_KIND.CONTRACT_TARGET,
    targetRef,
    contractRef: 'app:constitution-runtime-target@msa-transition',
    profileRef: 'target-profile:desktop-dev',
    platformRef: 'platform:windows-desktop',
    state: missingSlotRefs.length || degradedSlotRefs.length
      ? FABRIC.CONTRACT_TARGET_STATE.DEGRADED
      : FABRIC.CONTRACT_TARGET_STATE.READY,
    compatibilityState: missingSlotRefs.length || degradedSlotRefs.length
      ? FABRIC.CONTRACT_TARGET_COMPATIBILITY_STATE.DEGRADED
      : FABRIC.CONTRACT_TARGET_COMPATIBILITY_STATE.COMPATIBLE,
    hostRef: 'host:local-workstation',
    substrateRef: 'substrate:desktop-windows',
    modifierRefs: ['modifier:dev'],
    branchRefs: ['branch:0x/msa-transition'],
    subbranchRefs: ['subbranch:runtime-target-source'],
    capabilitySlotRefs: slotPostures.map((slot) => slot.slotRef),
    adapterPackRef: 'adapter-pack:browser-runtime-local',
    adapterRefs: ['adapter:runtime-shared-worker', 'adapter:runtime-surface-client'],
    missingSlotRefs,
    degradedSlotRefs,
    proofProfileRefs: ['proof-profile:surface-landscape'],
    proofRefs: [],
    compatibilityRefs: [`compat:${RUNTIME_WORKER_BUILD_ID}`],
    evidenceRefs: ['evidence:runtime:target-source', `evidence:${runtimeRef}`],
    blockedReasons,
    targetAudience: 'operator',
    safeFacts: {
      runtimeBuildId: RUNTIME_WORKER_BUILD_ID,
      source: 'runtime.snapshot',
      serviceCount: services.length,
    },
    issuedAt: sampledAt,
    expiresAt: sampledAt + 60_000,
  });
  const registry = assertContractTargetRegistryPosture({
    kind: SWARM.RECORD_KIND.CONTRACT_TARGET_REGISTRY_POSTURE,
    registryRef,
    targetRef,
    contractRef: target.contractRef,
    state: missingSlotRefs.length || degradedSlotRefs.length
      ? FABRIC.CONTRACT_TARGET_REGISTRY_STATE.DEGRADED
      : FABRIC.CONTRACT_TARGET_REGISTRY_STATE.READY,
    slotPostures,
    candidateFulfillmentRefs: uniqueTrimmedStrings([
      runtimeRef,
      'surface:first-party-browser',
      ...gatewayFulfillmentRefs,
      ...serviceFulfillmentRefs,
    ]),
    sourceRefs: ['projection:swarm.directory', 'projection:retained.services'],
    buildRefs: [],
    adapterRefs: target.adapterRefs,
    proofRequirementRefs: ['proof-requirement:surface-landscape'],
    proofRefs: [],
    evidenceRefs: ['evidence:runtime:target-registry', ...target.evidenceRefs],
    blockedReasons,
    safeFacts: {
      runtimeBuildId: RUNTIME_WORKER_BUILD_ID,
      source: 'runtime.snapshot',
      serviceCount: services.length,
    },
    observedAt: sampledAt,
    expiresAt: sampledAt + 60_000,
  });
  return {
    kind: 'runtime.contract-target.source',
    state: registry.state,
    targetRef,
    registryRef,
    contractTargets: [target],
    targetRegistryPostures: [registry],
    hostFabricFulfillmentPlans: fabricRecords.fulfillmentPlans,
    hostFabricContributions: fabricRecords.memberContributions,
    lifecyclePlans: fabricRecords.lifecyclePlans,
    blockedReasons,
    observedAt: sampledAt,
  };
}

function liveDirectoryPayloads() {
  const out = [];
  for (const projection of retainedProjections.values()) {
    const payload = projection?.payload && typeof projection.payload === 'object' ? projection.payload : {};
    const directory = payload.directory && typeof payload.directory === 'object'
      ? payload.directory
      : payload.state?.directory && typeof payload.state.directory === 'object'
        ? payload.state.directory
        : null;
    if (directory) out.push(directory);
  }
  return out;
}

function servicePkFromServiceRef(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('service:')) return '';
  const raw = text.slice('service:'.length);
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : raw;
}

function resolvedMemberPkFromRef(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return assertResolvedMemberRef(text);
  } catch {
    const servicePk = servicePkFromServiceRef(text);
    if (servicePk) {
      try {
        return assertResolvedMemberRef(servicePk);
      } catch {
        return '';
      }
    }
    return '';
  }
}

function resolvedMemberPkFromCandidates(...values) {
  for (const value of values) {
    const resolved = resolvedMemberPkFromRef(value);
    if (resolved) return resolved;
  }
  return '';
}

function defaultServiceRefForPk(value) {
  const pk = String(value || '').trim();
  return pk ? `service:${pk}` : '';
}

function defaultServiceRefForService(service, value) {
  const pk = String(value || '').trim();
  const serviceId = String(service || '').trim().toLowerCase();
  if (!pk) return '';
  return serviceId ? `service:${serviceId}:${pk}` : defaultServiceRefForPk(pk);
}

function serviceRefMatches(value, servicePk) {
  const serviceRef = String(value || '').trim();
  const pk = String(servicePk || '').trim();
  return Boolean(serviceRef && pk && (
    serviceRef === pk
    || serviceRef === `service:${pk}`
    || servicePkFromServiceRef(serviceRef) === pk
  ));
}

function liveEdgeRouteForService({ servicePk = '', service = '', capability = '', channelId = '' } = {}) {
  const targetServicePk = String(servicePk || '').trim();
  const targetService = String(service || '').trim().toLowerCase();
  const targetCapability = String(capability || '').trim();
  const targetChannel = String(channelId || '').trim();
  let best = null;
  const scoreCandidate = ({ serviceRef = '', servicePk = '', service = '' } = {}) => {
    const candidateServiceRef = String(serviceRef || '').trim();
    const candidateServicePk = String(servicePk || '').trim() || servicePkFromServiceRef(candidateServiceRef);
    const candidateService = String(service || '').trim().toLowerCase();
    let score = 0;
    if (targetServicePk && (candidateServicePk === targetServicePk || serviceRefMatches(candidateServiceRef, targetServicePk))) score += 100;
    if (targetService && candidateService === targetService) score += 40;
    if (candidateServicePk || candidateServiceRef || candidateService) score += 10;
    return score;
  };
  for (const directory of liveDirectoryPayloads()) {
    const advertisements = normalizeArray(directory.advertisements);
    const entries = normalizeArray(directory.entries);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const entryCapability = String(entry.capability || '').trim();
      const entryChannel = String(entry.channelId || entry.channel_id || '').trim();
      if (targetCapability && entryCapability !== targetCapability) continue;
      if (targetChannel && entryChannel !== targetChannel) continue;
      const advertisement = advertisements.find((ad) => {
        if (!ad || typeof ad !== 'object') return false;
        const adMember = String(ad.memberRef || ad.member_ref || '').trim();
        const adCapability = String(ad.capability || '').trim();
        return adMember === String(entry.memberRef || entry.member_ref || '').trim()
          && (!entryCapability || adCapability === entryCapability);
      }) || null;
      const serviceRef = String(entry.serviceRef || entry.service_ref || advertisement?.serviceRef || advertisement?.service_ref || '').trim();
      const entryServicePk = String(entry.servicePk || entry.service_pk || advertisement?.servicePk || advertisement?.service_pk || '').trim();
      const inferredServicePk = entryServicePk || servicePkFromServiceRef(serviceRef);
      const entryChannelLower = entryChannel.toLowerCase();
      const channelImpliesService = Boolean(targetService && entryChannelLower && (
        entryChannelLower === targetService
        || entryChannelLower.startsWith(`${targetService}.`)
      ));
      const entryService = String(entry.service || entry.service_id || advertisement?.service || advertisement?.service_id || '').trim().toLowerCase();
      const hasServiceIdentity = Boolean(inferredServicePk || serviceRef || entryService);
      if (targetServicePk && hasServiceIdentity && inferredServicePk !== targetServicePk && !serviceRefMatches(serviceRef, targetServicePk)) continue;
      if (targetServicePk && !hasServiceIdentity && !channelImpliesService) continue;
      const serviceMatches = !targetService
        || entryService === targetService
        || serviceRef.toLowerCase().includes(targetService)
        || channelImpliesService;
      if (!targetServicePk && !serviceMatches) continue;
      const zoneScope = normalizeServiceZoneScope(entry.zoneScope || entry.zone_scope || advertisement?.zoneScope || advertisement?.zone_scope);
      const route = {
        memberRef: String(entry.memberRef || entry.member_ref || serviceRef || '').trim(),
        servicePk: targetServicePk || inferredServicePk,
        serviceRef,
        channelId: entryChannel,
        capability: entryCapability,
        zoneScope,
        score: scoreCandidate({ serviceRef, servicePk: inferredServicePk, service: entryService }),
      };
      if (!best || route.score > best.score) best = route;
    }
  }
  if (!best) return null;
  const { score, ...route } = best;
  return route;
}

function mergeLiveEdgeRouteDescriptor(descriptor, { capability = '', channelId = '' } = {}) {
  if (!descriptor || typeof descriptor !== 'object') return descriptor;
  const liveRoute = liveEdgeRouteForService({
    servicePk: descriptor.servicePk,
    service: descriptor.service,
    capability,
    channelId,
  });
  if (!liveRoute) return descriptor;
  const selectedNode = descriptor.selectedNode && typeof descriptor.selectedNode === 'object'
    ? {
        ...descriptor.selectedNode,
        channelId: descriptor.selectedNode.channelId || liveRoute.channelId,
        zoneScope: descriptor.selectedNode.zoneScope || liveRoute.zoneScope || null,
      }
    : null;
  return {
    ...descriptor,
    servicePk: descriptor.servicePk || liveRoute.servicePk,
    serviceRef: descriptor.serviceRef || liveRoute.serviceRef,
    serviceMemberRef: liveRoute.memberRef || descriptor.serviceMemberRef,
    routeMemberRef: liveRoute.memberRef || descriptor.routeMemberRef,
    zoneScope: descriptor.zoneScope || liveRoute.zoneScope || null,
    selectedNode,
    liveEdgeRoute: liveRoute,
  };
}

function surfaceNodeMatches(node, nodePath) {
  const target = String(nodePath || '').trim().toLowerCase();
  if (!target) return false;
  const candidates = [
    node?.path,
    node?.nodePath,
    node?.nodeId,
    node?.label,
    ...(Array.isArray(node?.aliases) ? node.aliases : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return candidates.includes(target);
}

function serviceNodeForPolicy(policy) {
  const service = String(policy?.service || '').trim().toLowerCase();
  const nodePath = String(policy?.nodePath || policy?.node || '').trim();
  if (!service || !nodePath) return null;
  for (const record of hostedServiceRecords()) {
    if (serviceRecordService(record) !== service) continue;
    const descriptor = serviceDescriptorFromRecord(record);
    const surface = retainedSurfaceForDescriptor(descriptor);
    const node = normalizeArray(surface?.nodes).find((candidate) => surfaceNodeMatches(candidate, nodePath));
    if (node) return { descriptor, surface, node };
  }
  return null;
}

function projectionNodePath(projection) {
  const direct = String(projection?.nodePath || projection?.node || projection?.payload?.nodePath || '').trim();
  if (direct) return direct;
  const channelId = String(projection?.channelId || '').trim();
  const servicePk = String(projection?.servicePk || projection?.service_pk || '').trim();
  const service = String(projection?.service || '').trim().toLowerCase();
  if (!channelId) return '';
  for (const record of hostedServiceRecords()) {
    const descriptor = serviceDescriptorFromRecord(record);
    if (servicePk && descriptor.servicePk !== servicePk) continue;
    if (!servicePk && service && descriptor.service !== service) continue;
    const surface = retainedSurfaceForDescriptor(descriptor);
    const node = normalizeArray(surface?.nodes).find((candidate) => String(candidate?.backingChannel || '').trim() === channelId);
    if (node) return String(node.path || node.nodePath || node.nodeId || '').trim();
  }
  return '';
}

function nodeProjectionForRequest(message) {
  const service = String(message.service || message?.payload?.service || '').trim().toLowerCase();
  const nodePath = String(message.nodePath || message?.payload?.nodePath || message.node || message?.payload?.node || '').trim();
  const servicePk = String(message.servicePk || message?.payload?.servicePk || '').trim();
  if (!service || !nodePath) return null;
  for (const record of hostedServiceRecords()) {
    const descriptor = serviceDescriptorFromRecord(record);
    if (descriptor.service !== service) continue;
    if (servicePk && descriptor.servicePk !== servicePk) continue;
    const surface = retainedSurfaceForDescriptor(descriptor);
    const node = normalizeArray(surface?.nodes).find((candidate) => surfaceNodeMatches(candidate, nodePath));
    const backingChannel = String(node?.backingChannel || '').trim();
    if (!backingChannel) continue;
    for (const projection of retainedProjections.values()) {
      if (String(projection?.channelId || '').trim() !== backingChannel) continue;
      if (descriptor.servicePk && String(projection?.servicePk || projection?.service_pk || '').trim() !== descriptor.servicePk) continue;
      return safeClone(projection);
    }
  }
  return null;
}

function projectionStoreKey(projection) {
  const servicePk = String(projection?.servicePk || projection?.service_pk || '').trim();
  const service = String(projection?.service || '').trim();
  const channelId = String(projection?.channelId || '').trim();
  const policyId = projectionPolicyId(projection);
  return [servicePk || service, channelId, policyId].filter(Boolean).join('|');
}

function projectionPolicyId(projection) {
  const policy = normalizeObject(projection?.payload?.policy || projection?.scope);
  return String(projection?.policyId || policy.policyId || 'default').trim();
}

function projectionPayloadCount(projection) {
  const payload = projection?.payload;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.events)) return payload.events.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  return 0;
}

function projectionReplacesEventSet(projection) {
  return Array.isArray(projection?.payload?.events)
    && Boolean(projection?.payload?.policy || projection?.scope || projection?.payload?.coverage);
}

function projectionEventArray(projection) {
  const events = projection?.payload?.events;
  return Array.isArray(events) ? events : [];
}

function projectionEventKey(event) {
  const direct = String(event?.eventId || event?.event_id || event?.logEventId || event?.id || '').trim();
  if (direct) return `id:${direct}`;
  const cursor = String(event?.cursor?.value || event?.cursor || '').trim();
  if (cursor) return `cursor:${cursor}`;
  return `shape:${stableJson({
    occurredAt: event?.occurredAt || event?.occurred_at || event?.ts || '',
    severity: event?.severity || '',
    category: event?.category || '',
    outcome: event?.outcome || '',
    producer: event?.producer || '',
    subject: event?.subject || null,
    resource: event?.resource || null,
    correlation: event?.correlation || null,
    tags: event?.tags || [],
    safeFacts: event?.safeFacts || event?.safe_facts || {},
  })}`;
}

function projectionEventTimeSeconds(event) {
  const raw = Number(event?.occurredAt || event?.occurred_at || event?.ts || event?.timestamp || 0);
  if (Number.isFinite(raw) && raw > 0) return raw > 9_999_999_999 ? Math.floor(raw / 1000) : raw;
  const parsed = Date.parse(String(event?.occurredAt || event?.occurred_at || ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : 0;
}

function mergeProjectionEvents(existingEvents, nextEvents) {
  const byKey = new Map();
  for (const event of Array.isArray(existingEvents) ? existingEvents : []) {
    const key = projectionEventKey(event);
    if (key) byKey.set(key, event);
  }
  for (const event of Array.isArray(nextEvents) ? nextEvents : []) {
    const key = projectionEventKey(event);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing && typeof existing === 'object'
      ? { ...existing, ...event }
      : event);
  }
  return Array.from(byKey.values()).sort((left, right) => projectionEventTimeSeconds(right) - projectionEventTimeSeconds(left));
}

function mergeProjectionRecord(existing, next) {
  if (!existing || typeof existing !== 'object') return next;
  if (!next || typeof next !== 'object') return existing;
  const existingChannel = String(existing?.channelId || '').trim();
  const nextChannel = String(next?.channelId || '').trim();
  const sameChannel = existingChannel && existingChannel === nextChannel;
  const existingServicePk = String(existing?.servicePk || existing?.service_pk || '').trim();
  const nextServicePk = String(next?.servicePk || next?.service_pk || '').trim();
  const existingService = String(existing?.service || '').trim();
  const nextService = String(next?.service || '').trim();
  const sameService = (existingServicePk || existingService) === (nextServicePk || nextService);
  if (!sameChannel || !sameService) return next;
  const merged = {
    ...existing,
    ...next,
    payload: {
      ...(existing?.payload && typeof existing.payload === 'object' ? existing.payload : {}),
      ...(next?.payload && typeof next.payload === 'object' ? next.payload : {}),
    },
    safeFacts: {
      ...(existing?.safeFacts && typeof existing.safeFacts === 'object' ? existing.safeFacts : {}),
      ...(next?.safeFacts && typeof next.safeFacts === 'object' ? next.safeFacts : {}),
    },
  };
  const nextEvents = projectionEventArray(next);
  const replacesEventSet = projectionReplacesEventSet(next);
  const mergedEvents = replacesEventSet
    ? nextEvents.slice().sort((left, right) => projectionEventTimeSeconds(right) - projectionEventTimeSeconds(left))
    : mergeProjectionEvents(projectionEventArray(existing), nextEvents);
  if (mergedEvents.length) {
    const existingCoverage = existing?.payload?.coverage && typeof existing.payload.coverage === 'object' ? existing.payload.coverage : {};
    const nextCoverage = next?.payload?.coverage && typeof next.payload.coverage === 'object' ? next.payload.coverage : {};
    const targetCount = Math.max(
      replacesEventSet ? 0 : Number(existingCoverage.targetCount || 0),
      Number(nextCoverage.targetCount || 0),
      mergedEvents.length,
    );
    const completionRatio = targetCount > 0 ? Math.min(1, mergedEvents.length / targetCount) : 1;
    merged.payload = {
      ...merged.payload,
      events: mergedEvents,
      coverage: {
        ...existingCoverage,
        ...nextCoverage,
        materializedCount: mergedEvents.length,
        targetCount,
        completionRatio,
        syncState: completionRatio >= 1 ? 'completeEnough' : String(nextCoverage.syncState || existingCoverage.syncState || 'syncing'),
      },
    };
  }
  return merged;
}

function projectionSemanticShape(projection) {
  const clone = projection && typeof projection === 'object' ? safeClone(projection) : {};
  delete clone.retainedAt;
  delete clone.requestId;
  if (clone.cursor && typeof clone.cursor === 'object') delete clone.cursor.updatedAt;
  if (clone.freshness && typeof clone.freshness === 'object') {
    delete clone.freshness.updatedAt;
    delete clone.freshness.staleAfter;
  }
  return clone;
}

function projectionSemanticallyEqual(left, right) {
  return stableJson(projectionSemanticShape(left)) === stableJson(projectionSemanticShape(right));
}

function projectionCoverage(projection) {
  const coverage = projection?.payload?.coverage && typeof projection.payload.coverage === 'object'
    ? projection.payload.coverage
    : {};
  const payloadCount = projectionPayloadCount(projection);
  const coveredCount = Number(coverage.materializedCount);
  const materializedCount = payloadCount > 0
    ? payloadCount
    : (Number.isFinite(coveredCount) ? Math.max(0, coveredCount) : 0);
  const targetCount = Math.max(Number(coverage.targetCount || 0), materializedCount);
  const completionRatio = targetCount > 0
    ? Math.min(1, materializedCount / targetCount)
    : 1;
  return {
    ...safeClone(coverage),
    materializedCount,
    targetCount,
    completionRatio,
    syncState: String(coverage.syncState || (completionRatio >= 1 ? 'completeEnough' : 'syncing')),
  };
}

function projectionFreshness(projection) {
  const freshness = projection?.freshness && typeof projection.freshness === 'object' ? projection.freshness : {};
  return {
    state: String(freshness.state || 'fresh'),
    updatedAt: Number(freshness.updatedAt || projection?.retainedAt || nowMs()),
    ...(freshness.staleAfter ? { staleAfter: Number(freshness.staleAfter) } : {}),
    ...(freshness.reason ? { reason: String(freshness.reason) } : {}),
  };
}

function projectionObserverUpdate(projection, changedCount) {
  return {
    projectionKey: projectionStoreKey(projection),
    changedCount: Math.max(0, Number(changedCount || 0)),
    coverage: projectionCoverage(projection),
    freshness: projectionFreshness(projection),
  };
}

function randomOpaqueId(prefix) {
  try {
    const bytes = new Uint8Array(12);
    self.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${token}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function projectionPolicyStoreKey(policy) {
  return [
    String(policy?.service || '').trim(),
    String(policy?.nodePath || policy?.node || policy?.channelId || '').trim(),
    String(policy?.policyId || '').trim(),
  ].filter(Boolean).join('|');
}

function projectionPolicyForChannel(policy, channelId) {
  const targetChannelId = String(channelId || policy?.channelId || '').trim();
  const basePolicyId = String(policy?.policyId || 'default').trim() || 'default';
  const sourceChannelId = String(policy?.channelId || '').trim();
  return {
    ...safeClone(policy),
    service: String(policy?.service || 'logging').trim() || 'logging',
    channelId: targetChannelId,
    policyId: !sourceChannelId || targetChannelId === sourceChannelId
      ? basePolicyId
      : `${basePolicyId}.${targetChannelId.replace(/[^a-z0-9]+/gi, '.')}`,
  };
}

function normalizeProjectionPolicyForRuntime(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const nodePath = String(raw.nodePath || raw.node || '').trim();
  const service = String(raw.service || 'logging').trim() || 'logging';
  const resolved = raw.channelId ? null : serviceNodeForPolicy({ service, nodePath });
  const localLoggingChannel = service === 'logging' && nodePath
    ? runtimeLoggingProjectionChannelForNodePath(nodePath)
    : '';
  const channelId = String(raw.channelId || resolved?.node?.backingChannel || localLoggingChannel || '').trim();
  const policy = {
    ...safeClone(raw),
    service,
    ...(nodePath ? { nodePath } : {}),
    ...(channelId ? { channelId } : {}),
    policyId: String(raw.policyId || DEFAULT_LOGGING_POLICY_ID).trim() || DEFAULT_LOGGING_POLICY_ID,
    scope: raw.scope && typeof raw.scope === 'object' && !Array.isArray(raw.scope) ? safeClone(raw.scope) : {},
    syncDepthTarget: raw.syncDepthTarget && typeof raw.syncDepthTarget === 'object' && !Array.isArray(raw.syncDepthTarget)
      ? safeClone(raw.syncDepthTarget)
      : { mode: 'policyComplete', targetCount: DEFAULT_LOGGING_SYNC_TARGET_COUNT },
    retentionTarget: raw.retentionTarget && typeof raw.retentionTarget === 'object' && !Array.isArray(raw.retentionTarget)
      ? safeClone(raw.retentionTarget)
      : {},
  };
  if (policy.channelId) assertProjectionPolicy(policy);
  if (!policy.channelId && !policy.nodePath) throw new Error('projection policy missing node path');
  return policy;
}

function syncTargetCountForPolicy(policy) {
  const target = Number(policy?.syncDepthTarget?.targetCount || DEFAULT_LOGGING_SYNC_TARGET_COUNT);
  return Number.isFinite(target) && target > 0 ? Math.min(target, 5_000) : DEFAULT_LOGGING_SYNC_TARGET_COUNT;
}

function projectionForPolicyChannel(policy, channelId) {
  const channelPolicy = projectionPolicyForChannel(policy, channelId);
  const service = String(channelPolicy.service || '').trim();
  const policyId = String(channelPolicy.policyId || '').trim();
  const directKey = [service, String(channelPolicy.channelId || '').trim(), policyId].filter(Boolean).join('|');
  if (retainedProjections.has(directKey)) return retainedProjections.get(directKey);
  let fallback = null;
  for (const projection of retainedProjections.values()) {
    if (String(projection?.service || '').trim() !== service) continue;
    if (String(projection?.channelId || '').trim() !== String(channelPolicy.channelId || '').trim()) continue;
    if (projectionPolicyId(projection) === policyId) return projection;
    if (!fallback || Number(projection?.retainedAt || 0) > Number(fallback?.retainedAt || 0)) {
      fallback = projection;
    }
  }
  return fallback;
}

function projectionNeedsRuntimeSync(projection, policy, channelId) {
  if (!projection) return true;
  const freshness = projectionFreshness(projection);
  const staleAfter = Number(freshness.staleAfter || 0);
  const staleAfterMs = staleAfter > 0 && staleAfter < 9_999_999_999 ? staleAfter * 1000 : staleAfter;
  if (freshness.state === 'missing' || freshness.state === 'error') return true;
  if (staleAfterMs && staleAfterMs < nowMs()) return true;
  const nodePath = String(policy?.nodePath || '').trim().toLowerCase();
  if (nodePath !== 'events' && !Array.isArray(projection?.payload?.events)) return false;
  const coverage = projectionCoverage(projection);
  const targetCount = syncTargetCountForPolicy(policy);
  return coverage.materializedCount < Math.min(targetCount, Number(coverage.targetCount || targetCount));
}

function syncChannelsForPolicy(policy) {
  const explicit = String(policy?.channelId || '').trim();
  if (explicit) return [explicit];
  const resolved = serviceNodeForPolicy(policy);
  const backingChannel = String(resolved?.node?.backingChannel || '').trim();
  return backingChannel ? [backingChannel] : [];
}

function broadcastProjectionSyncDiagnostic(operation, detail = {}) {
  recordRuntimeEvent(operation, {
    ...(detail && typeof detail === 'object' ? detail : {}),
    channelId: detail?.channelId,
    requestId: detail?.requestId,
    projectionKey: detail?.projectionKey,
  });
  broadcast({
    type: 'projection.sync.diagnostic',
    operation,
    detail: safeClone(detail),
  });
}

function scheduleProjectionSync(delayMs = 0) {
  if (projectionSyncTimer) return;
  projectionSyncTimer = self.setTimeout(() => {
    projectionSyncTimer = 0;
    startProjectionSync();
  }, Math.max(0, Number(delayMs || 0)));
}

function startProjectionSync() {
  for (const record of hostedServiceRecords()) {
    const descriptor = serviceDescriptorFromRecord(record);
    if (!descriptor.surfaceChannel) continue;
    queueProjectionSyncRequest({
      service: descriptor.service,
      channelId: descriptor.surfaceChannel,
      nodePath: 'surface',
      policyId: `${descriptor.service}.surface`,
      syncDepthTarget: { mode: 'surface', targetCount: 1 },
    }, descriptor.surfaceChannel);
    const surface = retainedSurfaceForDescriptor(descriptor);
    for (const node of normalizeArray(surface?.nodes)) {
      const backingChannel = String(node?.backingChannel || '').trim();
      if (!backingChannel || backingChannel === descriptor.surfaceChannel) continue;
      const nodePath = String(node.path || node.nodePath || node.nodeId || '').trim();
      queueProjectionSyncRequest({
        service: descriptor.service,
        channelId: backingChannel,
        nodePath,
        policyId: `${descriptor.service}.${nodePath || backingChannel}.snapshot`,
        syncDepthTarget: { mode: 'snapshot', targetCount: 1 },
      }, backingChannel);
    }
  }
  for (const policy of projectionPolicies.values()) {
    for (const channelId of syncChannelsForPolicy(policy)) {
      synthesizeRuntimeLoggingProjection(projectionPolicyForChannel(policy, channelId));
      queueProjectionSyncRequest(policy, channelId);
    }
  }
}

function queueProjectionSyncRequest(policy, channelId) {
  const channelPolicy = projectionPolicyForChannel(policy, channelId);
  const pendingKey = projectionPolicyStoreKey(channelPolicy);
  for (const pending of pendingProjectionSyncRequests.values()) {
    if (pending.pendingKey === pendingKey) return;
  }
  const existing = projectionForPolicyChannel(policy, channelId);
  if (!projectionNeedsRuntimeSync(existing, channelPolicy, channelId)) return;
  const requestId = randomOpaqueId('projection');
  const nodePath = String(channelPolicy.nodePath || policy?.nodePath || '').trim();
  const limit = nodePath === 'events'
    ? syncTargetCountForPolicy(policy)
    : undefined;
  const payload = {
    requestId,
    channelId,
    service: String(channelPolicy.service || '').trim(),
    ...(nodePath ? { nodePath } : {}),
    ...(limit ? { limit } : {}),
    filters: {},
    policy: channelPolicy,
  };
  const timer = self.setTimeout(() => {
    pendingProjectionSyncRequests.delete(requestId);
    broadcastProjectionSyncDiagnostic('projection.sync.degraded', {
      channelId,
      requestId,
      error: 'projection request timed out',
    });
    scheduleProjectionSync(PROJECTION_SYNC_RETRY_MS);
  }, PROJECTION_SYNC_REQUEST_TIMEOUT_MS);
  pendingProjectionSyncRequests.set(requestId, {
    pendingKey,
    channelId,
    policyId: channelPolicy.policyId,
    service: channelPolicy.service,
    createdAt: nowMs(),
    timer,
  });
  broadcastProjectionSyncDiagnostic('projection.sync.request.sent', {
    channelId,
    nodePath,
    requestId,
    limit: limit || 0,
  });
  const queued = queueRuntimeAppIntent(RUNTIME_APP_INTENT.PROJECTION_OBSERVE, {
    requestId,
    channelId,
    service: String(channelPolicy.service || '').trim(),
    nodeRef: nodePath || channelId,
    payload,
    retryPolicy: { onReject: 'preserve' },
  });
  broadcastProjectionSyncDiagnostic('projection.sync.intent.queued', {
    channelId,
    nodePath,
    requestId,
    frameId: String(queued?.result?.frameId || '').trim(),
  });
}

function normalizeProjectionRecord(value) {
  const source = value?.projection && typeof value.projection === 'object' ? value.projection : value;
  if (!source || typeof source !== 'object') throw new Error('projection result missing');
  const projection = {
    ...safeClone(source),
    channelId: String(source.channelId || '').trim(),
    service: String(source.service || '').trim(),
    servicePk: String(source.servicePk || source.service_pk || '').trim(),
  };
  const nodePath = projectionNodePath(projection);
  if (nodePath) projection.nodePath = nodePath;
  assertProjectionRecord(projection);
  return projection;
}

function storeProjectionRecord(value) {
  const projection = normalizeProjectionRecord(value);
  const key = projectionStoreKey(projection);
  const existing = retainedProjections.get(key);
  const existingCount = projectionPayloadCount(existing);
  const mergedProjection = mergeProjectionRecord(retainedProjections.get(key), projection);
  const storedProjection = {
    ...mergedProjection,
    retainedAt: nowMs(),
  };
  if (existing && projectionSemanticallyEqual(existing, storedProjection)) {
    const refreshedProjection = {
      ...existing,
      retainedAt: storedProjection.retainedAt,
      cursor: storedProjection.cursor || existing.cursor,
      freshness: storedProjection.freshness || existing.freshness,
    };
    retainedProjections.set(key, refreshedProjection);
    recordRuntimeEvent('projection.ignored', {
      projectionKey: key,
      channelId: refreshedProjection.channelId,
      service: refreshedProjection.service,
      reason: 'semantic-match',
    });
    schedulePersist();
    return safeClone(refreshedProjection);
  }
  retainedProjections.set(key, storedProjection);
  const stored = retainedProjections.get(key);
  const changedCount = Math.max(0, projectionPayloadCount(stored) - existingCount);
  recordRuntimeEvent('projection.applied', {
    projectionKey: key,
    channelId: stored.channelId,
    service: stored.service,
    changedCount,
    coverage: projectionCoverage(stored),
  });
  touchRuntime();
  schedulePersist();
  broadcast({
    type: 'projection.observer.update',
    update: projectionObserverUpdate(stored, changedCount),
    projection: safeClone(stored),
  });
  broadcastSnapshot();
  return safeClone(stored);
}

function projectionRecordFromSnapshot(snapshot) {
  assertProjectionSnapshot(snapshot);
  const state = snapshot.state && typeof snapshot.state === 'object' && !Array.isArray(snapshot.state)
    ? snapshot.state
    : {};
  const stateLooksLikeProjection = Boolean(
    state.channelId
      || state.service
      || state.servicePk
      || state.payload
      || state.safeFacts
      || state.encryptedDetailRefs
      || state.diagnostics,
  );
  if (stateLooksLikeProjection) {
    return normalizeProjectionRecord({
      ...safeClone(state),
      channelId: String(state.channelId || snapshot.projectionId || '').trim(),
      service: String(state.service || snapshot.policyId || '').trim(),
      servicePk: String(state.servicePk || state.service_pk || '').trim(),
      policyId: String(state.policyId || snapshot.policyId || '').trim(),
      projectionId: String(state.projectionId || snapshot.projectionId || '').trim(),
      revision: Number(state.revision ?? snapshot.revision),
      freshness: state.freshness && typeof state.freshness === 'object' ? safeClone(state.freshness) : safeClone(snapshot.freshness),
      retainedAt: nowMs(),
      sourceRefs: safeClone(state.sourceRefs || snapshot.sourceRefs || []),
    });
  }
  return normalizeProjectionRecord({
    channelId: snapshot.projectionId,
    service: snapshot.policyId,
    servicePk: snapshot.projectionId,
    policyId: snapshot.policyId,
    projectionId: snapshot.projectionId,
    revision: Number(snapshot.revision),
    freshness: snapshot.freshness,
    safeFacts: {},
    encryptedDetailRefs: [],
    diagnostics: [],
    retainedAt: nowMs(),
    sourceRefs: safeClone(snapshot.sourceRefs || []),
    payload: {
      ...safeClone(snapshot.state),
      coverage: safeClone(snapshot.coverage),
    },
  });
}

function projectionKeyForProtocolRecord(value) {
  const projectionId = String(value?.projectionId || '').trim();
  const policyId = String(value?.policyId || '').trim();
  if (projectionId && policyId) return [projectionId, projectionId, policyId].join('|');
  if (projectionId) return projectionId;
  return '';
}

function findProtocolProjection(value) {
  const projectionId = String(value?.projectionId || '').trim();
  const policyId = String(value?.policyId || '').trim();
  for (const [key, projection] of retainedProjections.entries()) {
    if (projectionId && String(projection?.projectionId || '').trim() !== projectionId) continue;
    if (policyId && String(projection?.policyId || '').trim() !== policyId) continue;
    return { key, projection };
  }
  return null;
}

function clearSatisfiedProjectionRepairs(projection) {
  const projectionId = String(projection?.projectionId || '').trim();
  const policyId = String(projection?.policyId || '').trim();
  const revision = Number(projection?.revision || 0);
  if (!projectionId || !revision) return 0;
  const satisfied = [];
  swarmEdge.repairRequests = swarmEdge.repairRequests.filter((entry) => {
    const repair = entry?.repairRequest || entry?.repairPosture || {};
    if (String(repair.projectionId || '').trim() !== projectionId) return true;
    if (policyId && String(repair.policyId || '').trim() && String(repair.policyId || '').trim() !== policyId) return true;
    if (revision < Number(repair.requiredRevision || 0)) return true;
    satisfied.push(entry);
    return false;
  });
  for (const entry of satisfied) {
    const repair = entry?.repairRequest || entry?.repairPosture || {};
    recordRuntimeEvent('projection.repair.satisfied', {
      level: 'info',
      repairId: String(entry?.repairId || entry?.repairPosture?.repairId || '').trim(),
      projectionId,
      policyId,
      revision,
      requiredRevision: Number(repair.requiredRevision || 0),
      reason: String(repair.reason || '').trim(),
    });
  }
  return satisfied.length;
}

function retainProtocolProjection(projection, { emit = true, changedCount = 1 } = {}) {
  const key = projectionStoreKey(projection) || projectionKeyForProtocolRecord(projection);
  if (!key) throw new Error('projection missing store key');
  const existing = retainedProjections.get(key);
  retainedProjections.set(key, safeClone(projection));
  const projectionId = String(projection?.projectionId || '').trim();
  const satisfiedRepairs = clearSatisfiedProjectionRepairs(projection);
  recordRuntimeEvent('projection.applied', {
    projectionKey: key,
    channelId: projection.channelId,
    service: projection.service,
    projectionId,
    changedCount,
    satisfiedRepairs,
    protocol: true,
  });
  if (projectionId === RUNTIME_DIRECTORY_OBSERVE_CHANNEL) {
    queueRouteRepairsFromZoneBaseline('directory.baseline.applied');
    void flushPendingRouteIntents('directory.baseline.applied');
  }
  touchRuntime();
  schedulePersist();
  if (emit && !projectionSemanticallyEqual(existing, projection)) {
    broadcast({
      type: 'projection.observer.update',
      update: projectionObserverUpdate(projection, changedCount),
      projection: safeClone(projection),
    });
    broadcastSnapshot();
  }
  return safeClone(projection);
}

function handleProjectionSnapshotApply(message) {
  const snapshot = message.snapshot || message.projection || message.payload;
  const projection = projectionRecordFromSnapshot(snapshot);
  const found = findProtocolProjection(projection);
  const existingRevision = Number(found?.projection?.revision || 0);
  const snapshotRevision = Number(projection.revision || 0);
  if (found?.projection && existingRevision > snapshotRevision) {
    recordRuntimeEvent('projection.snapshot.ignored', {
      level: 'info',
      projectionKey: found.key,
      projectionId: String(projection.projectionId || snapshot?.projectionId || '').trim(),
      policyId: String(projection.policyId || snapshot?.policyId || '').trim(),
      reason: 'staleProjectionSnapshot',
      currentRevision: existingRevision,
      snapshotRevision,
    });
    return {
      ok: true,
      ignored: true,
      reason: 'staleProjectionSnapshot',
      result: safeClone(found.projection),
    };
  }
  return { ok: true, result: retainProtocolProjection(projection) };
}

function repairFrameForDelta(delta, repairRequest) {
  return makeSwarmFrame({
    kind: SWARM.FRAME_KIND.PROJECTION_REPAIR_REQUEST,
    issuer: String(delta?.issuer || delta?.projectionId || 'runtime').trim(),
    zoneScope: delta?.zoneScope || { zoneId: String(delta?.zoneId || 'local').trim() || 'local', ttl: 1, maxHops: 0 },
    correlationId: String(delta?.correlationId || delta?.projectionId || '').trim(),
    channelId: String(delta?.projectionId || '').trim(),
    capability: SWARM.CORE_CAPABILITY.PROJECTION_DELTA_APPLY,
    body: defaultSwarmBody(),
    recordRef: {
      kind: SWARM.FRAME_KIND.PROJECTION_REPAIR_REQUEST,
      id: repairRequest.projectionId,
      revision: repairRequest.currentRevision,
    },
  });
}

function projectionRepairReason(repairRequest) {
  const currentRevision = Number(repairRequest?.currentRevision || 0);
  const requiredRevision = Number(repairRequest?.requiredRevision || 0);
  if (currentRevision === 0 && requiredRevision > 0) return 'missingProjectionBaseline';
  return String(repairRequest?.reason || '').trim() || 'revisionGap';
}

function projectionRepairKey(repairRequest) {
  return [
    String(repairRequest?.projectionId || '').trim(),
    String(repairRequest?.policyId || '').trim(),
    projectionRepairReason(repairRequest),
    Number(repairRequest?.currentRevision || 0),
  ].join('|');
}

function upsertProjectionRepairRequest(entry) {
  const repairRequest = entry?.repairRequest || {};
  const repairPosture = entry?.repairPosture || {};
  const key = projectionRepairKey(repairRequest);
  const existing = swarmEdge.repairRequests.find((candidate) => candidate?.repairKey === key) || null;
  if (existing) {
    const requiredRevision = Math.max(
      Number(existing.repairRequest?.requiredRevision || 0),
      Number(repairRequest.requiredRevision || 0),
    );
    existing.repairRequest = {
      ...safeClone(existing.repairRequest || {}),
      requiredRevision,
    };
    existing.repairPosture = {
      ...safeClone(existing.repairPosture || {}),
      requiredRevision,
      lastSeenAt: entry.queuedAt,
    };
    existing.lastSeenAt = entry.queuedAt;
    existing.seenCount = Number(existing.seenCount || 1) + 1;
    return { added: false, entry: safeClone(existing) };
  }
  const next = {
    repairKey: key,
    repairId: repairPosture.repairId,
    repairRequest: safeClone(repairRequest),
    repairPosture: safeClone(repairPosture),
    queuedAt: entry.queuedAt,
    lastSeenAt: entry.queuedAt,
    seenCount: 1,
  };
  swarmEdge.repairRequests.push(next);
  while (swarmEdge.repairRequests.length > PROJECTION_REPAIR_REQUEST_LIMIT) swarmEdge.repairRequests.shift();
  return { added: true, entry: safeClone(next) };
}

function handleProjectionDeltaApply(message) {
  const delta = assertProjectionDelta(message.delta || message.payload);
  const found = findProtocolProjection(delta);
  const existing = found?.projection || null;
  const currentRevision = Number(existing?.revision || 0);
  const currentState = existing?.payload && typeof existing.payload === 'object' ? safeClone(existing.payload) : {};
  delete currentState.coverage;
  const applied = applyProjectionDelta({ state: currentState, revision: currentRevision, delta });
  if (applied.repairRequest) {
    const repairRequest = makeProjectionRepairRequest(applied.repairRequest);
    repairRequest.reason = projectionRepairReason(repairRequest);
    const issuedAt = nowMs();
    const repairPosture = assertProjectionRepairPosture({
      kind: SWARM.RECORD_KIND.PROJECTION_REPAIR_POSTURE,
      repairId: String(repairRequest.requestId || '').trim() || randomOpaqueId('projection-repair'),
      projectionId: repairRequest.projectionId,
      policyId: repairRequest.policyId,
      state: SWARM.PROJECTION_REPAIR_STATE.PENDING,
      currentRevision: repairRequest.currentRevision,
      requiredRevision: repairRequest.requiredRevision,
      reason: repairRequest.reason,
      coverage: delta.coverage,
      observerRef: 'runtime:browser',
      issuedAt,
      expiresAt: issuedAt + PROJECTION_SYNC_REQUEST_TIMEOUT_MS,
    });
    const repairUpsert = upsertProjectionRepairRequest({
      repairRequest,
      repairPosture,
      queuedAt: issuedAt,
    });
    const effectiveRequest = repairUpsert.entry?.repairRequest || repairRequest;
    const effectivePosture = repairUpsert.entry?.repairPosture || repairPosture;
    if (repairUpsert.added) {
      recordRuntimeEvent('projection.repair.request', {
        level: 'info',
        repairId: effectivePosture.repairId,
        projectionId: effectiveRequest.projectionId,
        requestId: effectiveRequest.requestId,
        currentRevision: effectiveRequest.currentRevision,
        requiredRevision: effectiveRequest.requiredRevision,
        reason: effectiveRequest.reason,
      });
    }
    touchRuntime();
    schedulePersist();
    broadcast({
      type: 'projection.repair.request',
      repairRequest: safeClone(effectiveRequest),
      repairPosture: safeClone(effectivePosture),
      deduped: repairUpsert.added === false,
    });
    broadcastSnapshot();
    return { ok: false, error: 'projection revision mismatch', repairRequest: effectiveRequest, repairPosture: effectivePosture };
  }
  const nextProjection = normalizeProjectionRecord({
    ...(existing || {}),
    channelId: delta.projectionId,
    service: delta.policyId,
    servicePk: delta.projectionId,
    policyId: delta.policyId,
    projectionId: delta.projectionId,
    revision: applied.revision,
    freshness: delta.freshness,
    sourceRefs: safeClone(delta.sourceRefs || []),
    payload: {
      ...safeClone(applied.state),
      coverage: safeClone(delta.coverage),
    },
    safeFacts: {},
    encryptedDetailRefs: [],
    diagnostics: [],
    retainedAt: nowMs(),
  });
  const stored = retainProtocolProjection(nextProjection, { emit: applied.changed, changedCount: applied.changed ? 1 : 0 });
  if (!applied.changed) broadcastSnapshot();
  return { ok: true, result: stored, changed: applied.changed };
}

function normalizeHostedServices(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === 'object') ? safeClone(entry) : null)
    .filter(Boolean);
}

function gatewayHostedSnapshot(record) {
  const pk = String(record?.devicePk || record?.pk || '').trim();
  const updatedAt = Number(record?.updatedAt || record?.updated_at || record?.ts || 0);
  const hostedServices = normalizeHostedServices(record?.hostedServices || record?.hosted_services);
  return { pk, updatedAt, hostedServices };
}

function applyGatewayHostedSnapshot(record) {
  const role = String(record?.role || record?.type || '').trim().toLowerCase();
  const service = String(record?.service || '').trim().toLowerCase();
  const isGateway = role === 'gateway' || service === 'gateway';
  if (!isGateway) return record;

  const current = gatewayHostedSnapshot(record);
  if (!current.pk) return record;

  const cache = normalizeObject(managedState.hostedGatewaySnapshots);
  const cached = cache[current.pk] && typeof cache[current.pk] === 'object' ? cache[current.pk] : null;
  let effectiveHostedServices = current.hostedServices;

  if (effectiveHostedServices.length > 0) {
    cache[current.pk] = {
      updatedAt: current.updatedAt,
      hostedServices: effectiveHostedServices,
    };
    managedState.hostedGatewaySnapshots = cache;
  } else if (cached && Array.isArray(cached.hostedServices) && cached.hostedServices.length > 0) {
    const cachedUpdatedAt = Number(cached.updatedAt || 0);
    if (cachedUpdatedAt >= current.updatedAt) {
      effectiveHostedServices = cached.hostedServices.map((service) => ({
        ...service,
        legacyPathFallback: {
          state: 'legacyPathFallback',
          reason: 'gateway hosted service list absent from current snapshot; retained hosted-service cache used',
          sourceRefs: ['runtime.shared.state.hostedGatewaySnapshots'],
          observedAt: nowMs(),
          currentSnapshotUpdatedAt: current.updatedAt || 0,
          cachedSnapshotUpdatedAt: cachedUpdatedAt,
        },
      }));
    } else if (current.updatedAt >= cachedUpdatedAt) {
      cache[current.pk] = {
        updatedAt: current.updatedAt,
        hostedServices: [],
      };
      managedState.hostedGatewaySnapshots = cache;
    }
  }

  if (effectiveHostedServices === current.hostedServices) return record;
  return {
    ...record,
    hostedServices: effectiveHostedServices,
  };
}

function getSwarmSeenAt(pk) {
  const target = String(pk || '').trim();
  if (!target) return 0;
  for (const record of normalizeArray(managedState.sourceSnapshot?.swarmDevices)) {
    const devicePk = String(record?.devicePk || record?.pk || '').trim();
    if (devicePk !== target) continue;
    return Number(record?.updatedAt || record?.updated_at || record?.ts || record?.lastSeen || 0);
  }
  return 0;
}

function applianceSeenAt(rec) {
  if (String(rec?.managedAvailabilityAuthority || '').trim().toLowerCase() === 'gateway') {
    const authoritativeSeen = Number(
      rec?.managedAvailabilityUpdatedAt
      || rec?.managed_availability_updated_at
      || rec?.updatedAt
      || rec?.updated_at
      || 0,
    );
    return Math.max(0, authoritativeSeen);
  }
  const pk = String(rec?.devicePk || rec?.pk || '').trim();
  const nostrSeen = Number(rec?.updatedAt || rec?.updated_at || rec?.ts || rec?.lastSeen || 0);
  const swarmSeen = pk ? Number(getSwarmSeenAt(pk) || 0) : 0;
  const hostedSeen = Array.isArray(rec?.hostedServices || rec?.hosted_services)
    ? (rec.hostedServices || rec.hosted_services).reduce((latest, hosted) => {
        const hostedUpdatedAt = Number(hosted?.updatedAt || hosted?.updated_at || 0);
        return Math.max(latest, hostedUpdatedAt);
      }, 0)
    : 0;
  return Math.max(0, nostrSeen, swarmSeen, hostedSeen);
}

function effectiveApplianceSeenAt(rec, allRecords = []) {
  const baseSeen = applianceSeenAt(rec);
  if (!isGatewayRecord(rec)) return baseSeen;
  const gatewayPk = String(rec?.devicePk || rec?.pk || '').trim();
  if (!gatewayPk) return baseSeen;
  let hostedSeen = 0;
  for (const candidate of Array.isArray(allRecords) ? allRecords : []) {
    if (!isManagedServiceRecord(candidate)) continue;
    const hostGatewayPk = String(candidate?.hostGatewayPk || candidate?.host_gateway_pk || '').trim();
    if (!hostGatewayPk || hostGatewayPk !== gatewayPk) continue;
    hostedSeen = Math.max(hostedSeen, applianceSeenAt(candidate));
  }
  return Math.max(baseSeen, hostedSeen);
}

function mergeGatewayHostedServiceRecord(actualRecord, hostedRecord, gatewayRecord) {
  const actual = (actualRecord && typeof actualRecord === 'object') ? actualRecord : {};
  const hosted = (hostedRecord && typeof hostedRecord === 'object') ? hostedRecord : {};
  const gateway = (gatewayRecord && typeof gatewayRecord === 'object') ? gatewayRecord : {};
  const gatewayPk = String(
    hosted.hostGatewayPk
    || hosted.host_gateway_pk
    || gateway.devicePk
    || gateway.pk
    || actual.hostGatewayPk
    || actual.host_gateway_pk
    || '',
  ).trim();
  const hostedUpdatedAt = Number(hosted.updatedAt || hosted.updated_at || gateway.updatedAt || gateway.updated_at || 0);
  const hostedFacts = hosted.facts && typeof hosted.facts === 'object' ? hosted.facts : null;
  const actualFacts = actual.facts && typeof actual.facts === 'object' ? actual.facts : null;
  return {
    ...actual,
    devicePk: String(hosted.devicePk || hosted.device_pk || actual.devicePk || actual.pk || '').trim(),
    servicePk: String(hosted.servicePk || hosted.service_pk || actual.servicePk || actual.service_pk || '').trim(),
    deviceLabel: String(hosted.deviceLabel || hosted.device_label || actual.deviceLabel || actual.label || hosted.service || 'service').trim(),
    deviceKind: String(hosted.deviceKind || hosted.device_kind || actual.deviceKind || actual.device_kind || 'service').trim() || 'service',
    role: String(hosted.service || actual.role || actual.type || '').trim(),
    service: String(hosted.service || actual.service || '').trim(),
    hostGatewayPk: gatewayPk,
    serviceVersion: String(hosted.serviceVersion || hosted.service_version || actual.serviceVersion || actual.service_version || '').trim(),
    swarmEdge: hosted.swarmEdge || hosted.swarm_edge || actual.swarmEdge || actual.swarm_edge || undefined,
    gatewayAssociationPosture: serviceRecordGatewayAssociationPosture(hosted)
      || serviceRecordGatewayAssociationPosture(actual)
      || serviceRecordGatewayAssociationPosture(gateway)
      || undefined,
    updatedAt: hostedUpdatedAt,
    freshnessMs: Number(hosted.freshnessMs || hosted.freshness_ms || actual.freshnessMs || actual.freshness_ms || 0),
    status: String(hosted.status || actual.status || '').trim(),
    cameraCount: Number(hosted.cameraCount || hosted.camera_count || actual.cameraCount || actual.camera_count || 0),
    facts: hostedFacts || actualFacts || undefined,
    health: hosted.health || actual.health || hostedFacts?.health || actualFacts?.health || undefined,
    sources: hosted.sources || hosted.sourceIds || actual.sources || actual.sourceIds || hostedFacts?.sources || hostedFacts?.sourceIds || actualFacts?.sources || actualFacts?.sourceIds || undefined,
    cameraDevices: hosted.cameraDevices || hosted.cameras || actual.cameraDevices || actual.cameras || hostedFacts?.cameraDevices || hostedFacts?.cameras || actualFacts?.cameraDevices || actualFacts?.cameras || undefined,
    managedAvailabilityAuthority: 'gateway',
    managedAvailabilityUpdatedAt: hostedUpdatedAt,
    managedAvailabilityGatewayPk: gatewayPk,
    directServiceUpdatedAt: Number(actual.updatedAt || actual.updated_at || actual.ts || actual.lastSeen || 0),
    hostedSynthetic: Boolean(actual.hostedSynthetic),
  };
}

function buildApplianceRecords(identityDevices, swarmDevices, grantedRecords = []) {
  const owned = ownedPkSet(identityDevices);
  const actual = [];
  const seen = new Set();
  const sourceRecords = Array.isArray(swarmDevices) ? swarmDevices : [];
  for (const rawRec of sourceRecords) {
    const rec = applyGatewayHostedSnapshot(rawRec);
    const pk = String(rec?.devicePk || rec?.pk || '').trim();
    if (!pk || seen.has(pk)) continue;
    if (!(isGatewayRecord(rec) || isManagedServiceRecord(rec))) continue;
    const ownedRec = owned.has(pk) || owned.has(String(rec?.hostGatewayPk || rec?.host_gateway_pk || '').trim());
    const seenAt = applianceSeenAt(rec);
    const ageMs = seenAt ? Math.max(0, Date.now() - seenAt) : Number.POSITIVE_INFINITY;
    if (!ownedRec && ageMs > APPLIANCE_DISCOVERY_MAX_AGE_MS) continue;
    seen.add(pk);
    actual.push(rec);
  }

  const actualByPk = new Map(actual.map((rec) => [String(rec?.devicePk || rec?.pk || '').trim(), rec]).filter(([pk]) => pk));
  const recs = [...actual];
  const actualPkSet = new Set(actualByPk.keys());
  for (const rec of actual) {
    if (!isGatewayRecord(rec)) continue;
    const hostedServices = Array.isArray(rec?.hostedServices || rec?.hosted_services)
      ? (rec.hostedServices || rec.hosted_services)
      : [];
    for (const hosted of hostedServices) {
      const pk = String(hosted?.devicePk || hosted?.device_pk || '').trim();
      if (!pk) continue;
      const merged = mergeGatewayHostedServiceRecord(actualByPk.get(pk), hosted, rec);
      if (actualByPk.has(pk)) {
        const idx = recs.findIndex((candidate) => String(candidate?.devicePk || candidate?.pk || '').trim() === pk);
        if (idx >= 0) recs[idx] = merged;
        actualByPk.set(pk, merged);
        continue;
      }
      recs.push({
        ...merged,
        hostedSynthetic: true,
      });
      actualByPk.set(pk, merged);
      actualPkSet.add(pk);
    }
  }

  recs.sort((a, b) => Number(effectiveApplianceSeenAt(b, recs) || 0) - Number(effectiveApplianceSeenAt(a, recs) || 0));
  for (const granted of Array.isArray(grantedRecords) ? grantedRecords : []) {
    const pk = String(granted?.devicePk || granted?.pk || '').trim();
    if (!pk || actualPkSet.has(pk)) continue;
    recs.push({
      ...granted,
      grantedRecord: true,
    });
    actualPkSet.add(pk);
  }
  recs.sort((a, b) => Number(effectiveApplianceSeenAt(b, recs) || 0) - Number(effectiveApplianceSeenAt(a, recs) || 0));
  return recs;
}

function partitionApplianceRecords(recs, owned, isGrantedRecord) {
  const ownedRecords = [];
  const grantedRecords = [];
  const discoverableRecords = [];

  for (const rec of recs) {
    const pk = String(rec?.devicePk || rec?.pk || '').trim();
    const ownedRec = owned.has(pk) || owned.has(String(rec?.hostGatewayPk || rec?.host_gateway_pk || '').trim());
    if (ownedRec) {
      ownedRecords.push(rec);
      continue;
    }
    if (isGrantedRecord(rec)) {
      grantedRecords.push(rec);
      continue;
    }
    if (isGatewayRecord(rec)) {
      discoverableRecords.push(rec);
    }
  }

  return {
    ownedRecords,
    grantedRecords,
    discoverableRecords,
  };
}

function rememberResourceName(map, pk, label) {
  const key = String(pk || '').trim();
  const text = String(label || '').trim();
  if (!key || !text) return;
  map[key] = text;
}

function buildResourceNames() {
  const names = {};
  for (const identityDevice of normalizeArray(managedState.sourceSnapshot?.identityDevices)) {
    rememberResourceName(
      names,
      identityDevice?.pk || identityDevice?.devicePk || identityDevice?.identityId,
      identityDevice?.label || identityDevice?.deviceLabel || identityDevice?.name,
    );
  }
  for (const bucket of Object.values(managedState.applianceSnapshot)) {
    for (const record of normalizeArray(bucket)) {
      rememberResourceName(
        names,
        record?.devicePk || record?.pk,
        record?.deviceLabel || record?.label || record?.serviceLabel || record?.name,
      );
      rememberResourceName(
        names,
        record?.hostGatewayPk || record?.host_gateway_pk,
        record?.hostGatewayLabel || record?.host_gateway_label,
      );
    }
  }
  return names;
}

function normalizeManagedSourceSnapshot(snapshot) {
  const payload = normalizeObject(snapshot);
  return {
    identityDevices: normalizeArray(payload.identityDevices).map((entry) => safeClone(entry)),
    swarmDevices: normalizeArray(payload.swarmDevices).map((entry) => safeClone(entry)),
    grantedRecords: normalizeArray(payload.grantedRecords).map((entry) => safeClone(entry)),
    managedServiceIssue: payload.managedServiceIssue ? safeClone(payload.managedServiceIssue) : null,
  };
}

function rebuildManagedApplianceSnapshot() {
  const source = managedState.sourceSnapshot;
  const identityDevices = normalizeArray(source.identityDevices);
  const swarmDevices = normalizeArray(source.swarmDevices);
  const grantedRecords = normalizeArray(source.grantedRecords);
  const combined = buildApplianceRecords(identityDevices, swarmDevices, grantedRecords);
  const owned = ownedPkSet(identityDevices);
  const partitions = partitionApplianceRecords(
    combined,
    owned,
    (record) => record?.sharedProjection === true || record?.grantedRecord === true,
  );
  managedState.applianceSnapshot = {
    owned: safeClone(partitions.ownedRecords),
    granted: safeClone(partitions.grantedRecords),
    discoverable: safeClone(partitions.discoverableRecords),
  };
  managedState.resourceNames = buildResourceNames();
  managedState.managedServiceIssue = source.managedServiceIssue ? safeClone(source.managedServiceIssue) : null;
}

function runtimeSnapshot() {
  const brokerEndpoint = brokerClientId ? endpoints.get(brokerClientId) : null;
  const catalog = serviceCatalog();
  const targetSource = runtimeContractTargetSource(catalog);
  const snapshot = {
    buildId: RUNTIME_WORKER_BUILD_ID,
    updatedAt: runtimeUpdatedAt || nowMs(),
    broker: {
      available: Boolean(brokerEndpoint),
      surface: String(brokerEndpoint?.surface || '').trim(),
    },
    shell: safeClone(runtimeStatus.shell),
    services: safeClone(runtimeStatus.services),
    managedAppliances: safeClone(managedState.applianceSnapshot),
    resourceNames: safeClone(managedState.resourceNames),
    managedServiceIssue: safeClone(managedState.managedServiceIssue),
    serviceCatalog: catalog,
    targetSource,
    contractTargets: safeClone(targetSource.contractTargets),
    targetRegistryPostures: safeClone(targetSource.targetRegistryPostures),
    hostFabricFulfillmentPlans: safeClone(targetSource.hostFabricFulfillmentPlans),
    hostFabricContributions: safeClone(targetSource.hostFabricContributions),
    lifecyclePlans: safeClone(targetSource.lifecyclePlans),
    edge: edgeSnapshot(),
    swarmQueue: swarmQueueObject(),
    activationResolutions: activationResolutionObject(),
    authority: safeClone(runtimeAuthorityPostureState),
    resource: safeClone(runtimeResourcePostureSummary()),
    retention: safeClone(runtimeRetentionPostureSummary()),
    materialization: safeClone(runtimeMaterializationSummary()),
    diagnostics: diagnosticSnapshot(),
    runtimeEvents: runtimeEvents.slice(-RUNTIME_DIAGNOSTIC_SNAPSHOT_LIMIT).map((entry) => safeClone(entry)),
    mediaFulfillment: mediaFulfillmentObject(),
    streamRecovery: streamRecoveryObject(),
    projections: retainedProjectionObject(),
    projectionCoverage: retainedProjectionCoverageObject(),
    projectionPolicies: projectionPolicyObject(),
  };
  snapshot.productShellState = deriveRuntimeShellState(snapshot);
  return snapshot;
}

function endpointPost(endpoint, message) {
  try {
    endpoint?.port?.postMessage(message);
  } catch {}
}

function broadcast(message) {
  for (const endpoint of endpoints.values()) {
    endpointPost(endpoint, message);
  }
}

function broadcastSnapshot() {
  const snapshot = runtimeSnapshot();
  for (const endpoint of endpoints.values()) {
    const materialized = materializeRuntimeSnapshotForEndpoint(snapshot, endpoint);
    const materializationBudget = refreshRuntimeSnapshotMaterialization(endpoint, materialized.delivery);
    endpointPost(endpoint, {
      type: 'runtime.snapshot',
      buildId: RUNTIME_WORKER_BUILD_ID,
      snapshot: materialized.snapshot,
      materializationBudget: safeClone(materializationBudget),
      consumerFloor: safeClone(materializationBudget?.consumerFloor || null),
    });
  }
}

function ensureEndpoint(clientId, endpoint, meta = {}) {
  const key = String(clientId || '').trim();
  if (!key) return null;
  const previousKey = String(endpoint?.clientId || '').trim();
  if (previousKey && previousKey !== key) {
    endpoints.delete(previousKey);
  }
  endpoint.clientId = key;
  endpoint.surface = String(meta.surface || '').trim();
  endpoint.broker = meta.broker === true;
  endpoint.snapshotSubscription = meta.snapshotSubscription && typeof meta.snapshotSubscription === 'object'
    ? safeClone(meta.snapshotSubscription)
    : {};
  endpoint.attachContext = meta.attachContext && typeof meta.attachContext === 'object'
    ? safeClone(meta.attachContext)
    : {};
  refreshRuntimeSnapshotMaterialization(endpoint);
  endpoints.set(key, endpoint);
  if (endpoint.broker) brokerClientId = key;
  return endpoint;
}

function deleteEndpoint(clientId) {
  const key = String(clientId || '').trim();
  if (!key) return;
  disableDiagnosticLoggingSink(key);
  endpoints.delete(key);
  if (brokerClientId === key) {
    brokerClientId = '';
    for (const endpoint of endpoints.values()) {
      if (endpoint.broker) {
        brokerClientId = endpoint.clientId;
        break;
      }
    }
  }
}

function serializedRuntimeState() {
  return {
    buildId: RUNTIME_WORKER_BUILD_ID,
    updatedAt: runtimeUpdatedAt || nowMs(),
    shell: safeClone(runtimeStatus.shell),
    services: safeClone(runtimeStatus.services),
    managedAppliancesSource: safeClone(managedState.sourceSnapshot),
    managedAppliances: safeClone(managedState.applianceSnapshot),
    resourceNames: safeClone(managedState.resourceNames),
    managedServiceIssue: safeClone(managedState.managedServiceIssue),
    hostedGatewaySnapshots: safeClone(managedState.hostedGatewaySnapshots),
    edgeObservations: {
      routeObservations: swarmEdge.routeObservations.map((entry) => safeClone(entry)),
      rejections: swarmEdge.rejections.map((entry) => safeClone(entry)),
      repairRequests: swarmEdge.repairRequests.map((entry) => safeClone(entry)),
      contributionLifecycles: swarmEdge.contributionLifecycles.map((entry) => safeClone(entry)),
    },
    diagnostics: diagnosticSnapshot(),
    runtimeEvents: runtimeEvents.map((entry) => safeClone(entry)),
    mediaFulfillment: mediaFulfillmentObject(),
    swarmQueue: swarmQueueObject(),
    projections: retainedProjectionStoreObject(),
    projectionCoverage: retainedProjectionCoverageObject(),
    projectionPolicies: projectionPolicyObject(),
  };
}

async function clearPersistedState() {
  await Promise.all([
    kvDelete(RUNTIME_STATE_KEY).catch(() => {}),
    kvDelete(RUNTIME_META_KEY).catch(() => {}),
  ]);
}

async function persistRuntimeState() {
  const payload = serializedRuntimeState();
  await Promise.all([
    kvSet(RUNTIME_STATE_KEY, payload),
    kvSet(RUNTIME_META_KEY, {
      buildId: RUNTIME_WORKER_BUILD_ID,
      schemaVersion: RUNTIME_VERSION.major,
      updatedAt: payload.updatedAt,
    }),
  ]);
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = self.setTimeout(() => {
    persistTimer = 0;
    void persistRuntimeState().catch(() => {});
  }, 0);
}

async function hydrateRuntimeState() {
  const meta = await kvGet(RUNTIME_META_KEY).catch(() => null);
  const schemaVersion = Number(meta?.schemaVersion || RUNTIME_VERSION.major);
  const persistedBuildId = String(meta?.buildId || '').trim();
  const sameRuntimeBuild = !persistedBuildId || persistedBuildId === RUNTIME_WORKER_BUILD_ID;
  if (isLocalhostRuntime() && String(meta?.buildId || '').trim() && schemaVersion !== RUNTIME_VERSION.major) {
    await clearPersistedState();
  }
  const persisted = await kvGet(RUNTIME_STATE_KEY).catch(() => null);
  if (persisted && typeof persisted === 'object') {
    const payload = persisted;
    runtimeUpdatedAt = Number(payload.updatedAt || 0);
    runtimeStatus.shell = payload.shell && typeof payload.shell === 'object' ? safeClone(payload.shell) : null;
    runtimeStatus.services = payload.services && typeof payload.services === 'object' ? safeClone(payload.services) : {};
    managedState.sourceSnapshot = normalizeManagedSourceSnapshot(payload.managedAppliancesSource);
    managedState.applianceSnapshot = payload.managedAppliances && typeof payload.managedAppliances === 'object'
      ? {
          owned: normalizeArray(payload.managedAppliances.owned).map((entry) => safeClone(entry)),
          granted: normalizeArray(payload.managedAppliances.granted).map((entry) => safeClone(entry)),
          discoverable: normalizeArray(payload.managedAppliances.discoverable).map((entry) => safeClone(entry)),
        }
      : {
          owned: [],
          granted: [],
          discoverable: [],
        };
    managedState.resourceNames = payload.resourceNames && typeof payload.resourceNames === 'object'
      ? safeClone(payload.resourceNames)
      : {};
    managedState.managedServiceIssue = payload.managedServiceIssue ? safeClone(payload.managedServiceIssue) : null;
    managedState.hostedGatewaySnapshots = payload.hostedGatewaySnapshots && typeof payload.hostedGatewaySnapshots === 'object'
      ? safeClone(payload.hostedGatewaySnapshots)
      : {};
    const edgeObservations = payload.edgeObservations && typeof payload.edgeObservations === 'object'
      ? payload.edgeObservations
      : {};
    swarmEdge.routeObservations = normalizeArray(edgeObservations.routeObservations)
      .map((entry) => safeClone(entry))
      .slice(-100);
    swarmEdge.rejections = normalizeArray(edgeObservations.rejections)
      .map((entry) => safeClone(entry))
      .slice(-100);
    swarmEdge.repairRequests = normalizeArray(edgeObservations.repairRequests)
      .map((entry) => safeClone(entry))
      .slice(-100);
    swarmEdge.contributionLifecycles = normalizeArray(edgeObservations.contributionLifecycles)
      .map((entry) => safeClone(entry))
      .slice(-CONTRIBUTION_LIFECYCLE_LIMIT);
    if (sameRuntimeBuild) {
      runtimeEvents.splice(
        0,
        runtimeEvents.length,
        ...normalizeArray(payload.runtimeEvents).map((entry) => safeClone(entry)).slice(-RUNTIME_DIAGNOSTIC_RING_LIMIT),
      );
    }
    for (const timer of serviceAdmissionTimeoutTimers.values()) self.clearTimeout(timer);
    serviceAdmissionTimeoutTimers.clear();
    const liveSwarmQueue = new Map(outboundSwarmFrames);
    outboundSwarmFrames.clear();
    if (sameRuntimeBuild) {
      const persistedSwarmQueue = payload.swarmQueue && typeof payload.swarmQueue === 'object'
        ? payload.swarmQueue
        : {};
      for (const entry of Object.values(persistedSwarmQueue)) {
        try {
          if (!entry || typeof entry !== 'object') continue;
          const frame = assertSwarmFrame(entry.frame);
          outboundSwarmFrames.set(frame.frameId, {
            frameId: frame.frameId,
            frame: safeClone(frame),
            status: String(entry.status || 'queued').trim() || 'queued',
            queuedAt: Number(entry.queuedAt || nowMs()),
            sentAt: Number(entry.sentAt || 0) || undefined,
            attempts: Number(entry.attempts || 0),
            retryPolicy: normalizeSwarmRetryPolicy(entry.retryPolicy),
            ...(entry.retrySuppressed ? { retrySuppressed: true } : {}),
            ...(entry.routeObservation ? { routeObservation: safeClone(entry.routeObservation) } : {}),
            ...(entry.routeObservedAt ? { routeObservedAt: Number(entry.routeObservedAt || 0) } : {}),
            ...(entry.ackedAt ? { ackedAt: Number(entry.ackedAt || 0) } : {}),
            ...(entry.ack ? { ack: safeClone(entry.ack) } : {}),
            ...(entry.lastError ? { lastError: safeClone(entry.lastError) } : {}),
            ...(entry.repairRequest ? { repairRequest: safeClone(entry.repairRequest) } : {}),
          });
        } catch {}
      }
    }
    for (const [frameId, entry] of liveSwarmQueue.entries()) {
      outboundSwarmFrames.set(frameId, entry);
    }
    for (const entry of outboundSwarmFrames.values()) {
      scheduleServiceAdmissionTimeout(entry);
    }
    mediaFulfillmentPostures.clear();
    const persistedMediaFulfillment = payload.mediaFulfillment && typeof payload.mediaFulfillment === 'object'
      ? payload.mediaFulfillment
      : {};
    for (const [key, posture] of Object.entries(persistedMediaFulfillment)) {
      if (!posture || typeof posture !== 'object') continue;
      const evidenceByKind = new Map();
      const persistedEvidence = posture.evidenceByKind && typeof posture.evidenceByKind === 'object'
        ? posture.evidenceByKind
        : {};
      for (const [evidenceKind, evidence] of Object.entries(persistedEvidence)) {
        if (evidence && typeof evidence === 'object') evidenceByKind.set(evidenceKind, safeClone(evidence));
      }
      mediaFulfillmentPostures.set(String(key || '').trim(), {
        postureId: String(posture.postureId || `media-fulfillment:${key}`).trim(),
        sessionId: String(posture.sessionId || '').trim(),
        activationId: String(posture.activationId || '').trim(),
        interactionId: String(posture.interactionId || '').trim(),
        correlationId: String(posture.correlationId || '').trim(),
        sourceRef: String(posture.sourceRef || '').trim(),
        adapterRef: String(posture.adapterRef || '').trim(),
        serviceRef: String(posture.serviceRef || '').trim(),
        state: String(posture.state || SWARM.MEDIA_FULFILLMENT_STATE.PENDING).trim(),
        blockedReasons: normalizeArray(posture.blockedReasons).map((entry) => String(entry || '').trim()).filter(Boolean),
        visibleFrame: posture.visibleFrame === true,
        trackLive: posture.trackLive === true,
        transportUsable: posture.transportUsable === true,
        updatedAt: Number(posture.updatedAt || 0) || nowMs(),
        expiresAt: Number(posture.expiresAt || 0) || 0,
        latestEvidence: posture.latestEvidence ? safeClone(posture.latestEvidence) : null,
        evidenceByKind,
      });
    }
    retainedProjections.clear();
    const persistedProjections = payload.projections && typeof payload.projections === 'object'
      ? payload.projections
      : {};
    for (const [channelId, projection] of Object.entries(persistedProjections)) {
      try {
        const stored = normalizeProjectionRecord({
          channelId,
          ...(projection && typeof projection === 'object' ? projection : {}),
        });
        const key = projectionStoreKey(stored) || stored.channelId;
        const nextProjection = {
          ...stored,
          retainedAt: Number(projection?.retainedAt || 0) || Number(stored.freshness?.updatedAt || 0) || nowMs(),
        };
        retainedProjections.set(key, mergeProjectionRecord(retainedProjections.get(key), nextProjection));
      } catch {}
    }
    projectionPolicies.clear();
    const persistedPolicies = payload.projectionPolicies && typeof payload.projectionPolicies === 'object'
      ? payload.projectionPolicies
      : {};
    for (const policy of Object.values(persistedPolicies)) {
      try {
        const normalized = normalizeProjectionPolicyForRuntime(policy);
        projectionPolicies.set(projectionPolicyStoreKey(normalized), normalized);
      } catch {}
    }
  }
  rebuildManagedApplianceSnapshot();
}

function ensureHydrated() {
  if (!hydratePromise) {
    hydratePromise = hydrateRuntimeState().then(() => {
      broadcastSnapshot();
      return true;
    }).catch((error) => {
      hydratePromise = null;
      throw error;
    });
  }
  return hydratePromise;
}

function startHydrationInBackground() {
  void ensureHydrated().catch((error) => {
    if (runtimeHydrationWarningLogged) return;
    runtimeHydrationWarningLogged = true;
    console.warn('[runtime] hydration failed', String(error?.message || error));
  });
}

function handleStatusPut(message, endpoint) {
  const role = String(message.role || message.surface || endpoint?.surface || '').trim().toLowerCase();
  const payload = message.status && typeof message.status === 'object' ? message.status : {};

  if (role === 'shell') {
    const next = withoutUpdatedAt(payload);
    if (stableJson(withoutUpdatedAt(runtimeStatus.shell)) === stableJson(next)) {
      return { ok: true, result: runtimeSnapshot(), unchanged: true };
    }
    touchRuntime();
    runtimeStatus.shell = {
      ...next,
      updatedAt: runtimeUpdatedAt,
    };
    schedulePersist();
    broadcastSnapshot();
    void flushPendingRouteIntents('runtime.status.shell');
    return { ok: true, result: runtimeSnapshot() };
  }

  const service = String(message.service || payload.service || endpoint?.surface || '').trim().toLowerCase();
  if (!service) {
    return { ok: false, error: 'missing service status target' };
  }
  const next = {
    ...withoutUpdatedAt(payload),
    service,
  };
  if (stableJson(withoutUpdatedAt(runtimeStatus.services[service])) === stableJson(next)) {
    return { ok: true, result: runtimeSnapshot(), unchanged: true };
  }
  touchRuntime();
  runtimeStatus.services[service] = {
    ...next,
    updatedAt: runtimeUpdatedAt,
  };
  schedulePersist();
  broadcastSnapshot();
  return { ok: true, result: runtimeSnapshot() };
}

function handleProjectionPut(message) {
  try {
    const projection = storeProjectionRecord(message.projection || message.result || message.payload);
    return { ok: true, result: projection };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'invalid projection') };
  }
}

function handleProjectionGet(message) {
  const channelId = String(message.channelId || message?.payload?.channelId || '').trim();
  const servicePk = String(message.servicePk || message?.payload?.servicePk || '').trim();
  const service = String(message.service || message?.payload?.service || '').trim();
  const policyId = String(message.policyId || message?.payload?.policyId || '').trim();
  if (channelId && (servicePk || service || policyId)) {
    const candidates = [];
    if (servicePk) candidates.push([servicePk, channelId, policyId || 'default'].filter(Boolean).join('|'));
    if (service) candidates.push([service, channelId, policyId || 'default'].filter(Boolean).join('|'));
    for (const candidate of candidates) {
      if (retainedProjections.has(candidate)) {
        return { ok: true, result: safeClone(retainedProjections.get(candidate)) };
      }
    }
  }
  if (channelId) {
    for (const projection of retainedProjections.values()) {
      if (String(projection?.channelId || '').trim() === channelId) {
        return { ok: true, result: safeClone(projection) };
      }
    }
    return { ok: true, result: null };
  }
  return { ok: true, result: retainedProjectionObject() };
}

function handleProjectionPolicyPut(message) {
  try {
    const policy = normalizeProjectionPolicyForRuntime(message.policy || message?.payload?.policy || message.payload);
    const key = projectionPolicyStoreKey(policy);
    if (!key) return { ok: false, error: 'missing projection policy key' };
    const existing = projectionPolicies.get(key);
    projectionPolicies.set(key, policy);
    touchRuntime();
    schedulePersist();
    broadcastSnapshot();
    broadcastProjectionSyncDiagnostic('projection.policy.applied', {
      policyId: policy.policyId,
      service: policy.service,
      nodePath: String(policy.nodePath || '').trim(),
      channelId: String(policy.channelId || '').trim(),
    });
    synthesizeRuntimeLoggingProjection(policy);
    if (stableJson(existing) !== stableJson(policy)) {
      scheduleProjectionSync(0);
    }
    return { ok: true, result: safeClone(policy) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || 'invalid projection policy') };
  }
}

function handleRuntimeProjectionSyncResponse(message) {
  const requestId = String(message.requestId || '').trim();
  const pending = pendingProjectionSyncRequests.get(requestId);
  if (!pending) return null;
  pendingProjectionSyncRequests.delete(requestId);
  self.clearTimeout(pending.timer);
  if (message.ok === false) {
    broadcastProjectionSyncDiagnostic('projection.sync.degraded', {
      channelId: pending.channelId,
      requestId,
      error: String(message.error || 'projection request failed'),
    });
    scheduleProjectionSync(PROJECTION_SYNC_RETRY_MS);
    return { ok: true };
  }
  const source = message?.result?.projection || message?.result || null;
  try {
    const stored = storeProjectionRecord(source);
    broadcastProjectionSyncDiagnostic('projection.sync.batch.received', {
      channelId: pending.channelId,
      requestId,
      materialized: projectionCoverage(stored).materializedCount,
      targetCount: projectionCoverage(stored).targetCount,
      syncState: projectionCoverage(stored).syncState,
    });
    scheduleProjectionSync(250);
    return { ok: true };
  } catch (error) {
    broadcastProjectionSyncDiagnostic('projection.sync.degraded', {
      channelId: pending.channelId,
      requestId,
      error: String(error?.message || error || 'invalid service projection response'),
    });
    scheduleProjectionSync(PROJECTION_SYNC_RETRY_MS);
    return { ok: false, error: String(error?.message || error || 'invalid service projection response') };
  }
}

function handleManagedSourceSnapshotPut(message) {
  const next = normalizeManagedSourceSnapshot(message.sourceSnapshot);
  if (stableJson(managedState.sourceSnapshot) === stableJson(next)) {
    return { ok: true, result: runtimeSnapshot(), unchanged: true };
  }
  managedState.sourceSnapshot = next;
  rebuildManagedApplianceSnapshot();
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  scheduleProjectionSync(0);
  return { ok: true, result: runtimeSnapshot() };
}

function forwardBrokerRequest(kind, message, endpoint) {
  const requestId = String(message.requestId || '').trim();
  const requesterId = String(endpoint?.clientId || '').trim();
  if (!requestId) return { ok: false, error: 'missing requestId' };
  if (!brokerClientId) return { ok: false, error: 'runtime broker unavailable' };
  const broker = endpoints.get(brokerClientId);
  if (!broker) return { ok: false, error: 'runtime broker missing' };
  pendingBrokerRequests.set(requestId, {
    requesterId,
    requesterEndpoint: endpoint || null,
    kind,
    createdAt: nowMs(),
  });
  endpointPost(broker, {
    type: 'runtime.broker.request',
    requestId,
    kind,
    payload: safeClone(message.payload || {}),
    sourceClientId: requesterId,
  });
  return { ok: true };
}

function handleBrokerResponse(kind, message) {
  const requestId = String(message.requestId || '').trim();
  if (!requestId) return { ok: false, error: 'missing requestId' };
  const pending = pendingBrokerRequests.get(requestId);
  if (!pending) return { ok: false, error: 'request not pending' };
  pendingBrokerRequests.delete(requestId);
  const response = {
    type: 'runtime.response',
    requestId,
    kind,
    ok: message.ok !== false,
    result: safeClone(message.result),
    error: String(message.error || '').trim(),
  };
  const endpoint = pending.requesterEndpoint || endpoints.get(pending.requesterId);
  if (!endpoint) return { ok: false, error: 'requester not attached' };
  endpointPost(endpoint, response);
  return { ok: true };
}

function mediaFulfillmentKey(record) {
  return String(record.sessionId || record.activationId || record.interactionId || record.correlationId || '').trim();
}

function mediaFulfillmentEntrySnapshot(entry) {
  const evidenceByKind = {};
  for (const [kind, evidence] of entry.evidenceByKind.entries()) {
    evidenceByKind[kind] = safeClone(evidence);
  }
  return {
    kind: 'media.fulfillment.posture',
    postureId: entry.postureId,
    sessionId: entry.sessionId,
    activationId: entry.activationId,
    interactionId: entry.interactionId,
    correlationId: entry.correlationId,
    sourceRef: entry.sourceRef,
    adapterRef: entry.adapterRef,
    serviceRef: entry.serviceRef,
    routePromiseId: entry.routePromiseId,
    state: entry.state,
    postureState: entry.postureState,
    blockedCategory: entry.blockedCategory || '',
    blockedReasons: entry.blockedReasons.slice(),
    visibleFrame: entry.visibleFrame === true,
    trackLive: entry.trackLive === true,
    transportUsable: entry.transportUsable === true,
    renderReadinessState: entry.renderReadinessState || '',
    selectedPairState: entry.selectedPairState || '',
    inboundRtpState: entry.inboundRtpState || '',
    renderState: entry.renderState || '',
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt || undefined,
    latestEvidence: safeClone(entry.latestEvidence || null),
    evidenceByKind,
  };
}

function mediaFulfillmentObject() {
  return Object.fromEntries(
    Array.from(mediaFulfillmentPostures.entries()).map(([key, entry]) => [key, mediaFulfillmentEntrySnapshot(entry)]),
  );
}

function mediaEvidenceSafeFacts(record) {
  return record?.safeFacts && typeof record.safeFacts === 'object' ? record.safeFacts : {};
}

function mediaBlockedCategory(reason, evidenceKind, facts = {}) {
  const normalizedReason = String(reason || '').trim();
  const readinessState = String(facts.readinessState || '').trim();
  if (
    evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE
    || readinessState === 'renderBlocked'
    || [
      'renderPlaybackStalled',
      'renderDimensionsMissing',
      'videoElementError',
    ].includes(normalizedReason)
  ) {
    return 'render';
  }
  if (
    evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE
    || evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.SELECTED_CANDIDATE_PAIR
    || evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.INBOUND_STATS
    || [
      'iceFailed',
      'peerConnectionFailed',
      'inboundRtpStalled',
      'mediaTransportBlocked',
      'missingBrowserCandidate',
      'missingServiceCandidate',
    ].includes(normalizedReason)
  ) {
    return 'mediaPath';
  }
  if (evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRACK_STATE) return 'track';
  return normalizedReason ? 'media' : '';
}

function mediaRuntimePostureState(entry) {
  const latestEvidence = entry.latestEvidence || {};
  const latestFacts = mediaEvidenceSafeFacts(latestEvidence);
  const latestKind = String(latestEvidence.evidenceKind || '').trim();
  const render = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE);
  const renderFacts = mediaEvidenceSafeFacts(render);
  const inbound = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.INBOUND_STATS);
  const selectedPair = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.SELECTED_CANDIDATE_PAIR);
  entry.blockedCategory = '';
  entry.renderReadinessState = String(renderFacts.readinessState || latestFacts.readinessState || '').trim();
  entry.selectedPairState = String(selectedPair?.safeFacts?.pairState || latestFacts.selectedPairState || '').trim();
  entry.inboundRtpState = inbound?.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED
    ? 'stalled'
    : inbound?.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE
      ? 'flowing'
      : String(latestFacts.inboundRtpState || '').trim();
  entry.renderState = render?.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED
    ? 'blocked'
    : render?.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE
      ? 'visible'
      : String(latestFacts.renderState || '').trim();
  if (entry.state === SWARM.MEDIA_FULFILLMENT_STATE.RELEASED) return 'released';
  if (entry.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE) return 'adapterLive';
  if (entry.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED) {
    const reason = entry.blockedReasons[0] || String(latestEvidence.blockedReason || '').trim();
    const category = mediaBlockedCategory(reason, latestKind, latestFacts);
    entry.blockedCategory = category;
    if (category === 'render') return 'renderBlocked';
    if (category === 'mediaPath') return 'mediaPathBlocked';
    return 'mediaBlocked';
  }
  if (
    entry.renderReadinessState === 'waitingRender'
    || entry.renderReadinessState === 'pendingRender'
    || entry.trackLive
    || entry.transportUsable
  ) {
    return 'waitingRender';
  }
  return 'waitingMediaEvidence';
}

function streamRecoveryObject() {
  return Object.fromEntries(
    Array.from(streamRecoveryPostures.entries()).map(([key, entry]) => [key, safeClone(entry)]),
  );
}

function reduceMediaFulfillmentState(entry) {
  const evidence = Array.from(entry.evidenceByKind.values());
  const latestRelease = evidence.find((record) => record.evidenceKind === SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RELEASE);
  const blockedReasons = [...new Set(evidence
    .filter((record) => record.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED)
    .map((record) => String(record.blockedReason || '').trim())
    .filter(Boolean))];
  const render = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE);
  const track = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRACK_STATE);
  const transport = entry.evidenceByKind.get(SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE);
  const renderFacts = render?.safeFacts && typeof render.safeFacts === 'object' ? render.safeFacts : {};
  entry.blockedReasons = blockedReasons;
  entry.visibleFrame = render?.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE
    && renderFacts.visibleFrame === true
    && Number(renderFacts.videoWidth || 0) > 0
    && Number(renderFacts.videoHeight || 0) > 0;
  entry.trackLive = track?.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE;
  entry.transportUsable = transport?.state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE;
  if (latestRelease || entry.latestEvidence?.state === SWARM.MEDIA_FULFILLMENT_STATE.RELEASED) {
    entry.state = SWARM.MEDIA_FULFILLMENT_STATE.RELEASED;
  } else if (blockedReasons.length > 0) {
    entry.state = SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED;
  } else if (entry.visibleFrame) {
    entry.state = SWARM.MEDIA_FULFILLMENT_STATE.USABLE;
  } else {
    entry.state = SWARM.MEDIA_FULFILLMENT_STATE.PENDING;
  }
  entry.postureState = mediaRuntimePostureState(entry);
  return entry;
}

function reduceMediaFulfillmentEvidence(record) {
  const key = mediaFulfillmentKey(record);
  const previous = mediaFulfillmentPostures.get(key);
  const entry = previous || {
    postureId: `media-fulfillment:${key}`,
    sessionId: '',
    activationId: '',
    interactionId: '',
    correlationId: '',
    sourceRef: '',
    adapterRef: '',
    serviceRef: '',
    routePromiseId: '',
    state: SWARM.MEDIA_FULFILLMENT_STATE.PENDING,
    postureState: 'waitingMediaEvidence',
    blockedCategory: '',
    blockedReasons: [],
    visibleFrame: false,
    trackLive: false,
    transportUsable: false,
    renderReadinessState: '',
    selectedPairState: '',
    inboundRtpState: '',
    renderState: '',
    updatedAt: 0,
    expiresAt: 0,
    latestEvidence: null,
    evidenceByKind: new Map(),
  };
  entry.sessionId = String(record.sessionId || entry.sessionId || '').trim();
  entry.activationId = String(record.activationId || entry.activationId || '').trim();
  entry.interactionId = String(record.interactionId || entry.interactionId || '').trim();
  entry.correlationId = String(record.correlationId || entry.correlationId || '').trim();
  entry.sourceRef = String(record.sourceRef || entry.sourceRef || '').trim();
  entry.adapterRef = String(record.adapterRef || entry.adapterRef || '').trim();
  entry.serviceRef = String(record.serviceRef || entry.serviceRef || '').trim();
  entry.routePromiseId = String(record.routePromiseId || entry.routePromiseId || '').trim();
  entry.updatedAt = Math.max(entry.updatedAt || 0, Number(record.observedAt || 0) || nowMs());
  entry.expiresAt = Math.max(entry.expiresAt || 0, Number(record.expiresAt || 0) || 0);
  entry.latestEvidence = safeClone(record);
  entry.evidenceByKind.set(record.evidenceKind, safeClone(record));
  reduceMediaFulfillmentState(entry);
  mediaFulfillmentPostures.set(key, entry);
  const posture = mediaFulfillmentEntrySnapshot(entry);
  applyMediaFulfillmentPostureToQueuedFrame(posture);
  return posture;
}

function findQueuedFrameForMediaFulfillmentPosture(posture = {}) {
  const latestEvidence = posture?.latestEvidence && typeof posture.latestEvidence === 'object'
    ? posture.latestEvidence
    : {};
  const candidates = [
    posture?.sessionId,
    posture?.activationId,
    posture?.interactionId,
    posture?.correlationId,
    posture?.routePromiseId,
    latestEvidence.sessionId,
    latestEvidence.activationId,
    latestEvidence.interactionId,
    latestEvidence.correlationId,
    latestEvidence.routePromiseId,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    const entry = findQueuedFrame(candidate);
    if (entry) return entry;
  }
  for (const entry of outboundSwarmFrames.values()) {
    const ids = queueCorrelationIds(entry);
    if (candidates.some((candidate) => ids.includes(candidate))) return entry;
  }
  return null;
}

function applyMediaFulfillmentPostureToQueuedFrame(posture = {}) {
  const entry = findQueuedFrameForMediaFulfillmentPosture(posture);
  if (!entry) return false;
  const state = String(posture.state || '').trim();
  const postureState = String(posture.postureState || '').trim();
  entry.mediaFulfillment = safeClone(posture);
  entry.mediaFulfillmentAt = Number(posture.updatedAt || 0) || nowMs();
  if (state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED) {
    entry.status = postureState || 'mediaBlocked';
    const errorCode = postureState === 'renderBlocked'
      ? 'media.renderBlocked'
      : postureState === 'mediaPathBlocked'
        ? 'media.pathBlocked'
        : 'media.blocked';
    entry.lastError = {
      code: errorCode,
      message: posture.blockedReasons?.[0] || 'media transport blocked',
      retryable: true,
    };
  } else if (state === SWARM.MEDIA_FULFILLMENT_STATE.PENDING && postureState === 'waitingRender') {
    if (!queuedSwarmFrameTerminal(entry)) {
      entry.status = 'waitingRender';
      entry.lastError = undefined;
    }
  } else if (state === SWARM.MEDIA_FULFILLMENT_STATE.USABLE) {
    if (!queuedSwarmFrameTerminal(entry)) {
      entry.status = 'adapterLive';
      entry.lastError = undefined;
    }
  } else if (state === SWARM.MEDIA_FULFILLMENT_STATE.RELEASED) {
    entry.status = 'released';
    clearServiceAdmissionTimeout(entry);
  }
  recordRuntimeEvent('activation.media.fulfillment.applied', {
    frameId: String(entry.frameId || '').trim(),
    correlationId: String(entry.frame?.correlationId || posture.correlationId || '').trim(),
    activationId: String(entry.activationId || posture.activationId || '').trim(),
    routePromiseId: String(entry.routePromiseId || posture.routePromiseId || '').trim(),
    sessionId: String(posture.sessionId || '').trim(),
    state,
    postureState,
    blockedReason: String(posture.blockedReasons?.[0] || '').trim(),
  });
  return true;
}

function streamRecoveryKey(source = {}) {
  return String(
    source.parentIntentId
      || source.intentId
      || source.activationId
      || source.sessionId
      || source.correlationId
      || normalizeArray(source.sourceIds || source.sources).join(',')
      || 'stream:default',
  ).trim();
}

function streamRecoveryPostureSnapshot(key, source = {}, action = 'schedule') {
  const now = nowMs();
  if (action === 'reset') {
    const previous = streamRecoveryPostures.get(key) || {};
    streamRecoveryPostures.delete(key);
    const posture = {
      kind: 'runtime.stream.recovery.posture',
      parentIntentId: key,
      state: 'reset',
      attempt: 0,
      delayMs: 0,
      nextRetryAt: 0,
      previousAttempt: Number(previous.attempt || 0),
      reason: String(source.reason || 'reset').trim(),
      issuedAt: now,
    };
    recordRuntimeEvent('stream.recovery.reset', {
      parentIntentId: key,
      previousAttempt: posture.previousAttempt,
      reason: posture.reason,
    });
    return posture;
  }
  const previous = streamRecoveryPostures.get(key) || {};
  const attemptHint = Number(source.attemptHint || source.attempt || 0) || 0;
  const attempt = Math.max(Number(previous.attempt || 0) + 1, attemptHint, 1);
  const baseMs = positiveNumber(source.baseMs || source.base_ms, 3_000);
  const maxMs = positiveNumber(source.maxMs || source.max_ms, 90_000);
  const step = Math.min(8, Math.max(0, attempt - 1));
  const jitterMax = Math.min(1_000, baseMs);
  const jitterMs = Math.floor(Math.random() * jitterMax);
  const delayMs = Math.min(maxMs, (baseMs * (2 ** step)) + jitterMs);
  const posture = {
    kind: 'runtime.stream.recovery.posture',
    parentIntentId: key,
    state: 'scheduled',
    attempt,
    delayMs,
    nextRetryAt: now + delayMs,
    reason: String(source.reason || 'mediaPathRecovery').trim(),
    sourceIds: normalizeArray(source.sourceIds || source.sources).map((entry) => String(entry || '').trim()).filter(Boolean),
    sessionCount: Number(source.sessionCount || source.session_count || 0) || 0,
    issuedAt: now,
    expiresAt: now + Math.max(delayMs, baseMs),
  };
  streamRecoveryPostures.set(key, posture);
  recordRuntimeEvent('stream.recovery.scheduled', {
    parentIntentId: key,
    attempt,
    delayMs,
    reason: posture.reason,
    sessionCount: posture.sessionCount,
  });
  return posture;
}

function handleRuntimeStreamRecoveryRequest(message) {
  const source = normalizeObject(message?.payload || message);
  const key = streamRecoveryKey(source);
  if (!key) return { ok: false, error: 'missingStreamRecoveryKey' };
  const action = String(source.action || 'schedule').trim();
  const posture = streamRecoveryPostureSnapshot(key, source, action);
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return { ok: true, result: safeClone(posture) };
}

function handleMediaFulfillmentEvidencePut(message) {
  const source = message?.evidence || message?.record || message?.payload || message;
  const record = assertMediaFulfillmentEvidence(source);
  const posture = reduceMediaFulfillmentEvidence(record);
  recordRuntimeEvent('media.fulfillment.updated', {
    level: posture.state === SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED ? 'warn' : 'info',
    sessionId: posture.sessionId,
    activationId: posture.activationId,
    correlationId: posture.correlationId,
    sourceRef: posture.sourceRef,
    adapterRef: posture.adapterRef,
    evidenceKind: record.evidenceKind,
    state: posture.state,
    blockedReason: String(record.blockedReason || '').trim(),
    visibleFrame: posture.visibleFrame,
    trackLive: posture.trackLive,
    transportUsable: posture.transportUsable,
  });
  touchRuntime();
  schedulePersist();
  broadcastSnapshot();
  return { ok: true, result: posture };
}

function handleMediaTransportObservationPut(message) {
  const source = message?.observation || message?.record || message?.payload || message;
  const observation = assertMediaTransportObservation(source);
  const posture = reduceMediaTransportObservationRecord(observation, {
    frameId: String(message?.frameId || '').trim(),
    correlationId: String(message?.correlationId || observation.sessionId || '').trim(),
  });
  return { ok: true, result: posture };
}

function runtimeMediaTransportProfile() {
  const issuedAt = nowMs();
  return {
    kind: 'runtime.mediaTransport.profile',
    profileId: RUNTIME_MEDIA_TRANSPORT_PROFILE_ID,
    transport: 'webrtc',
    role: 'browserOfferer',
    selectedBy: 'runtime',
    iceServers: safeClone(RUNTIME_MEDIA_TRANSPORT_ICE_SERVERS),
    candidatePolicy: {
      browser: 'fullIce',
      service: 'iceLiteAnswerer',
    },
    issuedAt,
    expiresAt: issuedAt + 10 * 60_000,
  };
}

function handleDiagnosticsSubscribe(message, endpoint) {
  const clientId = String(message.clientId || endpoint?.clientId || '').trim() || randomOpaqueId('diagnostic-client');
  const entry = ensureEndpoint(clientId, endpoint, {
    surface: message.surface || endpoint?.surface,
    broker: endpoint?.broker === true,
  }) || endpoint;
  entry.diagnostics = true;
  entry.diagnosticSurface = String(message.surface || entry.surface || '').trim();
  entry.diagnosticClientId = clientId;
  entry.diagnosticSubscription = normalizeDiagnosticSubscription(message, entry);
  if (message.logging === true || message.loggingSink === true) {
    enableDiagnosticLoggingSink(clientId);
  } else {
    disableDiagnosticLoggingSink(clientId);
  }
  const limit = Math.min(
    RUNTIME_DIAGNOSTIC_RING_LIMIT,
    Math.max(0, Number(entry.diagnosticSubscription?.window?.replayLimit ?? message.limit ?? RUNTIME_DIAGNOSTIC_REPLAY_LIMIT)),
  );
  const replayFilteredBefore = diagnosticAdmissionCounters.replayFiltered;
  const events = limit > 0
    ? diagnosticEventsForSubscription(entry.diagnosticSubscription, limit)
    : [];
  const replayFiltered = Math.max(0, diagnosticAdmissionCounters.replayFiltered - replayFilteredBefore);
  const materializationBudget = diagnosticReplayMaterializationBudget(
    entry.diagnosticSubscription,
    events,
    replayFiltered,
  );
  entry.diagnosticMaterializationBudget = materializationBudget;
  endpointPost(entry, {
    type: 'runtime.diagnostics.events',
    buildId: RUNTIME_WORKER_BUILD_ID,
    runtimeSessionId,
    events,
    delivery: {
      mode: SWARM.EVENT_DELIVERY_MODE.REPLAY,
      replayedCount: events.length,
      filteredCount: replayFiltered,
    },
    subscription: safeClone(entry.diagnosticSubscription),
    materializationBudget: safeClone(materializationBudget),
    consumerFloor: safeClone(materializationBudget.consumerFloor),
    diagnostics: diagnosticSnapshot(),
  });
  recordRuntimeEvent('runtime.diagnostics.subscribe', {
    clientId,
    surface: entry.diagnosticSurface,
    subscriptionId: entry.diagnosticSubscription.subscriptionId,
    planes: safeClone(entry.diagnosticSubscription.planes),
    materializationId: materializationBudget.budgetId,
    loggingSink: diagnosticLoggingEnabled,
  });
  return {
    ok: true,
    result: {
      buildId: RUNTIME_WORKER_BUILD_ID,
      runtimeSessionId,
      replayedCount: events.length,
      subscription: safeClone(entry.diagnosticSubscription),
      materializationBudget: safeClone(materializationBudget),
      consumerFloor: safeClone(materializationBudget.consumerFloor),
      diagnostics: diagnosticSnapshot(),
    },
  };
}

function handleDiagnosticsUnsubscribe(message, endpoint) {
  const key = String(message.clientId || endpoint?.clientId || '').trim();
  const entry = key ? endpoints.get(key) || endpoint : endpoint;
  if (entry) {
    entry.diagnostics = false;
    entry.diagnosticSurface = '';
    entry.diagnosticSubscription = null;
    entry.diagnosticMaterializationBudget = null;
  }
  disableDiagnosticLoggingSink(key);
  recordRuntimeEvent('runtime.diagnostics.unsubscribe', {
    clientId: key,
  });
  return { ok: true, result: diagnosticSnapshot() };
}

function diagnosticCommandFailure(command, code, message, extra = {}) {
  return {
    ok: false,
    error: String(message || code || 'diagnostic command failed'),
    result: {
      recordKind: 'runtime.diagnostic.command.result',
      command,
      ok: false,
      code,
      ...safeClone(extra),
    },
  };
}

function recentDiagnosticEvents(args = {}) {
  return materializeRecentDiagnosticEvents(args).events;
}

function routeExplain(args = {}) {
  const target = String(args.frameId || args.correlationId || args.activationId || args.routePromiseId || '').trim();
  const observations = swarmEdge.routeObservations
    .filter((entry) => !target || [
      entry.frameId,
      entry.correlationId,
      entry.activationId,
      entry.routePromiseId,
    ].map((value) => String(value || '').trim()).includes(target))
    .map((entry) => safeClone(entry));
  const queue = Array.from(outboundSwarmFrames.values())
    .filter((entry) => !target || queueCorrelationIds(entry).includes(target))
    .map((entry) => ({
      frameId: entry.frameId,
      status: entry.status,
      attempts: entry.attempts,
      channelId: String(entry.frame?.channelId || '').trim(),
      capability: String(entry.frame?.capability || '').trim(),
      correlationId: String(entry.frame?.correlationId || '').trim(),
      lastError: safeClone(entry.lastError || null),
      routeObservation: safeClone(entry.routeObservation || null),
      routeDelivery: routeDeliveryPosture(entry),
    }));
  return {
    target,
    observations,
    queue,
    edge: edgeSnapshot(),
  };
}

function projectionExplain(args = {}) {
  const target = String(args.projectionKey || args.channelId || args.service || '').trim();
  const projections = {};
  for (const [key, projection] of retainedProjections.entries()) {
    if (target && key !== target && String(projection?.channelId || '').trim() !== target && String(projection?.service || '').trim() !== target) continue;
    projections[key] = {
      projectionKey: key,
      channelId: projection.channelId,
      service: projection.service,
      servicePk: projection.servicePk,
      policyId: projection.policyId,
      revision: projection.revision,
      freshness: safeClone(projection.freshness || null),
      coverage: projectionCoverage(projection),
      retainedAt: projection.retainedAt,
    };
  }
  return {
    target,
    projections,
    policies: projectionPolicyObject(),
    pending: Object.fromEntries(Array.from(pendingProjectionSyncRequests.entries()).map(([key, value]) => [key, {
      pendingKey: value.pendingKey,
      channelId: value.channelId,
      policyId: value.policyId,
      service: value.service,
      createdAt: value.createdAt,
    }])),
  };
}

function activationExplain(args = {}) {
  const target = String(args.activationId || args.frameId || args.correlationId || '').trim();
  const all = activationResolutionObject();
  if (!target) return all;
  return Object.fromEntries(Object.entries(all).filter(([key, value]) => (
    key === target
    || String(value?.frameId || '').trim() === target
    || String(value?.activationId || '').trim() === target
  )));
}

async function executeDiagnosticCommand(command, args = {}, endpoint = null) {
  switch (command) {
    case 'dumpRecentEvents': {
      const materialized = materializeRecentDiagnosticEvents(args, endpoint, command);
      return { ...materialized, diagnostics: diagnosticSnapshot() };
    }
    case 'routeExplain':
      return routeExplain(args);
    case 'projectionExplain':
      return projectionExplain(args);
    case 'activationExplain':
      return activationExplain(args);
    case 'resourceSample':
      return runtimeResourceSample();
    case 'requestProjectionRepair':
      scheduleProjectionSync(0);
      recordRuntimeEvent('projection.repair.requested', {
        projectionKey: args.projectionKey,
        channelId: args.channelId,
        requestId: args.requestId,
      });
      return { scheduled: true, projection: projectionExplain(args) };
    case 'flushDiagnosticsToLogging': {
      enableDiagnosticLoggingSink();
      const materialized = materializeRecentDiagnosticEvents(
        { ...args, limit: Math.min(Number(args.limit || 8), RUNTIME_DIAGNOSTIC_LOG_RATE_LIMIT) },
        endpoint,
        command,
      );
      const events = materialized.events;
      for (const event of events) {
        enqueueDiagnosticLoggingBacklog(event);
      }
      flushDiagnosticLoggingEvents();
      return {
        enabled: true,
        backlogCount: diagnosticLoggingBacklog.length,
        attemptedCount: events.length,
        materializationBudget: materialized.materializationBudget,
        consumerFloor: materialized.consumerFloor,
        diagnostics: diagnosticSnapshot(),
      };
    }
    case 'openTestActivation':
    case 'closeTestActivation':
      recordRuntimeEvent(`runtime.diagnostics.${command}`, {
        args: sanitizeDiagnosticValue(args),
        diagnosticOnly: true,
      });
      return { state: 'diagnosticOnly', command };
    default:
      throw new Error(`unsupported diagnostic command: ${command}`);
  }
}

async function handleDiagnosticsCommand(message, endpoint) {
  const command = String(message.command || message.name || '').trim();
  const args = normalizeObject(message.args || message.payload);
  const remote = message.remote === true;
  if (!endpoint?.diagnostics) {
    return diagnosticCommandFailure(command, 'debug.disabled', 'diagnostic command requires an enabled debug subscriber');
  }
  if (!runtimeDiagnosticCommands.has(command)) {
    return diagnosticCommandFailure(command, 'command.unknown', 'diagnostic command is not allowlisted');
  }
  const nonce = String(message.nonce || message.commandId || '').trim();
  if (!nonce) return diagnosticCommandFailure(command, 'nonce.missing', 'diagnostic command missing nonce');
  if (diagnosticCommandNonces.has(nonce)) {
    return diagnosticCommandFailure(command, 'nonce.replay', 'diagnostic command replayed');
  }
  const expiresAt = Number(message.expiresAt || 0);
  if (!expiresAt || expiresAt <= nowMs()) {
    return diagnosticCommandFailure(command, 'command.expired', 'diagnostic command expired');
  }
  const audienceRuntimeSessionId = String(message.audienceRuntimeSessionId || '').trim();
  if (remote && !audienceRuntimeSessionId) {
    return diagnosticCommandFailure(command, 'audience.missing', 'remote diagnostic command missing runtime audience');
  }
  if (audienceRuntimeSessionId && audienceRuntimeSessionId !== runtimeSessionId) {
    return diagnosticCommandFailure(command, 'audience.mismatch', 'diagnostic command targeted another runtime session');
  }
  if (remote && message.caacValidated !== true) {
    return diagnosticCommandFailure(command, 'authority.invalid', 'remote diagnostic command requires CAAC validation');
  }
  diagnosticCommandNonces.add(nonce);
  if (diagnosticCommandNonces.size > 300) {
    const first = diagnosticCommandNonces.values().next().value;
    diagnosticCommandNonces.delete(first);
  }
  recordRuntimeEvent('runtime.diagnostic.command', {
    command,
    requestId: message.requestId,
    clientId: endpoint.clientId,
    surface: endpoint.surface,
    remote,
  });
  try {
    const result = await executeDiagnosticCommand(command, args, endpoint);
    const event = recordRuntimeEvent('runtime.diagnostic.command.result', {
      command,
      requestId: message.requestId,
      clientId: endpoint.clientId,
      surface: endpoint.surface,
      ok: true,
    });
    return {
      ok: true,
      result: {
        recordKind: 'runtime.diagnostic.command.result',
        command,
        ok: true,
        eventId: event.eventId,
        result,
      },
    };
  } catch (error) {
    const failure = diagnosticCommandFailure(command, 'command.failed', String(error?.message || error || 'diagnostic command failed'));
    recordRuntimeEvent('runtime.diagnostic.command.result', {
      command,
      requestId: message.requestId,
      clientId: endpoint.clientId,
      surface: endpoint.surface,
      ok: false,
      error: failure.error,
    });
    return failure;
  }
}

async function handleControlMessage(message, endpoint) {
  const type = String(message?.type || '').trim();
  if (!type) return;

  if (type === 'runtime.attach') {
    const clientId = String(message.clientId || '').trim();
    const brokerWasAvailable = Boolean(brokerClientId && endpoints.get(brokerClientId));
    const entry = ensureEndpoint(clientId, endpoint, {
      surface: message.surface,
      broker: message.broker === true,
      snapshotSubscription: message.snapshotSubscription,
      attachContext: message.attachContext,
    });
    startHydrationInBackground();
    const materialized = materializeRuntimeSnapshotForEndpoint(runtimeSnapshot(), entry);
    const materializationBudget = refreshRuntimeSnapshotMaterialization(entry, materialized.delivery);
    endpointPost(endpoint, {
      type: 'runtime.attached',
      buildId: RUNTIME_WORKER_BUILD_ID,
      clientId: entry?.clientId || '',
      snapshot: materialized.snapshot,
      materializationBudget: safeClone(materializationBudget || null),
      consumerFloor: safeClone(materializationBudget?.consumerFloor || null),
    });
    recordRuntimeEvent('runtime.attach', {
      clientId: entry?.clientId || '',
      surface: entry?.surface || '',
      broker: entry?.broker === true,
      materializationId: String(entry?.runtimeSnapshotMaterializationBudget?.budgetId || '').trim(),
    });
    const brokerIsAvailable = Boolean(brokerClientId && endpoints.get(brokerClientId));
    if (brokerWasAvailable !== brokerIsAvailable || entry?.broker) {
      broadcastSnapshot();
      scheduleProjectionSync(0);
    }
    return;
  }

  // Hydration repairs retained state, but it must not gate runtime writes,
  // local broker requests, or projection repair. A slow bootstrap path should
  // never make local runtime put/get messages time out.
  startHydrationInBackground();

  let response = null;

  switch (type) {
    case 'runtime.detach': {
      recordRuntimeEvent('runtime.detach', {
        clientId: String(message.clientId || endpoint?.clientId || '').trim(),
      });
      deleteEndpoint(message.clientId);
      response = {
        type: 'runtime.detached',
        buildId: RUNTIME_WORKER_BUILD_ID,
      };
      break;
    }
    case RUNTIME_DIAGNOSTICS_SUBSCRIBE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_DIAGNOSTICS_SUBSCRIBE,
        ...handleDiagnosticsSubscribe(message, endpoint),
      };
      break;
    }
    case RUNTIME_DIAGNOSTICS_UNSUBSCRIBE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_DIAGNOSTICS_UNSUBSCRIBE,
        ...handleDiagnosticsUnsubscribe(message, endpoint),
      };
      break;
    }
    case RUNTIME_DIAGNOSTICS_COMMAND: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_DIAGNOSTICS_COMMAND,
        ...(await handleDiagnosticsCommand(message, endpoint)),
      };
      break;
    }
    case 'runtime.snapshot.get': {
      const materialized = materializeRuntimeSnapshotForEndpoint(runtimeSnapshot(), endpoint);
      const materializationBudget = refreshRuntimeSnapshotMaterialization(endpoint, materialized.delivery);
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: 'runtime.snapshot.get',
        ok: true,
        result: materialized.snapshot,
        materializationBudget: safeClone(materializationBudget || null),
        consumerFloor: safeClone(materializationBudget?.consumerFloor || null),
      };
      break;
    }
    case 'runtime.status.put': {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: 'runtime.status.put',
        ...handleStatusPut(message, endpoint),
      };
      break;
    }
    case RUNTIME_MEDIA_TRANSPORT_PROFILE_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_MEDIA_TRANSPORT_PROFILE_GET,
        ok: true,
        result: runtimeMediaTransportProfile(),
      };
      break;
    }
    case RUNTIME_MEDIA_TRANSPORT_OBSERVATION_PUT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_MEDIA_TRANSPORT_OBSERVATION_PUT,
        ...handleMediaTransportObservationPut(message),
      };
      break;
    }
    case RUNTIME_MEDIA_FULFILLMENT_EVIDENCE_PUT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_MEDIA_FULFILLMENT_EVIDENCE_PUT,
        ...handleMediaFulfillmentEvidencePut(message),
      };
      break;
    }
    case RUNTIME_APP_INTENT.STREAM_RECOVERY_REQUEST: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_APP_INTENT.STREAM_RECOVERY_REQUEST,
        ...handleRuntimeStreamRecoveryRequest(message),
      };
      break;
    }
    case PROJECTION_PUT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: PROJECTION_PUT,
        ...handleProjectionPut(message),
      };
      break;
    }
    case PROJECTION_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: PROJECTION_GET,
        ...handleProjectionGet(message),
      };
      break;
    }
    case PROJECTION_POLICY_PUT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: PROJECTION_POLICY_PUT,
        ...handleProjectionPolicyPut(message),
      };
      break;
    }
    case RUNTIME_AUTHORITY_DEVICE_PUT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_AUTHORITY_DEVICE_PUT,
        ...(await handleRuntimeAuthorityDevicePut(message)),
      };
      break;
    }
    case RUNTIME_AUTHORITY_POSTURE_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_AUTHORITY_POSTURE_GET,
        ok: true,
        result: await runtimeAuthorityPosture(),
      };
      break;
    }
    case RUNTIME_AUTHORITY_RECORDS_REDUCE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_AUTHORITY_RECORDS_REDUCE,
        ...handleRuntimeAuthorityRecordsReduce(message),
      };
      break;
    }
    case RUNTIME_RESOURCE_PROFILE_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_RESOURCE_PROFILE_GET,
        ok: true,
        result: runtimeResourceProfile(),
      };
      break;
    }
    case RUNTIME_RESOURCE_PROFILE_PUT: {
      const profile = setRuntimeResourceProfile(message);
      recordRuntimeEvent('runtime.resource.profile.updated', {
        profileId: profile.id,
        label: profile.label,
      });
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_RESOURCE_PROFILE_PUT,
        ok: true,
        result: profile,
      };
      break;
    }
    case RUNTIME_RESOURCE_SAMPLE_GET: {
      const debugEnabled = endpoint?.diagnostics === true;
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_RESOURCE_SAMPLE_GET,
        ...(debugEnabled
          ? { ok: true, result: runtimeResourceSample() }
          : { ok: false, error: 'resource sample requires an enabled debug subscriber' }),
      };
      break;
    }
    case RUNTIME_RETENTION_RELEASE_EVALUATE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: RUNTIME_RETENTION_RELEASE_EVALUATE,
        ok: true,
        result: retentionReleaseEvaluation(message),
      };
      break;
    }
    case SERVICE_CATALOG_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SERVICE_CATALOG_GET,
        ok: true,
        result: serviceCatalog(),
      };
      break;
    }
    case SERVICE_NODE_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SERVICE_NODE_GET,
        ok: true,
        result: nodeProjectionForRequest(message),
      };
      break;
    }
    case SWARM_FRAME_QUEUE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_FRAME_QUEUE,
        ...queueSwarmFrame(message),
      };
      break;
    }
    case SWARM_QUEUE_GET: {
      await ensureHydrated().catch(() => false);
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_QUEUE_GET,
        ok: true,
        result: swarmQueueObject(),
      };
      break;
    }
    case SWARM_EDGE_ATTACH: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_ATTACH,
        ...await attachLiveSwarmEdge(message),
      };
      break;
    }
    case SWARM_EDGE_DISCONNECT: {
      closeSwarmEdgeSocket();
      swarmEdge.mode = 'detached';
      swarmEdge.connected = false;
      swarmEdge.endpoint = '';
      swarmEdge.sessionId = '';
      swarmEdge.memberRef = '';
      swarmEdge.zoneScope = null;
      touchRuntime();
      broadcastSnapshot();
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_DISCONNECT,
        ok: true,
        result: edgeSnapshot(),
      };
      break;
    }
    case SWARM_EDGE_TEST_CONNECT: {
      await ensureHydrated().catch(() => false);
      closeSwarmEdgeSocket();
      swarmEdge.mode = 'test';
      swarmEdge.connected = true;
      swarmEdge.endpoint = '';
          swarmEdge.sessionId = String(message.sessionId || 'test-session').trim();
          swarmEdge.zoneScope = safeClone(message.zoneScope || message?.payload?.zoneScope || null);
          sendQueuedSwarmFrames();
          requestRuntimeDirectoryObserve('edge.test.connect');
          void flushPendingRouteIntents('edge.test.connect');
          response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_TEST_CONNECT,
        ok: true,
        result: edgeSnapshot(),
      };
      break;
    }
    case SWARM_EDGE_TEST_DISCONNECT: {
      swarmEdge.connected = false;
      swarmEdge.sessionId = '';
      swarmEdge.zoneScope = null;
      touchRuntime();
      broadcastSnapshot();
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_TEST_DISCONNECT,
        ok: true,
        result: edgeSnapshot(),
      };
      break;
    }
    case SWARM_EDGE_TEST_RECEIVE: {
      await handleEdgeWireMessage(message.record || message.payload || message);
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_TEST_RECEIVE,
        ok: true,
        result: runtimeSnapshot(),
      };
      break;
    }
    case SWARM_EDGE_SENT_GET: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_SENT_GET,
        ok: true,
        result: swarmEdge.sentFrames.map((entry) => safeClone(entry)),
      };
      break;
    }
    case SWARM_EDGE_ACK: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_ACK,
        ...handleSwarmEdgeAck(message),
      };
      break;
    }
    case SWARM_EDGE_REJECT: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: SWARM_EDGE_REJECT,
        ...handleSwarmEdgeReject(message),
      };
      break;
    }
    case PROJECTION_SNAPSHOT_APPLY: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: PROJECTION_SNAPSHOT_APPLY,
        ...handleProjectionSnapshotApply(message),
      };
      break;
    }
    case PROJECTION_DELTA_APPLY: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: PROJECTION_DELTA_APPLY,
        ...handleProjectionDeltaApply(message),
      };
      break;
    }
    case RUNTIME_APP_INTENT.CHANNEL_RESOLVE:
    case RUNTIME_APP_INTENT.PROJECTION_OBSERVE:
    case RUNTIME_APP_INTENT.STREAM_OPEN:
    case RUNTIME_APP_INTENT.STREAM_CONTROL:
    case RUNTIME_APP_INTENT.STREAM_CLOSE:
    case RUNTIME_APP_INTENT.STORAGE_PIN: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: type,
        ...(await queueRuntimeAppIntent(type, message)),
      };
      break;
    }
    case RUNTIME_APP_INTENT.CAPABILITY_RESOLVE: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: type,
        ...(await resolveRuntimeCapability(message)),
      };
      break;
    }
    case 'managedAppliances.sourceSnapshot.put': {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: 'managedAppliances.sourceSnapshot.put',
        ...handleManagedSourceSnapshotPut(message),
      };
      break;
    }
    case 'gateway.grant.request':
    case 'gateway.service.install.request':
    case 'gateway.zones.sync.request': {
      const result = forwardBrokerRequest(type, message, endpoint);
      if (!result.ok) {
        response = {
          type: 'runtime.response',
          requestId: String(message.requestId || '').trim(),
          kind: type,
          ...result,
        };
      }
      break;
    }
    case 'gateway.grant.response': {
      response = {
        type: 'runtime.ack',
        kind: 'gateway.grant.response',
        ...handleBrokerResponse('gateway.grant.request', message),
      };
      break;
    }
    case 'gateway.service.install.response': {
      response = {
        type: 'runtime.ack',
        kind: 'gateway.service.install.response',
        ...handleBrokerResponse('gateway.service.install.request', message),
      };
      break;
    }
    case 'gateway.zones.sync.response': {
      response = {
        type: 'runtime.ack',
        kind: 'gateway.zones.sync.response',
        ...handleBrokerResponse('gateway.zones.sync.request', message),
      };
      break;
    }
    default: {
      response = {
        type: 'runtime.response',
        requestId: String(message.requestId || '').trim(),
        kind: type,
        ok: false,
        error: `unsupported runtime message: ${type}`,
      };
      break;
    }
  }

  if (response) endpointPost(endpoint, response);
}

function attachSharedPort(port) {
  const endpoint = { port, clientId: '', broker: false, surface: '' };
  port.onmessage = (event) => {
    void handleControlMessage(event.data || {}, endpoint).catch((error) => {
      endpointPost(endpoint, {
        type: 'runtime.response',
        requestId: String(event?.data?.requestId || '').trim(),
        kind: String(event?.data?.type || '').trim(),
        ok: false,
        error: String(error?.message || error || 'runtime failure'),
      });
    });
  };
  port.start();
}

self.onconnect = (event) => {
  const port = event.ports?.[0];
  if (port) attachSharedPort(port);
};
