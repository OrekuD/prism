/**
 * Assistant control-plane tables (Task 21 slice 4).
 *
 * Durable foundation for conversations, messages, runs, typed memory, and
 * audit history — without invoking any model. All assistant reads/writes
 * go through `assistantStore.ts` as single-statement raw SQL (no
 * multi-statement transactions), so the same code runs on Neon HTTP
 * (Cloudflare Worker) and postgres-js (Node).
 *
 * Conventions:
 * - IDs are opaque prefixed text (`conv_`, `msg_`, `run_`, `mem_`, `ma_`).
 * - Times are millisecond-epoch bigints, matching the frozen contract
 *   shapes (`ConversationSchema`, `AssistantMessageSchema`, ...).
 * - Tenant provenance (`organization_id`, `project_id`, `user_id`) is
 *   stored on every row; the store scopes every query by the verified IDs.
 * - Message parts, run arrays, usage, and memory payloads are JSONB.
 */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
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
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    lastMessageAt: bigint("last_message_at", { mode: "number" }),
  },
  (table) => [
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
  ],
);

/**
 * Agent runs. One *running* run per `(project, user)` is enforced by a
 * partial unique index — the database, never a browser flag, owns the
 * one-active-run constraint.
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
  ],
);

/**
 * Typed memory across project/workspace/member scopes. Proposals are
 * `proposed`-status records — no separate proposals table; confirmation
 * races resolve through conditional `UPDATE ... WHERE status='proposed'`
 * plus `transitionProposal`, and confirmation supersedes the prior
 * confirmed record in the same slot transactionally.
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
  ],
);
