# Database reconciliation notes (Task 2)

Read-only inspection was performed with `yarn workspace prism-api db:inspect`
against the configured Neon database and Turso database. No schema changes
have been applied to shared data yet beyond the non-destructive ones below.

## Neon (product database)

- Target: the database referenced by `DATABASE_URL` in `apps/api/.dev.vars`
  (development branch; contains 3 users, 3 teams, 2 projects, 2 project API
  keys, 12 OAuth access tokens).
- Actual structure **matches** the checked-in Drizzle migration
  (`apps/api/drizzle/0000_groovy_epoch.sql`): all 12 tables, columns, defaults,
  foreign keys, and unique indexes are present and consistent.
- **Migration-journal drift**: the live `drizzle.__drizzle_migrations` table
  records 5 applied entries, while the repository ships 1 migration file.
  The extra entries are from an earlier, squashed development history. Because
  the current structure matches exactly and the migration uses
  `CREATE TABLE IF NOT EXISTS`, re-running `db:migrate` is a no-op for
  structure. No action required; do not delete the journal.
- No missing indexes or incompatible column types found.

## Turso (analytics database)

- Target: the database referenced by `TURSO_DATABASE_URL` in
  `apps/api/.dev.vars` / `apps/analytics-api/.env` (contains 67 sessions).
- Actual `sessions` table matches the checked-in `db/schema.sql` columns.
- **Drift found**:
  1. Missing `sessions_session_id_idx` (used by `endSession` lookups).
  2. Missing `sessions_created_at_idx` (used by dashboard summary queries).
  3. NOT NULL constraints are not enforced on the live table (created from the
     legacy D1-style schema). The code treats these fields as nullable, so no
     rebuild is scheduled; noted for the analytics-schema follow-up.
- **Resolution** (non-destructive, idempotent): `db/schema.sql` was updated to
  match the live structure exactly, and the two missing indexes are added by
  `yarn workspace prism-analytics-api db:setup` (now runs schema + migrations)
  using `CREATE INDEX IF NOT EXISTS`.

## Legacy D1 path

The Cloudflare D1 database (`prism-analytics`) was the original analytics
store. All runtime consumers were removed in Task 2 (team-project summaries
now read from Turso; the `/test` debug route, the wrangler binding, the
`db:d1-init*` scripts, and `InjectDatabaseMiddleware` were deleted).
`apps/api/d1/schema.sql` is kept as a historical reference only.

**Data-migration decision**: a representative comparison showed D1 and Turso
served the same session-shape data; the 67 sessions in Turso are the current
canonical data. No one-time data migration from D1 is needed for the local
development baseline.

## Future schema work

- Turso: consider a table rebuild to enforce NOT NULL (requires a
  backfill-safe copy; not needed for the current code paths).
- Neon: keep the Drizzle migration journal; add forward-only migrations for
  future schema changes instead of regenerating 0000.
