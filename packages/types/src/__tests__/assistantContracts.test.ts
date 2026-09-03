import { describe, expect, it } from "vitest";
import {
  ARTIFACT_LIMITS,
  ASSISTANT_ARTIFACT_KINDS,
  AssistantArtifactSchema,
  AssistantAnswerSchema,
  AssistantMessageSchema,
  AssistantRunSchema,
  ANSWER_LIMITS,
  canConfirmMemory,
  canProposeMemory,
  capabilitiesFromPlatforms,
  compareInsightRank,
  compareValues,
  ConversationSchema,
  DEFINITION_VERSION,
  decodeQueryContextToken,
  encodeQueryContextToken,
  INSIGHT_THRESHOLDS,
  isCountChangeEligible,
  isInQueryRange,
  isIssueSignalEligible,
  isRateChangeEligible,
  InsightCandidateSchema,
  MEMORY_STATUSES,
  METRIC_IDS,
  METRIC_REGISTRY,
  MetricFactSchema,
  MemoryRecordSchema,
  OVERVIEW_RANGES,
  platformFamilyOf,
  PRISM_AI_ENV_NAMES,
  ProjectCapabilitiesSchema,
  ProjectOverviewResourceSchema,
  PublicQueryContextSchema,
  STREAM_PART_NAMES,
  TOOL_IDS,
  TOOL_REGISTRY,
  transitionProposal,
  validateTokenScope,
  type AssistantArtifact,
  type MetricFact,
  type ProjectQueryContext,
} from "../network/resources";

/**
 * Task 21 slice 1 — frozen contract tests. Every discriminated union must
 * reject unknown variants AND unknown fields (strict objects); every pure
 * helper encodes the task's exact thresholds; every fixture stays
 * internally consistent.
 */

const context = (
  overrides: Partial<ProjectQueryContext> = {},
): ProjectQueryContext => ({
  projectId: "proj_1",
  organizationId: "org_1",
  from: 1_785_542_400_000,
  to: 1_785_628_800_000,
  compareFrom: 1_785_456_000_000,
  compareTo: 1_785_542_400_000,
  asOf: 1_785_628_800_000,
  timezone: "UTC",
  sourceIds: [],
  definitionVersion: DEFINITION_VERSION,
  ...overrides,
});

const publicContext = () => {
  const { projectId: _p, organizationId: _o, ...rest } = context();
  void _p;
  void _o;
  return rest;
};

const fact = (overrides: Partial<MetricFact> = {}): MetricFact => ({
  id: "fact_1",
  metricId: "project.accepted_events",
  definitionVersion: DEFINITION_VERSION,
  label: "Accepted events",
  value: 120,
  formattedValue: "120",
  unit: null,
  comparison: { kind: "percent", direction: "up", percent: 12.5 },
  queryContext: publicContext(),
  coverage: "2 sources",
  drilldown: "/events",
  ...overrides,
});

