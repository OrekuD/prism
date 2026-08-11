#!/usr/bin/env node
/**
 * Backup/restore drill (task-6 section 8) — PREPARED, not executed.
 *
 * Per review: execution happens ONLY against isolated disposable volumes
 * after explicit approval. This script encodes the drill and guards
 * against ever touching real infrastructure:
 *
 *   - Rejects every DATABASE_URL that is not loopback (127.0.0.1 /
 *     localhost / ::1) — Neon and any remote host are refused.
 *   - Refuses to run when TURSO_DATABASE_URL / NEONDB_* / TURSO_AUTH_TOKEN
 *     are present in the environment.
 *   - Operates only on a compose project named `prism-restore-drill` and
 *     its own named volumes (created fresh by the drill).
 *
 * Drill (once approved):
 *   1. Boot a disposable stack (like scripts/certify-restart.mjs).
 *   2. Seed owner + project + session + event markers.
 *   3. `scripts/backup.sh` -> dump to the host's disposable dir.
 *   4. `docker compose down -v` (destroy the volumes).
 *   5. Boot the stack again (fresh volumes) and stop `api` + `analytics`.
 *   6. `scripts/restore.sh` the dump into the fresh product database.
 *   7. Start `api` + `analytics`; run the same verification as
 *      certify-restart (config, sign-in, project, events) and assert the
 *      markers survived the destroy/restore cycle.
 *   8. Tear down with `down -v` and delete the backup dir.
 *
 * Run: node scripts/drill-backup-restore.mjs
 */
import { readFileSync } from "node:fs";

const guardFailures = [];

function guard(ok, message) {
  if (!ok) guardFailures.push(message);
}

const env = process.env;

guard(
  !env.DATABASE_URL || /(^|@)(127\.0\.0\.1|localhost|\[::1\])/.test(env.DATABASE_URL),
  "DATABASE_URL must be loopback-only for the drill (never Neon/remote).",
);
guard(
  !env.NEONDB_HOST && !env.NEONDB_DATABASE && !env.NEONDB_USER && !env.NEONDB_PASSWORD,
  "NEONDB_* must be absent — the drill never targets Neon.",
);
guard(
  !env.TURSO_DATABASE_URL && !env.TURSO_AUTH_TOKEN,
  "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must be absent — the drill never targets Turso.",
);

if (guardFailures.length > 0) {
  console.error("Backup/restore drill REFUSED — guards:");
  for (const failure of guardFailures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\nThe drill is prepared but not executed. Run it only against a",
    "disposable Compose project (own volumes) after explicit approval.",
  );
  process.exit(2);
}

console.error(
  "Backup/restore drill: guards passed. Execution still requires explicit",
  "approval per the task-6 closure policy — exiting without touching",
  "anything. (See the drill steps at the top of this file.)",
);
process.exit(0);
