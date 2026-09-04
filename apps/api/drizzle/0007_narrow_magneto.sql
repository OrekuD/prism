ALTER TABLE "assistant_memory" DROP CONSTRAINT "assistant_memory_slot_term_check";--> statement-breakpoint
-- ============================================================================
-- R14-F1: single authoritative slot implementation. The BEFORE trigger
-- derives slot_term from key/payload with assistant_canonical_term() on
-- EVERY insert and key/payload update, overwriting any caller-supplied
-- value. JavaScript never computes slot identity, so divergent Unicode
-- runtimes (ECMAScript vs PostgreSQL case/whitespace handling, locale or
-- Unicode-version differences) cannot disagree: lock, insert, and
-- exclusion all read the same database-computed column. Display spelling
-- stays verbatim in payload.name. Stored values make reads stable across
-- later database upgrades.
-- ============================================================================
CREATE OR REPLACE FUNCTION assistant_memory_slot_term_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.slot_term := CASE WHEN NEW."key" = 'business-term' THEN COALESCE(assistant_canonical_term(NEW.payload ->> 'name'), '') ELSE '' END; RETURN NEW; END; $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS assistant_memory_slot_term_trg ON "assistant_memory";--> statement-breakpoint
CREATE TRIGGER assistant_memory_slot_term_trg BEFORE INSERT OR UPDATE OF "key", payload ON "assistant_memory" FOR EACH ROW EXECUTE FUNCTION assistant_memory_slot_term_trigger();--> statement-breakpoint
-- Recompute existing rows through the single implementation, healing any
-- 0006-era JavaScript-derived values that disagree with the database.
UPDATE "assistant_memory" SET "slot_term" = CASE WHEN "key" = 'business-term' THEN COALESCE(assistant_canonical_term(payload ->> 'name'), '') ELSE '' END;
