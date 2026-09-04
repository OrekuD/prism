/**
 * Assistant control-plane tables (Task 21 slice 4, hardened per R12).
 *
 * Durable foundation for conversations, messages, runs, typed memory, and
 * audit history — without invoking any model. All assistant reads/writes
 * go through `assistantStore.ts` as single-statement raw SQL (no
 * multi-statement transactions), so the same code runs on Neon HTTP
 * (Cloudflare Worker) and postgres-js (Node).
 *
 * Tenant binding (R12-F3): single-column existence FKs live here; the
 * COMPOSITE (project, organization) pairing constraints live in
 * migration 0005 as raw SQL (this drizzle-kit version cannot snapshot
 * table-level composite foreign keys). Together they guarantee a project
 * row can never pair with another workspace's organization. Run rows
 * additionally derive project/user from their conversation at insert
 * time (see the store).
 *
 * Slot invariant (R12-F2): at most one `confirmed` record per canonical
 * slot lives in migration 0005 as a DEFERRABLE exclusion constraint
 * (also raw SQL — drizzle cannot express it).
 *
 * Durable checks (R12-F5): enums, non-negative times, step bounds, the
 * frozen definition version, running/completed timestamp rules, and the
 * idempotency-key/digest pairing below.
 *
 * Idempotency digests (R12-F6): every idempotency key travels with a
 * SHA-256 digest of the request content. A reused key with different
 * content is a conflict, never a silent alias.
 *
 * Conventions:
 * - IDs are opaque prefixed text (`conv_`, `msg_`, `run_`, `mem_`, `ma_`).
 * - Times are millisecond-epoch bigints, matching the frozen contract
 *   shapes (`ConversationSchema`, `AssistantMessageSchema`, ...).
 * - Message parts, run arrays, usage, and memory payloads are JSONB.
 */
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { DatabaseTables } from "../../types/types";
import { organization, user } from "./auth";
import { projects } from "./projects";

