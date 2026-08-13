// v2 contract: the async factory + the public analytics types (ADR 0002 §7).
// The package-level `PrismClient` name is the v2 interface — `import type
// { PrismClient } from "@prism/core"` resolves to the frozen contract.
export { createPrismClient } from "./core";
export { INGEST_LIMITS, SDK_NAME, SDK_VERSION, WIRE_SCHEMA_VERSION } from "./limits";
export type {
  IngestResponseBody,
  IngestResult,
  IngestStatus,
  WireBatch,
  WireContext,
  WireEnvelope,
} from "./limits";
export { REDACTED, sanitizeProperties } from "./validation";
export {
  assertEndpoint,
  assertProjectKey,
  assertValidEventName,
  isValidEventName,
  validateJsonValue,
} from "./validation";
export type { JsonValidationReason, JsonValidationResult, SanitizeOptions } from "./validation";
export type {
  AnonymousPersistence,
  CaptureResult,
  CollectionState,
  DropReason,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  PrismDiagnostic,
  PrismDiagnosticHandle,
  PrismLifecycle,
  PrismLifecycleEvent,
  PrismQueueOptions,
  PrismRequest,
  PrismResponse,
  PrismRuntimeAdapter,
  PrismRuntimeContext,
  PrismSessionHandle,
  PrismSignal,
  PrismStorage,
  PrismTransport,
  PrismClient,
  SessionEndResult,
  SessionStartResult,
} from "./contract";

// The v1 legacy client was removed in the read-path slice (task-9 slice 6,
// ADR 0002 §2) — the package exposes ONLY the v2 contract.
