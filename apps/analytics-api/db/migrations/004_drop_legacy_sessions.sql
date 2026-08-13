-- v1 removal (task-9 slice 6): the legacy `sessions` table existed only for
-- the v1 ingestion routes and their product-API summaries. All consumers
-- now read the v2 model (sessions_v2 + events) — the legacy table is
-- dropped together with the v1 routes in this release.
DROP TABLE IF EXISTS sessions;
