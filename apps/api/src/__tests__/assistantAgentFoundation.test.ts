/**
 * Slice 5 agent-foundation tests (Task 21 slice 5).
 *
 * No provider, no network: authorization cache behavior, grounded-answer
 * validation, and model-config validation against the frozen contracts.
 */
import { describe, expect, it } from "vitest";
import {
  createAuthorizationCache,
  type AuthorizedContextLookup,
} from "../utils/assistantAuthCache";
import {
  buildFallbackAnswer,
  clampQuestion,
  validateGroundedAnswer,
} from "../utils/assistantAnswer";
import {
  estimateCostMicroUsd,
  resolveAssistantModelConfig,
} from "../utils/assistantModel";
import {
  AssistantAnswerSchema,
  PROMPT_INJECTION_FIXTURES,
  type AssistantAnswer,
  type AuthorizedProjectContext,
  type MetricFact,
} from "@prism-analytics/types";

const CONTEXT: AuthorizedProjectContext = {
  userId: "user_1",
  organizationId: "org_1",
  projectId: "proj_1",
  role: "member",
  allowedSourceIds: ["src_a", "src_b"],
  permissions: { canConfirmMemory: false, canManageProject: false },
  cachedAt: 1_785_628_800_000,
};

function lookupWith(
  context: AuthorizedProjectContext | null,
  calls: { count: number } = { count: 0 },
): AuthorizedContextLookup {
  return async () => {
    calls.count += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return context;
  };
}

