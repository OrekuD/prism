/**
 * Prism agent tool registry (Task 21 slice 5).
 *
 * Eleven read-only tools (plus one proposal tool that can never confirm)
 * expose the canonical metric service, error health, and typed memory to
 * the agent loop. Every tool obeys the same boundary:
 * - exact Zod input schemas (unknown metrics, unsupported filters, and
 *   unbounded lists fail before any query),
 * - NO model-supplied provenance: project, organization, and user come
 *   from the run's frozen `AuthorizedProjectContext`; only `sourceIds`
 *   narrow within the cached allow-list (`requireScope`),
 * - measurement goes through the injected run-bound `measure` (wired to
 *   `measureForAuthorizedContext`, R11-F1), so cross-tenant attach is
 *   structurally impossible,
 * - analytics executes sequentially with run-level memoization (the
 *   libSQL layer forbids concurrent reads),
 * - results split into two typed channels: compact `ModelSummary` facts
 *   for model context and full `AssistantArtifact` widgets for the UI —
 *   full artifacts never enter model messages (proven by test),
 * - failures are typed `ToolFailure` results (tool-error,
 *   invalid-input, not-found, forbidden), never thrown provider state.
 */
import {
  ARTIFACT_LIMITS,
  buildModelSummary,
  compareValues,
  DEFINITION_VERSION,
  formatToolLabel,
  METRIC_REGISTRY,
  MetricFactSchema,
  PublicQueryContextSchema,
  STANDARD_EVENT_KEYS,
  TOOL_REGISTRY,
  type AssistantArtifact,
  type AuthorizedProjectContext,
  type MemoryRecord,
  type MetricFact,
  type MetricId,
  type ModelSummary,
  type PublicQueryContext,
  type ToolId,
} from "@prism-analytics/types";
import { z } from "zod";
import type { AuthorizationCache } from "./assistantAuthCache";
import { AssistantAuthError } from "./assistantAuthCache";
import type { ConfirmedKnowledge } from "./assistantStore";
import type {
  MeasurementEnvelope,
  MetricFilters,
  MetricRequest,
  MetricScope,
  MetricWindow,
} from "./projectMetrics";
import { MetricQueryError } from "./projectMetrics";

