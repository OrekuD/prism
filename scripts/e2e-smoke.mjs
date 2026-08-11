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
 * create team -> create project -> start a session via the analytics
 * ingestion API -> read the project summary -> log an event -> read events ->
 * end the session. Exits non-zero with a report on any failure.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

const API = process.env.E2E_API_URL ?? "http://localhost:8787";
const AUTH = process.env.E2E_AUTH_URL ?? API;
const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:3001";
const ANALYTICS =
  process.env.E2E_ANALYTICS_URL ?? "http://localhost:8080/api/v1/analytics";

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

// 6. Create a team
const createTeam = await request(`${API}/api/v1/teams`, {
  method: "POST",
  body: { name: `E2E Team ${suffix}` },
});
check(
  "create-team succeeds",
  createTeam.status === 200,
  `got ${createTeam.status}`,
);
const teams = await request(`${API}/api/v1/teams`);
teamId = Array.isArray(teams.data)
  ? teams.data.find((team) => team.name.includes(suffix))?.id
  : null;
check("team appears in the teams list", !!teamId);

// 7. Create a project
const createProject = await request(`${API}/api/v1/projects/${teamId}`, {
  method: "POST",
  body: { teamId, name: `E2E Project ${suffix}` },
});
check(
  "create-project succeeds",
  createProject.status === 200,
  `got ${createProject.status}`,
);

// 8. Read the project + its analytics key
const projects = await request(`${API}/api/v1/teams/${teamId}/projects`);
const project = Array.isArray(projects.data)
  ? projects.data.find((p) => p.name.includes(suffix))
  : null;
projectId = project?.id;
check("project appears in the team listing", !!projectId);

const projectDetail = await request(`${API}/api/v1/projects/${project?.slug}`);
analyticsKey = projectDetail.data?.apiKey;
check("project detail exposes the analytics key", !!analyticsKey);

// 9. Start a session through the analytics ingestion API
const start = await request(`${ANALYTICS}/sessions`, {
  method: "POST",
  token: analyticsKey,
  body: {
    referrer: "https://e2e.example",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    location: "E2E",
  },
});
sessionId = start.data?.sessionId;
check(
  "ingestion starts a session",
  start.status === 200 && !!sessionId,
  `got ${start.status}`,
);

// 10. The team-project endpoint summary reflects the session (Turso store)
const afterStart = await request(`${API}/api/v1/teams/${teamId}/projects`);
const updated = Array.isArray(afterStart.data)
  ? afterStart.data.find((p) => p.id === projectId)
  : null;
const sessionCount = (updated?.summary ?? []).reduce(
  (sum, entry) => sum + entry.desktop + entry.mobile,
  0,
);
check(
  "session appears in the project summary",
  sessionCount >= 1,
  `summary ${JSON.stringify(updated?.summary)}`,
);

// 11. Log an event and read it back
const event = await request(`${ANALYTICS}/events`, {
  method: "POST",
  token: analyticsKey,
  body: { sessionId, name: "e2e-click", data: { label: "smoke" } },
});
check("event ingestion succeeds", event.status === 200, `got ${event.status}`);

const events = await request(`${API}/api/v1/projects/${project?.slug}/events`);
check(
  "event appears in the project events",
  Array.isArray(events.data) && events.data.some((e) => e.name === "e2e-click"),
);

// 12. End the session (scoped to the project key)
const end = await request(`${ANALYTICS}/sessions/end`, {
  method: "POST",
  token: analyticsKey,
  body: { sessionId },
});
check("end-session succeeds", end.status === 200, `got ${end.status}`);

// 13. A bogus key cannot end sessions
const bogusEnd = await request(`${ANALYTICS}/sessions/end`, {
  method: "POST",
  token: "bogus-key",
  body: { sessionId },
});
check(
  "a bogus key cannot end sessions",
  bogusEnd.status === 401,
  `got ${bogusEnd.status}`,
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
