#!/usr/bin/env node
// Seed 3 events x 5-10 each for amber-waffles-892934032
// Uses direct ingest API (POST /api/v2/ingest) with the Web source key.
// Run: node scripts/seed-amber-waffles.mjs
// Verify: curl http://localhost:8080/health && open https://prism.localhost/projects/amber-waffles-892934032

const ENDPOINT = process.env.PRISM_ANALYTICS_URL || "http://localhost:8080";
const SOURCE_KEY = process.env.PRISM_SOURCE_KEY;

if (!SOURCE_KEY) {
  console.error(
    "PRISM_SOURCE_KEY is required. Pass a disposable source key through the environment.",
  );
  process.exit(1);
}
const PROJECT_SLUG = "amber-waffles-892934032";

const INGEST_URL = `${ENDPOINT.replace(/\/$/, "")}/api/v2/ingest`;

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
}

function makeEvent(name, properties) {
  return {
    schemaVersion: 2,
    eventId: uuid(),
    type: "track",
    occurredAt: Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 2), // last 2 days
    sessionId: `sess-${Math.random().toString(36).slice(2,9)}`,
    anonymousId: `anon-${Math.random().toString(36).slice(2,9)}`,
    name,
    properties,
  };
}

const events = [];

// 3 distinct events: waffle_ordered (8), topping_added (7), checkout_completed (6) — all 5-10 range
const waffleTypes = ["classic", "belgian", "liege", "vegan", "gluten-free"];
const toppings = ["maple", "berries", "nutella", "whipped-cream", "bacon", "chocolate"];
const checkoutMethods = ["card", "apple_pay", "google_pay"];

for (let i = 0; i < 8; i++) {
  events.push(makeEvent("waffle_ordered", {
    waffle_type: waffleTypes[i % waffleTypes.length],
    quantity: 1 + (i % 3),
    price_cents: 599 + (i % 5) * 100,
    currency: "USD",
    source: "seed-script",
    store: "amber-waffles-downtown",
  }));
}
for (let i = 0; i < 7; i++) {
  events.push(makeEvent("topping_added", {
    topping: toppings[i % toppings.length],
    waffle_type: waffleTypes[i % waffleTypes.length],
    extra_price_cents: 99 + (i % 3) * 50,
    source: "seed-script",
  }));
}
for (let i = 0; i < 6; i++) {
  events.push(makeEvent("checkout_completed", {
    order_id: `ord-${Date.now()}-${i}`,
    total_cents: 1299 + i * 200,
    payment_method: checkoutMethods[i % checkoutMethods.length],
    waffle_count: 2 + (i % 3),
    currency: "USD",
    source: "seed-script",
  }));
}

const body = JSON.stringify({
  schemaVersion: 2,
  sentAt: Date.now(),
  sdk: { name: "@prism-analytics/core", version: "0.0.1" },
  events,
});

console.log(`Seeding ${events.length} events to ${INGEST_URL}`);
console.log(`  project: ${PROJECT_SLUG}`);
console.log(`  sourceKey: ${SOURCE_KEY.slice(0, 12)}...`);
console.log(`  events: waffle_ordered x8, topping_added x7, checkout_completed x6`);

const res = await fetch(INGEST_URL, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${SOURCE_KEY}`,
    "origin": "http://localhost:5173",
  },
  body,
});

const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { json = text; }

console.log(`\nResponse: ${res.status} ${res.statusText}`);
console.log(JSON.stringify(json, null, 2));

if (!res.ok) {
  console.error("\nIngest failed — check:");
  console.error("  1. analytics-api running on", ENDPOINT, "(yarn dev → prism-analytics-api:dev)");
  console.error("  2. sourceKey matches project", PROJECT_SLUG);
  process.exit(1);
}

const accepted = json?.results?.filter(r => r.status === "accepted").length ?? events.length;
const rejected = json?.results?.filter(r => r.status === "rejected").length ?? 0;
console.log(`\n✓ Accepted: ${accepted}, Rejected: ${rejected}`);
if (rejected) console.log("  Rejected details:", json.results.filter(r => r.status !== "accepted"));

console.log(`\nVerify in dashboard:`);
console.log(`  https://prism.localhost/projects/${PROJECT_SLUG}`);
console.log(`  https://prism.localhost/projects/${PROJECT_SLUG}/events`);
console.log(`\nOr via API (needs session cookie):`);
console.log(`  curl -H \"Authorization: Bearer <session>\" http://localhost:8787/api/v1/projects/${PROJECT_SLUG}/events`);
console.log(`\nOr via analytics Turso (check events table):`);
console.log(`  SELECT name, count(*) FROM events WHERE project_id='f350aeda-eab0-4d02-a9d1-b73c670ad4de' GROUP BY name;`);