export class AssistantToolError extends Error {
  readonly code: "tool-error" | "invalid-input" | "not-found" | "forbidden";
  constructor(code: AssistantToolError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export type ToolResult = {
  summary: ModelSummary;
  /** Full UI widget; never serialized into model messages. */
  artifact?: AssistantArtifact;
  factIds: string[];
  artifactIds: string[];
};

export type ToolFailure = {
  code: AssistantToolError["code"];
  /** Display-safe message (no raw provider internals). */
  message: string;
};

export type ToolOutcome =
  | { ok: true; result: ToolResult }
  | { ok: false; failure: ToolFailure };

/** Server-owned dependencies injected per run (all IDs verified). */
export type AssistantToolDeps = {
  authorized: AuthorizedProjectContext;
  window: MetricWindow;
  authCache: AuthorizationCache;
  /** Run-bound measurement (authorized context + snapshot window fixed). */
  measure: (
    requests: MetricRequest[],
    scope?: MetricScope,
  ) => Promise<MeasurementEnvelope>;
  /** Previous-window measurement for honest comparison facts. */
  measurePrevious: (requests: MetricRequest[]) => Promise<MeasurementEnvelope>;
  /** Arbitrary-window measurement (trend buckets share the run snapshot). */
  measureWindow: (
    window: MetricWindow,
    requests: MetricRequest[],
    scope?: MetricScope,
  ) => Promise<MeasurementEnvelope>;
  readKnowledge: () => Promise<ConfirmedKnowledge>;
  listMemoryRecords: (filters: {
    scope?: "project" | "workspace" | null;
    key?: string | null;
    status?: "proposed" | "confirmed" | null;
  }) => Promise<MemoryRecord[]>;
  proposeKnowledge: (input: {
    scope: "project" | "workspace";
    key: "signup-definition" | "activation-definition" | "key-outcome-definition";
    projectId: string | null;
    value: {
      version: number;
      label: string;
      description: string;
      payload: unknown;
    };
  }) => Promise<MemoryRecord>;
  /** Run member proposing (server-owned, never model input). */
  proposerId: string;
  listIssues: (filter: {
    status?: "unresolved" | "resolved" | "ignored";
    platform?: "web" | "ios" | "android" | "react-native" | "server";
    release?: string;
  }) => Promise<
    Array<{
      id: string;
      title: string;
      status: "unresolved" | "resolved" | "ignored";
      count: number;
      users: number;
      delta: "new" | "regressing" | "declining" | null;
    }>
  >;
  getIssue: (
    issueId: string,
  ) => Promise<{
    id: string;
    title: string;
    status: "unresolved" | "resolved" | "ignored";
    count: number;
    users: number;
    delta: "new" | "regressing" | "declining" | null;
  } | null>;
  errorAggregates: () => Promise<{
    unresolved: number;
    fresh: number;
    regressing: number;
  }>;
};

export type ToolRunScope = {
  memo: Map<string, ToolOutcome>;
  artifactSeq: () => string;
  facts: Map<string, MetricFact>;
  artifacts: Map<string, AssistantArtifact>;
};

export type ToolExecutor<TInput> = (
  deps: AssistantToolDeps,
  input: TInput,
  run: ToolRunScope,
) => Promise<ToolOutcome>;

/* ------------------------------------------------------------------ */
/* Shared input shapes (exact, bounded)                                */
/* ------------------------------------------------------------------ */

const ToolFiltersSchema = z.strictObject({
  standardEventKey: z.string().min(1).max(128).optional(),
  traffic: z.enum(["human", "all"]).optional(),
  os: z.enum(["ios", "android"]).optional(),
  release: z.string().min(1).max(128).optional(),
  host: z.string().min(1).max(253).optional(),
  path: z.string().min(1).max(2048).optional(),
  platform: z
    .enum(["web", "ios", "android", "react-native", "server"])
    .optional(),
  environment: z.string().min(1).max(64).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code")
    .optional(),
});

const SourceIdsSchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .optional();

const MetricQueryInputSchema = z.strictObject({
  metricId: z.string().min(1).max(128),
  filters: ToolFiltersSchema.optional(),
  sourceIds: SourceIdsSchema,
});

type MetricQueryInput = z.infer<typeof MetricQueryInputSchema>;

/* ------------------------------------------------------------------ */
/* Shared execution helpers                                            */
/* ------------------------------------------------------------------ */

function toFailure(error: unknown): ToolFailure {
  if (error instanceof AssistantToolError) {
    return { code: error.code, message: error.message.slice(0, 280) };
  }
  if (error instanceof AssistantAuthError) {
    return { code: error.code, message: error.message.slice(0, 280) };
  }
  if (error instanceof MetricQueryError) {
    if (error.code === "unknown-metric" || error.code === "missing-filter") {
      return { code: "invalid-input", message: error.message.slice(0, 280) };
    }
    return { code: "tool-error", message: error.message.slice(0, 280) };
  }
  return {
    code: "tool-error",
    message: "The measurement failed. Try a narrower question.",
  };
}

function parseMetricQuery(input: MetricQueryInput): {
  request: MetricRequest;
  scope: MetricScope;
} {
  const parsed = MetricQueryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AssistantToolError("invalid-input", "Invalid metric query");
  }
  const scope: MetricScope =
    parsed.data.sourceIds === undefined
      ? { sourceScope: "all", sourceIds: [] }
      : { sourceScope: "selected", sourceIds: [...parsed.data.sourceIds] };
  return {
    request: {
      metricId: parsed.data.metricId,
      filters: { ...(parsed.data.filters ?? {}) } as MetricFilters,
    },
    scope,
  };
}

async function requireToolScope(
  deps: AssistantToolDeps,
  sourceIds: readonly string[] | undefined,
): Promise<void> {
  await deps.authCache.requireScope(
    {
      userId: deps.authorized.userId,
      organizationId: deps.authorized.organizationId,
      projectId: deps.authorized.projectId,
    },
    { sourceIds },
  );
}

function requireKnownMetric(request: MetricRequest): void {
  if (!METRIC_REGISTRY[request.metricId as MetricId]) {
    throw new AssistantToolError(
      "invalid-input",
      `Unknown metric: ${request.metricId.slice(0, 64)}`,
    );
  }
}

async function scopedMeasure(
  deps: AssistantToolDeps,
  input: MetricQueryInput,
): Promise<MeasurementEnvelope> {
  const { request, scope } = parseMetricQuery(input);
  requireKnownMetric(request);
  await requireToolScope(deps, scope.sourceIds);
  return deps.measure([request], scope);
}

/** Run-window public context for non-measurement artifacts. */
function runWindowContext(deps: AssistantToolDeps): PublicQueryContext {
  const parsed = PublicQueryContextSchema.safeParse({
    from: deps.window.from,
    to: deps.window.to,
    compareFrom: deps.window.compareFrom,
    compareTo: deps.window.compareTo,
    asOf: deps.window.asOf,
    timezone: "UTC",
    sourceScope: "all",
    sourceIds: [],
    definitionVersion: DEFINITION_VERSION,
  });
  if (!parsed.success) {
    throw new AssistantToolError("tool-error", "Run window failed validation");
  }
  return parsed.data;
}

function factSummaryItems(facts: readonly MetricFact[]): Array<{
  id: string;
  label: string;
  value: string;
}> {
  return facts.map((fact) => ({
    id: fact.id,
    label: fact.label,
    value: fact.formattedValue,
  }));
}

function collectOutcome(
  run: ToolRunScope,
  summary: ModelSummary,
  artifact: AssistantArtifact | undefined,
  facts: readonly MetricFact[],
): ToolOutcome {
  // Artifact fact IDs must be unique (frozen consistency rule): bucket
  // rows share one canonical ID across windows, so dedupe in order.
  const seen = new Set<string>();
  const factIds: string[] = [];
  for (const fact of facts) {
    if (!run.facts.has(fact.id)) run.facts.set(fact.id, fact);
    if (!seen.has(fact.id)) {
      seen.add(fact.id);
      factIds.push(fact.id);
    }
  }
  const artifactIds: string[] = [];
  if (artifact) {
    run.artifacts.set(artifact.id, artifact);
    artifactIds.push(artifact.id);
  }
  return { ok: true, result: { summary, artifact, factIds, artifactIds } };
}

function metricLabel(metricId: string): string {
  return METRIC_REGISTRY[metricId as MetricId]?.label ?? metricId;
}

function previousFactId(currentId: string): string {
  return `${currentId.slice(0, 100)}:previous`;
}

/**
 * Memoized tool dispatch (run-level memoization): identical tool calls
 * within one run execute once. The key covers the tool ID plus the exact
 * input JSON — no timestamps, no random fields.
 */
export async function executeToolCached(
  definitions: Record<string, ToolDefinitionEntry<unknown>>,
  deps: AssistantToolDeps,
  run: ToolRunScope,
  toolId: string,
  input: unknown,
): Promise<ToolOutcome> {
  const key = `${toolId}:${JSON.stringify(input) ?? "null"}`;
  const hit = run.memo.get(key);
  if (hit) return hit;
  const definition = definitions[toolId];
  if (!definition) {
    const failure: ToolOutcome = {
      ok: false,
      failure: { code: "invalid-input", message: `Unknown tool ${toolId}` },
    };
    run.memo.set(key, failure);
    return failure;
  }
  const parsed = definition.inputSchema.safeParse(input);
  if (!parsed.success) {
    const failure: ToolOutcome = {
      ok: false,
      failure: { code: "invalid-input", message: "Invalid tool input" },
    };
    run.memo.set(key, failure);
    return failure;
  }
  const outcome = await definition.execute(deps, parsed.data, run);
  run.memo.set(key, outcome);
  return outcome;
}

/* ------------------------------------------------------------------ */
/* Tool definitions: schema + executor per TOOL_IDS entry              */
/* ------------------------------------------------------------------ */

export type ToolDefinitionEntry<TInput> = {
  id: ToolId;
  inputSchema: z.ZodType<TInput>;
  execute(
    deps: AssistantToolDeps,
    input: TInput,
    run: ToolRunScope,
  ): Promise<ToolOutcome>;
};

const resolveDefinition: ToolDefinitionEntry<{
  kind: "standard-event" | "project-definition" | "business-term";
  key: string;
}> = {
  id: "resolve_definition",
  inputSchema: z.strictObject({
    kind: z.enum(["standard-event", "project-definition", "business-term"]),
    key: z.string().min(1).max(120),
  }),
  execute: async (deps, input, run) => {
    try {
      if (input.kind === "standard-event") {
        if (!(STANDARD_EVENT_KEYS as readonly string[]).includes(input.key)) {
          const summary = buildModelSummary([
            {
              id: `definition:missing:${input.key.slice(0, 64)}`,
              label: "Definition state",
              value: "missing",
            },
          ]);
          return collectOutcome(
            run,
            summary,
            {
              kind: "unavailable",
              id: run.artifactSeq(),
              title: "Unknown event",
              summary: `No Standard Event named ${input.key.slice(0, 64)} exists.`,
              factIds: [],
              queryContext: runWindowContext(deps),
              drilldown: { destination: "overview", label: "Overview" },
              reason: `No Standard Event named ${input.key.slice(0, 64)} exists.`,
              nextAction: "Ask about an observed event from coverage.",
            },
            [],
          );
        }
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: `standard-event:${input.key}`,
              label: "Standard event",
              value: `${input.key} is a known event key`,
            },
          ]),
          undefined,
          [],
        );
      }
      const records = await deps.listMemoryRecords({
        scope: input.kind === "business-term" ? null : "project",
        key: null,
        status: null,
      });
      const candidates = records.filter((entry) =>
        input.kind === "business-term"
          ? entry.scope !== "member"
          : entry.scope === "project",
      );
      const exact = candidates.find((entry) => {
        const name = (entry.value.payload as { name?: unknown }).name;
        return typeof name === "string"
          ? name === input.key
          : entry.key === input.key;
      });
      const record =
        exact ??
        candidates.find((entry) => {
          const name = (entry.value.payload as { name?: unknown }).name;
          return (
            typeof name === "string" &&
            name.toLowerCase() === input.key.toLowerCase()
          );
        });
      if (!record) {
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: `definition:missing:${input.key.slice(0, 64)}`,
              label: "Definition state",
              value: "missing",
            },
          ]),
          undefined,
          [],
        );
      }
      const payload = record.value.payload as {
        name?: string;
        eventKey?: string;
        eventName?: string;
      };
      const display =
        payload.name ?? payload.eventKey ?? payload.eventName ?? record.key;
      const summary = buildModelSummary([
        {
          id: record.id,
          label: record.value.label,
          value: `${record.value.description} (${display}, ${record.status})`.slice(
            0,
            200,
          ),
        },
      ]);
      if (
        record.key === "signup-definition" ||
        record.key === "activation-definition" ||
        record.key === "key-outcome-definition"
      ) {
        return collectOutcome(
          run,
          summary,
          {
            kind: "definition",
            id: run.artifactSeq(),
            title: record.value.label.slice(0, 140),
            summary: record.value.description.slice(0, 500),
            factIds: [],
            queryContext: runWindowContext(deps),
            drilldown: { destination: "overview", label: "Overview" },
            proposalId: record.id,
            memoryKey: record.key,
            description: record.value.description.slice(0, 500),
            status:
              record.status === "confirmed" || record.status === "proposed"
                ? record.status
                : "proposed",
          },
          [],
        );
      }
      return collectOutcome(run, summary, undefined, []);
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const measureMetric: ToolDefinitionEntry<MetricQueryInput> = {
  id: "measure_metric",
  inputSchema: MetricQueryInputSchema,
  execute: async (deps, input, run) => {
    try {
      const envelope = await scopedMeasure(deps, input);
      const facts = envelope.facts;
      if (facts.length === 0) {
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: "empty:measure",
              label: metricLabel(input.metricId),
              value: "no data in range",
            },
          ]),
          {
            kind: "empty",
            id: run.artifactSeq(),
            title: metricLabel(input.metricId).slice(0, 140),
            summary: "No data in range.",
            factIds: [],
            queryContext: envelope.queryContext,
            drilldown: { destination: "overview", label: "Overview" },
            reason: "No data in range.",
          },
          [],
        );
      }
      const summary = buildModelSummary(factSummaryItems(facts));
      const label = metricLabel(input.metricId);
      if (facts.length === 1 && facts[0]) {
        const fact = facts[0];
        return collectOutcome(
          run,
          summary,
          {
            kind: "metric",
            id: run.artifactSeq(),
            title: label.slice(0, 140),
            summary: `${fact.label}: ${fact.formattedValue}`.slice(0, 500),
            factIds: [fact.id],
            queryContext: fact.queryContext,
            drilldown: fact.drilldown,
            fact,
          },
          facts,
        );
      }
      return collectOutcome(
        run,
        summary,
        {
          kind: "table",
          id: run.artifactSeq(),
          title: label.slice(0, 140),
          summary: `${facts.length} values by currency.`.slice(0, 500),
          factIds: facts.map((fact) => fact.id).slice(0, 16),
          queryContext: envelope.queryContext,
          drilldown: facts[0]?.drilldown ?? {
            destination: "overview",
            label: "Overview",
          },
          columns: [label.slice(0, 80), "Value"],
          rows: facts.slice(0, ARTIFACT_LIMITS.maxTableRows).map((fact) => [
            String(
              (fact.filters as { currency?: unknown }).currency ??
                fact.id.slice(-8),
            ).slice(0, 80),
            fact.formattedValue,
          ]),
        },
        facts,
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const comparePeriods: ToolDefinitionEntry<MetricQueryInput> = {
  id: "compare_periods",
  inputSchema: MetricQueryInputSchema,
  execute: async (deps, input, run) => {
    try {
      const envelope = await scopedMeasure(deps, input);
      if (envelope.facts.length !== 1 || !envelope.facts[0]) {
        return {
          ok: false,
          failure: {
            code: "invalid-input",
            message: "Period comparison needs a single-row metric",
          },
        };
      }
      const current = envelope.facts[0];
      const { request } = parseMetricQuery(input);
      const previousEnvelope = await deps.measurePrevious([request]);
      const measured = previousEnvelope.facts.find(
        (fact) => fact.metricId === current.metricId,
      );
      if (!measured) {
        return {
          ok: false,
          failure: {
            code: "tool-error",
            message: "The previous period returned no measurement",
          },
        };
      }
      // Honest previous fact: exact measured previous-window values,
      // re-based onto the run snapshot context the artifact schema
      // requires (same asOf snapshot; only the range role differs, which
      // the label documents). Values and denominators are measured,
      // never estimated.
      const previous: MetricFact = {
        ...measured,
        id: previousFactId(current.id),
        queryContext: current.queryContext,
        label: `${measured.label} (previous period)`.slice(0, 160),
        comparison: compareValues(
          measured.value ?? 0,
          measured.comparisonBasis.previousValue,
        ),
      };
      const parsed = MetricFactSchema.safeParse(previous);
      if (!parsed.success) {
        return {
          ok: false,
          failure: {
            code: "tool-error",
            message: "The previous period could not form a valid fact",
          },
        };
      }
      const summary = buildModelSummary([
        {
          id: current.id,
          label: current.label,
          value: `${current.formattedValue} (was ${parsed.data.formattedValue})`,
        },
      ]);
      return collectOutcome(
        run,
        summary,
        {
          kind: "comparison",
          id: run.artifactSeq(),
          title: `${current.label} vs previous`.slice(0, 140),
          summary:
            `${current.label}: ${current.formattedValue} (was ${parsed.data.formattedValue}).`.slice(
              0,
              500,
            ),
          factIds: [current.id, parsed.data.id],
          queryContext: current.queryContext,
          drilldown: current.drilldown,
          current,
          previous: parsed.data,
        },
        [current, parsed.data],
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const analyzeTrend: ToolDefinitionEntry<
  MetricQueryInput & { points?: number }
> = {
  id: "analyze_trend",
  inputSchema: MetricQueryInputSchema.extend({
    points: z.number().int().min(3).max(12).optional(),
  }),
  execute: async (deps, input, run) => {
    try {
      const pointCount = input.points ?? 8;
      const { request, scope } = parseMetricQuery({
        metricId: input.metricId,
        filters: input.filters,
        sourceIds: input.sourceIds,
      });
      requireKnownMetric(request);
      await requireToolScope(deps, scope.sourceIds);
      const span = deps.window.to - deps.window.from;
      if (!Number.isFinite(span) || span <= 0) {
        throw new AssistantToolError("invalid-input", "Run window is empty");
      }
      const bucket = Math.max(1, Math.floor(span / pointCount));
      const points: Array<{ t: number; value: number }> = [];
      const bucketFacts: MetricFact[] = [];
      // Sequential execution: one analytics read at a time, every bucket
      // sharing the run snapshot (asOf) so the series is one snapshot.
      for (let index = 0; index < pointCount; index += 1) {
        const from = deps.window.from + index * bucket;
        const to = index + 1 === pointCount ? deps.window.to : from + bucket;
        const size = to - from;
        const envelope = await deps.measureWindow(
          {
            from,
            to,
            compareFrom: from - size,
            compareTo: from,
            asOf: deps.window.asOf,
          },
          [request],
          scope,
        );
        const fact = envelope.facts[0];
        if (fact && fact.value !== null && Number.isFinite(fact.value)) {
          points.push({ t: from, value: fact.value });
          bucketFacts.push(fact);
          if (points.length >= ARTIFACT_LIMITS.maxSeriesPoints) break;
        }
      }
      if (points.length === 0) {
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: "empty:trend",
              label: metricLabel(input.metricId),
              value: "no data in range",
            },
          ]),
          {
            kind: "empty",
            id: run.artifactSeq(),
            title: metricLabel(input.metricId).slice(0, 140),
            summary: "No data in range.",
            factIds: [],
            queryContext: runWindowContext(deps),
            drilldown: { destination: "overview", label: "Overview" },
            reason: "No data in range.",
          },
          [],
        );
      }
      const values = points.map((point) => point.value);
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      let largestStep = 0;
      for (let index = 1; index < values.length; index += 1) {
        largestStep = Math.max(
          largestStep,
          Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0)),
        );
      }
      const summary = buildModelSummary([
        {
          id: bucketFacts[0]?.id ?? "trend:first",
          label: metricLabel(input.metricId),
          value: `first ${first}, last ${last}, largest step ${largestStep} over ${points.length} buckets`,
        },
      ]);
      const context = bucketFacts[0]?.queryContext ?? runWindowContext(deps);
      return collectOutcome(
        run,
        summary,
        {
          kind: "timeseries",
          id: run.artifactSeq(),
          title: `${metricLabel(input.metricId)} trend`.slice(0, 140),
          summary: `${points.length} buckets from first ${first} to last ${last}.`.slice(
            0,
            500,
          ),
          factIds: bucketFacts.map((fact) => fact.id).slice(0, 16),
          queryContext: context,
          drilldown: bucketFacts[0]?.drilldown ?? {
            destination: "overview",
            label: "Overview",
          },
          bucket: span <= 2 * 86_400_000 ? "hourly" : "daily",
          series: [
            { name: metricLabel(input.metricId).slice(0, 80), points },
          ],
        },
        bucketFacts,
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

/** v1 breakdown dimensions: bounded enums with a filter twin each. */
const BREAKDOWN_DIMENSIONS = {
  os: { filter: "os", values: ["ios", "android"] },
  platform: {
    filter: "platform",
    values: ["web", "ios", "android", "react-native", "server"],
  },
} as const;

const breakDownMetric: ToolDefinitionEntry<
  MetricQueryInput & { dimension: "os" | "platform" }
> = {
  id: "break_down_metric",
  inputSchema: MetricQueryInputSchema.extend({
    dimension: z.enum(["os", "platform"]),
  }),
  execute: async (deps, input, run) => {
    try {
      const { request, scope } = parseMetricQuery({
        metricId: input.metricId,
        filters: input.filters,
        sourceIds: input.sourceIds,
      });
      requireKnownMetric(request);
      await requireToolScope(deps, scope.sourceIds);
      const mapping = BREAKDOWN_DIMENSIONS[input.dimension];
      const definition = METRIC_REGISTRY[request.metricId as MetricId];
      if (!definition) {
        throw new AssistantToolError("invalid-input", "Unknown metric");
      }
      if (
        !definition.supportedDimensions.includes(input.dimension) ||
        !definition.supportedFilters.includes(
          mapping.filter as (typeof definition.supportedFilters)[number],
        )
      ) {
        throw new AssistantToolError(
          "invalid-input",
          `Metric ${request.metricId} cannot break down by ${input.dimension}`,
        );
      }
      const totalEnvelope = await deps.measure([request], scope);
      const total = totalEnvelope.facts[0]?.value ?? null;
      const rows: Array<{ key: string; label: string; value: number }> = [];
      const rowFacts: MetricFact[] = [...totalEnvelope.facts];
      for (const value of mapping.values) {
        const envelope = await deps.measure(
          [
            {
              metricId: request.metricId,
              filters: { ...request.filters, [mapping.filter]: value },
            },
          ],
          scope,
        );
        const fact = envelope.facts[0];
        if (fact && fact.value !== null && Number.isFinite(fact.value)) {
          rows.push({ key: value, label: value, value: fact.value });
          rowFacts.push(fact);
        }
        if (rows.length >= ARTIFACT_LIMITS.maxBreakdownRows) break;
      }
      rows.sort((a, b) => b.value - a.value);
      const summary = buildModelSummary(
        rows.length > 0
          ? rows.map((row) => ({
              id: `breakdown:${input.dimension}:${row.key}`,
              label: row.label,
              value: String(row.value),
            }))
          : [
              {
                id: "empty:breakdown",
                label: metricLabel(request.metricId),
                value: "no data in range",
              },
            ],
      );
      const context =
        totalEnvelope.facts[0]?.queryContext ?? runWindowContext(deps);
      return collectOutcome(
        run,
        summary,
        {
          kind: "breakdown",
          id: run.artifactSeq(),
          title:
            `${metricLabel(request.metricId)} by ${input.dimension}`.slice(
              0,
              140,
            ),
          summary: `${rows.length} groups by ${input.dimension}.`.slice(0, 500),
          factIds: rowFacts.map((fact) => fact.id).slice(0, 16),
          queryContext: context,
          drilldown: totalEnvelope.facts[0]?.drilldown ?? {
            destination: "overview",
            label: "Overview",
          },
          metricId: request.metricId as MetricId,
          total: total ?? 0,
          rows: rows.map((row) => ({
            key: row.key.slice(0, 160),
            label: row.label.slice(0, 160),
            value: row.value,
            sharePercent:
              total !== null && total !== 0 && Number.isFinite(total)
                ? Math.round((row.value / total) * 1000) / 10
                : null,
          })),
        },
        rowFacts,
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const rankEntities: ToolDefinitionEntry<{
  metricId: string;
  entity: "page" | "event";
  candidates: Array<{ key: string; label: string; value: string }>;
  filters?: MetricQueryInput["filters"];
  sourceIds?: string[];
}> = {
  id: "rank_entities",
  inputSchema: z.strictObject({
    metricId: z.string().min(1).max(128),
    entity: z.enum(["page", "event"]),
    candidates: z
      .array(
        z.strictObject({
          key: z.string().min(1).max(200),
          label: z.string().min(1).max(200),
          value: z.string().min(1).max(2048),
        }),
      )
      .min(1)
      .max(10),
    filters: ToolFiltersSchema.optional(),
    sourceIds: SourceIdsSchema,
  }),
  execute: async (deps, input, run) => {
    try {
      const { request, scope } = parseMetricQuery({
        metricId: input.metricId,
        filters: input.filters,
        sourceIds: input.sourceIds,
      });
      requireKnownMetric(request);
      await requireToolScope(deps, scope.sourceIds);
      const filterKey = input.entity === "page" ? "path" : "standardEventKey";
      const rows: Array<{
        key: string;
        label: string;
        value: number;
        fact: MetricFact;
      }> = [];
      for (const candidate of input.candidates) {
        const envelope = await deps.measure(
          [
            {
              metricId: request.metricId,
              filters: { ...request.filters, [filterKey]: candidate.value },
            },
          ],
          scope,
        );
        const fact = envelope.facts[0];
        if (fact && fact.value !== null && Number.isFinite(fact.value)) {
          rows.push({
            key: candidate.key.slice(0, 200),
            label: candidate.label.slice(0, 200),
            value: fact.value,
            fact,
          });
        }
        if (rows.length >= ARTIFACT_LIMITS.maxRankRows) break;
      }
      rows.sort((a, b) => b.value - a.value);
      const summary = buildModelSummary(
        rows.length > 0
          ? rows.map((row) => ({
              id: `rank:${input.entity}:${row.key}`,
              label: row.label,
              value: String(row.value),
            }))
          : [
              {
                id: "empty:rank",
                label: metricLabel(request.metricId),
                value: "no data in range",
              },
            ],
      );
      const context = rows[0]?.fact.queryContext ?? runWindowContext(deps);
      return collectOutcome(
        run,
        summary,
        {
          kind: "ranked-list",
          id: run.artifactSeq(),
          title: `Top ${input.entity}s by ${metricLabel(request.metricId)}`.slice(
            0,
            140,
          ),
          summary: `${rows.length} ranked ${input.entity}s.`.slice(0, 500),
          factIds: rows.map((row) => row.fact.id).slice(0, 16),
          queryContext: context,
          drilldown: rows[0]?.fact.drilldown ?? {
            destination: "overview",
            label: "Overview",
          },
          entity: input.entity,
          rows: rows.map((row) => ({
            key: row.key,
            label: row.label,
            value: row.value,
            sharePercent: null,
          })),
        },
        rows.map((row) => row.fact),
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const reviewErrorHealth: ToolDefinitionEntry<{
  view: "aggregates" | "issues";
  platform?: "web" | "ios" | "android" | "react-native" | "server";
  release?: string;
}> = {
  id: "review_error_health",
  inputSchema: z.strictObject({
    view: z.enum(["aggregates", "issues"]),
    platform: z
      .enum(["web", "ios", "android", "react-native", "server"])
      .optional(),
    release: z.string().min(1).max(128).optional(),
  }),
  execute: async (deps, input, run) => {
    try {
      await requireToolScope(deps, undefined);
      const context = runWindowContext(deps);
      if (input.view === "aggregates") {
        const counts = await deps.errorAggregates();
        const summary = buildModelSummary([
          {
            id: "errors:unresolved",
            label: "Unresolved issues",
            value: String(counts.unresolved),
          },
          {
            id: "errors:fresh",
            label: "New issues",
            value: String(counts.fresh),
          },
          {
            id: "errors:regressing",
            label: "Regressing issues",
            value: String(counts.regressing),
          },
        ]);
        return collectOutcome(
          run,
          summary,
          {
            kind: "table",
            id: run.artifactSeq(),
            title: "Error health",
            summary: `${counts.unresolved} unresolved, ${counts.fresh} new, ${counts.regressing} regressing.`,
            factIds: [],
            queryContext: context,
            drilldown: { destination: "errors", label: "Errors" },
            columns: ["State", "Count"],
            rows: [
              ["Unresolved", counts.unresolved],
              ["New", counts.fresh],
              ["Regressing", counts.regressing],
            ],
          },
          [],
        );
      }
      const issues = (
        await deps.listIssues({
          ...(input.platform ? { platform: input.platform } : {}),
          ...(input.release ? { release: input.release } : {}),
        })
      ).slice(0, ARTIFACT_LIMITS.maxRankRows);
      if (issues.length === 0) {
        return collectOutcome(
          run,
          buildModelSummary([
            { id: "empty:issues", label: "Error issues", value: "none found" },
          ]),
          {
            kind: "empty",
            id: run.artifactSeq(),
            title: "Error issues",
            summary: "No issues match.",
            factIds: [],
            queryContext: context,
            drilldown: { destination: "errors", label: "Errors" },
            reason: "No issues match.",
          },
          [],
        );
      }
      const summary = buildModelSummary(
        issues.map((issue) => ({
          id: `issue:${issue.id}`,
          label: issue.title.slice(0, 160),
          value: `${issue.count} occurrences`,
        })),
      );
      return collectOutcome(
        run,
        summary,
        {
          kind: "issue-list",
          id: run.artifactSeq(),
          title: "Error issues",
          summary: `${issues.length} issues by occurrences.`,
          factIds: [],
          queryContext: context,
          drilldown: { destination: "errors", label: "Errors" },
          issues: issues.map((issue) => ({
            id: issue.id.slice(0, 128),
            title: issue.title.slice(0, 200),
            status: issue.status,
            count: issue.count,
            users: issue.users,
            delta: issue.delta,
            drilldown: {
              destination: "errors-issue",
              label: "Open issue",
              issueId: issue.id.slice(0, 128),
            },
          })),
        },
        [],
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const inspectIssue: ToolDefinitionEntry<{ issueId: string }> = {
  id: "inspect_issue",
  inputSchema: z.strictObject({
    issueId: z.string().min(1).max(128),
  }),
  execute: async (deps, input, run) => {
    try {
      await requireToolScope(deps, undefined);
      const issue = await deps.getIssue(input.issueId);
      if (!issue) {
        return {
          ok: false,
          failure: { code: "not-found", message: "Issue not found" },
        };
      }
      const summary = buildModelSummary([
        {
          id: `issue:${issue.id}`,
          label: issue.title.slice(0, 160),
          value: `${issue.count} occurrences, ${issue.users} users, ${issue.status}`,
        },
      ]);
      const row = {
        id: issue.id.slice(0, 128),
        title: issue.title.slice(0, 200),
        status: issue.status,
        count: issue.count,
        users: issue.users,
        delta: issue.delta,
        drilldown: {
          destination: "errors-issue",
          label: "Open issue",
          issueId: issue.id.slice(0, 128),
        },
      } as const;
      return collectOutcome(
        run,
        summary,
        {
          kind: "issue-list",
          id: run.artifactSeq(),
          title: issue.title.slice(0, 140),
          summary: `${issue.count} occurrences across ${issue.users} users.`,
          factIds: [],
          queryContext: runWindowContext(deps),
          drilldown: {
            destination: "errors-issue",
            label: "Open issue",
            issueId: issue.id.slice(0, 128),
          },
          issues: [{ ...row }],
        },
        [],
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const checkCoverage: ToolDefinitionEntry<Record<string, never>> = {
  id: "check_coverage",
  inputSchema: z.strictObject({}),
  execute: async (deps, _input, run) => {
    try {
      await requireToolScope(deps, undefined);
      const knowledge = await deps.readKnowledge();
      const warnings: string[] = [];
      if (deps.authorized.allowedSourceIds.length === 0) {
        warnings.push("No sources are visible to this run.");
      }
      const observed = knowledge.workspace.length + knowledge.project.length;
      if (observed === 0) {
        warnings.push("No confirmed definitions back this project yet.");
      }
      const summary = buildModelSummary([
        {
          id: "coverage:sources",
          label: "Authorized sources",
          value: String(deps.authorized.allowedSourceIds.length),
        },
        {
          id: "coverage:definitions",
          label: "Confirmed definitions",
          value: String(observed),
        },
      ]);
      return collectOutcome(
        run,
        summary,
        {
          kind: "coverage",
          id: run.artifactSeq(),
          title: "Data coverage",
          summary:
            `${deps.authorized.allowedSourceIds.length} sources, ${observed} confirmed definitions.`.slice(
              0,
              500,
            ),
          factIds: [],
          queryContext: runWindowContext(deps),
          drilldown: { destination: "sources", label: "Sources" },
          coverage: {
            sourcesConfigured: deps.authorized.allowedSourceIds.length,
            sourcesActive: deps.authorized.allowedSourceIds.length,
            enrichments: [],
            warnings: warnings.slice(0, 8),
          },
        },
        [],
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const readProjectKnowledge: ToolDefinitionEntry<{
  scope?: "project" | "workspace" | "member" | "all";
}> = {
  id: "read_project_knowledge",
  inputSchema: z.strictObject({
    scope: z.enum(["project", "workspace", "member", "all"]).optional(),
  }),
  execute: async (deps, input, run) => {
    try {
      await requireToolScope(deps, undefined);
      const knowledge = await deps.readKnowledge();
      const scope = input.scope ?? "all";
      const selected =
        scope === "all"
          ? [...knowledge.project, ...knowledge.workspace, ...knowledge.member]
          : knowledge[scope];
      if (selected.length === 0) {
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: "knowledge:empty",
              label: "Project knowledge",
              value: "none confirmed",
            },
          ]),
          undefined,
          [],
        );
      }
      const summary = buildModelSummary(
        selected.slice(0, 12).map((entry) => {
          const payload = entry.value.payload as {
            name?: string;
            range?: string;
            kind?: string;
            eventKey?: string;
            eventName?: string;
          };
          const gist =
            payload.name ??
            payload.range ??
            payload.eventKey ??
            payload.eventName ??
            entry.key;
          return {
            id: entry.id,
            label: entry.value.label,
            value: `${entry.value.description} (${gist})`.slice(0, 200),
          };
        }),
      );
      return collectOutcome(run, summary, undefined, []);
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

const proposeDefinition: ToolDefinitionEntry<{
  memoryKey: "signup-definition" | "activation-definition" | "key-outcome-definition";
  label: string;
  description: string;
  eventKey?: string;
  eventName?: string;
}> = {
  id: "propose_definition",
  inputSchema: z.strictObject({
    memoryKey: z.enum([
      "signup-definition",
      "activation-definition",
      "key-outcome-definition",
    ]),
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(500),
    eventKey: z.string().min(1).max(128).optional(),
    eventName: z.string().min(1).max(120).optional(),
  }),
  execute: async (deps, input, run) => {
    try {
      await requireToolScope(deps, undefined);
      const payload =
        input.eventKey !== undefined
          ? { kind: "standard-event", eventKey: input.eventKey }
          : input.eventName !== undefined
            ? { kind: "custom-event", eventName: input.eventName }
            : null;
      if (!payload) {
        return {
          ok: false,
          failure: {
            code: "invalid-input",
            message: "A proposal needs an eventKey or eventName",
          },
        };
      }
      const record = await deps.proposeKnowledge({
        scope: "project",
        key: input.memoryKey,
        projectId: deps.authorized.projectId,
        value: {
          version: 1,
          label: input.label,
          description: input.description,
          payload,
        },
      });
      const summary = buildModelSummary([
        {
          id: record.id,
          label: record.value.label,
          value: "proposed, awaiting confirmation",
        },
      ]);
      return collectOutcome(
        run,
        summary,
        {
          kind: "definition",
          id: run.artifactSeq(),
          title: record.value.label.slice(0, 140),
          summary:
            `${record.value.description} (proposed, awaiting confirmation).`.slice(
              0,
              500,
            ),
          factIds: [],
          queryContext: runWindowContext(deps),
          drilldown: { destination: "overview", label: "Overview" },
          proposalId: record.id,
          memoryKey: input.memoryKey,
          description: record.value.description.slice(0, 500),
          status: "proposed",
        },
        [],
      );
    } catch (error) {
      return { ok: false, failure: toFailure(error) };
    }
  },
};

export const ASSISTANT_TOOL_DEFINITIONS = {
  resolve_definition: resolveDefinition,
  measure_metric: measureMetric,
  compare_periods: comparePeriods,
  analyze_trend: analyzeTrend,
  break_down_metric: breakDownMetric,
  rank_entities: rankEntities,
  review_error_health: reviewErrorHealth,
  inspect_issue: inspectIssue,
  check_coverage: checkCoverage,
  read_project_knowledge: readProjectKnowledge,
  propose_definition: proposeDefinition,
} as const;

export function toolActivityLabel(
  toolId: ToolId,
  metricLabel?: string,
): string {
  const template = TOOL_REGISTRY[toolId].presentation.activeLabel;
  return formatToolLabel(template, metricLabel ?? "the metric");
}

export function createToolRunScope(): ToolRunScope {
  let seq = 0;
  return {
    memo: new Map(),
    artifactSeq: () => {
      seq += 1;
      return `art_${seq}`;
    },
    facts: new Map(),
    artifacts: new Map(),
  };
}
