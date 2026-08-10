--> statement-breakpoint
-- ============================================================================
-- 0001_better_auth: replace the custom auth implementation with Better Auth.
--
-- Forward-only and reviewed. Steps:
--   1. Create the Better Auth tables (user/session/account/verification/jwks).
--   2. Clear disposable product fixtures owned by the old test users.
--   3. Drop the old FKs that reference users(id).
--   4. Retype product FK columns uuid -> text to match user(id) (text).
--   5. Drop the obsolete custom-auth tables (users last).
--   6. Recreate product FKs against user(id) with the original semantics.
--
-- Test data only: no production users existed when this was authored. Product
-- fixtures must be cleared with the old users because Better Auth provisions
-- fresh profiles, teams, projects, and API keys for new accounts.
-- ============================================================================

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_name" text,
	"role" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Clear disposable fixtures owned by the old test users
--
-- All related tables are listed in one TRUNCATE statement so PostgreSQL can
-- validate the existing inter-table foreign keys without using CASCADE.
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
	"project_api_keys",
	"team_avatars",
	"team_invites",
	"team_members",
	"projects",
	"profile_pictures",
	"profiles",
	"teams";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Drop old FKs referencing users(id)
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "profile_pictures" DROP CONSTRAINT IF EXISTS "profile_pictures_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "team_invites" DROP CONSTRAINT IF EXISTS "team_invites_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_creator_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "login_attempts" DROP CONSTRAINT IF EXISTS "login_attempts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" DROP CONSTRAINT IF EXISTS "oauth_access_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "otp_sign_ins" DROP CONSTRAINT IF EXISTS "otp_sign_ins_user_id_users_id_fk";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Retype product FK columns uuid -> text
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
--> statement-breakpoint
ALTER TABLE "profile_pictures" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "owner_id" TYPE text USING "owner_id"::text;
--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
--> statement-breakpoint
ALTER TABLE "team_invites" ALTER COLUMN "user_id" TYPE text USING "user_id"::text;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "creator_id" TYPE text USING "creator_id"::text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Drop obsolete custom-auth tables (users last; FKs already removed)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "oauth_access_tokens";
--> statement-breakpoint
DROP TABLE IF EXISTS "otp_sign_ins";
--> statement-breakpoint
DROP TABLE IF EXISTS "login_attempts";
--> statement-breakpoint
DROP TABLE IF EXISTS "users";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Recreate product FKs against user(id), preserving original semantics
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "profile_pictures" ADD CONSTRAINT "profile_pictures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
