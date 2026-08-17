-- ============================================================================
-- 0003_workspaces_and_sources: Better Auth Organization = Prism workspace;
-- projects carry organization_id; sources and source-bound ingestion keys
-- (task-13).
--
-- The plugin schema (organization, member, invitation + session
-- active_organization_id) is exactly the Better Auth 1.6.26 CLI output,
-- reviewed and committed.
--
-- Destructive pre-launch reset (authorized by product owner, task-13.md):
-- Prism is not launched and there is no production tenant data.
-- project_sources, project_api_keys, and projects are cleared before their
-- tenant/key relationships are rebuilt (projects.organization_id NOT NULL +
-- FK; keys.source_id NOT NULL + FK), and the legacy workspace tables
-- (teams, team_members, team_invites, team_avatars) are dropped. Local
-- development fixtures referencing project ids are intentionally
-- recreated; contributors re-create workspace/project/source fixtures
-- after this migration (see docs/local-development).
-- ============================================================================

CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"allowed_origins" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Pre-launch reset: projects/sources/keys have no durable tenant until the
-- relationships below are built; local fixture ids are intentionally
-- recreated. The team/project FKs are dropped explicitly FIRST because the
-- legacy table drops below use CASCADE.
TRUNCATE "project_sources", "project_api_keys", "projects" CASCADE;
--> statement-breakpoint
ALTER TABLE "project_api_keys" DROP CONSTRAINT "project_api_keys_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "project_api_keys" DROP CONSTRAINT "project_api_keys_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_team_id_teams_id_fk";
--> statement-breakpoint
DROP TABLE "team_avatars" CASCADE;--> statement-breakpoint
DROP TABLE "team_invites" CASCADE;--> statement-breakpoint
DROP TABLE "team_members" CASCADE;--> statement-breakpoint
DROP TABLE "teams" CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD COLUMN "source_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD COLUMN "key_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD COLUMN "last_used_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "organization_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "project_api_keys" ADD CONSTRAINT "project_api_keys_source_id_project_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "project_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_api_keys" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "project_api_keys" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "team_id";