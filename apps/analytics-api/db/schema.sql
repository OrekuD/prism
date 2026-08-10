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
