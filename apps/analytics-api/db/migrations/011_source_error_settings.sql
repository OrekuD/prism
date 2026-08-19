-- Per-source ERROR COLLECTION configuration (task-15 item: per-source error
-- collection configuration and status under Sources).
--
-- The SDK always requires EXPLICIT opt-in per source; this table records the
-- DASHBOARD intent for that source (the documented config the SDK snippet in
-- the Sources UI reflects) plus a live collection STATUS read from ingestion.
-- It is owned by the analytics store so the product API can read/write it
-- through the same Turso seam it uses for all error data. Ingestion never
-- reads these rows (the SDK enforces its own opt-in), so a misconfiguration
-- is never a privacy failure — it only ever changes what the setup UI shows.
CREATE TABLE IF NOT EXISTS source_error_settings (
  source_id TEXT PRIMARY KEY,
  -- "off" | "manual" | "all": manual = explicit captureException only;
  -- all = manual + global browser handlers (uncaughtException/onerror etc.).
  mode TEXT NOT NULL DEFAULT 'manual',
  -- Opt-in global error collection (browser onerror / unhandledrejection).
  capture_global_errors INTEGER NOT NULL DEFAULT 0,
  -- Breadcrumb collection on/off (never their contents; only counts surface).
  breadcrumbs_enabled INTEGER NOT NULL DEFAULT 0,
  -- Sampling rate applied CLIENT-side (0..100 integer percent; 100 = all).
  sampling_rate INTEGER NOT NULL DEFAULT 100,
  -- Stamped release metadata shown in the setup snippet + issue detail.
  release TEXT,
  updated_at INTEGER NOT NULL
);
