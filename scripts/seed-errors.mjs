#!/usr/bin/env node
import { createClient } from "@libsql/client";
import { randomUUID, createHash } from "node:crypto";

const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

const TITLES = [
  ["TypeError: Cannot read properties of null (reading 'user')", "app/routes/profile.tsx:42", "web", "error"],
  ["ReferenceError: document is not defined", "lib/ssr.ts:18", "server", "error"],
  ["Error: Network request failed: fetch checkout", "services/api.ts:88", "web", "error"],
  ["TypeError: Cannot read properties of undefined (reading 'map')", "components/EventList.tsx:74", "web", "error"],
  ["Unhandled Promise Rejection: Auth token expired", "managers/WebSocketManager.tsx:62", "web", "warning"],
  ["RangeError: Maximum call stack size exceeded", "utils/analyticsStore.ts:112", "server", "error"],
  ["Error: Failed to load Mapbox", "routes/realtime.tsx:118", "web", "warning"],
  ["TypeError: Cannot read properties of null (reading 'id')", "store/activeSessionsStore.ts:21", "web", "error"],
  ["Error: Rate limited", "controllers/IngestController.ts:452", "server", "error"],
  ["Warning: Deprecated prism.track usage", "lib/events.ts:42", "web", "warning"],
  ["Error: ChunkLoadError: Loading chunk 42 failed", "web/main.js:1242", "web", "error"],
  ["TypeError: undefined is not an object (evaluating 'session.personId')", "App.tsx:182", "ios", "error"],
];

function fingerprintFor(title, platform) {
  return createHash("sha256").update(`${platform}:${title}`).digest("hex").slice(0, 32);
}

console.log(`Seeding errors for ${PROJECT_ID}...`);
await client.execute({ sql: "DELETE FROM error_occurrences WHERE project_id = ?", args: [PROJECT_ID] });
await client.execute({ sql: "DELETE FROM error_issue_users WHERE issue_id IN (SELECT id FROM error_issues WHERE project_id = ?)", args: [PROJECT_ID] });
await client.execute({ sql: "DELETE FROM error_issues WHERE project_id = ?", args: [PROJECT_ID] });

const now = Date.now();
const SOURCES = [
  ["b2b9b407-95c3-4b28-b9d2-832341178176", "web"],
  ["c3c8b407-95c3-4b28-b9d2-832341178177", "web"],
];

let totalOccurrences = 0;
for (let i = 0; i < TITLES.length; i++) {
  const [title, location, platform, level] = TITLES[i];
  const id = randomUUID();
  const fingerprint = fingerprintFor(title, platform);
  const statusRoll = Math.random();
  const status = statusRoll < 0.7 ? "unresolved" : statusRoll < 0.85 ? "resolved" : "ignored";
  const count = 5 + Math.floor(Math.random() * 45);
  const users = 1 + Math.floor(Math.random() * Math.max(1, count / 2));
  const firstSeen = now - Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000);
  const lastSeen = now - Math.floor(Math.random() * 60 * 60 * 1000);
  const deltaRoll = Math.random();
  // delta is computed from window, not stored, but we set occurrence_count to drive it

  await client.execute({
    sql: `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, location, first_seen_at, last_seen_at, occurrence_count, users_affected)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [id, PROJECT_ID, platform, 1, fingerprint, level, status, title, location, firstSeen, lastSeen, count, users],
  });

  // Create occurrences for this issue
  const occCount = Math.min(count, 8 + Math.floor(Math.random() * 5));
  for (let o = 0; o < occCount; o++) {
    const occId = randomUUID();
    const clientEventId = `evt-err-${randomUUID().slice(0, 8)}`;
    const occurredAt = lastSeen - Math.floor(Math.random() * 3 * 24 * 60 * 60 * 1000);
    const receivedAt = occurredAt + Math.floor(Math.random() * 2000);
    const [sourceId, srcPlatform] = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    const anon = `anon-err-${randomUUID().slice(0, 8)}`;
    const payload = JSON.stringify({
      exception: {
        type: title.split(":")[0].trim(),
        message: title.split(":").slice(1).join(":").trim(),
        frames: [
          { file: location, line: Number(location.split(":").pop()) || 42, column: 12, inApp: true, function: "handleEvent" },
          { file: "node_modules/react-dom/index.js", line: 1234, column: 8, inApp: false },
        ],
        hasCause: false,
      },
      level,
      handled: Math.random() > 0.5,
    });

    await client.execute({
      sql: `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, anonymous_id, payload)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [occId, clientEventId, id, PROJECT_ID, sourceId, platform, level, Math.random() > 0.5 ? 1 : 0, occurredAt, receivedAt, anon, payload],
    });

    // Link anonymous user to issue for users_affected
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO error_issue_users (issue_id, anonymous_id) VALUES (?,?)`,
        args: [id, anon],
      });
    } catch {}
    totalOccurrences++;
  }

  if ((i + 1) % 4 === 0) process.stdout.write(`  seeded ${i + 1}/${TITLES.length} issues\r`);
}

console.log(`\nSeeded ${TITLES.length} issues, ${totalOccurrences} occurrences.`);

const cnt = await client.execute({ sql: "SELECT count(*) as c FROM error_issues WHERE project_id = ?", args: [PROJECT_ID] });
console.log(`Issues: ${cnt.rows[0].c}`);
const occ = await client.execute({ sql: "SELECT count(*) as c FROM error_occurrences WHERE project_id = ?", args: [PROJECT_ID] });
console.log(`Occurrences: ${occ.rows[0].c}`);

const sample = await client.execute({ sql: "SELECT title, platform, level, status, occurrence_count, users_affected FROM error_issues WHERE project_id = ? LIMIT 5", args: [PROJECT_ID] });
console.log("Sample:", sample.rows);
