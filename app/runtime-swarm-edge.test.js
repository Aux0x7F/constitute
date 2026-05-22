import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as protocol from 'constitute-protocol';

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(here, '../runtime.worker.js');
const runtimeShellStatePath = resolve(here, '../runtime-shell-state.js');
const BROWSER_SK = '0000000000000000000000000000000000000000000000000000000000000004';
const GATEWAY_SK = '0000000000000000000000000000000000000000000000000000000000000002';
const SERVICE_SK = '0000000000000000000000000000000000000000000000000000000000000003';
const BROWSER_PK = protocol.pubkeyFromSecretKey(BROWSER_SK);
const GATEWAY_PK = protocol.pubkeyFromSecretKey(GATEWAY_SK);
const SERVICE_PK = protocol.pubkeyFromSecretKey(SERVICE_SK);
const runtimeCleanups = new Set();

test.afterEach(() => {
  for (const cleanup of runtimeCleanups) cleanup();
  runtimeCleanups.clear();
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fakeIndexedDB(store, options = {}) {
  return {
    open() {
      const request = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const tx = {
              objectStore() {
                return {
                  get(key) {
                    const req = {};
                    if (options.stallDeviceGet && key === 'device') return req;
                    setTimeout(() => {
                      req.result = clone(store.get(key));
                      req.onsuccess?.();
                    }, 0);
                    return req;
                  },
                  put(value, key) {
                    store.set(key, clone(value));
                  },
                  delete(key) {
                    store.delete(key);
                  },
                };
              },
              oncomplete: null,
              onerror: null,
              error: null,
            };
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function makePort() {
  return {
    messages: [],
    onmessage: null,
    postMessage(message) {
      this.messages.push(clone(message));
    },
    start() {},
  };
}

function makeRuntimeTimers() {
  const timers = new Set();
  return {
    setTimeout(callback, delay, ...args) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback(...args);
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      clearTimeout(timer);
    },
    cleanup() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

async function waitFor(predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out waiting for runtime message');
}

function loadRuntime(store = new Map(), options = {}) {
  const raw = readFileSync(workerPath, 'utf8');
  const shellStateSource = readFileSync(runtimeShellStatePath, 'utf8')
    .replaceAll('export function ', 'function ');
  if (!options.noDevice && !store.has('device')) {
    store.set('device', {
      nostr: {
        pk: protocol.pubkeyFromSecretKey(BROWSER_SK),
        skHex: BROWSER_SK,
      },
    });
  }
  const source = `${shellStateSource}\n${raw
    .replace(/^import[\s\S]*?from "constitute-protocol";/, 'const { AGREEMENT, FABRIC, PROJECTION, SERVICE_REGISTRY, SWARM, STREAM_SESSION_LIFECYCLE_PHASE, applyProjectionDelta, assertActionAuthorityExercise, assertActionAuthorityGrant, assertAccessGroup, assertAccessEpoch, assertAuthorityGrantRevocationPosture, assertAuthorityMultiIdentityProof, assertAuthorityRootOperation, assertConsumerFloor, assertContractTarget, assertContractTargetRegistryPosture, assertEventAdmissionEnvelope, assertEventFabricAccessClass, assertEventFabricProcessorContract, assertCybersecProcessorSeed, assertMaterializationBudget, assertPrivateContentEnvelope, assertProjectionDelta, assertProjectionPolicy, assertProjectionRecord, assertProjectionSnapshot, assertHostFabricFulfillmentPlan, assertHostFabricMemberContribution, assertLifecyclePlanPosture, assertResolvedMemberRef, assertSubstrateAssociationHandoff, assertProjectionRepairPosture, assertResourcePosture, assertResourceProfile, assertRetentionReleasePosture, assertRoutePromise, assertRuntimeActivationRequest, assertSelfCapabilityAssessment, assertMediaFulfillmentEvidence, assertMediaTransportObservation, assertContributionLifecycle, assertServiceRegistryClaim, assertServiceRegistryMaterialization, assertStreamSessionCandidate, assertSubscriptionContract, assertSwarmActivation, assertSwarmFrame, assertSwarmInteraction, makeLogEventEnvelope, openEnvelope, makeProjectionRepairRequest, makeSwarmFrame, pubkeyFromSecretKey, sealEnvelope, eventPlaneForRecordKind, streamSessionLifecycleRecordFromCarrier, streamSessionLifecyclePhase } = __protocol;')
    .replace(/^import \{ deriveRuntimeShellState \} from "\.\/runtime-shell-state\.js";\s*/m, '')}`;
  const runtimeTimers = makeRuntimeTimers();
  const webSockets = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      webSockets.push(this);
    }

    send(message) {
      this.sent.push(message);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.();
    }
  }
  const self = {
    setTimeout: runtimeTimers.setTimeout,
    clearTimeout: runtimeTimers.clearTimeout,
    crypto: webcrypto,
    location: { hostname: 'localhost' },
    onconnect: null,
  };
  const context = vm.createContext({
    __protocol: protocol,
    indexedDB: options.noIndexedDB ? undefined : fakeIndexedDB(store, options),
    crypto: webcrypto,
    self,
    console,
    setTimeout: runtimeTimers.setTimeout,
    clearTimeout: runtimeTimers.clearTimeout,
    WebSocket: FakeWebSocket,
    Date,
    Math,
    URL,
    structuredClone,
  });
  runtimeCleanups.add(runtimeTimers.cleanup);
  vm.runInContext(source, context, { filename: workerPath });
  const port = makePort();
  self.onconnect({ ports: [port] });
  return { port, store, webSockets };
}

async function send(port, message) {
  const requestId = message.requestId || `${message.type}-${Math.random().toString(36).slice(2)}`;
  port.onmessage({ data: { ...message, requestId } });
  return await waitFor(() => port.messages.find((entry) => entry.requestId === requestId));
}

async function attach(port) {
  port.onmessage({ data: { type: 'runtime.attach', clientId: `test-${Math.random().toString(36).slice(2)}` } });
  return await waitFor(() => port.messages.find((entry) => entry.type === 'runtime.attached'));
}

function gatewayAssociationPosture(now, gatewayPk) {
  const shortGatewayPk = gatewayPk.slice(0, 12);
  const fabricRef = `fabric:gateway:${shortGatewayPk}`;
  const hostRef = `host:gateway:${shortGatewayPk}`;
  const associationRef = `association:gateway:${shortGatewayPk}:ongoing`;
  const handoffId = `handoff:gateway:${shortGatewayPk}:initial-owner`;
  const contributionId = `fabric-contribution:gateway-association:${shortGatewayPk}`;
  const lifecyclePlanId = `lifecycle-plan:gateway-association:${shortGatewayPk}`;
  return {
    substrateAssociationHandoff: {
      kind: protocol.SWARM.RECORD_KIND.SUBSTRATE_ASSOCIATION_HANDOFF,
      handoffId,
      substrateRef: 'substrate:first-trust:gateway',
      hostRef,
      ownerRef: 'identity-1',
      fabricRef,
      state: protocol.FABRIC.ASSOCIATION_HANDOFF_STATE.HANDED_OFF,
      initialAssociationRefs: [`association:substrate:identity-1:${shortGatewayPk}`],
      gatewayAssociationRefs: [associationRef],
      evidenceRefs: [`evidence:gateway-association:${gatewayPk}`],
      blockedReasons: [],
      safeFacts: { handoff: 'substrate-to-gateway-association', role: 'gateway' },
      issuedAt: now - 1,
      handedOffAt: now,
      expiresAt: now + 90_000,
    },
    gatewayAssociationContribution: {
      kind: protocol.SWARM.RECORD_KIND.HOST_FABRIC_MEMBER_CONTRIBUTION,
      contributionId,
      fabricRef,
      hostRef,
      memberRef: gatewayPk,
      role: protocol.FABRIC.MEMBER_ROLE.GATEWAY_ASSOCIATION,
      state: protocol.FABRIC.MEMBER_CONTRIBUTION_STATE.RUNNING,
      contractRef: 'contract:gateway-association@0.1.0',
      subjectRef: associationRef,
      capabilityRefs: ['gateway.association.fulfill'],
      grantRefs: ['grant:gateway-association:identity-1'],
      inputRefs: [handoffId],
      outputRefs: [`projection:gateway-association:${gatewayPk}`],
      evidenceRefs: [`evidence:gateway-presence:${gatewayPk}`],
      lifecyclePlanRefs: [lifecyclePlanId],
      releaseRefs: ['release:gateway:latest'],
      blockedReasons: [],
      safeFacts: { role: protocol.FABRIC.MEMBER_ROLE.GATEWAY_ASSOCIATION },
      observedAt: now,
      expiresAt: now + 90_000,
    },
    lifecyclePlan: {
      kind: protocol.SWARM.RECORD_KIND.LIFECYCLE_PLAN_POSTURE,
      lifecyclePlanId,
      subjectRef: associationRef,
      contractRef: 'contract:lifecycle.gateway-association@0.1.0',
      state: protocol.FABRIC.LIFECYCLE_PLAN_STATE.READY,
      lifecycleContractRefs: ['contract:lifecycle.gateway-association@0.1.0'],
      phasePostures: [
        {
          phase: protocol.FABRIC.LIFECYCLE_PHASE.SOURCE,
          state: protocol.FABRIC.LIFECYCLE_PHASE_STATE.READY,
          evidenceRefs: [`evidence:gateway-source:${gatewayPk}`],
          outputRefs: ['source:gateway:latest'],
          blockedReasons: [],
        },
        {
          phase: protocol.FABRIC.LIFECYCLE_PHASE.RUN,
          state: protocol.FABRIC.LIFECYCLE_PHASE_STATE.RUNNING,
          evidenceRefs: [`evidence:gateway-running:${gatewayPk}`],
          outputRefs: [associationRef],
          blockedReasons: [],
        },
        {
          phase: protocol.FABRIC.LIFECYCLE_PHASE.OBSERVE,
          state: protocol.FABRIC.LIFECYCLE_PHASE_STATE.READY,
          evidenceRefs: [`evidence:gateway-observed:${gatewayPk}`],
          outputRefs: ['projection:gateway-association:hot'],
          blockedReasons: [],
        },
      ],
      memberContributionRefs: [contributionId],
      evidenceRefs: [`evidence:lifecycle:gateway-association:${gatewayPk}`],
      releaseRefs: ['release:gateway:latest'],
      blockedReasons: [],
      observedAt: now,
      expiresAt: now + 90_000,
    },
    fulfillmentPlan: {
      kind: protocol.SWARM.RECORD_KIND.HOST_FABRIC_FULFILLMENT_PLAN,
      planId: `fabric-plan:gateway-association:${shortGatewayPk}`,
      fabricRef,
      hostRef,
      contractRef: 'contract:gateway-association@0.1.0',
      state: protocol.FABRIC.FULFILLMENT_PLAN_STATE.READY,
      requiredRoleRefs: [`role:${protocol.FABRIC.MEMBER_ROLE.GATEWAY_ASSOCIATION}`],
      memberContributionRefs: [contributionId],
      missingRoleRefs: [],
      lifecyclePlanRefs: [lifecyclePlanId],
      materializationBudgetRefs: ['materialization-budget:gateway-association'],
      associationHandoffRef: handoffId,
      evidenceRefs: [`evidence:fabric-plan:${gatewayPk}`],
      blockedReasons: [],
      observedAt: now,
      expiresAt: now + 90_000,
    },
  };
}

async function seedNvrServiceCatalog(port, options = {}) {
  const now = Date.now();
  const gatewayPk = protocol.pubkeyFromSecretKey(GATEWAY_SK);
  const servicePk = protocol.pubkeyFromSecretKey(SERVICE_SK);
  await send(port, {
    type: 'managedAppliances.sourceSnapshot.put',
    sourceSnapshot: {
      identityDevices: options.noIdentityDevices ? [] : [{ pk: BROWSER_PK, identityId: 'identity-1', label: 'Aux' }],
      swarmDevices: [
        {
          devicePk: gatewayPk,
          deviceLabel: 'DevGateway',
          role: 'gateway',
          service: 'gateway',
          identityId: 'identity-1',
          updatedAt: now,
          ...(options.skipGatewayAssociationPosture ? {} : { gatewayAssociationPosture: gatewayAssociationPosture(now, gatewayPk) }),
          hostedServices: [
            {
              devicePk: 'nvr:devgateway',
              servicePk,
              deviceLabel: 'Security Cameras',
              deviceKind: 'service',
              service: 'nvr',
              hostGatewayPk: gatewayPk,
              surfaceChannel: 'nvr.surface',
              swarmEdge: { memberRef: servicePk, serviceRef: `service:nvr:${servicePk}` },
              ...(options.hostedNodes ? { nodes: options.hostedNodes } : {}),
              ...(options.serviceZoneScope ? { zoneScope: options.serviceZoneScope } : {}),
              updatedAt: now,
            },
          ],
        },
      ],
      grantedRecords: [],
    },
  });
  if (!options.skipSurfaceProjection) {
    const projection = {
      channelId: 'nvr.surface',
      service: 'nvr',
      servicePk,
      policyId: 'nvr.surface',
      freshness: { state: 'fresh', updatedAt: now },
      payload: {
        surface: {
          nodes: [
            {
              path: 'cam-1',
              label: 'Front Door',
              channelId: 'nvr.streams',
              fields: [{ capabilities: [protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW] }],
            },
          ],
        },
      },
      safeFacts: {},
      encryptedDetailRefs: [],
      diagnostics: [],
    };
    const stored = await send(port, { type: 'projection.put', projection });
    assert.equal(stored.ok, true);
  }
}

async function seedNvrEdgeDirectory(port, options = {}) {
  const now = Date.now();
  const servicePk = options.servicePk || protocol.pubkeyFromSecretKey(SERVICE_SK);
  const memberRef = options.memberRef || servicePk;
  const zoneScope = options.zoneScope || { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 };
  const serviceIdentity = options.omitServiceIdentity === true
    ? {}
    : { serviceRef: `service:nvr:${servicePk}`, servicePk, service: 'nvr' };
  const capabilityRefs = options.capabilityRefs || [
    protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
    protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
    protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL,
  ];
  const directorySnapshot = {
    projectionId: 'swarm.directory',
    policyId: 'swarm.directory.live',
    revision: now,
    state: {
      directory: {
        classification: {
          directoryTruthSource: 'attachedSessionAdvertisement',
          attachedHelloBoundary: 'attachedSessionObservation',
          recordBackedMembership: false,
        },
        advertisements: [{
          advertisementId: 'ad-nvr-preview',
          capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
          capabilityRefs,
          memberRef,
          ...serviceIdentity,
          zoneScope,
          channelRefs: ['nvr.streams'],
          issuedAt: now,
          expiresAt: now + 90_000,
        }, ...(Array.isArray(options.extraAdvertisements) ? options.extraAdvertisements : [])],
        entries: [{
          entryId: 'entry-nvr-preview',
          capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
          capabilityRefs,
          channelId: 'nvr.streams',
          memberRef,
          ...serviceIdentity,
          zoneScope,
          priority: 10,
        }, ...(Array.isArray(options.extraEntries) ? options.extraEntries : [])],
        channels: [],
        policies: [],
        definitions: [],
        membershipTruth: [],
      },
    },
    coverage: { materializedCount: 1, targetCount: 1, completionRatio: 1, syncState: 'completeEnough' },
    freshness: { state: 'fresh', updatedAt: now },
    sourceRefs: ['gateway-1'],
    issuedAt: now,
  };
  const applied = await send(port, { type: 'projection.snapshot.apply', snapshot: directorySnapshot });
  assert.equal(applied.ok, true);
  return directorySnapshot;
}

async function seedLoggingEdgeDirectory(port, options = {}) {
  const now = Date.now();
  const loggingPk = options.servicePk || SERVICE_PK;
  const memberRef = options.memberRef || loggingPk;
  const zoneScope = options.zoneScope || { zoneId: 'zone_logging', privacy: 'rawIds', ttl: 30, maxHops: 2 };
  const directorySnapshot = {
    projectionId: 'swarm.directory',
    policyId: 'swarm.directory.live',
    revision: now,
    state: {
      directory: {
        classification: {
          directoryTruthSource: 'attachedSessionAdvertisement',
          attachedHelloBoundary: 'attachedSessionObservation',
          recordBackedMembership: false,
        },
        advertisements: [{
          advertisementId: 'ad-logging-events',
          capability: 'logging.events.ingest',
          memberRef,
          serviceRef: `service:logging:${loggingPk}`,
          servicePk: loggingPk,
          zoneScope,
          channelRefs: ['logging.events'],
          issuedAt: now,
          expiresAt: now + 90_000,
        }],
        entries: [{
          entryId: 'entry-logging-events',
          capability: 'logging.events.ingest',
          channelId: 'logging.events',
          memberRef,
          serviceRef: `service:logging:${loggingPk}`,
          servicePk: loggingPk,
          zoneScope,
          priority: 10,
        }],
        channels: [],
        policies: [],
        definitions: [],
        membershipTruth: [],
      },
    },
    coverage: { materializedCount: 1, targetCount: 1, completionRatio: 1, syncState: 'completeEnough' },
    freshness: { state: 'fresh', updatedAt: now },
    sourceRefs: ['gateway-1'],
    issuedAt: now,
  };

  await send(port, {
    type: 'swarm.edge.test.connect',
    zoneScope,
  });
  await send(port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'gateway-logging-directory-frame',
        kind: 'bootstrap.gatewayHint',
        issuer: 'gateway-1',
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        issuedAt: now,
        expiresAt: now + 60_000,
        nonce: 'gateway-logging-directory-nonce',
        correlationId: 'gateway-logging-directory',
        channelId: 'swarm.directory',
        recordRef: { kind: 'structural.diagnostic', id: 'swarm.directory', revision: now },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { snapshot: directorySnapshot },
        },
      },
    },
  });
}

