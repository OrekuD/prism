/**
 * Assistant control-plane tables (Task 21 slice 4, hardened per R12–R15).
 *
 * Durable foundation for conversations, messages, runs, typed memory, and
 * audit history — without invoking any model. All assistant reads/writes
 * go through `assistantStore.ts` as single-statement raw SQL (no
 * multi-statement transactions), so the same code runs on Neon HTTP
 * (Cloudflare Worker) and postgres-js (Node).
 *
 * Tenant binding (R12-F3, R13-F4): single-column existence FKs live here;
 * the COMPOSITE (project, organization) pairing constraints and the
 * run message/conversation binding live in migrations 0005/0006 as raw SQL
 * (this drizzle-kit version cannot snapshot table-level composite foreign
 * keys). Together they guarantee a project row can never pair with another
 * workspace's organization, and a run row can never borrow a message from
 * another conversation. Run rows additionally derive project/user from
 * their conversation at insert time (see the store).
 *
 * Slot invariant (R12-F2, R13-F5, R14-F1, R15-F1/F2): at most one
 * `confirmed` record per canonical slot lives in migration 0006 as a
 * DEFERRABLE exclusion constraint over `slot_term` (also raw SQL —
 * drizzle cannot express it). `slot_term` is DATABASE-generated and
 * DATABASE-checked: the 0007 trigger derives it on every insert and
 * update with `assistant_canonical_term()` (Canonical Term Policy v1,
 * frozen in migration 0008), and the restored
 * `assistant_memory_slot_term_check` recomputes the same function —
 * both sides are PostgreSQL-owned, so no JavaScript reimplementation
 * exists to disagree. Display spelling stays verbatim in `payload.name`.
 *
 * Canonical Term Policy v1 (frozen, R15-F1): NFKC composition, then every
 * character of the agreed ECMAScript-whitespace set (U+0009–000D, U+0020,
 * U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000,
 * U+FEFF) maps to one ASCII space, runs collapse, trim, then ASCII-only
 * A–Z folds to a–z. Non-ASCII case variants (e.g. Greek final sigma) are
 * deliberately distinct slots; blank-after-normalization names are
 * rejected rather than sharing an empty slot. Only NFKC follows the
 * database's Unicode version — see the migration 0008 compatibility rule.
 *
 * Durable checks (R12-F5): enums, non-negative times, step bounds, the
 * frozen definition version, running/completed timestamp rules, the
 * idempotency-key/digest pairing, digest format (SHA-256 or the single
 * `legacy-0004-unverifiable` sentinel from the 0005 backfill), and the
 * slot-term CHECK below.
 *
 * Idempotency digests (R12-F6, R13-F1): every idempotency key travels with
 * a SHA-256 digest of the request content. A reused key with different
 * content is a conflict, never a silent alias. Pre-digest 0004 rows carry
 * the backfilled sentinel and are treated as unverifiable — never as
 * verified retries.
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
    /**
     * URL slug (`chat_` + 12 lowercase alphanumerics). Generated in the
     * application at creation; backfilled deterministically for legacy
     * rows by migration 0009.
     */
    slug: text("slug").notNull(),
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
    /**
     * URL slug: `chat_` + 12 lowercase alphanumerics (same opaque
     * recipe as workspace `wrk_` slugs), globally unique, immutable
     * after creation. The only chat identifier browsers ever see.
     */
    uniqueIndex("assistant_conversations_slug_uidx").on(table.slug),
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
    check(
      "assistant_conversations_digest_format_check",
      sql`"request_digest" IS NULL OR "request_digest" ~ '^[0-9a-f]{64}$' OR "request_digest" = 'legacy-0004-unverifiable'`,
    ),
    check(
      "assistant_conversations_slug_format_check",
      sql`"slug" ~ '^chat_[a-z0-9]{12}$'`,
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
    // R13-F4 backstop: the composite run FK targets (id, conversation_id),
    // so the pair needs its own unique constraint (the PK on id alone is
    // not a composite FK target).
    unique("assistant_messages_identity_uidx").on(
      table.id,
      table.conversationId,
    ),
    check(
      "assistant_messages_shape_check",
      sql`"role" IN ('user', 'assistant') AND "status" IN ('pending', 'streaming', 'complete', 'cancelled', 'failed') AND "seq" >= 0 AND "created_at" >= 0 AND ("completed_at" IS NULL OR "completed_at" >= 0) AND ((("status" IN ('complete', 'cancelled', 'failed')) AND "completed_at" IS NOT NULL) OR (("status" IN ('pending', 'streaming')) AND "completed_at" IS NULL))`,
    ),
    check(
      "assistant_messages_digest_check",
      sql`("client_request_id" IS NULL) = ("request_digest" IS NULL)`,
    ),
    check(
      "assistant_messages_digest_format_check",
      sql`"request_digest" IS NULL OR "request_digest" ~ '^[0-9a-f]{64}$' OR "request_digest" = 'legacy-0004-unverifiable'`,
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
 * one-confirmed-per-slot exclusion constraint (migration 0006, over
 * `slot_term`) plus conditional `UPDATE ... WHERE status='proposed'`
 * resolve confirmation races. Member preferences persist directly as
 * `confirmed` (R12-F7). `slot_term` is database-owned: the trigger
 * derives it on every write and `assistant_memory_slot_term_check`
 * recomputes the same function as defense in depth (R15-F2) — both
 * PostgreSQL-owned, so raw SQL can neither smuggle nor strand a
 * discriminator. Display spelling stays in payload.
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
    /**
     * Database-generated slot discriminator (R14-F1, R15-F1/F2): owned by
     * the BEFORE trigger on every write and re-validated by
     * `assistant_memory_slot_term_check`, never written by application
     * code. Business terms carry the trigger-computed canonical value
     * (Policy v1); all other keys store `''`; blank business-term
     * canonicals are rejected rather than sharing an empty slot.
     */
    slotTerm: text("slot_term").notNull().default(""),
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
    check(
      "assistant_memory_slot_term_check",
      sql`(("key" <> 'business-term') AND ("slot_term" = '')) OR (("key" = 'business-term') AND ("slot_term" = assistant_canonical_term("payload" ->> 'name')) AND ("slot_term" <> ''))`,
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
