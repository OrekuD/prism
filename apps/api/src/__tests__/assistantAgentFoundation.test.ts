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
  type AssistantEvidenceFact,
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

function ev(fact: MetricFact): AssistantEvidenceFact {
  return { kind: "metric", fact };
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
      validateGroundedAnswer(answer, new Map([["f1", ev(fact)]]), new Set()),
    ).toEqual({ ok: true });
  });

  it("rejects unknown facts, foreign artifacts, and causal claims", () => {
    const fact = factWith({ id: "f1" });
    const facts = new Map([["f1", ev(fact)]]);
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
    const facts = new Map([["f1", ev(fact)]]);
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
        new Map([["f2", ev(flat)]]),
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
        new Map([["f2", ev(flat)]]),
        new Set(),
      ),
    ).toEqual({ ok: true });
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
        new Map([["f2", ev(flat)]]),
        new Set(),
      ),
    ).toEqual({ ok: true });
  });

  it("confines each observation to its own citations (swap)", () => {
    const events = factWith({ id: "f_events", label: "Accepted events" });
    const sessions = factWith({
      id: "f_sessions",
      metricId: "project.sessions",
      label: "Sessions",
      value: 60,
      formattedValue: "60",
      comparison: { kind: "percent", direction: "down", percent: 10 },
      comparisonBasis: {
        previousValue: 66,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const evidence = new Map([
      ["f_events", ev(events)],
      ["f_sessions", ev(sessions)],
    ]);
    // Swapped: sessions text citing the events fact fails on numbers.
    expect(
      validateGroundedAnswer(
        answerWith({
          observations: [
            { text: "Sessions fell to 60.", factIds: ["f_events"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
    // Correctly bound: each observation cites its own fact.
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Events rose to 120 while sessions fell to 60.",
          observations: [
            { text: "Accepted events rose to 120.", factIds: ["f_events"] },
            { text: "Sessions fell to 60.", factIds: ["f_sessions"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects same-number claims from a different metric", () => {
    const events = factWith({ id: "f_events", label: "Accepted events" });
    const sessions = factWith({
      id: "f_sessions",
      metricId: "project.sessions",
      label: "Sessions",
      value: 120,
      formattedValue: "120",
      comparison: { kind: "percent", direction: "flat", percent: 0 },
      comparisonBasis: {
        previousValue: 120,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const evidence = new Map([
      ["f_events", ev(events)],
      ["f_sessions", ev(sessions)],
    ]);
    // 120 coincides, but the flat sessions fact cannot support "rose".
    expect(
      validateGroundedAnswer(
        answerWith({
          observations: [
            { text: "Sessions rose to 120.", factIds: ["f_sessions"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("matches trend language to the cited comparison direction", () => {
    const up = factWith({ id: "f_up" });
    const down = factWith({
      id: "f_down",
      value: 80,
      formattedValue: "80",
      comparison: { kind: "percent", direction: "down", percent: 20 },
      comparisonBasis: {
        previousValue: 100,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const flat = factWith({
      id: "f_flat",
      value: 50,
      formattedValue: "50",
      comparison: { kind: "percent", direction: "flat", percent: 0 },
      comparisonBasis: {
        previousValue: 50,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const fresh = factWith({
      id: "f_new",
      value: 5,
      formattedValue: "5",
      comparison: { kind: "new" },
      comparisonBasis: {
        previousValue: 0,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const missing = factWith({
      id: "f_none",
      value: 7,
      formattedValue: "7",
      comparison: { kind: "no-prior-data" },
      comparisonBasis: {
        previousValue: null,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const evidence = new Map([
      ["f_up", ev(up)],
      ["f_down", ev(down)],
      ["f_flat", ev(flat)],
      ["f_new", ev(fresh)],
      ["f_none", ev(missing)],
    ]);
    // Opposite direction fails even though the number is cited.
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Trend check.",
          observations: [{ text: "Events fell to 120.", factIds: ["f_up"] }],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
    // Flat language needs a flat comparison.
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Trend check.",
          observations: [{ text: "Events held flat at 50.", factIds: ["f_flat"] }],
        }),
        evidence,
        new Set(),
      ),
    ).toEqual({ ok: true });
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Trend check.",
          observations: [{ text: "Events held flat at 120.", factIds: ["f_up"] }],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
    // New and no-prior-data ground no trend language at all.
    for (const [id, value] of [["f_new", 5], ["f_none", 7]] as const) {
      expect(
        validateGroundedAnswer(
          answerWith({
            summary: "Trend check.",
            observations: [
              { text: `Events rose to ${value}.`, factIds: [id] },
            ],
          }),
          evidence,
          new Set(),
        ),
      ).toMatchObject({ ok: false });
    }
  });

  it("derives summary claims from cited observations only", () => {
    const cited = factWith({ id: "f_cited" });
    const uncited = factWith({
      id: "f_uncited",
      metricId: "project.sessions",
      label: "Sessions",
      value: 999,
      formattedValue: "999",
      comparison: { kind: "percent", direction: "up", percent: 5 },
      comparisonBasis: {
        previousValue: 950,
        denominatorCurrent: null,
        denominatorPrevious: null,
      },
    });
    const evidence = new Map([
      ["f_cited", ev(cited)],
      ["f_uncited", ev(uncited)],
    ]);
    // 999 was measured but never cited by an observation: the summary
    // may not claim it.
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "Events rose to 120 and sessions hit 999.",
          observations: [
            { text: "Accepted events rose to 120.", factIds: ["f_cited"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("grounds non-metric evidence kinds without trend language", () => {
    const evidence = new Map<string, AssistantEvidenceFact>([
      [
        "errors:unresolved",
        {
          kind: "count",
          id: "errors:unresolved",
          label: "Unresolved issues",
          value: 3,
          unit: "issues",
        },
      ],
      [
        "issue:iss_1",
        {
          kind: "issue",
          id: "issue:iss_1",
          title: "TypeError in checkout",
          status: "unresolved",
          count: 42,
          users: 7,
          delta: "new",
        },
      ],
      [
        "mem_1",
        {
          kind: "definition",
          id: "mem_1",
          label: "Signup",
          state: "confirmed",
          reference: "sign_up",
        },
      ],
    ]);
    expect(
      validateGroundedAnswer(
        answerWith({
          summary: "3 unresolved issues, led by TypeError in checkout at 42 occurrences across 7 users. Signup means sign_up.",
          observations: [
            { text: "3 unresolved issues.", factIds: ["errors:unresolved"] },
            {
              text: "TypeError in checkout has 42 occurrences across 7 users.",
              factIds: ["issue:iss_1"],
            },
            { text: "Signup means sign_up.", factIds: ["mem_1"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toEqual({ ok: true });
    // Trend language about a count is never grounded (no comparison).
    expect(
      validateGroundedAnswer(
        answerWith({
          observations: [
            { text: "Unresolved issues rose to 3.", factIds: ["errors:unresolved"] },
          ],
        }),
        evidence,
        new Set(),
      ),
    ).toMatchObject({ ok: false });
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
      validateGroundedAnswer(answer, new Map([["fh", ev(fact)]]), new Set()),
    ).toMatchObject({ ok: false });
  });
});

describe("model configuration", () => {
  const baseEnv = {
    PRISM_AI_ENABLED: "1",
    OPENROUTER_API_KEY: "sk-test",
  };
  it("resolves the evaluated pinned default, fail-closed otherwise", () => {
    // Evaluation landed (evals/model-eval-gpt-5.6-luna-pro-v1.json):
    // the pinned default resolves with a key and in-cap prices, while
    // every other misconfiguration still fails closed. Unit tests
    // inject scripted models instead of calling production inference.
    const config = resolveAssistantModelConfig(baseEnv);
    expect(config.enabled).toBe(true);
    expect(config.model.id).toBe("openai/gpt-5.6-luna-pro");
    expect(config.model.evaluated).toBe(true);
    expect(config.requireZeroDataRetention).toBe(true);
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
  });

  it("shapes exact provider options with privacy routing", async () => {
    const { assistantCallProviderOptions, assistantProviderOptions } =
      await import("../utils/assistantModel");
    const options = assistantProviderOptions({
      maxPromptPricePerMillionMicroUsd: 1_000_000,
      maxCompletionPricePerMillionMicroUsd: 4_000_000,
      requireZeroDataRetention: true,
    } as never);
    expect(options).toEqual({
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        sort: "price",
        max_price: { prompt: 1, completion: 4 },
        zdr: true,
      },
    });
    // Explicit local-eval opt-out only; production must never set it.
    const relaxed = assistantProviderOptions({
      maxPromptPricePerMillionMicroUsd: 1_000_000,
      maxCompletionPricePerMillionMicroUsd: 4_000_000,
      requireZeroDataRetention: false,
    } as never);
    expect(relaxed.provider.zdr).toBe(false);
    expect(relaxed.provider.data_collection).toBe("deny");
    expect(assistantCallProviderOptions("user_1")).toEqual({
      openrouter: { user: "user_1" },
    });
    expect(assistantCallProviderOptions(undefined)).toBeUndefined();
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