function frameInput(overrides = {}) {
  return {
    kind: protocol.SWARM.FRAME_KIND.SERVICE_INTENT,
    issuer: 'runtime-device-1',
    audience: { serviceRef: 'svc_opaque_test' },
    zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 1 },
    expiresAt: Date.now() + 60_000,
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    channelId: 'test.control',
    capability: protocol.SWARM.CORE_CAPABILITY.SERVICE_INTENT_INVOKE,
    ...overrides,
  };
}

test('queued swarm frame survives runtime restart and reconnect resends it', async () => {
  const store = new Map();
  const first = loadRuntime(store);
  await attach(first.port);
  const queued = await send(first.port, { type: 'swarm.frame.queue', payload: frameInput() });
  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.body.encoding, protocol.SWARM.BODY_ENCODING.CAAC);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = loadRuntime(store);
  await attach(second.port);
  const beforeConnect = await send(second.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(beforeConnect.result).length, 1);

  await send(second.port, { type: 'swarm.edge.test.connect' });
  const sent = await send(second.port, { type: 'swarm.edge.sent.get' });
  assert.equal(sent.result.length, 1);
  assert.equal(sent.result[0].frameId, queued.result.frameId);
});

test('ack records frame intake without clearing route-critical queue state', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    logging: false,
  });
  assert.equal(subscribed.ok, true);
  const queued = await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput() });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });

  const ack = await send(runtime.port, { type: 'swarm.edge.ack', correlationId: queued.result.frameId });
  assert.equal(ack.ok, true);
  const afterAck = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(afterAck.result).length, 1);
  assert.equal(afterAck.result[queued.result.frameId].status, 'observingUnreachable');
  assert.equal(afterAck.result[queued.result.frameId].routeObservation.state, 'observingUnreachable');
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.edge.routeObservations.at(-1).failedPredicates[0], 'zeroPropagation');
  const routeDiagnostic = await waitFor(() => runtime.port.messages.find((entry) => (
    entry.type === 'runtime.diagnostic.event'
    && entry.event?.kind === 'route.observation'
    && entry.event?.safeFacts?.failedPredicates?.[0] === 'zeroPropagation'
  )));
  assert.equal(routeDiagnostic.event.recordKind, 'runtime.diagnostic.event');
  assert.equal(routeDiagnostic.event.channelId, 'runtime.diagnostics');
});

test('expired activations ignore late acks instead of re-opening route churn', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    logging: false,
  });
  assert.equal(subscribed.ok, true);
  const queued = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput({ expiresAt: Date.now() - 1 }),
  });

  const ack = await send(runtime.port, { type: 'swarm.edge.ack', correlationId: queued.result.frameId });
  assert.equal(ack.ok, true);
  assert.equal(ack.result.ignored, true);
  assert.equal(ack.result.status, 'expired');
  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(queue.result[queued.result.frameId].status, 'expired');
  assert.equal(queue.result[queued.result.frameId].retrySuppressed, true);
  assert.equal(queue.result[queued.result.frameId].lastError.code, 'activation.expired');
  assert.equal(queue.result[queued.result.frameId].routeObservation, undefined);
  const ignoredAck = await waitFor(() => runtime.port.messages.find((entry) => (
    entry.type === 'runtime.diagnostic.event'
    && entry.event?.kind === 'frame.ack.ignored'
    && entry.event?.safeFacts?.currentStatus === 'expired'
  )));
  assert.equal(ignoredAck.event.recordKind, 'runtime.diagnostic.event');
});

test('channel-shaped route observations do not mutate unrelated queued activations', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const queued = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput({
      channelId: 'nvr.streams',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      recordRef: { kind: 'stream.session.offer', id: 'nvr.streams', revision: 1 },
    }),
  });
  const before = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(before.result[queued.result.frameId].status, 'queued');

  const now = Date.now();
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'broad-channel-route-observation-frame',
        kind: 'route.observation',
        issuer: 'gateway-1',
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        issuedAt: now,
        expiresAt: now + 60_000,
        nonce: 'broad-channel-route-observation',
        correlationId: 'route-observation-broad-channel',
        channelId: 'swarm.route',
        recordRef: { kind: 'route.observation', id: 'route-observation-broad-channel', revision: now },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: {
            recordKind: 'route.observation',
            record: {
              correlationId: 'nvr.streams',
              state: 'expired',
              message: 'broad channel observation must not own an activation',
            },
          },
        },
      },
    },
  });

  const after = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(after.result[queued.result.frameId].status, 'queued');
  assert.equal(after.result[queued.result.frameId].routeObservation, undefined);
});

test('directory baseline requeues route-unreachable frames without a manual reload', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const queued = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput({
      channelId: 'nvr.streams',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      audience: { servicePk: SERVICE_PK, serviceRef: `service:nvr:${SERVICE_PK}` },
    }),
  });
  await send(runtime.port, { type: 'swarm.edge.test.connect', zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 } });
  await send(runtime.port, { type: 'swarm.edge.ack', correlationId: queued.result.frameId });
  assert.equal((await send(runtime.port, { type: 'swarm.queue.get' })).result[queued.result.frameId].status, 'observingUnreachable');

  const now = Date.now();
  const applied = await send(runtime.port, {
    type: 'projection.snapshot.apply',
    snapshot: {
      projectionId: 'swarm.directory',
      policyId: 'swarm.directory.live',
      revision: now,
      state: {
        directory: {
          entries: [{
            entryId: 'entry-nvr-streams',
            capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
            channelId: 'nvr.streams',
            memberRef: SERVICE_PK,
            serviceRef: `service:nvr:${SERVICE_PK}`,
            servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
            zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
          }],
        },
      },
      coverage: { materializedCount: 1, targetCount: 1, completionRatio: 1, syncState: 'completeEnough' },
      freshness: { state: 'fresh', updatedAt: now },
      sourceRefs: ['gateway-1'],
      issuedAt: now,
    },
  });

  assert.equal(applied.ok, true);
  const sent = await send(runtime.port, { type: 'swarm.edge.sent.get' });
  const streamAttempts = sent.result.filter((entry) => entry.channelId === 'nvr.streams');
  assert.equal(streamAttempts.length, 2);
  assert.equal(streamAttempts[0].frameId, queued.result.frameId);
  assert.notEqual(streamAttempts[1].frameId, queued.result.frameId);
  assert.equal(streamAttempts[1].frame.correlationId, queued.result.frame.correlationId);
  assert.equal(streamAttempts[1].frame.nonce === queued.result.frame.nonce, false);
  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(queue.result).includes(queued.result.frameId), false);
  assert.equal(queue.result[streamAttempts[1].frameId].status, 'sent');
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.runtimeEvents.some((entry) => entry.kind === 'route.repair.queued'), true);
  assert.equal(snapshot.result.runtimeEvents.some((entry) => entry.kind === 'frame.retry.prepared'), true);
});

test('runtime diagnostics stream replays recent events and snapshot debug payload is bounded', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  for (let index = 0; index < 45; index += 1) {
    await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: `diag-${index}` }) });
  }
  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 20,
    logging: false,
  });
  assert.equal(subscribed.ok, true);
  const replay = await waitFor(() => runtime.port.messages.find((entry) => entry.type === 'runtime.diagnostics.events'));
  assert.equal(replay.events.length, 20);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.ok(snapshot.result.runtimeEvents.length <= 30);
  assert.equal(snapshot.result.diagnostics.runtimeSessionId, replay.runtimeSessionId);
});

test('runtime attach declares snapshot materialization budget per surface', async () => {
  const runtime = loadRuntime(new Map());
  for (let index = 0; index < 6; index += 1) {
    await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: `attach-materialization-${index}` }) });
  }
  runtime.port.onmessage({
    data: {
      type: 'runtime.attach',
      clientId: 'surface-materialization-test',
      surface: 'logging-ui',
      snapshotSubscription: { mode: 'push', replayLimit: 1, snapshotMaxBytes: 128_000 },
    },
  });
  const attached = await waitFor(() => runtime.port.messages.find((entry) => entry.type === 'runtime.attached'));
  assert.equal(attached.materializationBudget.kind, 'materialization.budget');
  assert.equal(attached.materializationBudget.payloadClass, 'projection');
  assert.equal(attached.materializationBudget.copyRole, 'projection');
  assert.equal(attached.materializationBudget.privacyTier, 'safeProjection');
  assert.equal(attached.snapshot.runtimeEvents.length <= 1, true);
  assert.equal(attached.snapshot.materialization.delivery.droppedByReplayLimit >= 5, true);
  assert.equal(attached.materializationBudget.limits.replayLimit, 1);
  assert.equal(attached.materializationBudget.limits.deliveredRuntimeEventCount, attached.snapshot.runtimeEvents.length);
  assert.equal(attached.materializationBudget.limits.estimatedSnapshotBytes > 0, true);
  assert.equal(attached.consumerFloor.kind, 'consumer.floor');
  assert.equal(attached.consumerFloor.materializationId, attached.materializationBudget.budgetId);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.runtimeEvents.length <= 1, true);
  assert.equal(snapshot.result.materialization.delivery.deliveredRuntimeEventCount, snapshot.result.runtimeEvents.length);
  assert.equal(snapshot.result.diagnostics.materialization.some((entry) => (
    entry.budgetId === attached.materializationBudget.budgetId
      && entry.clientId === 'surface-materialization-test'
  )), true);
  assert.equal(snapshot.result.materialization.kind, 'runtime.materialization.summary');
  assert.equal(snapshot.result.materialization.state, 'withinBudget');
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.projections.retained'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.events.ring'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.queue.outbound'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.swarmEdge.observations'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.activations.read-model'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.media.fulfillment'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.stream.recovery'), true);
  assert.equal(snapshot.result.materialization.budgets.some((entry) => entry.budgetId === 'runtime.retained.catalog'), true);
  assert.equal(snapshot.result.materialization.readModels.some((entry) => (
    entry.budgetId === 'runtime.queue.outbound'
      && entry.payloadClass === 'control'
      && entry.copyRole === 'buffer'
  )), true);
  assert.equal(snapshot.result.materialization.byPayloadClass.projection >= 1, true);
  assert.equal(snapshot.result.materialization.byCopyRole.buffer >= 1, true);
  assert.equal(snapshot.result.materialization.byTransferMode.clone >= 1, true);
  assert.equal(snapshot.result.productShellState.materialization.state, 'withinBudget');
  assert.equal(snapshot.result.resource.kind, 'runtime.resource.postureSummary');
  assert.equal(snapshot.result.resource.cleanupAllowed, false);
  assert.equal(snapshot.result.retention.kind, 'runtime.retention.postureSummary');
  assert.equal(snapshot.result.retention.releaseRequired, true);
});

test('runtime diagnostics subscription filters by event plane before replay and delivery', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  for (let index = 0; index < 6; index += 1) {
    await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: `diag-filter-${index}` }) });
  }
  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-filter-test',
    surface: 'runtime-filter-test',
    limit: 20,
    subscription: {
      planes: ['diagnostic'],
      cost: { minLevel: 'debug' },
      window: { replayLimit: 20 },
    },
  });
  assert.equal(subscribed.ok, true);
  assert.deepEqual(subscribed.result.subscription.planes, ['diagnostic']);
  assert.equal(subscribed.result.materializationBudget.kind, 'materialization.budget');
  assert.equal(subscribed.result.materializationBudget.payloadClass, 'evidence');
  assert.equal(subscribed.result.materializationBudget.consumerFloor.kind, 'consumer.floor');
  const replay = await waitFor(() => runtime.port.messages.find((entry) => entry.type === 'runtime.diagnostics.events'));
  assert.equal(replay.materializationBudget.budgetId, subscribed.result.materializationBudget.budgetId);
  assert.equal(replay.consumerFloor.materializationId, replay.materializationBudget.budgetId);
  assert.equal(replay.events.some((event) => event.kind === 'frame.queued'), false);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.ok(snapshot.result.diagnostics.eventAdmission.replayFiltered >= 1);
  assert.equal(snapshot.result.diagnostics.materialization.some((entry) => entry.budgetId === subscribed.result.materializationBudget.budgetId), true);
});

test('debug diagnostics sink queues sealed logging events without raw unsafe payloads', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedLoggingEdgeDirectory(runtime.port);
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 10,
    logging: true,
  });
  const sinkSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(sinkSnapshot.result.diagnostics.loggingSink.materializationBudget.kind, 'materialization.budget');
  assert.equal(sinkSnapshot.result.diagnostics.loggingSink.materializationBudget.copyRole, 'buffer');
  assert.equal(sinkSnapshot.result.diagnostics.materialization.some((entry) => (
    entry.budgetId === sinkSnapshot.result.diagnostics.loggingSink.materializationBudget.budgetId
  )), true);
  let queue = null;
  for (let attempt = 0; attempt < 20 && !queue; attempt += 1) {
    const response = await send(runtime.port, { type: 'swarm.queue.get' });
    queue = Object.values(response.result).find((entry) => entry?.frame?.channelId === 'logging.events') || null;
    if (!queue) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(queue);
  assert.equal(queue.frame.capability, 'logging.events.ingest');
  assert.equal(queue.frame.body.encoding, protocol.SWARM.BODY_ENCODING.CAAC);
  const opened = protocol.openEnvelope(queue.frame.body.envelope, SERVICE_SK);
  assert.equal(opened.method, 'runtime.diagnostics.log');
  assert.equal(opened.payload.recordKind, 'logging.event');
  protocol.assertLogEventEnvelope(opened.payload.record);
  const safeFacts = opened.payload.record.safeFacts;
  assert.ok(['runtime.attach', 'runtime.diagnostics.subscribe', 'frame.queued', 'adapter.edge.attach'].includes(safeFacts.kind));
  assert.equal(JSON.stringify(safeFacts).includes('rtsp://'), false);
});

test('debug diagnostics sink buffers until logging is routable, then catches up', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 10,
    logging: true,
  });
  await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: 'diag-buffer-before-route' }) });

  const beforeRoute = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.values(beforeRoute.result).some((entry) => entry?.frame?.channelId === 'logging.events'), false);
  assert.ok(beforeRoute.result[Object.keys(beforeRoute.result)[0]]);

  await seedLoggingEdgeDirectory(runtime.port);
  let queuedLogFrames = [];
  for (let attempt = 0; attempt < 30 && queuedLogFrames.length === 0; attempt += 1) {
    const response = await send(runtime.port, { type: 'swarm.queue.get' });
    queuedLogFrames = Object.values(response.result).filter((entry) => entry?.frame?.channelId === 'logging.events');
    if (!queuedLogFrames.length) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(queuedLogFrames.length >= 1);
  const opened = protocol.openEnvelope(queuedLogFrames[0].frame.body.envelope, SERVICE_SK);
  assert.equal(opened.method, 'runtime.diagnostics.log');
  assert.equal(opened.payload.recordKind, 'logging.event');
  protocol.assertLogEventEnvelope(opened.payload.record);
  assert.ok(['runtime.attach', 'runtime.diagnostics.subscribe', 'frame.queued', 'adapter.edge.attach'].includes(opened.payload.record.safeFacts.kind));
  assert.equal(opened.payload.record.occurredAt < 10_000_000_000, true);
});

test('debug diagnostics sink releases when subscriber opts out', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 10,
    logging: true,
  });
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 10,
    logging: false,
  });
  await seedLoggingEdgeDirectory(runtime.port);
  await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: 'diag-after-opt-out' }) });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.values(queue.result).some((entry) => entry?.frame?.channelId === 'logging.events'), false);
});

test('debug diagnostics sink requests swarm directory before a logging route is known', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    limit: 10,
    logging: true,
  });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_logging', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });

  let directoryFrame = null;
  for (let attempt = 0; attempt < 30 && !directoryFrame; attempt += 1) {
    const sent = await send(runtime.port, { type: 'swarm.edge.sent.get' });
    directoryFrame = sent.result.find((entry) => entry?.frame?.channelId === 'swarm.directory')?.frame || null;
    if (!directoryFrame) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(directoryFrame);
  assert.equal(directoryFrame.kind, protocol.SWARM.FRAME_KIND.CHANNEL_OBSERVE);
  assert.equal(directoryFrame.capability, protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE);
  assert.equal(directoryFrame.audience.directory, 'capability');

  const beforeRoute = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.values(beforeRoute.result).some((entry) => entry?.frame?.channelId === 'logging.events'), false);

  await seedLoggingEdgeDirectory(runtime.port);
  let queuedLogFrames = [];
  for (let attempt = 0; attempt < 30 && queuedLogFrames.length === 0; attempt += 1) {
    const response = await send(runtime.port, { type: 'swarm.queue.get' });
    queuedLogFrames = Object.values(response.result).filter((entry) => entry?.frame?.channelId === 'logging.events');
    if (!queuedLogFrames.length) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(queuedLogFrames.length >= 1);
});

test('debug diagnostics sink yields while edge control plane is busy', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.match(source, /function markRuntimeControlPlaneBusy\(durationMs = 5000\)/);
  assert.match(source, /if \(runtimeControlPlaneBusy\(\)\) \{\s+scheduleDiagnosticLoggingFlush\(2000\);\s+return;\s+\}/);
  assert.match(source, /markRuntimeControlPlaneBusy\(15_000\);/);
  assert.match(source, /clearRuntimeControlPlaneBusy\(\);/);
});

