/**
 * Standard Events contract — Task 19 slice 1.
 *
 * Frozen catalog of 25 developer-invoked Standard Events. Each helper owns
 * one protected `$prism_*` name and one exact wire schema. This module is
 * the ONE shared definition for Core (capture), Browser/React/React Native
 * (inheritance), analytics ingestion (validation), and product API/web
 * (display metadata).
 *
 * Wire shape (version 1 for the entire first catalog):
 *   {
 *     $standard: {
 *       schemaVersion: 1,
 *       key: StandardEventKey,
 *       data: TData
 *     }
 *   }
 * The protected name and key must agree: `$prism_sign_up <-> sign_up`.
 * Only `$standard` exists at the top level; only `schemaVersion/key/data`
 * exist inside it. Each event owns an exact `data` schema (no unknown
 * keys, no undefined, no non-finite numbers, no provider payloads).
 */

export const STANDARD_EVENT_LIMITS = {
  stableTokenMaxLength: 64,
  opaqueIdMaxLength: 128,
  planIdMaxLength: 64,
  reasonCodeMaxLength: 64,
  currencyLength: 3,
  maxTrialDurationDays: 3660,
  maxRating: 5,
  minRating: 1,
  schemaVersion: 1,
} as const;

// ---------------------------------------------------------------------------
// Stable vocabulary
// ---------------------------------------------------------------------------

/** 1-64 chars; lowercase ASCII letter first; then lowercase letters, digits, `.`, `_`, `-` */
const STABLE_TOKEN_RE = /^[a-z][a-z0-9._-]{0,63}$/;
/** 1-128 ASCII chars matching `[A-Za-z0-9][A-Za-z0-9._:-]*` */
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Exactly 3 uppercase ASCII letters */
const CURRENCY_RE = /^[A-Z]{3}$/;

