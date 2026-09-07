-- ============================================================================
-- Conversation URL slugs (`chat_` + 12 lowercase alphanumerics, same opaque
-- recipe as workspace `wrk_` slugs). The ADD COLUMN lands nullable first so
-- populated pre-launch databases upgrade: legacy rows backfill
-- deterministically from their random row ID (`chat_` + md5 prefix —
-- md5 hex is already lowercase alphanumerics), then the column goes
-- NOT NULL. New rows always carry application-generated crypto-random
-- slugs; the format CHECK owns the shape on every write.
-- ============================================================================
ALTER TABLE "assistant_conversations" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "assistant_conversations" SET "slug" = 'chat_' || substr(md5("id"), 1, 12) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_conversations_slug_uidx" ON "assistant_conversations" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_slug_format_check" CHECK ("slug" ~ '^chat_[a-z0-9]{12}$');