test('runtime diagnostic commands are allowlisted, replay-safe, and redact unsafe details', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const disabled = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'dumpRecentEvents',
    nonce: 'disabled-nonce',
    expiresAt: Date.now() + 30_000,
  });
  assert.equal(disabled.ok, false);
  assert.match(disabled.error, /enabled debug subscriber/);
  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    logging: false,
  });
  const expired = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'dumpRecentEvents',
    nonce: 'expired-nonce',
    expiresAt: Date.now() - 1,
  });
  assert.equal(expired.ok, false);
  assert.match(expired.error, /expired/);
  const command = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'openTestActivation',
    nonce: 'safe-nonce',
    expiresAt: Date.now() + 30_000,
    args: {
      payload: { raw: true },
      sdp: 'v=0',
      cameraUrl: 'rtsp://camera.local/stream',
      safeCounter: 1,
    },
  });
  assert.equal(command.ok, true);
  const replay = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'openTestActivation',
    nonce: 'safe-nonce',
    expiresAt: Date.now() + 30_000,
  });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /replayed/);
  const unsafeEvent = await waitFor(() => runtime.port.messages.find((entry) => (
    entry.type === 'runtime.diagnostic.event'
    && entry.event?.kind === 'runtime.diagnostics.openTestActivation'
  )));
  assert.equal(unsafeEvent.event.safeFacts.args.payload, '[redacted]');
  assert.equal(unsafeEvent.event.safeFacts.args.sdp, '[redacted]');
  assert.equal(unsafeEvent.event.safeFacts.args.cameraUrl, '[redacted]');
  assert.equal(unsafeEvent.event.safeFacts.args.safeCounter, 1);

  const dump = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'dumpRecentEvents',
    nonce: 'dump-materialization-nonce',
    expiresAt: Date.now() + 30_000,
    args: {
      kind: 'runtime.diagnostics.openTestActivation',
      limit: 10,
    },
  });
  assert.equal(dump.ok, true);
  assert.equal(dump.result.result.materializationBudget.kind, 'materialization.budget');
  assert.equal(dump.result.result.consumerFloor.kind, 'consumer.floor');
  assert.equal(dump.result.result.materializationBudget.copyRole, 'evidence');
  assert.equal(dump.result.result.events.every((event) => event.kind === 'runtime.diagnostics.openTestActivation'), true);
  const materialized = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(materialized.result.diagnostics.materialization.some((entry) => (
    entry.budgetId === dump.result.result.materializationBudget.budgetId
  )), true);
});

test('reject surfaces structured errors and honors retry preservation policy', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const preserved = await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput() });
  const retryReject = await send(runtime.port, {
    type: 'swarm.edge.reject',
    correlationId: preserved.result.frameId,
    error: { code: 'invalidAudience', message: 'invalid audience', retryable: true },
  });
  assert.equal(retryReject.ok, true);
  assert.equal(retryReject.result.preserved, true);
  assert.deepEqual(retryReject.result.error, { code: 'invalidAudience', message: 'invalid audience', retryable: true });
  const afterPreserve = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(afterPreserve.result).length, 1);

  const dropped = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput(),
    retryPolicy: { onReject: 'drop' },
  });
  const terminalReject = await send(runtime.port, {
    type: 'swarm.edge.reject',
    correlationId: dropped.result.frameId,
    error: { code: 'expiredClaims', message: 'expired claims', retryable: false },
  });
  assert.equal(terminalReject.ok, true);
  assert.equal(terminalReject.result.preserved, false);
  const afterDrop = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(afterDrop.result).includes(dropped.result.frameId), false);
});

test('route-critical observations and rejects suppress unchanged resend attempts', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const queued = await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput() });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });
  assert.equal((await send(runtime.port, { type: 'swarm.edge.sent.get' })).result.length, 1);

  await send(runtime.port, { type: 'swarm.edge.test.disconnect' });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });
  assert.equal(
    (await send(runtime.port, { type: 'swarm.edge.sent.get' })).result
      .filter((entry) => entry.frameId === queued.result.frameId)
      .length,
    1,
  );

  await send(runtime.port, { type: 'swarm.edge.ack', correlationId: queued.result.frameId });
  await send(runtime.port, { type: 'swarm.edge.test.disconnect' });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });
  assert.equal(
    (await send(runtime.port, { type: 'swarm.edge.sent.get' })).result
      .filter((entry) => entry.frameId === queued.result.frameId)
      .length,
    1,
  );

  const retryable = await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput() });
  await send(runtime.port, {
    type: 'swarm.edge.reject',
    correlationId: retryable.result.frameId,
    error: { code: 'temporaryRouteFailure', message: 'candidate is stale', retryable: true },
  });
  await send(runtime.port, { type: 'swarm.edge.test.disconnect' });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });
  assert.equal(
    (await send(runtime.port, { type: 'swarm.edge.sent.get' })).result
      .filter((entry) => entry.frameId === retryable.result.frameId)
      .length,
    1,
  );
  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(queue.result[retryable.result.frameId].status, 'rejected');
  assert.equal(queue.result[retryable.result.frameId].retrySuppressed, true);
});

test('app intent RPCs enqueue CAAC swarm frames', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const methods = [
    'runtime.channel.resolve',
    'runtime.projection.observe',
    'runtime.stream.open',
    'runtime.stream.control',
    'runtime.stream.close',
    'runtime.storage.pin',
  ];

  for (const method of methods) {
    const queued = await send(runtime.port, {
      type: method,
      payload: {
        service: 'nvr',
        servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
        gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
        identityId: 'identity-1',
        owner: true,
        viewSources: ['cam-1'],
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 1 },
        channelId: `${method}.channel`,
        intentId: `${method}.intent`,
        offer: method === 'runtime.stream.open' ? { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] } : undefined,
      },
    });
    assert.equal(queued.ok, true);
    assert.equal(queued.result.frame.body.encoding, protocol.SWARM.BODY_ENCODING.CAAC);
    const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
    assert.equal(opened.method, method);
    assert.equal(opened.authority.devicePk, protocol.pubkeyFromSecretKey(BROWSER_SK));
    assert.equal(opened.activation.kind, protocol.SWARM.RECORD_KIND.RUNTIME_ACTIVATION_REQUEST);
    assert.equal(opened.interaction.kind, protocol.SWARM.RECORD_KIND.SWARM_INTERACTION);
    assert.equal(opened.interaction.routingScope.kind, protocol.SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE);
    assert.equal(opened.interaction.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
    assert.equal(opened.swarmActivation.kind, protocol.SWARM.RECORD_KIND.SWARM_ACTIVATION);
    assert.equal(opened.swarmActivation.authoritySummary.runtime.state, 'delegated');
    assert.equal(opened.swarmActivation.authoritySummary.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
    assert.equal(opened.swarmActivation.authoritySummary.storage.identityAuthority, false);
    assert.equal(queued.result.authoritySummary.runtime.state, 'delegated');
    assert.equal(queued.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
    for (const field of protocol.SWARM.ACTIVATION_FORBIDDEN_FIELDS) {
      assert.equal(Object.hasOwn(opened.activation, field), false, `activation leaked ${field}`);
    }
  }

  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  const frames = Object.values(queue.result).map((entry) => entry.frame);
  const byMethod = new Map(frames.map((frame) => {
    const opened = protocol.openEnvelope(frame.body.envelope, SERVICE_SK, { now: Date.now() });
    return [opened.method, frame];
  }));
  assert.equal(frames.length, methods.length);
  assert.equal(byMethod.get('runtime.channel.resolve').kind, protocol.SWARM.FRAME_KIND.CHANNEL_OBSERVE);
  assert.equal(byMethod.get('runtime.projection.observe').capability, protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE);
  assert.equal(byMethod.get('runtime.stream.open').kind, protocol.SWARM.FRAME_KIND.STREAM_INTENT);
  assert.equal(byMethod.get('runtime.stream.open').recordRef.kind, 'stream.session.offer');
  assert.equal(byMethod.get('runtime.stream.control').kind, protocol.SWARM.FRAME_KIND.STREAM_CONTROL);
  assert.equal(byMethod.get('runtime.stream.control').recordRef.kind, 'stream.session.control');
  assert.equal(byMethod.get('runtime.stream.close').capability, protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL);
  assert.equal(byMethod.get('runtime.stream.close').recordRef.kind, 'stream.session.close');
  assert.equal(byMethod.get('runtime.storage.pin').kind, protocol.SWARM.FRAME_KIND.STORAGE_PIN_INTENT);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const streamActivation = Object.values(snapshot.result.activationResolutions)
    .find((entry) => entry.channelId === 'runtime.stream.open.channel');
  assert.equal(streamActivation.authoritySummary.gateway.state, 'waitingAdmission');
  assert.equal(streamActivation.authoritySummary.service.state, 'waitingAcceptance');
  assert.equal(streamActivation.interactionId.includes('runtime.stream.open'), true);
});

test('runtime capability resolve returns local contract posture without routing a swarm frame', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const resolved = await send(runtime.port, {
    type: 'runtime.capability.resolve',
    payload: {
      service: 'nvr',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceIds: ['cam-1'],
      intentId: 'resolve-preview-contract',
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.local, true);
  assert.equal(resolved.result.state, 'resolved');
  assert.equal(resolved.result.nodeRef, 'nvr.streams');
  assert.equal(resolved.result.channelId, 'nvr.streams');
  assert.equal(resolved.result.service, 'nvr');
  assert.equal(resolved.result.resolvedActivationEnvelope.nodeRef, 'nvr.streams');
  assert.equal(resolved.result.resolvedActivationEnvelope.channelId, 'nvr.streams');
  assert.equal(resolved.result.resolvedActivationEnvelope.sourceIds[0], 'cam-1');
  assert.equal(resolved.result.selfCapability.kind, protocol.SWARM.RECORD_KIND.PARTICIPANT_SELF_CAPABILITY);
  assert.equal(resolved.result.selfCapability.status, protocol.SWARM.SELF_CAPABILITY_STATUS.AVAILABLE);
  assert.equal(resolved.result.selfCapability.runlevel, protocol.SWARM.PARTICIPANT_RUNLEVEL.ROUTE_READY);
  assert.equal(resolved.result.selfCapability.facets.authority.state, protocol.SWARM.POSTURE_FACET_STATE.READY);
  assert.equal(resolved.result.selfCapability.facets.route.state, protocol.SWARM.POSTURE_FACET_STATE.READY);

  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(
    Object.values(queue.result)
      .some((entry) => entry?.frame?.correlationId === 'resolve-preview-contract'),
    false,
  );
});

test('runtime owns browser media transport profile selection', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const profile = await send(runtime.port, { type: 'runtime.media.transport.profile.get' });

  assert.equal(profile.ok, true);
  assert.equal(profile.result.kind, 'runtime.mediaTransport.profile');
  assert.equal(profile.result.selectedBy, 'runtime');
  assert.equal(profile.result.transport, 'webrtc');
  assert.equal(profile.result.role, 'browserOfferer');
  assert.equal(profile.result.iceServers.length, 1);
  assert.equal(profile.result.iceServers[0].urls, 'stun:stun.l.google.com:19302');
  assert.ok(profile.result.expiresAt > profile.result.issuedAt);
});

test('runtime reduces media fulfillment evidence as stream posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const pending = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-track',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRACK_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE,
      sessionId: 'stream-fulfillment-1',
      adapterRef: 'adapter:media-webrtc:browser',
      sourceRef: 'camera:front',
      safeFacts: {
        trackReadyState: 'live',
        muted: false,
      },
      observedAt: 1_700_000_001,
    },
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.result.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.PENDING);
  assert.equal(pending.result.postureState, 'waitingRender');
  assert.equal(pending.result.trackLive, true);
  assert.equal(pending.result.visibleFrame, false);

  const visible = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-render',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE,
      sessionId: 'stream-fulfillment-1',
      adapterRef: 'adapter:media-webrtc:browser',
      sourceRef: 'camera:front',
      safeFacts: {
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
        visibleFrame: true,
      },
      observedAt: 1_700_000_002,
    },
  });
  assert.equal(visible.ok, true);
  assert.equal(visible.result.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE);
  assert.equal(visible.result.postureState, 'adapterLive');
  assert.equal(visible.result.visibleFrame, true);

  const blocked = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-ice',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED,
      blockedReason: 'iceFailed',
      sessionId: 'stream-fulfillment-1',
      adapterRef: 'adapter:media-webrtc:browser',
      safeFacts: {
        iceConnectionState: 'failed',
      },
      observedAt: 1_700_000_003,
    },
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.result.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED);
  assert.equal(blocked.result.postureState, 'mediaPathBlocked');
  assert.deepEqual(blocked.result.blockedReasons, ['iceFailed']);

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(
    snapshot.result.mediaFulfillment['stream-fulfillment-1'].state,
    protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED,
  );
  assert.ok(snapshot.result.runtimeEvents.some((entry) => entry.kind === 'media.fulfillment.updated'));
});

test('runtime applies media fulfillment posture to owning activation', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const queued = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput({
      correlationId: 'stream-intent-media-fulfillment',
      channelId: 'nvr.streams',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
    }),
  });
  assert.equal(queued.ok, true);
  const frameId = queued.result.frameId;
  const routePromiseId = 'route:stream-intent-media-fulfillment';

  const blocked = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-owner-blocked',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED,
      blockedReason: 'inboundRtpStalled',
      correlationId: frameId,
      routePromiseId,
      adapterRef: 'adapter:media-webrtc:browser',
      observedAt: 1_700_000_004,
      expiresAt: 1_700_060_004,
    },
  });
  assert.equal(blocked.ok, true);
  let snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  let activation = snapshot.result.activationResolutions['stream-intent-media-fulfillment'];
  assert.equal(activation.state, 'mediaPathBlocked');
  assert.equal(activation.mediaState, protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED);
  assert.equal(activation.mediaPostureState, 'mediaPathBlocked');
  assert.equal(activation.mediaFulfillment.routePromiseId, routePromiseId);
  assert.equal(activation.lastError.code, 'media.pathBlocked');

  await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-owner-transport',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.TRANSPORT_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE,
      correlationId: frameId,
      routePromiseId,
      adapterRef: 'adapter:media-webrtc:browser',
      observedAt: 1_700_000_005,
      expiresAt: 1_700_060_005,
    },
  });
  const visible = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-owner-render',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE,
      correlationId: frameId,
      routePromiseId,
      adapterRef: 'adapter:media-webrtc:browser',
      safeFacts: {
        readyState: 4,
        videoWidth: 640,
        videoHeight: 360,
        visibleFrame: true,
      },
      observedAt: 1_700_000_006,
      expiresAt: 1_700_060_006,
    },
  });
  assert.equal(visible.ok, true);
  snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  activation = snapshot.result.activationResolutions['stream-intent-media-fulfillment'];
  assert.equal(activation.state, 'adapterLive');
  assert.equal(activation.mediaState, protocol.SWARM.MEDIA_FULFILLMENT_STATE.USABLE);
  assert.equal(activation.mediaPostureState, 'adapterLive');
  assert.equal(activation.lastError, null);
  assert.ok(snapshot.result.runtimeEvents.some((entry) => entry.kind === 'activation.media.fulfillment.applied'));
});

test('runtime distinguishes render-blocked media posture from path-blocked media posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const queued = await send(runtime.port, {
    type: 'swarm.frame.queue',
    payload: frameInput({
      correlationId: 'stream-intent-render-blocked',
      channelId: 'nvr.streams',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
    }),
  });
  assert.equal(queued.ok, true);
  const response = await send(runtime.port, {
    type: 'runtime.media.fulfillment.evidence.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_FULFILLMENT_EVIDENCE,
      evidenceId: 'media-proof-render-blocked',
      evidenceKind: protocol.SWARM.MEDIA_FULFILLMENT_EVIDENCE_KIND.RENDER_STATE,
      state: protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED,
      blockedReason: 'renderPlaybackStalled',
      correlationId: queued.result.frameId,
      routePromiseId: 'route:stream-intent-render-blocked',
      adapterRef: 'adapter:media-webrtc:browser',
      safeFacts: {
        readinessState: 'renderBlocked',
        videoWidth: 640,
        videoHeight: 360,
        visibleFrame: true,
        playbackAdvanced: false,
      },
      observedAt: 1_700_000_007,
      expiresAt: 1_700_060_007,
    },
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED);
  assert.equal(response.result.postureState, 'renderBlocked');
  assert.equal(response.result.blockedCategory, 'render');
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions['stream-intent-render-blocked'];
  assert.equal(activation.state, 'renderBlocked');
  assert.equal(activation.mediaPostureState, 'renderBlocked');
  assert.equal(activation.lastError.code, 'media.renderBlocked');
});

test('runtime reduces service media transport observations into stream fulfillment posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const observedAt = Date.now();
  const observation = {
    kind: protocol.SWARM.RECORD_KIND.MEDIA_TRANSPORT_OBSERVATION,
    observationId: 'media-observation-service-failed',
    pathId: 'nvr-preview-service-observation:path:browserWebRtc',
    sessionId: 'nvr-preview-service-observation',
    activationId: 'activation-service-observation',
    routePromiseId: 'route-promise-service-observation',
    participantRef: `service:${SERVICE_PK}`,
    participantRole: protocol.SWARM.MEDIA_TRANSPORT_PARTICIPANT_ROLE.SERVICE,
    state: protocol.SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.FAILED,
    connectionState: 'failed',
    reason: 'peerConnectionFailed',
    safeFacts: { sourceCount: 1, graceMs: 12_000 },
    evidenceRefs: ['nvr-preview-service-observation:path:browserWebRtc'],
    observedAt,
    expiresAt: observedAt + 60_000,
  };

  const received = await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'media-observation-frame',
        kind: protocol.SWARM.FRAME_KIND.STREAM_STATUS,
        issuer: protocol.pubkeyFromSecretKey(SERVICE_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 },
        issuedAt: observedAt,
        expiresAt: observedAt + 60_000,
        nonce: 'media-observation-nonce',
        correlationId: 'nvr-preview-service-observation',
        channelId: 'nvr.streams',
        recordRef: { kind: protocol.SWARM.RECORD_KIND.MEDIA_TRANSPORT_OBSERVATION, id: observation.observationId },
        capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { recordKind: protocol.SWARM.RECORD_KIND.MEDIA_TRANSPORT_OBSERVATION, record: observation },
        },
      },
    },
  });

  assert.equal(received.ok, true, JSON.stringify(received));
  const posture = received.result.mediaFulfillment['nvr-preview-service-observation'];
  assert.equal(posture.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED);
  assert.equal(posture.postureState, 'mediaPathBlocked');
  assert.equal(posture.serviceRef, `service:${SERVICE_PK}`);
  assert.deepEqual(posture.blockedReasons, ['peerConnectionFailed']);
  assert.equal(posture.latestEvidence.safeFacts.observationState, protocol.SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.FAILED);
  assert.ok(received.result.runtimeEvents.some((entry) => entry.kind === 'media.transport.observation'));
});

