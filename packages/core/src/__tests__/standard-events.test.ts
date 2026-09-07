import { describe, expect, it } from "vitest";
import {
  STANDARD_EVENT_DEFINITIONS,
  STANDARD_EVENT_LIMITS,
  standardEventDefinitionForKey,
  standardEventDefinitionForProtectedName,
  standardEventDefinitionForSdkMethod,
  validateStandardEventData,
  validateStandardEventProperties,
} from "../standard-events";

const VALID_FIXTURES: Record<string, Record<string, unknown>> = {
  sign_up: { method: "email" },
  login: { method: "password" },
  logout: {},
  onboarding_started: {},
  onboarding_step_completed: { stepId: "profile" },
  onboarding_completed: {},
  lead_generated: {},
  invite_sent: {},
  invite_accepted: {},
  trial_started: { trialId: "trial_01", planId: "pro_monthly" },
  trial_ended: { trialId: "trial_01", planId: "pro_monthly", outcome: "converted" },
  subscription_started: { subscriptionId: "sub_01", planId: "pro_monthly" },
  subscription_renewed: { subscriptionId: "sub_01", planId: "pro_monthly", billingInterval: "month" },
  subscription_changed: { subscriptionId: "sub_01", fromPlanId: "pro_monthly", toPlanId: "pro_yearly" },
  subscription_paused: { subscriptionId: "sub_01", planId: "pro_monthly" },
  subscription_resumed: { subscriptionId: "sub_01", planId: "pro_monthly" },
  subscription_cancelled: { subscriptionId: "sub_01", planId: "pro_monthly" },
  subscription_expired: { subscriptionId: "sub_01", planId: "pro_monthly" },
  payment_succeeded: { transactionId: "txn_01", valueMinor: 1299, currency: "USD" },
  payment_failed: { transactionId: "txn_01" },
  purchase: { transactionId: "order_01", valueMinor: 4999, currency: "EUR" },
  refund: { refundId: "ref_01", transactionId: "order_01", valueMinor: 1299, currency: "USD" },
  search: {},
  share: { method: "twitter" },
  feedback_submitted: {},
};

const FULL_FIXTURES: Record<string, Record<string, unknown>> = {
  sign_up: { method: "google" },
  login: { method: "magic_link" },
  logout: { reasonCode: "user_initiated" },
  onboarding_started: { flowId: "workspace_setup" },
  onboarding_step_completed: { stepId: "step_1", flowId: "workspace_setup" },
  onboarding_completed: { flowId: "workspace_setup", durationMs: 12345 },
  lead_generated: { channel: "website", campaignId: "campaign_01" },
  invite_sent: { channel: "email", role: "admin" },
  invite_accepted: { channel: "email", role: "admin" },
  trial_started: { trialId: "trial_02", planId: "pro_monthly", durationDays: 14 },
  trial_ended: { trialId: "trial_02", planId: "pro_monthly", outcome: "expired" },
  subscription_started: { subscriptionId: "sub_02", planId: "pro_monthly", billingInterval: "year" },
  subscription_renewed: { subscriptionId: "sub_02", planId: "pro_monthly", billingInterval: "other" },
  subscription_changed: { subscriptionId: "sub_02", fromPlanId: "free", toPlanId: "pro_monthly" },
  subscription_paused: { subscriptionId: "sub_02", planId: "pro_monthly", reasonCode: "customer_requested" },
  subscription_resumed: { subscriptionId: "sub_02", planId: "pro_monthly" },
  subscription_cancelled: { subscriptionId: "sub_02", planId: "pro_monthly", reasonCode: "customer_requested", effectiveAtMs: 1_700_000_000_000 },
  subscription_expired: { subscriptionId: "sub_02", planId: "pro_monthly", reasonCode: "payment_failed", endedAtMs: 1_700_000_000_000 },
  payment_succeeded: { transactionId: "txn_02", valueMinor: 100, currency: "USD", provider: "stripe" },
  payment_failed: { transactionId: "txn_02", valueMinor: 100, currency: "USD", provider: "stripe", failureCode: "card_declined" },
  purchase: { transactionId: "order_02", valueMinor: 1299, currency: "USD", itemCount: 2 },
  refund: { refundId: "ref_02", transactionId: "order_02", valueMinor: 500, currency: "USD", reasonCode: "customer_requested" },
  search: { category: "documentation", resultCount: 8 },
  share: { method: "email", contentType: "report" },
  feedback_submitted: { kind: "nps", rating: 5 },
};

