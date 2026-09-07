#!/usr/bin/env node
/**
 * Seed identified People for the kiwi demo project so the People explorer
 * has real rows to work with: display identities, traits (including
 * object/array/null values for the bounded renderer), linked anonymous
 * history, Standard Event activity ($prism_sign_up / $prism_login), and a
 * spread of link/activity times so the 7d/30d/90d ranges differ.
 *
 * Idempotent: removes previously seeded rows (user ids prefixed `seed-`)
 * before inserting. Existing anonymous analytics data is left untouched.
 *
 *   node scripts/seed-people.mjs
 */
import { createClient } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";

const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const SOURCE_ID = "b2b9b407-95c3-4b28-b9d2-832341178176"; // "site" (web)
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

const DAY = 86_400_000;
const now = Date.now();

const personIdForUser = (userId) =>
  `u_${createHash("sha256").update(`${PROJECT_ID}:${userId}`).digest("hex").slice(0, 32)}`;
const personIdForAnonymous = (anonId) =>
  `a_${createHash("sha256").update(`${PROJECT_ID}:${anonId}`).digest("hex").slice(0, 32)}`;

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(0x9e091e);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// [userId, name, email, username, plan, company, linkedDaysAgo, lastSeenDaysAgo, extraTraits]
const PERSONAS = [
  ["seed-ama", "Ama Mensah", "ama@example.com", "ama_m", "pro", "Acme", 2, 0, { role: "admin", seats: 12, notifications: true }],
  ["seed-kwame", "Kwame Asante", "kwame@example.com", "kwame_a", "team", "Acme", 5, 1, { role: "member", seats: 12 }],
  ["seed-efua", "Efua Owusu", "efua@example.com", null, "free", null, 1, 0, { theme: "dark" }],
  ["seed-yaw", "Yaw Boateng", "yaw@example.com", "yawb", "pro", "Boateng Labs", 9, 3, { tags: ["beta", "vip"], settings: { theme: "dark", flags: [1, 2, 3] } }],
  ["seed-akosua", "Akosua Frimpong", "akosua@example.com", "akosua_f", "team", "Frimpong & Co", 12, 6, { legacy: null, bio: "Loves kiwi toast. ".repeat(30) }],
  ["seed-kofi", "Kofi Annan", "kofi@example.com", "kofi_a", "pro", "Global Foods", 20, 2, { role: "owner" }],
  ["seed-esi", "Esi Coleman", "esi@example.com", null, "free", null, 26, 9, {}],
  ["seed-kojo", "Kojo Tawiah", "kojo@example.com", "kojot", "team", "Tawiah Inc", 29, 12, { plan_cycle: "annual" }],
  ["seed-aba", "Aba Sackey", "aba@example.com", "aba_s", "pro", "Sackey Group", 35, 4, { role: "member" }],
  ["seed-fiifi", "Fiifi Arthur", "fiifi@example.com", null, "free", null, 41, 15, {}],
  ["seed-adjoa", "Adjoa Pekyi", "adjoa@example.com", "adjoa_p", "team", "Pekyi Foods", 50, 33, { seats: 4 }],
  ["seed-nana", "Nana Adu", "nana@example.com", "nana_a", "pro", "Adu Enterprises", 60, 45, { role: "owner", tags: ["enterprise"] }],
  ["seed-maame", "Maame Esi", "maame@example.com", null, "free", null, 3, 21, {}],
  ["seed-papa", "Papa Kwesi", "papa@example.com", "papa_k", "pro", "Kwesi Kitchens", 7, 7, { theme: "light", notifications: false }],
  ["seed-yaa", "Yaa Pokuaa", "yaa@example.com", "yaa_p", "team", "Pokuaa Co", 15, 1, { settings: { weekly_digest: true, channels: ["email", "slack"] } }],
  ["seed-kwadwo", "Kwadwo Mensimah", "kwadwo@example.com", null, "free", null, 4, 4, {}],
  ["seed-afia", "Afia Nyarko", "afia@example.com", "afia_n", "pro", "Nyarko Brands", 11, 0, { role: "admin", seats: 30 }],
  ["seed-kubs", "Kubs Osei", "kubs@example.com", "kubs_o", "team", "Osei United", 18, 8, {}],
  ["seed-serwaa", "Serwaa Bonsu", "serwaa@example.com", null, "free", null, 25, 25, { legacy: null }],
  ["seed-otum", "Otumfuo Prep", "otum@example.com", "otum", "pro", "Prep Kitchen", 33, 2, { role: "member", seats: 8 }],
  ["seed-dela", "Dela Aki", "dela@example.com", "dela_a", "team", "Aki & Sons", 55, 50, {}],
  ["seed-sena", "Sena Kpetigo", "sena@example.com", null, "free", null, 6, 6, { theme: "dark" }],
];

