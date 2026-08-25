-- Task 18 slice 6: mobile telemetry projections (R2-F5)
-- Same-store FKs only: screen projections cascade with their source event.
-- App-session/installation aggregates have NO event FK (they outlive single
-- events); they are swept explicitly by retention.ts and project/source
-- deletion cleanup.

CREATE TABLE IF NOT EXISTS mobile_screen_views (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  session_sequence INTEGER NOT NULL,
  screen_name TEXT NOT NULL,
  route_pattern TEXT,
  navigation TEXT NOT NULL,
  previous_screen TEXT,
  app_version TEXT,
  app_build TEXT,
  app_environment TEXT,
  os TEXT,
  os_version TEXT,
  installation_digest TEXT,
  source_id TEXT NOT NULL,
  country_code TEXT,
  region TEXT,
  city TEXT,
  geo_provider TEXT,
  PRIMARY KEY (project_id, event_id),
  -- Same-store composite FK: matches events PK (project_id, id).
  FOREIGN KEY (project_id, event_id) REFERENCES events(project_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_views_project_session ON mobile_screen_views(project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_views_project_occurred ON mobile_screen_views(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_views_source ON mobile_screen_views(project_id, source_id);

CREATE TABLE IF NOT EXISTS mobile_app_sessions (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  installation_digest TEXT,
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  foreground_active_ms INTEGER NOT NULL DEFAULT 0,
  screen_count INTEGER NOT NULL DEFAULT 0,
  app_version TEXT,
  os TEXT,
  PRIMARY KEY (project_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_app_sessions_project_started ON mobile_app_sessions(project_id, started_at);

CREATE TABLE IF NOT EXISTS mobile_installations (
  project_id TEXT NOT NULL,
  installation_digest TEXT NOT NULL,
  source_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_os TEXT,
  last_app_version TEXT,
  PRIMARY KEY (project_id, installation_digest)
);
CREATE INDEX IF NOT EXISTS idx_mobile_installations_project_source ON mobile_installations(project_id, source_id);

-- Generic event ordering sequence (nullable for back-compat; mobile
-- ingestion fills it per accepted reserved record).
ALTER TABLE events ADD COLUMN session_sequence INTEGER;