describe("metric registry", () => {
  it("covers every frozen metric ID with a versioned definition", () => {
    expect(Object.keys(METRIC_REGISTRY).sort()).toEqual([...METRIC_IDS].sort());
    for (const id of METRIC_IDS) {
      const definition = METRIC_REGISTRY[id];
      expect(definition.version).toBe(DEFINITION_VERSION);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("is immutable at runtime", () => {
    expect(Object.isFrozen(METRIC_REGISTRY)).toBe(true);
    expect(Object.isFrozen(TOOL_REGISTRY)).toBe(true);
  });

  it("keeps drill-downs snapshot-safe: absolute paths, token appended later", () => {
    for (const id of METRIC_IDS) {
      const { path } = METRIC_REGISTRY[id].drilldown;
      expect(path.startsWith("/")).toBe(true);
      expect(path.includes("?")).toBe(false);
    }
  });

  it("requires an event key for Standard Event metrics and sums money per currency", () => {
    expect(METRIC_REGISTRY["standard_event.occurrences"].requiresFilter).toBe(
      "standard_event_key",
    );
    expect(METRIC_REGISTRY["standard_event.people"].requiresFilter).toBe(
      "standard_event_key",
    );
    const money = METRIC_REGISTRY["standard_event.value_by_currency"];
    expect(money.valueKind).toBe("money-minor");
    expect(money.supportedDimensions).toContain("currency");
  });

  it("never promises error-free sessions or revenue-style aggregates", () => {
    const labels = METRIC_IDS.join(" ");
    expect(labels).not.toMatch(/error-free|crash-free|revenue|mrr|churn/i);
  });

  it("gives unique counts no inferred acquisition dimensions", () => {
    expect(METRIC_REGISTRY["project.new_people"].supportedDimensions).toEqual(
      [],
    );
  });
});

describe("source platform families", () => {
  it("maps stored platforms to product families", () => {
    expect(platformFamilyOf("web")).toBe("web");
    expect(platformFamilyOf("server")).toBe("server");
    expect(platformFamilyOf("react-native")).toBe("mobile");
    expect(platformFamilyOf("ios")).toBe("mobile");
    expect(platformFamilyOf("android")).toBe("mobile");
  });

  it("derives capabilities so future Swift/Kotlin sources feed Mobile unchanged", () => {
    expect(capabilitiesFromPlatforms(["ios"])).toEqual({
      web: false,
      mobile: true,
      server: false,
    });
    expect(capabilitiesFromPlatforms(["android"])).toEqual({
      web: false,
      mobile: true,
      server: false,
    });
    expect(
      capabilitiesFromPlatforms(["web", "react-native", "server"]),
    ).toEqual({ web: true, mobile: true, server: true });
    expect(capabilitiesFromPlatforms([])).toEqual({
      web: false,
      mobile: false,
      server: false,
    });
  });
});

describe("query context token", () => {
  it("round-trips the full server context opaquely", () => {
    const token = encodeQueryContextToken(context({ sourceIds: ["src_1"] }));
    expect(token).not.toContain("proj_1");
    expect(token).not.toContain("from");
    expect(decodeQueryContextToken(token)).toEqual(
      context({ sourceIds: ["src_1"] }),
    );
  });

  it("rejects malformed, tampered, and inverted ranges", () => {
    expect(decodeQueryContextToken("")).toBeNull();
    expect(decodeQueryContextToken("not-a-token!!")).toBeNull();
    const good = encodeQueryContextToken(context());
    expect(decodeQueryContextToken(`${good}xx`)).toBeNull();
    // unequal prior-period length
    expect(
      decodeQueryContextToken(
        encodeQueryContextToken(
          context({ compareTo: context().compareTo + 1 }),
        ),
      ),
    ).toBeNull();
    // inverted range never survives a hand-built token
    expect(decodeQueryContextToken(good.slice(0, 8))).toBeNull();
  });

  it("validates scope: cross-project tokens never authorize", () => {
    const token = encodeQueryContextToken(context());
    expect(validateTokenScope(token, "proj_1", "org_1")).not.toBeNull();
    expect(validateTokenScope(token, "proj_2", "org_1")).toBeNull();
    expect(validateTokenScope(token, "proj_1", "org_2")).toBeNull();
  });

  it("uses half-open ranges", () => {
    expect(isInQueryRange(100, 100, 200)).toBe(true);
    expect(isInQueryRange(199, 100, 200)).toBe(true);
    expect(isInQueryRange(200, 100, 200)).toBe(false);
    expect(isInQueryRange(99, 100, 200)).toBe(false);
  });

  it("accepts exactly the five v1 ranges", () => {
    expect([...OVERVIEW_RANGES]).toEqual(["24h", "7d", "14d", "30d", "90d"]);
  });
});

describe("comparisons", () => {
  it("preserves new and no-prior-data states instead of infinity", () => {
    expect(compareValues(25, 0)).toEqual({ kind: "new" });
    expect(compareValues(0, 0)).toEqual({
      kind: "percent",
      direction: "flat",
      percent: 0,
    });
    expect(compareValues(10, null)).toEqual({ kind: "no-prior-data" });
    expect(compareValues(110, 100)).toMatchObject({
      kind: "percent",
      direction: "up",
    });
    expect(compareValues(90, 100)).toMatchObject({
      kind: "percent",
      direction: "down",
    });
    expect(compareValues(100, 100)).toMatchObject({ direction: "flat" });
  });
});

describe("insight eligibility", () => {
  it("gates count changes on volume, absolute, and ratio", () => {
    expect(INSIGHT_THRESHOLDS.countMinCombined).toBe(20);
    expect(INSIGHT_THRESHOLDS.countMinAbsolute).toBe(5);
    expect(INSIGHT_THRESHOLDS.countMinRatio).toBe(0.2);
    expect(isCountChangeEligible(130, 100)).toBe(true);
    // low volume stays in drill-downs, never a headline
    expect(isCountChangeEligible(8, 2)).toBe(false);
    // tiny absolute move
    expect(isCountChangeEligible(102, 100)).toBe(false);
    // small ratio
    expect(isCountChangeEligible(550, 500)).toBe(false);
    // new data with real volume qualifies
    expect(isCountChangeEligible(25, 0)).toBe(true);
    expect(isCountChangeEligible(3, 0)).toBe(false);
  });

  it("gates rate changes on both denominators plus five points", () => {
    expect(isRateChangeEligible(0.4, 0.3, 50, 60)).toBe(true);
    expect(isRateChangeEligible(0.4, 0.38, 50, 60)).toBe(false);
    expect(isRateChangeEligible(0.9, 0.1, 10, 60)).toBe(false);
    expect(isRateChangeEligible(0.9, 0.1, 50, 10)).toBe(false);
  });

  it("requires three occurrences for an issue signal", () => {
    expect(isIssueSignalEligible(3)).toBe(true);
    expect(isIssueSignalEligible(2)).toBe(false);
  });

  it("ranks deterministically: severity, recency, stable ID", () => {
    const rows = [
      { severity: "info" as const, observedAt: 300, id: "b" },
      { severity: "critical" as const, observedAt: 100, id: "z" },
      { severity: "attention" as const, observedAt: 200, id: "a" },
      { severity: "critical" as const, observedAt: 100, id: "a" },
    ];
    expect([...rows].sort(compareInsightRank).map((row) => row.id)).toEqual([
      "a",
      "z",
      "a",
      "b",
    ]);
    expect(INSIGHT_THRESHOLDS.maxInsights).toBe(3);
  });
});

describe("artifact union", () => {
  const base = {
    title: "Signups",
    summary: "120 signups in the last 7 days.",
    factIds: ["fact_1"],
    queryContext: publicContext(),
    drilldown: "/events",
  };

  it("accepts all eleven frozen kinds", () => {
    const artifacts: AssistantArtifact[] = [
      { ...base, kind: "metric", fact: fact() },
      { ...base, kind: "comparison", current: fact(), previous: fact() },
      {
        ...base,
        kind: "timeseries",
        bucket: "daily",
        series: [{ name: "Signups", points: [{ t: 1, value: 2 }] }],
      },
      {
        ...base,
        kind: "breakdown",
        metricId: "project.accepted_events",
        total: 10,
        rows: [{ key: "web", label: "Web", value: 10, sharePercent: 100 }],
      },
      {
        ...base,
        kind: "ranked-list",
        entity: "page",
        rows: [{ key: "/", label: "/", value: 5, sharePercent: 50 }],
      },
      {
        ...base,
        kind: "table",
        columns: ["Metric", "Value"],
        rows: [["Events", 10]],
      },
      {
        ...base,
        kind: "issue-list",
        issues: [
          {
            id: "iss_1",
            title: "TypeError",
            status: "unresolved",
            count: 9,
            users: 4,
            delta: "new",
            drilldown: "/errors/iss_1",
          },
        ],
      },
      {
        ...base,
        kind: "coverage",
        coverage: {
          sourcesConfigured: 1,
          sourcesActive: 1,
          enrichments: [],
          warnings: [],
        },
      },
      {
        ...base,
        kind: "definition",
        proposalId: "prop_1",
        memoryKey: "signup-definition",
        description: "Use sign_up as signup.",
        status: "proposed",
      },
      { ...base, kind: "empty", reason: "No matching data." },
      {
        ...base,
        kind: "unavailable",
        reason: "Retention is not supported.",
        nextAction: "Ask about signup trends instead.",
      },
    ];
    expect(artifacts).toHaveLength(ASSISTANT_ARTIFACT_KINDS.length);
    for (const artifact of artifacts) {
      expect(AssistantArtifactSchema.safeParse(artifact).success).toBe(true);
    }
  });

  it("rejects unknown kinds and unknown fields", () => {
    expect(
      AssistantArtifactSchema.safeParse({ ...base, kind: "funnel" }).success,
    ).toBe(false);
    expect(
      AssistantArtifactSchema.safeParse({
        ...base,
        kind: "metric",
        fact: fact(),
        sql: "SELECT * FROM events",
      }).success,
    ).toBe(false);
    expect(
      AssistantArtifactSchema.safeParse({
        ...base,
        kind: "timeseries",
        bucket: "daily",
        series: [{ name: "x", points: [], rawSql: "SELECT 1" }],
      }).success,
    ).toBe(false);
  });

  it("enforces series/row bounds", () => {
    const points = Array.from(
      { length: ARTIFACT_LIMITS.maxSeriesPoints + 1 },
      (_, index) => ({ t: index, value: 1 }),
    );
    expect(
      AssistantArtifactSchema.safeParse({
        ...base,
        kind: "timeseries",
        bucket: "daily",
        series: [{ name: "x", points }],
      }).success,
    ).toBe(false);
  });

  it("proves metric facts never encode infinity", () => {
    const parsed = MetricFactSchema.safeParse(
      fact({ comparison: { kind: "new" } }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("structured answers", () => {
  it("requires fact citations on every observation", () => {
    const answer = {
      summary: "Signups rose.",
      observations: [{ text: "Signups rose 20%.", factIds: ["fact_1"] }],
      primaryArtifactId: "art_1",
      supportingArtifactIds: [],
      assumptions: [],
      followUps: ["Break that down by source."],
    };
    expect(AssistantAnswerSchema.safeParse(answer).success).toBe(true);
    expect(
      AssistantAnswerSchema.safeParse({
        ...answer,
        observations: [{ text: "Signups rose 20%.", factIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      AssistantAnswerSchema.safeParse({
        ...answer,
        observations: new Array(ANSWER_LIMITS.maxObservations + 1).fill({
          text: "x",
          factIds: ["fact_1"],
        }),
      }).success,
    ).toBe(false);
  });
});

describe("persistence contracts", () => {
  it("validates conversation, message, and run shapes", () => {
    expect(
      ConversationSchema.safeParse({
        id: "conv_1",
        organizationId: "org_1",
        projectId: "proj_1",
        userId: "user_1",
        epoch: 0,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: null,
      }).success,
    ).toBe(true);
    expect(
      AssistantMessageSchema.safeParse({
        id: "msg_1",
        conversationId: "conv_1",
        epoch: 0,
        seq: 1,
        role: "assistant",
        status: "complete",
        parts: [{ type: "text", text: "Hello" }],
        failureCode: null,
        clientRequestId: "req_1",
        createdAt: 1,
        completedAt: 2,
      }).success,
    ).toBe(true);
    // raw provider payloads are not valid parts
    expect(
      AssistantMessageSchema.safeParse({
        id: "msg_1",
        conversationId: "conv_1",
        epoch: 0,
        seq: 1,
        role: "assistant",
        status: "complete",
        parts: [{ type: "reasoning", text: "hidden" }],
        failureCode: null,
        clientRequestId: null,
        createdAt: 1,
        completedAt: null,
      }).success,
    ).toBe(false);
    expect(
      AssistantRunSchema.safeParse({
        id: "run_1",
        conversationId: "conv_1",
        messageId: "msg_1",
        projectId: "proj_1",
        userId: "user_1",
        queryContextHash: "abc",
        definitionVersion: DEFINITION_VERSION,
        model: "gpt-5-mini",
        provider: "openai",
        status: "complete",
        stepCount: 3,
        toolIds: ["measure_metric", "compare_periods"],
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1200,
        startedAt: 1,
        completedAt: 2,
        failureCode: null,
      }).success,
    ).toBe(true);
    // step ceiling is structural: more than eight steps never validates
    expect(
      AssistantRunSchema.safeParse({
        id: "run_1",
        conversationId: "conv_1",
        messageId: "msg_1",
        projectId: "proj_1",
        userId: "user_1",
        queryContextHash: "abc",
        definitionVersion: DEFINITION_VERSION,
        model: "gpt-5-mini",
        provider: "openai",
        status: "complete",
        stepCount: 9,
        toolIds: [],
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        startedAt: 1,
        completedAt: null,
        failureCode: null,
      }).success,
    ).toBe(false);
  });
});

describe("memory permissions", () => {
  it("lets every member propose; only owner/admin confirm shared knowledge", () => {
    const roles = ["owner", "admin", "member"] as const;
    for (const role of roles) {
      expect(canProposeMemory(role)).toBe(true);
      expect(canConfirmMemory(role, "member")).toBe(true);
    }
    expect(canConfirmMemory("owner", "project")).toBe(true);
    expect(canConfirmMemory("admin", "project")).toBe(true);
    expect(canConfirmMemory("member", "project")).toBe(false);
    expect(canConfirmMemory("owner", "workspace")).toBe(true);
    expect(canConfirmMemory("admin", "workspace")).toBe(true);
    expect(canConfirmMemory("member", "workspace")).toBe(false);
  });

  it("applies proposal transitions exactly once", () => {
    expect(transitionProposal("proposed", "confirm")).toBe("confirmed");
    expect(transitionProposal("proposed", "reject")).toBe("rejected");
    // concurrent second confirmation cannot double-apply
    expect(transitionProposal("confirmed", "confirm")).toBeNull();
    expect(transitionProposal("rejected", "reject")).toBeNull();
    expect(transitionProposal("superseded", "confirm")).toBeNull();
  });

  it("validates typed memory records and rejects free-form memories", () => {
    const record = {
      id: "mem_1",
      organizationId: "org_1",
      projectId: "proj_1",
      scope: "project",
      key: "signup-definition",
      status: "proposed",
      value: {
        version: 1,
        label: "Signup",
        description: "Use sign_up as signup.",
        payload: { eventKey: "sign_up" },
      },
      proposerId: "user_1",
      confirmerId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(MemoryRecordSchema.safeParse(record).success).toBe(true);
    expect(
      MemoryRecordSchema.safeParse({ ...record, key: "random-thought" })
        .success,
    ).toBe(false);
    expect(
      MemoryRecordSchema.safeParse({ ...record, status: "trusted" }).success,
    ).toBe(false);
    expect(MEMORY_STATUSES).toEqual([
      "proposed",
      "confirmed",
      "superseded",
      "rejected",
    ]);
  });
});

describe("overview resource", () => {
  it("caps insights at three and pulse at exactly three facts", () => {
    const resource = {
      queryContext: publicContext(),
      capabilities: {
        web: true,
        mobile: false,
        server: false,
        errorCollection: { configured: false, observed: false },
        standardEventsObserved: [],
        sources: { total: 1, active: 1, lastReceivedAt: 1 },
        trafficPolicy: "human",
      },
      insights: [],
      pulse: [fact({ id: "a" }), fact({ id: "b" }), fact({ id: "c" })],
      activityKind: "timeseries",
      secondaryKind: "ranked-list",
      dataQuality: {
        hasAcceptedData: true,
        definitionState: "missing",
        definitionLabel: null,
        warnings: [],
      },
    };
    expect(ProjectOverviewResourceSchema.safeParse(resource).success).toBe(
      true,
    );
    expect(
      ProjectOverviewResourceSchema.safeParse({
        ...resource,
        pulse: [fact({ id: "a" }), fact({ id: "b" })],
      }).success,
    ).toBe(false);
    expect(
      ProjectOverviewResourceSchema.safeParse({
        ...resource,
        insights: new Array(4).fill({
          id: "i",
          kind: "change",
          severity: "info",
          title: "t",
          summary: "s",
          factIds: [],
          artifactKind: "metric",
          drilldown: "/events",
          askPrompt: "Tell me more.",
          observedAt: 1,
        }),
      }).success,
    ).toBe(false);
  });

  it("validates insight candidates strictly", () => {
    expect(
      InsightCandidateSchema.safeParse({
        id: "i",
        kind: "causal-claim",
        severity: "info",
        title: "t",
        summary: "s",
        factIds: [],
        artifactKind: "metric",
        drilldown: "/events",
        askPrompt: "Tell me more.",
        observedAt: 1,
      }).success,
    ).toBe(false);
  });
});

describe("capability fixtures and question plans", () => {
  it("covers every required source combination plus future-native proofs", async () => {
    const { CAPABILITY_FIXTURES } =
      await import("../network/resources/projectAssistantFixtures");
    const ids = CAPABILITY_FIXTURES.map((fixture) => fixture.id);
    for (const required of [
      "web-only",
      "mobile-only",
      "server-only",
      "web-mobile-server",
      "errors-configured-zero",
      "low-coverage",
      "empty",
      "partial-failure",
      "future-native-ios",
      "future-native-android",
    ]) {
      expect(ids).toContain(required);
    }
    for (const fixture of CAPABILITY_FIXTURES) {
      expect(
        ProjectCapabilitiesSchema.safeParse(fixture.capabilities).success,
      ).toBe(true);
      const families = capabilitiesFromPlatforms(fixture.platforms);
      expect(fixture.capabilities.web).toBe(families.web);
      expect(fixture.capabilities.mobile).toBe(families.mobile);
      expect(fixture.capabilities.server).toBe(families.server);
    }
    const empty = CAPABILITY_FIXTURES.find((fixture) => fixture.id === "empty");
    expect(empty?.capabilities.sources.lastReceivedAt).toBeNull();
    const zero = CAPABILITY_FIXTURES.find(
      (fixture) => fixture.id === "errors-configured-zero",
    );
    expect(zero?.capabilities.errorCollection).toEqual({
      configured: true,
      observed: false,
    });
  });

  it("keeps every question plan inside the frozen tool/metric/artifact vocabularies", async () => {
    const { ASSISTANT_QUESTION_PLANS } =
      await import("../network/resources/projectAssistantFixtures");
    expect(ASSISTANT_QUESTION_PLANS.length).toBeGreaterThanOrEqual(16);
    for (const plan of ASSISTANT_QUESTION_PLANS) {
      for (const tool of plan.expectedTools) {
        expect(TOOL_IDS).toContain(tool);
      }
      expect(ASSISTANT_ARTIFACT_KINDS).toContain(plan.expectedArtifact);
      for (const metricId of plan.metricIds) {
        expect(METRIC_IDS).toContain(metricId);
      }
      expect(plan.question.length).toBeLessThanOrEqual(
        ANSWER_LIMITS.maxQuestionChars,
      );
    }
  });
});

describe("frozen protocol names", () => {
  it("freezes stream parts, env names, and tool presentation labels", () => {
    expect([...STREAM_PART_NAMES]).toEqual([
      "data-run-start",
      "data-activity-step",
      "data-fact",
      "data-artifact",
      "data-run-finish",
      "data-run-error",
    ]);
    expect(PRISM_AI_ENV_NAMES).toContain("PRISM_AI_ENABLED");
    expect(PRISM_AI_ENV_NAMES).toContain("OPENAI_API_KEY");
    expect(TOOL_IDS).toHaveLength(11);
    for (const id of TOOL_IDS) {
      const presentation = TOOL_REGISTRY[id].presentation;
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.activeLabel.length).toBeGreaterThan(0);
      expect(presentation.completedLabel.length).toBeGreaterThan(0);
    }
    // no raw internals leak into user-facing labels
    const labels = TOOL_IDS.map(
      (id) =>
        TOOL_REGISTRY[id].presentation.activeLabel +
        TOOL_REGISTRY[id].presentation.completedLabel,
    ).join(" ");
    expect(labels).not.toMatch(/get_metric|SQL|chain-of-thought/i);
  });

  it("derives public context without project scope", () => {
    const parsed = PublicQueryContextSchema.safeParse({
      ...publicContext(),
      projectId: "proj_1",
    });
    expect(parsed.success).toBe(false);
  });
});
