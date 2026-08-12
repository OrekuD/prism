// v2 contract: the async factory + the public analytics types (ADR 0002 §7).
// The v2 `PrismClient` interface itself is exported by ./contract and is
// reachable through createPrismClient's return type; the package-level
// `PrismClient` name still belongs to the v1 class until the browser/read
// path slice removes the legacy API (the v1 class is what current callers
// construct with `new`).
export { createPrismClient } from "./core";
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
  SessionEndResult,
  SessionStartResult,
} from "./contract";

// v1 legacy API — removed in the browser/read-path slice; callers migrate
// to createPrismClient in the same release (ADR 0002 §2).
export * from "./prism-client";
export * from "./types";
