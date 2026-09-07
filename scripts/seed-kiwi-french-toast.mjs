#!/usr/bin/env node
/**
 * Seed web analytics + product events for kiwi-french-toast-397050807
 * so the dashboard is not empty during UI work.
 *
 * Rides the REAL ingest lane (POST /api/v2/ingest) with the project's
 * publishable Web source key — same validation + enrichment as SDK traffic.
 *
 * Usage:
 *   # auto-resolve source key via DATABASE_URL (local or Neon):
 *   DATABASE_URL=postgres://... node scripts/seed-kiwi-french-toast.mjs
 *
 *   # or pass the key explicitly (from Sources → Setup):
 *   PRISM_SOURCE_KEY=psk_... node scripts/seed-kiwi-french-toast.mjs
 *
 *   # custom endpoint (defaults to http://localhost:8080, or PUBLIC_URL via nginx):
 *   PRISM_ANALYTICS_URL=http://localhost:8080 node scripts/seed-kiwi-french-toast.mjs
 *   PRISM_ANALYTICS_URL=https://prism-analytics-api-gsmo.onrender.com node scripts/seed-kiwi-french-toast.mjs
 */

import postgres from "postgres";

const PROJECT_SLUG = "kiwi-french-toast-397050807";
const ENDPOINT = (process.env.PRISM_ANALYTICS_URL || "http://localhost:8080").replace(/\/$/, "");
const INGEST_URL = `${ENDPOINT}/api/v2/ingest`;
let SOURCE_KEY = process.env.PRISM_SOURCE_KEY || null;

// ---------------------------------------------------------------------------
// resolve source key from DB if not provided
// ---------------------------------------------------------------------------
if (!SOURCE_KEY) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "PRISM_SOURCE_KEY is required (or set DATABASE_URL to auto-resolve it).\n" +
        "  PRISM_SOURCE_KEY=psk_... node scripts/seed-kiwi-french-toast.mjs\n" +
        "  DATABASE_URL=postgres://... node scripts/seed-kiwi-french-toast.mjs\n" +
        "Find the key in the dashboard: Sources → Web → Setup (publishable key).\n",
    );
    process.exit(1);
  }
  const ssl = databaseUrl.includes("neon.tech") ? { ssl: "require" } : undefined;
  const sql = postgres(databaseUrl, { max: 1, ...(ssl ? { ssl } : {}) });
  try {
    const projects = await sql`SELECT id, slug, name FROM projects WHERE slug = ${PROJECT_SLUG} LIMIT 1`;
    if (projects.length === 0) {
      console.error(`Project slug "${PROJECT_SLUG}" not found in product DB.`);
      process.exit(1);
    }
    const project = projects[0];
    console.log(`Found project: ${project.name} (${project.slug}) — ${project.id}`);

    const sources = await sql`
      SELECT id, name, platform FROM project_sources
      WHERE project_id = ${project.id} AND platform = 'web'
      LIMIT 5
    `;
    if (sources.length === 0) {
      console.error(`No Web sources found for project ${PROJECT_SLUG}. Create a Web source first.`);
      process.exit(1);
    }
    const source = sources[0];
    console.log(`Using Web source: ${source.name} (${source.id})`);

    // project_api_keys stores the hash, not the raw key. The raw psk_ is only
    // shown once at creation, so we cannot recover it from the DB.
    // Check if the DB has a column with the raw prefix for lookup, otherwise
    // we must ask the user to provide it.
    const keys = await sql`
      SELECT id, name, prefix, status FROM project_api_keys
      WHERE source_id = ${source.id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 3
    `;
    console.log(`\nFound ${keys.length} active key(s) for this source:`);
    for (const k of keys) console.log(`  - ${k.prefix}... (${k.name}) status=${k.status}`);

    console.error(
      `\nThe raw publishable key (psk_...) is not stored in the DB for security — it is only shown once at creation.\n` +
        `Copy it from the dashboard: Sources → ${source.name} → Setup, then re-run:\n` +
        `  PRISM_SOURCE_KEY=psk_... node scripts/seed-kiwi-french-toast.mjs\n`,
    );
    process.exit(1);
  } finally {
    await sql.end();
  }
}