describe("Task 19 slice 1 — registry, types, schemas", () => {
  it("registry is frozen at 25 entries with exact one-to-one invariants", () => {
    expect(STANDARD_EVENT_DEFINITIONS).toHaveLength(25);
    const keys = new Set<string>();
    const protectedNames = new Set<string>();
    const sdkMethods = new Set<string>();
    const displayNames = new Set<string>();
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      expect(def.schemaVersion).toBe(1);
      expect(typeof def.key).toBe("string");
      expect(typeof def.protectedName).toBe("string");
      expect(def.protectedName).toBe(`$prism_${def.key}`);
      expect(typeof def.sdkMethod).toBe("string");
      expect(typeof def.displayName).toBe("string");
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(["Identity", "Onboarding", "Acquisition", "Trials", "Subscriptions", "Payments", "Engagement"]).toContain(def.category);
      expect(typeof def.requiresUser).toBe("boolean");
      expect(keys.has(def.key)).toBe(false);
      keys.add(def.key);
      expect(protectedNames.has(def.protectedName)).toBe(false);
      protectedNames.add(def.protectedName);
      expect(sdkMethods.has(def.sdkMethod)).toBe(false);
      sdkMethods.add(def.sdkMethod);
      expect(displayNames.has(def.displayName)).toBe(false);
      displayNames.add(def.displayName);
    }
    // requiresUser only for sign_up/login/logout
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      if (["sign_up", "login", "logout"].includes(def.key)) expect(def.requiresUser).toBe(true);
      else expect(def.requiresUser).toBe(false);
    }
    // Lookup functions agree with the array (R1-F4: maps are private)
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      expect(standardEventDefinitionForKey(def.key)).toEqual(def);
      expect(standardEventDefinitionForProtectedName(def.protectedName)).toEqual(def);
      expect(standardEventDefinitionForSdkMethod(def.sdkMethod)).toEqual(def);
    }
    expect(standardEventDefinitionForKey("not_a_key" as never)).toBeNull();
    expect(standardEventDefinitionForProtectedName("$prism_not_there")).toBeNull();
    expect(standardEventDefinitionForSdkMethod("notAMethod")).toBeNull();
    // Every validator keyed — validateStandardEventData covers all
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      const fixture = VALID_FIXTURES[def.key];
      expect(fixture, `missing fixture for ${def.key}`).toBeDefined();
      const r = validateStandardEventData(def.key as never, fixture);
      expect(r.ok, `${def.key} fixture should be valid`).toBe(true);
    }
  });

  it("exposes frozen limits matching the task table", () => {
    expect(STANDARD_EVENT_LIMITS.schemaVersion).toBe(1);
    expect(STANDARD_EVENT_LIMITS.stableTokenMaxLength).toBe(64);
    expect(STANDARD_EVENT_LIMITS.opaqueIdMaxLength).toBe(128);
    expect(STANDARD_EVENT_LIMITS.currencyLength).toBe(3);
    expect(STANDARD_EVENT_LIMITS.maxTrialDurationDays).toBe(3660);
    expect(STANDARD_EVENT_LIMITS.maxRating).toBe(5);
    expect(STANDARD_EVENT_LIMITS.minRating).toBe(1);
  });

  it("every valid minimum and full fixture normalizes to exact wire shape", () => {
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      for (const fixture of [VALID_FIXTURES[def.key], FULL_FIXTURES[def.key]]) {
        const result = validateStandardEventProperties(def.protectedName, {
          $standard: { schemaVersion: 1, key: def.key, data: fixture },
        });
        expect(result.ok, `${def.key} ${JSON.stringify(fixture)}`).toBe(true);
        if (!result.ok) continue;
        expect(result.key).toBe(def.key);
        expect(result.value).toEqual({
          $standard: { schemaVersion: 1, key: def.key, data: fixture },
        });
        // Must be a NEW object, not the caller's reference
        const input = { $standard: { schemaVersion: 1 as const, key: def.key as never, data: fixture } };
        const r2 = validateStandardEventProperties(def.protectedName, input);
        expect(r2.ok && (r2.value as unknown) !== input).toBe(true);
        expect(r2.ok && (r2.value as { $standard: { data: unknown } }).$standard.data !== fixture).toBe(true);
      }
    }
  });

  it("rejects unknown keys, wrong types, invalid tokens, unsafe integers, invalid currency, mismatched pairs", () => {
    // unknown top-level key
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email", extra: 1 } } }).ok).toBe(false);
    // unknown $standard field
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" }, extra: 1 } } as unknown).ok).toBe(false);
    // wrong schemaVersion
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 2, key: "sign_up", data: { method: "email" } } } as unknown).ok).toBe(false);
    // key disagrees with protected name
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "login", data: { method: "email" } } } as unknown).ok).toBe(false);
    // missing $standard
    expect(validateStandardEventProperties("$prism_sign_up", { method: "email" } as unknown).ok).toBe(false);
    // invalid stable token: uppercase, starts with digit, too long, contains @
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "Email" } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "1email" } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "a".repeat(65) } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "a@b" } } }).ok).toBe(false);
    // opaque id: slash rejected, empty, too long
    expect(validateStandardEventProperties("$prism_trial_started", { $standard: { schemaVersion: 1, key: "trial_started", data: { trialId: "a/b", planId: "pro_monthly" } } }).ok).toBe(false);
    // currency: lowercase, too short
    expect(validateStandardEventProperties("$prism_purchase", { $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: 100, currency: "usd" } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_purchase", { $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: 100, currency: "US" } } }).ok).toBe(false);
    // unsafe money: negative, non-integer, Infinity, beyond safe integer
    expect(validateStandardEventProperties("$prism_purchase", { $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: -1, currency: "USD" } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_purchase", { $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: 12.99, currency: "USD" } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_purchase", { $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: Number.POSITIVE_INFINITY, currency: "USD" } } }).ok).toBe(false);
    // rating out of range
    expect(validateStandardEventProperties("$prism_feedback_submitted", { $standard: { schemaVersion: 1, key: "feedback_submitted", data: { rating: 0 } } } as unknown).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_feedback_submitted", { $standard: { schemaVersion: 1, key: "feedback_submitted", data: { rating: 6 } } } as unknown).ok).toBe(false);
    // trial duration out of range
    expect(validateStandardEventProperties("$prism_trial_started", { $standard: { schemaVersion: 1, key: "trial_started", data: { trialId: "t1", planId: "pro_monthly", durationDays: 0 } } }).ok).toBe(false);
    expect(validateStandardEventProperties("$prism_trial_started", { $standard: { schemaVersion: 1, key: "trial_started", data: { trialId: "t1", planId: "pro_monthly", durationDays: 3661 } } }).ok).toBe(false);
    // unknown Standard Event name
    expect(validateStandardEventProperties("$prism_unknown_thing", { $standard: { schemaVersion: 1, key: "sign_up" as never, data: { method: "email" } } }).ok).toBe(false);
    // dangerous keys? Not allowed because exact set (use JSON.parse to avoid literal prototype assignment)
    const protoPayload = JSON.parse('{"method":"email","__proto__":1}');
    expect(validateStandardEventProperties("$prism_sign_up", { $standard: { schemaVersion: 1, key: "sign_up", data: protoPayload } } as unknown).ok).toBe(false);
  });

  it("subscriptionChanged rejects equal from/to plan IDs", () => {
    expect(
      validateStandardEventProperties("$prism_subscription_changed", {
        $standard: { schemaVersion: 1, key: "subscription_changed", data: { subscriptionId: "sub_01", fromPlanId: "pro_monthly", toPlanId: "pro_monthly" } },
      }).ok,
    ).toBe(false);
  });

  it("paymentFailed requires valueMinor and currency together", () => {
    expect(
      validateStandardEventProperties("$prism_payment_failed", {
        $standard: { schemaVersion: 1, key: "payment_failed", data: { transactionId: "txn_01", valueMinor: 100 } },
      }).ok,
    ).toBe(false);
    expect(
      validateStandardEventProperties("$prism_payment_failed", {
        $standard: { schemaVersion: 1, key: "payment_failed", data: { transactionId: "txn_01", currency: "USD" } },
      }).ok,
    ).toBe(false);
    expect(
      validateStandardEventProperties("$prism_payment_failed", {
        $standard: { schemaVersion: 1, key: "payment_failed", data: { transactionId: "txn_01", valueMinor: 100, currency: "USD" } },
      }).ok,
    ).toBe(true);
  });

  it("rejects raw search text, feedback text, provider payloads, arbitrary metadata", () => {
    // search: no `query` field, only category/resultCount
    expect(
      validateStandardEventProperties("$prism_search", {
        $standard: { schemaVersion: 1, key: "search", data: { query: "hello world", category: "docs" } },
      } as unknown).ok,
    ).toBe(false);
    // feedback: no body text
    expect(
      validateStandardEventProperties("$prism_feedback_submitted", {
        $standard: { schemaVersion: 1, key: "feedback_submitted", data: { body: "great product!" } },
      } as unknown).ok,
    ).toBe(false);
    // refund: no provider payload
    expect(
      validateStandardEventProperties("$prism_refund", {
        $standard: { schemaVersion: 1, key: "refund", data: { refundId: "ref_01", transactionId: "txn_01", valueMinor: 100, currency: "USD", stripePayload: {} } },
      } as unknown).ok,
    ).toBe(false);
    // purchase: no metadata bag
    expect(
      validateStandardEventProperties("$prism_purchase", {
        $standard: { schemaVersion: 1, key: "purchase", data: { transactionId: "txn_01", valueMinor: 100, currency: "USD", metadata: { foo: "bar" } } },
      } as unknown).ok,
    ).toBe(false);
  });

  it("validators create new objects and never mutate inputs", () => {
    const input = { method: "email" };
    const frozen = Object.freeze({ ...input });
    const r = validateStandardEventData("sign_up", frozen);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toBe(frozen);
      expect(r.value).toEqual({ method: "email" });
      expect(input).toEqual({ method: "email" });
    }
    // mutation check for purchase with optional fields
    const pInput: Record<string, unknown> = { transactionId: "txn_01", valueMinor: 100, currency: "USD", itemCount: 2 };
    const orig = { ...pInput };
    const rp = validateStandardEventData("purchase", pInput);
    expect(rp.ok).toBe(true);
    expect(pInput).toEqual(orig);
  });

  it("effective timestamps must be positive safe integers", () => {
    expect(
      validateStandardEventProperties("$prism_subscription_cancelled", {
        $standard: { schemaVersion: 1, key: "subscription_cancelled", data: { subscriptionId: "sub_01", planId: "pro_monthly", effectiveAtMs: 0 } },
      }).ok,
    ).toBe(false);
    expect(
      validateStandardEventProperties("$prism_subscription_cancelled", {
        $standard: { schemaVersion: 1, key: "subscription_cancelled", data: { subscriptionId: "sub_01", planId: "pro_monthly", effectiveAtMs: -100 } },
      }).ok,
    ).toBe(false);
    expect(
      validateStandardEventProperties("$prism_subscription_cancelled", {
        $standard: { schemaVersion: 1, key: "subscription_cancelled", data: { subscriptionId: "sub_01", planId: "pro_monthly", effectiveAtMs: Number.MAX_SAFE_INTEGER + 1 } },
      }).ok,
    ).toBe(false);
  });

  it("R1-F4: the registry is immutable at runtime, not just at type level", () => {
    // The exported surface is frozen: array, definitions, and limits.
    expect(Object.isFrozen(STANDARD_EVENT_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(STANDARD_EVENT_LIMITS)).toBe(true);
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      expect(Object.isFrozen(def)).toBe(true);
    }
    // Attempted mutation of a definition throws (strict mode) ...
    const def = standardEventDefinitionForProtectedName("$prism_sign_up");
    expect(def).not.toBeNull();
    expect(() => {
      (def as { protectedName: string }).protectedName = "$prism_evil";
    }).toThrow();
    expect(() => {
      (STANDARD_EVENT_LIMITS as { schemaVersion: number }).schemaVersion = 2;
    }).toThrow();
    expect(() => {
      (STANDARD_EVENT_DEFINITIONS as unknown as unknown[]).push({});
    }).toThrow();
    // ... and helper behavior is unchanged after every attempt.
    expect(def?.protectedName).toBe("$prism_sign_up");
    expect(STANDARD_EVENT_LIMITS.schemaVersion).toBe(1);
    expect(STANDARD_EVENT_DEFINITIONS).toHaveLength(25);
    expect(
      validateStandardEventProperties("$prism_sign_up", {
        $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } },
      }).ok,
    ).toBe(true);
    // Lookup functions hand out the same frozen objects — no mutable Maps
    // are exported, so there is no set/delete/clear surface at all.
    expect(standardEventDefinitionForKey("sign_up")).toBe(def);
  });
});
