-- R7-F1: deletion generation tombstones for EVERY credential (external AND
-- anonymous) of a deleted person. A stale post-deletion event carrying an
-- old anonymous ID resolves to a fresh anonymous person, and a later
-- re-identification with that ID can never reassign the deleted
-- generation's events into the new person.
CREATE TABLE IF NOT EXISTS deleted_identities (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'external' | 'anonymous'
  credential TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind, credential)
);
