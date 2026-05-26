import {
  SURFACE_APP,
  SWARM,
  assertSurfaceAppManifest,
  assertSurfaceAppContract,
} from "constitute-protocol";
import {
  defineSurfaceAppContract,
} from "constitute-ui/surface-app-contract";
import { surfaceAppSelectionReadModel } from "constitute-ui/surface-selection-read-model";
import { createRuntimeSurfaceClient } from "constitute-ui/runtime-surface-client";
import { createRuntimeRunnerBridge } from "constitute-ui/runtime-runner-bridge";
import {
  createSurfaceModuleRegistry,
} from "constitute-ui/surface-module-registry";
import {
  browserStorageShellContext,
  deriveRuntimeShellState,
  runtimeShellConnectionToneClass,
} from "./runtime-shell-state.js";

const ISSUED_AT = 1700000000;

export const accountSurfaceAppContract = assertSurfaceAppContract({
  contractId: "surface-app:constitute-account",
  schemaVersion: SURFACE_APP.SCHEMA_VERSION,
  appId: "constitute-account",
  appRef: "app:account-ui",
  version: "0.1.0",
  displayName: "Account",
  surfaceRef: "surface:account-ui",
  requiredPrimitives: [
    "runtime.attach",
    "runtime.shell.posture",
    "projection.materialization",
  ],
  requiredModuleRoles: [
    SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
    SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
    SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
    SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
    SURFACE_APP.MODULE_ROLE.PRODUCT_VIEW,
  ],
  modules: [
    {
      moduleRef: "constitute-ui/runtime-surface-client@0.1.0",
      role: SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
      participantSide: SURFACE_APP.PARTICIPANT_SIDE.WINDOW,
      fulfillmentMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      version: "0.1.0",
      primitiveRefs: ["runtime.attach", "runtime.intent"],
      inputs: ["runtime.snapshot"],
      outputs: ["runtime.intent", "runtime.evidence"],
      materializationBudgetRefs: ["account-ui.runtime-snapshot"],
      issuedAt: ISSUED_AT,
    },
    {
      moduleRef: "constitute-account/runtime-ui-model@0.1.0",
      role: SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
      participantSide: SURFACE_APP.PARTICIPANT_SIDE.WINDOW,
      fulfillmentMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      version: "0.1.0",
      primitiveRefs: ["runtime.shell.posture", "projection.materialization"],
      inputs: ["runtime.snapshot"],
      outputs: ["account.read-model"],
      materializationBudgetRefs: ["account-ui.runtime-snapshot", "account-ui.account-read-model"],
      issuedAt: ISSUED_AT,
    },
    {
      moduleRef: "constitute-account/browser-storage-shell@0.1.0",
      role: SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
      participantSide: SURFACE_APP.PARTICIPANT_SIDE.WINDOW,
      fulfillmentMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      version: "0.1.0",
      primitiveRefs: ["runtime.shell.context"],
      inputs: ["browser.storage"],
      outputs: ["shell.context.evidence"],
      issuedAt: ISSUED_AT,
    },
    {
      moduleRef: "constitute-ui/runtime-runner-bridge@0.1.0",
      role: SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
      participantSide: SURFACE_APP.PARTICIPANT_SIDE.WINDOW,
      fulfillmentMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      version: "0.1.0",
      primitiveRefs: [
        "runtime.runner.dispatch",
        "runner.runtime-dispatch.bridge",
        "runtime.runner.host.fulfillment.put",
      ],
      inputs: ["runtime.runner.dispatch"],
      outputs: ["runtime.runner.host.fulfillment.put"],
      materializationBudgetRefs: ["account-ui.runtime-snapshot"],
      issuedAt: ISSUED_AT,
    },
    {
      moduleRef: "constitute-account/account-view@0.1.0",
      role: SURFACE_APP.MODULE_ROLE.PRODUCT_VIEW,
      participantSide: SURFACE_APP.PARTICIPANT_SIDE.WINDOW,
      fulfillmentMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      version: "0.1.0",
      primitiveRefs: ["runtime.posture.render"],
      inputs: ["account.read-model", "runtime.shell.posture"],
      outputs: ["user.intent"],
      materializationBudgetRefs: ["account-ui.account-read-model"],
      issuedAt: ISSUED_AT,
    },
  ],
  projectionSubscriptions: [
    { projectionId: "runtime.shell", channelId: "runtime.shell" },
    { projectionId: "swarm.directory", channelId: "swarm.directory" },
  ],
  materializationBudgets: [
    {
      kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
      budgetId: "account-ui.runtime-snapshot",
      sourceAuthority: "runtime.snapshot",
      consumerRef: "account-ui.runtime-model",
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.REFERENCE_ONLY,
      transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.REFERENCE_ONLY,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.SAFE_PROJECTION,
      state: SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET,
      limits: { maxProjectionCount: 2, maxRuntimeEvents: 64 },
      snapshotPolicy: { mode: "runtime-owned-baseline" },
      deltaPolicy: { mode: "snapshot-summary" },
      coalescing: { key: "runtimeSessionId" },
      cardinality: { maxRuntimeSessionIds: 1 },
      schema: { state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT, version: "account-ui.runtime-snapshot.v1" },
      referenceRefs: ["runtime.snapshot"],
      retentionClass: "ephemeral.ui-projection",
      issuedAt: ISSUED_AT,
    },
    {
      kind: SWARM.RECORD_KIND.MATERIALIZATION_BUDGET,
      budgetId: "account-ui.account-read-model",
      sourceAuthority: "runtime.shell.posture",
      consumerRef: "account-ui.product-view",
      payloadClass: SWARM.MATERIALIZATION_PAYLOAD_CLASS.PROJECTION,
      copyRole: SWARM.MATERIALIZATION_COPY_ROLE.PROJECTION,
      transferMode: SWARM.MATERIALIZATION_TRANSFER_MODE.CLONE,
      privacyTier: SWARM.MATERIALIZATION_PRIVACY_TIER.UI_PROJECTION,
      state: SWARM.RESOURCE_POSTURE_STATE.WITHIN_BUDGET,
      limits: { maxItems: 32, maxRenderedRows: 32 },
      snapshotPolicy: { mode: "derived-shell-posture" },
      deltaPolicy: { mode: "coalesced-by-runlevel" },
      coalescing: { key: "identityId" },
      cardinality: { maxIdentityRefs: 1, maxServiceRefs: 16 },
      schema: { state: SWARM.MATERIALIZATION_SCHEMA_STATE.CURRENT, version: "account-ui.read-model.v1" },
      referenceRefs: ["account.read-model"],
      retentionClass: "ephemeral.ui-projection",
      issuedAt: ISSUED_AT,
    },
  ],
  updatePosture: {
    state: SURFACE_APP.UPDATE_POSTURE.STATIC,
    checkedAt: ISSUED_AT,
  },
  serviceManagerPosture: {
    managerId: "manager:manual:account-ui",
    subjectRef: "app:account-ui",
    managerRef: "manager:manual:account-ui",
    state: SURFACE_APP.SERVICE_MANAGER_POSTURE.MANUAL,
    serviceRefs: ["app:account-ui"],
    capabilityRefs: ["service.manage"],
    evidenceRefs: ["build:account-ui:local"],
    issuedAt: ISSUED_AT,
  },
  secretBoundary: {
    state: SURFACE_APP.SECRET_BOUNDARY.NOT_REQUIRED,
  },
  releasePosture: {
    state: SURFACE_APP.RELEASE_POSTURE.STATIC,
    releaseRef: "release:account-ui:local",
    evidenceRefs: ["build:account-ui:local"],
  },
  issuedAt: ISSUED_AT,
});

