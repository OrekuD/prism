-- Person + identity storage (task-10 §4, ADR 0003). The events table
-- gains the immutable user_id (from the envelope) and the derived
-- person_id association (a rebuildable projection — raw events are never
-- rewritten). Person IDs are DETERMINISTIC hashes: u_<sha256(project:user)>
-- for known people, a_<sha256(project:anonymous)> for anonymous-only —
-- concurrent identifies can never create duplicate people.
ALTER TABLE events ADD COLUMN user_id TEXT;
ALTER TABLE events ADD COLUMN person_id TEXT;

CREATE INDEX IF NOT EXISTS events_project_person_idx
  ON events(project_id, person_id, received_at);

CREATE TABLE IF NOT EXISTS people (
  person_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

CREATE INDEX IF NOT EXISTS people_project_last_seen_idx
  ON people(project_id, last_seen_at);

-- Durable identity links (identity history for export/deletion; first
-- link wins — an anonymous ID is never silently re-linked to a second
-- person over a shared device).
CREATE TABLE IF NOT EXISTS external_identities (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS external_identities_person_idx
  ON external_identities(project_id, person_id);

CREATE TABLE IF NOT EXISTS anonymous_identities (
  project_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, anonymous_id)
);

CREATE INDEX IF NOT EXISTS anonymous_identities_person_idx
  ON anonymous_identities(project_id, person_id);

CREATE TABLE IF NOT EXISTS person_traits (
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, person_id, key)
);

-- Identify-operation idempotency (retries dedupe by client op id).
CREATE TABLE IF NOT EXISTS identity_ops (
  project_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  user_id TEXT,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, op_id)
);
