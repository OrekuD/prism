-- Superseded interim table: slice 4 created events_v2 through the
-- schema.sql setup script while the ingestion endpoint landed. The final
-- v2 model is the `events` table (migration 001). There are no production
-- users and no analytics data that must be preserved (task-9 review
-- policy), so the interim table is dropped.
DROP TABLE IF EXISTS events_v2;
