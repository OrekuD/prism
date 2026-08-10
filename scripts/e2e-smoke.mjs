#!/usr/bin/env node
/**
 * E2E smoke test for Prism.
 *
 * Requires the local services to be running with real (or disposable test)
 * credentials:
 *
 *   yarn workspace prism-api dev            # http://localhost:8787
 *   yarn workspace prism-analytics-api dev  # http://localhost:8080
 *
 *   node scripts/e2e-smoke.mjs
 *
 * Flow: sign up -> sign in -> create team -> create project -> start a
 * session via the analytics ingestion API -> read the project summary from
 * the main API -> end the session -> assert the summary reflects the
 * session. Exits non-zero with a report on any failure.
 */
import { randomUUID } from "node:crypto";

const API = process.env.E2E_API_URL ?? "http://localhost:8787/api/v1";
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

async function request(url, { method = "GET", token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON body
  }
  return { status: response.status, json };
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `e2e-${suffix}@example.com`;
const password =
  process.env.E2E_PASSWORD ?? `E2E-password-${randomUUID().slice(0, 8)}!`;

let token = null;
let teamId = null;
let projectId = null;
let sessionId = null;
let analyticsKey = null;

console.log(`E2E smoke (${email})\n`);

// 1. Sign up
const signUp = await request(`${API}/auth/sign-up`, {
  method: "POST",
  body: { email, firstname: "E2E", lastname: "Smoke", password },
});
check("sign-up creates an account", signUp.status === 200, `got ${signUp.status}`);

// 2. Sign in
const signIn = await request(`${API}/auth/sign-in`, {
  method: "POST",
  body: { email, password },
});
check(
  "sign-in issues an access token",
  signIn.status === 200 && !!signIn.json?.accessToken,
  `got ${signIn.status}`,
);
token = signIn.json?.accessToken;

// 3. Create a team
const createTeam = await request(`${API}/teams`, {
  method: "POST",
  token,
  body: { name: `E2E Team ${suffix}` },
});
check("create-team succeeds", createTeam.status === 200, `got ${createTeam.status}`);
const teams = await request(`${API}/teams`, { token });
teamId = teams.json?.find((team) => team.name.includes(suffix))?.id;
check("team appears in the teams list", !!teamId);

// 4. Create a project
const createProject = await request(`${API}/teams/${teamId}/projects`, {
  method: "POST",
  token,
  body: { teamId, name: `E2E Project ${suffix}` },
});
check("create-project succeeds", createProject.status === 200, `got ${createProject.status}`);

// 5. Read the project + its analytics key
const projects = await request(`${API}/teams/${teamId}/projects`, { token });
const project = projects.json?.find((p) => p.name.includes(suffix));
projectId = project?.id;
check("project appears in the team listing", !!projectId);

const projectDetail = await request(`${API}/projects/${project?.slug}`, { token });
analyticsKey = projectDetail.json?.apiKey;
check("project detail exposes the analytics key", !!analyticsKey);

// 6. Start a session through the analytics ingestion API
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
sessionId = start.json?.sessionId;
check("ingestion starts a session", start.status === 200 && !!sessionId, `got ${start.status}`);

// 7. The team-project endpoint summary reflects the session (canonical Turso store)
const afterStart = await request(`${API}/teams/${teamId}/projects`, { token });
const updated = afterStart.json?.find((p) => p.id === projectId);
const sessionCount = (updated?.summary ?? []).reduce(
  (sum, entry) => sum + entry.desktop + entry.mobile,
  0,
);
check("session appears in the project summary", sessionCount >= 1, `summary ${JSON.stringify(updated?.summary)}`);

// 8. End the session (scoped to the project key)
const end = await request(`${ANALYTICS}/sessions/end`, {
  method: "POST",
  token: analyticsKey,
  body: { sessionId },
});
check("end-session succeeds", end.status === 200, `got ${end.status}`);

// 8b. Log an event and read it back through the events endpoint
const event = await request(`${ANALYTICS}/events`, {
  method: "POST",
  token: analyticsKey,
  body: { sessionId, name: "e2e-click", data: { label: "smoke" } },
});
check("event ingestion succeeds", event.status === 200, `got ${event.status}`);

const events = await request(`${API}/projects/${project?.slug}/events`, { token });
check(
  "event appears in the project events",
  Array.isArray(events.json) && events.json.some((e) => e.name === "e2e-click"),
);

// 9. A foreign key cannot end sessions (scoped update) — expect 401 with a bogus key
const bogusEnd = await request(`${ANALYTICS}/sessions/end`, {
  method: "POST",
  token: "bogus-key",
  body: { sessionId },
});
check("a bogus key cannot end sessions", bogusEnd.status === 401, `got ${bogusEnd.status}`);

// 10. Sign out
const signOut = await request(`${API}/auth/sign-out`, { method: "POST", token });
check("sign-out succeeds", signOut.status === 200, `got ${signOut.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