const PRODUCT_EVENTS = [
  "topping_added",
  "kiwi_ordered",
  "checkout_completed",
  "menu_viewed",
  "order_rated",
];

async function cleanup() {
  const userIds = PERSONAS.map((p) => p[0]);
  userIds.push("seed-ama+alias");
  const personIds = [
    ...PERSONAS.map((p) => personIdForUser(p[0])),
    ...PERSONAS.filter((_, i) => i % 2 === 0).map(
      (_, j) => personIdForAnonymous(`seed-anon-${PERSONAS.filter((__, k) => k % 2 === 0)[j][0]}`),
    ),
  ];
  // person events + traits + links + people (anonymous seed rows included)
  for (const pid of new Set(personIds)) {
    await client.execute({ sql: "DELETE FROM events WHERE project_id = ? AND person_id = ?", args: [PROJECT_ID, pid] });
    await client.execute({ sql: "DELETE FROM person_traits WHERE project_id = ? AND person_id = ?", args: [PROJECT_ID, pid] });
    await client.execute({ sql: "DELETE FROM external_identities WHERE project_id = ? AND person_id = ?", args: [PROJECT_ID, pid] });
    await client.execute({ sql: "DELETE FROM anonymous_identities WHERE project_id = ? AND person_id = ?", args: [PROJECT_ID, pid] });
    await client.execute({ sql: "DELETE FROM people WHERE project_id = ? AND person_id = ?", args: [PROJECT_ID, pid] });
  }
  for (const uid of userIds) {
    await client.execute({ sql: "DELETE FROM external_identities WHERE project_id = ? AND user_id = ?", args: [PROJECT_ID, uid] });
  }
}

async function insertEvent({ at, sessionId, anonId, userId, personId, name, properties }) {
  await client.execute({
    sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at,
            session_id, anonymous_id, user_id, person_id, properties, context,
            sdk_name, sdk_version, source_id, platform)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      randomUUID(), PROJECT_ID, "track", name, 3, at, at,
      sessionId, anonId, userId, personId,
      JSON.stringify(properties ?? {}), "{}",
      "@prism-analytics/browser", "0.0.4",
      SOURCE_ID, "web",
    ],
  });
}

console.log("Cleaning previous seed-people rows…");
await cleanup();

console.log(`Seeding ${PERSONAS.length} identified people…`);
let eventCount = 0;

