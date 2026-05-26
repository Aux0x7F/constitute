import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relayRxIngressClassification } from '../runtime-relay-admission.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../app.js'), 'utf8');
const workerSource = readFileSync(resolve(here, '../runtime.worker.js'), 'utf8');
const runtimeContractSource = readFileSync(resolve(here, '../runtime-contract.js'), 'utf8');
const runtimeRelayAdmissionSource = readFileSync(resolve(here, '../runtime-relay-admission.js'), 'utf8');
const relayWorkerSource = readFileSync(resolve(here, '../relay.worker.js'), 'utf8');
const relayOutSource = readFileSync(resolve(here, '../identity/sw/relayOut.js'), 'utf8');
const relayInSource = readFileSync(resolve(here, '../identity/sw/relayIn.js'), 'utf8');
const rpcSource = readFileSync(resolve(here, '../identity/sw/rpc.js'), 'utf8');

test('service node projection can discover retained runtime service records before live identity refresh', () => {
  assert.match(source, /function runtimeOwnedDevicePks\(/);
  assert.match(source, /\.\.\.runtimeOwnedDevicePks\(\)/);
  assert.match(source, /findManagedServiceRecordForService/);
  assert.match(source, /managedServicePkForRecord\(rec\)/);
  assert.match(source, /function retainedProjectionServiceRecord\(/);
  assert.match(source, /async function discoverManagedServiceRecordForService\(/);
  assert.match(source, /await Promise\.all\(gatewayPks\.map\(\(gatewayPk\) => requestGatewayInventoryRefresh\(gatewayPk, \{ force: true \}\)/);
  assert.match(source, /runtimeStatusSnapshot\?\.projections/);
  assert.match(source, /servicePk: projectedService\.servicePk/);
});

test('runtime projection repair queues bounded projection-observe intents', () => {
  assert.match(workerSource, /const PROJECTION_SYNC_REQUEST_TIMEOUT_MS = 45_000/);
  assert.match(workerSource, /queueRuntimeAppIntent\(RUNTIME_APP_INTENT\.PROJECTION_OBSERVE/);
  assert.match(workerSource, /policy: channelPolicy/);
  assert.match(workerSource, /projection\.sync\.intent\.queued/);
});

test('account inventory refresh tracks every managed service surface', () => {
  assert.match(source, /const MANAGED_APP_SURFACES = Object\.freeze\(\{\s+nvr: 'constitute-nvr-ui',\s+logging: 'constitute-logging-ui',\s+\}\)/);
  assert.match(source, /Object\.keys\(MANAGED_APP_SURFACES\)\.some\(\(service\) => !findGatewayHostedServiceRecord\(info\.pk, applianceRecords, service\)\)/);
  assert.doesNotMatch(source, /!findGatewayHostedServiceRecord\(info\.pk, applianceRecords, 'nvr'\)/);
});

test('account runtime publishes cached swarm service records before identity refresh completes', () => {
  assert.match(source, /function currentSwarmDeviceRecords\(\)/);
  assert.match(source, /const cachedRecords = Array\.isArray\(swarm\?\.deviceCache\) \? swarm\.deviceCache : \[\]/);
  assert.match(source, /lastSwarmDevices = currentSwarmDeviceRecords\(\)/);
  assert.match(source, /swarm\.loadDeviceCache\(\);\s+lastSwarmDevices = currentSwarmDeviceRecords\(\);\s+pushRuntimeManagedApplianceSourceSnapshot\(lastIdentity\?\.devices \|\| \[\], lastSwarmDevices\);/);
  assert.match(source, /if \(!runtimeBridge\.ready\) \{\s+window\.setTimeout\(publish, 350\);\s+window\.setTimeout\(publish, 1_500\);\s+\}/);
  assert.match(source, /const publish = \(\) => \{\s+const effectiveSwarmDevices = Array\.isArray\(swarmDevices\) && swarmDevices\.length > 0\s+\? swarmDevices\s+: currentSwarmDeviceRecords\(\)/);
  assert.match(source, /pushRuntimeAuthorityDevice\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(source, /RUNTIME_AUTHORITY_DEVICE_PUT/);
  assert.match(workerSource, /const RUNTIME_AUTHORITY_DEVICE_PUT = 'runtime\.authority\.device\.put'/);
  assert.match(source, /pushRuntimeManagedApplianceSourceSnapshot\(lastIdentity\?\.devices \|\| \[\], lastSwarmDevices \|\| \[\]\)/);
});

test('account bridge and shared runtime use the same worker build id', () => {
  assert.match(source, /accountRuntimeClientModule\.createRuntimeSurfaceClient/);
  assert.doesNotMatch(source, /runtime-surface-client\.js/);
  assert.match(source, /from '\.\/runtime-contract\.js'/);
  assert.match(runtimeContractSource, /PLATFORM_RUNTIME_VERSION = Object\.freeze\(\{ major: 2, minor: 61 \}\)/);
  assert.match(workerSource, /const RUNTIME_VERSION = Object\.freeze\(\{ major: 2, minor: 61 \}\)/);
  assert.match(runtimeContractSource, /target\.searchParams\.set\("v", PLATFORM_RUNTIME_BUILD_ID\)/);
  assert.match(source, /accountRuntimeWorkerScriptUrl\(window\.location\.origin\)/);
  assert.match(source, /workerName: runtimeSharedWorkerName\(\)/);
});

test('account bridge attaches swarm edge in the gateway advertised zone', () => {
  assert.match(source, /function swarmEdgeAttachZoneScopeForGateway\(record\)/);
  assert.match(source, /gatewayDirectoryEntryForRecord\(record\)/);
  assert.match(source, /normalizeSwarmEdgeZoneScope\(directoryEntry\?\.zone/);
  assert.match(source, /function runtimeEdgeMemberRef\(\) \{\s+const candidates = \[\s+runtimeAuthorityDevicePk,\s+lastDeviceState\?\.pk,\s+lastDeviceState\?\.devicePk,/);
  assert.doesNotMatch(source, /lastIdentity\?\.linked && identityId\) return identityId/);
  assert.match(source, /const accountBridgeMode = urlParams\.get\('bridge'\) === '1'/);
  assert.match(source, /async function attachRuntimeSwarmEdgeIfAvailable\(\) \{\s+if \(accountBridgeMode\) return;/);
  assert.match(source, /const memberRef = runtimeEdgeMemberRef\(\);\s+if \(!memberRef\) return;/);
  assert.match(source, /const zoneScope = swarmEdgeAttachZoneScopeForGateway\(gateway\)/);
  assert.match(source, /record\?\.swarmEdgeEndpoint/);
  assert.match(source, /directoryEntry\?\.swarmEdgeEndpoint/);
  for (const retired of [
    ['swarmEdge', 'Url'].join(''),
    ['swarm_edge', 'url'].join('_'),
    ['swarmEdge', '?', '.', 'url'].join(''),
  ]) {
    assert.equal(source.includes(retired), false);
  }
  assert.match(source, /const target = `\$\{edgeEndpoint\}\|\$\{memberRef\}\|\$\{zoneScope\.zoneId \|\| ''\}`/);
  assert.match(source, /const RUNTIME_SWARM_EDGE_ATTACH_RETRY_MS = 30_000/);
  assert.match(source, /const recentlyAttemptedSameTarget = runtimeEdgeAttachTarget === target && \(now - runtimeEdgeAttachAttemptedAt\) < RUNTIME_SWARM_EDGE_ATTACH_RETRY_MS/);
  assert.match(source, /runtimeEdgeAttachBackoffUntil > now/);
  assert.match(source, /runtimeEdgeAttachFailureCount \+= 1/);
  assert.match(source, /runtimeEdgeAttachTarget === target && String\(edge\.endpoint \|\| ''\) === edgeEndpoint/);
  assert.match(source, /if \(recentlyAttemptedSameTarget\) return/);
  assert.doesNotMatch(source, /runtimeEdgeAttachTarget === target && edge\.connected && String\(edge\.endpoint \|\| ''\) === edgeEndpoint/);
  assert.match(source, /await runtimeBridge\.attachSwarmEdge\(\{ swarmEdgeEndpoint: edgeEndpoint, memberRef, zoneScope \}\)/);
  assert.doesNotMatch(source, /capabilityRefs:\s*\[/);
  assert.doesNotMatch(source, /channelRefs:\s*\[/);
  assert.match(workerSource, /const RUNTIME_SWARM_RECEIVE_CAPABILITY_REFS = \[/);
  assert.match(workerSource, /SWARM\.CORE_CAPABILITY\.STREAM_SESSION_OFFER/);
  assert.match(workerSource, /SWARM\.CORE_CAPABILITY\.STREAM_SESSION_CONTROL/);
  assert.match(workerSource, /'swarm\.route'/);
  assert.match(workerSource, /const RUNTIME_SWARM_RECEIVE_CHANNEL_REFS = \[/);
  assert.match(workerSource, /'logging\.surface'/);
  assert.match(workerSource, /'logging\.health'/);
  assert.match(workerSource, /'logging\.dashboard'/);
  assert.match(workerSource, /'nvr\.health'/);
  assert.match(workerSource, /'nvr\.cameras'/);
  assert.match(workerSource, /'nvr\.cameraNetwork'/);
  assert.match(workerSource, /\.\.\.RUNTIME_SWARM_RECEIVE_CAPABILITY_REFS/);
  assert.match(workerSource, /\.\.\.RUNTIME_SWARM_RECEIVE_CHANNEL_REFS/);
});

test('account bridge coalesces runtime authority device handoff before awaiting worker ack', () => {
  assert.match(source, /if \(runtimeAuthorityDevicePk === pk\) return;\s+runtimeAuthorityDevicePk = pk;\s+await runtimeBridge\.putRuntimeAuthorityDevice\(device\);/);
});

test('runtime authority persistence degrades to cache backup instead of revoking readiness', () => {
  assert.match(workerSource, /let idbError = null;/);
  assert.match(workerSource, /const backupOk = await backupSet\(key, value\)/);
  assert.match(workerSource, /backend: idbError \? 'cacheBackup'/);
  assert.match(workerSource, /if \(!api\?\.open\) return false/);
  assert.match(workerSource, /const cache = await api\.open\(BACKUP_CACHE\)/);
  assert.match(workerSource, /return true;\s+\} catch \{\s+return false;/);
  assert.match(workerSource, /const persistResult = await kvSet\('device', device\)\.catch/);
  assert.match(workerSource, /runtime\.authority\.device\.persist_degraded/);
  assert.match(workerSource, /reason: 'indexedDbWriteTimedOut'/);
  assert.match(workerSource, /recordRuntimeEvent\('runtime\.authority\.device\.ready'/);
});

test('account bridge backpressures relay ingress instead of unbounded service-worker calls', () => {
  assert.match(source, /from '\.\/runtime-relay-admission\.js'/);
  assert.match(runtimeRelayAdmissionSource, /import \{ SWARM, assertEventAdmissionEnvelope, assertIngressLanePosture \} from 'constitute-protocol'/);
  assert.match(runtimeRelayAdmissionSource, /export const RELAY_RX_FORWARD_TIMEOUT_MS = 5_000/);
  assert.match(runtimeRelayAdmissionSource, /export const RELAY_RX_FORWARD_MAX_IN_FLIGHT = 2/);
  assert.match(runtimeRelayAdmissionSource, /export const RELAY_RX_FORWARD_QUEUE_LIMIT = 32/);
  assert.match(runtimeRelayAdmissionSource, /const RELAY_RX_ACCEPT_WINDOW_SEC = 10 \* 60/);
  assert.match(runtimeRelayAdmissionSource, /const RELAY_RX_FUTURE_SKEW_SEC = 2 \* 60/);
  assert.match(runtimeRelayAdmissionSource, /const RELAY_RX_LANE_PRIORITY = Object\.freeze/);
  assert.match(runtimeRelayAdmissionSource, /const RELAY_RX_APP_PAYLOAD_TYPES = new Set/);
  assert.match(runtimeRelayAdmissionSource, /const RELAY_RX_SELF_ECHO_PAYLOAD_TYPES = new Set/);
  assert.match(runtimeRelayAdmissionSource, /RELAY_RX_SELF_ECHO_PAYLOAD_TYPES\.has\(type\)/);
  assert.match(runtimeRelayAdmissionSource, /reason: 'selfEcho'/);
  assert.match(runtimeRelayAdmissionSource, /payloadZones\.length > 0 && !payloadZones\.some\(\(zone\) => zoneKeys\.has\(zone\)\)/);
  assert.match(runtimeRelayAdmissionSource, /kind: SWARM\.RECORD_KIND\.EVENT_ADMISSION/);
  assert.match(runtimeRelayAdmissionSource, /admission: assertEventAdmissionEnvelope\(\{/);
  assert.match(runtimeRelayAdmissionSource, /assertIngressLanePosture/);
  assert.match(runtimeRelayAdmissionSource, /export function relayRxIngressLanePosture\(\{/);
  assert.match(runtimeRelayAdmissionSource, /kind: SWARM\.RECORD_KIND\.INGRESS_LANE_POSTURE/);
  assert.match(runtimeRelayAdmissionSource, /SWARM\.EVENT_ADMISSION_DECISION\.FORWARD/);
  assert.match(runtimeRelayAdmissionSource, /SWARM\.EVENT_PROOF_REQUIREMENT\.SIGNATURE/);
  assert.match(runtimeRelayAdmissionSource, /export function relayRxIngressClassification\(data, options = \{\}\)/);
  assert.match(relayWorkerSource, /relayRxIngressClassification,/);
  assert.match(relayWorkerSource, /relayRxIngressLanePosture,/);
  assert.match(relayWorkerSource, /function classifyRelayWorkerFrame\(frame, observedAt = Date\.now\(\)\)/);
  assert.match(relayWorkerSource, /relayRxIngressClassification\(frame, \{\s+observedAt,\s+context: relayAdmissionContext,/);
  assert.match(relayWorkerSource, /function normalizeRelayAdmissionContext\(input = \{\}\)/);
  assert.match(relayWorkerSource, /if \(msg\.type === 'relay\.context'\)/);
  assert.match(relayWorkerSource, /relayAdmissionContext = normalizeRelayAdmissionContext\(msg\.context \|\| relayAdmissionContext\)/);
  assert.match(relayWorkerSource, /function relayIngressSnapshot\(\)/);
  assert.match(relayWorkerSource, /kind: 'relay\.ingress\.snapshot'/);
  assert.match(relayWorkerSource, /relayRxIngressLanePosture\(\{/);
  assert.match(relayWorkerSource, /laneKind: 'drop-before-app'/);
  assert.match(relayWorkerSource, /type: 'relay\.ingress\.status'/);
  assert.match(relayWorkerSource, /ingress: relayIngressSnapshot\(\)/);
  assert.match(relayWorkerSource, /if \(!classification\.accepted\) return;/);
  assert.match(relayWorkerSource, /broadcast\(\{ type: 'relay\.rx', data, url: relay\.url, workerAdmission: classification \}\)/);
  assert.match(source, /new Worker\(scriptUrl, \{\s+type: 'module',\s+name: `constitute-account-relay-dedicated-\$\{SHELL_BUILD_ID\}`,\s+\}\)/);
  assert.doesNotMatch(source, /kind: 'event\.admission'/);
  assert.doesNotMatch(source, /proofRequirement: accepted \? 'signature' : 'none'/);
  assert.match(source, /if \(msg\.type === 'relay\.ingress\.status'\)/);
  assert.match(source, /relayPoolSnapshot = \{ \.\.\.relayPoolSnapshot, ingress: msg\.ingress \}/);
  assert.match(source, /window\.__constituteRelayIngress = msg\.ingress/);
  assert.match(source, /window\.__constituteRelayAppIngress = \{/);
  assert.match(source, /function relayAdmissionContext\(\)/);
  assert.match(source, /zoneKeys: installZoneKeys\(\)/);
  assert.match(source, /type: 'relay\.context'/);
  assert.match(source, /updateAdmissionContext: publishRelayAdmissionContext/);
  assert.match(source, /acceptedByReason: \{ \.\.\.relayRxAppIngressCounters\.acceptedByReason \}/);
  assert.match(source, /filteredByReason: \{ \.\.\.relayRxAppIngressCounters\.filteredByReason \}/);
  assert.match(source, /function forwardRelayRxToServiceWorker\(msg\)/);
  assert.match(source, /function drainRelayRxForwardQueue\(\)/);
  assert.match(source, /function findRelayRxEvictionIndex\(nextPriority\)/);
  assert.match(source, /const classification = classifyRelayRxIngress\(msg\.data\)/);
  assert.match(source, /if \(!classification\.accepted\)/);
  assert.match(source, /relayRxForwardInFlight >= RELAY_RX_FORWARD_MAX_IN_FLIGHT/);
  assert.match(source, /relayRxForwardQueue\.push\(entry\)/);
  assert.match(source, /admission: entry\.classification\.admission/);
  assert.match(source, /client\.call\('relay\.rx', \{\s+data: msg\.data,\s+url: msg\.url \|\| '',\s+admission: entry\.classification\.admission,/);
  assert.match(relayInSource, /function admissionAllowsRelayEvent\(admission, ev\)/);
  assert.match(relayInSource, /if \(!admissionAllowsRelayEvent\(admission, ev\)\) return/);
  assert.match(rpcSource, /handleRelayFrame\(sw, params\?\.data \|\| '', params\?\.admission \|\| null\)/);
  assert.doesNotMatch(source, /client\.call\('relay\.rx', \{ data: msg\.data, url: msg\.url \|\| '' \}, \{ timeoutMs: 20000 \}\)/);
});

test('gateway grant view refresh is owner-scoped, cached, and coalesced', () => {
  assert.match(source, /const GATEWAY_GRANT_VIEW_REFRESH_TTL_MS = 60_000/);
  assert.match(source, /const gatewayGrantViewCache = new Map\(\)/);
  assert.match(source, /const gatewayGrantViewInFlight = new Map\(\)/);
  assert.match(source, /function shouldOwnGatewayGrantViewRefresh\(\)/);
  assert.match(source, /relayBridge\.isOwner\?\.\(\) === true/);
  assert.match(source, /function requestGatewayGrantViewAction\(record, opts = \{\}\)/);
  assert.match(source, /if \(existing\) return await existing/);
  assert.match(source, /gatewayGrantViewCache\.set\(key, \{ updatedAt: Date\.now\(\), result \}\)/);
  assert.match(source, /if \(opts\?\.force !== true && !shouldOwnGatewayGrantViewRefresh\(\)\) return/);
  assert.match(source, /isOwner: \(\) => relayBridgeOwner/);
  assert.match(source, /invalidateGatewayGrantViewCache\(\{/);
  assert.match(source, /requestGatewayGrantViewAction\(rec, \{\s+action: 'list_shared'/);
  assert.match(source, /requestGatewayGrantViewAction\(hostedNvr, \{\s+action: 'list_grants'/);
});

test('relay subscription does not replay events the service worker will reject as stale', () => {
  assert.match(relayOutSource, /const RELAY_SUBSCRIPTION_WINDOW_SEC = 10 \* 60/);
  assert.match(relayOutSource, /const RELAY_SCOPED_FILTER_LIMIT = 120/);
  assert.match(relayOutSource, /const since = nowSec\(\) - RELAY_SUBSCRIPTION_WINDOW_SEC/);
  assert.match(relayOutSource, /function subscriptionFilters\(ident, dev, zones = \[\]\)/);
  assert.match(relayOutSource, /'#p': \[devicePk\]/);
  assert.match(relayOutSource, /'#i': \[identityLabel\]/);
  assert.match(relayOutSource, /'#z': \[key\]/);
  assert.match(relayOutSource, /\{ kinds: \[30078\], '#t': \[DISCOVERY_TAG\], since, limit: RELAY_DISCOVERY_FILTER_LIMIT \}/);
  assert.match(relayOutSource, /function inferredAppTags\(payloadObj = \{\}\)/);
  assert.match(relayOutSource, /tags: normalizeTags\(\[\['t', APP_TAG\], \.\.\.inferredAppTags\(payloadObj\), \.\.\.extraTags\]\)/);
  assert.match(relayOutSource, /sent REQ subscribe since=\$\{since\} filters=\$\{filters\.length\}/);
});

test('relay admission filters wrong-zone events before proof work', () => {
  const now = Math.floor(Date.now() / 1000);
  const frame = JSON.stringify(['EVENT', 'sub', {
    id: 'event-zone-mismatch',
    kind: 1,
    created_at: now,
    pubkey: 'peer-pk',
    tags: [['t', 'constitute'], ['z', 'zone-b']],
    content: JSON.stringify({ type: 'zone_presence', zone: 'zone-b', identity: 'Aux' }),
  }]);
  const mismatch = relayRxIngressClassification(frame, {
    observedAt: now * 1000,
    context: { memberRef: 'local-device', identity: 'Aux', zoneKeys: ['zone-a'] },
  });
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.reason, 'targetMismatch');

  const match = relayRxIngressClassification(frame, {
    observedAt: now * 1000,
    context: { memberRef: 'local-device', identity: 'Aux', zoneKeys: ['zone-b'] },
  });
  assert.equal(match.accepted, true);
  assert.equal(match.lane, 'account');
});

test('runtime worker does not block local projection and status messages on hydration', () => {
  assert.doesNotMatch(workerSource, /await ensureHydrated\(\);/);
  assert.match(workerSource, /A slow bootstrap path should\s+\/\/ never make local runtime put\/get messages time out\./);
  assert.match(workerSource, /case 'runtime\.status\.put':/);
  assert.match(workerSource, /case 'managedAppliances\.sourceSnapshot\.put':/);
  assert.match(workerSource, /case PROJECTION_PUT:/);
  assert.match(workerSource, /case RUNTIME_APP_INTENT\.PROJECTION_OBSERVE:/);
});

test('runtime hydration does not restore volatile queue or diagnostics across build ids', () => {
  assert.match(workerSource, /const persistedBuildId = String\(meta\?\.buildId \|\| ''\)\.trim\(\)/);
  assert.match(workerSource, /const sameRuntimeBuild = !persistedBuildId \|\| persistedBuildId === RUNTIME_WORKER_BUILD_ID/);
  assert.match(workerSource, /if \(sameRuntimeBuild\) \{\s+runtimeEvents\.splice\(/);
  assert.match(workerSource, /outboundSwarmFrames\.clear\(\);\s+if \(sameRuntimeBuild\) \{/);
});

test('runtime snapshots expose broker availability without leaking request payloads', () => {
  assert.match(workerSource, /broker: \{\s+available: Boolean\(brokerEndpoint\),\s+surface: String\(brokerEndpoint\?\.surface \|\| ''\)\.trim\(\),\s+\}/);
  assert.match(workerSource, /const brokerWasAvailable = Boolean\(brokerClientId && endpoints\.get\(brokerClientId\)\)/);
  assert.match(workerSource, /if \(brokerWasAvailable !== brokerIsAvailable \|\| entry\?\.broker\) \{\s+broadcastSnapshot\(\);\s+scheduleProjectionSync\(0\);\s+\}/);
  assert.doesNotMatch(workerSource, /broker: \{[^}]*payload/s);
});

test('runtime worker persists retained projections under service identity keys', () => {
  assert.match(workerSource, /const key = projectionStoreKey\(stored\) \|\| stored\.channelId/);
  assert.match(workerSource, /function projectionPolicyId\(/);
  assert.match(workerSource, /\[servicePk \|\| service, channelId, policyId\]/);
  assert.match(workerSource, /retainedProjections\.set\(key,/);
  assert.match(workerSource, /function retainedProjectionObject\(/);
  assert.match(workerSource, /function retainedProjectionStoreObject\(/);
  assert.match(workerSource, /function retainedProjectionCoverageObject\(/);
  assert.match(workerSource, /projections: retainedProjectionStoreObject\(\)/);
  assert.match(workerSource, /projectionCoverage: retainedProjectionCoverageObject\(\)/);
  assert.match(workerSource, /function mergeProjectionRecord\(/);
  assert.match(workerSource, /function mergeProjectionEvents\(/);
  assert.match(workerSource, /function projectionReplacesEventSet\(/);
  assert.match(workerSource, /replacesEventSet\s+\?\s+nextEvents\.slice\(\)\.sort/);
  assert.match(workerSource, /materializedCount: mergedEvents\.length/);
  assert.match(workerSource, /function projectionSemanticallyEqual\(/);
  assert.match(workerSource, /if \(existing && projectionSemanticallyEqual\(existing, storedProjection\)\) \{/);
  assert.match(workerSource, /projection\.observer\.update/);
  assert.match(workerSource, /function storeProjectionRecord\(/);
  assert.match(workerSource, /if \(channelId && !out\[channelId\]\) out\[channelId\] = cloned/);
});

test('runtime retained logging dashboard declares security event fabric posture', () => {
  assert.match(workerSource, /assertAccessGroup/);
  assert.match(workerSource, /assertAccessEpoch/);
  assert.match(workerSource, /assertEventFabricAccessClass/);
  assert.match(workerSource, /assertEventFabricProcessorContract/);
  assert.match(workerSource, /assertCybersecProcessorSeed/);
  assert.match(workerSource, /function runtimeLoggingEventFabricPosture\(/);
  assert.match(workerSource, /function runtimeLoggingEventFabricProcessorContracts\(/);
  assert.match(workerSource, /function runtimeLoggingSecurityProcessorSeed\(/);
  assert.match(workerSource, /accessGroups: \[accessGroup\]/);
  assert.match(workerSource, /accessEpochs: \[accessEpoch\]/);
  assert.match(workerSource, /accessClasses,/);
  assert.match(workerSource, /processorContracts,/);
  assert.match(workerSource, /securityProcessorSeeds,/);
  assert.match(workerSource, /eventFabricAccessGroups: Array\.isArray\(eventFabric\.accessGroups\) \? eventFabric\.accessGroups\.length : 0/);
  assert.match(workerSource, /eventFabricAccessClasses: Array\.isArray\(eventFabric\.accessClasses\) \? eventFabric\.accessClasses\.length : 0/);
  assert.match(workerSource, /eventFabricProcessorContracts: Array\.isArray\(eventFabric\.processorContracts\) \? eventFabric\.processorContracts\.length : 0/);
  assert.match(workerSource, /securityProcessorSeeds: Array\.isArray\(eventFabric\.securityProcessorSeeds\) \? eventFabric\.securityProcessorSeeds\.length : 0/);
  assert.match(workerSource, /processorRoles: \['role:logging\.processor', 'role:security\.processor'\]/);
  assert.match(workerSource, /contentClasses: \['encryptedDetail', 'diagnosticDetail'\]/);
});

test('runtime worker owns projection policy sync instead of UI request assembly', () => {
  assert.match(workerSource, /const PROJECTION_POLICY_PUT = 'projection\.policy\.put'/);
  assert.match(workerSource, /const projectionPolicies = new Map\(\)/);
  assert.match(workerSource, /const pendingProjectionSyncRequests = new Map\(\)/);
  assert.match(workerSource, /function handleProjectionPolicyPut\(/);
  assert.match(workerSource, /function startProjectionSync\(/);
  assert.match(workerSource, /function queueProjectionSyncRequest\(/);
  assert.match(workerSource, /queueRuntimeAppIntent\(RUNTIME_APP_INTENT\.PROJECTION_OBSERVE/);
  assert.match(workerSource, /channelId,\s+service: String\(channelPolicy\.service \|\| ''\)\.trim\(\),\s+nodeRef: nodePath \|\| channelId,/);
  assert.match(workerSource, /function serviceCatalog\(/);
  assert.match(workerSource, /function serviceNodeForPolicy\(/);
  assert.match(workerSource, /const surface = retainedSurfaceForDescriptor\(descriptor\)/);
  assert.match(workerSource, /case PROJECTION_POLICY_PUT:/);
  assert.doesNotMatch(workerSource, /service\.node\.policy\.put/);
  assert.match(workerSource, /case SERVICE_CATALOG_GET:/);
  assert.match(workerSource, /case SERVICE_NODE_GET:/);
  assert.match(workerSource, /function handleRuntimeProjectionSyncResponse\(/);
  assert.match(workerSource, /projection\.sync\.diagnostic/);
  assert.doesNotMatch(workerSource, /LOGGING_SYNC_CHANNELS/);
});

test('runtime worker prepares selected stream operation posture before surface binding', () => {
  assert.match(workerSource, /assertOperationInstancePosture/);
  assert.match(workerSource, /function runtimeStreamOperationInstancePosture\(/);
  assert.match(workerSource, /runtimeStreamSelectedMethodRef\(method\)/);
  assert.match(workerSource, /stream operationRef must be allocated by runtime open-intent posture/);
  assert.match(workerSource, /operationInstancePosture = runtimeStreamOperationInstancePosture\(RUNTIME_APP_INTENT\.STREAM_OPEN, boundIntent/);
  assert.match(workerSource, /operationRef: boundIntent\.operationRef/);
  assert.match(workerSource, /operationClassRef: boundIntent\.operationClassRef/);
  assert.match(workerSource, /methodRef: boundIntent\.methodRef/);
  assert.match(workerSource, /role:runtime:operation-binding/);
  assert.match(workerSource, /role:surface:element-binding/);
  assert.match(workerSource, /surfaceBindingObservationPending/);
  assert.match(workerSource, /surfaceAbsenceDoesNotBlockRuntime: true/);
  assert.match(workerSource, /surfaceDoesNotSupplyFlowTruth: true/);
});
