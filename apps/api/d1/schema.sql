DROP TABLE IF EXISTS sessions;
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, project_id TEXT, referrer TEXT, country_code TEXT, os TEXT, browser TEXT, location TEXT, is_mobile INTEGER, ip TEXT, long TEXT, lat TEXT, is_online INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS country_code_idx ON sessions(country_code);
CREATE INDEX IF NOT EXISTS os_idx ON sessions(os);
CREATE INDEX IF NOT EXISTS browser_idx ON sessions(browser);
