-- Task 13: trusted source context on accepted telemetry.
-- source_id + platform are derived SERVER-SIDE from the ingestion key's
-- source (key -> project_sources), never from client payload fields —
-- a client cannot override its source or platform identity.
-- Added as nullable columns: pre-existing rows (pre-launch, fixture-only)
-- carry no source; the project's sources page surfaces connection state
-- only for events that do.
ALTER TABLE events ADD COLUMN source_id TEXT;
ALTER TABLE events ADD COLUMN platform TEXT;
--> statement-breakpoint
ALTER TABLE sessions_v2 ADD COLUMN source_id TEXT;
ALTER TABLE sessions_v2 ADD COLUMN platform TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_project_source_idx
  ON events(project_id, source_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sessions_v2_project_source_idx
  ON sessions_v2(project_id, source_id);
