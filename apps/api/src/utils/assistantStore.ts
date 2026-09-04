/**
 * Assistant control-plane store (Task 21 slice 4).
 *
 * Durable foundation for conversations, messages, runs, typed memory, and
 * audit history — without invoking any model. Every function takes
 * server-verified IDs (never slugs, never model values) and scopes every
 * query by them, so cross-user and cross-project reads are impossible by
 * construction. Membership/role checks stay at the controller boundary
 * (slice 6); the store additionally scopes by the verified IDs it is
 * given, which is what the authorization tests prove.
 *
 * Neon-HTTP compatibility: every operation is one SQL statement (CTEs
 * where several rows must change atomically). There are deliberately NO
 * multi-statement transactions — the Cloudflare Worker driver is
 * stateless. Races resolve through constraints:
 * - duplicate creation/submission converges via idempotency uniques,
 * - message sequencing retries on the `(conversation_id, seq)` conflict,
 * - the one-active-run rule is a partial unique index,
 * - proposal confirmation is `UPDATE ... WHERE status = 'proposed'`.
 *
 * Timestamps are millisecond epochs supplied by the caller (`now`) so
 * tests are deterministic.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AGENT_LIMITS,
  ANSWER_LIMITS,
  AssistantMessagePartSchema,
  AssistantMessageSchema,
  AssistantRunSchema,
  canConfirmMemory,
  ConversationSchema,
  decodeConversationCursor,
  DEFINITION_VERSION,
  deriveChatTitle,
  encodeConversationCursor,
  InsightSeedSchema,
  MemoryRecordSchema,
  RunConflictSchema,
  RunUsageSchema,
  ToolIdSchema,
  transitionProposal,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantMessagePart,
  type AssistantRun,
  type InsightSeed,
  type MemoryKey,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStatus,
  type RunConflict,
} from "@prism-analytics/types";

/** Minimal query surface: the tagged-template call shape of ProductQuery. */
export type AssistantDb = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export class AssistantStoreError extends Error {
  readonly code: "not-found" | "invalid-input" | "invalid-output";
  constructor(
    code: AssistantStoreError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

const MESSAGE_ROLES = ["user", "assistant"] as const;
const MESSAGE_STATUSES = [
  "pending",
  "streaming",
  "complete",
  "cancelled",
  "failed",
] as const;
const RUN_FINISH_STATUSES = ["complete", "cancelled", "failed"] as const;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") {
    return Number(value);
  }
  throw new AssistantStoreError("invalid-output", "Expected a numeric value");
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value);
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new AssistantStoreError("invalid-output", "Expected a string value");
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23503"
  );
}

function requireId(name: string, value: string): void {
  if (!value || value.length > 128) {
    throw new AssistantStoreError("invalid-input", `${name} is required`);
  }
}

/* ------------------------------------------------------------------ */
/* Row mapping (snake_case rows → contract shapes, validated)          */
/* ------------------------------------------------------------------ */

function mustParse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AssistantStoreError(
      "invalid-output",
      `Stored ${what} failed contract validation`,
    );
  }
  return parsed.data;
}

function mapConversation(row: Record<string, unknown>): AssistantConversation {
  return mustParse(ConversationSchema, {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    projectId: asString(row.project_id),
    userId: asString(row.user_id),
    title: asString(row.title),
    seed:
      row.seed_insight_id === null || row.seed_insight_id === undefined
        ? null
        : { type: "insight", insightId: asString(row.seed_insight_id) },
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    lastMessageAt: asNullableNumber(row.last_message_at),
  }, "conversation");
}

function mapMessage(row: Record<string, unknown>): AssistantMessage {
  return mustParse(AssistantMessageSchema, {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    seq: asNumber(row.seq),
    role: asString(row.role),
    status: asString(row.status),
    parts: (row.parts ?? []) as unknown,
    failureCode: asNullableString(row.failure_code),
    clientRequestId: asNullableString(row.client_request_id),
    createdAt: asNumber(row.created_at),
    completedAt: asNullableNumber(row.completed_at),
  }, "message");
}

function mapRun(row: Record<string, unknown>): AssistantRun {
  return mustParse(AssistantRunSchema, {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    messageId: asString(row.message_id),
    projectId: asString(row.project_id),
    userId: asString(row.user_id),
    queryContextHash: asString(row.query_context_hash),
    definitionVersion: asNumber(row.definition_version),
    model: asString(row.model),
    provider: asString(row.provider),
    status: asString(row.status),
    stepCount: asNumber(row.step_count),
    toolIds: (row.tool_ids ?? []) as unknown,
    usage: (row.usage ?? null) as unknown,
    factIds: (row.fact_ids ?? []) as unknown,
    artifactIds: (row.artifact_ids ?? []) as unknown,
    latencyMs: asNullableNumber(row.latency_ms),
    startedAt: asNumber(row.started_at),
    completedAt: asNullableNumber(row.completed_at),
    failureCode: asNullableString(row.failure_code),
  }, "run");
}

