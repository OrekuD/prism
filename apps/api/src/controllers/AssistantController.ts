/**
 * Authorized streaming assistant API (Task 21 slice 6).
 *
 * Project-scoped routes under the authenticated Projects router:
 * - GET    /:slug/assistant/conversations (cursor-paginated, owner-scoped)
 * - POST   /:slug/assistant/conversations (lazy create + first stream)
 * - GET    /:slug/assistant/conversations/:conversationSlug
 * - DELETE /:slug/assistant/conversations/:conversationSlug
 * - POST   /:slug/assistant/conversations/:conversationSlug/messages
 * - GET    /:slug/assistant/memory
 * - POST   /:slug/assistant/memory/:proposalId/confirm
 * - POST   /:slug/assistant/memory/:proposalId/reject
 *
 * Streaming uses server-sent events: each `data:` frame is one validated
 * `AssistantStreamPart` (data-run-start, data-activity-step, data-fact,
 * data-artifact, data-run-finish / data-run-error) plus plain
 * `{type:"text",text}` prose frames. The client tolerates reconnect,
 * cancellation, provider failure before the first token, tool failure
 * after partial activity, and refresh after persistence — a partial
 * answer is never persisted as complete.
 *
 * Authorization boundary (controller-owned, never model-owned):
 * - every route requires a signed-in, verified project member;
 * - conversation reads/writes additionally require ownership by the
 *   current user AND the route project (non-disclosing 404 otherwise);
 * - memory confirm/reject re-checks membership fresh and requires
 *   owner/admin for shared scopes (member prefs need no confirmation);
 * - the query-context token is verified server-side after membership;
 *   project/org/user IDs are server-injected into every tool call.
 *
 * Disabled AI (missing key, unevaluated model, PRISM_AI_ENABLED!=1)
 * keeps the deterministic overview functional and streams a single
 * `data-run-error` with code `disabled` — never a raw provider error.
 */
import type { Context } from "hono";
import { z } from "zod";
import {
  ANSWER_LIMITS,
  AssistantAnswerSchema,
  AssistantStreamPartSchema,
  ConversationCreateSchema,
  DEFINITION_VERSION,
  type AssistantAnswer,
  type AssistantArtifact,
  type AssistantStreamPart,
  type MetricFact,
  type ProjectCapabilities,
} from "@prism-analytics/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import type { HonoConfig } from "../types/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { getWorkspaceRole } from "../utils/workspaceAuth";
import {
  appendMessage,
  confirmMemoryProposal,
  createConversationWithFirstMessage,
  deleteConversation,
  finishRun,
  getConversation,
  getConversationBySlug,
  listConversations,
  listMemory,
  readConfirmedKnowledge,
  selectRecentTurns,
  startRun,
  type AssistantDb,
} from "../utils/assistantStore";
import { AssistantStoreError } from "../utils/assistantStore";
import { logger } from "../utils/logger";
import {
  createRequestTrace,
  traceText,
  type TraceFn,
} from "../utils/assistantTrace";
import { createAuthorizationCache } from "../utils/assistantAuthCache";
import {
  AssistantModelError,
  resolveAssistantModelConfig,
  createAssistantModel,
  type AssistantModelConfig,
} from "../utils/assistantModel";
import {
  runToolLoopAgent,
  type AgentRunResult,
} from "../utils/toolLoopAgent";
import { ASSISTANT_TOOL_DEFINITIONS, type AssistantToolDeps } from "../utils/assistantTools";
import { measureForAuthorizedContext } from "../utils/projectMetrics";
import {
  resolveMetricWindow,
  resolveProjectCapabilities,
} from "../utils/projectMetrics";
import { verifyDrilldownToken } from "../utils/queryContextToken";
import {
  assistantQuotas,
  type QuotaDecision,
} from "../utils/assistantQuotas";
import { buildFallbackAnswer } from "../utils/assistantAnswer";

/* ------------------------------------------------------------------ */
/* Test seams                                                          */
/* ------------------------------------------------------------------ */

type AgentRunner = (input: {
  question: string;
  tools: AssistantToolDeps;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  signal: AbortSignal;
  timeoutMs: number;
  maxRunCostMicroUsd: number;
  capabilities: ProjectCapabilities;
}) => Promise<AgentRunResult>;

let testAgentRunner: AgentRunner | null = null;

/** Test seam: scripted agent runs without network (unit tests only). */
export function __setAssistantAgentRunnerForTests(
  runner: AgentRunner | null,
): void {
  testAgentRunner = runner;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

type ProjectScope = {
  projectId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
};

async function resolveProjectScope(
  ctx: Context<HonoConfig>,
  slug: string,
  userId: string,
): Promise<ProjectScope | null> {
  const db = DatabaseManager.getInstance(ctx);
  const rows = (await db`
    SELECT id, organization_id FROM projects WHERE slug = ${slug}`) as Array<{
    id: string;
    organization_id: string;
  }>;
  if (rows.length === 0) return null;
  const projectId = String(rows[0].id);
  const organizationId = String(rows[0].organization_id);
  const role = await getWorkspaceRole(ctx, userId, organizationId);
  if (!role) return null;
  return { projectId, organizationId, role };
}

function notFound(ctx: Context<HonoConfig>) {
  return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
}

function invalid(ctx: Context<HonoConfig>, code = "invalid-input") {
  return ctx.json(new ErrorResponse(code).toJSON(), 400);
}

/** Mint the per-request trace (no-op unless trace logging is enabled). */
function requestTrace(ctx: Context<HonoConfig>): {
  traceId: string;
  trace: TraceFn;
} {
  const { traceId, trace } = createRequestTrace(
    (level, scope, message, meta) => logger[level](scope, message, meta),
    ctx.env as Record<string, string | undefined>,
  );
  return { traceId, trace };
}

/** Serialize one SSE data frame (validated before write). */
export function encodeStreamFrame(part: AssistantStreamPart): string {
  const parsed = AssistantStreamPartSchema.safeParse(part);
  if (!parsed.success) {
    throw new Error("Invalid assistant stream part");
  }
  return `data: ${JSON.stringify(parsed.data)}\n\n`;
}

export function encodeTextFrame(text: string): string {
  return `data: ${JSON.stringify({ type: "text", text: text.slice(0, 4000) })}\n\n`;
}

function sseResponse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  conversationSlug?: string,
): Response {
  void signal;
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // The chat that owns this stream, so a creation run can navigate
      // to its URL without a second lookup. Row IDs never leave here.
      ...(conversationSlug ? { "X-Conversation-Slug": conversationSlug } : {}),
    },
  });
}

