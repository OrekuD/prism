/**
 * Assistant control-plane store (Task 21 slice 4, hardened per R12).
 *
 * Durable foundation for conversations, messages, runs, typed memory, and
 * audit history — without invoking any model. Every function takes
 * server-verified IDs (never slugs, never model values) and scopes every
 * query by them, so cross-user and cross-project reads are impossible by
 * construction. Membership/role checks stay at the controller boundary
 * (slice 6); the store additionally scopes by the verified IDs it is
 * given, which is what the authorization tests prove.
 *
 * Neon-HTTP compatibility: every WRITE is one SQL statement (writable
 * CTEs where several rows must change atomically). There are deliberately
 * NO multi-statement write transactions — the Cloudflare Worker driver is
 * stateless. Races resolve through database-owned invariants:
 * - duplicate creation/submission converges via idempotency uniques
 *   bound to request digests (a reused key with different content is a
 *   conflict, never a silent alias),
 * - message sequencing retries on the `(conversation_id, seq)` conflict,
 * - the one-active-run rule is a partial unique index,
 * - one-confirmed-per-slot is a deferrable exclusion constraint, and
 *   proposal confirmation is `UPDATE ... WHERE status = 'proposed'`.
 * Reads may fan out across statements; only writes carry atomicity
 * requirements, and fault-injection tests prove every write unit.
 *
 * Timestamps are millisecond epochs supplied by the caller (`now`) so
 * tests are deterministic.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  readonly code:
    | "not-found"
    | "invalid-input"
    | "invalid-output"
    | "idempotency-conflict";
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

/**
 * URL slug for one chat: `chat_` + 12 lowercase alphanumerics — the same
 * opaque crypto-random recipe as workspace `wrk_` slugs. Row IDs
 * (`conv_*` UUIDs) stay server-internal.
 */
