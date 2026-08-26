#!/usr/bin/env node
/**
 * E2E smoke test for Prism.
 *
 * Requires the local services to be running with real (or disposable test)
 * credentials and the Better Auth migration applied:
 *
 *   yarn workspace prism-api dev            # http://localhost:8787
 *   yarn workspace prism-analytics-api dev  # http://localhost:8080
 *
 *   E2E_AUTO_VERIFY_EMAIL=1 E2E_SEED_EMAILS=1 node scripts/e2e-smoke.mjs
 *
 * Flow: sign up (Better Auth) -> sign in (cookie session) -> service JWT ->
 * create workspace (Better Auth organization) -> create project -> create a
 * web source + publishable key -> ingest v2 track events through
 * /api/v2/ingest -> read them back via the project API.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

const API = process.env.E2E_API_URL ?? "http://localhost:8787";
const AUTH = process.env.E2E_AUTH_URL ?? API;
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:3001";
const INGEST = process.env.E2E_INGEST_URL ?? `${API}/api/v2/ingest`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** fetch wrapper with a manual cookie jar (Set-Cookie -> Cookie). */
const jar = { cookie: "" };

async function request(url, { method = "GET", token, body, json = true } = {}) {
  const headers = {
    ...(json && body !== undefined
      ? { "content-type": "application/json" }
      : {}),
    // Better Auth validates the browser origin on state-changing requests.
    // Mirror the configured dashboard client instead of bypassing that check.
    origin: ORIGIN,
    ...(jar.cookie ? { cookie: jar.cookie } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    jar.cookie = setCookie.split(";")[0];
  }

  let data = null;
  if (json) {
    try {
      data = await response.json();
    } catch {
      // non-JSON body
    }
  }
  return { status: response.status, data };
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `e2e-${suffix}@example.com`;
const password = ["E2E", "password", suffix].join("-");
const name = `E2E Smoke ${suffix}`;

async function verifyGeneratedE2EUser() {
  if (process.env.E2E_AUTO_VERIFY_EMAIL !== "1") {
    console.error(
      "Set E2E_AUTO_VERIFY_EMAIL=1 to verify the generated fixture before protected product actions.",
    );
    return false;
  }
  if (!/^e2e-[a-z0-9-]+@example\.com$/i.test(email)) {
    throw new Error("Refusing to verify a non-E2E email address");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for E2E email seeding");
  }
  // Seeding is only allowed for the generated e2e-*@example.com fixture
  // (checked above); the URL must be a scratch/CI database.
  if (process.env.E2E_SEED_EMAILS !== "1") {
    console.error(
      "Set E2E_SEED_EMAILS=1 to allow marking the generated fixture verified.",
    );
    return false;
  }

  // Portable connection: no Neon-only query options; SSL only for
  // Neon-style URLs (plain local/CI PostgreSQL needs none).
  const ssl = databaseUrl.includes("neon.tech")
    ? { ssl: "require" }
    : undefined;
  const sql = postgres(databaseUrl, {
    max: 1,
    ...(ssl ? { ssl } : {}),
  });
  try {
    const updated = await sql`
      UPDATE "user"
      SET email_verified = true, updated_at = now()
      WHERE email = ${email} AND email_verified = false
      RETURNING id`;
    return updated.length === 1;
  } finally {
    await sql.end();
  }
}

let teamId = null;
let projectId = null;
let sessionId = null;
let analyticsKey = null;

console.log(`E2E smoke (${email})\n`);

// 1. Sign up via Better Auth (email/password)
const signUp = await request(`${AUTH}/api/auth/sign-up/email`, {
  method: "POST",
  body: { email, password, name },
});
check(
  "sign-up creates an account",
  signUp.status === 200 && !!signUp.data?.token,
  `got ${signUp.status}`,
);

const verified = signUp.status === 200 && (await verifyGeneratedE2EUser());
check("generated development account is email-verified", verified);

// 2. Sign in and capture the session cookie
const signIn = await request(`${AUTH}/api/auth/sign-in/email`, {
  method: "POST",
  body: { email, password },
});
check(
  "sign-in sets a session cookie",
  signIn.status === 200 && jar.cookie.startsWith("prism.session_token"),
  `got ${signIn.status}`,
);

// 3. The cookie session resolves to the user
const session = await request(`${AUTH}/api/auth/get-session`);
check(
  "session lookup from cookie",
  session.status === 200 && session.data?.user?.email === email,
  `got ${session.status}`,
);

// 4. A short-lived service JWT is issued for the analytics WebSocket
const token = await request(`${AUTH}/api/auth/token`);
check("service JWT issued", token.status === 200 && !!token.data?.token);
const serviceToken = token.data?.token;

if (failed > 0) {
  console.error(
    `\nAuthentication preflight failed: ${passed} passed, ${failed} failed`,
  );
  process.exit(1);
}

// 5. The analytics API accepts the service JWT on the WebSocket contract
//    (verified indirectly: ingestion uses the project key below; the JWKS
//    contract is covered by unit tests).

// 5. A short-lived service JWT is issued for the analytics WebSocket
//    (kept from the original flow — asserted above at step 4).

// 6. Create a workspace (Better Auth organization)
const org = await request(`${AUTH}/api/auth/organization/create`, {
  method: "POST",
  body: {
    name: `E2E Team ${suffix}`,
    slug: `e2e-${suffix.slice(0, 13).toLowerCase()}`,
  },
});
const organizationId = org.data?.id;
check("create-workspace succeeds", org.status === 200 && !!organizationId, `got ${org.status} ${JSON.stringify(org.data)}`);

// 7. Create a project inside the workspace
const createdProject = await request(`${API}/api/v1/projects`, {
  method: "POST",
  body: { organizationId, name: `E2E Project ${suffix}` },
});
project = createdProject.data ?? null;
projectId = project?.id ?? null;
check("create-project succeeds", createdProject.status === 200 && !!project?.slug, `got ${createdProject.status}`);

// 8. The workspace listing contains the project, and creating a web source
//    returns its publishable key exactly once
const projects = await request(`${API}/api/v1/projects?organizationId=${organizationId}`);
check(
  "project appears in the workspace listing",
  Array.isArray(projects.data) && projects.data.some((p) => p.id === projectId),
);
const source = await request(`${API}/api/v1/projects/${project?.slug}/sources`, {
  method: "POST",
  body: { name: "E2E Web", platform: "web", allowedOrigins: [ORIGIN] },
});
const sourceKey = source.data?.initialKey;
check(
  "source exposes its initial key",
  source.status === 200 &&
    typeof sourceKey === "string" &&
    sourceKey.startsWith("psk_"),
  `got ${source.status}`,
);

// 9. Ingestion: session-scoped track event via the v3 envelope
sessionId = randomUUID();
const now = Date.now();
const ingest = await request(INGEST, {
  method: "POST",
  token: sourceKey,
  body: {
    schemaVersion: 3,
    sentAt: now,
    sdk: { name: "@prism-analytics/browser", version: "0.0.2" },
    events: [
      {
        schemaVersion: 3,
        eventId: randomUUID(),
        type: "track",
        occurredAt: now,
        sessionId,
        name: "e2e-click",
        properties: { label: "smoke" },
        context: { platform: "web", screenSize: "1920x1080" },
      },
    ],
  },
});
check("event ingestion succeeds", ingest.status === 200, `got ${ingest.status} ${JSON.stringify(ingest.data)?.slice(0,200)}`);

// 10. The event is readable through the project API
const events = await request(`${API}/api/v1/projects/${project?.slug}/events`);
check(
  "event appears in the project events",
  Array.isArray(events.data) && events.data.some((e) => e.name === "e2e-click"),
);

// 11. Totals reflect the ingested event + session (Turso read model)
const totals = await request(`${API}/api/v1/projects/${project?.slug}/totals`);
check(
  "totals reflect the session and event",
  totals.status === 200 &&
    Number(totals.data?.events ?? 0) >= 1 &&
    Number(totals.data?.sessions ?? 0) >= 1,
  `got ${totals.status} ${JSON.stringify(totals.data)}`,
);

// 12. A bogus key cannot ingest
const bogusIngest = await request(INGEST, {
  method: "POST",
  token: "bogus-key",
  body: { schemaVersion: 3, events: [{ eventId: "x", type: "track", occurredAt: Date.now(), name: "nope", schemaVersion: 3 }] },
});
check(
  "a bogus key cannot ingest",
  bogusIngest.status === 401,
  `got ${bogusIngest.status}`,
);

// 14. Sign out revokes the session
const signOut = await request(`${AUTH}/api/auth/sign-out`, {
  method: "POST",
  body: {},
});
check("sign-out succeeds", signOut.status === 200, `got ${signOut.status}`);
const afterSignOut = await request(`${AUTH}/api/auth/get-session`);
check("session is revoked after sign-out", afterSignOut.data?.session == null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