function isStableToken(value: unknown): value is string {
  return typeof value === "string" && STABLE_TOKEN_RE.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_RE.test(value);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_RE.test(value);
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isPositiveSafeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StandardEventKey =
  | "sign_up"
  | "login"
  | "logout"
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "lead_generated"
  | "invite_sent"
  | "invite_accepted"
  | "trial_started"
  | "trial_ended"
  | "subscription_started"
  | "subscription_renewed"
  | "subscription_changed"
  | "subscription_paused"
  | "subscription_resumed"
  | "subscription_cancelled"
  | "subscription_expired"
  | "payment_succeeded"
  | "payment_failed"
  | "purchase"
  | "refund"
  | "search"
  | "share"
  | "feedback_submitted";

export type StandardEventCategory =
  | "Identity"
  | "Onboarding"
  | "Acquisition"
  | "Trials"
  | "Subscriptions"
  | "Payments"
  | "Engagement";

export interface StandardEventActor {
  readonly userId: string;
}

// ----- Input interfaces (readonly, exact) -----

export interface SignUpProperties {
  readonly method: string;
}
export interface LoginProperties {
  readonly method: string;
}
export interface LogoutProperties {
  readonly reasonCode?: string;
}
export interface OnboardingStartedProperties {
  readonly flowId?: string;
}
export interface OnboardingStepCompletedProperties {
  readonly stepId: string;
  readonly flowId?: string;
}
export interface OnboardingCompletedProperties {
  readonly flowId?: string;
  readonly durationMs?: number;
}
export interface LeadGeneratedProperties {
  readonly channel?: string;
  readonly campaignId?: string;
}
export interface InviteSentProperties {
  readonly channel?: string;
  readonly role?: string;
}
export interface InviteAcceptedProperties {
  readonly channel?: string;
  readonly role?: string;
}
export interface TrialStartedProperties {
  readonly trialId: string;
  readonly planId: string;
  readonly durationDays?: number;
}
export interface TrialEndedProperties {
  readonly trialId: string;
  readonly planId: string;
  readonly outcome: "converted" | "expired" | "cancelled";
}
export interface SubscriptionStartedProperties {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly billingInterval?: "month" | "year" | "other";
}
export interface SubscriptionRenewedProperties {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly billingInterval?: "month" | "year" | "other";
}
export interface SubscriptionChangedProperties {
  readonly subscriptionId: string;
  readonly fromPlanId: string;
  readonly toPlanId: string;
}
export interface SubscriptionPausedProperties {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly reasonCode?: string;
}
export interface SubscriptionResumedProperties {
  readonly subscriptionId: string;
  readonly planId: string;
}
export interface SubscriptionCancelledProperties {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly reasonCode?: string;
  readonly effectiveAtMs?: number;
}
export interface SubscriptionExpiredProperties {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly reasonCode?: string;
  readonly endedAtMs?: number;
}
export interface PaymentSucceededProperties {
  readonly transactionId: string;
  readonly valueMinor: number;
  readonly currency: string;
  readonly provider?: string;
}
export interface PaymentFailedProperties {
  readonly transactionId: string;
  readonly valueMinor?: number;
  readonly currency?: string;
  readonly provider?: string;
  readonly failureCode?: string;
}
export interface PurchaseProperties {
  readonly transactionId: string;
  readonly valueMinor: number;
  readonly currency: string;
  readonly itemCount?: number;
}
export interface RefundProperties {
  readonly refundId: string;
  readonly transactionId: string;
  readonly valueMinor: number;
  readonly currency: string;
  readonly reasonCode?: string;
}
export interface SearchProperties {
  readonly category?: string;
  readonly resultCount?: number;
}
export interface ShareProperties {
  readonly method: string;
  readonly contentType?: string;
}
export interface FeedbackSubmittedProperties {
  readonly kind?: string;
  readonly rating?: 1 | 2 | 3 | 4 | 5;
}

// ----- Wire shape -----

export type StandardEventWireProperties<TData> = {
  readonly $standard: {
    readonly schemaVersion: 1;
    readonly key: StandardEventKey;
    readonly data: TData;
  };
};

export type StandardEventValidationResult =
  | {
      readonly ok: true;
      readonly key: StandardEventKey;
      readonly value: StandardEventWireProperties<unknown>;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type StandardEventDefinition = {
  readonly key: StandardEventKey;
  readonly protectedName: `$prism_${string}`;
  readonly sdkMethod: keyof PrismStandardEvents;
  readonly displayName: string;
  readonly category: StandardEventCategory;
  readonly schemaVersion: 1;
  readonly requiresUser: boolean;
};

export interface PrismStandardEvents {
  signUp(input: Readonly<SignUpProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  login(input: Readonly<LoginProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  logout(input?: Readonly<LogoutProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  onboardingStarted(input?: Readonly<OnboardingStartedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  onboardingStepCompleted(input: Readonly<OnboardingStepCompletedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  onboardingCompleted(input?: Readonly<OnboardingCompletedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  leadGenerated(input?: Readonly<LeadGeneratedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  inviteSent(input?: Readonly<InviteSentProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  inviteAccepted(input?: Readonly<InviteAcceptedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  trialStarted(input: Readonly<TrialStartedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  trialEnded(input: Readonly<TrialEndedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionStarted(input: Readonly<SubscriptionStartedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionRenewed(input: Readonly<SubscriptionRenewedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionChanged(input: Readonly<SubscriptionChangedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionPaused(input: Readonly<SubscriptionPausedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionResumed(input: Readonly<SubscriptionResumedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionCancelled(input: Readonly<SubscriptionCancelledProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  subscriptionExpired(input: Readonly<SubscriptionExpiredProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  paymentSucceeded(input: Readonly<PaymentSucceededProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  paymentFailed(input: Readonly<PaymentFailedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  purchase(input: Readonly<PurchaseProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  refund(input: Readonly<RefundProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  search(input?: Readonly<SearchProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  share(input: Readonly<ShareProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
  feedbackSubmitted(input?: Readonly<FeedbackSubmittedProperties>, actor?: Readonly<StandardEventActor>): import("./contract").CaptureResult;
}

// ---------------------------------------------------------------------------
// Registry — frozen source of truth
// ---------------------------------------------------------------------------

export const STANDARD_EVENT_DEFINITIONS: readonly StandardEventDefinition[] = [
  { key: "sign_up", protectedName: "$prism_sign_up", sdkMethod: "signUp", displayName: "Sign up", category: "Identity", schemaVersion: 1, requiresUser: true },
  { key: "login", protectedName: "$prism_login", sdkMethod: "login", displayName: "Log in", category: "Identity", schemaVersion: 1, requiresUser: true },
  { key: "logout", protectedName: "$prism_logout", sdkMethod: "logout", displayName: "Log out", category: "Identity", schemaVersion: 1, requiresUser: true },
  { key: "onboarding_started", protectedName: "$prism_onboarding_started", sdkMethod: "onboardingStarted", displayName: "Onboarding started", category: "Onboarding", schemaVersion: 1, requiresUser: false },
  { key: "onboarding_step_completed", protectedName: "$prism_onboarding_step_completed", sdkMethod: "onboardingStepCompleted", displayName: "Onboarding step completed", category: "Onboarding", schemaVersion: 1, requiresUser: false },
  { key: "onboarding_completed", protectedName: "$prism_onboarding_completed", sdkMethod: "onboardingCompleted", displayName: "Onboarding completed", category: "Onboarding", schemaVersion: 1, requiresUser: false },
  { key: "lead_generated", protectedName: "$prism_lead_generated", sdkMethod: "leadGenerated", displayName: "Lead generated", category: "Acquisition", schemaVersion: 1, requiresUser: false },
  { key: "invite_sent", protectedName: "$prism_invite_sent", sdkMethod: "inviteSent", displayName: "Invite sent", category: "Acquisition", schemaVersion: 1, requiresUser: false },
  { key: "invite_accepted", protectedName: "$prism_invite_accepted", sdkMethod: "inviteAccepted", displayName: "Invite accepted", category: "Acquisition", schemaVersion: 1, requiresUser: false },
  { key: "trial_started", protectedName: "$prism_trial_started", sdkMethod: "trialStarted", displayName: "Trial started", category: "Trials", schemaVersion: 1, requiresUser: false },
  { key: "trial_ended", protectedName: "$prism_trial_ended", sdkMethod: "trialEnded", displayName: "Trial ended", category: "Trials", schemaVersion: 1, requiresUser: false },
  { key: "subscription_started", protectedName: "$prism_subscription_started", sdkMethod: "subscriptionStarted", displayName: "Subscription started", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_renewed", protectedName: "$prism_subscription_renewed", sdkMethod: "subscriptionRenewed", displayName: "Subscription renewed", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_changed", protectedName: "$prism_subscription_changed", sdkMethod: "subscriptionChanged", displayName: "Subscription changed", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_paused", protectedName: "$prism_subscription_paused", sdkMethod: "subscriptionPaused", displayName: "Subscription paused", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_resumed", protectedName: "$prism_subscription_resumed", sdkMethod: "subscriptionResumed", displayName: "Subscription resumed", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_cancelled", protectedName: "$prism_subscription_cancelled", sdkMethod: "subscriptionCancelled", displayName: "Subscription cancelled", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "subscription_expired", protectedName: "$prism_subscription_expired", sdkMethod: "subscriptionExpired", displayName: "Subscription expired", category: "Subscriptions", schemaVersion: 1, requiresUser: false },
  { key: "payment_succeeded", protectedName: "$prism_payment_succeeded", sdkMethod: "paymentSucceeded", displayName: "Payment succeeded", category: "Payments", schemaVersion: 1, requiresUser: false },
  { key: "payment_failed", protectedName: "$prism_payment_failed", sdkMethod: "paymentFailed", displayName: "Payment failed", category: "Payments", schemaVersion: 1, requiresUser: false },
  { key: "purchase", protectedName: "$prism_purchase", sdkMethod: "purchase", displayName: "Purchase", category: "Payments", schemaVersion: 1, requiresUser: false },
  { key: "refund", protectedName: "$prism_refund", sdkMethod: "refund", displayName: "Refund", category: "Payments", schemaVersion: 1, requiresUser: false },
  { key: "search", protectedName: "$prism_search", sdkMethod: "search", displayName: "Search", category: "Engagement", schemaVersion: 1, requiresUser: false },
  { key: "share", protectedName: "$prism_share", sdkMethod: "share", displayName: "Share", category: "Engagement", schemaVersion: 1, requiresUser: false },
  { key: "feedback_submitted", protectedName: "$prism_feedback_submitted", sdkMethod: "feedbackSubmitted", displayName: "Feedback submitted", category: "Engagement", schemaVersion: 1, requiresUser: false },
] as const;

export const STANDARD_EVENT_BY_KEY: ReadonlyMap<StandardEventKey, StandardEventDefinition> = new Map(
  STANDARD_EVENT_DEFINITIONS.map((d) => [d.key, d]),
);

export const STANDARD_EVENT_BY_PROTECTED_NAME: ReadonlyMap<string, StandardEventDefinition> = new Map(
  STANDARD_EVENT_DEFINITIONS.map((d) => [d.protectedName, d]),
);

export const STANDARD_EVENT_BY_SDK_METHOD: ReadonlyMap<string, StandardEventDefinition> = new Map(
  STANDARD_EVENT_DEFINITIONS.map((d) => [d.sdkMethod, d]),
);

// ---------------------------------------------------------------------------
// Shared scalar validators — exact, low-cardinality, no widening
// ---------------------------------------------------------------------------

function fail(reason: string): StandardEventValidationResult {
  return { ok: false, reason };
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): string | null {
  for (const k of Object.keys(record)) {
    if (!allowed.has(k)) return `${context}: unknown field "${k}"`;
  }
  return null;
}

function validateStableTokenField(value: unknown, field: string): string | null {
  if (!isStableToken(value)) return `${field} must be a stable token (1-64 chars, lowercase letter first, then a-z 0-9 . _ -)`;
  return null;
}

function validateOpaqueIdField(value: unknown, field: string): string | null {
  if (!isOpaqueId(value)) return `${field} must be an opaque analytics ID (1-128 chars, [A-Za-z0-9][A-Za-z0-9._:-]*)`;
  return null;
}

function validateCurrencyField(value: unknown, field: string): string | null {
  if (!isCurrency(value)) return `${field} must be a 3-letter uppercase currency code`;
  return null;
}

function validateMoneyField(value: unknown, field: string): string | null {
  if (!isSafeNonNegativeInt(value)) return `${field} must be a non-negative safe integer (minor units)`;
  return null;
}

function validateCountField(value: unknown, field: string): string | null {
  if (!isSafeNonNegativeInt(value)) return `${field} must be a non-negative safe integer`;
  return null;
}

function validateDurationField(value: unknown, field: string): string | null {
  if (!isSafeNonNegativeInt(value)) return `${field} must be a non-negative safe integer (ms)`;
  return null;
}

function validateEffectiveTimestampField(value: unknown, field: string): string | null {
  if (!isPositiveSafeInt(value)) return `${field} must be a positive safe integer (epoch ms)`;
  return null;
}

// ---------------------------------------------------------------------------
// Per-event data validators — each returns a NEW normalized object
// ---------------------------------------------------------------------------

type DataValidator = (data: unknown) => { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

function validateSignUpData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["method"]), "sign_up");
  if (e) return { ok: false, reason: e };
  const m = validateStableTokenField(r.method, "method");
  if (m) return { ok: false, reason: m };
  return { ok: true, value: { method: r.method } };
}

function validateLoginData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["method"]), "login");
  if (e) return { ok: false, reason: e };
  const m = validateStableTokenField(r.method, "method");
  if (m) return { ok: false, reason: m };
  return { ok: true, value: { method: r.method } };
}

function validateLogoutData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["reasonCode"]), "logout");
  if (e) return { ok: false, reason: e };
  if (r.reasonCode !== undefined) {
    const m = validateStableTokenField(r.reasonCode, "reasonCode");
    if (m) return { ok: false, reason: m };
    return { ok: true, value: { reasonCode: r.reasonCode } };
  }
  return { ok: true, value: {} };
}

function validateOnboardingStartedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["flowId"]), "onboarding_started");
  if (e) return { ok: false, reason: e };
  if (r.flowId !== undefined) {
    const m = validateStableTokenField(r.flowId, "flowId");
    if (m) return { ok: false, reason: m };
    return { ok: true, value: { flowId: r.flowId } };
  }
  return { ok: true, value: {} };
}

function validateOnboardingStepCompletedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["stepId", "flowId"]), "onboarding_step_completed");
  if (e) return { ok: false, reason: e };
  const s = validateStableTokenField(r.stepId, "stepId");
  if (s) return { ok: false, reason: s };
  if (r.flowId !== undefined) {
    const m = validateStableTokenField(r.flowId, "flowId");
    if (m) return { ok: false, reason: m };
    return { ok: true, value: { stepId: r.stepId, flowId: r.flowId } };
  }
  return { ok: true, value: { stepId: r.stepId } };
}

function validateOnboardingCompletedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["flowId", "durationMs"]), "onboarding_completed");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.flowId !== undefined) {
    const m = validateStableTokenField(r.flowId, "flowId");
    if (m) return { ok: false, reason: m };
    out.flowId = r.flowId;
  }
  if (r.durationMs !== undefined) {
    const m = validateDurationField(r.durationMs, "durationMs");
    if (m) return { ok: false, reason: m };
    out.durationMs = r.durationMs;
  }
  return { ok: true, value: out };
}

function validateLeadGeneratedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["channel", "campaignId"]), "lead_generated");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.channel !== undefined) {
    const m = validateStableTokenField(r.channel, "channel");
    if (m) return { ok: false, reason: m };
    out.channel = r.channel;
  }
  if (r.campaignId !== undefined) {
    const m = validateStableTokenField(r.campaignId, "campaignId");
    if (m) return { ok: false, reason: m };
    out.campaignId = r.campaignId;
  }
  return { ok: true, value: out };
}

function validateInviteSentData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["channel", "role"]), "invite_sent");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.channel !== undefined) {
    const m = validateStableTokenField(r.channel, "channel");
    if (m) return { ok: false, reason: m };
    out.channel = r.channel;
  }
  if (r.role !== undefined) {
    const m = validateStableTokenField(r.role, "role");
    if (m) return { ok: false, reason: m };
    out.role = r.role;
  }
  return { ok: true, value: out };
}

function validateInviteAcceptedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["channel", "role"]), "invite_accepted");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.channel !== undefined) {
    const m = validateStableTokenField(r.channel, "channel");
    if (m) return { ok: false, reason: m };
    out.channel = r.channel;
  }
  if (r.role !== undefined) {
    const m = validateStableTokenField(r.role, "role");
    if (m) return { ok: false, reason: m };
    out.role = r.role;
  }
  return { ok: true, value: out };
}

function validateTrialStartedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["trialId", "planId", "durationDays"]), "trial_started");
  if (e) return { ok: false, reason: e };
  const t = validateOpaqueIdField(r.trialId, "trialId");
  if (t) return { ok: false, reason: t };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  if (r.durationDays !== undefined) {
    if (typeof r.durationDays !== "number" || !Number.isInteger(r.durationDays) || r.durationDays < 1 || r.durationDays > 3660) {
      return { ok: false, reason: "durationDays must be integer 1..3660" };
    }
    return { ok: true, value: { trialId: r.trialId, planId: r.planId, durationDays: r.durationDays } };
  }
  return { ok: true, value: { trialId: r.trialId, planId: r.planId } };
}

function validateTrialEndedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["trialId", "planId", "outcome"]), "trial_ended");
  if (e) return { ok: false, reason: e };
  const t = validateOpaqueIdField(r.trialId, "trialId");
  if (t) return { ok: false, reason: t };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  if (r.outcome !== "converted" && r.outcome !== "expired" && r.outcome !== "cancelled") {
    return { ok: false, reason: "outcome must be converted|expired|cancelled" };
  }
  return { ok: true, value: { trialId: r.trialId, planId: r.planId, outcome: r.outcome } };
}

function validateSubscriptionStartedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "planId", "billingInterval"]), "subscription_started");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  if (r.billingInterval !== undefined && r.billingInterval !== "month" && r.billingInterval !== "year" && r.billingInterval !== "other") {
    return { ok: false, reason: "billingInterval must be month|year|other" };
  }
  const out: Record<string, unknown> = { subscriptionId: r.subscriptionId, planId: r.planId };
  if (r.billingInterval !== undefined) out.billingInterval = r.billingInterval;
  return { ok: true, value: out };
}

