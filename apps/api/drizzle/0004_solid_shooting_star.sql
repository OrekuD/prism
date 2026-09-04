CREATE TABLE "assistant_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"seed_insight_id" text,
	"client_request_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_message_at" bigint
);
--> statement-breakpoint
CREATE TABLE "assistant_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"project_id" uuid,
	"subject_user_id" text,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb NOT NULL,
	"proposer_id" text,
	"confirmer_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_memory_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"parts" jsonb NOT NULL,
	"failure_code" text,
	"client_request_id" text,
	"created_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "assistant_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"query_context_hash" text NOT NULL,
	"definition_version" integer NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"tool_ids" jsonb NOT NULL,
	"usage" jsonb,
	"fact_ids" jsonb NOT NULL,
	"artifact_ids" jsonb NOT NULL,
	"latency_ms" bigint,
	"started_at" bigint NOT NULL,
	"completed_at" bigint,
	"failure_code" text
);
--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory_audit" ADD CONSTRAINT "assistant_memory_audit_memory_id_assistant_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."assistant_memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory_audit" ADD CONSTRAINT "assistant_memory_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_message_id_assistant_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."assistant_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_conversations_owner_idx" ON "assistant_conversations" USING btree ("project_id","user_id","last_message_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_create_uidx" ON "assistant_conversations" USING btree ("project_id","user_id","client_request_id") WHERE "client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_memory_project_idx" ON "assistant_memory" USING btree ("organization_id","project_id","scope","status");--> statement-breakpoint
CREATE INDEX "assistant_memory_member_idx" ON "assistant_memory" USING btree ("organization_id","subject_user_id","scope","status");--> statement-breakpoint
CREATE INDEX "assistant_memory_audit_memory_idx" ON "assistant_memory_audit" USING btree ("memory_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_memory_audit_org_idx" ON "assistant_memory_audit" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_conversation_idx" ON "assistant_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_messages_seq_uidx" ON "assistant_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_messages_request_uidx" ON "assistant_messages" USING btree ("conversation_id","client_request_id") WHERE "client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_runs_conversation_idx" ON "assistant_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "assistant_runs_owner_idx" ON "assistant_runs" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_runs_one_active_uidx" ON "assistant_runs" USING btree ("project_id","user_id") WHERE "status" = 'running';