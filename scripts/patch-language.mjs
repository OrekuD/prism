#!/usr/bin/env node
import { createClient } from "@libsql/client";
const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

const rows = await client.execute({
  sql: `SELECT id, platform, payload FROM error_occurrences WHERE project_id = ?`,
  args: [PROJECT_ID],
});
console.log(`Found ${rows.rows.length} occurrences`);
let patched = 0;
for (const row of rows.rows) {
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch {}
  if (payload.language) continue;
  // infer language from platform
  const platform = row.platform;
  let language = "javascript";
  if (platform === "ios") language = "swift";
  else if (platform === "android") language = "kotlin";
  else if (platform === "server" || platform === "web" || platform === "react-native") language = "javascript";
  // could be python/go in future
  payload.language = language;
  const newPayload = JSON.stringify(payload);
  await client.execute({
    sql: `UPDATE error_occurrences SET payload = ? WHERE id = ?`,
    args: [newPayload, row.id],
  });
  patched++;
}
console.log(`Patched ${patched} occurrences with language`);