function validateSubscriptionRenewedData(data: unknown): ReturnType<DataValidator> {
  // same schema as started
  return validateSubscriptionStartedData(data);
}

function validateSubscriptionChangedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "fromPlanId", "toPlanId"]), "subscription_changed");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const f = validateStableTokenField(r.fromPlanId, "fromPlanId");
  if (f) return { ok: false, reason: f };
  const t = validateStableTokenField(r.toPlanId, "toPlanId");
  if (t) return { ok: false, reason: t };
  if (r.fromPlanId === r.toPlanId) return { ok: false, reason: "fromPlanId and toPlanId must differ" };
  return { ok: true, value: { subscriptionId: r.subscriptionId, fromPlanId: r.fromPlanId, toPlanId: r.toPlanId } };
}

function validateSubscriptionPausedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "planId", "reasonCode"]), "subscription_paused");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  if (r.reasonCode !== undefined) {
    const m = validateStableTokenField(r.reasonCode, "reasonCode");
    if (m) return { ok: false, reason: m };
    return { ok: true, value: { subscriptionId: r.subscriptionId, planId: r.planId, reasonCode: r.reasonCode } };
  }
  return { ok: true, value: { subscriptionId: r.subscriptionId, planId: r.planId } };
}

function validateSubscriptionResumedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "planId"]), "subscription_resumed");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  return { ok: true, value: { subscriptionId: r.subscriptionId, planId: r.planId } };
}

