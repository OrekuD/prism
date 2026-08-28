#!/usr/bin/env node
/**
 * Add varied Locations + Technology to kiwi-french-toast web analytics.
 * Replaces the existing 100 rows with 300 enriched ones — more countries,
 * browsers, devices, languages — so the dashboard has real volume.
 *
 * Run after seed-kiwi-french-toast.mjs (or standalone to overwrite):
 *   node scripts/seed-kiwi-varied.mjs
 */
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

// ---------------------------------------------------------------------------
// data pools
// ---------------------------------------------------------------------------

const BROWSERS = [
  ["Chrome", 124, "Windows", 11],
  ["Chrome", 124, "macOS", 14],
  ["Chrome", 123, "Android", 14],
  ["Chrome", 124, "Linux", null],
  ["Safari", 17, "macOS", 14],
  ["Safari", 17, "iOS", 17],
  ["Safari", 16, "iOS", 16],
  ["Firefox", 125, "Windows", 11],
  ["Firefox", 125, "Linux", null],
  ["Firefox", 125, "macOS", 14],
  ["Edge", 124, "Windows", 11],
  ["Edge", 123, "macOS", 14],
  ["Samsung Internet", 24, "Android", 14],
  ["Opera", 109, "Windows", 11],
  ["Brave", 1.65, "Windows", 11],
  ["Vivaldi", 6.6, "Windows", 11],
  ["Yandex Browser", 24, "Windows", 11],
];

const DEVICES_WEIGHTED = ["desktop", "desktop", "desktop", "mobile", "mobile", "mobile", "mobile", "tablet"];

const VIEWPORTS = [
  [1920, 1080], [1366, 768], [1536, 864], [1440, 900], [2560, 1440], [1280, 720],
  [390, 844], [414, 896], [360, 800], [393, 852], [412, 915], [360, 780],
  [810, 1080], [834, 1194], [768, 1024], [820, 1180],
];

const LANGUAGES = [
  "en", "en", "en", "en", "en",
  "es", "es", "pt", "pt-BR",
  "fr", "de", "it", "nl",
  "ja", "ko", "zh-CN", "zh-TW",
  "ar", "hi", "ru", "pl", "tr", "th", "vi", "id",
];

const LOCATIONS = [
  ["US", "California", "San Francisco"],
  ["US", "New York", "New York"],
  ["US", "Texas", "Austin"],
  ["US", "Washington", "Seattle"],
  ["US", "Illinois", "Chicago"],
  ["US", "Florida", "Miami"],
  ["CA", "Ontario", "Toronto"],
  ["CA", "British Columbia", "Vancouver"],
  ["GB", "England", "London"],
  ["GB", "Scotland", "Edinburgh"],
  ["DE", "Bavaria", "Munich"],
  ["DE", "Berlin", "Berlin"],
  ["DE", "Hamburg", "Hamburg"],
  ["FR", "Île-de-France", "Paris"],
  ["FR", "Auvergne-Rhône-Alpes", "Lyon"],
  ["ES", "Madrid", "Madrid"],
  ["ES", "Catalonia", "Barcelona"],
  ["IT", "Lombardy", "Milan"],
  ["NL", "North Holland", "Amsterdam"],
  ["PT", "Lisbon", "Lisbon"],
  ["BR", "São Paulo", "São Paulo"],
  ["BR", "Rio de Janeiro", "Rio de Janeiro"],
  ["MX", "Mexico City", "Mexico City"],
  ["JP", "Tokyo", "Tokyo"],
  ["JP", "Osaka", "Osaka"],
  ["KR", "Seoul", "Seoul"],
  ["CN", "Beijing", "Beijing"],
  ["CN", "Shanghai", "Shanghai"],
  ["TW", "Taipei", "Taipei"],
  ["IN", "Maharashtra", "Mumbai"],
  ["IN", "Karnataka", "Bangalore"],
  ["AU", "New South Wales", "Sydney"],
  ["AU", "Victoria", "Melbourne"],
  ["SG", "Central", "Singapore"],
  ["SE", "Stockholm", "Stockholm"],
  ["NO", "Oslo", "Oslo"],
  ["DK", "Capital Region", "Copenhagen"],
  ["CH", "Zurich", "Zurich"],
  ["AT", "Vienna", "Vienna"],
  ["PL", "Masovia", "Warsaw"],
  ["NG", "Lagos", "Lagos"],
  ["ZA", "Gauteng", "Johannesburg"],
  ["AE", "Dubai", "Dubai"],
  ["SA", "Riyadh", "Riyadh"],
  ["ID", "Jakarta", "Jakarta"],
  ["TH", "Bangkok", "Bangkok"],
  ["VN", "Ho Chi Minh", "Ho Chi Minh City"],
  ["PH", "Metro Manila", "Manila"],
  ["MY", "Kuala Lumpur", "Kuala Lumpur"],
  [null, null, null], // ~5% unknown for realism
];

const PAGES = [
  ["/", "Home", 22],
  ["/menu", "Menu", 16],
  ["/locations", "Locations", 10],
  ["/about", "About", 8],
  ["/order", "Order online", 14],
  ["/blog/kiwi-toast-story", "Kiwi story", 6],
  ["/careers", "Careers", 4],
  ["/catering", "Catering", 5],
  ["/gift-cards", "Gift cards", 4],
  ["/blog/seasonal-menu", "Seasonal menu", 3],
];