test('runtime accepts browser media transport observations as shared stream posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const observedAt = Date.now();
  const response = await send(runtime.port, {
    type: 'runtime.media.transport.observation.put',
    payload: {
      kind: protocol.SWARM.RECORD_KIND.MEDIA_TRANSPORT_OBSERVATION,
      observationId: 'media-observation-browser-stalled',
      pathId: 'nvr-preview-browser-observation:path:browserWebRtc',
      sessionId: 'nvr-preview-browser-observation',
      activationId: 'activation-browser-observation',
      routePromiseId: 'route-promise-browser-observation',
      participantRef: 'adapter:media-webrtc:browser',
      participantRole: protocol.SWARM.MEDIA_TRANSPORT_PARTICIPANT_ROLE.BROWSER,
      state: protocol.SWARM.MEDIA_TRANSPORT_OBSERVATION_STATE.BLOCKED,
      selectedPairState: protocol.SWARM.MEDIA_TRANSPORT_SELECTED_PAIR_STATE.SELECTED,
      inboundRtpState: protocol.SWARM.MEDIA_TRANSPORT_RTP_STATE.STALLED,
      renderState: protocol.SWARM.MEDIA_TRANSPORT_RENDER_STATE.PENDING,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      blockedReason: 'inboundRtpStalled',
      safeFacts: {
        inboundBytesReceived: 1280,
        inboundFramesDecoded: 10,
        stalledMs: 16_000,
      },
      evidenceRefs: ['adapter:media-webrtc:browser'],
      observedAt,
      expiresAt: observedAt + 60_000,
    },
  });

  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.result.state, protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED);
  assert.equal(response.result.postureState, 'mediaPathBlocked');
  assert.equal(response.result.adapterRef, 'adapter:media-webrtc:browser');
  assert.deepEqual(response.result.blockedReasons, ['inboundRtpStalled']);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(
    snapshot.result.mediaFulfillment['nvr-preview-browser-observation'].state,
    protocol.SWARM.MEDIA_FULFILLMENT_STATE.BLOCKED,
  );
  assert.ok(snapshot.result.runtimeEvents.some((entry) => entry.kind === 'media.transport.observation'));
});

test('runtime capability resolve blocks actionability when authority is missing', async () => {
  const runtime = loadRuntime(new Map(), { noDevice: true });
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const resolved = await send(runtime.port, {
    type: 'runtime.capability.resolve',
    payload: {
      service: 'nvr',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceIds: ['cam-1'],
      intentId: 'resolve-preview-without-authority',
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.state, 'waitingAuthority');
  assert.equal(resolved.result.authorityLifecycleState, 'waitingAuthority');
  assert.equal(resolved.result.selfCapability.kind, 'runtime.selfCapability.localPosture');
  assert.equal(resolved.result.selfCapability.contractReady, false);
  assert.equal(resolved.result.selfCapability.status, protocol.SWARM.SELF_CAPABILITY_STATUS.BLOCKED);
  assert.equal(resolved.result.selfCapability.facets.authority.state, protocol.SWARM.POSTURE_FACET_STATE.BLOCKED);
  assert.ok(resolved.result.selfCapability.blockedReasons.includes('runtimeParticipantUnresolved'));

  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(
    Object.values(queue.result)
      .some((entry) => entry?.frame?.correlationId === 'resolve-preview-without-authority'),
    false,
  );
});

test('runtime stream candidate controls are labeled as candidate signals', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);
  const queued = await send(runtime.port, {
    type: 'runtime.stream.control',
    payload: {
      service: 'nvr',
      servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
      gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
      identityId: 'identity-1',
      owner: true,
      viewSources: ['cam-1'],
      zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 1 },
      channelId: 'nvr.streams',
      sessionId: 'nvr-preview-test',
      candidateId: 'candidate-test',
      payload: {
        candidate: {
          candidate: 'candidate:1 1 udp 1 192.0.2.10 5000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.kind, protocol.SWARM.FRAME_KIND.STREAM_CONTROL);
  assert.equal(queued.result.frame.recordRef.kind, 'stream.session.candidate');
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.signalType, 'candidate');
  assert.equal(opened.record.kind, 'stream.session.candidate');
  assert.equal(opened.record.candidateRole, 'browser');
  assert.equal(opened.record.actionability, 'usable');
  assert.equal(opened.record.endpoint.port, 5000);

  const observedAt = Date.now();
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'candidate-route-observation-frame',
        kind: 'route.observation',
        issuer: protocol.pubkeyFromSecretKey(GATEWAY_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        issuedAt: observedAt,
        expiresAt: observedAt + 60_000,
        nonce: 'candidate-route-observation',
        correlationId: queued.result.frameId,
        channelId: 'swarm.route',
        recordRef: { kind: 'route.observation', id: 'candidate-route-observation', revision: observedAt },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: {
            recordKind: 'route.observation',
            record: {
              observationId: 'candidate-route-observation',
              frameId: queued.result.frameId,
              correlationId: queued.result.frame.correlationId,
              state: 'memberWritten',
              deliveredTo: [protocol.pubkeyFromSecretKey(SERVICE_SK)],
              observedAt,
              issuedAt: observedAt,
            },
          },
        },
      },
    },
  });
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'candidateSignalDelivered');
  assert.equal(activation.responseState, 'notRequired');
});

test('runtime stream candidate controls block missing endpoint evidence', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);
  const queued = await send(runtime.port, {
    type: 'runtime.stream.control',
    payload: {
      service: 'nvr',
      servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
      gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
      identityId: 'identity-1',
      owner: true,
      viewSources: ['cam-1'],
      zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 1 },
      channelId: 'nvr.streams',
      sessionId: 'nvr-preview-test',
      candidateId: 'candidate-test',
      payload: {
        candidate: {
          candidate: 'candidate:1 1 udp 1 192.0.2.10 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
    },
  });

  assert.equal(queued.ok, false);
  assert.equal(queued.error, 'missingCandidateEndpoint');
});

test('route accepted observation remains carrier posture before service admission', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { memberRef: SERVICE_PK });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'route-accepted-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(queued.ok, true);

  const observedAt = Date.now();
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'route-accepted-observation-frame',
        kind: 'route.observation',
        issuer: GATEWAY_PK,
        audience: { actorRef: BROWSER_PK },
        issuedAt: observedAt,
        expiresAt: observedAt + 60_000,
        nonce: 'route-accepted-observation',
        correlationId: queued.result.frameId,
        channelId: 'swarm.route',
        recordRef: { kind: 'route.observation', id: 'route-observation-accepted', revision: observedAt },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: {
            recordKind: 'route.observation',
            record: {
              observationId: 'route-observation-accepted',
              frameId: queued.result.frameId,
              correlationId: queued.result.frame.correlationId,
              state: 'accepted',
              observedAt,
              issuedAt: observedAt,
            },
          },
        },
      },
    },
  });

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'routeAccepted');
  assert.equal(activation.serviceAccepted, false);
  assert.equal(activation.responseState, '');
  assert.equal(activation.lastError, null);
  assert.equal(snapshot.result.runtimeEvents.some((event) => (
    event.kind === 'service.accepted'
    && event.safeFacts.frameId === queued.result.frameId
  )), false);
});

test('runtime owns stream recovery backoff posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const first = await send(runtime.port, {
    type: 'runtime.stream.recovery.request',
    payload: {
      parentIntentId: 'nvr-live-preview:cam-1',
      reason: 'inboundRtpStalled',
      baseMs: 10,
      maxMs: 100,
      sourceIds: ['cam-1'],
      sessionCount: 1,
    },
  });
  assert.equal(first.ok, true);
  assert.equal(first.result.kind, 'runtime.stream.recovery.posture');
  assert.equal(first.result.state, 'scheduled');
  assert.equal(first.result.parentIntentId, 'nvr-live-preview:cam-1');
  assert.equal(first.result.attempt, 1);
  assert.ok(first.result.delayMs >= 10);
  assert.ok(first.result.delayMs <= 19);

  const second = await send(runtime.port, {
    type: 'runtime.stream.recovery.request',
    payload: {
      parentIntentId: 'nvr-live-preview:cam-1',
      reason: 'retryFailed',
      baseMs: 10,
      maxMs: 100,
      sourceIds: ['cam-1'],
      sessionCount: 1,
    },
  });
  assert.equal(second.ok, true);
  assert.equal(second.result.attempt, 2);
  assert.ok(second.result.delayMs >= 20);
  assert.ok(second.result.delayMs <= 29);

  let snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.streamRecovery['nvr-live-preview:cam-1'].attempt, 2);
  assert.equal(snapshot.result.streamRecovery['nvr-live-preview:cam-1'].reason, 'retryFailed');

  const reset = await send(runtime.port, {
    type: 'runtime.stream.recovery.request',
    payload: {
      action: 'reset',
      parentIntentId: 'nvr-live-preview:cam-1',
      reason: 'adapterLive',
    },
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.result.state, 'reset');
  assert.equal(reset.result.previousAttempt, 2);

  snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.streamRecovery['nvr-live-preview:cam-1'], undefined);
  assert.equal(snapshot.result.runtimeEvents.some((event) => event.kind === 'stream.recovery.scheduled'), true);
  assert.equal(snapshot.result.runtimeEvents.some((event) => event.kind === 'stream.recovery.reset'), true);
});

test('stream admission materializes service acceptance before stream answer', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { memberRef: SERVICE_PK });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'admission-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(queued.ok, true);

  const admission = {
    admissionId: 'admission-test',
    sessionId: 'session-test',
    capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
    admittedBy: SERVICE_PK,
    constraints: { routePromiseId: queued.result.routePromiseId },
    issuedAt: Date.now(),
  };
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'admission-frame',
        kind: protocol.SWARM.FRAME_KIND.STREAM_STATUS,
        issuer: protocol.pubkeyFromSecretKey(SERVICE_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        nonce: 'admission-nonce',
        correlationId: queued.result.frameId,
        channelId: 'nvr.streams',
        recordRef: { kind: 'stream.session.admission', id: admission.admissionId },
        capability: protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { recordKind: 'stream.session.admission', record: admission },
        },
      },
    },
  });

  let snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  let activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'waitingServiceAnswer');
  assert.equal(activation.serviceAccepted, true);
  assert.equal(activation.serviceAdmission.admissionId, 'admission-test');
  assert.equal(snapshot.result.runtimeEvents.some((event) => event.kind === 'service.accepted'), true);

  const answer = {
    answerId: 'answer-test',
    sessionId: 'session-test',
    transport: 'webrtc',
    payload: { description: { type: 'answer', sdp: 'v=0\r\n' } },
    issuedAt: Date.now(),
  };
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'answer-frame',
        kind: protocol.SWARM.FRAME_KIND.STREAM_STATUS,
        issuer: protocol.pubkeyFromSecretKey(SERVICE_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        nonce: 'answer-nonce',
        correlationId: queued.result.frameId,
        channelId: 'nvr.streams',
        recordRef: { kind: 'stream.session.answer', id: answer.answerId },
        capability: protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { recordKind: 'stream.session.answer', record: answer },
        },
      },
    },
  });

  snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'answerMaterialized');
  assert.equal(activation.serviceAccepted, true);
  assert.equal(activation.responseState, 'materialized');
  assert.equal(activation.serviceAnswer.answerId, 'answer-test');
});

test('runtime reduces contribution lifecycle records into activation posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { memberRef: SERVICE_PK });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'contribution-lifecycle-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(queued.ok, true);

  const issuedAt = Date.now();
  const contribution = {
    kind: protocol.SWARM.RECORD_KIND.CONTRIBUTION_LIFECYCLE,
    contributionId: 'witness-service-read-test',
    parentRef: queued.result.frame.correlationId,
    subjectRef: queued.result.routePromiseId,
    writerRef: SERVICE_PK,
    contributionType: protocol.SWARM.CONTRIBUTION_TYPE.WITNESS,
    state: protocol.SWARM.CONTRIBUTION_STATE.WITNESSED,
    role: 'executor',
    authorityRefs: ['grant:nvr-service'],
    targetContributionRef: queued.result.routePromiseId,
    witnessRefs: [queued.result.frameId],
    evidenceRefs: ['service.accepted:test'],
    issuedAt,
    observedAt: issuedAt + 1,
  };
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'contribution-lifecycle-frame',
        kind: protocol.SWARM.FRAME_KIND.CONTRIBUTION_LIFECYCLE,
        issuer: protocol.pubkeyFromSecretKey(SERVICE_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 },
        issuedAt,
        expiresAt: issuedAt + 60_000,
        nonce: 'contribution-lifecycle-nonce',
        correlationId: queued.result.frameId,
        channelId: 'nvr.streams',
        recordRef: { kind: protocol.SWARM.RECORD_KIND.CONTRIBUTION_LIFECYCLE, id: contribution.contributionId },
        capability: protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { recordKind: protocol.SWARM.RECORD_KIND.CONTRIBUTION_LIFECYCLE, record: contribution },
        },
      },
    },
  });

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.contributionLifecycle.contributionId, 'witness-service-read-test');
  assert.equal(activation.contributionWitnessedAt, issuedAt + 1);
  assert.equal(snapshot.result.edge.contributionLifecycles.at(-1).contributionId, 'witness-service-read-test');
  assert.equal(snapshot.result.runtimeEvents.some((event) => event.kind === 'contribution.lifecycle.applied'), true);
});

test('stream answer materialization implies durable service acceptance posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { memberRef: SERVICE_PK });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'answer-only-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(queued.ok, true);

  const answer = {
    answerId: 'answer-only-test',
    sessionId: 'session-answer-only-test',
    transport: 'webrtc',
    payload: { description: { type: 'answer', sdp: 'v=0\r\n' } },
    issuedAt: Date.now(),
  };
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'answer-only-frame',
        kind: protocol.SWARM.FRAME_KIND.STREAM_STATUS,
        issuer: protocol.pubkeyFromSecretKey(SERVICE_SK),
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        zoneScope: { zoneId: 'zone_lab', ttl: 30, maxHops: 2 },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        nonce: 'answer-only-nonce',
        correlationId: queued.result.frameId,
        channelId: 'nvr.streams',
        recordRef: { kind: 'stream.session.answer', id: answer.answerId },
        capability: protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { recordKind: 'stream.session.answer', record: answer },
        },
      },
    },
  });

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'answerMaterialized');
  assert.equal(activation.serviceAccepted, true);
  assert.equal(activation.responseState, 'materialized');
  assert.equal(activation.serviceAnswer.answerId, 'answer-only-test');
});

test('delivered stream route without service admission becomes bounded admission timeout posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'runtime-test',
    surface: 'runtime-test',
    logging: false,
  });
  assert.equal(subscribed.ok, true);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { memberRef: SERVICE_PK });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'admission-timeout-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(queued.ok, true);

  await send(runtime.port, {
    type: 'swarm.edge.ack',
    correlationId: queued.result.frameId,
    propagation: [{
      memberRef: SERVICE_PK,
      memberKind: 'service',
      zoneId: 'zone_lab',
      channelIds: ['nvr.streams'],
      capabilities: [protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW],
    }],
  });

  const observedAt = Date.now() - 13_000;
  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'silent-service-route-observation-frame',
        kind: 'route.observation',
        issuer: GATEWAY_PK,
        audience: { actorRef: BROWSER_PK },
        issuedAt: observedAt,
        expiresAt: Date.now() + 60_000,
        nonce: 'silent-service-route-observation',
        correlationId: queued.result.frameId,
        channelId: 'swarm.route',
        recordRef: { kind: 'route.observation', id: 'route-observation-silent-service', revision: observedAt },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: {
            recordKind: 'route.observation',
            record: {
              observationId: 'route-observation-silent-service',
              frameId: queued.result.frameId,
              correlationId: queued.result.frame.correlationId,
              state: 'memberRead',
              deliveredTo: [SERVICE_PK],
              observedAt,
              issuedAt: observedAt,
            },
          },
        },
      },
    },
  });

  const timeoutEvent = await waitFor(() => runtime.port.messages.find((entry) => (
    entry.type === 'runtime.diagnostic.event'
    && entry.event?.kind === 'service.admission.timeout'
    && entry.event?.safeFacts?.routeDelivery?.serviceDeliveryCount === 1
  )));
  assert.equal(timeoutEvent.event.safeFacts.routeDelivery.deliveredCount, 1);
  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const activation = snapshot.result.activationResolutions[queued.result.frame.correlationId];
  assert.equal(activation.state, 'serviceAdmissionTimedOut');
  assert.equal(activation.responseState, 'serviceAdmissionTimedOut');
  assert.equal(activation.lastError.code, 'service.admission.timeout');
  assert.equal(activation.routeObservation.deliveredTo[0], SERVICE_PK);
  assert.equal(activation.routeDelivery.serviceDeliveryCount, 1);
});