function validateSubscriptionCancelledData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "planId", "reasonCode", "effectiveAtMs"]), "subscription_cancelled");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  const out: Record<string, unknown> = { subscriptionId: r.subscriptionId, planId: r.planId };
  if (r.reasonCode !== undefined) {
    const m = validateStableTokenField(r.reasonCode, "reasonCode");
    if (m) return { ok: false, reason: m };
    out.reasonCode = r.reasonCode;
  }
  if (r.effectiveAtMs !== undefined) {
    const m = validateEffectiveTimestampField(r.effectiveAtMs, "effectiveAtMs");
    if (m) return { ok: false, reason: m };
    out.effectiveAtMs = r.effectiveAtMs;
  }
  return { ok: true, value: out };
}

function validateSubscriptionExpiredData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["subscriptionId", "planId", "reasonCode", "endedAtMs"]), "subscription_expired");
  if (e) return { ok: false, reason: e };
  const s = validateOpaqueIdField(r.subscriptionId, "subscriptionId");
  if (s) return { ok: false, reason: s };
  const p = validateStableTokenField(r.planId, "planId");
  if (p) return { ok: false, reason: p };
  const out: Record<string, unknown> = { subscriptionId: r.subscriptionId, planId: r.planId };
  if (r.reasonCode !== undefined) {
    const m = validateStableTokenField(r.reasonCode, "reasonCode");
    if (m) return { ok: false, reason: m };
    out.reasonCode = r.reasonCode;
  }
  if (r.endedAtMs !== undefined) {
    const m = validateEffectiveTimestampField(r.endedAtMs, "endedAtMs");
    if (m) return { ok: false, reason: m };
    out.endedAtMs = r.endedAtMs;
  }
  return { ok: true, value: out };
}

