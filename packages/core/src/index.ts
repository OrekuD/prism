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

// v1 legacy class — renamed (deprecated) so the public `PrismClient` name
// belongs to the v2 contract; removed in the browser/read-path slice
// (ADR 0002 §2).
export { PrismClient as PrismClientV1 } from "./prism-client";
export * from "./types";
