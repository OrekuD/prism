-- ============================================================================
-- R15-F1: Canonical Term Policy v1 (frozen). NFKC composition, then every
-- character of the agreed ECMAScript-whitespace set maps to one ASCII
-- space (explicit translate() — never a locale-dependent shorthand, so
-- U+FEFF and friends canonicalize identically everywhere), runs collapse
-- to one space, trim, then ASCII-only A-Z folds to a-z. Non-ASCII case
-- variants are deliberately distinct slots; display spelling is
-- preserved separately in payload. Only NFKC follows the database's
-- Unicode version — compatibility rule: slot identity is STORED at write
-- time, so reads never recompute; a future PostgreSQL/Unicode upgrade
-- changing NFKC tables affects new writes only, and any policy change
-- ships as a new versioned function plus healing migration (never an
-- in-place redefinition). Exercise this matrix in the Slice 8
-- hosted proof (PG majors x locales) before calling it portable to
-- self-hosted deployments.
-- Whitespace set (25): U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A,
-- U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
-- ============================================================================
CREATE OR REPLACE FUNCTION assistant_canonical_term(name text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT translate(btrim(regexp_replace(translate(normalize($1, NFKC), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', rpad(' ', 25, ' ')), ' +', ' ', 'g'), ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') $$;--> statement-breakpoint
-- ============================================================================
-- R15-F2: the trigger fires on EVERY update (no column list), always
-- recomputing slot_term — a direct slot_term write is overwritten in the
-- same row version and can never persist a disagreeing discriminator.
-- The CHECK below re-validates the same function as defense in depth
-- (both PostgreSQL-owned, so no R14 cross-runtime issue).
-- ============================================================================
DROP TRIGGER IF EXISTS assistant_memory_slot_term_trg ON "assistant_memory";--> statement-breakpoint
CREATE TRIGGER assistant_memory_slot_term_trg BEFORE INSERT OR UPDATE ON "assistant_memory" FOR EACH ROW EXECUTE FUNCTION assistant_memory_slot_term_trigger();--> statement-breakpoint
-- ============================================================================
-- R16-F1: populated-upgrade healing. Policy v1 can merge two terms that
-- were distinct confirmed slots before (e.g. `A B` vs `A<U+FEFF>B`), and
-- can empty a legacy whitespace-only name — both would fail the backfill
-- and final CHECK instead of healing. This is a pre-launch store with no
-- production assistant memory, so the migration owns both branches:
-- (a) degenerate blank-canonical business terms are DELETED with their
-- dependent audit rows (cascades); a blank name can never confirm again,
-- so nothing of value is lost;
-- (b) each newly colliding confirmed group keeps ONE deterministic winner
-- (earliest created_at, ties by id) while the rest are superseded with a
-- migration-owned audit entry (NULL actor). Non-business keys cannot
-- newly collide: their slot stays `''`, exactly as before.
-- Atomicity: the real drizzle runner applies every pending statement in
-- ONE transaction (pg-core dialect `session.transaction`), so any failure
-- rolls the whole file back — a failed upgrade cannot strand new slots
-- beside the old trigger, or the new CHECK beside unhealed rows.
-- ============================================================================
WITH doomed AS (
  DELETE FROM assistant_memory
  WHERE "key" = 'business-term'
    AND COALESCE(assistant_canonical_term(payload ->> 'name'), '') = ''
  RETURNING id
)
SELECT (SELECT COUNT(*) FROM doomed) AS blank_terms_deleted;--> statement-breakpoint
WITH new_slots AS (
  SELECT m.id, m.organization_id, m.scope, m."key", m.created_at,
    COALESCE(m.project_id::text, '') AS proj,
    COALESCE(m.subject_user_id, '') AS subj,
    assistant_canonical_term(m.payload ->> 'name') AS canon
  FROM assistant_memory m
  WHERE m."key" = 'business-term' AND m.status = 'confirmed'
    AND COALESCE(assistant_canonical_term(m.payload ->> 'name'), '') <> ''
),
ranked AS (
  SELECT id, organization_id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, scope, "key", proj, subj, canon
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM new_slots
),
losers AS (
  UPDATE assistant_memory o
  SET status = 'superseded',
      updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
      version = o.version + 1
  FROM ranked r
  WHERE o.id = r.id AND r.rn > 1
  RETURNING o.id AS id, o.organization_id AS organization_id
),
audit AS (
  INSERT INTO assistant_memory_audit
    (id, memory_id, organization_id, action, from_status, to_status,
     actor_id, created_at)
  SELECT ('ma_' || md5(l.id || '0008-term-reconciliation')), l.id,
    l.organization_id, 'superseded', 'confirmed', 'superseded', NULL,
    (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
  FROM losers l
  RETURNING id
)
SELECT (SELECT COUNT(*) FROM losers) AS colliding_terms_superseded,
       (SELECT COUNT(*) FROM audit) AS reconciliation_audits;--> statement-breakpoint
-- Heal stored discriminators through the single implementation BEFORE the
-- CHECK validates them (e.g. FEFF-era values canonicalize to spaces now).
UPDATE "assistant_memory" SET "slot_term" = CASE WHEN "key" = 'business-term' THEN COALESCE(assistant_canonical_term(payload ->> 'name'), '') ELSE '' END;--> statement-breakpoint
ALTER TABLE "assistant_memory" ADD CONSTRAINT "assistant_memory_slot_term_check" CHECK ((("key" <> 'business-term') AND ("slot_term" = '')) OR (("key" = 'business-term') AND ("slot_term" = assistant_canonical_term("payload" ->> 'name')) AND ("slot_term" <> '')));