function validatePaymentSucceededData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["transactionId", "valueMinor", "currency", "provider"]), "payment_succeeded");
  if (e) return { ok: false, reason: e };
  const t = validateOpaqueIdField(r.transactionId, "transactionId");
  if (t) return { ok: false, reason: t };
  const v = validateMoneyField(r.valueMinor, "valueMinor");
  if (v) return { ok: false, reason: v };
  const c = validateCurrencyField(r.currency, "currency");
  if (c) return { ok: false, reason: c };
  const out: Record<string, unknown> = { transactionId: r.transactionId, valueMinor: r.valueMinor, currency: r.currency };
  if (r.provider !== undefined) {
    const m = validateStableTokenField(r.provider, "provider");
    if (m) return { ok: false, reason: m };
    out.provider = r.provider;
  }
  return { ok: true, value: out };
}

function validatePaymentFailedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["transactionId", "valueMinor", "currency", "provider", "failureCode"]), "payment_failed");
  if (e) return { ok: false, reason: e };
  const t = validateOpaqueIdField(r.transactionId, "transactionId");
  if (t) return { ok: false, reason: t };
  const hasValue = r.valueMinor !== undefined;
  const hasCurrency = r.currency !== undefined;
  if (hasValue !== hasCurrency) return { ok: false, reason: "valueMinor and currency must be supplied together or both omitted" };
  if (hasValue) {
    const v = validateMoneyField(r.valueMinor, "valueMinor");
    if (v) return { ok: false, reason: v };
    const c = validateCurrencyField(r.currency, "currency");
    if (c) return { ok: false, reason: c };
  }
  const out: Record<string, unknown> = { transactionId: r.transactionId };
  if (hasValue) { out.valueMinor = r.valueMinor; out.currency = r.currency; }
  if (r.provider !== undefined) {
    const m = validateStableTokenField(r.provider, "provider");
    if (m) return { ok: false, reason: m };
    out.provider = r.provider;
  }
  if (r.failureCode !== undefined) {
    const m = validateStableTokenField(r.failureCode, "failureCode");
    if (m) return { ok: false, reason: m };
    out.failureCode = r.failureCode;
  }
  return { ok: true, value: out };
}