const REFS = [
  null, null, null, null, null,
  ["google.com", { source: "google", medium: "organic" }],
  ["google.com", { source: "google", medium: "organic" }],
  ["google.com", { source: "google", medium: "organic" }],
  ["bing.com", { source: "bing", medium: "organic" }],
  ["instagram.com", { source: "instagram", medium: "social" }],
  ["x.com", { source: "x", medium: "social" }],
  ["facebook.com", { source: "facebook", medium: "social" }],
  ["reddit.com", { source: "reddit", medium: "referral" }],
  ["news.ycombinator.com", { source: "hackernews", medium: "referral" }],
  ["google.com", { source: "google", medium: "cpc", name: "kiwi-spring" }],
  ["tiktok.com", { source: "tiktok", medium: "social" }],
  ["linkedin.com", { source: "linkedin", medium: "social" }],
];

const TOTAL_WEIGHT = PAGES.reduce((a, p) => a + p[2], 0);

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(0x6b6977);

function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

function pickPage() {
  let acc = 0;
  const r = rand();
  for (const [path, title, w] of PAGES) {
    acc += w;
    if (r <= acc / TOTAL_WEIGHT) return [path, title];
  }
  return PAGES[0].slice(0, 2);
}

// ---------------------------------------------------------------------------
// delete existing + insert fresh 300 rows
// ---------------------------------------------------------------------------

const COUNT = 1000;
const DAY = 86_400_000;
const now = Date.now();

console.log(`Replacing page views for ${PROJECT_ID} with ${COUNT} enriched rows…`);

// delete old
await client.execute({ sql: "DELETE FROM web_page_views WHERE project_id = ?", args: [PROJECT_ID] });
await client.execute({ sql: "DELETE FROM events WHERE project_id = ? AND name = '$prism_page_view'", args: [PROJECT_ID] });

const BATCH = 25;
let inserted = 0;

for (let s = 0; s < Math.ceil(COUNT / 3); s++) {
  const sessionStart = now - Math.floor(rand() * 30 * DAY) + Math.floor(rand() * DAY);
  const views = 1 + Math.floor(rand() * 5);
  const ref = pick(REFS);
  const anon = `anon-pv-${s}-${Math.random().toString(36).slice(2, 6)}`;
  const sess = `sess-pv-${s}-${Date.now().toString(36)}`;

  for (let v = 0; v < views && inserted < COUNT; v++) {
    const [path, title] = pickPage();
    const occurredAt = sessionStart + v * Math.floor(30_000 + rand() * 180_000);
    if (occurredAt > now) continue;

    const b = pick(BROWSERS);
    const [browser, bMajor, os, osMajor] = b;
    const rawDevice = pick(DEVICES_WEIGHTED);
    const [vw, vh] = pick(VIEWPORTS);
    const isMobileVp = vw < 768;
    const device = isMobileVp ? "mobile" : rawDevice === "tablet" && rand() < 0.5 ? "tablet" : rawDevice;
    const lang = pick(LANGUAGES);
    const [cc, region, city] = pick(LOCATIONS);

    const props = {
      $page: {
        host: "localhost",
        path,
        navigation: v === 0 ? "initial" : "push",
        sequence: v + 1,
        title,
      },
      ...(v === 0 && ref
        ? { $referrer: { host: ref[0] }, ...(ref[1] ? { $campaign: ref[1] } : {}) }
        : {}),
    };

    const eventId = randomUUID();
    // Insert matching event (webAnalyticsLoader JOINs events ON e.id = w.event_id)
    await client.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, session_id, anonymous_id, properties, source_id)
            VALUES (?,?,'track','$prism_page_view',3,?,?,?,?,?,?)`,
      args: [
        eventId, PROJECT_ID, occurredAt, occurredAt, sess, anon,
        JSON.stringify(props),
        "b2b9b407-95c3-4b28-b9d2-832341178176",
      ],
    });
    // Insert page view projection
    await client.execute({
      sql: `INSERT INTO web_page_views
        (project_id, event_id, occurred_at, host, path, title, navigation_type, page_sequence,
         referrer_host, campaign_source, campaign_medium, campaign_name,
         browser_family, browser_major, os_family, os_major,
         device_type, viewport_width, viewport_height,
         primary_language, country_code, region, city, geo_provider, is_bot)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      args: [
        PROJECT_ID, eventId, occurredAt, "localhost", path, title, v === 0 ? "initial" : "push", v + 1,
        ref?.[0] ?? null, ref?.[1]?.source ?? null, ref?.[1]?.medium ?? null, ref?.[1]?.name ?? null,
        browser, bMajor, os, osMajor,
        device, vw, vh,
        lang, cc, region, city, cc ? "ipinfo" : null,
      ],
    });
    inserted++;
    if (inserted % 50 === 0) process.stdout.write(`  inserted ${inserted}/${COUNT}\r`);
  }
}
console.log(`\nInserted ${inserted} page views.`);

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

const total = await client.execute({ sql: "SELECT count(*) as c FROM web_page_views WHERE project_id=?", args: [PROJECT_ID] });
console.log(`Total page views: ${total.rows[0].c}`);

const checks = [
  ["browsers", "browser_family"],
  ["countries", "country_code"],
  ["devices", "device_type"],
  ["languages", "primary_language"],
  ["pages", "path"],
  ["referrers", "referrer_host"],
];
for (const [label, col] of checks) {
  const r = await client.execute({ sql: `SELECT ${col}, count(*) as c FROM web_page_views WHERE project_id=? GROUP BY ${col} ORDER BY c DESC LIMIT 12`, args: [PROJECT_ID] });
  console.log(`\n${label}:`, r.rows);
}

console.log("\nDone — refresh https://prism.localhost/workspace/.../kiwi-french-toast-397050807/web-analytics");