export const accountSurfaceApp = defineSurfaceAppContract(accountSurfaceAppContract, {
  validate: assertSurfaceAppContract,
});

export const accountSurfaceAppManifest = assertSurfaceAppManifest({
  kind: "surface.app.manifest",
  manifestId: "manifest:account-ui",
  appId: "constitute-account",
  state: SURFACE_APP.MANIFEST_VERSION_STATE.CURRENT,
  currentAppContractRef: "app:account-ui",
  currentVersion: "0.1.0",
  defaultSourceMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
  requiredModuleRoles: [
    SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
    SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
    SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
    SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
    SURFACE_APP.MODULE_ROLE.PRODUCT_VIEW,
  ],
  bundledSourceRefs: ["bundle:account-ui@0.1.0"],
  compatibilityWindow: {
    minVersion: "0.1.0",
    maxVersion: "0.1.x",
    protocolRef: "protocol:surface-app:v1",
  },
  versions: [
    {
      appContractRef: "app:account-ui",
      version: "0.1.0",
      state: SURFACE_APP.MANIFEST_VERSION_STATE.CURRENT,
      sourceMode: SURFACE_APP.FULFILLMENT_MODE.BUNDLED,
      requiredModuleRoles: [
        SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
        SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
        SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
        SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
        SURFACE_APP.MODULE_ROLE.PRODUCT_VIEW,
      ],
      compatibilityWindow: {
        minVersion: "0.1.0",
        maxVersion: "0.1.x",
        protocolRef: "protocol:surface-app:v1",
      },
      bundledSourceRefs: ["bundle:account-ui@0.1.0"],
      grantRefs: ["grant:app:account-ui:run"],
      runnerRequirementRefs: ["runner:req:account-ui"],
      serviceManagerRequirementRefs: ["service-manager:req:account-ui"],
      compatibilityRefs: ["protocol:surface-app:v1"],
      bootstrapContractRef: "bootstrap-contract:app:account-ui",
      releaseContractRef: "release:account-ui:local",
      issuedAt: ISSUED_AT,
    },
  ],
  appContractRefs: ["app:account-ui"],
  grantRefs: ["grant:app:account-ui:run"],
  runnerRequirementRefs: ["runner:req:account-ui"],
  serviceManagerRequirementRefs: ["service-manager:req:account-ui"],
  compatibilityRefs: ["protocol:surface-app:v1"],
  bootstrapContractRefs: ["bootstrap-contract:app:account-ui"],
  releaseContractRefs: ["release:account-ui:local"],
  authorityRefs: ["authority:account-ui:local"],
  evidenceRefs: ["build:account-ui:local"],
  issuedAt: ISSUED_AT,
});