for (let i = 0; i < PERSONAS.length; i++) {
  const [userId, name, email, username, plan, company, linkedDaysAgo, lastSeenDaysAgo, extra] = PERSONAS[i];
  const personId = personIdForUser(userId);
  const linkedAt = now - linkedDaysAgo * DAY - Math.floor(rand() * DAY / 2);
  const lastSeenAt = now - lastSeenDaysAgo * DAY - Math.floor(rand() * 3_600_000);
  const firstSeenAt = Math.min(linkedAt, lastSeenAt - Math.floor(rand() * 5 * DAY));

  await client.execute({
    sql: "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?,?,?,?)",
    args: [personId, PROJECT_ID, firstSeenAt, lastSeenAt],
  });
  await client.execute({
    sql: "INSERT INTO external_identities (project_id, user_id, person_id, linked_at) VALUES (?,?,?,?)",
    args: [PROJECT_ID, userId, personId, linkedAt],
  });

  // traits: profile keys + plan/company + custom values
  const traits = {
    name, email,
    ...(username ? { username } : {}),
    plan,
    ...(company ? { company } : {}),
    ...extra,
  };
  for (const [key, value] of Object.entries(traits)) {
    await client.execute({
      sql: "INSERT INTO person_traits (project_id, person_id, key, value, updated_at) VALUES (?,?,?,?,?)",
      args: [PROJECT_ID, personId, key, JSON.stringify(value), lastSeenAt],
    });
  }

  const hasAnonHistory = i % 2 === 0;
  const anonId = `seed-anon-${userId}`;
  if (hasAnonHistory) {
    await client.execute({
      sql: "INSERT INTO anonymous_identities (project_id, anonymous_id, person_id, linked_at) VALUES (?,?,?,?)",
      args: [PROJECT_ID, anonId, personId, linkedAt],
    });
    // pre-signup anonymous browsing, attributed to the now-known person
    const anonSession = `seed-sess-${userId}-anon`;
    const anonViews = 1 + Math.floor(rand() * 3);
    for (let v = 0; v < anonViews; v++) {
      const at = linkedAt - (anonViews - v) * Math.floor(3_600_000 + rand() * 20_000_000);
      await insertEvent({
        at, sessionId: anonSession, anonId, userId: null, personId,
        name: pick(["menu_viewed", "topping_added", "$prism_page_view"]),
        properties: { path: pick(["/", "/menu", "/order"]) },
      });
      eventCount++;
    }
  }

  // signup at link time (Standard Event with $standard attribution)
  await insertEvent({
    at: linkedAt, sessionId: `seed-sess-${userId}-s0`,
    anonId: hasAnonHistory ? anonId : null, userId, personId,
    name: "$prism_sign_up",
    properties: { $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } } },
  });
  eventCount++;

  // 1-3 identified sessions of product activity up to lastSeenAt
  const sessions = 1 + Math.floor(rand() * 3);
  for (let sN = 0; sN < sessions; sN++) {
    const sessionId = `seed-sess-${userId}-s${sN + 1}`;
    const base = lastSeenAt - sN * Math.floor(DAY * (1 + rand() * 6));
    if (base < linkedAt) continue;
    if (sN > 0) {
      await insertEvent({
        at: base, sessionId, anonId: null, userId, personId,
        name: "$prism_login",
        properties: { $standard: { schemaVersion: 1, key: "login", data: { method: "email" } } },
      });
      eventCount++;
    }
    const n = 1 + Math.floor(rand() * 4);
    for (let e = 0; e < n; e++) {
      await insertEvent({
        at: Math.min(base + e * Math.floor(60_000 + rand() * 600_000), now),
        sessionId, anonId: null, userId, personId,
        name: pick(PRODUCT_EVENTS),
        properties: pick([{}, { topping: "kiwi" }, { total: 12.5 + Math.floor(rand() * 40) }]),
      });
      eventCount++;
    }
  }
}

// an alias: second external ID on Ama's person (Linked IDs = 2)
const amaPerson = personIdForUser("seed-ama");
await client.execute({
  sql: "INSERT INTO external_identities (project_id, user_id, person_id, linked_at) VALUES (?,?,?,?)",
  args: [PROJECT_ID, "seed-ama+alias", amaPerson, now - 1 * DAY],
});

console.log(`\nSeeded ${PERSONAS.length} people + 1 alias, ${eventCount} events.`);

const checks = await Promise.all([
  client.execute({ sql: "SELECT count(*) c FROM people WHERE project_id = ?", args: [PROJECT_ID] }),
  client.execute({ sql: "SELECT count(*) c FROM external_identities WHERE project_id = ?", args: [PROJECT_ID] }),
  client.execute({ sql: "SELECT count(*) c FROM anonymous_identities WHERE project_id = ?", args: [PROJECT_ID] }),
  client.execute({ sql: "SELECT count(*) c FROM person_traits WHERE project_id = ?", args: [PROJECT_ID] }),
]);
console.log("people:", checks[0].rows[0].c,
  "| external:", checks[1].rows[0].c,
  "| anonymous links:", checks[2].rows[0].c,
  "| traits:", checks[3].rows[0].c);

console.log("\nDone — open https://prism.localhost/workspace/wrk_ioeoy0e5irnobjbl/projects/kiwi-french-toast-397050807/people");
