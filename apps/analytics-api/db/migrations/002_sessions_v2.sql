-- v2 sessions model (task-9 §9): client-generated session IDs with
-- start/end/last-seen timestamps and normalized context. The v2 SDK owns
-- the session lifecycle client-side (session_started / session_ended
-- events); this table is the aggregated session state the read/realtime
-- slice (6) writes and serves. Approximate geo arrives via normalized
-- context, never raw IP.
CREATE TABLE IF NOT EXISTS sessions_v2 (
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  anonymous_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_seen_at INTEGER NOT NULL,
  context TEXT,
  is_online INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, session_id)
);

CREATE INDEX IF NOT EXISTS sessions_v2_last_seen_idx
  ON sessions_v2(project_id, last_seen_at);
CREATE INDEX IF NOT EXISTS sessions_v2_anonymous_idx
  ON sessions_v2(anonymous_id);

-- LEGACY COMPATIBILITY (removed with the v1 routes in the read-path
-- slice): the product API's read paths (dashboard summaries, project
-- pages, WebSocket resources) still query a `sessions` table. Created
-- WITHOUT raw IP columns — the v1 ingestion controller no longer writes
-- ip/lat/long, and the raw-IP removal item completes when the v1 routes
-- and this table are dropped together.
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
  is_online INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_session_id_idx ON sessions(session_id);
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions(created_at);