console.log(`\nSeeding ${PROJECT_SLUG} via ${INGEST_URL}`);
console.log(`  sourceKey: ${SOURCE_KEY.slice(0, 12)}...`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(0x6b697769); // deterministic seed

function makeTrackEvent(name, properties, sessionId, anonId, occurredAt) {
  return {
    schemaVersion: 3,
    eventId: uuid(),
    type: "track",
    occurredAt,
    sessionId,
    anonymousId: anonId,
    name,
    properties,
  };
}
function makePageView(path, title, sessionId, anonId, occurredAt, sequence, ref) {
  const props = {
    $page: {
      host: "localhost",
      path,
      navigation: sequence === 1 ? "initial" : "push",
      sequence,
      title,
    },
    ...(sequence === 1 && ref
      ? { $referrer: { host: ref[0] }, ...(ref[1] ? { $campaign: ref[1] } : {}) }
      : {}),
  };
  return {
    schemaVersion: 3,
    eventId: uuid(),
    type: "track",
    occurredAt,
    sessionId,
    anonymousId: anonId,
    name: "$prism_page_view",
    properties: props,
  };
}

// ---------------------------------------------------------------------------
// 1) web page views — drives Web analytics (Pages / Acquisition / Locations / Tech)
// ---------------------------------------------------------------------------
const PAGES = [
  ["/", "Home", 24],
  ["/menu", "Menu", 16],
  ["/locations", "Locations", 10],
  ["/about", "About", 8],
  ["/order", "Order", 14],
  ["/blog/kiwi-toast-story", "Kiwi story", 6],
  ["/careers", "Careers", 4],
];
const REFS = [
  null, null, null,
  ["google.com", { source: "google", medium: "organic" }],
  ["google.com", { source: "google", medium: "organic" }],
  ["bing.com", { source: "bing", medium: "organic" }],
  ["instagram.com", { source: "instagram", medium: "social" }],
  ["x.com", { source: "x", medium: "social" }],
  ["news.ycombinator.com", { source: "hackernews", medium: "referral" }],
  ["google.com", { source: "google", medium: "cpc", name: "kiwi-spring" }],
];
const TOTAL_WEIGHT = PAGES.reduce((a, p) => a + p[2], 0);
function pickPage(r) {
  let acc = 0;
  for (const [path, title, w] of PAGES) {
    acc += w;
    if (r <= acc / TOTAL_WEIGHT) return [path, title];
  }
  return PAGES[0].slice(0, 2);
}

const DAY = 86_400_000;
const now = Date.now();
const pageViewEvents = [];
for (let s = 0; s < 38; s++) {
  const sessionStart = now - Math.floor(rand() * 30 * DAY) + Math.floor(rand() * DAY);
  const views = 1 + Math.floor(rand() * 4);
  const ref = REFS[Math.floor(rand() * REFS.length)];
  const anon = `anon-kiwi-${s}-${Math.random().toString(36).slice(2, 6)}`;
  const sess = `sess-kiwi-${s}-${Date.now().toString(36)}`;
  for (let v = 0; v < views; v++) {
    const [path, title] = pickPage(rand());
    const occurredAt = sessionStart + v * Math.floor(30_000 + rand() * 180_000);
    if (occurredAt > now) continue;
    pageViewEvents.push(makePageView(path, title, sess, anon, occurredAt, v + 1, ref));
  }
}

// ---------------------------------------------------------------------------
// 2) product events — drives Events / People
// ---------------------------------------------------------------------------
const productEvents = [];
const flavors = ["kiwi", "french-toast", "matcha", "classic", "vegan"];
const toppings = ["kiwi-slices", "maple", "berries", "cream", "honey"];
for (let i = 0; i < 48; i++) {
  const anon = `anon-prod-${Math.floor(i / 3)}`;
  const sess = `sess-prod-${Math.floor(i / 3)}`;
  const occurredAt = now - Math.floor(rand() * 14 * DAY);
  const n = ["kiwi_ordered", "topping_added", "checkout_completed"][i % 3];
  const props =
    n === "kiwi_ordered"
      ? { flavor: flavors[i % flavors.length], quantity: 1 + (i % 3), price_cents: 799 + (i % 4) * 100, currency: "USD", source: "seed-kiwi" }
      : n === "topping_added"
        ? { topping: toppings[i % toppings.length], extra_cents: 99, source: "seed-kiwi" }
        : { order_id: `ord-kiwi-${i}`, total_cents: 1599 + i * 120, payment: ["card", "apple_pay"][i % 2], source: "seed-kiwi" };
  productEvents.push(makeTrackEvent(n, props, sess, anon, occurredAt));
}

const allEvents = [...pageViewEvents, ...productEvents];
console.log(`Generated ${pageViewEvents.length} page views + ${productEvents.length} product events = ${allEvents.length} total`);
console.log(`  pages: ${PAGES.map(([p,w])=>p).join(", ")}`);
console.log(`  window: last 30 days (scattered), now=${new Date(now).toISOString()}`);

// ---------------------------------------------------------------------------
// ingest in batches of 20
// ---------------------------------------------------------------------------
async function postBatch(batch) {
  const body = JSON.stringify({ schemaVersion: 3, sentAt: Date.now(), sdk: { name: "seed-kiwi", version: "1.0.0" }, events: batch });
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173", authorization: `Bearer ${SOURCE_KEY}` },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { res, json };
}

let ok = 0, failed = 0, duplicate = 0;
for (let i = 0; i < allEvents.length; i += 20) {
  const batch = allEvents.slice(i, i + 20);
  let res, json;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ({ res, json } = await postBatch(batch));
      break;
    } catch (err) {
      if (attempt === 2) { console.log(`batch ${i / 20} gave up:`, String(err).slice(0, 120)); failed += batch.length; }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (!res) continue;
  if (res.ok) {
    const results = json.results ?? [];
    // server returns results per event; count accepted/duplicate
    for (const r of results) {
      if (r.status === "accepted") ok++;
      else if (r.status === "duplicate") duplicate++;
      else failed++;
    }
    // fallback if no results array (older contract)
    if (results.length === 0 && json.ok) ok += batch.length;
    if (json.results?.some(r => r.status === "rejected")) {
      console.log("rejected:", JSON.stringify(json.results.filter(r => r.status === "rejected")).slice(0, 600));
    }
  } else {
    console.log(`HTTP ${res.status} batch ${i / 20}:`, JSON.stringify(json).slice(0, 500));
    failed += batch.length;
  }
  // small pacing to avoid rate limiter (120 req/min)
  await new Promise(r => setTimeout(r, 120));
}

console.log(`\nDone: accepted=${ok} duplicate=${duplicate} failed=${failed} total=${allEvents.length}`);
if (ok > 0) {
  console.log(`\nVerify in dashboard:`);
  console.log(`  Web analytics:  http://localhost:5173/workspace/*/projects/${PROJECT_SLUG}/web-analytics`);
  console.log(`  Events:         http://localhost:5173/workspace/*/projects/${PROJECT_SLUG}/events`);
  console.log(`  (or hosted:     https://prism-analytics.vercel.app/workspace/*/projects/${PROJECT_SLUG}/web-analytics)`);
  console.log(`\nIf self-hosted via nginx, also try:`);
  console.log(`  ${ENDPOINT.replace(/:8080$/, ":3000")}/workspace/*/projects/${PROJECT_SLUG}/web-analytics`);
} else {
  console.error(`\nNo events accepted — check:`);
  console.error(`  1. analytics-api running at ${ENDPOINT} (or set PRISM_ANALYTICS_URL)`);
  console.error(`  2. sourceKey belongs to project ${PROJECT_SLUG} and is a Web publishable key (psk_...)`);
  console.error(`  3. origin http://localhost:5173 is allowed for that Web source (Sources → Setup)`);
}