const CONVERSATION_SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newConversationSlug(): string {
  const bytes = randomBytes(12);
  let slug = "chat_";
  for (const byte of bytes) {
    slug += CONVERSATION_SLUG_ALPHABET[byte % CONVERSATION_SLUG_ALPHABET.length];
  }
  return slug;
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

/** Exclusion-violation (R12-F2 slot invariant) alongside unique violations. */
function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23P01"
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

function requireNow(now: number): void {
  if (!Number.isInteger(now) || now < 0) {
    throw new AssistantStoreError("invalid-input", "now must be a valid time");
  }
}

/**
 * Canonical request digest (R12-F6): SHA-256 over the JSON-serialized
 * content that makes an operation what it is. Persisted beside every
 * idempotency key; a reused key with different content is a stable
 * `idempotency-conflict`, never a silent alias of the earlier request.
 */
function requestDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

/** Digest preimage for lazy creation: first message, seed, snapshot token. */
export function createConversationDigest(input: {
  firstMessage: string;
  seedInsightId: string | null;
  queryContextToken: string;
}): string {
  return requestDigest([
    input.firstMessage,
    input.seedInsightId,
    input.queryContextToken,
  ]);
}

/** Digest preimage for an appended message: everything semantic. */
export function messageRequestDigest(input: {
  role: string;
  status: string;
  parts: unknown;
  failureCode: string | null;
}): string {
  return requestDigest([
    input.role,
    input.status,
    input.parts,
    input.failureCode,
  ]);
}

function checkDigestMatch(
  existingDigest: string | null,
  expectedDigest: string,
): void {
  // R13-F1 + R14-F2: the explicit 0005 backfill sentinel is UNVERIFIABLE.
  // Legacy rows stay readable through normal history reads (which never
  // call this helper), but an idempotent retry encountering the sentinel
  // fails closed as a conflict — it is never acknowledged as a verified
  // replay, even when the retried content looks identical, because the
  // original digest inputs (e.g. the query-context token) are
  // unrecoverable. Callers must retry with a new request ID. A NULL digest
  // beside a non-null key likewise fails closed. New rows always carry
  // verified SHA-256.
  if (existingDigest !== expectedDigest) {
    throw new AssistantStoreError(
      "idempotency-conflict",
      existingDigest === LEGACY_REQUEST_DIGEST
        ? "Idempotency key predates digest verification; retry with a new request ID"
        : "Idempotency key was already used with different content",
    );
  }
}

/**
 * Explicit legacy representation (R13-F1): backfilled by migration 0005
 * onto every 0004 row that already held an idempotency key. Versioned and
 * non-hex so it can never collide with a verified SHA-256 digest.
 */
export const LEGACY_REQUEST_DIGEST = "legacy-0004-unverifiable";

/** PostgreSQL CHECK-violation code (never surfaces raw; see below). */
function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23514"
  );
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
    slug: asString(row.slug),
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
 * Lazy chat creation with atomic first-message persistence (R12-F1). No
 * chat row exists until the member actually submits: ONE database
 * statement inserts (or recovers) the idempotent conversation AND its
 * `seq: 0` user message, deriving the organization from the verified
 * project row — so organization A can never pair with project B
 * (R12-F3), and a failure at the message stage leaves neither row. A
 * bounded whole-statement retry covers the concurrent-duplicate window
 * (the loser's snapshot predates the winner's commit). The idempotency
 * key is bound to a digest of first message, seed, and snapshot token: a
 * reused key with different content is an `idempotency-conflict`
 * (R12-F6), never a silent alias.
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
  requireNow(input.now);
  const {
    projectId,
    userId,
    clientRequestId,
    firstMessage,
    seed,
    queryContextToken,
    now,
  } = input;
  const title = deriveChatTitle(firstMessage);
  const parts: AssistantMessagePart[] = [{ type: "text", text: firstMessage }];
  const digest = createConversationDigest({
    firstMessage,
    seedInsightId: seed?.insightId ?? null,
    queryContextToken,
  });
  // Pre-write validation (R12-F5): the complete candidate first message
  // must satisfy the frozen schema before any SQL runs.
  const candidateMessage = {
    id: "msg_candidate",
    conversationId: "conv_candidate",
    seq: 0,
    role: "user",
    status: "complete",
    parts,
    failureCode: null,
    clientRequestId,
    createdAt: now,
    completedAt: now,
  };
  if (!AssistantMessageSchema.safeParse(candidateMessage).success) {
    throw new AssistantStoreError(
      "invalid-input",
      "First message failed contract validation",
    );
  }
  const partsJson = JSON.stringify(parts);

  // Tenant binding (R12-F3): the organization is derived from the
  // verified project row — but a mismatched caller-supplied organization
  // fails closed BEFORE any write, so adapter confusion never inserts.
  const owner = await db`
    SELECT organization_id AS organization_id FROM projects
    WHERE id = ${projectId}`;
  if (!owner[0]) {
    throw new AssistantStoreError("not-found", "Project not found");
  }
  if (asString(owner[0].organization_id) !== input.organizationId) {
    throw new AssistantStoreError(
      "invalid-input",
      "Project does not belong to the organization",
    );
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Fresh slug per attempt: a `chat_*` collision raises 23505 below and
    // retries with a new value. Idempotent convergence is unaffected —
    // duplicate keys still hit the DO NOTHING branches.
    const slug = newConversationSlug();
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await db`
      WITH target AS (
        SELECT p.id AS project_id, p.organization_id AS organization_id
        FROM projects p WHERE p.id = ${projectId}
      ),
      conv AS (
        INSERT INTO assistant_conversations
          (id, slug, organization_id, project_id, user_id, title,
           seed_insight_id, client_request_id, request_digest,
           created_at, updated_at, last_message_at)
        SELECT ${newId("conv")}, ${slug}, t.organization_id, t.project_id,
          ${userId}, ${title}, ${seed?.insightId ?? null},
          ${clientRequestId}, ${digest}, ${now}, ${now}, ${now}
        FROM target t
        ON CONFLICT (project_id, user_id, client_request_id)
          WHERE client_request_id IS NOT NULL
        DO NOTHING
        RETURNING *, TRUE AS created
      ),
      existing AS (
        SELECT *, FALSE AS created FROM assistant_conversations
        WHERE project_id = ${projectId} AND user_id = ${userId}
          AND client_request_id = ${clientRequestId}
          AND NOT EXISTS (SELECT 1 FROM conv)
      ),
      picked AS (
        SELECT * FROM conv UNION ALL SELECT * FROM existing
      ),
      msg AS (
        INSERT INTO assistant_messages
          (id, conversation_id, seq, role, status, parts, failure_code,
           client_request_id, request_digest, created_at, completed_at)
        SELECT ${newId("msg")}, picked.id, 0, 'user', 'complete',
          ${partsJson}::jsonb, NULL, ${clientRequestId}, ${digest},
          ${now}, ${now}
        FROM picked
        ON CONFLICT (conversation_id, client_request_id)
          WHERE client_request_id IS NOT NULL
        DO NOTHING
        RETURNING *
      ),
      emsg AS (
        SELECT * FROM assistant_messages
        WHERE conversation_id = (SELECT id FROM picked)
          AND client_request_id = ${clientRequestId}
          AND NOT EXISTS (SELECT 1 FROM msg)
      )
      SELECT (SELECT row_to_json(p) FROM picked p) AS conv,
             (SELECT row_to_json(m) FROM msg m) AS msg,
             (SELECT row_to_json(e) FROM emsg e) AS existing_msg,
             (SELECT created FROM picked) AS conv_created,
             (SELECT COUNT(*) FROM target) AS target_count`;
    } catch (error) {
      // Slug collision only: the idempotency branches never raise (DO
      // NOTHING), and row IDs are UUIDs — so 23505 here is our fresh
      // `chat_*` value meeting another writer's. Retry with a new one.
      if (isUniqueViolation(error) && attempt + 1 < 4) continue;
      throw error;
    }
    const row = rows[0] as
      | {
          conv: Record<string, unknown> | null;
          msg: Record<string, unknown> | null;
          existing_msg: Record<string, unknown> | null;
          conv_created: boolean | null;
          target_count: unknown;
        }
      | undefined;
    if (!row || Number(row.target_count) === 0 || row.conv === null) {
      if (row && Number(row.target_count) > 0 && attempt + 1 < 4) {
        // Concurrent-duplicate window: our snapshot predates the
        // winner's commit. Retry once with a fresh snapshot.
        continue;
      }
      throw new AssistantStoreError("not-found", "Project not found");
    }
    const messageRow = row.msg ?? row.existing_msg;
    if (!messageRow) {
      if (attempt + 1 < 4) continue;
      throw new AssistantStoreError(
        "invalid-output",
        "Creation converged on no message",
      );
    }
    // Digest binding (R12-F6): nothing was written on the recovery path,
    // so a mismatch safely throws before returning.
    if (row.conv_created === false) {
      checkDigestMatch(
        typeof row.conv.request_digest === "string"
          ? (row.conv.request_digest as string)
          : null,
        digest,
      );
    }
    checkDigestMatch(
      typeof messageRow.request_digest === "string"
        ? (messageRow.request_digest as string)
        : null,
      digest,
    );
    return {
      conversation: mapConversation(row.conv),
      message: mapMessage(messageRow),
      createdConversation: row.conv_created === true,
      createdMessage: row.msg !== null,
    };
  }
  throw new AssistantStoreError(
    "invalid-output",
    "Creation did not converge",
  );
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
    slug: string;
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
    slug: asString(row.slug),
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

