export const PLATFORM_RUNTIME_VERSION = Object.freeze({ major: 2, minor: 61 });
export const PLATFORM_RUNTIME_BUILD_ID = `runtime-${PLATFORM_RUNTIME_VERSION.major}.${PLATFORM_RUNTIME_VERSION.minor}`;
export const PLATFORM_RUNTIME_WORKER_PATH = "/constitute-account/runtime.worker.js";
export const RUNTIME_STREAM_PREPARE = "runtime.stream.prepare";
export const RUNTIME_STREAM_OPEN = "runtime.stream.open";
export const RUNTIME_STREAM_CONTROL = "runtime.stream.control";
export const RUNTIME_STREAM_CLOSE = "runtime.stream.close";
export const RUNTIME_STREAM_RECOVERY_REQUEST = "runtime.stream.recovery.request";
export const RUNTIME_AUTHORITY_POSTURE_GET = "runtime.authority.posture.get";
export const RUNTIME_MEDIA_TRANSPORT_PROFILE_GET = "runtime.media.transport.profile.get";
export const RUNTIME_MEDIA_TRANSPORT_OBSERVATION_PUT = "runtime.media.transport.observation.put";
export const RUNTIME_MEDIA_FULFILLMENT_EVIDENCE_PUT = "runtime.media.fulfillment.evidence.put";
export const RUNTIME_RUNNER_OPERATION_SUBMIT = "runtime.runner.operation.submit";
export const RUNTIME_RUNNER_HOST_FULFILLMENT_PUT = "runtime.runner.host.fulfillment.put";
export const RUNTIME_RUNNER_BRIDGE_POSTURE_PUT = "runtime.runner.bridge.posture.put";
export const RUNTIME_FULFILLMENT_SESSION_PROJECTION_PUT = "runtime.fulfillment-session.projection.put";
export const RUNTIME_FULFILLMENT_SESSION_PROJECTION_GET = "runtime.fulfillment-session.projection.get";

function runtimeOrigin(origin = "") {
  const explicit = String(origin || "").trim();
  if (explicit) return explicit;
  if (typeof globalThis !== "undefined" && globalThis.location?.origin) {
    return globalThis.location.origin;
  }
  return "http://localhost";
}

export function runtimeWorkerScriptUrl(origin = "") {
  const target = new URL(PLATFORM_RUNTIME_WORKER_PATH, runtimeOrigin(origin));
  target.searchParams.set("v", PLATFORM_RUNTIME_BUILD_ID);
  return target.toString();
}

export function runtimeSharedWorkerName() {
  return `constitute-account-runtime-${PLATFORM_RUNTIME_BUILD_ID}`;
}

export function runtimeAttachDebugInfo(origin = "") {
  return Object.freeze({
    buildId: PLATFORM_RUNTIME_BUILD_ID,
    workerName: runtimeSharedWorkerName(),
    workerUrl: runtimeWorkerScriptUrl(origin),
  });
}

export function runtimeAuthorityPayloadFromContext(context = {}) {
  if (!context || typeof context !== "object") return {};
  const service = String(context.service || "nvr").trim() || "nvr";
  const servicePk = String(context.servicePk || context.devicePk || context.pk || "").trim();
  const serviceRef = String(context.serviceRef || context.memberRef || "").trim()
    || (servicePk ? `service:${service}:${servicePk}` : "");
  return {
    identityId: String(context.identityId || "").trim(),
    gatewayPk: String(context.gatewayPk || context.hostGatewayPk || "").trim(),
    servicePk,
    service,
    serviceRef,
  };
}
