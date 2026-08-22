-- Task 17 slice 4: the atomic page-view projection (task §6).
--
-- The accepted event in `events` remains the source of truth; this table
-- exists so bounded Web-analytics queries never re-group arbitrary JSON.
-- (project_id, event_id) mirrors the event identity — a duplicate delivery
-- can never create a second projection row or advance page metrics.
--
-- Trusted attribution lives ONLY on the linked event: source_id,
-- session_id, person_id, platform, and SDK identity are joined at read
-- time, so identify()/deletion reconciliation automatically follows.
-- Technology/location are server-derived at ingestion (never client
-- payload); raw user agents and raw IPs are discarded before persistence.

CREATE TABLE IF NOT EXISTS web_page_views (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  navigation_type TEXT NOT NULL,
  page_sequence INTEGER NOT NULL,
  previous_path TEXT,
  referrer_host TEXT,
  campaign_source TEXT,
  campaign_medium TEXT,
  campaign_name TEXT,
  browser_family TEXT,
  browser_major INTEGER,
  os_family TEXT,
  os_major INTEGER,
  device_type TEXT NOT NULL DEFAULT 'unknown',
  is_bot INTEGER NOT NULL DEFAULT 0,
  ua_parser_version TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  primary_language TEXT,
  country_code TEXT,
  region TEXT,
  city TEXT,
  geo_provider TEXT,
  PRIMARY KEY (project_id, event_id)
);

--> statement-breakpoint

-- Dashboard queries always bound time per project first.
CREATE INDEX IF NOT EXISTS wpv_project_time_idx
  ON web_page_views(project_id, occurred_at);

--> statement-breakpoint

-- Top-pages ranking + exact-path filter.
CREATE INDEX IF NOT EXISTS wpv_project_path_time_idx
  ON web_page_views(project_id, path, occurred_at);

--> statement-breakpoint

-- Referrer ranking (external acquisition).
CREATE INDEX IF NOT EXISTS wpv_project_referrer_idx
  ON web_page_views(project_id, referrer_host);

--> statement-breakpoint

-- Location rankings.
CREATE INDEX IF NOT EXISTS wpv_project_country_idx
  ON web_page_views(project_id, country_code);