/**
 * Slug-based chat lookup for URL resolution. Row IDs (`conv_*`) never
 * appear in URLs: the route slug resolves here, under the same
 * `(projectId, userId)` ownership binding and non-disclosing null as
 * the ID path. Callers continue with the returned row ID internally.
 */
export async function getConversationBySlug(
  db: AssistantDb,
  input: ConversationScope & { slug: string },
): Promise<{
  conversation: AssistantConversation;
  messages: AssistantMessage[];
  activeRun: AssistantRun | null;
} | null> {
  if (!input.slug || input.slug.length > 32) return null;
  const convRows = await db`
    SELECT * FROM assistant_conversations
    WHERE slug = ${input.slug}
      AND project_id = ${input.projectId}
      AND user_id = ${input.userId}`;
  const convRow = convRows[0];
  if (!convRow) return null;
  return getConversation(db, {
    projectId: input.projectId,
    userId: input.userId,
    conversationId: asString(convRow.id),
  });
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
 * Atomic message sequencing (R12-F5/F6). The next `seq` is `MAX(seq) + 1`
 * computed in the insert statement itself, and the conversation clock
 * moves in the same statement — so concurrent appends from two tabs
 * serialize on the `(conversation_id, seq)` unique constraint and the
 * loser retries against the new max. The complete candidate is validated
 * against the frozen schema BEFORE any SQL runs, so malformed rows never
 * commit (and never occupy constraints). Retried submissions carrying
 * `clientRequestId` converge on the existing row only when the request
 * digest matches; a reused key with different content is an
 * `idempotency-conflict`.
 */
export async function appendMessage(
  db: AssistantDb,
  input: AppendMessageInput,
): Promise<{ message: AssistantMessage; created: boolean }> {
  requireId("conversationId", input.conversationId);
  requireNow(input.now);
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
  const failureCode = input.failureCode ?? null;
  // Finished messages complete at write time unless the caller says
  // otherwise; pending/streaming messages stay open. Timestamps are
  // transport, not identity — the digest covers content only (R12-F6), so
  // a retry with a fresh clock still converges.
  const finished =
    input.status === "complete" ||
    input.status === "cancelled" ||
    input.status === "failed";
  const completedAt = input.completedAt ?? (finished ? input.now : null);
  if (completedAt !== null && (!Number.isInteger(completedAt) || completedAt < 0)) {
    throw new AssistantStoreError("invalid-input", "Invalid completedAt");
  }
  // Pre-write validation (R12-F5): the full candidate row must satisfy
  // the frozen contract before it can commit.
  const candidate = {
    id: "msg_candidate",
    conversationId: input.conversationId,
    seq: 0,
    role: input.role,
    status: input.status,
    parts,
    failureCode,
    clientRequestId,
    createdAt: input.now,
    completedAt,
  };
  if (!AssistantMessageSchema.safeParse(candidate).success) {
    throw new AssistantStoreError(
      "invalid-input",
      "Message failed contract validation",
    );
  }
  const digest =
    clientRequestId === null
      ? null
      : messageRequestDigest({
          role: input.role,
          status: input.status,
          parts,
          failureCode,
        });

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
      checkDigestMatch(
        asNullableString(existing[0].request_digest),
        digest as string,
      );
      return { message: mapMessage(existing[0]), created: false };
    }
  }

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
               client_request_id, request_digest, created_at, completed_at)
            SELECT ${id}, ${input.conversationId},
              COALESCE((SELECT MAX(seq) FROM assistant_messages
                WHERE conversation_id = ${input.conversationId}), -1) + 1,
              ${input.role}, ${input.status}, ${partsJson}::jsonb,
              ${failureCode}, ${clientRequestId}, ${digest}, ${input.now},
              ${completedAt}
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
               client_request_id, request_digest, created_at, completed_at)
            SELECT ${id}, ${input.conversationId},
              COALESCE((SELECT MAX(seq) FROM assistant_messages
                WHERE conversation_id = ${input.conversationId}), -1) + 1,
              ${input.role}, ${input.status}, ${partsJson}::jsonb,
              ${failureCode}, NULL, NULL, ${input.now}, ${completedAt}
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
      // converge on the existing row (digest-bound).
      if (clientRequestId !== null) {
        const existing = await db`
          SELECT * FROM assistant_messages
          WHERE conversation_id = ${input.conversationId}
            AND client_request_id = ${clientRequestId}
          ORDER BY seq ASC LIMIT 1`;
        if (existing[0]) {
          checkDigestMatch(
            asNullableString(existing[0].request_digest),
            digest as string,
          );
          return { message: mapMessage(existing[0]), created: false };
        }
      }
      throw new AssistantStoreError(
        "invalid-output",
        "Message insert converged on no row",
      );
    } catch (error) {
      if (
        error instanceof AssistantStoreError &&
        error.code === "idempotency-conflict"
      ) {
        throw error;
      }
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

export type StartRunInput = {
  /** Verified run scope: scoping only — row values derive from the chat. */
  projectId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  queryContextHash: string;
  model: string;
  now: number;
};

/**
 * Start one agent run. Project/user provenance derives from the owning
 * conversation INSIDE the insert (R12-F3): the statement joins the
 * verified conversation and requires the message to belong to that same
 * conversation, so a run can never carry mismatched provenance — a
 * foreign chat, a foreign message, or a message from another conversation
 * inserts nothing. The database owns the one-active-run-per-
 * `(project, user)` rule through the partial unique index: a concurrent
 * second start loses the insert and receives the winner's run identity
 * (`active-run-exists`) instead of running twice. Browsing or retaining
 * other chats is unaffected — only a second *running* run is refused.
 * The complete candidate is validated pre-write (R12-F5).
 */
export async function startRun(
  db: AssistantDb,
  input: StartRunInput,
): Promise<{ ok: true; run: AssistantRun } | { ok: false; conflict: RunConflict }> {
  requireId("conversationId", input.conversationId);
  requireId("messageId", input.messageId);
  requireId("model", input.model);
  requireNow(input.now);
  if (!input.queryContextHash || input.queryContextHash.length > 128) {
    throw new AssistantStoreError(
      "invalid-input",
      "queryContextHash is required",
    );
  }
  // Pre-write validation (R12-F5): the complete candidate run must
  // satisfy the frozen schema before any SQL runs.
  const candidate = {
    id: "run_candidate",
    conversationId: input.conversationId,
    messageId: input.messageId,
    projectId: input.projectId,
    userId: input.userId,
    queryContextHash: input.queryContextHash,
    definitionVersion: DEFINITION_VERSION,
    model: input.model,
    provider: "openrouter",
    status: "running",
    stepCount: 0,
    toolIds: [],
    usage: null,
    factIds: [],
    artifactIds: [],
    latencyMs: null,
    startedAt: input.now,
    completedAt: null,
    failureCode: null,
  };
  if (!AssistantRunSchema.safeParse(candidate).success) {
    throw new AssistantStoreError(
      "invalid-input",
      "Run failed contract validation",
    );
  }

  let inserted: Array<Record<string, unknown>>;
  try {
    inserted = await db`
      INSERT INTO assistant_runs
        (id, conversation_id, message_id, project_id, user_id,
         query_context_hash, definition_version, model, provider, status,
         step_count, tool_ids, usage, fact_ids, artifact_ids, latency_ms,
         started_at, completed_at, failure_code)
      SELECT ${newId("run")}, c.id, m.id, c.project_id, c.user_id,
        ${input.queryContextHash}, ${DEFINITION_VERSION}, ${input.model},
        'openrouter', 'running', 0, '[]'::jsonb, NULL, '[]'::jsonb,
        '[]'::jsonb, NULL, ${input.now}, NULL, NULL
      FROM assistant_conversations c
      JOIN assistant_messages m
        ON m.id = ${input.messageId} AND m.conversation_id = c.id
      WHERE c.id = ${input.conversationId}
        AND c.project_id = ${input.projectId}
        AND c.user_id = ${input.userId}
      ON CONFLICT (project_id, user_id) WHERE status = 'running'
      DO NOTHING
      RETURNING *`;
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AssistantStoreError("not-found", "Conversation not found");
    }
    throw error;
  }
  if (inserted[0]) {
    return { ok: true, run: mapRun(inserted[0]) };
  }
  // No row: either a scoping mismatch (foreign chat/message) or a lost
  // active-run race. Distinguish without disclosing which.
  const active = await db`
    SELECT * FROM assistant_runs
    WHERE project_id = ${input.projectId} AND user_id = ${input.userId}
      AND status = 'running'
    ORDER BY started_at DESC LIMIT 1`;
  const row = active[0];
  if (!row) {
    throw new AssistantStoreError("not-found", "Conversation not found");
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
  requireNow(input.now);
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
  if (
    factIds.length > 64 ||
    artifactIds.length > 16 ||
    factIds.some((id) => !id || id.length > 128) ||
    artifactIds.some((id) => !id || id.length > 128)
  ) {
    throw new AssistantStoreError("invalid-input", "Invalid references");
  }
  if (
    input.latencyMs !== undefined &&
    input.latencyMs !== null &&
    (!Number.isInteger(input.latencyMs) || input.latencyMs < 0)
  ) {
    throw new AssistantStoreError("invalid-input", "Invalid latency");
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
  /**
   * Fresh authenticated user (Slice 6 passes the session user). The
   * proposer is always that user, and a member preference's subject must
   * be them too (R12-F3) — preferences can never be written for someone
   * else.
   */
  authenticatedUserId: string;
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
 * Propose typed memory (R12-F7). Any member may propose project or
 * workspace knowledge; those records start `proposed` and take effect
 * only after owner/admin confirmation. Member-scoped preferences NEVER
 * need confirmation (frozen contract): a valid preference persists
 * directly as `confirmed`, superseding the member's prior preference for
 * the same key in the same statement — no approval UI involved. The
 * proposal (or preference) and its audit entry persist in one statement.
 */
export async function proposeMemory(
  db: AssistantDb,
  input: ProposeMemoryInput,
): Promise<MemoryRecord> {
  requireId("proposerId", input.proposerId);
  requireId("authenticatedUserId", input.authenticatedUserId);
  requireNow(input.now);
  if (input.proposerId !== input.authenticatedUserId) {
    throw new AssistantStoreError(
      "invalid-input",
      "Proposer must be the authenticated user",
    );
  }
  const projectId = input.projectId ?? null;
  const subjectUserId =
    input.scope === "member"
      ? (input.subjectUserId ?? input.authenticatedUserId)
      : (input.subjectUserId ?? null);
  if (input.scope === "member" && subjectUserId !== input.authenticatedUserId) {
    throw new AssistantStoreError(
      "invalid-input",
      "Member preferences belong to the authenticated member",
    );
  }
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
  // Member preferences validate as `confirmed` (their stored status).
  const storedStatus = input.scope === "member" ? "confirmed" : "proposed";
  const candidate = {
    id: "mem_candidate",
    organizationId: input.organizationId,
    scope: input.scope,
    key: input.key,
    projectId,
    subjectUserId,
    status: storedStatus,
    value: input.value,
    proposerId: input.proposerId,
    confirmerId: input.scope === "member" ? input.authenticatedUserId : null,
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (!MemoryRecordSchema.safeParse(candidate).success) {
    throw new AssistantStoreError(
      "invalid-input",
      "Memory record failed contract validation",
    );
  }
  // Tenant binding (R12-F3): a project-scoped write must name a project
  // of the same organization — verified here so a mismatch fails without
  // inserting, with the composite FK as the durable backstop.
  if (projectId !== null) {
    const owner = await db`
      SELECT organization_id AS organization_id FROM projects
      WHERE id = ${projectId}`;
    if (!owner[0]) {
      throw new AssistantStoreError("not-found", "Project not found");
    }
    if (asString(owner[0].organization_id) !== input.organizationId) {
      throw new AssistantStoreError(
        "invalid-input",
        "Project does not belong to the organization",
      );
    }
  }
  const id = newId("mem");
  const auditId = newId("ma");
  const auditAction = storedStatus === "confirmed" ? "confirmed" : "proposed";
  // Member preferences save last-writer-wins: a concurrent duplicate
  // rolls back on the slot invariant and retries once, superseding the
  // winner it just lost to.
  const attempts = input.scope === "member" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await proposeOnce();
    } catch (error) {
      if (
        input.scope === "member" &&
        (isExclusionViolation(error) ||
          isUniqueViolation(error) ||
          isDeadlock(error)) &&
        attempt + 1 < attempts
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new AssistantStoreError(
    "invalid-output",
    "Memory proposal did not converge",
  );

  async function proposeOnce(): Promise<MemoryRecord> {
    const payloadJson = JSON.stringify(input.value.payload);
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await db`
      WITH slot AS MATERIALIZED (
        -- Slot serialization (R12-F2): immediately-confirmed member
        -- preferences lock the slot before writing, ordered by id like
        -- every confirm statement. Proposed shared knowledge takes no
        -- slot lock (it cannot conflict with the confirmed invariant).
        -- R14-F1: the incoming slot identity is derived by the DATABASE
        -- function over the incoming payload — never by a JavaScript
        -- reimplementation — so lock, insert, and exclusion agree.
        SELECT o.id FROM assistant_memory o
        WHERE ${storedStatus} = 'confirmed'
          AND o.organization_id = ${input.organizationId}
          AND o.scope = ${input.scope} AND o."key" = ${input.key}
          AND COALESCE(o.project_id::text, '') = COALESCE(${projectId}::text, '')
          AND COALESCE(o.subject_user_id, '') = COALESCE(${subjectUserId}::text, '')
          AND o.slot_term = (
            CASE WHEN ${input.key} = 'business-term'
              THEN assistant_canonical_term((${payloadJson}::jsonb) ->> 'name')
              ELSE '' END
          )
          AND o.status = 'confirmed'
        ORDER BY o.id
        FOR UPDATE
      ),
      m AS (
        -- R14-F1: slot_term is database-generated (BEFORE trigger over
        -- key/payload) and deliberately omitted here. Display spelling
        -- stays verbatim in payload.
        INSERT INTO assistant_memory
          (id, organization_id, scope, "key", project_id, subject_user_id,
           status, version, label, description, payload,
           proposer_id, confirmer_id, created_at, updated_at)
        SELECT ${id}, ${input.organizationId}, ${input.scope}, ${input.key},
          ${projectId}, ${subjectUserId}, ${storedStatus},
          ${input.value.version}, ${input.value.label},
          ${input.value.description}, ${payloadJson}::jsonb,
          ${input.proposerId},
          ${input.scope === "member" ? input.authenticatedUserId : null},
          ${input.now}, ${input.now}
        FROM (SELECT COUNT(*) FROM slot) AS _s
        RETURNING *
      ),
      sup AS (
        UPDATE assistant_memory o
        SET status = 'superseded', updated_at = ${input.now},
            version = o.version + 1
        FROM m
        WHERE m.status = 'confirmed'
          AND o.organization_id = m.organization_id
          AND o.scope = m.scope AND o."key" = m."key"
          AND o.id <> m.id AND o.status = 'confirmed'
          AND COALESCE(o.project_id::text, '') = COALESCE(m.project_id::text, '')
          AND COALESCE(o.subject_user_id, '') = COALESCE(m.subject_user_id, '')
          AND o.slot_term = m.slot_term
        RETURNING o.id AS id
      ),
      a AS (
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        SELECT ${auditId}, m.id, m.organization_id, ${auditAction}, NULL,
          ${storedStatus}, ${input.proposerId}, ${input.now}
        FROM m
        RETURNING id
      ),
      a2 AS (
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        SELECT ('ma_' || md5(sup.id || (${input.now})::text)), sup.id,
          m.organization_id, 'superseded', 'confirmed', 'superseded',
          ${input.proposerId}, ${input.now}
        FROM sup, m
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
      // R14-F1.5: normalization/shape rejections surface as stable typed
      // errors, never raw PostgreSQL 23514.
      if (isCheckViolation(error)) {
        throw new AssistantStoreError(
          "invalid-input",
          "Memory record failed validation",
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
 *
 * Member applicability (R13-F3, frozen): a member preference applies to
 * the requested project when its `project_id` is NULL (workspace-wide
 * default) or equals the requested project. When both exist for one key,
 * the project-specific value wins deterministically and exactly one
 * effective value per key reaches the agent — project B never receives
 * project A's preference.
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
      AND (project_id IS NULL OR project_id = ${input.projectId})
    ORDER BY "key" ASC, updated_at DESC`;
  const memberByKey = new Map<string, MemoryRecord>();
  for (const row of memberRows.map(mapMemory)) {
    const existing = memberByKey.get(row.key);
    if (!existing) {
      memberByKey.set(row.key, row);
      continue;
    }
    // Deterministic precedence: a project-specific value replaces the
    // workspace-wide default; same-specificity ties keep the latest
    // (query already orders updated_at DESC, so first wins).
    const rowSpecific =
      row.scope === "member" && row.projectId !== null;
    const existingSpecific =
      existing.scope === "member" && existing.projectId !== null;
    if (rowSpecific && !existingSpecific) {
      memberByKey.set(row.key, row);
    }
  }
  return {
    project: projectRows.map(mapMemory),
    workspace: workspaceRows.map(mapMemory),
    member: [...memberByKey.values()],
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
  | {
      ok: false;
      reason: "not-found" | "forbidden" | "not-proposed" | "slot-conflict";
    };

/**
 * Confirm (or reject) a proposal in ONE statement (R12-F2): slot locking,
 * the status transition, old-value supersession, and every audit insert
 * commit or roll back together — a failure between stages is impossible,
 * and fault injection on the call proves nothing persists. The
 * one-confirmed-per-slot exclusion constraint owns the invariant: two
 * overlapping confirms of distinct proposals in one slot resolve so
 * exactly one value stays confirmed and the loser rolls back entirely
 * (reported deterministically as `slot-conflict`; its proposal stays
 * proposed). Confirming the same proposal twice resolves on the
 * `WHERE status = 'proposed'` guard (`not-proposed`). A residual
 * deadlock abort (40P01) is safe to retry once — nothing committed.
 */
export async function confirmMemoryProposal(
  db: AssistantDb,
  input: ConfirmMemoryInput & { action: "confirm" | "reject" },
): Promise<ConfirmMemoryResult> {
  requireId("recordId", input.recordId);
  requireId("confirmerId", input.confirmerId);
  requireNow(input.now);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await confirmOnce(db, input);
    } catch (error) {
      if (isDeadlock(error) && attempt === 0) continue;
      throw error;
    }
  }
  throw new AssistantStoreError(
    "invalid-output",
    "Confirmation did not converge",
  );
}

function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "40P01"
  );
}

async function confirmOnce(
  db: AssistantDb,
  input: ConfirmMemoryInput & { action: "confirm" | "reject" },
): Promise<ConfirmMemoryResult> {
  const current = await db`
    SELECT scope AS scope, status AS status FROM assistant_memory
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
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db`
      WITH slot AS MATERIALIZED (
        -- Slot serialization (R12-F2): lock the slot's currently-confirmed
        -- rows in id order BEFORE writing anything, so overlapping
        -- same-slot confirms serialize instead of deadlocking. MATERIALIZED
        -- plus the COUNT cross-join below forces lock-before-write: the
        -- updater cannot create a conflicting uncommitted entry while
        -- blocked. Re-reads after a wait see the winner's outcome.
        -- R13-F5: slot identity uses normalized slot_term.
        SELECT o.id FROM assistant_memory o, assistant_memory t
        WHERE t.id = ${input.recordId}
          AND t.organization_id = ${input.organizationId}
          AND o.organization_id = t.organization_id
          AND o.scope = t.scope AND o."key" = t."key"
          AND COALESCE(o.project_id::text, '') = COALESCE(t.project_id::text, '')
          AND COALESCE(o.subject_user_id, '') = COALESCE(t.subject_user_id, '')
          AND o.slot_term = t.slot_term
          AND o.status = 'confirmed'
        ORDER BY o.id
        FOR UPDATE
      ),
      updated AS (
        UPDATE assistant_memory
        SET status = ${toStatus}, confirmer_id = ${input.confirmerId},
            updated_at = ${input.now}, version = version + 1
        FROM (SELECT COUNT(*) FROM slot) AS _s
        WHERE id = ${input.recordId}
          AND organization_id = ${input.organizationId}
          AND status = 'proposed'
        RETURNING *
      ),
      sup AS (
        UPDATE assistant_memory o
        SET status = 'superseded', updated_at = ${input.now},
            version = o.version + 1
        FROM updated u
        WHERE ${toStatus} = 'confirmed'
          AND o.organization_id = u.organization_id
          AND o.scope = u.scope AND o."key" = u."key"
          AND o.id <> u.id AND o.status = 'confirmed'
          AND COALESCE(o.project_id::text, '') = COALESCE(u.project_id::text, '')
          AND COALESCE(o.subject_user_id, '') = COALESCE(u.subject_user_id, '')
          AND o.slot_term = u.slot_term
        RETURNING o.id AS id
      ),
      a1 AS (
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        SELECT ${newId("ma")}, u.id, u.organization_id, ${input.action},
          'proposed', ${toStatus}, ${input.confirmerId}, ${input.now}
        FROM updated u
        RETURNING id
      ),
      a2 AS (
        INSERT INTO assistant_memory_audit
          (id, memory_id, organization_id, action, from_status, to_status,
           actor_id, created_at)
        SELECT ('ma_' || md5(s.id || (${input.now})::text)), s.id,
          u.organization_id, 'superseded', 'confirmed', 'superseded',
          ${input.confirmerId}, ${input.now}
        FROM sup s, updated u
        RETURNING id
      )
      SELECT (SELECT row_to_json(u) FROM updated u) AS rec,
             (SELECT COALESCE(json_agg(s.id), '[]'::json) FROM sup s) AS sup_ids,
             (SELECT COUNT(*) FROM slot) AS slot_locked`;
  } catch (error) {
    if (isExclusionViolation(error) || isUniqueViolation(error)) {
      // Lost a same-slot confirmation race at commit: our proposal is
      // still proposed, the winner owns the slot.
      return { ok: false, reason: "slot-conflict" };
    }
    throw error;
  }
  const result = rows[0] as
    | { rec: Record<string, unknown> | null; sup_ids: unknown }
    | undefined;
  if (!result || result.rec === null) {
    // Lost a same-proposal race after the pre-check read.
    return { ok: false, reason: "not-proposed" };
  }
  const supersededIds = (Array.isArray(result.sup_ids)
    ? (result.sup_ids as unknown[]).map((entry) => String(entry))
    : []) as string[];
  return { ok: true, record: mapMemory(result.rec), supersededIds };
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
 * Project-deletion boundary (R12-F4): the owning product-row deletion is
 * the SINGLE transactional boundary — assistant rows are NOT pre-deleted.
 * `assistant_conversations` and project-scoped `assistant_memory` carry
 * cascade FKs into `projects`, so `DELETE FROM projects` removes them in
 * the same statement that removes the project; a failed delete leaves
 * everything intact. Workspace memory and member preferences survive by
 * design (shared knowledge outlives any single project). `deleteProject`
 * therefore issues no assistant DELETEs at all.
 *
 * There is intentionally no `purgeAssistantProjectData` helper: an
 * explicit pre-delete would reopen the partial-deletion window this
 * invariant closes.
 */

/**
 * Workspace-deletion path in ONE statement (R12-F4): every conversation,
 * memory record, and (via cascade) audit entry of the organization is
 * removed atomically. No workspace-delete route exists yet; that route
 * must call this inside its owning transaction boundary. Organization-row
 * FK cascades backstop the same outcome.
 */
export async function purgeAssistantWorkspaceData(
  db: AssistantDb,
  organizationId: string,
): Promise<{ conversationsDeleted: number; memoriesDeleted: number }> {
  requireId("organizationId", organizationId);
  const rows = await db`
    WITH c AS (
      DELETE FROM assistant_conversations
      WHERE organization_id = ${organizationId}
      RETURNING id
    ),
    m AS (
      DELETE FROM assistant_memory
      WHERE organization_id = ${organizationId}
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM c) AS convs,
           (SELECT COUNT(*) FROM m) AS mems`;
  const row = rows[0] ?? { convs: 0, mems: 0 };
  return {
    conversationsDeleted: asNumber(row.convs),
    memoriesDeleted: asNumber(row.mems),
  };
}

/**
 * Account-deletion path in ONE statement (R12-F4, R13-F2): removes the
 * user's chats (messages and runs cascade) and member preferences, and
 * replaces the deleted user's attribution with an explicit tombstone on
 * the shared records and audit entries that survive for remaining members
 * — raw user IDs leave with the account while the provenance-required
 * shapes stay valid. A failure leaves all pre-operation data intact.
 *
 * Disjoint targets (R13-F2): sibling data-modifying CTEs share one
 * snapshot with no defined order, so the same row must never be reachable
 * from two of them. Member rows being deleted (`m`) are excluded from the
 * surviving-memory tombstone; proposer/confirmer tombstoning is a single
 * `UPDATE` with two `CASE`s (one row, one writer); audit rows whose memory
 * dies in `m` are excluded from the audit update and left to their
 * cascade. Later CTEs reference `m` explicitly so the dependencies are
 * visible in the statement.
 */
export const DELETED_USER_ATTRIBUTION = "deleted-user";

export async function purgeAssistantUserData(
  db: AssistantDb,
  userId: string,
): Promise<{ conversationsDeleted: number; memoriesDeleted: number }> {
  requireId("userId", userId);
  const rows = await db`
    WITH c AS (
      DELETE FROM assistant_conversations WHERE user_id = ${userId}
      RETURNING id
    ),
    m AS (
      DELETE FROM assistant_memory
      WHERE scope = 'member' AND subject_user_id = ${userId}
      RETURNING id
    ),
    t AS (
      UPDATE assistant_memory SET
        proposer_id = CASE WHEN proposer_id = ${userId}
          THEN ${DELETED_USER_ATTRIBUTION} ELSE proposer_id END,
        confirmer_id = CASE WHEN confirmer_id = ${userId}
          THEN ${DELETED_USER_ATTRIBUTION} ELSE confirmer_id END
      WHERE (proposer_id = ${userId} OR confirmer_id = ${userId})
        AND NOT EXISTS (SELECT 1 FROM m WHERE m.id = assistant_memory.id)
      RETURNING id
    ),
    t3 AS (
      UPDATE assistant_memory_audit a SET actor_id = ${DELETED_USER_ATTRIBUTION}
      WHERE a.actor_id = ${userId}
        AND NOT EXISTS (SELECT 1 FROM m WHERE m.id = a.memory_id)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM c) AS convs,
           (SELECT COUNT(*) FROM m) AS mems`;
  const row = rows[0] ?? { convs: 0, mems: 0 };
  return {
    conversationsDeleted: asNumber(row.convs),
    memoriesDeleted: asNumber(row.mems),
  };
}

export type {
  MemoryKey,
  MemoryScope,
  MemoryStatus,
  InsightSeed,
};