test('edge projection inbox retains directory snapshots and source-less stream route uses live directory channel', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });

  const now = Date.now();
  const servicePk = protocol.pubkeyFromSecretKey(SERVICE_SK);
  const directorySnapshot = {
    projectionId: 'swarm.directory',
    policyId: 'swarm.directory.live',
    revision: now,
    state: {
      directory: {
        classification: {
          directoryTruthSource: 'attachedSessionAdvertisement',
          attachedHelloBoundary: 'attachedSessionObservation',
          recordBackedMembership: false,
        },
        advertisements: [{
          advertisementId: 'ad-nvr-preview',
          capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
          memberRef: servicePk,
          serviceRef: `service:${servicePk}`,
          servicePk,
          zoneScope: { zoneId: 'zone_edge', privacy: 'rawIds', ttl: 30, maxHops: 2 },
          channelRefs: ['nvr.streams'],
          issuedAt: now,
          expiresAt: now + 90_000,
        }],
        entries: [{
          entryId: 'entry-nvr-preview',
          capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
          channelId: 'nvr.streams',
          memberRef: servicePk,
          serviceRef: `service:${servicePk}`,
          servicePk,
          zoneScope: { zoneId: 'zone_edge', privacy: 'rawIds', ttl: 30, maxHops: 2 },
          priority: 10,
        }],
        channels: [],
        policies: [],
        definitions: [],
        membershipTruth: [],
      },
    },
    coverage: { materializedCount: 1, targetCount: 1, completionRatio: 1, syncState: 'completeEnough' },
    freshness: { state: 'fresh', updatedAt: now },
    sourceRefs: ['gateway-1'],
    issuedAt: now,
  };

  await send(runtime.port, {
    type: 'swarm.edge.test.receive',
    record: {
      type: 'swarm.frame',
      frame: {
        version: protocol.SWARM.FRAME_VERSION,
        frameId: 'gateway-directory-frame',
        kind: 'bootstrap.gatewayHint',
        issuer: 'gateway-1',
        audience: { actorRef: protocol.pubkeyFromSecretKey(BROWSER_SK) },
        issuedAt: now,
        expiresAt: now + 60_000,
        nonce: 'gateway-directory-nonce',
        correlationId: 'gateway-directory',
        channelId: 'swarm.directory',
        recordRef: { kind: 'structural.diagnostic', id: 'swarm.directory', revision: now },
        capability: protocol.SWARM.CORE_CAPABILITY.PROJECTION_OBSERVE,
        body: {
          encoding: protocol.SWARM.BODY_ENCODING.PUBLIC,
          publicBootstrap: true,
          payload: { snapshot: directorySnapshot },
        },
      },
    },
  });

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const directoryProjection = Object.values(snapshot.result.projections)
    .find((projection) => projection?.projectionId === 'swarm.directory');
  assert.ok(directoryProjection, JSON.stringify(snapshot.result.runtimeEvents));
  assert.equal(directoryProjection.payload.directory.entries[0].channelId, 'nvr.streams');

  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_edge', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'directory-zone-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: [] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_edge',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  assert.equal(queued.result.routingScope.kind, protocol.SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE);
  assert.equal(queued.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.READY);
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.interaction.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.READY);
  assert.equal(opened.interaction.routingScope.source, 'swarm.directory');
  assert.equal(queued.result.frame.audience.serviceRef, `service:nvr:${servicePk}`);
  assert.equal(snapshot.result.runtimeEvents.some((event) => event.kind === 'projection.inbox.applied'), true);
});

test('source-less stream route waits for directory member before frame emission', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'source-less-node-channel-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: [] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.pendingRoute, true);
  assert.equal(queued.result.state, 'waitingRouteBaseline');
  assert.equal(queued.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
  assert.equal(queued.result.routingScope.source, 'edgeSession');
  assert.deepEqual(queued.result.routingScope.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  let queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.values(queue.result).some((entry) => entry?.frame?.channelId === 'nvr.streams'), false);
  assert.equal(Object.values(queue.result).some((entry) => entry?.frame?.channelId === 'swarm.directory'), true);

  const routeMemberPk = protocol.pubkeyFromSecretKey(GATEWAY_SK);
  await seedNvrEdgeDirectory(runtime.port, { memberRef: routeMemberPk, omitServiceIdentity: true });
  let streamFrame = null;
  for (let attempt = 0; attempt < 30 && !streamFrame; attempt += 1) {
    queue = await send(runtime.port, { type: 'swarm.queue.get' });
    streamFrame = Object.values(queue.result).find((entry) => entry?.frame?.channelId === 'nvr.streams') || null;
    if (!streamFrame) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(streamFrame);
  assert.equal(streamFrame.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.READY);
  assert.equal(streamFrame.routingScope.source, 'swarm.directory');
  assert.equal(streamFrame.routingScope.serviceMemberRef, routeMemberPk);
  assert.equal(streamFrame.frame.capability, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
  assert.equal(streamFrame.frame.audience.servicePk, protocol.pubkeyFromSecretKey(SERVICE_SK));
  assert.equal(streamFrame.frame.audience.serviceRef, `service:nvr:${protocol.pubkeyFromSecretKey(SERVICE_SK)}`);
  assert.equal(streamFrame.frame.audience.memberRef, routeMemberPk);
  assert.equal(streamFrame.frame.audience.serviceMemberRef, routeMemberPk);
  assert.ok(streamFrame.frame.audience.audienceRefs.includes(routeMemberPk));
  assert.ok(streamFrame.frame.body.envelope.recipients.some((recipient) => recipient.recipientPk === routeMemberPk));
  const opened = protocol.openEnvelope(streamFrame.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.routePromise.serviceMemberRef, routeMemberPk);
  assert.ok(opened.routePromise.audienceRefs.includes(routeMemberPk));
});

test('runtime stream activation derives route zone from shell posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await seedNvrEdgeDirectory(runtime.port, { zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 } });
  await send(runtime.port, {
    type: 'runtime.status.put',
    role: 'shell',
    status: {
      zones: {
        activeZoneKey: 'zone_lab',
        joined: [{ key: 'zone_lab', name: 'Lab' }],
      },
    },
  });
  await send(runtime.port, { type: 'swarm.edge.test.connect' });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'shell-zone-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: [] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  assert.equal(queued.result.routingScope.source, 'swarm.directory');
  assert.equal(queued.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.READY);
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.deepEqual(opened.routePromise.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
});

test('runtime treats discovery scopes as additive route coverage', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await seedNvrEdgeDirectory(runtime.port, { zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 } });
  await send(runtime.port, {
    type: 'runtime.status.put',
    role: 'shell',
    status: {
      zones: {
        activeZoneKey: 'zone_home',
        joined: [{ key: 'zone_home', name: 'Home' }],
      },
    },
  });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_home', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'additive-discovery-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: [] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.routingScope.source, 'swarm.directory');
  assert.equal(queued.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.READY);
  assert.deepEqual(queued.result.routingScope.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
});

test('stream route baseline prefers resolved service member over generic channel carrier', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { skipSurfaceProjection: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });

  const now = Date.now();
  const servicePk = SERVICE_PK;
  const genericMemberRef = GATEWAY_PK;
  const serviceMemberRef = servicePk;
  await seedNvrEdgeDirectory(runtime.port, {
    memberRef: genericMemberRef,
    omitServiceIdentity: true,
    extraAdvertisements: [{
      advertisementId: 'ad-nvr-service-preview',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      capabilityRefs: [
        protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
        protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL,
      ],
      memberRef: serviceMemberRef,
      serviceRef: `service:nvr:${servicePk}`,
      servicePk,
      service: 'nvr',
      zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
      channelRefs: ['nvr.streams'],
      issuedAt: now,
      expiresAt: now + 90_000,
    }],
    extraEntries: [{
      entryId: 'entry-nvr-service-preview',
      capability: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      capabilityRefs: [
        protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
        protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_CONTROL,
      ],
      channelId: 'nvr.streams',
      memberRef: serviceMemberRef,
      serviceRef: `service:nvr:${servicePk}`,
      servicePk,
      service: 'nvr',
      zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
      priority: 20,
    }],
  });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'nvr.streams',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      transport: 'webrtc',
      intentId: 'service-member-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.audience.memberRef, serviceMemberRef);
  assert.equal(queued.result.frame.audience.serviceMemberRef, serviceMemberRef);
  assert.ok(queued.result.frame.audience.audienceRefs.includes(serviceMemberRef));
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.routePromise.serviceMemberRef, serviceMemberRef);
});

test('live swarm edge attach requires resolved member refs and reuses duplicate attachment', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const zoneScope = { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 };

  const unresolved = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      memberRef: 'browser-runtime',
      zoneScope,
    },
  });

  assert.equal(unresolved.ok, false);
  assert.match(unresolved.error, /resolved swarm edge memberRef is required/);
  assert.equal(runtime.webSockets.length, 0);

  const attached = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      memberRef: BROWSER_PK,
      zoneScope,
    },
  });

  assert.equal(attached.ok, true);
  assert.equal(attached.result.memberRef, BROWSER_PK);
  assert.equal(runtime.webSockets.length, 1);
  let edgeSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const attachEvent = edgeSnapshot.result.runtimeEvents.find((entry) => entry.kind === 'adapter.edge.attach');
  assert.equal(attachEvent?.safeFacts?.endpointHost, '127.0.0.1');
  assert.equal(attachEvent?.safeFacts?.endpointPort, '7447');
  assert.equal(attachEvent?.safeFacts?.memberRef, BROWSER_PK);

  const duplicate = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      memberRef: BROWSER_PK,
      zoneScope,
    },
  });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.result.memberRef, BROWSER_PK);
  assert.equal(runtime.webSockets.length, 1);

  const reused = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      memberRef: BROWSER_PK,
      zoneScope,
    },
  });

  assert.equal(reused.ok, true);
  assert.equal(reused.result.memberRef, BROWSER_PK);
  assert.equal(runtime.webSockets.length, 1);

  runtime.webSockets[0].onerror?.({});
  runtime.webSockets[0].onclose?.({ code: 1006, reason: '', wasClean: false });
  edgeSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const errorEvent = edgeSnapshot.result.runtimeEvents.find((entry) => entry.kind === 'adapter.edge.error');
  const closedEvent = edgeSnapshot.result.runtimeEvents.find((entry) => entry.kind === 'adapter.edge.closed');
  assert.equal(errorEvent?.safeFacts?.endpointHost, '127.0.0.1');
  assert.equal(errorEvent?.safeFacts?.memberRef, BROWSER_PK);
  assert.equal(closedEvent?.safeFacts?.closeCode, 1006);
});

test('live swarm edge attach waits for runtime authority when member ref is runtime-owned', async () => {
  const runtime = loadRuntime(new Map(), { noDevice: true });
  await attach(runtime.port);
  const zoneScope = { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 };

  const blocked = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      zoneScope,
    },
  });

  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /missingRuntimeAuthorityMemberRef/);
  assert.equal(blocked.state, 'waitingAuthority');
  assert.equal(blocked.blockedReason, 'missingRuntimeAuthorityMemberRef');
  assert.equal(runtime.webSockets.length, 0);

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.result.edge.mode, 'pendingAuthority');
  assert.equal(snapshot.result.edge.connected, false);
  const blockedEvent = snapshot.result.runtimeEvents.find((entry) => entry.kind === 'adapter.edge.attach.blocked');
  assert.equal(blockedEvent?.safeFacts?.blockedReason, 'missingRuntimeAuthorityMemberRef');
  assert.equal(blockedEvent?.safeFacts?.retryable, true);
  assert.equal(blockedEvent?.level, 'info');
});

test('live swarm edge attach is not gated by runtime hydration', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.doesNotMatch(
    source,
    /case SWARM_EDGE_ATTACH:\s*\{[\s\S]*?ensureHydrated\(\)[\s\S]*?attachLiveSwarmEdge/,
  );
});

test('live swarm edge attach accepts resolved member refs before device key hydration', async () => {
  const runtime = loadRuntime(new Map(), { noDevice: true });
  await attach(runtime.port);
  const zoneScope = { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 };

  const attached = await send(runtime.port, {
    type: 'swarm.edge.attach',
    payload: {
      swarmEdgeEndpoint: 'ws://127.0.0.1:7447/',
      memberRef: BROWSER_PK,
      zoneScope,
    },
  });

  assert.equal(attached.ok, true);
  assert.equal(attached.result.memberRef, BROWSER_PK);
  assert.equal(runtime.webSockets.length, 1);
});

test('runtime authority posture reports lifecycle states explicitly', async () => {
  async function postureFor(store = new Map(), options = {}) {
    const runtime = loadRuntime(store, options);
    await attach(runtime.port);
    const response = await send(runtime.port, { type: 'runtime.authority.posture.get' });
    assert.equal(response.ok, true, response.error);
    return response.result;
  }

  const ready = await postureFor(new Map());
  assert.equal(ready.state, 'ready');
  assert.equal(ready.ready, true);
  assert.equal(ready.devicePk, protocol.pubkeyFromSecretKey(BROWSER_SK));

  const waiting = await postureFor(new Map(), { noDevice: true });
  assert.equal(waiting.state, 'waitingAuthority');
  assert.equal(waiting.ready, false);
  assert.equal(waiting.blockedAuthorityDomain, protocol.SWARM.AUTHORITY_DOMAIN.RUNTIME);

  const expired = await postureFor(new Map([['device', {
    nostr: { pk: protocol.pubkeyFromSecretKey(BROWSER_SK), skHex: BROWSER_SK },
    expiresAt: Date.now() - 1_000,
  }]]));
  assert.equal(expired.state, 'expired');
  assert.equal(expired.ready, false);
  assert.equal(expired.devicePk, protocol.pubkeyFromSecretKey(BROWSER_SK));

  const revoked = await postureFor(new Map([['device', {
    nostr: { pk: protocol.pubkeyFromSecretKey(BROWSER_SK), skHex: BROWSER_SK },
    revokedAt: Date.now() - 1_000,
  }]]));
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.ready, false);

  const ambiguous = await postureFor(new Map([['device', {
    nostr: { pk: protocol.pubkeyFromSecretKey(GATEWAY_SK), skHex: BROWSER_SK },
  }]]));
  assert.equal(ambiguous.state, 'ambiguous');
  assert.equal(ambiguous.ready, false);

  const unavailable = await postureFor(new Map(), { noDevice: true, noIndexedDB: true });
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.ready, false);
});

test('runtime authority posture returns before stalled storage hydration completes', async () => {
  const runtime = loadRuntime(new Map(), { noDevice: true, stallDeviceGet: true });
  await attach(runtime.port);

  const startedAt = Date.now();
  const response = await send(runtime.port, { type: 'runtime.authority.posture.get' });

  assert.equal(response.ok, true);
  assert.equal(response.result.state, 'waitingAuthority');
  assert.equal(response.result.ready, false);
  assert.equal(response.result.source, 'storage.pending');
  assert.equal(response.result.reason, 'runtime authority storage lookup pending');
  assert.equal(response.result.blockedAuthorityDomain, protocol.SWARM.AUTHORITY_DOMAIN.RUNTIME);
  assert.ok(Date.now() - startedAt < 1000);
});

