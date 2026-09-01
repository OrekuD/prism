// v2 contract: the async factory + the public analytics types (ADR 0002 §7).
// The package-level `PrismClient` name is the v2 interface — `import type
// { PrismClient } from "@prism-analytics/core"` resolves to the frozen contract.
export { createPrismClient } from "./core";
// Error reporting (task-15 slice 3) — a SEPARATE lane from analytics.
export { createPrismErrorReporter } from "./error-reporter";
export { ERROR_LIMITS } from "./error-limits";
export { errorToException, framesFromStack } from "./error-frames";
export type {
	ErrorBeforeSend,
	ErrorBreadcrumb,
	ErrorCaptureResult,
	ErrorDropReason,
	ErrorFrame,
	ErrorLevel,
	ErrorReport,
	ErrorReportInput,
	ErrorReporterOptions,
	ErrorReporterShare,
	PrismErrorReporter,
	WireErrorBatch,
	WireErrorItem,
} from "./error-contract";
export {
	INGEST_LIMITS,
	SDK_NAME,
	SDK_VERSION,
	WIRE_SCHEMA_VERSION,
} from "./limits";
// Task 17: reserved page-view contract — ONE shared definition for Core,
// Browser, React, and ingestion validation.
export {
	PAGE_VIEW_EVENT_NAME,
	PAGE_VIEW_LIMITS,
	RESERVED_EVENT_PREFIX,
	VIEWPORT_WIDTH_BUCKETS,
	isReservedAnalyticsEventName,
	isValidCanonicalPath,
	isValidPageHost,
	validatePageViewProperties,
	viewportWidthBucket,
} from "./page-view";
export type {
	BrowserPageViewOptions,
	ManualPageViewInput,
	UsePrismPageViewOptions,
	PageViewCandidate,
	PageViewNavigation,
	PageViewValidationResult,
	PageViewWireProperties,
	ViewportWidthBucket,
} from "./page-view";
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
	assertSourceKey,
	assertValidEventName,
	isValidEventName,
	validateJsonValue,
} from "./validation";
export type {
	JsonValidationReason,
	JsonValidationResult,
	SanitizeOptions,
} from "./validation";
export type {
	AnonymousPersistence,
	CaptureResult,
	CollectionState,
	DropReason,
	GlobalPropertyResult,
	GlobalPropertyScope,
	IdentifyResult,
	PrismIdentityState,
	ResetResult,
	WireIdentifyOp,
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
export { INTERNAL_SEAM } from "./internal-seam";
export type {
	InternalClientSeam,
	ReservedEventResult,
} from "./internal-seam";

// Task 18: reserved mobile screen-view + app-lifecycle contracts
export {
  APP_LIFECYCLE_EVENT_NAME,
  SCREEN_VIEW_EVENT_NAME,
  validateAppLifecycleProperties,
  validateScreenViewProperties,
} from "./screen-view";
export {
  STANDARD_EVENT_BY_KEY,
  STANDARD_EVENT_BY_PROTECTED_NAME,
  STANDARD_EVENT_BY_SDK_METHOD,
  STANDARD_EVENT_DEFINITIONS,
  STANDARD_EVENT_LIMITS,
  categoryForKey,
  displayNameForKey,
  protectedNameForKey,
  requiresUserForKey,
  validateStandardEventData,
  validateStandardEventProperties,
} from "./standard-events";
export type {
  FeedbackSubmittedProperties,
  InviteAcceptedProperties,
  InviteSentProperties,
  LeadGeneratedProperties,
  LoginProperties,
  LogoutProperties,
  OnboardingCompletedProperties,
  OnboardingStartedProperties,
  OnboardingStepCompletedProperties,
  PaymentFailedProperties,
  PaymentSucceededProperties,
  PrismStandardEvents,
  PurchaseProperties,
  RefundProperties,
  SearchProperties,
  ShareProperties,
  SignUpProperties,
  StandardEventActor,
  StandardEventCategory,
  StandardEventDefinition,
  StandardEventKey,
  StandardEventValidationResult,
  StandardEventWireProperties,
  SubscriptionCancelledProperties,
  SubscriptionChangedProperties,
  SubscriptionExpiredProperties,
  SubscriptionPausedProperties,
  SubscriptionRenewedProperties,
  SubscriptionResumedProperties,
  SubscriptionStartedProperties,
  TrialEndedProperties,
  TrialStartedProperties,
} from "./standard-events";
export type {
  AppLifecycleTransition,
  AppLifecycleValidationResult,
  AppLifecycleWireProperties,
  ScreenNavigation,
  ScreenViewCandidate,
  ScreenViewValidationResult,
  ScreenViewWireProperties,
} from "./screen-view";
export { MOBILE_LIMITS, MOBILE_SESSION_TIMEOUT_MS } from "./mobile-limits";
export { isValidInstallationDigest, isValidInstallationId } from "./installation";
export type { MobileContext, MobileKind, MobileOs, MobilePlatform } from "./mobile-context";
export { isValidMobileContext } from "./mobile-context";

