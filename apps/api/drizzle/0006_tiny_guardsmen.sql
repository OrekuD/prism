ALTER TABLE "assistant_memory" ADD COLUMN "slot_term" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- ============================================================================
-- R13-F5: canonical business-term slot function. Identical steps to
-- `canonicalBusinessTermName` in packages/types: NFKC, collapse every
-- whitespace run to one space, trim, lowercase. IMMUTABLE so CHECKs and
-- the exclusion constraint can use it; application and database derive
-- the same slot by construction (the slot_term CHECK below recomputes).
-- ============================================================================
CREATE OR REPLACE FUNCTION assistant_canonical_term(name text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(btrim(regexp_replace(normalize($1, NFKC), '\s+', ' ', 'g'), ' ')) $$;--> statement-breakpoint
-- Backfill BEFORE the slot_term CHECK: existing business terms adopt
-- their canonical discriminator; every other key keeps ''.
UPDATE "assistant_memory" SET "slot_term" = assistant_canonical_term("payload" ->> 'name') WHERE "key" = 'business-term';--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_identity_uidx" UNIQUE("id","conversation_id");--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_digest_format_check" CHECK ("request_digest" IS NULL OR "request_digest" ~ '^[0-9a-f]{64}$' OR "request_digest" = 'legacy-0004-unverifiable');--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_slot_term_check" CHECK ((("key" <> 'business-term') AND ("slot_term" = '')) OR (("key" = 'business-term') AND ("slot_term" = assistant_canonical_term("payload" ->> 'name'))));--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_digest_format_check" CHECK ("request_digest" IS NULL OR "request_digest" ~ '^[0-9a-f]{64}$' OR "request_digest" = 'legacy-0004-unverifiable');--> statement-breakpoint
-- ============================================================================
-- R13-F5: replace the exact-match term discriminator with the normalized
-- `slot_term` column. Same DEFERRABLE semantics: legitimate succession
-- commits atomically, overlapping same-slot confirms serialize at commit.
-- ============================================================================
ALTER TABLE "assistant_memory" DROP CONSTRAINT "assistant_memory_one_confirmed_per_slot";--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_one_confirmed_per_slot" EXCLUDE USING btree ("organization_id" WITH =, "scope" WITH =, "key" WITH =, COALESCE("project_id"::text, '') WITH =, COALESCE("subject_user_id", '') WITH =, "slot_term" WITH =) WHERE ("status" = 'confirmed') DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
-- ============================================================================
-- R13-F4: a run's message must belong to its conversation. The composite
-- FK targets (id, conversation_id) on messages (backstopped above);
-- raw SQL because this drizzle-kit version cannot snapshot composite FKs.
-- The store's INSERT ... SELECT join stays as defense in depth.
-- ============================================================================
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_message_conversation_fk" FOREIGN KEY ("message_id","conversation_id") REFERENCES "assistant_messages"("id","conversation_id") ON DELETE cascade ON UPDATE no action;
