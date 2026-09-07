#!/usr/bin/env node
import { createClient } from "@libsql/client";
import { randomUUID, createHash } from "node:crypto";

const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

function fingerprintFor(title, platform) {
  return createHash("sha256").update(`${platform}:${title}`).digest("hex").slice(0, 32);
}

const now = Date.now();
const SOURCES = [
  ["b2b9b407-95c3-4b28-b9d2-832341178176", "web"],
  ["c3c8b407-95c3-4b28-b9d2-832341178177", "web"],
];

const NEW_ISSUES = [
  {
    title: "TypeError: Cannot read properties of undefined (reading 'items') — checkout cart empty",
    location: "app/routes/checkout.tsx:88",
    platform: "web",
    level: "error",
    context: {
      tags: {
        feature: "checkout",
        "user.plan": "pro",
        browser: "chrome",
        viewport: "1280x720",
      },
      extras: {
        cart_total: 129.99,
        retry_count: 3,
        cart_items: 0,
        last_action: "apply_coupon",
      },
    },
    breadcrumbs: [
      { message: "user clicked checkout", timestamp: now - 90000 },
      { message: "coupon validation started", timestamp: now - 60000 },
    ],
    release: "1.4.2",
    environment: "production",
  },
  {
    title: "Error: Database timeout at checkout — query exceeded 400ms",
    location: "services/db.ts:142",
    platform: "server",
    level: "error",
    context: {
      tags: {
        route: "/api/checkout",
        region: "us-east-1",
        "http.method": "POST",
        "http.status_code": "504",
      },
      extras: {
        db_query: "SELECT * FROM orders WHERE user_id = ?",
        latency_ms: 452,
        pool_wait_ms: 120,
        trace_id: "req_abc123xyz",
      },
    },
    breadcrumbs: [
      { message: "db pool acquired", timestamp: now - 120000 },
      { message: "query started", timestamp: now - 100000 },
    ],
    release: "1.4.2",
    environment: "production",
  },
];

console.log("Seeding 2 tagged errors...");

for (const def of NEW_ISSUES) {
  const { title, location, platform, level, context, breadcrumbs, release, environment } = def;
  const id = randomUUID();
  const fingerprint = fingerprintFor(title, platform);
  const status = "unresolved";
  const count = 12 + Math.floor(Math.random() * 10);
  const users = 4 + Math.floor(Math.random() * 4);
  const firstSeen = now - 2 * 24 * 60 * 60 * 1000;
  const lastSeen = now - 30 * 60 * 1000;

  await client.execute({
    sql: `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, location, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [id, PROJECT_ID, platform, 1, fingerprint, level, status, title, location, firstSeen, lastSeen, count, users, release, release],
  });

  // create 3 occurrences for this issue with varying context
  for (let o = 0; o < 3; o++) {
    const occId = randomUUID();
    const clientEventId = `evt-err-${randomUUID().slice(0, 8)}`;
    const occurredAt = lastSeen - Math.floor(Math.random() * 60 * 60 * 1000);
    const receivedAt = occurredAt + Math.floor(Math.random() * 500);
    const [sourceId] = SOURCES[o % SOURCES.length];
    const anon = `anon-err-${randomUUID().slice(0, 8)}`;

    const payloadObj = {
      exception: {
        type: title.split(":")[0].trim(),
        message: title.split(":").slice(1).join(":").trim(),
        frames: [
          { file: location, line: Number(location.split(":").pop()) || 42, column: 12, inApp: true, function: "handleCheckout" },
          { file: "node_modules/react-dom/index.js", line: 1234, column: 8, inApp: false },
        ],
        hasCause: false,
      },
      level,
      handled: true,
      release,
      environment,
      context,
      breadcrumbs,
    };

    const payload = JSON.stringify(payloadObj);

    await client.execute({
      sql: `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, anonymous_id, payload)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [occId, clientEventId, id, PROJECT_ID, sourceId, platform, level, 1, occurredAt, receivedAt, anon, payload],
    });

    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO error_issue_users (issue_id, anonymous_id) VALUES (?,?)`,
        args: [id, anon],
      });
    } catch {}
  }

  console.log(`  seeded ${platform} — ${title.slice(0, 60)}… id=${id.slice(0, 8)} fp=${fingerprint.slice(0, 8)} tags=${Object.keys(context.tags).length} extras=${Object.keys(context.extras).length}`);
}

const cnt = await client.execute({ sql: "SELECT count(*) as c FROM error_issues WHERE project_id = ?", args: [PROJECT_ID] });
console.log(`Total issues now: ${cnt.rows[0].c}`);
