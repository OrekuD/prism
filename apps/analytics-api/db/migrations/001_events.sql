-- v2 events model (task-9 §9): the versioned, idempotent ingestion store.
-- Idempotency: PRIMARY KEY (project_id, id) + conflict-safe inserts make
-- transport retries safe. occurred_at = client clock (offline-safe),
-- received_at = server clock (retention operates on this). SDK identity
-- is derived from the authoritative batch envelope and stored in explicit
-- columns (slice-4 review F13) — never repeated per event, never
-- client-overridable. Raw IP is never stored; client-provided ownership
-- fields are ignored by the ingestion controller.
CREATE TABLE IF NOT EXISTS events (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  schema_version INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  session_id TEXT,
  anonymous_id TEXT,
  properties TEXT,
  context TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  PRIMARY KEY (project_id, id)
);

-- Query indexes justified by the next read stages (task-9 §9: verify on
-- representative data rather than indexing every column speculatively):
-- project/time for dashboards, project/name/time for event drill-down,
-- session/time and anonymous identity for session + identity queries.
CREATE INDEX IF NOT EXISTS events_project_occurred_idx
  ON events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_name_time_idx
  ON events(project_id, name, occurred_at);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id);
CREATE INDEX IF NOT EXISTS events_anonymous_idx ON events(anonymous_id);
