-- LEGACY D1 schema — do not use for new setups.
--
-- The canonical analytics store is Turso/libSQL, set up with:
--   yarn workspace prism-analytics-api db:setup
-- The D1 database was the original analytics store and is kept only for
-- migration/history. These scripts never drop tables.
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, session_id TEXT, project_id TEXT, referrer TEXT, country_code TEXT, os TEXT, browser TEXT, location TEXT, is_mobile INTEGER, ip TEXT, long TEXT, lat TEXT, is_online INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS country_code_idx ON sessions(country_code);
CREATE INDEX IF NOT EXISTS os_idx ON sessions(os);
CREATE INDEX IF NOT EXISTS browser_idx ON sessions(browser);