test('runtime authority records reducer separates action, access, and witness planes', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 60_000;
  const subjectRefs = [
    'service:gateway',
    'service:nvr',
    'service:logging',
    'event-fabric:identity:aux',
    'storage:identity:aux',
    'source:identity:aux',
    'build:identity:aux',
    'app:constitute-cybersec',
  ];
  const actionGrantRefs = [
    'grant:agent:full',
    'grant:agent:gateway-route',
    'grant:agent:logging-writer',
    'grant:agent:storage-pin',
    'grant:agent:source-update',
    'grant:agent:build-run',
  ];
  const accessGroupRefs = [
    'access-group:agent-events',
    'access-group:agent-source-build',
  ];
  const accessEpochRefs = [
    'epoch:agent-events:1',
    'epoch:agent-source-build:1',
  ];
  const privateEnvelopeRefs = [
    'private-envelope:event-detail:1',
    'private-envelope:source-build:1',
  ];
  const records = [
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:full',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'service:nvr',
      action: 'service.fulfill',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:gateway-route',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'service:gateway',
      action: 'gateway.route.use',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:logging-writer',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'service:logging',
      action: 'event.fabric.process',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:storage-pin',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'storage:identity:aux',
      action: 'storage.pin',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:source-update',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'source:identity:aux',
      action: 'source.ref.update',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:build-run',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'build:identity:aux',
      action: 'build.run',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE,
      exerciseId: 'exercise:agent:nvr',
      grantId: 'grant:agent:full',
      actorRef: 'identity:agent',
      subjectRef: 'member:agent-browser',
      resourceRef: 'service:nvr',
      action: 'service.fulfill',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
      evidenceRefs: ['proof:exercise:agent:nvr'],
      issuedAt,
      observedAt: issuedAt + 1,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE,
      exerciseId: 'exercise:agent:logging',
      grantId: 'grant:agent:logging-writer',
      actorRef: 'identity:agent',
      subjectRef: 'member:agent-browser',
      resourceRef: 'event-fabric:identity:aux',
      action: 'event.fabric.process',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
      evidenceRefs: ['proof:exercise:agent:logging'],
      issuedAt,
      observedAt: issuedAt + 2,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_EXERCISE,
      exerciseId: 'exercise:agent:build',
      grantId: 'grant:agent:build-run',
      actorRef: 'identity:agent',
      subjectRef: 'member:agent-browser',
      resourceRef: 'build:identity:aux',
      action: 'build.run',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
      evidenceRefs: ['proof:exercise:agent:build'],
      issuedAt,
      observedAt: issuedAt + 3,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE,
      revocationId: 'revocation:agent:full:expiry',
      targetGrantRef: 'grant:agent:full',
      issuerRef: 'identity:aux',
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      affectedGrantRefs: actionGrantRefs,
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
      reasonCode: 'expiry.available',
      evidenceRefs: ['proof:revocation-path'],
      issuedAt,
      effectiveAt: expiresAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.ACCESS_GROUP,
      groupId: 'access-group:agent-events',
      ownerRef: 'identity:aux',
      subjectRef: 'event-fabric:identity:aux',
      contentClasses: [protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL],
      memberRefs: ['member:agent-browser'],
      adminRefs: ['identity:aux'],
      currentEpochId: 'epoch:agent-events:1',
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.ACCESS_EPOCH,
      epochId: 'epoch:agent-events:1',
      groupId: 'access-group:agent-events',
      sequence: 1,
      changeKind: protocol.AGREEMENT.ACCESS_EPOCH_CHANGE.ADD_MEMBER,
      memberRefs: ['member:agent-browser'],
      addedMemberRefs: ['member:agent-browser'],
      keyRef: 'key:agent-events:1',
      proofRefs: ['proof:epoch:agent-events:1'],
      issuedAt,
      expiresAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.ACCESS_GROUP,
      groupId: 'access-group:agent-source-build',
      ownerRef: 'identity:aux',
      subjectRef: 'source:identity:aux',
      contentClasses: [protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL],
      memberRefs: ['member:agent-browser'],
      adminRefs: ['identity:aux'],
      currentEpochId: 'epoch:agent-source-build:1',
      issuedAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.ACCESS_EPOCH,
      epochId: 'epoch:agent-source-build:1',
      groupId: 'access-group:agent-source-build',
      sequence: 1,
      changeKind: protocol.AGREEMENT.ACCESS_EPOCH_CHANGE.ADD_MEMBER,
      memberRefs: ['member:agent-browser'],
      addedMemberRefs: ['member:agent-browser'],
      keyRef: 'key:agent-source-build:1',
      proofRefs: ['proof:epoch:agent-source-build:1'],
      issuedAt,
      expiresAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE,
      envelopeId: 'private-envelope:event-detail:1',
      contentClass: protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL,
      accessGroupRef: 'access-group:agent-events',
      epochId: 'epoch:agent-events:1',
      subjectRef: 'logging:event:1',
      issuerRef: 'logging:processor',
      detailRef: 'storage:detail:1',
      recipientRefs: ['member:agent-browser'],
      issuedAt,
      expiresAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE,
      envelopeId: 'private-envelope:source-build:1',
      contentClass: protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL,
      accessGroupRef: 'access-group:agent-source-build',
      epochId: 'epoch:agent-source-build:1',
      subjectRef: 'source:identity:aux',
      issuerRef: 'source:processor',
      detailRef: 'storage:source-build:1',
      recipientRefs: ['member:agent-browser'],
      issuedAt,
      expiresAt,
    },
    {
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF,
      proofId: 'proof:agent-full-access',
      ownerIdentityRef: 'identity:aux',
      granteeIdentityRef: 'identity:agent',
      granteeMemberRef: 'member:agent-browser',
      subjectRefs,
      actionGrantRefs,
      accessGroupRefs,
      accessEpochRefs,
      privateEnvelopeRefs,
      evidenceRefs: ['proof:browser:aux-agent'],
      state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
      checks: [
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.SYNC,
          plane: protocol.AGREEMENT.PLANE.DELIVERY_WITNESS,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
          targetRef: 'member:agent-browser',
          evidenceRefs: ['proof:sync'],
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.READ,
          plane: protocol.AGREEMENT.PLANE.ACCESS_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
          targetRef: 'event-fabric:identity:aux',
          accessGroupRefs,
          accessEpochRefs,
          evidenceRefs: ['proof:read'],
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.WRITE_REDUCE,
          plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
          targetRef: 'event-fabric:identity:aux',
          grantRefs: actionGrantRefs,
          exerciseRefs: ['exercise:agent:nvr', 'exercise:agent:logging', 'exercise:agent:build'],
          evidenceRefs: ['proof:write-reduce'],
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.REVOKE_EXPIRE,
          plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
          targetRef: 'grant:agent:full',
          grantRefs: actionGrantRefs,
          evidenceRefs: ['proof:revoke-expire'],
          expiresAt,
        },
      ],
      issuedAt,
      expiresAt,
    },
  ];

  const reduced = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records,
  });

  assert.equal(reduced.ok, true);
  assert.equal(reduced.result.state, 'ready');
  assert.equal(reduced.result.actionAuthority.state, 'ready');
  assert.equal(reduced.result.accessAuthority.state, 'ready');
  assert.equal(reduced.result.deliveryWitness.state, 'ready');
  assert.equal(reduced.result.actionability.canSync, true);
  assert.equal(reduced.result.actionability.canRead, true);
  assert.equal(reduced.result.actionability.canWriteReduce, true);
  assert.equal(reduced.result.actionability.canRevokeExpire, true);
  assert.equal(reduced.result.actionability.futureReadable, true);
  assert.equal(reduced.result.actionability.rawReadable, true);
  assert.deepEqual(reduced.result.actionAuthority.grantRefs, actionGrantRefs);
  assert.deepEqual(reduced.result.actionAuthority.exerciseRefs, [
    'exercise:agent:nvr',
    'exercise:agent:logging',
    'exercise:agent:build',
  ]);
  assert.deepEqual(reduced.result.actionAuthority.revocationRefs, ['revocation:agent:full:expiry']);
  assert.equal(reduced.result.accessAuthority.accessGroupRefs.includes('access-group:agent-events'), true);
  assert.equal(reduced.result.accessAuthority.accessGroupRefs.includes('access-group:agent-source-build'), true);
  assert.equal(reduced.result.accessAuthority.privateEnvelopeRefs.includes('private-envelope:event-detail:1'), true);
  assert.equal(reduced.result.accessAuthority.privateEnvelopeRefs.includes('private-envelope:source-build:1'), true);
  assert.equal(reduced.result.walletPosture.kind, 'runtime.authority.wallet.posture');
  assert.equal(reduced.result.walletPosture.ownerIdentityRef, 'identity:aux');
  assert.equal(reduced.result.walletPosture.granteeIdentityRef, 'identity:agent');
  assert.equal(reduced.result.walletPosture.granteeMemberRef, 'member:agent-browser');
  assert.deepEqual(reduced.result.walletPosture.subjectRefs, subjectRefs);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.serviceRefs, [
    'service:gateway',
    'service:nvr',
    'service:logging',
  ]);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.eventFabricRefs, ['event-fabric:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.storageRefs, ['storage:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.sourceRefs, ['source:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.buildRefs, ['build:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.subjectCoverage.appRefs, ['app:constitute-cybersec']);
  assert.deepEqual(reduced.result.walletPosture.resourceCoverage.serviceRefs, [
    'service:nvr',
    'service:gateway',
    'service:logging',
  ]);
  assert.deepEqual(reduced.result.walletPosture.resourceCoverage.storageRefs, ['storage:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.resourceCoverage.sourceRefs, ['source:identity:aux']);
  assert.deepEqual(reduced.result.walletPosture.resourceCoverage.buildRefs, ['build:identity:aux']);
  assert.deepEqual(
    reduced.result.walletPosture.rows.map((row) => [row.check, row.plane, row.state, row.actionable]),
    [
      ['sync', 'deliveryWitness', 'proved', true],
      ['read', 'accessAuthority', 'proved', true],
      ['writeReduce', 'actionAuthority', 'proved', true],
      ['revokeExpire', 'actionAuthority', 'proved', true],
    ],
  );
});

test('runtime authority records reducer does not infer readability from an action grant', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();

  const reduced = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [{
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:action-only',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'service:nvr',
      action: 'service.fulfill',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
    }],
  });

  assert.equal(reduced.ok, true);
  assert.equal(reduced.result.state, 'degraded');
  assert.equal(reduced.result.actionAuthority.state, 'ready');
  assert.equal(reduced.result.accessAuthority.state, 'blocked');
  assert.equal(reduced.result.actionability.canAct, true);
  assert.equal(reduced.result.actionability.canSync, false);
  assert.equal(reduced.result.actionability.canRead, false);
  assert.equal(reduced.result.actionability.futureReadable, false);
  assert.equal(reduced.result.blockedReasons.includes('syncWitnessMissing'), true);
  assert.equal(reduced.result.blockedReasons.includes('accessAuthorityMissing'), true);
  assert.equal(reduced.result.walletPosture.rows.length, 4);
  assert.equal(reduced.result.walletPosture.rows.find((row) => row.check === 'sync').actionable, false);
  assert.equal(reduced.result.walletPosture.rows.find((row) => row.check === 'read').actionable, false);
});

test('runtime authority records reducer permits read posture without write grants', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 60_000;

  const reduced = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [
      {
        kind: protocol.SWARM.RECORD_KIND.ACCESS_GROUP,
        groupId: 'access-group:agent-events:read-only',
        ownerRef: 'identity:aux',
        subjectRef: 'event-fabric:identity:aux',
        contentClasses: [protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL],
        memberRefs: ['member:agent-browser'],
        adminRefs: ['identity:aux'],
        currentEpochId: 'epoch:agent-events:read-only:1',
        issuedAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.ACCESS_EPOCH,
        epochId: 'epoch:agent-events:read-only:1',
        groupId: 'access-group:agent-events:read-only',
        sequence: 1,
        changeKind: protocol.AGREEMENT.ACCESS_EPOCH_CHANGE.ADD_MEMBER,
        memberRefs: ['member:agent-browser'],
        addedMemberRefs: ['member:agent-browser'],
        keyRef: 'key:agent-events:read-only:1',
        proofRefs: ['proof:epoch:read-only'],
        issuedAt,
        expiresAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.PRIVATE_CONTENT_ENVELOPE,
        envelopeId: 'private-envelope:event-detail:read-only',
        contentClass: protocol.AGREEMENT.CONTENT_CLASS.ENCRYPTED_DETAIL,
        accessGroupRef: 'access-group:agent-events:read-only',
        epochId: 'epoch:agent-events:read-only:1',
        subjectRef: 'logging:event:read-only',
        issuerRef: 'logging:processor',
        detailRef: 'storage:detail:read-only',
        recipientRefs: ['member:agent-browser'],
        issuedAt,
        expiresAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF,
        proofId: 'proof:agent-read-only',
        ownerIdentityRef: 'identity:aux',
        granteeIdentityRef: 'identity:agent',
        granteeMemberRef: 'member:agent-browser',
        subjectRefs: ['event-fabric:identity:aux'],
        actionGrantRefs: ['grant:agent:read-only-placeholder'],
        accessGroupRefs: ['access-group:agent-events:read-only'],
        accessEpochRefs: ['epoch:agent-events:read-only:1'],
        privateEnvelopeRefs: ['private-envelope:event-detail:read-only'],
        evidenceRefs: ['proof:browser:read-only'],
        state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.DEGRADED,
        blockedReasons: ['writeGrantMissing'],
        checks: [
          {
            check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.SYNC,
            plane: protocol.AGREEMENT.PLANE.DELIVERY_WITNESS,
            state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
            targetRef: 'member:agent-browser',
            evidenceRefs: ['proof:sync:read-only'],
          },
          {
            check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.READ,
            plane: protocol.AGREEMENT.PLANE.ACCESS_AUTHORITY,
            state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
            targetRef: 'event-fabric:identity:aux',
            accessGroupRefs: ['access-group:agent-events:read-only'],
            accessEpochRefs: ['epoch:agent-events:read-only:1'],
            evidenceRefs: ['proof:read:read-only'],
          },
          {
            check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.WRITE_REDUCE,
            plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
            state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.BLOCKED,
            targetRef: 'contract:logging.default',
            blockedReason: 'write grant absent',
          },
          {
            check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.REVOKE_EXPIRE,
            plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
            state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.BLOCKED,
            targetRef: 'grant:agent:read-only-placeholder',
            blockedReason: 'revoke grant absent',
            expiresAt,
          },
        ],
        issuedAt,
        expiresAt,
      },
    ],
  });

  assert.equal(reduced.ok, true);
  assert.equal(reduced.result.state, 'degraded');
  assert.equal(reduced.result.actionability.canSync, true);
  assert.equal(reduced.result.actionability.canRead, true);
  assert.equal(reduced.result.actionability.rawReadable, true);
  assert.equal(reduced.result.actionability.canUseActionGrant, false);
  assert.equal(reduced.result.actionability.canWriteReduce, false);
  assert.equal(reduced.result.actionability.canAct, false);
  assert.equal(reduced.result.accessAuthority.state, 'ready');
  assert.equal(reduced.result.actionAuthority.state, 'blocked');
});

test('runtime authority records reducer permits sync posture without readability', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 60_000;

  const reduced = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [{
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_MULTI_IDENTITY_PROOF,
      proofId: 'proof:agent-sync-only',
      ownerIdentityRef: 'identity:aux',
      granteeIdentityRef: 'identity:agent',
      granteeMemberRef: 'member:agent-browser',
      subjectRefs: ['contract:gateway.default'],
      actionGrantRefs: ['grant:agent:sync-placeholder'],
      accessGroupRefs: ['access-group:agent-sync-placeholder'],
      evidenceRefs: ['proof:browser:sync-only'],
      state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.DEGRADED,
      blockedReasons: ['readAccessMissing', 'writeGrantMissing'],
      checks: [
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.SYNC,
          plane: protocol.AGREEMENT.PLANE.DELIVERY_WITNESS,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.PROVED,
          targetRef: 'contract:gateway.default',
          evidenceRefs: ['witness:gateway:agent-sync'],
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.READ,
          plane: protocol.AGREEMENT.PLANE.ACCESS_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.BLOCKED,
          targetRef: 'event-fabric:identity:aux',
          accessGroupRefs: ['access-group:agent-sync-placeholder'],
          blockedReason: 'access group absent',
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.WRITE_REDUCE,
          plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.BLOCKED,
          targetRef: 'contract:logging.default',
          blockedReason: 'write grant absent',
        },
        {
          check: protocol.AGREEMENT.AUTHORITY_PROOF_CHECK.REVOKE_EXPIRE,
          plane: protocol.AGREEMENT.PLANE.ACTION_AUTHORITY,
          state: protocol.AGREEMENT.AUTHORITY_PROOF_STATE.BLOCKED,
          targetRef: 'grant:agent:sync-placeholder',
          blockedReason: 'revoke grant absent',
          expiresAt,
        },
      ],
      issuedAt,
      expiresAt,
    }],
  });

  assert.equal(reduced.ok, true);
  assert.equal(reduced.result.state, 'degraded');
  assert.equal(reduced.result.deliveryWitness.state, 'ready');
  assert.equal(reduced.result.actionability.canSync, true);
  assert.equal(reduced.result.actionability.canRead, false);
  assert.equal(reduced.result.actionability.futureReadable, false);
  assert.equal(reduced.result.actionability.rawReadable, false);
  assert.equal(reduced.result.actionability.canUseActionGrant, false);
  assert.equal(reduced.result.blockedReasons.includes('accessAuthorityMissing'), true);
});

test('runtime authority records reducer blocks expired and revoked action grants', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now() - 10_000;
  const expiresAt = Date.now() - 1_000;

  const expired = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [{
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
      grantId: 'grant:agent:expired',
      issuerRef: 'identity:aux',
      subjectRef: 'identity:agent',
      audienceRefs: ['member:agent-browser'],
      authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
      resourceRef: 'service:nvr',
      action: 'service.fulfill',
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
      issuedAt,
      expiresAt,
    }],
  });

  assert.equal(expired.ok, true);
  assert.equal(expired.result.actionability.canUseActionGrant, false);
  assert.equal(expired.result.actionability.canAct, false);
  assert.deepEqual(expired.result.actionAuthority.expiredGrantRefs, ['grant:agent:expired']);
  assert.equal(expired.result.blockedReasons.includes('grantExpired'), true);

  const revoked = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
        grantId: 'grant:agent:revoked',
        issuerRef: 'identity:aux',
        subjectRef: 'identity:agent',
        audienceRefs: ['member:agent-browser'],
        authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
        resourceRef: 'service:nvr',
        action: 'service.fulfill',
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
        issuedAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_GRANT_REVOCATION_POSTURE,
        revocationId: 'revocation:agent:revoked',
        targetGrantRef: 'grant:agent:revoked',
        issuerRef: 'identity:aux',
        authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
        affectedGrantRefs: ['grant:agent:revoked'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.REVOKED,
        reasonCode: 'operatorRevoked',
        evidenceRefs: ['proof:revocation:agent:revoked'],
        issuedAt,
        effectiveAt: Date.now() - 500,
      },
    ],
  });

  assert.equal(revoked.ok, true);
  assert.equal(revoked.result.actionability.canUseActionGrant, false);
  assert.equal(revoked.result.actionability.canRevokeExpire, true);
  assert.deepEqual(revoked.result.actionAuthority.revokedGrantRefs, ['grant:agent:revoked']);
  assert.equal(revoked.result.blockedReasons.includes('grantRevoked'), true);
});

test('runtime authority records reducer exposes root and device lifecycle posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();
  const rootRef = 'root:aux';
  const rotatedRootRef = 'root:aux:rotated';
  const deviceRef = 'device:aux-browser';
  const adminGrantRef = 'grant:root:admin';

  const reduced = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
        grantId: adminGrantRef,
        issuerRef: 'identity:aux',
        subjectRef: 'identity:aux',
        audienceRefs: [rootRef],
        authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
        resourceRef: 'identity:aux',
        action: 'authority.root.rotate',
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
        rootRefs: [rootRef],
        elevated: true,
        issuedAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
        operationId: 'root-op:add-aux',
        operation: protocol.AGREEMENT.ROOT_OPERATION.ADD_ROOT,
        identityRef: 'identity:aux',
        actorRef: rootRef,
        targetRef: rootRef,
        adminGrantRefs: [adminGrantRef],
        rootRefs: [rootRef],
        notificationRefs: ['notification:root:add-aux'],
        evidenceRefs: ['evidence:root:add-aux'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
        issuedAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
        operationId: 'root-op:refresh-aux',
        operation: protocol.AGREEMENT.ROOT_OPERATION.REFRESH_ROOT,
        identityRef: 'identity:aux',
        actorRef: rootRef,
        targetRef: rootRef,
        adminGrantRefs: [adminGrantRef],
        evidenceRefs: ['evidence:root:refresh-aux'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
        issuedAt: issuedAt + 1,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
        operationId: 'root-op:rotate-aux',
        operation: protocol.AGREEMENT.ROOT_OPERATION.ROTATE_ROOT,
        identityRef: 'identity:aux',
        actorRef: rootRef,
        targetRef: rotatedRootRef,
        adminGrantRefs: [adminGrantRef],
        rootRefs: [rotatedRootRef],
        notificationRefs: ['notification:root:rotate-aux'],
        evidenceRefs: ['evidence:root:rotate-aux'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
        issuedAt: issuedAt + 2,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
        operationId: 'root-op:enroll-browser',
        operation: protocol.AGREEMENT.ROOT_OPERATION.ENROLL_DEVICE,
        identityRef: 'identity:aux',
        actorRef: rotatedRootRef,
        targetRef: deviceRef,
        adminGrantRefs: [adminGrantRef],
        deviceRefs: [deviceRef],
        notificationRefs: ['notification:device:enroll-browser'],
        evidenceRefs: ['evidence:device:enroll-browser'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
        issuedAt: issuedAt + 3,
      },
    ],
  });

  assert.equal(reduced.ok, true);
  assert.equal(reduced.result.rootDeviceAuthority.state, 'ready');
  assert.deepEqual(reduced.result.rootDeviceAuthority.addRootRefs, ['root-op:add-aux']);
  assert.deepEqual(reduced.result.rootDeviceAuthority.refreshRootRefs, ['root-op:refresh-aux']);
  assert.deepEqual(reduced.result.rootDeviceAuthority.rotateRootRefs, ['root-op:rotate-aux']);
  assert.deepEqual(reduced.result.rootDeviceAuthority.enrollDeviceRefs, ['root-op:enroll-browser']);
  assert.deepEqual(reduced.result.rootDeviceAuthority.rootRefs, [rootRef, rotatedRootRef]);
  assert.deepEqual(reduced.result.rootDeviceAuthority.deviceRefs, [deviceRef]);
  assert.deepEqual(reduced.result.rootDeviceAuthority.adminGrantRefs, [adminGrantRef]);
  assert.equal(reduced.result.rootDeviceAuthority.notificationRefs.length, 3);
  assert.equal(reduced.result.rootDeviceAuthority.evidenceRefs.length, 4);
});

