#!/usr/bin/env node
import { createClient } from "@libsql/client";
const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

// Find the 2 tagged issues we just seeded (by fingerprint)
const issues = await client.execute({
  sql: `SELECT id, title, fingerprint FROM error_issues WHERE project_id = ? ORDER BY last_seen_at DESC LIMIT 2`,
  args: [PROJECT_ID],
});
console.log("Top 2 issues:", issues.rows);

for (const row of issues.rows) {
  const occ = await client.execute({
    sql: `SELECT id, payload FROM error_occurrences WHERE issue_id = ? LIMIT 3`,
    args: [row.id],
  });
  for (const o of occ.rows) {
    let payload = {};
    try { payload = JSON.parse(o.payload); } catch {}
    const tags = payload.context?.tags ?? {};
    // Add browser/os where missing — web gets browser+os, server gets os
    if (!tags.browser) {
      tags.browser = row.title.includes("Database") ? undefined : "chrome";
      if (tags.browser) {
        tags["browser.version"] = "131.0.0";
      }
    }
    if (!tags.os) {
      // web: macOS, server: linux
      tags.os = row.title.includes("Database") ? "linux" : "macOS";
      tags["os.version"] = row.title.includes("Database") ? "6.5" : "14.5";
    }
    if (!tags.viewport && !row.title.includes("Database")) {
      tags.viewport = "1280x720";
    }
    if (!tags["user.plan"] && !row.title.includes("Database")) {
      tags["user.plan"] = "pro";
    }
    payload.context = payload.context ?? {};
    payload.context.tags = Object.fromEntries(Object.entries(tags).filter(([_,v])=> v !== undefined));
    // ensure extras stays
    const newPayload = JSON.stringify(payload);
    await client.execute({
      sql: `UPDATE error_occurrences SET payload = ? WHERE id = ?`,
      args: [newPayload, o.id],
    });
    console.log(`  patched ${o.id.slice(0,8)} tags=${JSON.stringify(tags)}`);
  }
}
console.log("done");
