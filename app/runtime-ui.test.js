import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuntimeSnapshotView,
  renderRuntimeSnapshotView,
} from './runtime-ui.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this._textContent = '';
    this.value = '';
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get textContent() {
    return [
      this._textContent,
      ...this.children.map((child) => child.textContent),
    ].join('');
  }

  set textContent(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
}

function fakeDocument() {
  return {
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}

function runtimeElements() {
  return {
    catalogStatusEl: new FakeElement(),
    catalogListEl: new FakeElement(),
    edgeStatusEl: new FakeElement(),
    queueStatusEl: new FakeElement(),
    projectionStatusEl: new FakeElement(),
    resourceStatusEl: new FakeElement(),
    retentionStatusEl: new FakeElement(),
    runtimeStatusDetailEl: new FakeElement(),
  };
}

test('runtime service catalog view renders retained snapshot services', () => {
  const snapshot = {
    materializationBudget: {
      budgetId: 'runtime.account.snapshot',
      limits: { estimatedSnapshotBytes: 4096 },
    },
    serviceCatalog: {
      updatedAt: 1710000000000,
      registry: {
        kind: 'service.registry.materialization',
        registryId: 'service-registry:runtime',
        state: 'ready',
        issuedAt: 1710000000100,
        claimRefs: ['claim:logging'],
        services: [
          {
            service: 'logging',
            servicePk: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            hostGatewayPk: 'gateway-pk',
            summary: 'Event projection retained.',
            health: { state: 'ready' },
            surfaceChannel: 'service.logging.surface',
            hostFabric: {
              state: 'ready',
              associationHandoffRef: 'handoff:gateway:abcdef012345:initial-owner',
              blockedReasons: [],
            },
            nodes: [
              { path: 'events', label: 'Events', capabilities: ['projection.observe'] },
              { path: 'health', label: 'Health', capabilities: ['projection.observe'] },
            ],
          },
        ],
      },
      services: [
        {
          service: 'legacy',
          servicePk: 'legacy-pk',
        },
      ],
    },
  };
  const elements = runtimeElements();

  const view = renderRuntimeSnapshotView(elements, snapshot, fakeDocument());

  assert.equal(view.catalogLabel, '1 service');
  assert.equal(view.materialization.state, 'withinBudget');
  assert.equal(view.materialization.budgetId, 'runtime.account.snapshot');
  assert.equal(view.serviceRegistry.source, 'serviceRegistry');
  assert.equal(view.serviceRegistry.claimCount, 1);
  assert.equal(elements.catalogStatusEl.textContent, '1 service');
  assert.match(elements.catalogListEl.textContent, /Logging - ready/);
  assert.match(elements.catalogListEl.textContent, /fabric ready/);
  assert.match(elements.catalogListEl.textContent, /handoff handoff:ga\.\.\.wner/);
  assert.match(elements.catalogListEl.textContent, /Nodes: Events, Health/);
});

test('runtime service catalog view consumes runtime materialization envelope', () => {
  const snapshot = {
    serviceCatalog: { services: [] },
    runtimeEvents: [{ eventId: 'event:a' }],
  };
  const view = buildRuntimeSnapshotView(snapshot, {
    clientId: 'runtime-shell-test',
    surface: 'shell',
    materializationBudget: {
      kind: 'materialization.budget',
      budgetId: 'materialization:runtime-shell-test:runtime-snapshot',
      state: 'withinBudget',
      payloadClass: 'projection',
      copyRole: 'projection',
      privacyTier: 'safeProjection',
      limits: {
        replayLimit: 1,
        estimatedSnapshotBytes: 512,
      },
      consumerFloor: {
        kind: 'consumer.floor',
        floorId: 'floor:materialization:runtime-shell-test:runtime-snapshot',
        materializationId: 'materialization:runtime-shell-test:runtime-snapshot',
        lagState: 'current',
      },
    },
  });

  assert.equal(view.materialization.state, 'withinBudget');
  assert.equal(view.materialization.budgetId, 'materialization:runtime-shell-test:runtime-snapshot');
  assert.equal(view.materialization.consumerFloorId, 'floor:materialization:runtime-shell-test:runtime-snapshot');
  assert.equal(view.materialization.payloadClass, 'projection');
});

test('runtime service catalog omits missing health posture from service title', () => {
  const snapshot = {
    serviceCatalog: {
      services: [
        {
          service: 'nvr',
          servicePk: 'nvr-pk',
          hostGatewayPk: 'gateway-pk',
          nodes: [{ path: 'streams', label: 'Streams' }],
        },
      ],
    },
  };
  const elements = runtimeElements();

  const view = renderRuntimeSnapshotView(elements, snapshot, fakeDocument());

  assert.equal(view.catalog[0].health, '');
  assert.match(elements.catalogListEl.textContent, /Nvr/);
  assert.doesNotMatch(elements.catalogListEl.textContent, /unknown/);
  assert.doesNotMatch(elements.catalogListEl.textContent, /Nvr -/);
});

test('swarm edge queue reject and repair status renders from snapshot', () => {
  const snapshot = {
    edge: {
      mode: 'fixture',
      connected: false,
      queuedCount: 2,
      sentCount: 1,
      rejections: [
        { error: { code: 'bad_revision', message: 'revision gap' } },
      ],
      repairRequests: [
        { repairRequest: { projectionId: 'logging.events' } },
      ],
    },
    swarmQueue: {
      frameA: { status: 'queued' },
      frameB: {
        status: 'rejected',
        repairRequest: { projectionId: 'logging.events' },
        lastError: { message: 'revision gap' },
      },
    },
    projections: {
      'logging.events': { freshness: { state: 'live' } },
    },
    projectionCoverage: {
      'logging.events': { materializedCount: 42 },
    },
    resource: {
      state: 'withinBudget',
      cleanupAllowed: false,
      cleanupReason: 'retention posture must allow release before sweeping',
    },
    retention: {
      state: 'releaseRequired',
      releaseRequired: true,
      reason: 'retention blockers active',
    },
  };
  const view = buildRuntimeSnapshotView(snapshot);
  const elements = runtimeElements();

  renderRuntimeSnapshotView(elements, snapshot, fakeDocument());

  assert.equal(view.edge.edgeLabel, 'fixture offline');
  assert.equal(elements.edgeStatusEl.textContent, 'fixture offline');
  assert.equal(elements.queueStatusEl.textContent, '2 queued / 1 rejected / 1 repair');
  assert.equal(elements.projectionStatusEl.textContent, '1 retained / 42 records');
  assert.equal(elements.resourceStatusEl.textContent, 'withinBudget / retention posture must allow release before sweeping');
  assert.equal(elements.retentionStatusEl.textContent, 'releaseRequired / retention blockers active');
  assert.equal(
    elements.runtimeStatusDetailEl.textContent,
    'Last reject: revision gap / Resource: retention posture must allow release before sweeping / Retention: retention blockers active',
  );
});

test('swarm edge status prefers carrier edge posture when present', () => {
  const snapshot = {
    edge: {
      mode: 'live',
      connected: false,
      queuedCount: 0,
      sentCount: 3,
      carrierEdge: {
        kind: 'carrier.edge.session.evidence',
        state: 'open',
        connectionState: 'connected',
        backpressureState: 'clear',
        safeFacts: { mode: 'live' },
      },
    },
  };
  const view = buildRuntimeSnapshotView(snapshot);
  const elements = runtimeElements();

  renderRuntimeSnapshotView(elements, snapshot, fakeDocument());

  assert.equal(view.edge.connected, true);
  assert.equal(view.edge.carrierState, 'open');
  assert.equal(view.edge.edgeLabel, 'carrier open');
  assert.equal(elements.edgeStatusEl.textContent, 'carrier open');
});

test('active form input survives background runtime snapshot render', () => {
  const doc = fakeDocument();
  const activeInput = new FakeElement('input');
  activeInput.value = '123456';
  doc.activeElement = activeInput;
  const elements = runtimeElements();

  renderRuntimeSnapshotView(elements, {
    serviceCatalog: { services: [] },
    edge: { mode: 'fixture', connected: true, queuedCount: 0 },
  }, doc);

  assert.equal(doc.activeElement, activeInput);
  assert.equal(activeInput.value, '123456');
});
