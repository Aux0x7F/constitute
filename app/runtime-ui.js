import {
  deriveRuntimeMaterializationPosture,
  preparedServiceRegistry,
} from 'constitute-ui';

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || '').trim();
}

function titleCaseWords(value) {
  return text(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortId(value, head = 10, tail = 4) {
  const raw = text(value);
  if (!raw) return '';
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}...${raw.slice(-tail)}`;
}

function serviceDisplayName(service) {
  const display = service?.surface?.display && typeof service.surface.display === 'object'
    ? service.surface.display
    : {};
  const alias = normalizeArray(service?.aliases).find((entry) => text(entry));
  return text(display.name || service.displayName || service.label || alias || titleCaseWords(service?.service) || 'Service');
}

function serviceHealthLabel(service) {
  const health = service?.health && typeof service.health === 'object' ? service.health : {};
  const status = text(health.status || health.state || service.status);
  if (status) return status;
  if (text(service?.summary)) return 'ready';
  if (text(service?.surfaceChannel)) return 'surface';
  return '';
}

function serviceHostFabricPosture(service) {
  const source = service?.hostFabric && typeof service.hostFabric === 'object' ? service.hostFabric : null;
  if (!source) return null;
  const state = text(source.state || source.fulfillmentPlan?.state || source.lifecyclePlan?.state);
  const blockedReasons = normalizeArray(source.blockedReasons).map(text).filter(Boolean);
  return {
    state,
    blockedReasons,
    label: [
      state ? `fabric ${state}` : '',
      blockedReasons.length ? `blocked ${blockedReasons.slice(0, 2).join(', ')}` : '',
      text(source.associationHandoffRef) ? `handoff ${shortId(source.associationHandoffRef)}` : '',
    ].filter(Boolean).join(' / '),
  };
}

export function preparedRuntimeServiceCatalog(snapshot = {}) {
  const registry = preparedServiceRegistry(snapshot);
  return normalizeArray(registry.services)
    .filter((service) => service && typeof service === 'object')
    .map((service) => {
      const nodes = normalizeArray(service.nodes)
        .map((node) => ({
          path: text(node?.path || node?.nodePath || node?.nodeId),
          label: text(node?.label || node?.path || node?.nodePath || node?.nodeId),
          capabilities: normalizeArray(node?.capabilities).map(text).filter(Boolean),
        }))
        .filter((node) => node.path || node.label);
      const servicePk = text(service.servicePk || service.service_pk);
      const hostGatewayPk = text(service.hostGatewayPk || service.host_gateway_pk);
      const hostFabric = serviceHostFabricPosture(service);
      return {
        service: text(service.service).toLowerCase(),
        servicePk,
        hostGatewayPk,
        title: serviceDisplayName(service),
        health: serviceHealthLabel(service),
        summary: text(service.summary || service.surface?.summary),
        surfaceChannel: text(service.surfaceChannel || service.surface_channel),
        location: text(service.location),
        hostFabric,
        nodes,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function preparedSwarmEdgeStatus(snapshot = {}) {
  const edge = snapshot?.edge && typeof snapshot.edge === 'object' ? snapshot.edge : {};
  const swarmQueue = snapshot?.swarmQueue && typeof snapshot.swarmQueue === 'object' ? snapshot.swarmQueue : {};
  const queueEntries = Object.values(swarmQueue).filter((entry) => entry && typeof entry === 'object');
  const queuedCount = Number(edge.queuedCount ?? queueEntries.length) || 0;
  const sentCount = Number(edge.sentCount || 0) || 0;
  const rejections = normalizeArray(edge.rejections);
  const rejectedQueueCount = queueEntries.filter((entry) => text(entry.status).toLowerCase() === 'rejected').length;
  const rejectedCount = Math.max(rejections.length, rejectedQueueCount);
  const repairRequests = normalizeArray(edge.repairRequests);
  const repairQueueCount = queueEntries.filter((entry) => entry.repairRequest && typeof entry.repairRequest === 'object').length;
  const repairCount = Math.max(repairRequests.length, repairQueueCount);
  const connected = edge.connected === true;
  const mode = text(edge.mode) || 'local';
  const lastReject = rejections[rejections.length - 1] || queueEntries.find((entry) => entry.lastError)?.lastError || null;
  const rejectMessage = text(lastReject?.error?.message || lastReject?.message || lastReject?.code);

  return {
    mode,
    connected,
    queuedCount,
    sentCount,
    rejectedCount,
    repairCount,
    edgeLabel: connected ? `${mode} connected` : `${mode} offline`,
    queueLabel: [
      `${queuedCount} queued`,
      rejectedCount ? `${rejectedCount} rejected` : '',
      repairCount ? `${repairCount} repair` : '',
    ].filter(Boolean).join(' / '),
    rejectMessage,
  };
}

export function preparedRuntimeProjectionStatus(snapshot = {}) {
  const projections = snapshot?.projections && typeof snapshot.projections === 'object' ? snapshot.projections : {};
  const coverage = snapshot?.projectionCoverage && typeof snapshot.projectionCoverage === 'object' ? snapshot.projectionCoverage : {};
  const projectionCount = Object.keys(projections).length;
  const coverageValues = Object.values(coverage).filter((entry) => entry && typeof entry === 'object');
  const materializedCount = coverageValues.reduce((sum, entry) => sum + (Number(entry.materializedCount || 0) || 0), 0);
  const errorCount = Object.values(projections).filter((entry) => {
    const state = text(entry?.freshness?.state || entry?.status).toLowerCase();
    return state === 'error' || state === 'rejected';
  }).length;
  return {
    projectionCount,
    materializedCount,
    errorCount,
    label: [
      `${projectionCount} retained`,
      materializedCount ? `${materializedCount} records` : '',
      errorCount ? `${errorCount} needs repair` : '',
    ].filter(Boolean).join(' / ') || 'none',
  };
}

function preparedPostureStatus(posture = {}, fallbackState = 'unknown') {
  const state = text(posture?.state || fallbackState) || fallbackState;
  const reason = text(posture?.cleanupReason || posture?.reason || posture?.blockedReason);
  return {
    state,
    label: reason ? `${state} / ${reason}` : state,
    reason,
    cleanupAllowed: posture?.cleanupAllowed === true,
    releaseRequired: posture?.releaseRequired === true,
  };
}

export function buildRuntimeSnapshotView(snapshot = {}, options = {}) {
  const serviceRegistry = preparedServiceRegistry(snapshot);
  const materialization = deriveRuntimeMaterializationPosture(snapshot, options);
  const catalog = preparedRuntimeServiceCatalog(snapshot);
  const edge = preparedSwarmEdgeStatus(snapshot);
  const projections = preparedRuntimeProjectionStatus(snapshot);
  const resource = preparedPostureStatus(snapshot?.resource, 'unknown');
  const retention = preparedPostureStatus(snapshot?.retention, 'unknown');
  return {
    catalog,
    catalogLabel: catalog.length === 1 ? '1 service' : `${catalog.length} services`,
    serviceRegistry,
    edge,
    projections,
    materialization,
    resource,
    retention,
  };
}

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  el.textContent = '';
}

function appendTextLine(documentRef, parent, className, value) {
  if (!parent) return null;
  const el = documentRef.createElement('div');
  el.className = className;
  el.textContent = value;
  parent.appendChild(el);
  return el;
}

export function renderRuntimeSnapshotView(elements, snapshot = {}, documentRef = globalThis.document, options = {}) {
  const view = buildRuntimeSnapshotView(snapshot, options);
  if (!elements || !documentRef) return view;

  if (elements.catalogStatusEl) elements.catalogStatusEl.textContent = view.catalogLabel;
  clearElement(elements.catalogListEl);
  if (elements.catalogListEl) {
    if (view.catalog.length === 0) {
      appendTextLine(documentRef, elements.catalogListEl, 'itemMeta', 'No runtime services retained.');
    } else {
      for (const service of view.catalog) {
        const item = documentRef.createElement('div');
        item.className = 'item';
        appendTextLine(documentRef, item, 'itemTitle', [service.title, service.health].filter(Boolean).join(' - '));
        const idLine = [
          service.service,
          service.servicePk ? `pk ${shortId(service.servicePk)}` : '',
          service.hostGatewayPk ? `gateway ${shortId(service.hostGatewayPk)}` : '',
        ].filter(Boolean).join(' / ');
        if (idLine) appendTextLine(documentRef, item, 'itemMeta', idLine);
        if (service.hostFabric?.label) appendTextLine(documentRef, item, 'itemMeta', service.hostFabric.label);
        if (service.summary) appendTextLine(documentRef, item, 'itemMeta', service.summary);
        if (service.nodes.length > 0) {
          appendTextLine(documentRef, item, 'itemMeta', `Nodes: ${service.nodes.map((node) => node.label || node.path).join(', ')}`);
        }
        elements.catalogListEl.appendChild(item);
      }
    }
  }

  if (elements.edgeStatusEl) elements.edgeStatusEl.textContent = view.edge.edgeLabel;
  if (elements.queueStatusEl) elements.queueStatusEl.textContent = view.edge.queueLabel;
  if (elements.projectionStatusEl) elements.projectionStatusEl.textContent = view.projections.label;
  if (elements.resourceStatusEl) elements.resourceStatusEl.textContent = view.resource.label;
  if (elements.retentionStatusEl) elements.retentionStatusEl.textContent = view.retention.label;
  if (elements.runtimeStatusDetailEl) {
    const detail = [
      view.edge.rejectMessage ? `Last reject: ${view.edge.rejectMessage}` : '',
      view.resource.reason ? `Resource: ${view.resource.reason}` : '',
      view.retention.reason ? `Retention: ${view.retention.reason}` : '',
    ].filter(Boolean).join(' / ');
    elements.runtimeStatusDetailEl.textContent = detail || 'Runtime snapshot updates automatically.';
  }
  return view;
}
