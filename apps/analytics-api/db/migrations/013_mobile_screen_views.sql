-- Task 18 slice 6: mobile screen views, app lifecycle, installations
CREATE TABLE IF NOT EXISTS mobile_screen_views (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  screen_name TEXT NOT NULL,
  route_pattern TEXT,
  navigation TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  previous_screen TEXT,
  app_version TEXT,
  app_build TEXT,
  os TEXT,
  os_version TEXT,
  installation_digest TEXT,
  country_code TEXT,
  region TEXT,
  city TEXT,
  PRIMARY KEY (project_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_views_project_session ON mobile_screen_views(project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_mobile_screen_views_project_occurred ON mobile_screen_views(project_id, occurred_at);