function validatePurchaseData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["transactionId", "valueMinor", "currency", "itemCount"]), "purchase");
  if (e) return { ok: false, reason: e };
  const t = validateOpaqueIdField(r.transactionId, "transactionId");
  if (t) return { ok: false, reason: t };
  const v = validateMoneyField(r.valueMinor, "valueMinor");
  if (v) return { ok: false, reason: v };
  const c = validateCurrencyField(r.currency, "currency");
  if (c) return { ok: false, reason: c };
  const out: Record<string, unknown> = { transactionId: r.transactionId, valueMinor: r.valueMinor, currency: r.currency };
  if (r.itemCount !== undefined) {
    const m = validateCountField(r.itemCount, "itemCount");
    if (m) return { ok: false, reason: m };
    out.itemCount = r.itemCount;
  }
  return { ok: true, value: out };
}

function validateRefundData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["refundId", "transactionId", "valueMinor", "currency", "reasonCode"]), "refund");
  if (e) return { ok: false, reason: e };
  const f = validateOpaqueIdField(r.refundId, "refundId");
  if (f) return { ok: false, reason: f };
  const t = validateOpaqueIdField(r.transactionId, "transactionId");
  if (t) return { ok: false, reason: t };
  const v = validateMoneyField(r.valueMinor, "valueMinor");
  if (v) return { ok: false, reason: v };
  const c = validateCurrencyField(r.currency, "currency");
  if (c) return { ok: false, reason: c };
  const out: Record<string, unknown> = { refundId: r.refundId, transactionId: r.transactionId, valueMinor: r.valueMinor, currency: r.currency };
  if (r.reasonCode !== undefined) {
    const m = validateStableTokenField(r.reasonCode, "reasonCode");
    if (m) return { ok: false, reason: m };
    out.reasonCode = r.reasonCode;
  }
  return { ok: true, value: out };
}

function validateSearchData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["category", "resultCount"]), "search");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.category !== undefined) {
    const m = validateStableTokenField(r.category, "category");
    if (m) return { ok: false, reason: m };
    out.category = r.category;
  }
  if (r.resultCount !== undefined) {
    const m = validateCountField(r.resultCount, "resultCount");
    if (m) return { ok: false, reason: m };
    out.resultCount = r.resultCount;
  }
  return { ok: true, value: out };
}

function validateShareData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["method", "contentType"]), "share");
  if (e) return { ok: false, reason: e };
  const m = validateStableTokenField(r.method, "method");
  if (m) return { ok: false, reason: m };
  const out: Record<string, unknown> = { method: r.method };
  if (r.contentType !== undefined) {
    const c = validateStableTokenField(r.contentType, "contentType");
    if (c) return { ok: false, reason: c };
    out.contentType = r.contentType;
  }
  return { ok: true, value: out };
}

function validateFeedbackSubmittedData(data: unknown): ReturnType<DataValidator> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "data must be an object" };
  const r = data as Record<string, unknown>;
  const e = assertExactKeys(r, new Set(["kind", "rating"]), "feedback_submitted");
  if (e) return { ok: false, reason: e };
  const out: Record<string, unknown> = {};
  if (r.kind !== undefined) {
    const m = validateStableTokenField(r.kind, "kind");
    if (m) return { ok: false, reason: m };
    out.kind = r.kind;
  }
  if (r.rating !== undefined) {
    if (typeof r.rating !== "number" || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) {
      return { ok: false, reason: "rating must be integer 1..5" };
    }
    out.rating = r.rating;
  }
  return { ok: true, value: out };
}

