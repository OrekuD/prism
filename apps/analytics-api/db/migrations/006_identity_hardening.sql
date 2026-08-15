-- Identity hardening (task-10 review F5/F8):
-- deleted_people tombstones a deleted person so a later identify with the
-- same external user ID creates a FRESH person id — late events from a
-- deleted identity can never attach to the new person.
CREATE TABLE IF NOT EXISTS deleted_people (
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

-- identity_ops carries the canonical payload hash so a replayed op with a
-- DIFFERENT payload cannot mutate state (review F8).
ALTER TABLE identity_ops ADD COLUMN payload_hash TEXT;