test('runtime authority records reducer blocks root operations without usable admin grants', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const issuedAt = Date.now();
  const rootRef = 'root:aux';

  const missingAdmin = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [{
      kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
      operationId: 'root-op:refresh-missing-admin',
      operation: protocol.AGREEMENT.ROOT_OPERATION.REFRESH_ROOT,
      identityRef: 'identity:aux',
      actorRef: rootRef,
      targetRef: rootRef,
      adminGrantRefs: ['grant:root:missing'],
      evidenceRefs: ['evidence:root:refresh-missing-admin'],
      state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
      issuedAt,
    }],
  });

  assert.equal(missingAdmin.ok, true);
  assert.equal(missingAdmin.result.rootDeviceAuthority.state, 'blocked');
  assert.deepEqual(missingAdmin.result.rootDeviceAuthority.operationRefs, []);
  assert.deepEqual(missingAdmin.result.rootDeviceAuthority.refreshRootRefs, []);
  assert.deepEqual(missingAdmin.result.rootDeviceAuthority.blockedOperationRefs, ['root-op:refresh-missing-admin']);
  assert.deepEqual(missingAdmin.result.rootDeviceAuthority.unusableAdminGrantRefs, ['grant:root:missing']);
  assert.equal(missingAdmin.result.blockedReasons.includes('adminGrantUnavailable'), true);

  const nonAdminGrantRef = 'grant:service:fulfill';
  const nonAdminGrant = await send(runtime.port, {
    type: 'runtime.authority.records.reduce',
    records: [
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ACTION_GRANT,
        grantId: nonAdminGrantRef,
        issuerRef: 'identity:aux',
        subjectRef: 'identity:aux',
        audienceRefs: [rootRef],
        authorityDomain: protocol.SWARM.AUTHORITY_DOMAIN.IDENTITY,
        resourceRef: 'service:nvr',
        action: 'service.fulfill',
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.ACCEPTED,
        issuedAt,
      },
      {
        kind: protocol.SWARM.RECORD_KIND.AUTHORITY_ROOT_OPERATION,
        operationId: 'root-op:refresh-non-admin',
        operation: protocol.AGREEMENT.ROOT_OPERATION.REFRESH_ROOT,
        identityRef: 'identity:aux',
        actorRef: rootRef,
        targetRef: rootRef,
        adminGrantRefs: [nonAdminGrantRef],
        evidenceRefs: ['evidence:root:refresh-non-admin'],
        state: protocol.AGREEMENT.ACTION_GRANT_STATE.APPLIED,
        issuedAt: issuedAt + 1,
      },
    ],
  });

  assert.equal(nonAdminGrant.ok, true);
  assert.equal(nonAdminGrant.result.rootDeviceAuthority.state, 'blocked');
  assert.deepEqual(nonAdminGrant.result.rootDeviceAuthority.operationRefs, []);
  assert.deepEqual(nonAdminGrant.result.rootDeviceAuthority.refreshRootRefs, []);
  assert.deepEqual(nonAdminGrant.result.rootDeviceAuthority.blockedOperationRefs, ['root-op:refresh-non-admin']);
  assert.deepEqual(nonAdminGrant.result.rootDeviceAuthority.unusableAdminGrantRefs, [nonAdminGrantRef]);
  assert.equal(nonAdminGrant.result.blockedReasons.includes('adminGrantUnavailable'), true);
});

test('runtime activation waits for explicit device authority instead of relying on cache timing', async () => {
  const runtime = loadRuntime(new Map(), { noDevice: true });
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });

  const missingAuthority = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'stream-open-before-authority',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(missingAuthority.ok, true);
  assert.equal(missingAuthority.result.state, 'waitingAuthority');
  assert.equal(missingAuthority.result.pendingAuthority, true);
  assert.equal(missingAuthority.result.blockedAuthorityDomain, protocol.SWARM.AUTHORITY_DOMAIN.RUNTIME);
  assert.equal(missingAuthority.result.authorityLifecycleState, 'waitingAuthority');
  assert.equal(missingAuthority.result.routingScope.kind, protocol.SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE);
  assert.equal(missingAuthority.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
  const waitingSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const waitingActivation = Object.values(waitingSnapshot.result.activationResolutions)
    .find((entry) => entry.activationId === missingAuthority.result.activationId);
  assert.equal(waitingActivation.state, 'waitingAuthority');
  assert.equal(waitingActivation.blockedAuthorityDomain, protocol.SWARM.AUTHORITY_DOMAIN.RUNTIME);
  assert.equal(waitingActivation.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);

  const authority = await send(runtime.port, {
    type: 'runtime.authority.device.put',
    device: {
      nostr: {
        pk: protocol.pubkeyFromSecretKey(BROWSER_SK),
        skHex: BROWSER_SK,
      },
    },
  });
  assert.equal(authority.ok, true);
  assert.equal(authority.result.devicePk, protocol.pubkeyFromSecretKey(BROWSER_SK));
  assert.equal(authority.result.posture.state, 'ready');
  let waitingRoute = null;
  for (let attempt = 0; attempt < 30 && !waitingRoute; attempt += 1) {
    const waitingRouteSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
    waitingRoute = Object.values(waitingRouteSnapshot.result.activationResolutions)
      .find((entry) => entry.activationId === missingAuthority.result.activationId && entry.state === 'waitingRouteBaseline') || null;
    if (!waitingRoute) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(waitingRoute);
  assert.equal(waitingRoute.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);

  await seedNvrEdgeDirectory(runtime.port);
  let repairedFrame = null;
  for (let attempt = 0; attempt < 30 && !repairedFrame; attempt += 1) {
    const repairedQueue = await send(runtime.port, { type: 'swarm.queue.get' });
    repairedFrame = Object.values(repairedQueue.result)
      .find((entry) => entry?.frame?.channelId === 'nvr.streams') || null;
    if (!repairedFrame) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(repairedFrame);
  assert.equal(repairedFrame.frame.issuer, protocol.pubkeyFromSecretKey(BROWSER_SK));
  const repairSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const repairedEvent = repairSnapshot.result.runtimeEvents.find((entry) => entry.kind === 'interaction.repaired');
  assert.equal(repairedEvent?.level, 'info');

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'stream-open-after-authority',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.issuer, protocol.pubkeyFromSecretKey(BROWSER_SK));
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
});

test('runtime resource sample is debug-only and bounded', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const denied = await send(runtime.port, { type: 'runtime.resource.sample.get' });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /debug subscriber/);

  const subscribed = await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'resource-test',
    surface: 'resource-test',
    logging: false,
  });
  assert.equal(subscribed.ok, true);

  const sampled = await send(runtime.port, { type: 'runtime.resource.sample.get' });
  assert.equal(sampled.ok, true);
  assert.equal(sampled.result.sampleKind, 'runtime.resource.sample');
  assert.equal(sampled.result.debugOnly, true);
  assert.equal(sampled.result.activeProfile.id, 'balanced');
  assert.equal(sampled.result.protocol.profile.kind, protocol.SWARM.RECORD_KIND.RESOURCE_PROFILE);
  assert.equal(sampled.result.protocol.profile.profileId, 'balanced');
  assert.equal(sampled.result.protocol.posture.kind, protocol.SWARM.RECORD_KIND.RESOURCE_POSTURE);
  assert.equal(sampled.result.protocol.posture.profileId, 'balanced');
  assert.equal(sampled.result.counts.activeRuntimeClients >= 1, true);
  assert.equal(sampled.result.counts.sharedWorkerPorts >= 1, true);
  assert.equal(
    sampled.result.counts.diagnosticRing <= sampled.result.counts.diagnosticRingLimit,
    true,
  );
  assert.ok(['available', 'unavailable'].includes(sampled.result.memory.state));
  assert.equal(sampled.result.storage.state, 'unavailable');
  assert.ok(['withinBudget', 'pressure', 'overBudget', 'sweeping', 'blocked'].includes(sampled.result.posture.state));

  const command = await send(runtime.port, {
    type: 'runtime.diagnostics.command',
    command: 'resourceSample',
    nonce: 'resource-sample-command',
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(command.ok, true);
  assert.equal(command.result.result.sampleKind, 'runtime.resource.sample');
});

test('runtime resource profiles derive budget classes for runtime enforcement', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const defaultProfile = await send(runtime.port, { type: 'runtime.resource.profile.get' });
  assert.equal(defaultProfile.ok, true);
  assert.equal(defaultProfile.result.id, 'balanced');

  const updated = await send(runtime.port, {
    type: 'runtime.resource.profile.put',
    profile: { id: 'operatorDev' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.result.id, 'operatorDev');
  assert.equal(updated.result.memoryBudgetBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(updated.result.storageBudgetBytes, 4 * 1024 * 1024 * 1024);
  assert.equal(updated.result.caps.devBridgeSessions, 8);

  await send(runtime.port, {
    type: 'runtime.diagnostics.subscribe',
    clientId: 'profile-test',
    surface: 'profile-test',
    logging: false,
  });
  const sampled = await send(runtime.port, { type: 'runtime.resource.sample.get' });
  assert.equal(sampled.ok, true);
  assert.equal(sampled.result.activeProfile.id, 'operatorDev');
  assert.equal(sampled.result.budgets.memoryBudgetBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(sampled.result.budgets.storageBudgetBytes, 4 * 1024 * 1024 * 1024);
  assert.equal(sampled.result.protocol.profile.profileId, 'operatorDev');
  assert.equal(sampled.result.protocol.posture.profileId, 'operatorDev');
});

test('retention release posture blocks unfulfilled durable data and recomputes pins', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);

  const unfulfilled = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'projection:logging.events',
      policy: { class: 'durable' },
      residency: { layer: 'browser-cache' },
      fulfillments: [],
    },
  });
  assert.equal(unfulfilled.ok, true);
  assert.equal(unfulfilled.result.state, 'releaseBlocked');
  assert.equal(unfulfilled.result.freeable, false);
  assert.ok(unfulfilled.result.blockers.includes('fulfillment.missing'));
  assert.equal(unfulfilled.result.releasePosture.kind, protocol.SWARM.RECORD_KIND.RETENTION_RELEASE);
  assert.equal(unfulfilled.result.releasePosture.state, protocol.SWARM.RETENTION_RELEASE_STATE.RELEASE_BLOCKED);
  assert.equal(unfulfilled.result.releasePosture.subjectRef, 'projection:logging.events');
  assert.equal(unfulfilled.result.releasePosture.policyRefs.includes('policy:runtime.retention.durable'), true);
  assert.equal(unfulfilled.result.releasePosture.overlayRefs.includes('overlay:none'), true);

  const witnessBlocked = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'projection:logging.events',
      policy: { class: 'durable', requireWitness: true, releaseAfter: Date.now() + 10_000 },
      fulfillments: [{ state: 'fulfilled', holder: 'storage:local' }],
      validUntil: Date.now() + 10_000,
    },
  });
  assert.equal(witnessBlocked.result.state, 'releaseBlocked');
  assert.ok(witnessBlocked.result.blockers.includes('validity.active'));
  assert.ok(witnessBlocked.result.blockers.includes('releaseAfter.pending'));
  assert.ok(witnessBlocked.result.blockers.includes('witness.missing'));

  const disposable = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'diagnostic:ring',
      policy: { class: 'session' },
      residency: { layer: 'browser-hot' },
    },
  });
  assert.equal(disposable.result.state, 'freeable');
  assert.equal(disposable.result.destructiveAction, false);
  assert.equal(disposable.result.releasePosture.state, protocol.SWARM.RETENTION_RELEASE_STATE.FREEABLE);

  const fulfilled = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'projection:logging.events',
      policy: { class: 'durable' },
      fulfillments: [{ state: 'fulfilled', holder: 'storage:local' }],
      witnessRefs: ['witness:runtime:release'],
    },
  });
  assert.equal(fulfilled.result.state, 'freeable');
  assert.equal(fulfilled.result.releasePosture.state, protocol.SWARM.RETENTION_RELEASE_STATE.FREEABLE);
  assert.equal(fulfilled.result.releasePosture.witnessRefs[0], 'witness:runtime:release');

  const pinned = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'nvr:chunk:front-door:0',
      policy: { class: 'durable' },
      fulfillments: [{ state: 'fulfilled', holder: 'storage:archive' }],
      pins: [{ pinId: 'user-pin', class: 'immortal', active: true }],
    },
  });
  assert.equal(pinned.result.state, 'releaseBlocked');
  assert.equal(pinned.result.effectiveRetention.class, 'immortal');
  assert.ok(pinned.result.blockers.includes('activePin'));
  assert.equal(pinned.result.releasePosture.state, protocol.SWARM.RETENTION_RELEASE_STATE.RELEASE_BLOCKED);

  const unpinned = await send(runtime.port, {
    type: 'runtime.retention.release.evaluate',
    payload: {
      subjectRef: 'nvr:chunk:front-door:0',
      policy: { class: 'durable' },
      fulfillments: [{ state: 'fulfilled', holder: 'storage:archive' }],
      pins: [{ pinId: 'user-pin', class: 'immortal', active: false }],
    },
  });
  assert.equal(unpinned.result.state, 'freeable');
  assert.equal(unpinned.result.effectiveRetention.class, 'durable');
  assert.equal(unpinned.result.releasePosture.state, protocol.SWARM.RETENTION_RELEASE_STATE.FREEABLE);
});

test('runtime materializes local logging projections from safe diagnostic evidence', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, { type: 'swarm.frame.queue', payload: frameInput({ nonce: 'logging-projection-evidence' }) });

  const eventsPolicy = {
    service: 'logging',
    nodePath: 'events',
    policyId: 'logging.default.72h.low',
    syncDepthTarget: { mode: 'policyComplete', targetCount: 10 },
  };
  const storedEventsPolicy = await send(runtime.port, {
    type: 'projection.policy.put',
    policy: eventsPolicy,
  });
  assert.equal(storedEventsPolicy.ok, true);

  const eventsProjection = await send(runtime.port, {
    type: 'projection.get',
    service: 'logging',
    channelId: 'logging.events',
    policyId: eventsPolicy.policyId,
  });
  assert.equal(eventsProjection.ok, true);
  assert.equal(eventsProjection.result.channelId, 'logging.events');
  assert.equal(eventsProjection.result.payload.nodePath, 'events');
  assert.equal(eventsProjection.result.payload.events.length > 0, true);
  assert.equal(eventsProjection.result.payload.coverage.materializedCount, eventsProjection.result.payload.events.length);
  assert.equal(eventsProjection.result.safeFacts.source, 'runtime.safeDiagnostics');

  for (const nodePath of ['health', 'dashboard']) {
    const channelId = `logging.${nodePath}`;
    const policyId = `logging.default.72h.low.${nodePath}`;
    const response = await send(runtime.port, {
      type: 'projection.policy.put',
      policy: {
        service: 'logging',
        nodePath,
        policyId,
        syncDepthTarget: { mode: 'snapshot', targetCount: 1 },
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    const projection = await send(runtime.port, {
      type: 'projection.get',
      service: 'logging',
      channelId,
      policyId,
    });
    assert.equal(projection.ok, true);
    assert.equal(projection.result.payload.nodePath, nodePath);
    assert.equal(projection.result.payload.coverage.materializedCount, 1);
  }
});

test('runtime stream activation derives route fields from retained service catalog', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'minimal-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.equal(queued.result.frame.capability, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
  assert.equal(queued.result.frame.audience.servicePk, SERVICE_PK);
  assert.equal(queued.result.frame.audience.serviceRef, `service:nvr:${SERVICE_PK}`);
  assert.ok(queued.result.frame.audience.audienceRefs.includes(`service:${SERVICE_PK}`));
  assert.equal(queued.result.frame.audience.gatewayRef, GATEWAY_PK);
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.activation.kind, protocol.SWARM.RECORD_KIND.RUNTIME_ACTIVATION_REQUEST);
  assert.equal(opened.activation.nodeRef, 'nvr.streams');
  assert.equal(opened.activation.capabilityRef, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
  assert.deepEqual(opened.activation.params.sourceIds, ['cam-1']);
  assert.equal(opened.routePromise.kind, protocol.SWARM.RECORD_KIND.ROUTE_PROMISE);
  assert.equal(opened.routePromise.activationId, opened.activation.activationId);
  assert.equal(opened.routePromise.servicePk, SERVICE_PK);
  assert.equal(opened.routePromise.serviceMemberRef, SERVICE_PK);
  assert.equal(opened.routePromise.channelId, 'nvr.streams');
  assert.ok(opened.routePromise.audienceRefs.includes(`service:${SERVICE_PK}`));
  for (const field of protocol.SWARM.ACTIVATION_FORBIDDEN_FIELDS) {
    assert.equal(Object.hasOwn(opened.activation, field), false, `activation leaked ${field}`);
    assert.equal(Object.hasOwn(opened.activation.params, field), false, `activation params leaked ${field}`);
  }
  assert.equal(opened.authority.servicePk, SERVICE_PK);
  assert.equal(opened.authority.gatewayPk, GATEWAY_PK);
  assert.equal(opened.authority.identityId, 'identity-1');
});