export const accountSurfaceModuleRegistry = createSurfaceModuleRegistry([
  {
    moduleRef: "constitute-ui/runtime-surface-client@0.1.0",
    role: SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
    version: "0.1.0",
    primitiveRefs: ["runtime.attach", "runtime.intent"],
    implementation: Object.freeze({ createRuntimeSurfaceClient }),
  },
  {
    moduleRef: "constitute-account/runtime-ui-model@0.1.0",
    role: SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
    version: "0.1.0",
    primitiveRefs: ["runtime.shell.posture", "projection.materialization"],
    implementation: Object.freeze({
      deriveRuntimeShellState,
      runtimeShellConnectionToneClass,
    }),
  },
  {
    moduleRef: "constitute-account/browser-storage-shell@0.1.0",
    role: SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
    version: "0.1.0",
    primitiveRefs: ["runtime.shell.context"],
    implementation: Object.freeze({ browserStorageShellContext }),
  },
  {
    moduleRef: "constitute-ui/runtime-runner-bridge@0.1.0",
    role: SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
    version: "0.1.0",
    primitiveRefs: [
      "runtime.runner.dispatch",
      "runner.runtime-dispatch.bridge",
      "runtime.runner.host.fulfillment.put",
    ],
    implementation: Object.freeze({ createRuntimeRunnerBridge }),
  },
  {
    moduleRef: "constitute-account/account-view@0.1.0",
    role: SURFACE_APP.MODULE_ROLE.PRODUCT_VIEW,
    version: "0.1.0",
    primitiveRefs: ["runtime.posture.render"],
    implementation: Object.freeze({ surfaceRef: "constitute-account" }),
  },
]);

export const accountSurfaceSelectionReadModel = surfaceAppSelectionReadModel({
  surfaceApp: accountSurfaceApp,
  manifest: accountSurfaceAppManifest,
  moduleRegistry: accountSurfaceModuleRegistry,
  moduleBindingMode: "implementations",
  productSurface: "constitute-account",
  runtimeVersion: "0.1.0",
  issuedAt: ISSUED_AT,
  serviceManagerOperationOptions: {
    operation: SURFACE_APP.SERVICE_MANAGER_OPERATION.HEALTH_CHECK,
    operationId: "operation:account-ui:bootstrap-health",
    requestedAt: ISSUED_AT,
  },
  serviceManagerProofDigestOptions: {
    digestId: "proof-digest:account-ui:bootstrap",
    observedAt: ISSUED_AT,
  },
});

export const accountSurfaceRuntimeSelectionPosture = accountSurfaceSelectionReadModel.runtimeSelectionPosture;
export const accountSurfaceModules = accountSurfaceSelectionReadModel.moduleBindings;
export const accountSurfaceRunnerPlan = accountSurfaceSelectionReadModel.runnerPlan;
export const accountServiceManagerSecretBoundary = accountSurfaceSelectionReadModel.serviceManagerSecretBoundary;
export const accountSurfaceBootstrapContract = accountSurfaceSelectionReadModel.bootstrapContract;
export const accountSurfaceBootstrapPosture = accountSurfaceSelectionReadModel.bootstrapPosture;
export const accountServiceManagerOperationPosture = accountSurfaceSelectionReadModel.serviceManagerOperationPosture;
export const accountServiceManagerProofDigest = accountSurfaceSelectionReadModel.serviceManagerProofDigest;
export const accountSurfaceAppInstancePosture = accountSurfaceSelectionReadModel.appInstancePosture;

export const accountRuntimeClientModule = accountSurfaceModuleRegistry.require(
  accountSurfaceRuntimeSelectionPosture,
  SURFACE_APP.MODULE_ROLE.RUNTIME_CLIENT,
).implementation;

export const accountProjectionModelModule = accountSurfaceModuleRegistry.require(
  accountSurfaceRuntimeSelectionPosture,
  SURFACE_APP.MODULE_ROLE.PROJECTION_MODEL,
).implementation;

export const accountPlatformAdapterModule = accountSurfaceModuleRegistry.require(
  accountSurfaceRuntimeSelectionPosture,
  SURFACE_APP.MODULE_ROLE.PLATFORM_ADAPTER,
).implementation;

export const accountRuntimeRunnerBridgeModule = accountSurfaceModuleRegistry.require(
  accountSurfaceRuntimeSelectionPosture,
  SURFACE_APP.MODULE_ROLE.RUNTIME_RUNNER_BRIDGE,
).implementation;

export const accountSurfaceAttachContext = accountSurfaceSelectionReadModel.attachContext;
