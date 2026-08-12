-- Prism analytics schema (canonical store: Turso/libSQL).
-- Applied with `yarn db:setup` (idempotent — safe to run repeatedly).

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  referrer TEXT,
  country_code TEXT,
  os TEXT,
  browser TEXT,
  location TEXT,
  is_mobile INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  lat TEXT,
  long TEXT,
  is_online INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_session_id_idx ON sessions(session_id);
CREATE INDEX IF NOT EXISTS sessions_country_code_idx ON sessions(country_code);
CREATE INDEX IF NOT EXISTS sessions_os_idx ON sessions(os);
CREATE INDEX IF NOT EXISTS sessions_browser_idx ON sessions(browser);
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions(created_at);

-- Stored events (logged via PrismClient.logEvent / logCustomEvent)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS events_project_id_idx ON events(project_id);
CREATE INDEX IF NOT EXISTS events_session_id_idx ON events(session_id);
CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at);

-- v2 event model (task-9 §9 interim; the storage slice replaces schema.sql
-- with ordered migrations). Idempotency: the (project_id, id) primary key
-- plus conflict-safe inserts make transport retries safe. Raw IP is never
-- stored; client-provided ownership fields are ignored by the controller.
CREATE TABLE IF NOT EXISTS events_v2 (
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
  PRIMARY KEY (project_id, id)
);

CREATE INDEX IF NOT EXISTS events_v2_project_occurred_idx
  ON events_v2(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_v2_name_time_idx
  ON events_v2(project_id, name, occurred_at);
CREATE INDEX IF NOT EXISTS events_v2_session_idx ON events_v2(session_id);
CREATE INDEX IF NOT EXISTS events_v2_anonymous_idx ON events_v2(anonymous_id);