const MemoryAuditSchema = z.strictObject({
  id: z.string().min(1).max(128),
  memoryId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  action: z.string().min(1).max(64),
  fromStatus: z.string().max(64).nullable(),
  toStatus: z.string().min(1).max(64),
  actorId: z.string().min(1).max(128).nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type MemoryAuditEntry = z.infer<typeof MemoryAuditSchema>;

function mapMemory(row: Record<string, unknown>): MemoryRecord {
  const scope = asString(row.scope) as MemoryScope;
  const base = {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    scope,
    key: asString(row.key),
    status: asString(row.status),
    value: {
      version: asNumber(row.version),
      label: asString(row.label),
      description: asString(row.description),
      payload: (row.payload ?? {}) as unknown,
    },
    proposerId: asNullableString(row.proposer_id),
    confirmerId: asNullableString(row.confirmer_id),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
  if (scope === "project") {
    return mustParse(MemoryRecordSchema, {
      ...base,
      projectId: asString(row.project_id),
      subjectUserId: null,
    }, "memory record");
  }
  if (scope === "workspace") {
    return mustParse(MemoryRecordSchema, {
      ...base,
      projectId: null,
      subjectUserId: null,
    }, "memory record");
  }
  return mustParse(MemoryRecordSchema, {
    ...base,
    projectId:
      row.project_id === null || row.project_id === undefined
        ? null
        : asString(row.project_id),
    subjectUserId: asString(row.subject_user_id),
  }, "memory record");
}

function mapAudit(row: Record<string, unknown>): MemoryAuditEntry {
  return mustParse(MemoryAuditSchema, {
    id: asString(row.id),
    memoryId: asString(row.memory_id),
    organizationId: asString(row.organization_id),
    action: asString(row.action),
    fromStatus: asNullableString(row.from_status),
    toStatus: asString(row.to_status),
    actorId: asNullableString(row.actor_id),
    createdAt: asNumber(row.created_at),
  }, "memory audit entry");
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export type CreateConversationInput = {
  organizationId: string;
  projectId: string;
  userId: string;
  clientRequestId: string;
  firstMessage: string;
  /** Insight seed that created the chat, if any (reference only). */
  seed: InsightSeed | null;
  /**
   * Opaque snapshot token from the create request. Accepted and carried
   * for the first run; cryptographic verification happens at run start
   * (slice 6), never here.
   */
  queryContextToken: string;
  now: number;
};

function validateCreateInput(input: CreateConversationInput): void {
  requireId("organizationId", input.organizationId);
  requireId("projectId", input.projectId);
  requireId("userId", input.userId);
  requireId("clientRequestId", input.clientRequestId);
  if (
    typeof input.firstMessage !== "string" ||
    input.firstMessage.length < 1 ||
    input.firstMessage.length > ANSWER_LIMITS.maxQuestionChars
  ) {
    throw new AssistantStoreError(
      "invalid-input",
      `firstMessage must be 1..${ANSWER_LIMITS.maxQuestionChars} chars`,
    );
  }
  const seed = InsightSeedSchema.nullable().safeParse(input.seed);
  if (!seed.success) {
    throw new AssistantStoreError("invalid-input", "Invalid insight seed");
  }
  if (
    typeof input.queryContextToken !== "string" ||
    input.queryContextToken.length < 1
  ) {
    throw new AssistantStoreError(
      "invalid-input",
      "queryContextToken is required",
    );
  }
}

/**
 * Lazy chat creation with atomic first-message persistence. No chat row
 * exists until the member actually submits: this call inserts the
 * conversation and its `seq: 0` user message, converging idempotently on
 * `clientRequestId` — duplicate submissions (double-click, retry, two
 * tabs) return the same conversation and message instead of doubling
 * them. A crash between the two inserts heals on retry: the existing
 * conversation is reused and the missing first message is inserted.
 */
export async function createConversationWithFirstMessage(
  db: AssistantDb,
  input: CreateConversationInput,
): Promise<{
  conversation: AssistantConversation;
  message: AssistantMessage;
  createdConversation: boolean;
  createdMessage: boolean;
}> {
  validateCreateInput(input);
  const {
    organizationId,
    projectId,
    userId,
    clientRequestId,
    firstMessage,
    seed,
    now,
  } = input;
  const title = deriveChatTitle(firstMessage);
  const parts: AssistantMessagePart[] = [{ type: "text", text: firstMessage }];

  let inserted: Array<Record<string, unknown>>;
  try {
    inserted = await db`
      INSERT INTO assistant_conversations
        (id, organization_id, project_id, user_id, title, seed_insight_id,
         client_request_id, created_at, updated_at, last_message_at)
      VALUES (${newId("conv")}, ${organizationId}, ${projectId}, ${userId},
        ${title}, ${seed?.insightId ?? null}, ${clientRequestId}, ${now},
        ${now}, ${now})
      ON CONFLICT (project_id, user_id, client_request_id)
        WHERE client_request_id IS NOT NULL
      DO NOTHING
      RETURNING *`;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AssistantStoreError("not-found", "Project not found");
    }
    throw error;
  }
  const createdConversation = inserted.length > 0;
  let convRow = inserted[0];
  if (!convRow) {
    const existing = await db`
      SELECT * FROM assistant_conversations
      WHERE project_id = ${projectId} AND user_id = ${userId}
        AND client_request_id = ${clientRequestId}`;
    convRow = existing[0];
    if (!convRow) {
      throw new AssistantStoreError(
        "invalid-output",
        "Conversation conflict converged on no row",
      );
    }
  }
  const conversationId = asString(convRow.id);

  const msgInserted = await db`
    INSERT INTO assistant_messages
      (id, conversation_id, seq, role, status, parts, failure_code,
       client_request_id, created_at, completed_at)
    VALUES (${newId("msg")}, ${conversationId}, 0, 'user', 'complete',
      ${JSON.stringify(parts)}::jsonb, NULL, ${clientRequestId}, ${now},
      ${now})
    ON CONFLICT (conversation_id, client_request_id)
      WHERE client_request_id IS NOT NULL
    DO NOTHING
    RETURNING *`;
  const createdMessage = msgInserted.length > 0;
  let msgRow = msgInserted[0];
  if (!msgRow) {
    const existing = await db`
      SELECT * FROM assistant_messages
      WHERE conversation_id = ${conversationId}
        AND client_request_id = ${clientRequestId}
      ORDER BY seq ASC LIMIT 1`;
    msgRow = existing[0];
    if (!msgRow) {
      throw new AssistantStoreError(
        "invalid-output",
        "Message conflict converged on no row",
      );
    }
  } else if (!createdConversation) {
    // Retry healed a crash between the inserts: align the chat clock.
    await db`
      UPDATE assistant_conversations
      SET last_message_at = ${now}, updated_at = ${now}
      WHERE id = ${conversationId}`;
    const refreshed = await db`
      SELECT * FROM assistant_conversations WHERE id = ${conversationId}`;
    if (refreshed[0]) convRow = refreshed[0];
  }

  return {
    conversation: mapConversation(convRow),
    message: mapMessage(msgRow),
    createdConversation,
    createdMessage,
  };
}

export type ConversationScope = {
  organizationId?: string;
  projectId: string;
  userId: string;
};

export type ListConversationsInput = ConversationScope & {
  limit?: number;
  /** Opaque cursor from a previous page (untrusted client input). */
  cursor?: string | null;
};

export type ConversationListPage = {
  items: Array<{
    id: string;
    title: string;
    lastMessageAt: number | null;
    messageCount: number;
    hasActiveRun: boolean;
  }>;
  nextCursor: string | null;
};

/**
 * Chat history for one member's project chats, most-recent-first with a
 * stable `(lastMessageAt DESC NULLS LAST, id DESC)` keyset cursor.
 * Chats without messages sort last. The cursor is pagination-only (it
 * carries no authorization); every read stays bound to the verified
 * `(projectId, userId)`.
 */
export async function listConversations(
  db: AssistantDb,
  input: ListConversationsInput,
): Promise<ConversationListPage> {
  requireId("projectId", input.projectId);
  requireId("userId", input.userId);
  const limit = Math.min(
    Math.max(input.limit ?? 20, 1),
    50,
  );
  let cursorActive = false;
  let cursorTime: number | null = null;
  let cursorId = "";
  if (input.cursor !== undefined && input.cursor !== null) {
    const decoded = decodeConversationCursor(input.cursor);
    if (!decoded) {
      throw new AssistantStoreError("invalid-input", "Invalid history cursor");
    }
    cursorActive = true;
    cursorTime = decoded.lastMessageAt;
    cursorId = decoded.id;
  }
  const rows = await db`
    SELECT c.*,
      (SELECT COUNT(*) FROM assistant_messages m
        WHERE m.conversation_id = c.id) AS message_count,
      EXISTS (SELECT 1 FROM assistant_runs r
        WHERE r.conversation_id = c.id AND r.status = 'running'
      ) AS has_active_run
    FROM assistant_conversations c
    WHERE c.project_id = ${input.projectId} AND c.user_id = ${input.userId}
      AND (
        ${cursorActive}::boolean = FALSE
        OR (
          ${cursorTime}::bigint IS NOT NULL
          AND (
            c.last_message_at < ${cursorTime}
            OR (c.last_message_at = ${cursorTime} AND c.id < ${cursorId})
            OR c.last_message_at IS NULL
          )
        )
        OR (
          ${cursorActive}::boolean = TRUE AND ${cursorTime}::bigint IS NULL
          AND c.last_message_at IS NULL AND c.id < ${cursorId}
        )
      )
    ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
    LIMIT ${limit + 1}`;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((row) => ({
    id: asString(row.id),
    title: asString(row.title),
    lastMessageAt: asNullableNumber(row.last_message_at),
    messageCount: asNumber(row.message_count),
    hasActiveRun: row.has_active_run === true,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeConversationCursor({
            lastMessageAt: last.lastMessageAt,
            id: last.id,
          })
        : null,
  };
}

/**
 * One chat with its ordered transcript and active run, or `null` when the
 * conversation does not belong to `(projectId, userId)` — missing and
 * foreign chats are indistinguishable (non-disclosing).
 */
export async function getConversation(
  db: AssistantDb,
  input: ConversationScope & { conversationId: string },
): Promise<{
  conversation: AssistantConversation;
  messages: AssistantMessage[];
  activeRun: AssistantRun | null;
} | null> {
  requireId("conversationId", input.conversationId);
  const convRows = await db`
    SELECT * FROM assistant_conversations
    WHERE id = ${input.conversationId}
      AND project_id = ${input.projectId}
      AND user_id = ${input.userId}`;
  const convRow = convRows[0];
  if (!convRow) return null;
  const msgRows = await db`
    SELECT * FROM assistant_messages
    WHERE conversation_id = ${input.conversationId}
    ORDER BY seq ASC`;
  const runRows = await db`
    SELECT * FROM assistant_runs
    WHERE conversation_id = ${input.conversationId} AND status = 'running'
    ORDER BY started_at DESC LIMIT 1`;
  return {
    conversation: mapConversation(convRow),
    messages: msgRows.map(mapMessage),
    activeRun: runRows[0] ? mapRun(runRows[0]) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type AppendMessageInput = ConversationScope & {
  conversationId: string;
  role: "user" | "assistant";
  status: "pending" | "streaming" | "complete" | "cancelled" | "failed";
  parts: AssistantMessagePart[];
  failureCode?: string | null;
  clientRequestId?: string | null;
  completedAt?: number | null;
  now: number;
};

const MAX_SEQ_ATTEMPTS = 6;

/**
 * Atomic message sequencing. The next `seq` is `MAX(seq) + 1` computed in
 * the insert statement itself, and the conversation clock moves in the
 * same statement — so concurrent appends from two tabs serialize on the
 * `(conversation_id, seq)` unique constraint and the loser retries
 * against the new max. Retried submissions carrying `clientRequestId`
 * converge on the existing row instead of doubling.
 */
export async function appendMessage(
  db: AssistantDb,
  input: AppendMessageInput,
): Promise<{ message: AssistantMessage; created: boolean }> {
  requireId("conversationId", input.conversationId);
  if (!(MESSAGE_ROLES as readonly string[]).includes(input.role)) {
    throw new AssistantStoreError("invalid-input", "Invalid message role");
  }
  if (!(MESSAGE_STATUSES as readonly string[]).includes(input.status)) {
    throw new AssistantStoreError("invalid-input", "Invalid message status");
  }
  const partsCheck = z
    .array(AssistantMessagePartSchema)
    .max(16)
    .safeParse(input.parts);
  if (!partsCheck.success) {
    throw new AssistantStoreError("invalid-input", "Invalid message parts");
  }
  const parts = partsCheck.data;
  if (
    input.failureCode !== undefined &&
    input.failureCode !== null &&
    input.failureCode.length > 64
  ) {
    throw new AssistantStoreError("invalid-input", "failureCode too long");
  }
  const clientRequestId = input.clientRequestId ?? null;
  if (clientRequestId !== null && clientRequestId.length > 128) {
    throw new AssistantStoreError("invalid-input", "clientRequestId too long");
  }

  const owned = await db`
    SELECT id FROM assistant_conversations
    WHERE id = ${input.conversationId}
      AND project_id = ${input.projectId}
      AND user_id = ${input.userId}`;
  if (!owned[0]) {
    throw new AssistantStoreError("not-found", "Conversation not found");
  }

  if (clientRequestId !== null) {
    const existing = await db`
      SELECT * FROM assistant_messages
      WHERE conversation_id = ${input.conversationId}
        AND client_request_id = ${clientRequestId}
      ORDER BY seq ASC LIMIT 1`;
    if (existing[0]) {
      return { message: mapMessage(existing[0]), created: false };
    }
  }

  const failureCode = input.failureCode ?? null;
  const completedAt = input.completedAt ?? null;
  const partsJson = JSON.stringify(parts);
  for (let attempt = 0; attempt < MAX_SEQ_ATTEMPTS; attempt += 1) {
    try {
      const id = newId("msg");
      let rows: Array<Record<string, unknown>>;
      if (clientRequestId !== null) {
        rows = await db`
          WITH m AS (
            INSERT INTO assistant_messages
              (id, conversation_id, seq, role, status, parts, failure_code,
               client_request_id, created_at, completed_at)
            SELECT ${id}, ${input.conversationId},
              COALESCE((SELECT MAX(seq) FROM assistant_messages
                WHERE conversation_id = ${input.conversationId}), -1) + 1,
              ${input.role}, ${input.status}, ${partsJson}::jsonb,
              ${failureCode}, ${clientRequestId}, ${input.now}, ${completedAt}
            ON CONFLICT (conversation_id, client_request_id)
              WHERE client_request_id IS NOT NULL
            DO NOTHING
            RETURNING *
          ),
          u AS (
            UPDATE assistant_conversations
            SET last_message_at = (SELECT created_at FROM m),
                updated_at = (SELECT created_at FROM m)
            WHERE id = ${input.conversationId}
              AND EXISTS (SELECT 1 FROM m)
            RETURNING id
          )
          SELECT * FROM m`;
      } else {
        rows = await db`
          WITH m AS (
            INSERT INTO assistant_messages
              (id, conversation_id, seq, role, status, parts, failure_code,
               client_request_id, created_at, completed_at)
            SELECT ${id}, ${input.conversationId},
              COALESCE((SELECT MAX(seq) FROM assistant_messages
                WHERE conversation_id = ${input.conversationId}), -1) + 1,
              ${input.role}, ${input.status}, ${partsJson}::jsonb,
              ${failureCode}, NULL, ${input.now}, ${completedAt}
            RETURNING *
          ),
          u AS (
            UPDATE assistant_conversations
            SET last_message_at = (SELECT created_at FROM m),
                updated_at = (SELECT created_at FROM m)
            WHERE id = ${input.conversationId}
              AND EXISTS (SELECT 1 FROM m)
            RETURNING id
          )
          SELECT * FROM m`;
      }
      if (rows[0]) {
        return { message: mapMessage(rows[0]), created: true };
      }
      // Idempotent retry won the conflict race after our pre-check missed:
      // converge on the existing row.
      if (clientRequestId !== null) {
        const existing = await db`
          SELECT * FROM assistant_messages
          WHERE conversation_id = ${input.conversationId}
            AND client_request_id = ${clientRequestId}
          ORDER BY seq ASC LIMIT 1`;
        if (existing[0]) {
          return { message: mapMessage(existing[0]), created: false };
        }
      }
      throw new AssistantStoreError(
        "invalid-output",
        "Message insert converged on no row",
      );
    } catch (error) {
      if (isUniqueViolation(error) && attempt + 1 < MAX_SEQ_ATTEMPTS) {
        continue;
      }
      if (isForeignKeyViolation(error)) {
        throw new AssistantStoreError("not-found", "Conversation not found");
      }
      throw error;
    }
  }
  throw new AssistantStoreError(
    "invalid-output",
    "Message sequencing did not converge",
  );
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export type StartRunInput = ConversationScope & {
  organizationId: string;
  conversationId: string;
  messageId: string;
  queryContextHash: string;
  model: string;
  now: number;
};

/**
 * Start one agent run. The database owns the one-active-run-per-
 * `(project, user)` rule through the partial unique index: a concurrent
 * second start loses the insert and receives the winner's run identity
 * (`active-run-exists`) instead of running twice. Browsing or retaining
 * other chats is unaffected — only a second *running* run is refused.
 */
export async function startRun(
  db: AssistantDb,
  input: StartRunInput,
): Promise<{ ok: true; run: AssistantRun } | { ok: false; conflict: RunConflict }> {
  requireId("organizationId", input.organizationId);
  requireId("conversationId", input.conversationId);
  requireId("messageId", input.messageId);
  requireId("model", input.model);
  if (!input.queryContextHash || input.queryContextHash.length > 128) {
    throw new AssistantStoreError(
      "invalid-input",
      "queryContextHash is required",
    );
  }
  const convRows = await db`
    SELECT id FROM assistant_conversations
    WHERE id = ${input.conversationId}
      AND project_id = ${input.projectId}
      AND user_id = ${input.userId}`;
  if (!convRows[0]) {
    throw new AssistantStoreError("not-found", "Conversation not found");
  }
  const msgRows = await db`
    SELECT id FROM assistant_messages
    WHERE id = ${input.messageId}
      AND conversation_id = ${input.conversationId}`;
  if (!msgRows[0]) {
    throw new AssistantStoreError("not-found", "Message not found");
  }

  const inserted = await db`
    INSERT INTO assistant_runs
      (id, conversation_id, message_id, project_id, user_id,
       query_context_hash, definition_version, model, provider, status,
       step_count, tool_ids, usage, fact_ids, artifact_ids, latency_ms,
       started_at, completed_at, failure_code)
    VALUES (${newId("run")}, ${input.conversationId}, ${input.messageId},
      ${input.projectId}, ${input.userId}, ${input.queryContextHash},
      ${DEFINITION_VERSION}, ${input.model}, 'openrouter', 'running',
      0, '[]'::jsonb, NULL, '[]'::jsonb, '[]'::jsonb, NULL, ${input.now},
      NULL, NULL)
    ON CONFLICT (project_id, user_id) WHERE status = 'running'
    DO NOTHING
    RETURNING *`;
  if (inserted[0]) {
    return { ok: true, run: mapRun(inserted[0]) };
  }
  const active = await db`
    SELECT * FROM assistant_runs
    WHERE project_id = ${input.projectId} AND user_id = ${input.userId}
      AND status = 'running'
    ORDER BY started_at DESC LIMIT 1`;
  const row = active[0];
  if (!row) {
    throw new AssistantStoreError(
      "invalid-output",
      "Run conflict converged on no row",
    );
  }
  return {
    ok: false,
    conflict: mustParse(RunConflictSchema, {
      code: "active-run-exists",
      projectId: asString(row.project_id),
      userId: asString(row.user_id),
      activeConversationId: asString(row.conversation_id),
      activeRunId: asString(row.id),
    }, "run conflict"),
  };
}

export type FinishRunInput = ConversationScope & {
  runId: string;
  status: "complete" | "cancelled" | "failed";
  stepCount?: number;
  toolIds?: string[];
  usage?: unknown;
  factIds?: string[];
  artifactIds?: string[];
  latencyMs?: number | null;
  failureCode?: string | null;
  now: number;
};

/**
 * Finish a running run. Re-finishing an already-finished run returns it
 * unchanged (idempotent reconnect path) instead of erroring.
 */
export async function finishRun(
  db: AssistantDb,
  input: FinishRunInput,
): Promise<{ finished: boolean; run: AssistantRun }> {
  requireId("runId", input.runId);
  if (!(RUN_FINISH_STATUSES as readonly string[]).includes(input.status)) {
    throw new AssistantStoreError("invalid-input", "Invalid run status");
  }
  const stepCount = input.stepCount ?? 0;
  if (!Number.isInteger(stepCount) || stepCount < 0 || stepCount > 6) {
    throw new AssistantStoreError("invalid-input", "Invalid step count");
  }
  const toolIds = input.toolIds ?? [];
  for (const id of toolIds) {
    if (!ToolIdSchema.safeParse(id).success) {
      throw new AssistantStoreError("invalid-input", `Unknown tool ${id}`);
    }
  }
  if (toolIds.length > 6) {
    throw new AssistantStoreError("invalid-input", "Too many tool IDs");
  }
  const usage = input.usage ?? null;
  if (usage !== null && !RunUsageSchema.safeParse(usage).success) {
    throw new AssistantStoreError("invalid-input", "Invalid run usage");
  }
  const factIds = input.factIds ?? [];
  const artifactIds = input.artifactIds ?? [];
  if (factIds.length > 64 || artifactIds.length > 16) {
    throw new AssistantStoreError("invalid-input", "Too many references");
  }
  if (
    input.failureCode !== undefined &&
    input.failureCode !== null &&
    input.failureCode.length > 64
  ) {
    throw new AssistantStoreError("invalid-input", "failureCode too long");
  }
  const updated = await db`
    UPDATE assistant_runs
    SET status = ${input.status}, step_count = ${stepCount},
        tool_ids = ${JSON.stringify(toolIds)}::jsonb,
        usage = ${usage === null ? null : JSON.stringify(usage)}::jsonb,
        fact_ids = ${JSON.stringify(factIds)}::jsonb,
        artifact_ids = ${JSON.stringify(artifactIds)}::jsonb,
        latency_ms = ${input.latencyMs ?? null},
        completed_at = ${input.now},
        failure_code = ${input.failureCode ?? null}
    WHERE id = ${input.runId} AND project_id = ${input.projectId}
      AND user_id = ${input.userId} AND status = 'running'
    RETURNING *`;
  if (updated[0]) {
    return { finished: true, run: mapRun(updated[0]) };
  }
  const current = await db`
    SELECT * FROM assistant_runs
    WHERE id = ${input.runId} AND project_id = ${input.projectId}
      AND user_id = ${input.userId}`;
  if (!current[0]) {
    throw new AssistantStoreError("not-found", "Run not found");
  }
  return { finished: false, run: mapRun(current[0]) };
}

/* ------------------------------------------------------------------ */
/* Chat deletion                                                       */
/* ------------------------------------------------------------------ */

/**
 * Delete one chat without deleting confirmed project/workspace memory:
 * memory is project/org-scoped and shared across chats, so it survives.
 * Messages and runs cascade in the same statement; a running run on the
 * chat is reported through `abortedRun` (the provider abort itself is
 * slice 6). Missing and foreign chats both report `deleted: false`.
 */
export async function deleteConversation(
  db: AssistantDb,
  input: ConversationScope & { conversationId: string },
): Promise<{ deleted: boolean; abortedRun: boolean }> {
  requireId("conversationId", input.conversationId);
  const rows = await db`
    WITH target AS (
      SELECT id FROM assistant_conversations
      WHERE id = ${input.conversationId}
        AND project_id = ${input.projectId}
        AND user_id = ${input.userId}
    ),
    killed AS (
      DELETE FROM assistant_runs
      WHERE conversation_id IN (SELECT id FROM target)
        AND status = 'running'
      RETURNING id
    ),
    deleted AS (
      DELETE FROM assistant_conversations
      WHERE id IN (SELECT id FROM target)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM killed) AS killed,
           (SELECT COUNT(*) FROM deleted) AS deleted`;
  const row = rows[0] ?? { killed: 0, deleted: 0 };
  return {
    deleted: asNumber(row.deleted) > 0,
    abortedRun: asNumber(row.killed) > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Recent-turn context selection (pure)                                */
/* ------------------------------------------------------------------ */

export type RecentTurnsInput = {
  limit?: number;
};

/**
 * Bounded recent-turn context from the SELECTED chat only. Takes that
 * chat's messages (ascending `seq`), keeps the trailing window, and
 * reports truncation. Never summarizes and never imports other chats'
 * transcripts — the caller passes exactly one chat's messages.
 */
export function selectRecentTurns<T extends { seq: number }>(
  messages: readonly T[],
  input: RecentTurnsInput = {},
): { messages: T[]; truncated: boolean; omittedCount: number } {
  const limit = Math.min(
    Math.max(input.limit ?? AGENT_LIMITS.defaultRecentMessages, 1),
    AGENT_LIMITS.maxRecentMessages,
  );
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  if (ordered.length <= limit) {
    return { messages: ordered, truncated: false, omittedCount: 0 };
  }
  return {
    messages: ordered.slice(ordered.length - limit),
    truncated: true,
    omittedCount: ordered.length - limit,
  };
}

/* ------------------------------------------------------------------ */
/* Typed memory                                                        */
/* ------------------------------------------------------------------ */

export type ProposeMemoryInput = {
  organizationId: string;
  scope: MemoryScope;
  key: string;
  projectId?: string | null;
  subjectUserId?: string | null;
  value: {
    version: number;
    label: string;
    description: string;
    payload: unknown;
  };
  proposerId: string;
  now: number;
};

function validateMemoryCandidate(input: {
  organizationId: string;
  scope: MemoryScope;
  key: string;
  projectId: string | null;
  subjectUserId: string | null;
  status: MemoryStatus;
  value: ProposeMemoryInput["value"];
  proposerId: string | null;
  confirmerId: string | null;
}): void {
  if (!input.organizationId || input.organizationId.length > 128) {
    throw new AssistantStoreError("invalid-input", "organizationId required");
  }
  // Scope/key ownership matrix (mirrors the contract discriminated union).
  if (input.scope === "project") {
    if (!input.projectId) {
      throw new AssistantStoreError(
        "invalid-input",
        "Project memory requires a projectId",
      );
    }
    if (input.subjectUserId !== null) {
      throw new AssistantStoreError(
        "invalid-input",
        "Project memory carries no subject user",
      );
    }
  } else if (input.scope === "workspace") {
    if (input.projectId !== null) {
      throw new AssistantStoreError(
        "invalid-input",
        "Workspace memory carries no projectId",
      );
    }
    if (input.subjectUserId !== null) {
      throw new AssistantStoreError(
        "invalid-input",
        "Workspace memory carries no subject user",
      );
    }
  } else if (input.scope === "member") {
    if (!input.subjectUserId) {
      throw new AssistantStoreError(
        "invalid-input",
        "Member memory requires a subject user",
      );
    }
  } else {
    throw new AssistantStoreError("invalid-input", "Unknown memory scope");
  }
}

/**
 * Propose typed memory. Any member may propose; the record starts
 * `proposed` and takes effect only after confirmation (or immediately
 * for member scope, which needs none). The proposal and its audit entry
 * persist in one statement.
 */
export async function proposeMemory(
  db: AssistantDb,
  input: ProposeMemoryInput,
): Promise<MemoryRecord> {
  requireId("proposerId", input.proposerId);
  const projectId = input.projectId ?? null;
  const subjectUserId = input.subjectUserId ?? null;
  validateMemoryCandidate({
    organizationId: input.organizationId,
    scope: input.scope,
    key: input.key,
    projectId,
    subjectUserId,
    status: "proposed",
    value: input.value,
    proposerId: input.proposerId,
    confirmerId: null,
  });
  // Contract validation first: key/payload and provenance rules.
  const candidate = {
    id: "mem_candidate",
    organizationId: input.organizationId,
    scope: input.scope,
    key: input.key,
    projectId,
    subjectUserId,
    status: "proposed",
    value: input.value,
    proposerId: input.proposerId,
    confirmerId: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (!MemoryRecordSchema.safeParse(candidate).success) {
    throw new AssistantStoreError(
      "invalid-input",
      "Memory record failed contract validation",
    );
  }
  const id = newId("mem");
  const auditId = newId("ma");
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db`
      WITH m AS (
        INSERT INTO assistant_memory
          (id, organization_id, scope, "key", project_id, subject_user_id,
           status, version, label, description, payload, proposer_id,
           confirmer_id, created_at, updated_at)
        VALUES (${id}, ${input.organizationId}, ${input.scope}, ${input.key},
          ${projectId}, ${subjectUserId}, 'proposed',
          ${input.value.version}, ${input.value.label},
          ${input.value.description}, ${JSON.stringify(input.value.payload)}::jsonb,
          ${input.proposerId}, NULL, ${input.now}, ${input.now})
        RETURNING *
      ),
      a AS (
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        SELECT ${auditId}, m.id, m.organization_id, 'proposed', NULL,
          'proposed', ${input.proposerId}, ${input.now}
        FROM m
        RETURNING id
      )
      SELECT * FROM m`;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AssistantStoreError(
        "not-found",
        "Memory scope target not found",
      );
    }
    throw error;
  }
  if (!rows[0]) {
    throw new AssistantStoreError(
      "invalid-output",
      "Memory proposal converged on no row",
    );
  }
  return mapMemory(rows[0]);
}

export type ConfirmedKnowledge = {
  project: MemoryRecord[];
  workspace: MemoryRecord[];
  member: MemoryRecord[];
};

/**
 * The confirmed knowledge Slice 5 injects: project definitions, shared
 * workspace terms, and the member's applicable preferences — never
 * proposals, never another member's preferences, never another
 * project/workspace's rows.
 */
export async function readConfirmedKnowledge(
  db: AssistantDb,
  input: {
    organizationId: string;
    projectId: string;
    subjectUserId: string;
  },
): Promise<ConfirmedKnowledge> {
  requireId("organizationId", input.organizationId);
  requireId("projectId", input.projectId);
  requireId("subjectUserId", input.subjectUserId);
  const projectRows = await db`
    SELECT * FROM assistant_memory
    WHERE organization_id = ${input.organizationId}
      AND scope = 'project' AND project_id = ${input.projectId}
      AND status = 'confirmed'
    ORDER BY "key" ASC, updated_at DESC`;
  const workspaceRows = await db`
    SELECT * FROM assistant_memory
    WHERE organization_id = ${input.organizationId}
      AND scope = 'workspace' AND status = 'confirmed'
    ORDER BY "key" ASC, updated_at DESC`;
  const memberRows = await db`
    SELECT * FROM assistant_memory
    WHERE organization_id = ${input.organizationId}
      AND scope = 'member' AND subject_user_id = ${input.subjectUserId}
      AND status = 'confirmed'
    ORDER BY "key" ASC, updated_at DESC`;
  return {
    project: projectRows.map(mapMemory),
    workspace: workspaceRows.map(mapMemory),
    member: memberRows.map(mapMemory),
  };
}

export type ListMemoryInput = {
  organizationId: string;
  scope?: MemoryScope | null;
  projectId?: string | null;
  subjectUserId?: string | null;
  status?: MemoryStatus | null;
};

/**
 * Filtered memory reads for management UI (slice 6). Every filter stays
 * inside the verified organization; project and member filters narrow
 * further. Cross-project and cross-workspace reads are impossible by
 * construction — there is no unscoped read path.
 */
export async function listMemory(
  db: AssistantDb,
  input: ListMemoryInput,
): Promise<MemoryRecord[]> {
  requireId("organizationId", input.organizationId);
  const rows = await db`
    SELECT * FROM assistant_memory
    WHERE organization_id = ${input.organizationId}
      AND (${input.scope ?? null}::text IS NULL OR scope = ${input.scope ?? null})
      AND (${input.projectId ?? null}::uuid IS NULL OR project_id = ${input.projectId ?? null})
      AND (${input.subjectUserId ?? null}::text IS NULL OR subject_user_id = ${input.subjectUserId ?? null})
      AND (${input.status ?? null}::text IS NULL OR status = ${input.status ?? null})
    ORDER BY updated_at DESC, id DESC`;
  return rows.map(mapMemory);
}

export type ConfirmMemoryInput = {
  organizationId: string;
  recordId: string;
  confirmerId: string;
  /** Verified membership role of the confirmer. */
  role: "owner" | "admin" | "member";
  now: number;
};

export type ConfirmMemoryResult =
  | { ok: true; record: MemoryRecord; supersededIds: string[] }
  | { ok: false; reason: "not-found" | "forbidden" | "not-proposed" };

/**
 * Confirm (or reject) a proposal. Only `proposed` records transition —
 * the `WHERE status = 'proposed'` guard plus `transitionProposal` make
 * concurrent confirmations single-winner: the loser sees zero updated
 * rows and receives `not-proposed`. Confirming supersedes the prior
 * confirmed record in the same slot (same scope/key/owner, and same
 * term name for `business-term`), and every transition appends audit
 * history.
 */
export async function confirmMemoryProposal(
  db: AssistantDb,
  input: ConfirmMemoryInput & { action: "confirm" | "reject" },
): Promise<ConfirmMemoryResult> {
  requireId("recordId", input.recordId);
  requireId("confirmerId", input.confirmerId);
  const current = await db`
    SELECT * FROM assistant_memory
    WHERE id = ${input.recordId}
      AND organization_id = ${input.organizationId}`;
  const row = current[0];
  if (!row) return { ok: false, reason: "not-found" };
  const scope = asString(row.scope) as MemoryScope;
  if (!canConfirmMemory(input.role, scope)) {
    return { ok: false, reason: "forbidden" };
  }
  const status = asString(row.status) as MemoryStatus;
  if (transitionProposal(status, input.action) === null) {
    return { ok: false, reason: "not-proposed" };
  }
  const toStatus = input.action === "confirm" ? "confirmed" : "rejected";
  const updated = await db`
    UPDATE assistant_memory
    SET status = ${toStatus}, confirmer_id = ${input.confirmerId},
        updated_at = ${input.now}, version = version + 1
    WHERE id = ${input.recordId}
      AND organization_id = ${input.organizationId}
      AND status = 'proposed'
    RETURNING *`;
  const updatedRow = updated[0];
  if (!updatedRow) {
    // Lost a confirmation race after the pre-check read.
    return { ok: false, reason: "not-proposed" };
  }
  const auditId = newId("ma");
  await db`
    INSERT INTO assistant_memory_audit
      (id, memory_id, organization_id, action, from_status, to_status,
       actor_id, created_at)
    VALUES (${auditId}, ${input.recordId}, ${input.organizationId},
      ${input.action}, 'proposed', ${toStatus}, ${input.confirmerId},
      ${input.now})`;
  let supersededIds: string[] = [];
  if (input.action === "confirm") {
    const record = mapMemory(updatedRow);
    const supRows = await db`
      UPDATE assistant_memory o
      SET status = 'superseded', updated_at = ${input.now},
          version = o.version + 1
      FROM (SELECT * FROM assistant_memory WHERE id = ${input.recordId}) u
      WHERE o.organization_id = u.organization_id
        AND o.scope = u.scope AND o."key" = u."key"
        AND o.id <> u.id AND o.status = 'confirmed'
        AND COALESCE(o.project_id::text, '') = COALESCE(u.project_id::text, '')
        AND COALESCE(o.subject_user_id, '') = COALESCE(u.subject_user_id, '')
        AND (
          u."key" <> 'business-term'
          OR (o.payload ->> 'name') = (u.payload ->> 'name')
        )
      RETURNING o.id AS id`;
    supersededIds = supRows.map((entry) => asString(entry.id));
    for (const supId of supersededIds) {
      await db`
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        VALUES (${newId("ma")}, ${supId}, ${input.organizationId},
          'superseded', 'confirmed', 'superseded', ${input.confirmerId},
          ${input.now})`;
    }
    return { ok: true, record, supersededIds };
  }
  return { ok: true, record: mapMemory(updatedRow), supersededIds };
}

/**
 * Audit history for one memory record, scoped to its organization.
 * Returns `null` when the record is outside the organization
 * (non-disclosing).
 */
export async function readMemoryAudit(
  db: AssistantDb,
  input: { organizationId: string; memoryId: string },
): Promise<MemoryAuditEntry[] | null> {
  requireId("memoryId", input.memoryId);
  const owner = await db`
    SELECT id FROM assistant_memory
    WHERE id = ${input.memoryId}
      AND organization_id = ${input.organizationId}`;
  if (!owner[0]) return null;
  const rows = await db`
    SELECT * FROM assistant_memory_audit
    WHERE memory_id = ${input.memoryId}
    ORDER BY created_at ASC, id ASC`;
  return rows.map(mapAudit);
}

/* ------------------------------------------------------------------ */
/* Retention + purge paths                                             */
/* ------------------------------------------------------------------ */

export type AssistantRetentionConfig = {
  /** Delete finished runs older than this many days (never running). */
  runRetentionDays: number;
  /** Delete audit entries older than this many days. */
  auditRetentionDays: number;
};

const DEFAULT_RUN_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_RETENTION_DAYS = 365;

function parseRetentionDays(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * Retention configuration (`PRISM_ASSISTANT_RUN_RETENTION_DAYS`,
 * `PRISM_ASSISTANT_AUDIT_RETENTION_DAYS`). Chat history (conversations
 * and messages) is user data and is never retention-purged — only
 * operational run records and audit history age out.
 */
export function getAssistantRetentionConfig(
  env: Record<string, string | undefined>,
): AssistantRetentionConfig {
  return {
    runRetentionDays: parseRetentionDays(
      env.PRISM_ASSISTANT_RUN_RETENTION_DAYS,
      DEFAULT_RUN_RETENTION_DAYS,
    ),
    auditRetentionDays: parseRetentionDays(
      env.PRISM_ASSISTANT_AUDIT_RETENTION_DAYS,
      DEFAULT_AUDIT_RETENTION_DAYS,
    ),
  };
}

/**
 * Documented purge job (see `src/database/purge-assistant.ts`): removes
 * finished runs and stale audit entries older than the retention
 * windows. Running runs are never touched; conversations, messages, and
 * memory survive regardless of age.
 */
export async function purgeAssistantRetention(
  db: AssistantDb,
  now: number,
  config: AssistantRetentionConfig,
): Promise<{ runsDeleted: number; auditDeleted: number }> {
  const runCutoff = now - config.runRetentionDays * 86_400_000;
  const auditCutoff = now - config.auditRetentionDays * 86_400_000;
  const runs = await db`
    DELETE FROM assistant_runs
    WHERE status <> 'running' AND completed_at IS NOT NULL
      AND completed_at < ${runCutoff}
    RETURNING id`;
  const audit = await db`
    DELETE FROM assistant_memory_audit WHERE created_at < ${auditCutoff}
    RETURNING id`;
  return { runsDeleted: runs.length, auditDeleted: audit.length };
}

/**
 * Project-deletion boundary: remove the project's chats (messages and
 * runs cascade), its project-scoped memory (audit cascades), and nothing
 * else. Workspace memory and member preferences survive — shared
 * knowledge outlives any single project. Call BEFORE the product row
 * delete so a purge failure fails the deletion closed.
 */
export async function purgeAssistantProjectData(
  db: AssistantDb,
  projectId: string,
): Promise<{ conversationsDeleted: number; memoriesDeleted: number }> {
  requireId("projectId", projectId);
  const convs = await db`
    DELETE FROM assistant_conversations WHERE project_id = ${projectId}
    RETURNING id`;
  const mems = await db`
    DELETE FROM assistant_memory
    WHERE scope = 'project' AND project_id = ${projectId}
    RETURNING id`;
  return {
    conversationsDeleted: convs.length,
    memoriesDeleted: mems.length,
  };
}

/**
 * Workspace-deletion path (no workspace-delete route exists yet; this is
 * the documented function that route must call): removes every
 * conversation, memory record, and audit entry of the organization.
 * Organization-row FK cascades backstop the same outcome.
 */
export async function purgeAssistantWorkspaceData(
  db: AssistantDb,
  organizationId: string,
): Promise<{ conversationsDeleted: number; memoriesDeleted: number }> {
  requireId("organizationId", organizationId);
  const convs = await db`
    DELETE FROM assistant_conversations
    WHERE organization_id = ${organizationId}
    RETURNING id`;
  const mems = await db`
    DELETE FROM assistant_memory WHERE organization_id = ${organizationId}
    RETURNING id`;
  return {
    conversationsDeleted: convs.length,
    memoriesDeleted: mems.length,
  };
}

/**
 * Account-deletion path: removes the user's chats (messages and runs
 * cascade) and member preferences. Shared project/workspace records
 * survive for the remaining members, but the deleted user's attribution
 * is replaced with an explicit tombstone — raw user IDs leave with the
 * account while the provenance-required shapes stay valid.
 */
export const DELETED_USER_ATTRIBUTION = "deleted-user";

export async function purgeAssistantUserData(
  db: AssistantDb,
  userId: string,
): Promise<{ conversationsDeleted: number; memoriesDeleted: number }> {
  requireId("userId", userId);
  const convs = await db`
    DELETE FROM assistant_conversations WHERE user_id = ${userId}
    RETURNING id`;
  const mems = await db`
    DELETE FROM assistant_memory
    WHERE scope = 'member' AND subject_user_id = ${userId}
    RETURNING id`;
  await db`
    UPDATE assistant_memory SET proposer_id = ${DELETED_USER_ATTRIBUTION}
    WHERE proposer_id = ${userId}`;
  await db`
    UPDATE assistant_memory SET confirmer_id = ${DELETED_USER_ATTRIBUTION}
    WHERE confirmer_id = ${userId}`;
  await db`
    UPDATE assistant_memory_audit SET actor_id = ${DELETED_USER_ATTRIBUTION}
    WHERE actor_id = ${userId}`;
  return { conversationsDeleted: convs.length, memoriesDeleted: mems.length };
}

export type {
  MemoryKey,
  MemoryScope,
  MemoryStatus,
  InsightSeed,
};
