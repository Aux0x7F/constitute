export declare const PLATFORM_RUNTIME_VERSION: Readonly<{ major: number; minor: number }>;
export declare const PLATFORM_RUNTIME_BUILD_ID: string;
export declare const PLATFORM_RUNTIME_WORKER_PATH: string;
export declare const RUNTIME_STREAM_PREPARE: "runtime.stream.prepare";
export declare const RUNTIME_STREAM_OPEN: "runtime.stream.open";
export declare const RUNTIME_STREAM_CONTROL: "runtime.stream.control";
export declare const RUNTIME_STREAM_CLOSE: "runtime.stream.close";
export declare const RUNTIME_STREAM_RECOVERY_REQUEST: "runtime.stream.recovery.request";
export declare const RUNTIME_AUTHORITY_POSTURE_GET: "runtime.authority.posture.get";
export declare const RUNTIME_MEDIA_TRANSPORT_PROFILE_GET: "runtime.media.transport.profile.get";
export declare const RUNTIME_MEDIA_TRANSPORT_OBSERVATION_PUT: "runtime.media.transport.observation.put";
export declare const RUNTIME_MEDIA_FULFILLMENT_EVIDENCE_PUT: "runtime.media.fulfillment.evidence.put";
export declare const RUNTIME_RUNNER_OPERATION_SUBMIT: "runtime.runner.operation.submit";
export declare const RUNTIME_RUNNER_HOST_FULFILLMENT_PUT: "runtime.runner.host.fulfillment.put";
export declare const RUNTIME_RUNNER_BRIDGE_POSTURE_PUT: "runtime.runner.bridge.posture.put";
export declare const RUNTIME_FULFILLMENT_SESSION_PROJECTION_PUT: "runtime.fulfillment-session.projection.put";
export declare const RUNTIME_FULFILLMENT_SESSION_PROJECTION_GET: "runtime.fulfillment-session.projection.get";

export declare function runtimeWorkerScriptUrl(origin?: string): string;
export declare function runtimeSharedWorkerName(): string;
export declare function runtimeAttachDebugInfo(origin?: string): Readonly<{
  buildId: string;
  workerName: string;
  workerUrl: string;
}>;

export declare function runtimeAuthorityPayloadFromContext(context?: Record<string, unknown>): {
  identityId: string;
  gatewayPk: string;
  servicePk: string;
  service: string;
  serviceRef: string;
};
