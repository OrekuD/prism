ALTER TABLE "assistant_conversations" ADD COLUMN "request_digest" text;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD COLUMN "request_digest" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_tenant_uidx" ON "projects" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_identity_uidx" UNIQUE("id","project_id","user_id");--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_times_check" CHECK ("created_at" >= 0 AND "updated_at" >= 0 AND ("last_message_at" IS NULL OR "last_message_at" >= 0));--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_digest_check" CHECK (("client_request_id" IS NULL) = ("request_digest" IS NULL));--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_shape_check" CHECK ("scope" IN ('project', 'workspace', 'member') AND "status" IN ('proposed', 'confirmed', 'superseded', 'rejected') AND "created_at" >= 0 AND "updated_at" >= 0 AND "version" >= 0);--> statement-breakpoint
ALTER TABLE "assistant_memory_audit" ADD CONSTRAINT "assistant_memory_audit_shape_check" CHECK ("created_at" >= 0);--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_shape_check" CHECK ("role" IN ('user', 'assistant') AND "status" IN ('pending', 'streaming', 'complete', 'cancelled', 'failed') AND "seq" >= 0 AND "created_at" >= 0 AND ("completed_at" IS NULL OR "completed_at" >= 0) AND ((("status" IN ('complete', 'cancelled', 'failed')) AND "completed_at" IS NOT NULL) OR (("status" IN ('pending', 'streaming')) AND "completed_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_digest_check" CHECK (("client_request_id" IS NULL) = ("request_digest" IS NULL));--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_shape_check" CHECK ("status" IN ('running', 'complete', 'cancelled', 'failed') AND "step_count" >= 0 AND "step_count" <= 6 AND "definition_version" = 1 AND "started_at" >= 0 AND ("completed_at" IS NULL OR "completed_at" >= 0) AND ("latency_ms" IS NULL OR "latency_ms" >= 0) AND ((("status" = 'running') AND "completed_at" IS NULL) OR ((("status" IN ('complete', 'cancelled', 'failed'))) AND "completed_at" IS NOT NULL)));--> statement-breakpoint
-- ============================================================================
-- R12-F3: composite tenant bindings (raw SQL — this drizzle-kit version
-- cannot snapshot table-level composite foreign keys, so they live here
-- and are documented in schema/assistant.ts; do not remove them in a
-- future generated migration).
-- A project row can never pair with another workspace's organization, and
-- a run row can never drift from its chat's tenant.
-- ============================================================================
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_tenant_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_tenant_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_conversation_tenant_fk" FOREIGN KEY ("conversation_id","project_id","user_id") REFERENCES "assistant_conversations"("id","project_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- R12-F2: at most one `confirmed` record per canonical slot, owned by the
-- database. The slot is (organization, scope, key, nullable project/member
-- owner, business-term name where that key permits multiple terms).
-- DEFERRABLE so legitimate succession (confirm-new + supersede-old in one
-- statement) commits, while concurrent same-slot confirms serialize at
-- commit: exactly one wins, the loser rolls back entirely.
-- Exclusion-violation code is 23P01 (handle beside 23505 in the store).
-- ============================================================================
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_one_confirmed_per_slot" EXCLUDE USING btree ("organization_id" WITH =, "scope" WITH =, "key" WITH =, COALESCE("project_id"::text, '') WITH =, COALESCE("subject_user_id", '') WITH =, COALESCE("payload"->>'name', '') WITH =) WHERE ("status" = 'confirmed') DEFERRABLE INITIALLY DEFERRED;
