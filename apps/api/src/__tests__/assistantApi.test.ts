/**
 * Slice 6 controller tests: auth boundary, validation, idempotency,
 * disabled-AI stream, quota gates, and SSE frame validation.
 * Store and agent are stubbed; no network, no real PG.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager", () => ({
  TursoDatabaseManager: { getInstance: vi.fn() },
}));
vi.mock("../utils/assistantStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/assistantStore")>();
  return {
    ...actual,
    createConversationWithFirstMessage: vi.fn(),
    appendMessage: vi.fn(),
    startRun: vi.fn(),
    finishRun: vi.fn(),
    getConversation: vi.fn(),
    getConversationBySlug: vi.fn(),
    listConversations: vi.fn(),
    deleteConversation: vi.fn(),
    listMemory: vi.fn(),
    confirmMemoryProposal: vi.fn(),
  };
});

import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import { AssistantController } from "../controllers/AssistantController";
import { __setAssistantAgentRunnerForTests } from "../controllers/AssistantController";
import type { AgentRunResult } from "../utils/toolLoopAgent";
import { encodeStreamFrame } from "../controllers/AssistantController";
import {
  AssistantQuotas,
  __setAssistantQuotasForTests,
  resolveQuotaLimits,
} from "../utils/assistantQuotas";
import {
  AssistantStoreError,
  createConversationWithFirstMessage,
  appendMessage,
  startRun,
  finishRun,
  getConversation,
  getConversationBySlug,
  listConversations,
  deleteConversation,
  listMemory,
  confirmMemoryProposal,
} from "../utils/assistantStore";
import { makeCtx, makeMockDb } from "./helpers";
import { issueQueryContextToken } from "../utils/queryContextToken";

const getInstance = vi.mocked(DatabaseManager.getInstance);

const USER_ID = "user_1";
const OTHER_USER = "user_2";
const ORG_ID = "org_1";
const PROJECT_ID = "proj_1";
const SLUG = "alpha";

function productDb(role: string | null) {
  return makeMockDb((sql) => {
    if (sql.includes("FROM projects")) {
      return [{ id: PROJECT_ID, organization_id: ORG_ID }];
    }
    if (sql.includes("FROM member") || sql.includes("member")) {
      return role ? [{ role }] : [];
    }
    return [];
  });
}

function ctxFor(
  params: Record<string, string>,
  body: unknown,
  userId: string | null,
  role: string | null = "member",
  env: Record<string, string> = {},
) {
  getInstance.mockReturnValue(productDb(role) as never);
  const ctx = makeCtx(
    params,
    body,
    userId ? { user: { id: userId } } : {},
    {},
  );
  (ctx as unknown as { env: Record<string, string> }).env = env;
  return ctx;
}

async function readSse(response: Response): Promise<string> {
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  return response.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(TursoDatabaseManager.getInstance).mockReturnValue({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  } as never);
  __setAssistantAgentRunnerForTests(null);
  __setAssistantQuotasForTests(
    new AssistantQuotas(resolveQuotaLimits({})),
  );
});

it("returns the chat stream before generation completes and persists the structured answer", async () => {
  let complete!: (result: AgentRunResult) => void;
  __setAssistantAgentRunnerForTests(() => new Promise((resolve) => { complete = resolve; }));
  vi.mocked(getConversationBySlug).mockResolvedValue({ conversation: { id: "conv_1", slug: "chat_abc123def456" }, messages: [], activeRun: null } as never);
  vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_1" }, created: true } as never);
  vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
  vi.mocked(finishRun).mockResolvedValue({ finished: true } as never);
  const response = await AssistantController.postMessage(ctxFor(
    { slug: SLUG, conversationSlug: "chat_abc123def456" },
    { clientRequestId: "req_stream", content: "What changed?" }, USER_ID, "member",
    { PRISM_AI_ENABLED: "1", OPENROUTER_API_KEY: "test-only" },
  )) as Response;
  expect(response.headers.get("X-Conversation-Slug")).toBe("chat_abc123def456");
  const streamBody = response.body;
  expect(streamBody).not.toBeNull();
  const reader = (streamBody as ReadableStream<Uint8Array>).getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("data-run-start");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  const answer = { summary: "No significant change.", observations: [], primaryArtifactId: null, supportingArtifactIds: [], assumptions: ["Small sample."], followUps: [{ title: "Check errors", description: "Check errors for this period." }] };
  complete({ status: "answered", answer, repaired: false, steps: [], facts: [], factIds: [], toolIds: [], artifactIds: [], artifacts: [], eligibleToolIds: [], usage: { model: "test", gateway: "openrouter", upstreamProvider: null, promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: 1 }, quota: { decision: "allowed", limitType: null, retryAfterMs: null }, latencyMs: 1, modelMessages: [] } as AgentRunResult);
  let tail = "";
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; tail += new TextDecoder().decode(chunk.value); }
  expect(tail).toContain("data-run-finish");
  expect(vi.mocked(appendMessage)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: "assistant", status: "complete", parts: expect.arrayContaining([{ type: "answer", answer }]) }));
  expect(vi.mocked(appendMessage).mock.calls.some(([, input]) => input.status === "streaming")).toBe(false);
});

it("persists a friendly greeting without analytics setup, redundant history, or model calls", async () => {
  const runner = vi.fn();
  __setAssistantAgentRunnerForTests(runner);
  vi.mocked(getConversationBySlug).mockResolvedValue({ conversation: { id: "conv_1", slug: "chat_abc123def456" }, messages: [], activeRun: null } as never);
  vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_1" }, created: true } as never);
  vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
  vi.mocked(finishRun).mockResolvedValue({ finished: true } as never);
  const response = await AssistantController.postMessage(ctxFor(
    { slug: SLUG, conversationSlug: "chat_abc123def456" },
    { clientRequestId: "req_hello", content: "yoo" }, USER_ID, "member",
    { PRISM_AI_ENABLED: "1", OPENROUTER_API_KEY: "test-only" },
  )) as Response;
  const body = await readSse(response);
  expect(body).toContain("Hey! What would you like to know about this project?");
  expect(body).toContain("data-run-finish");
  expect(runner).not.toHaveBeenCalled();
  expect(TursoDatabaseManager.getInstance).not.toHaveBeenCalled();
  expect(getConversation).not.toHaveBeenCalled();
  expect(appendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: "assistant", status: "complete" }));
  expect(finishRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ usage: expect.objectContaining({ costMicroUsd: 0 }) }));
});

it("loads real project capabilities and preserves the authorized source scope for measurements", async () => {
  const asOf = Date.now() - 60_000;
  const window = { from: asOf - 86_400_000, to: asOf, compareFrom: asOf - 172_800_000, compareTo: asOf - 86_400_000, asOf };
  const key = { kid: "k1", secret: "test-only-snapshot-secret" };
  const token = await issueQueryContextToken({ ...window, projectId: PROJECT_ID, organizationId: ORG_ID, sourceScope: "all", sourceIds: [] }, key);
  const runner = vi.fn(async (input) => {
    expect(input.tools.window).toEqual(window);
    expect(input.history).toEqual([{ role: "user", text: "Check last week." }, { role: "assistant", text: "I checked last week." }]);
    expect(input.capabilities).toMatchObject({
      web: true, server: true,
      errorCollection: { configured: true, observed: true },
      standardEventsObserved: ["sign_up"],
      sources: { total: 2, active: 1, lastReceivedAt: 1000 },
    });
    expect(input.tools.authorized.allowedSourceIds).toEqual(["src_web", "src_server"]);
    return { status: "quota-exhausted", errorMessage: "This response reached Prism's per-run token limit. Try a narrower question; this is not your provider credit balance.", answer: null, repaired: false, steps: [], factIds: [], toolIds: [], artifactIds: [], eligibleToolIds: [], usage: { model: "test", gateway: "openrouter", upstreamProvider: null, promptTokens: 1, completionTokens: 2001, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: 1 }, quota: { decision: "denied-quota", limitType: null, retryAfterMs: null }, latencyMs: 1, modelMessages: [] } as AgentRunResult;
  });
  __setAssistantAgentRunnerForTests(runner);
  vi.mocked(getConversationBySlug).mockResolvedValue({ conversation: { id: "conv_1", slug: "chat_abc123def456" }, messages: [
    { id: "old_user", seq: 1, role: "user", status: "complete", parts: [{ type: "text", text: "Check last week." }] },
    { id: "old_answer", seq: 2, role: "assistant", status: "complete", parts: [{ type: "text", text: "I checked last week." }, { type: "trace-snapshot", payload: "must not enter model context" }] },
    { id: "failed_answer", seq: 3, role: "assistant", status: "failed", parts: [{ type: "text", text: "Incomplete answer" }] },
  ], activeRun: null } as never);
  vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_1" }, created: true } as never);
  vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
  vi.mocked(finishRun).mockResolvedValue({ finished: true } as never);
  const ctx = ctxFor({ slug: SLUG, conversationSlug: "chat_abc123def456" },
    { clientRequestId: "req_caps", content: "Why did errors increase?", queryContextToken: token }, USER_ID, "member",
    { PRISM_AI_ENABLED: "1", OPENROUTER_API_KEY: "test-only", QUERY_CONTEXT_TOKEN_KEY: key.secret });
  getInstance.mockReturnValue(makeMockDb((sql) => {
    if (sql.includes("FROM projects")) return [{ id: PROJECT_ID, organization_id: ORG_ID }];
    if (sql.includes("FROM project_sources")) return [
      { id: "src_web", platform: "web", active: true },
      { id: "src_server", platform: "server", active: false },
    ];
    if (sql.includes("member")) return [{ role: "member" }];
    return [];
  }) as never);
  const execute = vi.fn(async ({ sql, args }) => {
    if (sql.includes("source_error_settings")) {
      expect(args).toEqual(["src_web", "src_server"]);
      return { rows: [{ n: 1 }] };
    }
    expect(args[0]).toBe(PROJECT_ID);
    expect(args[1]).toBe(asOf);
    if (sql.includes("error_occurrences")) return { rows: [{ n: 1 }] };
    if (sql.includes("DISTINCT json_extract")) return { rows: [{ k: "sign_up" }] };
    return { rows: [{ source_id: "src_web", last_received_at: 1000 }] };
  });
  vi.mocked(TursoDatabaseManager.getInstance).mockReturnValue({ execute } as never);
  const response = await AssistantController.postMessage(ctx) as Response;
  const body = await readSse(response);
  expect(runner).toHaveBeenCalledOnce();
  expect(getConversation).not.toHaveBeenCalled();
  expect(body).toContain("per-run token limit");
  expect(body).not.toContain("Usage quota exhausted");
});

it("rejects a selected-source snapshot instead of widening it to all sources", async () => {
  const asOf = Date.now() - 60_000;
  const key = { kid: "k1", secret: "test-only-snapshot-secret" };
  const token = await issueQueryContextToken({ projectId: PROJECT_ID, organizationId: ORG_ID,
    from: asOf - 86_400_000, to: asOf, compareFrom: asOf - 172_800_000, compareTo: asOf - 86_400_000, asOf,
    sourceScope: "selected", sourceIds: [] }, key);
  vi.mocked(getConversationBySlug).mockResolvedValue({ conversation: { id: "conv_1", slug: "chat_abc123def456" }, messages: [], activeRun: null } as never);
  vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_1" }, created: true } as never);
  const response = await AssistantController.postMessage(ctxFor({ slug: SLUG, conversationSlug: "chat_abc123def456" },
    { clientRequestId: "req_scope", content: "Why did errors increase?", queryContextToken: token }, USER_ID, "member",
    { PRISM_AI_ENABLED: "1", OPENROUTER_API_KEY: "test-only", QUERY_CONTEXT_TOKEN_KEY: key.secret })) as Response;
  expect(await readSse(response)).toContain("Source-filtered snapshots are not supported");
  expect(startRun).not.toHaveBeenCalled();
});

describe("assistant stream frames", () => {
  it("encodes validated parts and rejects invalid ones", () => {
    const frame = encodeStreamFrame({
      kind: "data-run-start",
      runId: "run_1",
      conversationId: "conv_1",
    });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame).toContain("run_1");
    const parsed = JSON.parse(frame.slice("data: ".length));
    expect(parsed.kind).toBe("data-run-start");
    expect(() =>
      encodeStreamFrame({
        kind: "data-run-start",
        runId: "",
        conversationId: "conv_1",
      } as never),
    ).toThrow();
  });
});

describe("assistant quotas", () => {
  it("rate-limits repeated runs and reports retry time", () => {
    const quotas = new AssistantQuotas(
      resolveQuotaLimits({
        PRISM_AI_RUNS_PER_MINUTE_PER_USER: "2",
      }),
    );
    const scope = { userId: USER_ID, projectId: PROJECT_ID, organizationId: ORG_ID };
    expect(quotas.checkRate(scope).allowed).toBe(true);
    expect(quotas.checkRate(scope).allowed).toBe(true);
    const third = quotas.checkRate(scope);
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.reason).toBe("rate-limited");
      expect(third.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("denies exhausted daily quotas", () => {
    const quotas = new AssistantQuotas(
      resolveQuotaLimits({ PRISM_AI_DAILY_TOKENS_PER_USER: "100" }),
    );
    const now = Date.UTC(2026, 8, 5, 12);
    quotas.recordUsage({
      userId: USER_ID,
      organizationId: ORG_ID,
      promptTokens: 60,
      completionTokens: 50,
      costMicroUsd: 10,
      now,
    });
    const denied = quotas.checkDaily({ userId: USER_ID, organizationId: ORG_ID, now });
    expect(denied.allowed).toBe(false);
  });
});

describe("assistant auth boundary", () => {
  it("requires authentication on every route", async () => {
    const list = (await AssistantController.listConversations(
      ctxFor({ slug: SLUG }, null, null),
    )) as { __status?: number };
    expect(list.__status).toBe(401);
    const get = (await AssistantController.getConversation(
      ctxFor({ slug: SLUG, conversationSlug: "conv_1" }, null, null),
    )) as { __status?: number };
    expect(get.__status).toBe(401);
    const del = (await AssistantController.deleteConversation(
      ctxFor({ slug: SLUG, conversationSlug: "conv_1" }, null, null),
    )) as { __status?: number };
    expect(del.__status).toBe(401);
    const mem = (await AssistantController.getMemory(
      ctxFor({ slug: SLUG }, null, null),
    )) as { __status?: number };
    expect(mem.__status).toBe(401);
  });

  it("hides projects from non-members with 404", async () => {
    const result = (await AssistantController.listConversations(
      ctxFor({ slug: SLUG }, null, USER_ID, null),
    )) as { __status?: number };
    expect(result.__status).toBe(404);
  });

  it("hides foreign conversations with 404", async () => {
    vi.mocked(getConversationBySlug).mockResolvedValue(null);
    const result = (await AssistantController.getConversation(
      ctxFor({ slug: SLUG, conversationSlug: "conv_foreign" }, null, USER_ID),
    )) as { __status?: number };
    expect(result.__status).toBe(404);
  });

  it("never shows another member's prefs in memory reads", async () => {
    vi.mocked(listMemory).mockResolvedValue([
      {
        id: "mem_other",
        organizationId: ORG_ID,
        scope: "member",
        key: "preferred-comparison-range",
        projectId: null,
        subjectUserId: OTHER_USER,
        status: "confirmed",
        value: {
          version: 1,
          label: "Range",
          description: "Prefer 30d.",
          payload: { range: "30d" },
        },
        proposerId: OTHER_USER,
        confirmerId: OTHER_USER,
        createdAt: 1,
        updatedAt: 1,
      } as never,
    ]);
    const result = (await AssistantController.getMemory(
      ctxFor({ slug: SLUG }, null, USER_ID),
    )) as { __json?: { records?: unknown[] } };
    expect(result.__json?.records).toEqual([]);
  });
});

describe("assistant validation", () => {
  it("rejects malformed conversation creation with 400", async () => {
    const result = (await AssistantController.createConversation(
      ctxFor({ slug: SLUG }, { nonsense: true }, USER_ID),
    )) as { __status?: number };
    expect(result.__status).toBe(400);
    expect(vi.mocked(createConversationWithFirstMessage)).not.toHaveBeenCalled();
  });

  it("rejects malformed message posts with 400", async () => {
    vi.mocked(getConversationBySlug).mockResolvedValue({
      conversation: {
        id: "conv_1",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      messages: [],
      activeRun: null,
    } as never);
    const result = (await AssistantController.postMessage(
      ctxFor({ slug: SLUG, conversationSlug: "conv_1" }, { content: "" }, USER_ID),
    )) as { __status?: number };
    expect(result.__status).toBe(400);
  });

  it("rejects tampered history cursors with 400", async () => {
    vi.mocked(listConversations).mockRejectedValue(
      new AssistantStoreError("invalid-input", "Invalid history cursor"),
    );
    const ctx = ctxFor({ slug: SLUG }, null, USER_ID) as unknown as {
      req: { query: ReturnType<typeof vi.fn> };
    };
    ctx.req.query.mockImplementation(
      (key: string) => (key === "cursor" ? "tampered" : undefined),
    );
    const result = (await AssistantController.listConversations(
      ctx as never,
    )) as {
      __status?: number;
    };
    expect(result.__status).toBe(400);
  });
});

describe("assistant runs", () => {
  it("streams a disabled error when AI is not configured", async () => {
    vi.mocked(getConversationBySlug).mockResolvedValue({
      conversation: {
        id: "conv_1",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello world",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      messages: [],
      activeRun: null,
    } as never);
    vi.mocked(appendMessage).mockResolvedValue({
      message: { id: "msg_1" },
      created: true,
    } as never);
    vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
    vi.mocked(finishRun).mockResolvedValue({ finished: true, run: { id: "run_1" } } as never);
    // No snapshot token: skips verification and reaches the disabled gate
    // (resolveAssistantModelConfig fails closed with no key in env).
    const response = (await AssistantController.postMessage(
      ctxFor(
        { slug: SLUG, conversationSlug: "chat_abc123def456" },
        { clientRequestId: "req_1", content: "How are signups?" },
        USER_ID,
        "member",
        {},
      ),
    )) as unknown as Response;
    expect(response).toBeInstanceOf(Response);
    const text = await readSse(response);
    expect(text).toContain("data-run-error");
    expect(text).toContain("disabled");
    // No partial answer is ever persisted as complete on this path.
    expect(vi.mocked(appendMessage)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "complete", role: "assistant" }),
    );
  });

  it("returns 409 on duplicate creation payloads", async () => {
    vi.mocked(createConversationWithFirstMessage).mockRejectedValue(
      new AssistantStoreError("idempotency-conflict", "reuse with different content"),
    );
    const result = (await AssistantController.createConversation(
      ctxFor(
        { slug: SLUG },
        {
          clientRequestId: "req_dup",
          firstMessage: "How are signups?",
          seed: null,
          queryContextToken: "opaque-token-12345678",
        },
        USER_ID,
      ),
    )) as { __status?: number };
    expect(result.__status).toBe(409);
  });

  it("echoes the chat slug (never the row ID) on every stream", async () => {
    vi.mocked(createConversationWithFirstMessage).mockResolvedValue({
      conversation: {
        id: "conv_secret_row_id",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello world",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      message: { id: "msg_1" },
      createdConversation: true,
      createdMessage: true,
    } as never);
    vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
    vi.mocked(finishRun).mockResolvedValue({ finished: true, run: { id: "run_1" } } as never);
    const response = (await AssistantController.createConversation(
      ctxFor(
        { slug: SLUG },
        {
          clientRequestId: "req_slug",
          firstMessage: "How are signups?",
          seed: null,
          queryContextToken: "opaque-token-12345678",
        },
        USER_ID,
        "member",
        {},
      ),
    )) as unknown as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("X-Conversation-Slug")).toBe("chat_abc123def456");
  });

  it("returns 409 on duplicate message request IDs (reconnect replays)", async () => {
    vi.mocked(getConversationBySlug).mockResolvedValue({
      conversation: {
        id: "conv_1",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      messages: [],
      activeRun: null,
    } as never);
    vi.mocked(appendMessage).mockRejectedValue(
      new AssistantStoreError("idempotency-conflict", "reuse with different content"),
    );
    const result = (await AssistantController.postMessage(
      ctxFor(
        { slug: SLUG, conversationSlug: "chat_abc123def456" },
        { clientRequestId: "req_dup", content: "And now?" },
        USER_ID,
      ),
    )) as { __status?: number };
    expect(result.__status).toBe(409);
  });

  it("reports one-active-run as a retryable stream error", async () => {
    vi.mocked(getConversationBySlug).mockResolvedValue({
      conversation: {
        id: "conv_1",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      messages: [],
      activeRun: null,
    } as never);
    vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_2" }, created: true } as never);
    vi.mocked(startRun).mockResolvedValue({
      ok: false,
      conflict: {
        code: "active-run-exists",
        projectId: PROJECT_ID,
        userId: USER_ID,
        activeConversationId: "conv_1",
        activeRunId: "run_active",
      },
    } as never);
    const response = (await AssistantController.postMessage(
      ctxFor(
        { slug: SLUG, conversationSlug: "chat_abc123def456" },
        { clientRequestId: "req_new", content: "And now?" },
        USER_ID,
      ),
    )) as unknown as Response;
    const text = await readSse(response);
    expect(text).toContain("already running");
  });

  it("rate-limited runs stream a retryable quota error", async () => {
    __setAssistantQuotasForTests(
      new AssistantQuotas(
        resolveQuotaLimits({ PRISM_AI_RUNS_PER_MINUTE_PER_USER: "1" }),
      ),
    );
    vi.mocked(getConversationBySlug).mockResolvedValue({
      conversation: {
        id: "conv_1",
        slug: "chat_abc123def456",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        title: "Hello",
        seed: null,
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      },
      messages: [],
      activeRun: null,
    } as never);
    vi.mocked(appendMessage).mockResolvedValue({ message: { id: "msg_2" }, created: true } as never);
    vi.mocked(startRun).mockResolvedValue({ ok: true, run: { id: "run_1" } } as never);
    vi.mocked(finishRun).mockResolvedValue({ finished: true, run: { id: "run_1" } } as never);
    const body = { clientRequestId: "req_a", content: "Hello?" };
    // First run consumes the allowance (disabled stream still counts).
    await AssistantController.postMessage(ctxFor({ slug: SLUG, conversationSlug: "chat_abc123def456" }, body, USER_ID));
    const second = (await AssistantController.postMessage(
      ctxFor({ slug: SLUG, conversationSlug: "chat_abc123def456" }, { ...body, clientRequestId: "req_b" }, USER_ID),
    )) as unknown as Response;
    const text = await readSse(second);
    expect(text).toContain("quota-exhausted");
    // The rejected run never started paid work.
    expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
  });
});

describe("assistant memory writes", () => {
  it("forbids member confirmation of shared definitions with 403", async () => {
    vi.mocked(confirmMemoryProposal).mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });
    const result = (await AssistantController.confirmProposal(
      ctxFor({ slug: SLUG, proposalId: "mem_1" }, null, USER_ID, "member"),
    )) as { __status?: number };
    expect(result.__status).toBe(403);
  });

  it("maps slot races to 409 and double-confirm to 409", async () => {
    vi.mocked(confirmMemoryProposal).mockResolvedValue({
      ok: false,
      reason: "slot-conflict",
    });
    const raced = (await AssistantController.confirmProposal(
      ctxFor({ slug: SLUG, proposalId: "mem_1" }, null, USER_ID, "owner"),
    )) as { __status?: number };
    expect(raced.__status).toBe(409);
    vi.mocked(confirmMemoryProposal).mockResolvedValue({
      ok: false,
      reason: "not-proposed",
    });
    const twice = (await AssistantController.rejectProposal(
      ctxFor({ slug: SLUG, proposalId: "mem_1" }, null, USER_ID, "owner"),
    )) as { __status?: number };
    expect(twice.__status).toBe(409);
  });

  it("hides unknown proposals with 404", async () => {
    vi.mocked(confirmMemoryProposal).mockResolvedValue({
      ok: false,
      reason: "not-found",
    });
    const result = (await AssistantController.confirmProposal(
      ctxFor({ slug: SLUG, proposalId: "mem_missing" }, null, USER_ID, "owner"),
    )) as { __status?: number };
    expect(result.__status).toBe(404);
  });
});

describe("assistant deletion", () => {
  it("deletes an owned chat and reports aborts", async () => {
    vi.mocked(deleteConversation).mockResolvedValue({ deleted: true, abortedRun: true });
    const result = (await AssistantController.deleteConversation(
      ctxFor({ slug: SLUG, conversationSlug: "chat_abc123def456" }, null, USER_ID),
    )) as { __json?: Record<string, unknown> };
    expect(result.__json).toMatchObject({ deleted: true, abortedRun: true });
  });

  it("returns 404 for missing or foreign chats", async () => {
    vi.mocked(deleteConversation).mockResolvedValue({ deleted: false, abortedRun: false });
    const result = (await AssistantController.deleteConversation(
      ctxFor({ slug: SLUG, conversationSlug: "chat_missing00000" }, null, USER_ID),
    )) as { __status?: number };
    expect(result.__status).toBe(404);
  });
});