function streamParts(
  parts: Array<string>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal.aborted) {
        controller.close();
        return;
      }
      for (const part of parts) {
        if (signal.aborted) break;
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

function quotaToStreamError(decision: Extract<QuotaDecision, { allowed: false }>): {
  code: "quota-exhausted" | "cost-exhausted";
  message: string;
  retryable: boolean;
} {
  if (decision.reason === "rate-limited" || decision.reason === "denied-quota") {
    return {
      code: "quota-exhausted",
      message: decision.message.slice(0, 280),
      retryable: true,
    };
  }
  return {
    code: "cost-exhausted",
    message: decision.message.slice(0, 280),
    retryable: false,
  };
}

function agentStatusToStreamError(result: AgentRunResult): {
  code: "provider-error" | "quota-exhausted" | "cost-exhausted" | "cancelled" | "validation-failed";
  message: string;
  retryable: boolean;
} {
  switch (result.status) {
    case "quota-exhausted":
      return { code: "quota-exhausted", message: result.errorMessage ?? "This response reached Prism's per-run token limit. Try a narrower question; this is not your provider credit balance.", retryable: false };
    case "cost-exhausted":
      return { code: "cost-exhausted", message: "Run cost limit reached. Narrow the question.", retryable: false };
    case "cancelled":
      return { code: "cancelled", message: "The run was stopped.", retryable: true };
    case "provider-error":
      return { code: "provider-error", message: "The model request failed. Try again shortly.", retryable: true };
    default:
      return { code: "validation-failed", message: result.errorMessage ?? "Prism could not produce a grounded explanation.", retryable: true };
  }
}

const MessagePostSchema = z.strictObject({
  clientRequestId: z.string().min(1).max(128),
  content: z.string().min(1).max(ANSWER_LIMITS.maxQuestionChars),
  queryContextToken: z.string().min(1).max(8192).optional(),
});

function userSignal(ctx: Context<HonoConfig>): AbortSignal {
  const raw = (ctx.req as unknown as { raw?: { signal?: AbortSignal } }).raw;
  return raw?.signal ?? new AbortController().signal;
}

function errorMessageFor(error: unknown): string {
  if (error instanceof AssistantStoreError) return error.message;
  return "The assistant request failed.";
}

/* ------------------------------------------------------------------ */
/* Tool dependency construction (run-bound, server-owned)              */
/* ------------------------------------------------------------------ */

// These issue-detail adapters are not snapshot-safe implementations yet.
// Keep them out of model eligibility instead of returning fabricated zeros.
const SUPPORTED_TOOL_IDS = Object.values(ASSISTANT_TOOL_DEFINITIONS)
  .map((definition) => definition.id)
  .filter((id) => id !== "review_error_health" && id !== "inspect_issue");

async function loadRunCapabilities(ctx: Context<HonoConfig>, projectId: string, asOf: number) {
  const db = DatabaseManager.getInstance(ctx);
  const sources = (await db`
    SELECT s.id AS id, s.platform AS platform,
      COALESCE(BOOL_OR(k.status != 'revoked'), false) AS active
    FROM project_sources s
    LEFT JOIN project_api_keys k ON k.source_id = s.id
    WHERE s.project_id = ${projectId}
    GROUP BY s.id, s.platform`) as Array<{ id: string; platform: string; active: boolean }>;
  const sourceIds = sources.map((source) => String(source.id));
  const analytics = TursoDatabaseManager.getInstance(ctx);
  // Sequential queries preserve the Workers-safe analytics execution policy.
  const telemetry = await analytics.execute({
    sql: "SELECT source_id, MAX(received_at) AS last_received_at FROM events WHERE project_id = ? AND received_at <= ? GROUP BY source_id",
    args: [projectId, asOf],
  });
  const lastReceived = new Map(telemetry.rows.map((row) => [String(row.source_id), row.last_received_at == null ? null : Number(row.last_received_at)]));
  const settings = sourceIds.length === 0 ? { rows: [] } : await analytics.execute({
    sql: `SELECT 1 AS n FROM source_error_settings WHERE mode != 'off' AND source_id IN (${sourceIds.map(() => "?").join(",")}) LIMIT 1`,
    args: sourceIds,
  });
  const errors = await analytics.execute({
    sql: "SELECT 1 AS n FROM error_occurrences WHERE project_id = ? AND received_at <= ? LIMIT 1",
    args: [projectId, asOf],
  });
  const standardEvents = await analytics.execute({
    sql: `SELECT DISTINCT json_extract(properties, '$."$standard".key') AS k FROM events WHERE project_id = ? AND received_at <= ? AND name LIKE '$prism_%'`,
    args: [projectId, asOf],
  });
  return {
    sourceIds,
    capabilities: resolveProjectCapabilities({
      sources: sources.map((source) => ({ platform: String(source.platform), active: source.active === true, lastReceivedAt: lastReceived.get(String(source.id)) ?? null })),
      errorConfigured: settings.rows.length > 0,
      errorObserved: errors.rows.length > 0,
      standardEventsObserved: standardEvents.rows.map((row) => String(row.k ?? "")),
    }),
  };
}

async function buildToolDeps(input: {
  ctx: Context<HonoConfig>;
  scope: ProjectScope;
  userId: string;
  window: { from: number; to: number; compareFrom: number; compareTo: number; asOf: number };
  capabilities: import("@prism-analytics/types").ProjectCapabilities;
  sourceIds: string[];
  authCache: ReturnType<typeof createAuthorizationCache>;
}): Promise<{ deps: AssistantToolDeps; authorized: AssistantToolDeps["authorized"] }> {
  const { ctx, scope, userId, window, capabilities, authCache } = input;
  const analytics = TursoDatabaseManager.getInstance(ctx);
  const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
  const authorized = {
    userId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    role: scope.role,
    allowedSourceIds: [...input.sourceIds],
    permissions: {
      canConfirmMemory: scope.role === "owner" || scope.role === "admin",
      canManageProject: scope.role === "owner" || scope.role === "admin",
    },
    cachedAt: Date.now(),
  };
  const authorizedContext = { ...authorized };
  const runWindow = { ...window };
  const deps: AssistantToolDeps = {
    authorized: authorizedContext,
    window: runWindow as never,
    authCache,
    measure: async (requests, reqScope) =>
      measureForAuthorizedContext(
        analytics as never,
        authorizedContext as never,
        runWindow as never,
        reqScope ?? { sourceScope: "all", sourceIds: [] },
        requests,
        { capabilities: capabilities as never, organizationId: scope.organizationId },
      ),
    measurePrevious: async (requests) => {
      const prev = {
        from: runWindow.compareFrom,
        to: runWindow.compareTo,
        compareFrom: runWindow.compareFrom - (runWindow.compareTo - runWindow.compareFrom),
        compareTo: runWindow.compareFrom,
        asOf: runWindow.asOf,
      };
      return measureForAuthorizedContext(
        analytics as never,
        authorizedContext as never,
        prev as never,
        { sourceScope: "all", sourceIds: [] },
        requests,
        { capabilities: capabilities as never, organizationId: scope.organizationId },
      );
    },
    measureWindow: async (customWindow, requests, reqScope) =>
      measureForAuthorizedContext(
        analytics as never,
        authorizedContext as never,
        customWindow as never,
        reqScope ?? { sourceScope: "all", sourceIds: [] },
        requests,
        { capabilities: capabilities as never, organizationId: scope.organizationId },
      ),
    readKnowledge: async () =>
      readConfirmedKnowledge(db, {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        subjectUserId: userId,
      }),
    listMemoryRecords: async (filters) =>
      listMemory(db, {
        organizationId: scope.organizationId,
        scope: (filters.scope ?? null) as never,
        projectId: scope.projectId,
        status: (filters.status ?? null) as never,
      }),
    proposeKnowledge: async (proposal) => {
      const { proposeMemory } = await import("../utils/assistantStore");
      return proposeMemory(db, {
        organizationId: scope.organizationId,
        scope: proposal.scope,
        key: proposal.key as never,
        projectId: proposal.projectId,
        value: proposal.value as never,
        proposerId: userId,
        authenticatedUserId: userId,
        now: Date.now(),
      });
    },
    proposerId: userId,
    listIssues: async () => { throw new Error("Issue-detail inspection is not available in the assistant yet. Use measured error metrics."); },
    getIssue: async () => { throw new Error("Issue-detail inspection is not available in the assistant yet. Use measured error metrics."); },
    errorAggregates: async () => { throw new Error("Issue-detail inspection is not available in the assistant yet. Use measured error metrics."); },
  };
  return { deps, authorized: authorizedContext };
}

/* ------------------------------------------------------------------ */
/* Core streamed run                                                   */
/* ------------------------------------------------------------------ */

async function executeStreamedRun(input: {
  ctx: Context<HonoConfig>;
  /** Route name for trace lines (e.g. "conversations.create"). */
  route: string;
  trace: TraceFn;
  traceId: string;
  scope: ProjectScope;
  userId: string;
  conversationId: string;
  /** URL slug of the owning chat, echoed as a response header. */
  conversationSlug: string;
  userMessageId: string;
  question: string;
  queryContextToken?: string;
  now: number;
}): Promise<Response> {
  const { ctx, route, trace, traceId, scope, userId, conversationId, userMessageId, question, now } = input;
  trace("run.received", `assistant run requested via ${route}`, {
    route,
    userId,
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    role: scope.role,
    conversationSlug: input.conversationSlug,
    question: traceText(question, 2000),
    queryContextTokenPresent: Boolean(input.queryContextToken),
    queryContextTokenPreview: input.queryContextToken?.slice(0, 24) ?? null,
  });
  const streamWithSlug = (
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Response => sseResponse(body, signal, input.conversationSlug);
  // NOTE: no env argument — passing one would reset the process-local
  // singleton (see assistantQuotas). Limits are configured at startup.
  const quotas = assistantQuotas();
  const streamAbort = new AbortController();
  const signal = AbortSignal.any([userSignal(ctx), streamAbort.signal]);
  const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;

  const writeErrorStream = (
    code: "provider-error" | "quota-exhausted" | "cost-exhausted" | "cancelled" | "validation-failed" | "disabled",
    message: string,
    retryable: boolean,
  ): Response => {
    const frames = [
      encodeStreamFrame({
        kind: "data-run-error",
        code: code === "disabled" ? "provider-error" : code,
        message: code === "disabled" ? "Assistant is disabled for this deployment." : message.slice(0, 280),
        retryable,
      }),
    ];
    return streamWithSlug(streamParts(frames, signal), signal);
  };

  // Pre-run gates: rate + daily quota.
  const rate = quotas.checkRate({ userId, projectId: scope.projectId, organizationId: scope.organizationId });
  if (!rate.allowed) {
    trace("run.gate", "rate limit denied the run", {
      reason: rate.reason,
      retryAfterMs: rate.retryAfterMs,
    });
    const mapped = quotaToStreamError(rate);
    await finishRun(db, { projectId: scope.projectId, userId, runId: `run_missing_${now}`, status: "failed", now }).catch(() => undefined);
    return writeErrorStream(mapped.code, mapped.message, mapped.retryable);
  }
  trace("run.gate", "rate limit passed", {});
  const daily = quotas.checkDaily({ userId, organizationId: scope.organizationId, now });
  if (!daily.allowed) {
    trace("run.gate", "daily quota denied the run", {
      reason: daily.reason,
      retryAfterMs: daily.retryAfterMs,
    });
    const mapped = quotaToStreamError(daily);
    return writeErrorStream(mapped.code, mapped.message, mapped.retryable);
  }
  trace("run.gate", "daily quota passed", {});

  let metricWindow = resolveMetricWindow(now, "7d");
  // Verify the snapshot token when supplied (server-side, after member).
  if (input.queryContextToken) {
    try {
      const verified = await verifyDrilldownToken({
        token: input.queryContextToken,
        env: ctx.env as Record<string, string | undefined>,
        projectId: scope.projectId,
        organizationId: scope.organizationId,
        allowedSourceIds: [],
      });
      trace("run.token", "snapshot token verified", {
        present: verified.present,
        ok: verified.present ? verified.ok : null,
        reason: verified.present && !verified.ok ? verified.reason : null,
      });
      if (verified.present && !verified.ok) {
        return writeErrorStream("validation-failed", "That snapshot expired. Refresh the overview and ask again.", true);
      }
      if (verified.present && verified.ok) {
        if (verified.context.sourceScope === "selected") {
          return writeErrorStream("validation-failed", "Source-filtered snapshots are not supported by the assistant yet. Use the unfiltered project overview.", false);
        }
        const { from, to, compareFrom, compareTo, asOf } = verified.context;
        metricWindow = { from, to, compareFrom, compareTo, asOf };
      }
    } catch {
      trace("run.token", "snapshot token verification threw", {});
      return writeErrorStream("validation-failed", "That snapshot expired. Refresh the overview and ask again.", true);
    }
  } else {
    trace("run.token", "no snapshot token supplied; continuing without one", {});
  }

  // Model configuration: fail closed to a disabled stream error.
  let modelConfig: AssistantModelConfig | null = null;
  let configError: "disabled" | null = null;
  try {
    modelConfig = resolveAssistantModelConfig(ctx.env as Record<string, string | undefined>);
    trace("run.config", "model configuration resolved", {
      model: modelConfig.model.id,
      evaluated: modelConfig.model.evaluated,
      requireZeroDataRetention: modelConfig.requireZeroDataRetention,
      maxSteps: modelConfig.maxSteps,
      maxInputTokens: modelConfig.maxInputTokens,
      maxOutputTokens: modelConfig.maxOutputTokens,
    });
  } catch (error) {
    configError = "disabled";
    // Name the actual gate: "disabled" is the user-facing collapse, but
    // the operator needs to know which check threw. These messages carry
    // config names and model IDs only — never secret values.
    trace("run.config", "model configuration failed; run will stream disabled", {
      errorCode: error instanceof AssistantModelError ? error.code : "unknown",
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error).slice(0, 300),
    });
  }

  // Start the run BEFORE any paid work (one-active-run owned by the DB).
  const started = await startRun(db, {
    projectId: scope.projectId,
    userId,
    conversationId,
    messageId: userMessageId,
    queryContextHash: `q_${now}`,
    model: modelConfig?.model.id ?? "disabled",
    now,
  }).catch((error: unknown) => ({ ok: false as const, storeError: error }));
  if ("storeError" in (started as Record<string, unknown>)) {
    trace("run.start", "startRun threw", {
      error: errorMessageFor((started as { storeError: unknown }).storeError),
    });
    return writeErrorStream("provider-error", errorMessageFor((started as { storeError: unknown }).storeError), true);
  }
  if (!(started as { ok: boolean }).ok) {
    trace("run.start", "one-active-run conflict; streaming retryable error", {
      activeRunId: (started as { conflict?: { activeRunId?: string } }).conflict?.activeRunId ?? null,
    });
    const conflict = (started as { conflict?: { activeRunId?: string } }).conflict;
    void conflict;
    const frames = [
      encodeStreamFrame({
        kind: "data-run-error",
        code: "quota-exhausted",
        message: "Another question is already running. Stop it before starting a new one.",
        retryable: true,
      }),
    ];
    return streamWithSlug(streamParts(frames, signal), signal);
  }
  const run = (started as { run: { id: string } }).run;
  trace("run.start", "run started", { runId: run.id, userMessageId });

  if (configError || !modelConfig) {
    trace("run.disabled", "streaming disabled error; no model call made", {});
    await finishRun(db, { projectId: scope.projectId, userId, runId: run.id, status: "failed", failureCode: "disabled", now: Date.now() });
    return writeErrorStream("disabled", "Assistant is disabled for this deployment.", false);
  }

  // Return headers immediately; the member's message already exists.
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: string) => { if (!closed) controller.enqueue(encoder.encode(frame)); };
      emit(encodeStreamFrame({ kind: "data-run-start", runId: run.id, conversationId }));
      const execute = async (): Promise<Response> => {

  // Resolve window + capabilities sequentially (Workers-safe).
  trace("run.window", "metric window resolved", { ...metricWindow });
  const { capabilities, sourceIds } = await loadRunCapabilities(ctx, scope.projectId, metricWindow.asOf);
  trace("run.capabilities", "capabilities resolved", {
    web: capabilities.web,
    mobile: capabilities.mobile,
    server: capabilities.server,
    errorConfigured: capabilities.errorCollection.configured,
    errorObserved: capabilities.errorCollection.observed,
    standardEventsObserved: capabilities.standardEventsObserved,
  });
  const authCache = createAuthorizationCache({
    lookup: async () => ({
      userId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      role: scope.role,
      allowedSourceIds: [...sourceIds],
      permissions: {
        canConfirmMemory: scope.role === "owner" || scope.role === "admin",
        canManageProject: scope.role === "owner" || scope.role === "admin",
      },
      cachedAt: Date.now(),
    }),
  });
  const { deps, authorized } = await buildToolDeps({
    ctx,
    scope,
    userId,
    window: metricWindow,
    capabilities: capabilities as never,
    sourceIds,
    authCache,
  });
  trace("run.deps", "run-bound tool dependencies built", {
    allowedSourceIds: authorized.allowedSourceIds,
    canConfirmMemory: authorized.permissions.canConfirmMemory,
  });
  void authorized;

  const runAgent = async (): Promise<AgentRunResult> => {
    if (testAgentRunner) {
      trace("run.agent", "using injected test agent runner", {});
      return testAgentRunner({
        question,
        tools: deps,
        capabilities,
        history: [],
        signal,
        timeoutMs: quotas.config.runTimeoutMs,
        maxRunCostMicroUsd: quotas.config.maxRunCostMicroUsd,
      });
    }
    const knowledge = await deps.readKnowledge();
    trace("run.knowledge", "confirmed knowledge loaded", {
      project: knowledge.project.length,
      workspace: knowledge.workspace.length,
      member: knowledge.member.length,
      keys: [
        ...knowledge.project.map((entry) => entry.key),
        ...knowledge.workspace.map((entry) => entry.key),
        ...knowledge.member.map((entry) => entry.key),
      ],
    });
    const historyRows = await (async () => {
      const detail = await getConversation(db, { projectId: scope.projectId, userId, conversationId });
      const eligible = (detail?.messages ?? [])
        .filter((message) => message.id !== userMessageId && message.status === "complete")
        .map((message) => ({
          seq: message.seq,
          role: message.role as "user" | "assistant",
          text: message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join("\n")
            .slice(0, 2000),
        }));
      return selectRecentTurns(eligible).messages.map((entry) => ({ role: entry.role, text: entry.text }));
    })();
    trace("run.history", "bounded history selected for model context", {
      turns: historyRows.length,
      texts: historyRows.map((entry) => traceText(entry.text, 200)),
    });
    const model = createAssistantModel(modelConfig as AssistantModelConfig);
    trace("run.agent", "invoking production tool-loop agent", {
      historyTurns: historyRows.length,
    });
    return runToolLoopAgent({
      question,
      model,
      config: modelConfig as AssistantModelConfig,
      tools: deps,
      capabilities,
      supportedToolIds: SUPPORTED_TOOL_IDS,
      history: historyRows,
      knowledge,
      trace,
      onActivity: (step) => emit(encodeStreamFrame({ kind: "data-activity-step", ...step })),
      maxRunCostMicroUsd: quotas.config.maxRunCostMicroUsd,
      providerUserId: userId,
      signal,
      timeoutMs: quotas.config.runTimeoutMs,
    });
  };

  let result: AgentRunResult;
  try {
    result = await runAgent();
  } catch (error) {
    // Operator-side failure class only: the browser keeps the sanitized
    // message, while the wrangler log carries what actually threw
    // (never prompts, tool inputs, or secrets — logger redacts those).
    logger.error("assistant.run", "agent run threw", {
      runId: run.id,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    });
    await finishRun(db, { projectId: scope.projectId, userId, runId: run.id, status: "failed", failureCode: "provider-error", now: Date.now() });
    return writeErrorStream("provider-error", "The model request failed. Try again shortly.", true);
  }

  // Post-run accounting (tokens; cost enforced per-step + here).
  quotas.recordUsage({
    userId,
    organizationId: scope.organizationId,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    costMicroUsd: result.usage.costMicroUsd,
    now: Date.now(),
  });
  trace("run.result", "agent run returned", {
    runId: run.id,
    status: result.status,
    repaired: result.repaired,
    steps: result.steps.map((step) => `${step.toolId}:${step.state}`),
    toolIds: result.toolIds,
    factIds: result.factIds,
    artifactIds: result.artifactIds,
    usage: result.usage,
    quotaDecision: result.quota.decision,
    latencyMs: result.latencyMs,
  });

  if (signal.aborted) {
    trace("run.abort", "run aborted before answering", {});
    await finishRun(db, { projectId: scope.projectId, userId, runId: run.id, status: "cancelled", now: Date.now() });
    const frames = [
      encodeStreamFrame({ kind: "data-run-start", runId: run.id, conversationId }),
      encodeStreamFrame({ kind: "data-run-error", code: "cancelled", message: "The run was stopped.", retryable: true }),
    ];
    return streamWithSlug(streamParts(frames, signal), signal);
  }

  if (result.status !== "answered" && result.status !== "fallback") {
    const mapped = agentStatusToStreamError(result);
    trace("run.failed", "streaming run-error frame", {
      runId: run.id,
      code: mapped.code,
      retryable: mapped.retryable,
    });
    logger.warn("assistant.run", "agent run ended without an answer", {
      runId: run.id,
      status: result.status,
      quotaDecision: result.quota.decision,
    });
    await finishRun(db, {
      projectId: scope.projectId,
      userId,
      runId: run.id,
      status: result.status === "cancelled" ? "cancelled" : "failed",
      failureCode: mapped.code,
      stepCount: result.steps.length,
      toolIds: result.toolIds as string[],
      usage: result.usage as never,
      factIds: result.factIds,
      artifactIds: result.artifactIds,
      latencyMs: result.latencyMs,
      now: Date.now(),
    });
    const frames = [
      encodeStreamFrame({ kind: "data-run-start", runId: run.id, conversationId }),
      encodeStreamFrame({ kind: "data-run-error", code: mapped.code, message: mapped.message, retryable: mapped.retryable }),
    ];
    return streamWithSlug(streamParts(frames, signal), signal);
  }

  const answer: AssistantAnswer = result.answer ?? buildFallbackAnswer("unusable answer");
  const answerCheck = AssistantAnswerSchema.safeParse(answer);
  const finalAnswer: AssistantAnswer = answerCheck.success ? answerCheck.data : buildFallbackAnswer("invalid");
  trace("run.answer", "final answer validated for persistence", {
    runId: run.id,
    contractValid: answerCheck.success,
    summary: traceText(finalAnswer.summary, 500),
    observations: finalAnswer.observations.map((entry) => ({
      text: traceText(entry.text, 300),
      factIds: entry.factIds,
    })),
    primaryArtifactId: finalAnswer.primaryArtifactId,
    supportingArtifactIds: finalAnswer.supportingArtifactIds,
    assumptions: finalAnswer.assumptions,
    followUps: finalAnswer.followUps,
  });
  // Preserve every answer-referenced widget before optional tool artifacts.
  // Text, answer and trace reserve three of the sixteen message-part slots.
  const referenced = new Set([finalAnswer.primaryArtifactId, ...finalAnswer.supportingArtifactIds]);
  const answerArtifacts = [
    ...(result.artifacts ?? []).filter((artifact) => referenced.has(artifact.id)),
    ...(result.artifacts ?? []).filter((artifact) => !referenced.has(artifact.id)),
  ].slice(0, 13);

  // Facts/artifacts for the stream: metric facts only (evidence union
  // members that are not MetricFacts never enter the fact channel).
  const factFrames: string[] = [];
  const artifactFrames: string[] = [];
  void factFrames;
  void artifactFrames;

  // Persist the assistant message complete ONLY after validation.
  {
    const parts = [
      { type: "text", text: finalAnswer.summary.slice(0, 2000) },
      { type: "answer", answer: finalAnswer },
      { type: "trace", steps: result.steps },
      ...answerArtifacts.map((artifact) => ({ type: "artifact", artifact })),
    ];
    await appendMessage(db, {
      projectId: scope.projectId,
      userId,
      conversationId,
      role: "assistant",
      status: "complete",
      parts: parts as never,
      now: Date.now(),
    });
    trace("run.persist", "assistant message persisted as complete", {
      runId: run.id,
      partKinds: parts.map((part) => part.type),
      artifactIds: answerArtifacts.map((artifact) => `${artifact.id}:${artifact.kind}`),
    });
  }
  await finishRun(db, {
    projectId: scope.projectId,
    userId,
    runId: run.id,
    status: "complete",
    stepCount: result.steps.length,
    toolIds: result.toolIds as string[],
    usage: result.usage as never,
    factIds: result.factIds,
    artifactIds: result.artifactIds,
    latencyMs: result.latencyMs,
    now: Date.now(),
  });
  trace("run.finish", "run marked complete", {
    runId: run.id,
    stepCount: result.steps.length,
    latencyMs: result.latencyMs,
  });

  const frames: string[] = [
    encodeStreamFrame({ kind: "data-run-start", runId: run.id, conversationId }),
    ...result.steps.map((step) =>
      encodeStreamFrame({
        kind: "data-activity-step",
        stepId: step.stepId,
        sequence: step.sequence,
        toolId: step.toolId,
        state: step.state === "running" ? "running" : step.state === "failed" ? "failed" : "complete",
        label: step.label,
      }),
    ),
    encodeTextFrame(finalAnswer.summary),
    ...answerArtifacts.map((artifact) => encodeStreamFrame({ kind: "data-artifact", artifact })),
    encodeStreamFrame({
      kind: "data-run-finish",
      answer: finalAnswer,
      factIds: result.factIds.slice(0, 64),
      artifactIds: result.artifactIds.slice(0, 16),
    }),
  ];
  trace("run.respond", "sending final stream response", {
    runId: run.id,
    frameKinds: [
      "data-run-start",
      ...result.steps.map(() => "data-activity-step"),
      "text",
      ...answerArtifacts.map(() => "data-artifact"),
      "data-run-finish",
    ],
    conversationSlug: input.conversationSlug,
  });
  return streamWithSlug(streamParts(frames, signal), signal);
      };
      void execute().then(async (response) => {
        const reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done || closed) break;
            controller.enqueue(chunk.value);
          }
          reader.releaseLock();
        }
      }).catch(async () => {
        trace("run.respond", "stream relay failed while serving chunks", {
          runId: run.id,
        });
        await finishRun(db, { projectId: scope.projectId, userId, runId: run.id, status: "failed", failureCode: "provider-error", now: Date.now() }).catch(() => undefined);
        emit(encodeStreamFrame({ kind: "data-run-error", code: "provider-error", message: "The answer could not be saved. Please retry.", retryable: true }));
      }).finally(() => { if (!closed) { closed = true; controller.close(); } });
    },
    cancel() { closed = true; streamAbort.abort(); },
  });
  return streamWithSlug(body, signal);
}

