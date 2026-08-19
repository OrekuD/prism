-- Task 15 slice 1: error tracking — grouped issues + sanitized occurrences.
--
-- An issue is a durable (project_id, platform, fingerprint_version,
-- fingerprint) group with a workflow lifecycle (unresolved/resolved/
-- ignored). The server computes the versioned fingerprint from the
-- normalized exception; a new occurrence after resolution reopens the
-- issue. Occurrence identity is (project_id, source_id, client_event_id)
-- so a retried batch never double-counts.
--
-- Retention is a separate, documented pass (ERROR_RETENTION_DAYS in
-- src/retention.ts): expired occurrences are pruned, then user links and
-- issues whose occurrences are all gone are removed with them so no
-- personally identifying orphan records or phantom counters remain.

CREATE TABLE IF NOT EXISTS error_issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  fingerprint_version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning')),
  status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (status IN ('unresolved', 'resolved', 'ignored')),
  title TEXT NOT NULL,
  location TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  users_affected INTEGER NOT NULL DEFAULT 0,
  first_release TEXT,
  last_release TEXT,
  resolved_by TEXT,
  resolved_at INTEGER,
  ignored_by TEXT,
  ignored_at INTEGER,
  UNIQUE (project_id, platform, fingerprint_version, fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS error_occurrences (
  id TEXT PRIMARY KEY,
  client_event_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning')),
  handled INTEGER NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  release TEXT,
  environment TEXT,
  anonymous_id TEXT,
  payload TEXT NOT NULL,
  UNIQUE (project_id, source_id, client_event_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS error_issue_users (
  issue_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  PRIMARY KEY (issue_id, anonymous_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_issues_project_status_last_seen_idx
  ON error_issues (project_id, status, last_seen_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_occurrences_project_time_idx
  ON error_occurrences (project_id, received_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_occurrences_issue_time_idx
  ON error_occurrences (issue_id, received_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_issue_users_anonymous_idx
  ON error_issue_users (anonymous_id);