test('runtime service catalog exposes service registry materialization posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await seedNvrEdgeDirectory(runtime.port);

  const catalog = await send(runtime.port, { type: 'service.catalog.get' });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.result.registry.kind, protocol.SWARM.RECORD_KIND.SERVICE_REGISTRY_MATERIALIZATION);
  assert.equal(catalog.result.registry.state, protocol.SERVICE_REGISTRY.MATERIALIZATION_STATE.READY);
  assert.equal(catalog.result.registry.claimRefs.length, 1);
  assert.equal(catalog.result.registry.serviceRefs[0], `service:nvr:${SERVICE_PK}`);
  assert.equal(Array.isArray(catalog.result.registry.entries), true);
  assert.equal(catalog.result.services[0].hostFabric.state, protocol.FABRIC.FULFILLMENT_PLAN_STATE.READY);
  assert.equal(catalog.result.services[0].hostFabric.associationHandoffRef.startsWith('handoff:gateway:'), true);
  assert.equal(catalog.result.services[0].hostFabric.gatewayAssociationContribution.role, protocol.FABRIC.MEMBER_ROLE.GATEWAY_ASSOCIATION);
  assert.equal(catalog.result.registry.services[0].hostFabric.state, protocol.FABRIC.FULFILLMENT_PLAN_STATE.READY);
});

test('runtime snapshot exposes selected target source and fabric records', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await seedNvrEdgeDirectory(runtime.port);

  const snapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.result.targetSource.kind, 'runtime.contract-target.source');
  assert.equal(snapshot.result.contractTargets.length, 1);
  assert.equal(snapshot.result.targetRegistryPostures.length, 1);
  assert.equal(snapshot.result.hostFabricFulfillmentPlans.length >= 1, true);
  assert.equal(snapshot.result.hostFabricContributions.length >= 1, true);
  assert.equal(snapshot.result.lifecyclePlans.length >= 1, true);
  const target = protocol.assertContractTarget(snapshot.result.contractTargets[0]);
  const registry = protocol.assertContractTargetRegistryPosture(snapshot.result.targetRegistryPostures[0]);
  assert.equal(target.targetRef, 'contract-target:desktop-windows-dev:msa-transition');
  assert.equal(target.state, protocol.FABRIC.CONTRACT_TARGET_STATE.READY);
  assert.equal(target.negativeSlotRefs.includes('slot:native-client'), true);
  assert.equal(target.missingSlotRefs.includes('slot:native-client'), false);
  assert.equal(registry.state, protocol.FABRIC.CONTRACT_TARGET_REGISTRY_STATE.READY);
  assert.equal(
    registry.slotPostures.some((slot) => (
      slot.slotRef === 'slot:gateway'
      && slot.state === protocol.FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE
    )),
    true,
  );
  assert.equal(
    registry.slotPostures.some((slot) => (
      slot.slotRef === 'slot:native-client'
      && slot.state === protocol.FABRIC.CONTRACT_TARGET_SLOT_STATE.NOT_REQUIRED
    )),
    true,
  );
  assert.equal(
    registry.slotPostures.some((slot) => (
      slot.slotRef === 'slot:browser-webrtc'
      && slot.state === protocol.FABRIC.CONTRACT_TARGET_SLOT_STATE.AVAILABLE
      && slot.selectedFulfillmentRef === 'fulfillment:browser-webrtc:authenticated-desktop-browser'
    )),
    true,
  );
});

test('runtime service catalog labels retained hosted-service fallback posture', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);

  await send(runtime.port, {
    type: 'managedAppliances.sourceSnapshot.put',
    sourceSnapshot: {
      identityDevices: [{ pk: BROWSER_PK, identityId: 'identity-1', label: 'Aux' }],
      swarmDevices: [
        {
          devicePk: GATEWAY_PK,
          deviceLabel: 'DevGateway',
          role: 'gateway',
          service: 'gateway',
          identityId: 'identity-1',
          updatedAt: Date.now() - 60_000,
          gatewayAssociationPosture: gatewayAssociationPosture(Date.now(), GATEWAY_PK),
          hostedServices: [],
        },
      ],
      grantedRecords: [],
    },
  });

  const catalog = await send(runtime.port, { type: 'service.catalog.get' });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.result.services[0].legacyPathFallback.state, 'legacyPathFallback');
  assert.match(catalog.result.services[0].legacyPathFallback.reason, /retained hosted-service cache/);
  assert.equal(catalog.result.registry.services[0].legacyPathFallback.state, 'legacyPathFallback');
});

test('runtime stream activation resolves NVR source ids through service contract baseline', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      service: 'nvr',
      servicePk: SERVICE_PK,
      gatewayPk: GATEWAY_PK,
      identityId: 'identity-1',
      nodeRef: 'cam-1',
      sourceId: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      intentId: 'contract-baseline-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.equal(queued.result.frame.capability, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
  assert.equal(queued.result.frame.audience.serviceRef, `service:nvr:${SERVICE_PK}`);
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.activation.nodeRef, 'nvr.streams');
  assert.deepEqual(opened.activation.params.sourceIds, ['cam-1']);
  assert.equal(opened.routePromise.channelId, 'nvr.streams');
  assert.equal(opened.routePromise.serviceMemberRef, SERVICE_PK);
  assert.equal(opened.routePromise.servicePk, SERVICE_PK);
});

test('runtime stream activation derives route channel from hosted node descriptors before surface projection arrives', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, {
    skipSurfaceProjection: true,
    hostedNodes: [
      {
        path: 'streams',
        nodeId: 'nvr.streams',
        label: 'Streams',
        backingChannel: 'nvr.streams',
        capabilities: [
          protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
          protocol.SWARM.CORE_CAPABILITY.STREAM_SESSION_OFFER,
        ],
      },
    ],
    serviceZoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'manifest-node-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.equal(queued.result.frame.capability, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.routePromise.channelId, 'nvr.streams');
  assert.equal(opened.routePromise.serviceMemberRef, SERVICE_PK);
});

test('runtime stream activation derives identity authority from retained gateway service records', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, { noIdentityDevices: true });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'retained-gateway-authority-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.equal(opened.authority.servicePk, protocol.pubkeyFromSecretKey(SERVICE_SK));
  assert.equal(opened.authority.gatewayPk, protocol.pubkeyFromSecretKey(GATEWAY_SK));
  assert.equal(opened.authority.identityId, 'identity-1');
});

test('runtime stream activation waits for live edge acceptance before sending frames', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port);
  await seedNvrEdgeDirectory(runtime.port);

  const pending = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'edge-wait-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(pending.ok, true);
  assert.equal(pending.result.pendingRoute, true);
  assert.equal(pending.result.reason, protocol.SWARM.ROUTING_BLOCKED_REASON.EDGE_NOT_ACCEPTED);
  assert.equal(pending.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);
  assert.equal(pending.result.routingScope.edgeAccepted, false);
  assert.equal(pending.result.routingScope.serviceMemberRef, SERVICE_PK);
  const queuedBeforeEdge = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(queuedBeforeEdge.result).length, 0);

  const explicitScopePending = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'edge-wait-explicit-scope-stream-open',
      routingScope: {
        kind: protocol.SWARM.ROUTING_SCOPE_KIND.SWARM_ZONE,
        required: true,
        state: protocol.SWARM.ROUTING_SCOPE_STATE.READY,
        zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
        source: 'explicitRoutingScope',
        serviceMemberRef: SERVICE_PK,
        updatedAt: Date.now(),
      },
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });
  assert.equal(explicitScopePending.ok, true, JSON.stringify(explicitScopePending));
  assert.equal(explicitScopePending.result.pendingRoute, true);
  assert.equal(explicitScopePending.result.reason, protocol.SWARM.ROUTING_BLOCKED_REASON.EDGE_NOT_ACCEPTED);
  assert.equal(explicitScopePending.result.routingScope.state, protocol.SWARM.ROUTING_SCOPE_STATE.SYNCING);

  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });
  const sent = await waitFor(() => {
    const message = runtime.port.messages.find((entry) => (
      entry.type === 'swarm.edge.sent'
      && entry.frames?.some((frame) => frame.channelId === 'nvr.streams')
    ));
    return message?.frames?.find((frame) => frame.channelId === 'nvr.streams');
  });
  assert.equal(sent.frame.channelId, 'nvr.streams');
  assert.equal(sent.frame.capability, protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW);
});

test('runtime stream activation fails locally when no stream contract channel can be resolved', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      service: 'unknown-video',
      servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
      gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
      identityId: 'identity-1',
      nodeRef: 'cam-1',
      sourceId: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      intentId: 'unresolved-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, false);
  assert.equal(queued.error, 'runtime could not resolve stream route channel');
  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.keys(queue.result).length, 0);
});

test('runtime stream activation prefers service zone over browser edge attach zone', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await seedNvrServiceCatalog(runtime.port, {
    serviceZoneScope: { zoneId: 'zone_nvr', privacy: 'rawIds', ttl: 30, maxHops: 2 },
  });
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_browser', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port, { zoneScope: { zoneId: 'zone_nvr', privacy: 'rawIds', ttl: 30, maxHops: 2 } });

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      nodeRef: 'cam-1',
      capabilityRef: protocol.SWARM.CORE_CAPABILITY.MEDIA_STREAM_PREVIEW,
      sourceId: 'cam-1',
      transport: 'webrtc',
      intentId: 'service-zone-stream-open',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.result.frame.channelId, 'nvr.streams');
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_nvr',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
  const opened = protocol.openEnvelope(queued.result.frame.body.envelope, SERVICE_SK, { now: Date.now() });
  assert.deepEqual(opened.routePromise.zoneScope, {
    zoneId: 'zone_nvr',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
});

test('app intent RPCs route local identity zones through the active edge zone', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      service: 'nvr',
      servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
      gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
      identityId: 'identity-1',
      owner: true,
      viewSources: ['cam-1'],
      zoneScope: { zoneId: 'identity:identity-1', privacy: 'rawIds', ttl: 30, maxHops: 2 },
      channelId: 'nvr.streams',
      intentId: 'runtime.stream.open.intent',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
});

test('app intent RPCs assign a propagating hop budget when edge scope is local-only', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  await send(runtime.port, {
    type: 'swarm.edge.test.connect',
    zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
  });
  await seedNvrEdgeDirectory(runtime.port);

  const queued = await send(runtime.port, {
    type: 'runtime.stream.open',
    payload: {
      service: 'nvr',
      servicePk: protocol.pubkeyFromSecretKey(SERVICE_SK),
      gatewayPk: protocol.pubkeyFromSecretKey(GATEWAY_SK),
      identityId: 'identity-1',
      owner: true,
      viewSources: ['cam-1'],
      zoneScope: { zoneId: 'zone_lab', privacy: 'rawIds', ttl: 30, maxHops: 0 },
      channelId: 'nvr.streams',
      intentId: 'runtime.stream.open.intent.hops',
      offer: { description: { type: 'offer', sdp: 'v=0\r\n' }, sourceIds: ['cam-1'] },
    },
  });

  assert.equal(queued.ok, true);
  assert.deepEqual(queued.result.frame.zoneScope, {
    zoneId: 'zone_lab',
    privacy: 'rawIds',
    ttl: 30,
    maxHops: 2,
  });
});

test('projection delta applies on matching revision and queues repair on mismatch', async () => {
  const runtime = loadRuntime(new Map());
  await attach(runtime.port);
  const snapshot = {
    projectionId: 'proj-1',
    policyId: 'default',
    revision: 4,
    state: { cameras: [{ id: 'front', status: 'ok' }] },
    coverage: { materializedCount: 1, targetCount: 1, completionRatio: 1, syncState: 'completeEnough' },
    freshness: { state: 'fresh', updatedAt: Date.now() },
    sourceRefs: [],
    issuedAt: Date.now(),
  };
  assert.equal((await send(runtime.port, { type: 'projection.snapshot.apply', snapshot })).ok, true);

  const delta = {
    projectionId: 'proj-1',
    policyId: 'default',
    baseRevision: 4,
    revision: 5,
    ops: [{ op: 'set', path: ['cameras', 0, 'status'], value: 'degraded' }],
    affectedRecords: ['camera:front'],
    coverage: snapshot.coverage,
    freshness: { state: 'fresh', updatedAt: Date.now() },
    sourceRefs: [],
    issuedAt: Date.now(),
  };
  const applied = await send(runtime.port, { type: 'projection.delta.apply', delta });
  assert.equal(applied.ok, true);
  assert.equal(applied.changed, true);
  assert.equal(applied.result.revision, 5);
  assert.equal(applied.result.payload.cameras[0].status, 'degraded');

  const observerCount = runtime.port.messages.filter((entry) => entry.type === 'projection.observer.update').length;
  const noop = await send(runtime.port, {
    type: 'projection.delta.apply',
    delta: { ...delta, baseRevision: 5, revision: 6 },
  });
  assert.equal(noop.ok, true);
  assert.equal(noop.changed, false);
  assert.equal(runtime.port.messages.filter((entry) => entry.type === 'projection.observer.update').length, observerCount);

  const mismatch = await send(runtime.port, {
    type: 'projection.delta.apply',
    delta: { ...delta, baseRevision: 9, revision: 10 },
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.repairRequest.reason, 'revisionGap');
  assert.equal(mismatch.repairPosture.state, protocol.SWARM.PROJECTION_REPAIR_STATE.PENDING);
  const queue = await send(runtime.port, { type: 'swarm.queue.get' });
  assert.equal(Object.values(queue.result).some((entry) => entry.frame.kind === protocol.SWARM.FRAME_KIND.PROJECTION_REPAIR_REQUEST), false);
  const repairSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(repairSnapshot.result.edge.repairRequests.some((entry) => entry.repairPosture?.state === protocol.SWARM.PROJECTION_REPAIR_STATE.PENDING), true);
  assert.equal(
    Object.values(repairSnapshot.result.activationResolutions).some((entry) => entry.state === 'projectionRepairPending'),
    false,
  );
  const repairEvent = repairSnapshot.result.runtimeEvents.find((entry) => entry.kind === 'projection.repair.request');
  assert.equal(repairEvent?.level, 'info');

  const repeatMismatch = await send(runtime.port, {
    type: 'projection.delta.apply',
    delta: { ...delta, baseRevision: 10, revision: 11 },
  });
  assert.equal(repeatMismatch.ok, false);
  const repeatSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  const repairs = repeatSnapshot.result.edge.repairRequests.filter((entry) => entry.repairPosture?.projectionId === 'proj-1');
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].repairRequest.requiredRevision, 10);
  assert.equal(repairs[0].seenCount, 2);
  assert.equal(repeatSnapshot.result.runtimeEvents.filter((entry) => entry.kind === 'projection.repair.request').length, 1);

  const missingBaseline = await send(runtime.port, {
    type: 'projection.delta.apply',
    delta: { ...delta, projectionId: 'fresh-proj', baseRevision: 4, revision: 5 },
  });
  assert.equal(missingBaseline.ok, false);
  assert.equal(missingBaseline.repairRequest.reason, 'missingProjectionBaseline');

  const catchupSnapshot = {
    ...snapshot,
    projectionId: 'fresh-proj',
    revision: 4,
    state: { cameras: [] },
  };
  assert.equal((await send(runtime.port, { type: 'projection.snapshot.apply', snapshot: catchupSnapshot })).ok, true);
  const catchupDelta = await send(runtime.port, {
    type: 'projection.delta.apply',
    delta: {
      ...delta,
      projectionId: 'fresh-proj',
      baseRevision: 4,
      revision: 5,
      ops: [{ op: 'set', path: ['cameras', 0], value: { id: 'front', status: 'ok' } }],
    },
  });
  assert.equal(catchupDelta.ok, true);
  assert.equal(catchupDelta.result.revision, 5);
  const satisfiedSnapshot = await send(runtime.port, { type: 'runtime.snapshot.get' });
  assert.equal(satisfiedSnapshot.result.edge.repairRequests.some((entry) => entry.repairPosture?.projectionId === 'fresh-proj'), false);
  assert.equal(satisfiedSnapshot.result.runtimeEvents.some((entry) => entry.kind === 'projection.repair.satisfied'), true);

  const staleSnapshot = await send(runtime.port, {
    type: 'projection.snapshot.apply',
    snapshot: { ...catchupSnapshot, revision: 3, state: { cameras: [{ id: 'front', status: 'stale' }] } },
  });
  assert.equal(staleSnapshot.ok, true);
  assert.equal(staleSnapshot.ignored, true);
  assert.equal(staleSnapshot.reason, 'staleProjectionSnapshot');
});

test('account runtime source has no retired broker product path strings', () => {
  const files = [
    workerPath,
    resolve(here, '../app.js'),
    resolve(here, '../identity/sw/rpc.js'),
    resolve(here, '../identity/sw/relayIn.js'),
  ];
  const retired = [
    ['SERVICE', 'SIGNAL', 'REQUEST'].join('_'),
    ['service', 'Signal'].join(''),
    ['gateway', ['service', 'Sign', 'al'].join('')].join('.'),
    ['gateway', '_service', '_signal'].join(''),
    ['service', '_signal'].join(''),
    ['service', 'Capability'].join(''),
    ['service', 'Access', 'Context'].join(''),
    ['gateway', ['service', 'Access'].join('')].join('.'),
    ['runtime', 'edge'].join('.'),
  ];

  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const needle of retired) {
      assert.equal(body.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});
