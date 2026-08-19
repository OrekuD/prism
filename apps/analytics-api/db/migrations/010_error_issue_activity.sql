-- Task 15 slice 4: workflow activity — auditable issue state changes.
--
-- The product API writes one row per user-initiated transition
-- (resolved / ignored / reopened) with the actor, prior and new state, and
-- an optional bounded reason. Ingestion's reopen-on-new-occurrence updates
-- the issue row directly and is intentionally NOT duplicated into this log,
-- keeping it user-action-focused and bounded. A new occurrence after a user
-- reopen is not a user action.

CREATE TABLE IF NOT EXISTS error_issue_activity (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'member'
    CHECK (actor_type IN ('member', 'system')),
  action TEXT NOT NULL CHECK (action IN ('resolved', 'ignored', 'reopened')),
  prior_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  note TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_issue_activity_issue_time_idx
  ON error_issue_activity (issue_id, timestamp DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_issue_activity_project_time_idx
  ON error_issue_activity (project_id, timestamp);
