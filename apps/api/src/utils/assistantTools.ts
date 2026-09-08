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
  type AssistantEvidenceFact,
  type AuthorizedProjectContext,
  type MemoryRecord,
  type MetricFact,
  type MetricId,
  type ModelSummary,
  type ProjectCapabilities,
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
  /** Every ID advertised to the model resolves here, identically. */
  facts: Map<string, AssistantEvidenceFact>;
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
  return facts.map((fact) => {
    const comparison = fact.comparison;
    const comparisonText = !comparison
      ? "comparison unavailable"
      : comparison.kind === "percent"
        ? `${comparison.percent}% vs previous period (${comparison.direction})`
        : comparison.kind === "new"
          ? "new vs zero previous period"
          : "no prior data";
    const value = [fact.formattedValue, comparisonText, fact.coverageNote]
      .filter(Boolean)
      .join("; ");
    return {
      id: fact.id,
      label: fact.label,
      value: value.length > 200 ? `${value.slice(0, 199)}…` : value,
    };
  });
}

function collectOutcome(
  run: ToolRunScope,
  summary: ModelSummary,
  artifact: AssistantArtifact | undefined,
  evidence: readonly AssistantEvidenceFact[],
): ToolOutcome {
  // Artifact fact IDs must be unique (frozen consistency rule): bucket
  // rows share one canonical ID across windows, so dedupe in order.
  const seen = new Set<string>();
  const factIds: string[] = [];
  for (const record of evidence) {
    const id =
      record.kind === "metric" ? record.fact.id : record.id;
    if (!run.facts.has(id)) run.facts.set(id, record);
    if (!seen.has(id)) {
      seen.add(id);
      factIds.push(id);
    }
  }
  const artifactIds: string[] = [];
  if (artifact) {
    run.artifacts.set(artifact.id, artifact);
    artifactIds.push(artifact.id);
  }
  return { ok: true, result: { summary, artifact, factIds, artifactIds } };
}

/** Wrap canonical facts as metric evidence (identity preserved). */
function metricEvidence(
  facts: readonly MetricFact[],
): AssistantEvidenceFact[] {
  return facts.map((fact) => ({
    kind: "metric" as const,
    fact,
  }));
}

/**
 * Resolution proof (R17-F4.3): every ID a tool advertises — summary
 * items, result fact IDs, and artifact fact IDs — resolves to identical
 * run evidence. Violations are loud tool errors, never silent drops.
 */
export function verifyToolOutcome(
  run: ToolRunScope,
  outcome: ToolOutcome,
): ToolOutcome {
  if (!outcome.ok) return outcome;
  const missing = outcome.result.factIds.filter((id) => !run.facts.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      failure: {
        code: "tool-error",
        message: "Tool advertised unresolvable evidence",
      },
    };
  }
  for (const id of outcome.result.summary.factIds) {
    if (!run.facts.has(id)) {
      return {
        ok: false,
        failure: {
          code: "tool-error",
          message: "Tool summary cites unresolvable evidence",
        },
      };
    }
  }
  if (outcome.result.artifact) {
    for (const id of outcome.result.artifact.factIds) {
      if (!run.facts.has(id)) {
        return {
          ok: false,
          failure: {
            code: "tool-error",
            message: "Tool artifact cites unresolvable evidence",
          },
        };
      }
    }
  }
  return outcome;
}

function metricLabel(metricId: string): string {
  return METRIC_REGISTRY[metricId as MetricId]?.label ?? metricId;
}

function previousFactId(currentId: string): string {
  return `${currentId.slice(0, 100)}:previous`;
}

/**
 * Memoized tool dispatch (run-level memoization): identical tool calls
 * within one run reuse successful results. Schema parsing gives object
 * keys a stable order before keying; array order and scope stay intact.
 * Read failures may be retried, but proposal failures stay memoized since
 * a lost write acknowledgement does not prove the proposal was not saved.
 */
