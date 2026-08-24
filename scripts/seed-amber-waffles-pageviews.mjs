#!/usr/bin/env node
// Seed $prism_page_view reserved events for amber-waffles (Task 17 slice 6
// visual proof). Rides the REAL ingest lane: same endpoint, source key,
// wire schema — the server validates and projects them exactly like SDK
// traffic. Run: node scripts/seed-amber-waffles-pageviews.mjs

const ENDPOINT = process.env.PRISM_ANALYTICS_URL || "http://localhost:8080";
const SOURCE_KEY = process.env.PRISM_SOURCE_KEY;

if (!SOURCE_KEY) {
  console.error(
    "PRISM_SOURCE_KEY is required. Pass a disposable Web source key through the environment.",
  );
  process.exit(1);
}

const INGEST_URL = `${ENDPOINT.replace(/\/$/, "")}/api/v2/ingest`;

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random()}`;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(20260824);

// Deterministic-ish page mix over 30 days, ~40 sessions, 1-5 views each.
const PAGES = [
  ["/", "Home", 26],
  ["/menu", "Menu", 18],
  ["/locations", "Locations", 12],
  ["/about", "About us", 9],
  ["/order", "Order online", 14],
  ["/careers", "Careers", 5],
  ["/gift-cards", "Gift cards", 6],
  ["/blog/waffle-facts", "Waffle facts", 4],
];
const REFS = [
  null, null, null,
  ["google.com", { source: "google", medium: "organic" }],
  ["google.com", { source: "google", medium: "organic" }],
  ["bing.com", { source: "bing", medium: "organic" }],
  ["instagram.com", { source: "instagram", medium: "social" }],
  ["x.com", { source: "x", medium: "social" }],
  ["news.ycombinator.com", { source: "hackernews", medium: "referral" }],
  ["google.com", { source: "google", medium: "cpc", name: "waffles-spring" }],
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
const events = [];
for (let s = 0; s < 42; s++) {
  const sessionStart = now - Math.floor(rand() * 30 * DAY);
  const views = 1 + Math.floor(rand() * 5);
  const ref = REFS[Math.floor(rand() * REFS.length)];
  const anon = `anon-pv-${s}`;
  for (let v = 0; v < views; v++) {
    const [path, title] = pickPage(rand());
    const occurredAt = sessionStart + v * Math.floor(30_000 + rand() * 180_000);
    if (occurredAt > now) continue;
    const props = {
      $page: {
        host: "localhost",
        path,
        navigation: v === 0 ? "initial" : "push",
        sequence: v + 1,
        ...(v > 0 ? {} : {}),
        title,
      },
      ...(v === 0 && ref
        ? { $referrer: { host: ref[0] }, ...(ref[1] ? { $campaign: ref[1] } : {}) }
        : {}),
    };
    events.push({
      schemaVersion: 2,
      eventId: uuid(),
      type: "track",
      occurredAt,
      sessionId: `sess-pv-${s}`,
      anonymousId: anon,
      name: "$prism_page_view",
      properties: props,
    });
  }
}

async function main() {
  const batches = [];
  for (let i = 0; i < events.length; i += 20) batches.push(events.slice(i, i + 20));
  let ok = 0, failed = 0;
  async function postBatch(batch) {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173", authorization: `Bearer ${SOURCE_KEY}` },
      body: JSON.stringify({ schemaVersion: 2, sdk: { name: "seed-script", version: "1.0.0" }, events: batch }),
    });
    return { res, body: await res.json().catch(() => ({})) };
  }
  for (const batch of batches) {
    let res, body;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ({ res, body } = await postBatch(batch));
        break;
      } catch (err) {
        if (attempt === 2) { console.log("gave up on batch:", String(err).slice(0, 120)); failed += batch.length; }
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    if (!res) continue;
    if (res.ok) {
      ok += body.accepted ?? batch.length;
      failed += body.rejected?.length ?? 0;
      if (body.rejected?.length) console.log("rejected:", JSON.stringify(body.rejected).slice(0, 400));
    } else {
      console.log("HTTP", res.status, JSON.stringify(body).slice(0, 300));
      failed += batch.length;
    }
  }
  console.log(`seeded page views: accepted=${ok} rejected=${failed} (${events.length} total)`);
}
main();