/* ------------------------------------------------------------------ */
/* Route handlers                                                      */
/* ------------------------------------------------------------------ */

export class AssistantController {
  public static async listConversations(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) return notFound(ctx);
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const query = (name: string): string | undefined => {
      try {
        return (ctx.req.query as (key: string) => string | undefined)(name);
      } catch {
        return undefined;
      }
    };
    const limit = Math.min(Math.max(Number.parseInt(query("limit") ?? "20", 10) || 20, 1), 50);
    trace("http.request", "GET conversations", {
      traceId,
      userId: user.id,
      projectSlug: slug,
      limit,
      cursorPresent: (query("cursor") ?? null) !== null,
    });
    try {
      const page = await listConversations(db, {
        projectId: scope.projectId,
        userId: user.id,
        limit,
        cursor: query("cursor") ?? null,
      });
      trace("http.response", "GET conversations -> 200", {
        traceId,
        itemCount: page.items.length,
        nextCursorPresent: page.nextCursor !== null,
      });
      return ctx.json(page);
    } catch (error) {
      if (error instanceof AssistantStoreError && error.code === "invalid-input") {
        return invalid(ctx, "invalid_filter");
      }
      throw error;
    }
  }

  public static async createConversation(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) {
      trace("http.auth", "POST conversations -> 404 (unknown project or non-member)", { traceId });
      return notFound(ctx);
    }
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return invalid(ctx);
    }
    const parsed = ConversationCreateSchema.safeParse(body);
    if (!parsed.success) {
      trace("http.request", "POST conversations -> 400 (contract validation)", { traceId });
      return invalid(ctx);
    }
    trace("http.request", "POST conversations (create-and-stream)", {
      traceId,
      userId: user.id,
      projectSlug: slug,
      clientRequestId: parsed.data.clientRequestId,
      firstMessage: traceText(parsed.data.firstMessage, 2000),
      seed: parsed.data.seed,
      queryContextTokenPreview: parsed.data.queryContextToken.slice(0, 24),
    });
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const now = Date.now();
    try {
      const created = await createConversationWithFirstMessage(db, {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: user.id,
        clientRequestId: parsed.data.clientRequestId,
        firstMessage: parsed.data.firstMessage,
        seed: parsed.data.seed,
        queryContextToken: parsed.data.queryContextToken,
        now,
      });
      trace("http.persist", "chat created with first message", {
        traceId,
        conversationId: created.conversation.id,
        conversationSlug: created.conversation.slug,
        messageId: created.message.id,
        createdConversation: created.createdConversation,
        createdMessage: created.createdMessage,
      });
      return executeStreamedRun({
        ctx,
        route: "conversations.create",
        trace,
        traceId,
        scope,
        userId: user.id,
        conversationId: created.conversation.id,
        conversationSlug: created.conversation.slug,
        userMessageId: created.message.id,
        question: parsed.data.firstMessage,
        queryContextToken: parsed.data.queryContextToken,
        now,
      });
    } catch (error) {
      if (error instanceof AssistantStoreError) {
        trace("http.persist", "chat creation failed in store", {
          traceId,
          code: error.code,
        });
        if (error.code === "idempotency-conflict") {
          return ctx.json(new ErrorResponse("idempotency-conflict").toJSON(), 409);
        }
        if (error.code === "invalid-input") return invalid(ctx);
        if (error.code === "not-found") return notFound(ctx);
      }
      throw error;
    }
  }

  public static async getConversation(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const conversationSlug = ctx.req.param("conversationSlug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug || !conversationSlug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    trace("http.request", "GET conversation", {
      traceId,
      userId: user.id,
      projectSlug: slug,
      conversationSlug,
    });
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) return notFound(ctx);
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const detail = await getConversationBySlug(db, {
      projectId: scope.projectId,
      userId: user.id,
      slug: conversationSlug,
    });
    if (!detail) {
      trace("http.response", "GET conversation -> 404", { traceId });
      return notFound(ctx);
    }
    trace("http.response", "GET conversation -> 200", {
      traceId,
      messageCount: detail.messages.length,
      hasActiveRun: detail.activeRun !== null,
    });
    return ctx.json({
      conversation: detail.conversation,
      messages: detail.messages,
      activeRun: detail.activeRun,
    });
  }

  public static async deleteConversation(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const conversationSlug = ctx.req.param("conversationSlug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug || !conversationSlug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    trace("http.request", "DELETE conversation", {
      traceId,
      userId: user.id,
      projectSlug: slug,
      conversationSlug,
    });
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) return notFound(ctx);
    // Fresh membership check before a destructive write (no cached authz).
    const fresh = await getWorkspaceRole(ctx, user.id, scope.organizationId);
    if (!fresh) return notFound(ctx);
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const detail = await getConversationBySlug(db, {
      projectId: scope.projectId,
      userId: user.id,
      slug: conversationSlug,
    });
    if (!detail) {
      trace("http.response", "DELETE conversation -> 404", { traceId });
      return notFound(ctx);
    }
    const result = await deleteConversation(db, {
      projectId: scope.projectId,
      userId: user.id,
      conversationId: detail.conversation.id,
    });
    trace("http.response", "DELETE conversation -> 200", {
      traceId,
      deleted: result.deleted,
      abortedRun: result.abortedRun,
    });
    if (!result.deleted) return notFound(ctx);
    return ctx.json({ deleted: true, abortedRun: result.abortedRun });
  }

  public static async postMessage(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const conversationSlug = ctx.req.param("conversationSlug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug || !conversationSlug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) {
      trace("http.auth", "POST message -> 404 (unknown project or non-member)", { traceId });
      return notFound(ctx);
    }
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return invalid(ctx);
    }
    const parsed = MessagePostSchema.safeParse(body);
    if (!parsed.success) {
      trace("http.request", "POST message -> 400 (contract validation)", { traceId });
      return invalid(ctx);
    }
    trace("http.request", "POST message (continue-and-stream)", {
      traceId,
      userId: user.id,
      projectSlug: slug,
      conversationSlug,
      clientRequestId: parsed.data.clientRequestId,
      content: traceText(parsed.data.content, 2000),
      queryContextTokenPresent: Boolean(parsed.data.queryContextToken),
    });
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const now = Date.now();
    // Ownership first: unknown/foreign chats are a non-disclosing 404.
    const detail = await getConversationBySlug(db, {
      projectId: scope.projectId,
      userId: user.id,
      slug: conversationSlug,
    });
    if (!detail) {
      trace("http.response", "POST message -> 404 (unknown/foreign chat)", { traceId });
      return notFound(ctx);
    }
    const conversationId = detail.conversation.id;
    try {
      const appended = await appendMessage(db, {
        projectId: scope.projectId,
        userId: user.id,
        conversationId,
        role: "user",
        status: "complete",
        parts: [{ type: "text", text: parsed.data.content }],
        clientRequestId: parsed.data.clientRequestId,
        completedAt: now,
        now,
      });
      trace("http.persist", "user message appended", {
        traceId,
        messageId: appended.message.id,
        created: appended.created,
        seq: appended.message.seq,
      });
      return executeStreamedRun({
        ctx,
        route: "conversations.message",
        trace,
        traceId,
        scope,
        userId: user.id,
        conversationId,
        conversationSlug: detail.conversation.slug,
        userMessageId: appended.message.id,
        question: parsed.data.content,
        queryContextToken: parsed.data.queryContextToken,
        now,
      });
    } catch (error) {
      if (error instanceof AssistantStoreError) {
        trace("http.persist", "message append failed in store", {
          traceId,
          code: error.code,
        });
        if (error.code === "idempotency-conflict") {
          // Idempotent reconnect: the earlier run already exists — the
          // client replays the persisted transcript instead of forking.
          return ctx.json(new ErrorResponse("idempotency-conflict").toJSON(), 409);
        }
        if (error.code === "invalid-input") return invalid(ctx);
        if (error.code === "not-found") return notFound(ctx);
      }
      throw error;
    }
  }

  public static async getMemory(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    trace("http.request", "GET memory", { traceId, userId: user.id, projectSlug: slug });
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) return notFound(ctx);
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const records = await listMemory(db, { organizationId: scope.organizationId });
    // Tenant-narrowed: project + workspace records for this project, plus
    // the caller's own member prefs. Never another member's prefs.
    const visible = records.filter((record) => {
      if (record.scope === "member") {
        return (
          record.subjectUserId === user.id &&
          (record.projectId === null || record.projectId === scope.projectId)
        );
      }
      if (record.scope === "project") return record.projectId === scope.projectId;
      return true;
    });
    trace("http.response", "GET memory -> 200", {
      traceId,
      total: records.length,
      visible: visible.length,
    });
    return ctx.json({ records: visible });
  }

  public static async confirmProposal(ctx: Context<HonoConfig>) {
    return AssistantController.decideProposal(ctx, "confirm");
  }

  public static async rejectProposal(ctx: Context<HonoConfig>) {
    return AssistantController.decideProposal(ctx, "reject");
  }

  private static async decideProposal(
    ctx: Context<HonoConfig>,
    action: "confirm" | "reject",
  ) {
    const slug = ctx.req.param("slug");
    const proposalId = ctx.req.param("proposalId");
    const user = ctx.get("user");
    if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    if (!slug || !proposalId) return notFound(ctx);
    const { traceId, trace } = requestTrace(ctx);
    trace("http.request", `POST memory ${action}`, {
      traceId,
      userId: user.id,
      projectSlug: slug,
      proposalId,
    });
    const scope = await resolveProjectScope(ctx, slug, user.id);
    if (!scope) return notFound(ctx);
    // Fresh transactional authorization for shared-memory writes: bypass
    // any cached decision (the cache is a read optimization only).
    const fresh = await getWorkspaceRole(ctx, user.id, scope.organizationId);
    if (!fresh) return notFound(ctx);
    trace("http.auth", `memory ${action} fresh role resolved`, {
      traceId,
      role: fresh,
    });
    const db = DatabaseManager.getInstance(ctx) as unknown as AssistantDb;
    const result = await confirmMemoryProposal(db, {
      organizationId: scope.organizationId,
      recordId: proposalId,
      confirmerId: user.id,
      role: fresh,
      now: Date.now(),
      action,
    }).catch((error: unknown) => {
      if (error instanceof AssistantStoreError) return null;
      throw error;
    });
    if (!result) {
      trace("http.response", `POST memory ${action} -> 400 (store rejected)`, { traceId });
      return invalid(ctx);
    }
    if (!result.ok) {
      trace("http.response", `POST memory ${action} -> ${result.reason}`, { traceId });
      if (result.reason === "not-found") return notFound(ctx);
      if (result.reason === "forbidden") {
        return ctx.json(new ErrorResponse("forbidden").toJSON(), 403);
      }
      if (result.reason === "slot-conflict") {
        return ctx.json(new ErrorResponse("slot-conflict").toJSON(), 409);
      }
      return ctx.json(new ErrorResponse("not-proposed").toJSON(), 409);
    }
    trace("http.response", `POST memory ${action} -> 200`, {
      traceId,
      recordId: result.record.id,
      supersededIds: result.supersededIds,
    });
    return ctx.json({ record: result.record, supersededIds: result.supersededIds });
  }
}

export type { MetricFact, AssistantArtifact };
export { DEFINITION_VERSION };