/** One private chat per row; lazy-created on first submit (R1-F5). */
export const assistantConversations = pgTable(
  DatabaseTables.ASSISTANT_CONVERSATIONS,
  {
    id: text("id").primaryKey(),
    // Existence checks; pairing is owned by 0005's composite FK.
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    /** Insight seed that created the chat, if any (seed references only). */
    seedInsightId: text("seed_insight_id"),
    /**
     * Idempotency key for lazy creation: retries of the same client
     * request converge on one conversation.
     */
    clientRequestId: text("client_request_id"),
    /** SHA-256 over first message, seed, and snapshot context (R12-F6). */
    requestDigest: text("request_digest"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    lastMessageAt: bigint("last_message_at", { mode: "number" }),
  },
  (table) => [
    // Identity backstop for the 0005 runs composite FK (R12-F3).
    unique("assistant_conversations_identity_uidx").on(
      table.id,
      table.projectId,
      table.userId,
    ),
    // History order `(last_message_at DESC NULLS LAST, id DESC)` plus the
    // tenant scope every list query binds.
    index("assistant_conversations_owner_idx").on(
      table.projectId,
      table.userId,
      table.lastMessageAt,
      table.id,
    ),
    // Duplicate creation converges: one row per client request.
    uniqueIndex("assistant_conversations_create_uidx")
      .on(table.projectId, table.userId, table.clientRequestId)
      .where(sql`"client_request_id" IS NOT NULL`),
    check(
      "assistant_conversations_times_check",
      sql`"created_at" >= 0 AND "updated_at" >= 0 AND ("last_message_at" IS NULL OR "last_message_at" >= 0)`,
    ),
    check(
      "assistant_conversations_digest_check",
      sql`("client_request_id" IS NULL) = ("request_digest" IS NULL)`,
    ),
  ],
);

/** Ordered messages of one conversation; seq is append-only per chat. */
export const assistantMessages = pgTable(
  DatabaseTables.ASSISTANT_MESSAGES,
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .references(() => assistantConversations.id, { onDelete: "cascade" })
      .notNull(),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    /** Validated UI parts only — never raw provider payloads. */
    parts: jsonb("parts").notNull(),
    failureCode: text("failure_code"),
    /** Idempotency key for retried submissions within one chat. */
    clientRequestId: text("client_request_id"),
    /** SHA-256 over role/status/parts/completion fields (R12-F6). */
    requestDigest: text("request_digest"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
  },
  (table) => [
    index("assistant_messages_conversation_idx").on(
      table.conversationId,
      table.seq,
    ),
    // Atomic sequencing: concurrent appends serialize on this constraint
    // (loser retries against the new max).
    uniqueIndex("assistant_messages_seq_uidx").on(
      table.conversationId,
      table.seq,
    ),
    // Retried submissions converge on one message row.
    uniqueIndex("assistant_messages_request_uidx")
      .on(table.conversationId, table.clientRequestId)
      .where(sql`"client_request_id" IS NOT NULL`),
    check(
      "assistant_messages_shape_check",
      sql`"role" IN ('user', 'assistant') AND "status" IN ('pending', 'streaming', 'complete', 'cancelled', 'failed') AND "seq" >= 0 AND "created_at" >= 0 AND ("completed_at" IS NULL OR "completed_at" >= 0) AND ((("status" IN ('complete', 'cancelled', 'failed')) AND "completed_at" IS NOT NULL) OR (("status" IN ('pending', 'streaming')) AND "completed_at" IS NULL))`,
    ),
    check(
      "assistant_messages_digest_check",
      sql`("client_request_id" IS NULL) = ("request_digest" IS NULL)`,
    ),
  ],
);

/**
 * Agent runs. One *running* run per `(project, user)` is enforced by a
 * partial unique index — the database, never a browser flag, owns the
 * one-active-run constraint. Project/user provenance is derived from the
 * owning conversation at insert time and held by 0005's composite FK
 * (R12-F3).
 */
export const assistantRuns = pgTable(
  DatabaseTables.ASSISTANT_RUNS,
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .references(() => assistantConversations.id, { onDelete: "cascade" })
      .notNull(),
    messageId: text("message_id")
      .references(() => assistantMessages.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    queryContextHash: text("query_context_hash").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    stepCount: integer("step_count").notNull().default(0),
    toolIds: jsonb("tool_ids").notNull(),
    usage: jsonb("usage"),
    factIds: jsonb("fact_ids").notNull(),
    artifactIds: jsonb("artifact_ids").notNull(),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    failureCode: text("failure_code"),
  },
  (table) => [
    index("assistant_runs_conversation_idx").on(table.conversationId),
    index("assistant_runs_owner_idx").on(table.projectId, table.userId),
    uniqueIndex("assistant_runs_one_active_uidx")
      .on(table.projectId, table.userId)
      .where(sql`"status" = 'running'`),
    check(
      "assistant_runs_shape_check",
      sql`"status" IN ('running', 'complete', 'cancelled', 'failed') AND "step_count" >= 0 AND "step_count" <= 6 AND "definition_version" = 1 AND "started_at" >= 0 AND ("completed_at" IS NULL OR "completed_at" >= 0) AND ("latency_ms" IS NULL OR "latency_ms" >= 0) AND ((("status" = 'running') AND "completed_at" IS NULL) OR ((("status" IN ('complete', 'cancelled', 'failed'))) AND "completed_at" IS NOT NULL))`,
    ),
  ],
);

/**
 * Typed memory across project/workspace/member scopes. Proposals are
 * `proposed`-status records — no separate proposals table; the
 * one-confirmed-per-slot exclusion constraint (migration 0005) plus
 * conditional `UPDATE ... WHERE status='proposed'` resolve confirmation
 * races. Member preferences persist directly as `confirmed` (R12-F7).
 */
export const assistantMemory = pgTable(
  DatabaseTables.ASSISTANT_MEMORY,
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    /** Project knowledge belongs to exactly one project (null otherwise). */
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    /** Member preferences are owned by exactly one member (null otherwise). */
    subjectUserId: text("subject_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    label: text("label").notNull(),
    description: text("description").notNull(),
    payload: jsonb("payload").notNull(),
    proposerId: text("proposer_id"),
    confirmerId: text("confirmer_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("assistant_memory_project_idx").on(
      table.organizationId,
      table.projectId,
      table.scope,
      table.status,
    ),
    index("assistant_memory_member_idx").on(
      table.organizationId,
      table.subjectUserId,
      table.scope,
      table.status,
    ),
    check(
      "assistant_memory_shape_check",
      sql`"scope" IN ('project', 'workspace', 'member') AND "status" IN ('proposed', 'confirmed', 'superseded', 'rejected') AND "created_at" >= 0 AND "updated_at" >= 0 AND "version" >= 0`,
    ),
  ],
);

/** Append-only lifecycle history for every memory record. */
export const assistantMemoryAudit = pgTable(
  DatabaseTables.ASSISTANT_MEMORY_AUDIT,
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .references(() => assistantMemory.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id")
      .references(() => organization.id, { onDelete: "cascade" })
      .notNull(),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorId: text("actor_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("assistant_memory_audit_memory_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    index("assistant_memory_audit_org_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check("assistant_memory_audit_shape_check", sql`"created_at" >= 0`),
  ],
);