// Validator dispatch table — one entry per StandardEventKey
const DATA_VALIDATORS: Readonly<Record<StandardEventKey, DataValidator>> = {
  sign_up: validateSignUpData,
  login: validateLoginData,
  logout: validateLogoutData,
  onboarding_started: validateOnboardingStartedData,
  onboarding_step_completed: validateOnboardingStepCompletedData,
  onboarding_completed: validateOnboardingCompletedData,
  lead_generated: validateLeadGeneratedData,
  invite_sent: validateInviteSentData,
  invite_accepted: validateInviteAcceptedData,
  trial_started: validateTrialStartedData,
  trial_ended: validateTrialEndedData,
  subscription_started: validateSubscriptionStartedData,
  subscription_renewed: validateSubscriptionRenewedData,
  subscription_changed: validateSubscriptionChangedData,
  subscription_paused: validateSubscriptionPausedData,
  subscription_resumed: validateSubscriptionResumedData,
  subscription_cancelled: validateSubscriptionCancelledData,
  subscription_expired: validateSubscriptionExpiredData,
  payment_succeeded: validatePaymentSucceededData,
  payment_failed: validatePaymentFailedData,
  purchase: validatePurchaseData,
  refund: validateRefundData,
  search: validateSearchData,
  share: validateShareData,
  feedback_submitted: validateFeedbackSubmittedData,
};

// ---------------------------------------------------------------------------
// Public wire validator — used by SDK capture, ingestion, and product API
// ---------------------------------------------------------------------------

/**
 * Validates the complete protected wire properties for a Standard Event.
 * The `name` must be a known `$prism_*` Standard Event name; the `properties`
 * must be the exact `$standard` wrapper with matching key and valid data.
 * Returns a normalized NEW object on success; never mutates the input.
 */
export function validateStandardEventProperties(
  name: string,
  properties: unknown,
): StandardEventValidationResult {
  const def = STANDARD_EVENT_BY_PROTECTED_NAME.get(name);
  if (!def) {
    return fail(`unknown Standard Event name "${name}"`);
  }
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return fail("properties must be an object");
  }
  const outer = properties as Record<string, unknown>;
  const outerKeys = Object.keys(outer);
  if (outerKeys.length !== 1 || outerKeys[0] !== "$standard") {
    return fail("properties must contain exactly $standard");
  }
  const standard = outer.$standard;
  if (typeof standard !== "object" || standard === null || Array.isArray(standard)) {
    return fail("$standard must be an object");
  }
  const s = standard as Record<string, unknown>;
  const innerKeys = Object.keys(s);
  // Must contain exactly schemaVersion, key, data (no extra, no missing)
  const allowedInner = new Set(["schemaVersion", "key", "data"]);
  for (const k of innerKeys) {
    if (!allowedInner.has(k)) return fail(`$standard: unknown field "${k}"`);
  }
  if (s.schemaVersion !== 1) return fail("$standard.schemaVersion must be 1");
  if (s.key !== def.key) return fail(`$standard.key must be "${def.key}" for ${name}`);
  const dataValidator = DATA_VALIDATORS[def.key];
  const dataResult = dataValidator(s.data);
  if (!dataResult.ok) return fail(dataResult.reason);
  // Build normalized NEW object — do not return the caller's reference.
  const value: StandardEventWireProperties<unknown> = {
    $standard: {
      schemaVersion: 1,
      key: def.key,
      data: dataResult.value,
    },
  };
  return { ok: true, key: def.key, value };
}

/**
 * Validates Standard Event *data* only (without the wrapper). Used by the
 * SDK helper path that builds the wrapper internally.
 */
export function validateStandardEventData(
  key: StandardEventKey,
  data: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  const v = DATA_VALIDATORS[key];
  if (!v) return { ok: false, reason: `unknown key "${key}"` };
  return v(data);
}

// ---------------------------------------------------------------------------
// Helpers for SDK capture — protected name lookup + display metadata
// ---------------------------------------------------------------------------

export function protectedNameForKey(key: StandardEventKey): `$prism_${string}` {
  const def = STANDARD_EVENT_BY_KEY.get(key);
  if (!def) throw new Error(`unknown Standard Event key "${key}"`);
  return def.protectedName;
}

export function displayNameForKey(key: StandardEventKey): string {
  const def = STANDARD_EVENT_BY_KEY.get(key);
  return def?.displayName ?? key;
}

export function categoryForKey(key: StandardEventKey): StandardEventCategory | null {
  const def = STANDARD_EVENT_BY_KEY.get(key);
  return def?.category ?? null;
}

export function requiresUserForKey(key: StandardEventKey): boolean {
  const def = STANDARD_EVENT_BY_KEY.get(key);
  return def?.requiresUser ?? false;
}