export async function executeToolCached(
  definitions: Record<string, ToolDefinitionEntry<unknown>>,
  deps: AssistantToolDeps,
  run: ToolRunScope,
  toolId: string,
  input: unknown,
): Promise<ToolOutcome> {
  const definition = definitions[toolId];
  if (!definition) {
    const failure: ToolOutcome = {
      ok: false,
      failure: { code: "invalid-input", message: `Unknown tool ${toolId}` },
    };
    return failure;
  }
  const parsed = definition.inputSchema.safeParse(input);
  if (!parsed.success) {
    const failure: ToolOutcome = {
      ok: false,
      failure: { code: "invalid-input", message: "Invalid tool input" },
    };
    return failure;
  }
  const key = `${toolId}:${JSON.stringify(parsed.data) ?? "null"}`;
  const hit = run.memo.get(key);
  if (hit) return hit;
  const outcome = await definition.execute(deps, parsed.data, run);
  if (
    outcome.ok ||
    outcome.failure.code !== "tool-error" ||
    toolId === "propose_definition"
  ) {
    run.memo.set(key, outcome);
  }
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
    const definitionEvidence = (
      id: string,
      label: string,
      state: "confirmed" | "proposed" | "standard-event" | "missing",
      reference: string,
    ): AssistantEvidenceFact => ({
      kind: "definition",
      id,
      label: label.slice(0, 160),
      state,
      reference: reference.slice(0, 200),
    });
    try {
      if (input.kind === "standard-event") {
        if (!(STANDARD_EVENT_KEYS as readonly string[]).includes(input.key)) {
          const missingId = `definition:missing:${input.key.slice(0, 64)}`;
          const summary = buildModelSummary([
            {
              id: missingId,
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
            [
              definitionEvidence(
                missingId,
                "Definition state",
                "missing",
                "missing",
              ),
            ],
          );
        }
        const knownId = `standard-event:${input.key}`;
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: knownId,
              label: "Standard event",
              value: `${input.key} is a known event key`,
            },
          ]),
          undefined,
          [definitionEvidence(knownId, "Standard event", "standard-event", input.key)],
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
        const missingId = `definition:missing:${input.key.slice(0, 64)}`;
        return collectOutcome(
          run,
          buildModelSummary([
            {
              id: missingId,
              label: "Definition state",
              value: "missing",
            },
          ]),
          undefined,
          [
            definitionEvidence(missingId, "Definition state", "missing", "missing"),
          ],
        );
      }
      const payload = record.value.payload as {
        name?: string;
        eventKey?: string;
        eventName?: string;
      };
      const display =
        payload.name ?? payload.eventKey ?? payload.eventName ?? record.key;
      const state =
        record.status === "confirmed" || record.status === "proposed"
          ? record.status
          : "proposed";
      const recordEvidence = definitionEvidence(
        record.id,
        record.value.label,
        state,
        display,
      );
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
            factIds: [record.id],
            queryContext: runWindowContext(deps),
            drilldown: { destination: "overview", label: "Overview" },
            proposalId: record.id,
            memoryKey: record.key,
            description: record.value.description.slice(0, 500),
            status: state,
          },
          [recordEvidence],
        );
      }
      return collectOutcome(run, summary, undefined, [recordEvidence]);
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
          metricEvidence(facts),
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
        metricEvidence(facts),
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
        metricEvidence([current, parsed.data]),
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
        metricEvidence(bucketFacts),
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
      const rows: Array<{
        key: string;
        label: string;
        value: number;
        fact: MetricFact;
      }> = [];
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
          rows.push({ key: value, label: value, value: fact.value, fact });
          rowFacts.push(fact);
        }
        if (rows.length >= ARTIFACT_LIMITS.maxBreakdownRows) break;
      }
      rows.sort((a, b) => b.value - a.value);
      const summary = buildModelSummary(
        rows.length > 0
          ? rows.map((row) => ({
              id: row.fact.id,
              label: `${row.label} ${metricLabel(request.metricId)}`,
              value: row.fact.formattedValue,
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
        metricEvidence(rowFacts),
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
              id: row.fact.id,
              label: row.label,
              value: row.fact.formattedValue,
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
        metricEvidence(rows.map((row) => row.fact)),
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
        const evidence: AssistantEvidenceFact[] = [
          {
            kind: "count",
            id: "errors:unresolved",
            label: "Unresolved issues",
            value: counts.unresolved,
            unit: "issues",
          },
          {
            kind: "count",
            id: "errors:fresh",
            label: "New issues",
            value: counts.fresh,
            unit: "issues",
          },
          {
            kind: "count",
            id: "errors:regressing",
            label: "Regressing issues",
            value: counts.regressing,
            unit: "issues",
          },
        ];
        const summary = buildModelSummary(
          evidence
            .filter((record) => record.kind === "count")
            .map((record) => ({
              id: record.id,
              label: record.label,
              value: String(record.value),
            })),
        );
        return collectOutcome(
          run,
          summary,
          {
            kind: "table",
            id: run.artifactSeq(),
            title: "Error health",
            summary: `${counts.unresolved} unresolved, ${counts.fresh} new, ${counts.regressing} regressing.`,
            factIds: ["errors:unresolved", "errors:fresh", "errors:regressing"],
            queryContext: context,
            drilldown: { destination: "errors", label: "Errors" },
            columns: ["State", "Count"],
            rows: [
              ["Unresolved", counts.unresolved],
              ["New", counts.fresh],
              ["Regressing", counts.regressing],
            ],
          },
          evidence,
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
      const evidence: AssistantEvidenceFact[] = issues.map((issue) => ({
        kind: "issue",
        id: `issue:${issue.id}`.slice(0, 128),
        title: issue.title.slice(0, 200),
        status: issue.status,
        count: issue.count,
        users: issue.users,
        delta: issue.delta,
      }));
      const summary = buildModelSummary(
        issues.map((issue) => ({
          id: `issue:${issue.id}`.slice(0, 128),
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
          factIds: issues.map((issue) =>
            `issue:${issue.id}`.slice(0, 128),
          ),
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
        evidence,
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
      const evidenceId = `issue:${issue.id}`.slice(0, 128);
      const evidence: AssistantEvidenceFact = {
        kind: "issue",
        id: evidenceId,
        title: issue.title.slice(0, 200),
        status: issue.status,
        count: issue.count,
        users: issue.users,
        delta: issue.delta,
      };
      const summary = buildModelSummary([
        {
          id: evidenceId,
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
          factIds: [evidenceId],
          queryContext: runWindowContext(deps),
          drilldown: {
            destination: "errors-issue",
            label: "Open issue",
            issueId: issue.id.slice(0, 128),
          },
          issues: [{ ...row }],
        },
        [evidence],
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
      const evidence: AssistantEvidenceFact[] = [
        {
          kind: "count",
          id: "coverage:sources",
          label: "Authorized sources",
          value: deps.authorized.allowedSourceIds.length,
          unit: "sources",
        },
        {
          kind: "count",
          id: "coverage:definitions",
          label: "Confirmed definitions",
          value: observed,
          unit: "definitions",
        },
      ];
      const summary = buildModelSummary(
        evidence
          .filter((record) => record.kind === "count")
          .map((record) => ({
            id: record.id,
            label: record.label,
            value: String(record.value),
          })),
      );
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
          factIds: ["coverage:sources", "coverage:definitions"],
          queryContext: runWindowContext(deps),
          drilldown: { destination: "sources", label: "Sources" },
          coverage: {
            sourcesConfigured: deps.authorized.allowedSourceIds.length,
            sourcesActive: deps.authorized.allowedSourceIds.length,
            enrichments: [],
            warnings: warnings.slice(0, 8),
          },
        },
        evidence,
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
      const evidence: AssistantEvidenceFact[] = selected
        .slice(0, 12)
        .map((entry) => {
          const payload = entry.value.payload as {
            name?: string;
            range?: string;
            eventKey?: string;
            eventName?: string;
          };
          const reference = (
            payload.name ??
            payload.range ??
            payload.eventKey ??
            payload.eventName ??
            entry.key
          ).slice(0, 200);
          return {
            kind: "definition" as const,
            id: entry.id,
            label: entry.value.label.slice(0, 160),
            // readKnowledge returns confirmed records only.
            state: "confirmed" as const,
            reference: reference.length > 0 ? reference : entry.key,
          };
        });
      return collectOutcome(run, summary, undefined, evidence);
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
      const evidence: AssistantEvidenceFact = {
        kind: "definition",
        id: record.id,
        label: record.value.label.slice(0, 160),
        state: "proposed",
        reference: record.value.label.slice(0, 200),
      };
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
          factIds: [record.id],
          queryContext: runWindowContext(deps),
          drilldown: { destination: "overview", label: "Overview" },
          proposalId: record.id,
          memoryKey: input.memoryKey,
          description: record.value.description.slice(0, 500),
          status: "proposed",
        },
        [evidence],
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

/** Run stage: definition flows unlock the proposal tool. */
export type AgentStage = "general" | "definition";

/**
 * Smallest eligible tool set (R17-F8): derived from server-owned
 * capabilities and stage only — never from model input. Error tools
 * require error collection; the proposal tool appears only in a
 * definition flow (v1 has no confirm tool, and any member may propose).
 * Measurement, knowledge, and coverage tools are always eligible and
 * fail safe on empty data.
 */
export function selectEligibleTools(input: {
  capabilities: ProjectCapabilities;
  stage: AgentStage;
}): ToolId[] {
  const eligible: ToolId[] = [
    "resolve_definition",
    "measure_metric",
    "compare_periods",
    "analyze_trend",
    "break_down_metric",
    "rank_entities",
    "check_coverage",
    "read_project_knowledge",
  ];
  if (input.capabilities.errorCollection.configured) {
    eligible.push("review_error_health", "inspect_issue");
  }
  if (input.stage === "definition") {
    eligible.push("propose_definition");
  }
  return eligible;
}

/** Exact input-field counts per tool (reviewable, no schema introspection). */
const TOOL_INPUT_FIELDS: Record<ToolId, number> = {
  resolve_definition: 2,
  measure_metric: 3,
  compare_periods: 3,
  analyze_trend: 4,
  break_down_metric: 4,
  rank_entities: 5,
  review_error_health: 3,
  inspect_issue: 1,
  check_coverage: 0,
  read_project_knowledge: 1,
  propose_definition: 5,
};

/** Server-owned planning guidance, aligned with the executable schemas. */
const TOOL_DESCRIPTIONS: Readonly<Record<ToolId, string>> = {
  resolve_definition:
    "Resolve a standard-event key, project-definition key (such as signup-definition), or business-term name before measuring an ambiguous concept. Returns its known, confirmed, proposed, or missing state; a proposal is not an active definition.",
  measure_metric:
    "Measure a known metricId for the run's fixed time window. Use only filters supported by that metric; omit sourceIds for all authorized sources. Returns exact facts, including available comparison and coverage context; use this for a single total, not a trend.",
  compare_periods:
    "Measure a known metricId in the current and previous run windows for an explicit period comparison. Requires a single-row result; select one currency for multi-currency revenue. Do not call merely to repeat comparison context already returned by measure_metric.",
  analyze_trend:
    "Measure a known metricId across 3–12 sequential time buckets in the run window (points defaults to 8). Use for a requested trend or change over time; each point requires a measurement, so use fewer points when sufficient. Does not discover causes.",
  break_down_metric:
    "Group a known metricId by os or platform only, returning measured groups and shares. The metric must support the requested dimension and its filter. Do not use for page, country, referrer, or arbitrary property breakdowns.",
  rank_entities:
    "Rank 1–10 supplied page or event candidates by a known metricId. Each candidate needs key, label, and value; value is an exact path for page or standardEventKey for event. Use only known candidates: this tool does not discover all pages or events, and ranks only those supplied.",
  review_error_health:
    "Review project error health. Set view to aggregates for unresolved, new, and regressing issue counts, or issues for an issue list. Optional platform and release filters apply to the issues view only. Use returned issue IDs for inspect_issue.",
  inspect_issue:
    "Read one authorized issue by a known issueId, normally returned by review_error_health. Returns its sanitized title, status, occurrence count, affected users, and delta; does not provide a stack trace or establish root cause.",
  check_coverage:
    "Check counts of authorized sources and confirmed definitions with no input fields. Use when source visibility or missing setup matters; this is not event discovery and does not measure ingestion health, active traffic, or enrichment completeness.",
  read_project_knowledge:
    "Read confirmed typed knowledge in project, workspace, member, or all scopes (default all). Use for relevant stored definitions or preferences missing from the supplied context; do not reread unchanged knowledge already available.",
  propose_definition:
    "Create a proposed signup-definition, activation-definition, or key-outcome-definition using a label, description, and eventKey or eventName. Only for a requested definition proposal. Requires human confirmation in the UI; never confirms or activates it. Do not retry an uncertain write.",
};

export function toolDescription(toolId: ToolId): string {
  return TOOL_DESCRIPTIONS[toolId];
}

/**
 * Estimated input-token weight of sending tool schemas to the provider:
 * identifier plus frozen description plus a per-field allowance. The
 * agent subtracts this from the context budget so the eligible-set
 * optimization is measurable rather than cosmetic.
 */
export function toolSchemaChars(toolIds: readonly ToolId[]): number {
  return toolIds.reduce(
    (sum, id) =>
      sum +
      id.length +
      toolDescription(id).length +
      TOOL_INPUT_FIELDS[id] * 24,
    0,
  );
}

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