describe("authorization cache", () => {
  it("caches by verified IDs and memoizes in-flight lookups", async () => {
    const calls = { count: 0 };
    const cache = createAuthorizationCache({
      lookup: lookupWith(CONTEXT, calls),
    });
    const key = {
      userId: "user_1",
      organizationId: "org_1",
      projectId: "proj_1",
    };
    const [first, second] = await Promise.all([cache.get(key), cache.get(key)]);
    expect(first).toEqual(CONTEXT);
    expect(second).toEqual(CONTEXT);
    expect(calls.count).toBe(1);
    await cache.get(key);
    expect(calls.count).toBe(1);
    expect(cache.keys()).toHaveLength(1);
  });

  it("expires entries after the bounded TTL", async () => {
    let now = 1_000_000;
    const calls = { count: 0 };
    const cache = createAuthorizationCache({
      lookup: lookupWith(CONTEXT, calls),
      now: () => now,
      ttlMs: 10_000,
    });
    const key = {
      userId: "user_1",
      organizationId: "org_1",
      projectId: "proj_1",
    };
    await cache.get(key);
    now += 9_999;
    await cache.get(key);
    expect(calls.count).toBe(1);
    now += 1;
    await cache.get(key);
    expect(calls.count).toBe(2);
  });

  it("is non-disclosing for missing membership", async () => {
    const cache = createAuthorizationCache({ lookup: lookupWith(null) });
    await expect(
      cache.get({
        userId: "ghost",
        organizationId: "org_1",
        projectId: "proj_1",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("enforces source-subset scopes per tool call", async () => {
    const cache = createAuthorizationCache({ lookup: lookupWith(CONTEXT) });
    const key = {
      userId: "user_1",
      organizationId: "org_1",
      projectId: "proj_1",
    };
    await expect(
      cache.requireScope(key, { sourceIds: ["src_a"] }),
    ).resolves.toEqual(CONTEXT);
    await expect(
      cache.requireScope(key, { sourceIds: ["src_evil"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      cache.requireScope(key, { projectId: "proj_evil" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      cache.requireScope(key, { userId: "user_evil" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

function factWith(overrides: Partial<MetricFact> & { id: string }): MetricFact {
  return {
    metricId: "project.accepted_events",
    definitionVersion: 1,
    label: "Accepted events",
    value: 120,
    formattedValue: "120",
    unit: "events",
    comparison: { kind: "percent", direction: "up", percent: 20 },
    comparisonBasis: {
      previousValue: 100,
      denominatorCurrent: null,
      denominatorPrevious: null,
    },
    queryContext: {
      from: 1,
      to: 2,
      compareFrom: 0,
      compareTo: 1,
      asOf: 2,
      timezone: "UTC",
      sourceScope: "all",
      sourceIds: [],
      definitionVersion: 1,
    },
    coverage: {
      sourcesConfigured: 1,
      sourcesActive: 1,
      enrichments: [],
      warnings: [],
    },
    coverageNote: "Measured across 1 source.",
    filters: {},
    drilldown: { destination: "events", label: "Events" },
    ...overrides,
  };
}

function answerWith(overrides: Partial<AssistantAnswer>): AssistantAnswer {
  return {
    summary: "Accepted events were 120.",
    observations: [],
    primaryArtifactId: null,
    supportingArtifactIds: [],
    assumptions: [],
    followUps: [],
    ...overrides,
  };
}

describe("grounded-answer validation", () => {
  it("accepts fully cited numeric and directional claims", () => {
    const fact = factWith({ id: "f1" });
    const answer = answerWith({
      summary: "Accepted events rose to 120, up 20 from 100.",
      observations: [
        { text: "Accepted events rose to 120.", factIds: ["f1"] },
      ],
    });
    expect(
      validateGroundedAnswer(answer, new Map([["f1", fact]]), new Set()),
    ).toEqual({ ok: true });
  });

  it("rejects unknown facts, foreign artifacts, and causal claims", () => {
    const fact = factWith({ id: "f1" });
    const facts = new Map([["f1", fact]]);
    expect(
      validateGroundedAnswer(
        answerWith({
          observations: [{ text: "Events were 120.", factIds: ["f_evil"] }],
        }),
        facts,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateGroundedAnswer(
        answerWith({ primaryArtifactId: "a_evil" }),
        facts,
        new Set(["a1"]),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "The release caused events to rise to 120.",
          observations: [{ text: "Events were 120.", factIds: ["f1"] }],
        }),
        facts,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejects unsupported numbers and direction without comparison", () => {
    const fact = factWith({ id: "f1" });
    const facts = new Map([["f1", fact]]);
    expect(
      validateGroundedAnswer(
        answerWith({ summary: "Accepted events hit 9,999." }),
        facts,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
    const flat = factWith({
      id: "f2",
      value: 50,
      formattedValue: "50",
      comparison: null,
      comparisonBasis: {
        previousValue: null,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Events increased to 50.",
          observations: [{ text: "Events increased to 50.", factIds: ["f2"] }],
        }),
        new Map([["f2", flat]]),
        new Set(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("ignores non-directional up/down phrases", () => {
    const flat = factWith({
      id: "f2",
      value: 50,
      formattedValue: "50",
      comparison: null,
      comparisonBasis: {
        previousValue: null,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Sign up completed at 50. Break down by source on request.",
          observations: [{ text: "Sign up completed at 50.", factIds: ["f2"] }],
        }),
        new Map([["f2", flat]]),
        new Set(),
      ),
    ).toEqual({ ok: true });
  });

  it("builds a valid fallback and clamps questions", () => {
    const fallback = buildFallbackAnswer("x".repeat(500));
    expect(AssistantAnswerSchema.safeParse(fallback).success).toBe(true);
    expect(fallback.observations).toHaveLength(0);
    expect(clampQuestion("ok")).toBe("ok");
    expect(clampQuestion("x".repeat(5000))).toHaveLength(2000);
    expect(clampQuestion(42 as unknown as string)).toBe("");
  });

  it("keeps hostile telemetry inert inside the quoted summary envelope", async () => {
    const { buildModelSummary } = await import("@prism-analytics/types");
    for (const hostile of PROMPT_INJECTION_FIXTURES) {
      const summary = buildModelSummary([
        { id: "fh", label: "Observed note", value: hostile.slice(0, 190) },
      ]);
      // Newlines, markup, and SQL/SSTI probes stay inside the JSON-quoted
      // string: no raw control characters leak beside the envelope.
      expect(summary.text).toContain(JSON.stringify(hostile.slice(0, 190)));
      expect(summary.text).not.toMatch(/\r|\n/);
    }
    // Hostile digits prove nothing: unmeasured numbers quoted from a
    // hostile string fail grounding even beside a measured claim.
    const fact = factWith({
      id: "fh",
      label: "Accepted events",
      value: 7,
      formattedValue: "7",
    });
    const answer = answerWith({
      summary: "Events were 7. Note: release-2.4.1'; DROP TABLE events; --",
      observations: [{ text: "Events were 7.", factIds: ["fh"] }],
    });
    expect(
      validateGroundedAnswer(answer, new Map([["fh", fact]]), new Set()),
    ).toMatchObject({ ok: false });
  });
});

describe("model configuration", () => {
  const baseEnv = {
    PRISM_AI_ENABLED: "1",
    OPENROUTER_API_KEY: "sk-test",
  };
  it("resolves the pinned default with routing policy", () => {
    const config = resolveAssistantModelConfig(baseEnv);
    expect(config.enabled).toBe(true);
    expect(config.model.id).toBe("openai/gpt-4o-mini");
    expect(config.routing.allowedModels).toEqual(["openai/gpt-4o-mini"]);
    expect(config.routing.allowFallbackModels).toBe(false);
    expect(config.routing.denyDataCollection).toBe(true);
    expect(config.routing.requireZeroDataRetention).toBe(true);
    expect(config.maxSteps).toBe(5);
  });

  it("fails closed when disabled, keyless, off-allowlist, or over-cap", () => {
    expect(() =>
      resolveAssistantModelConfig({ ...baseEnv, PRISM_AI_ENABLED: "0" }),
    ).toThrowError(expect.objectContaining({ code: "disabled" }));
    expect(() =>
      resolveAssistantModelConfig({ PRISM_AI_ENABLED: "1" }),
    ).toThrowError(expect.objectContaining({ code: "invalid-config" }));
    expect(() =>
      resolveAssistantModelConfig({ ...baseEnv, PRISM_AI_MODEL: "evil/model" }),
    ).toThrowError(expect.objectContaining({ code: "invalid-config" }));
    expect(() =>
      resolveAssistantModelConfig({
        ...baseEnv,
        PRISM_AI_MAX_PROMPT_PRICE_PER_MILLION: "0.000001",
      }),
    ).toThrowError(expect.objectContaining({ code: "price-exceeded" }));
  });

  it("prices runs in integer micro-USD", () => {
    expect(
      estimateCostMicroUsd({
        promptTokens: 1000,
        completionTokens: 500,
        promptPricePerMillionMicroUsd: 150_000,
        completionPricePerMillionMicroUsd: 600_000,
      }),
    ).toBe(150 + 300);
  });
});
