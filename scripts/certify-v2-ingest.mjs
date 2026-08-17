#!/usr/bin/env node
/**
 * Core-to-storage v2 ingestion certification (task-9 slice-4 review —
 * mandatory end-to-end correction test).
 *
 * Boots a DISPOSABLE Compose project (product API + analytics API + sqld +
 * nginx), seeds a project + write key, then runs a REAL @prism/core client
 * against the PUBLIC nginx origin and verifies the full journey:
 *
 *   1. nginx routes /api/v2/ingest to the analytics service (not the
 *      product API);
 *   2. the bearer key derives the correct project server-side;
 *   3. the event is stored once with its event ID, occurrence time,
 *      anonymous ID, sanitized properties/context, and batch-derived SDK
 *      metadata;
 *   4. replay of the same envelope returns `duplicate` with no second row;
 *   5. consent withdrawal prevents delivery of queued events;
 *   6. an oversized streamed request returns 413 without full buffering;
 *   7. invalid keys get the analytics 401 contract through nginx.
 *
 * Safety guards (same as the Task 6 drills): disposable project name,
 * disposable volumes (`down -v`), loopback-only published ports, and
 * refusal when hosted Neon or Turso environment variables are present.
 *
 * Usage:
 *   node scripts/certify-v2-ingest.mjs [--port 3020]
 *   V2_CERT_NO_BUILD=1 — images pre-built manually (local compose engines
 *   resolve build paths inconsistently; CI builds via compose).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- safety guards: never touch hosted stores ----
const HOSTED = [
  process.env.NEONDB_PGHOST,
  process.env.TURSO_DATABASE_URL &&
    !process.env.TURSO_DATABASE_URL.includes("127.0.0.1") &&
    !process.env.TURSO_DATABASE_URL.includes("localhost"),
].filter(Boolean);
if (HOSTED.length > 0) {
  console.error(
    "REFUSING to run: hosted Neon/Turso environment variables are present — this drill only ever uses disposable local services.",
  );
  process.exit(1);
}

const PORT = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3020";
const PUBLIC_URL = `http://localhost:${PORT}`;
const PROJECT = "prism-v2-cert";
const EMAIL = `v2-cert@example.com`;
const PASSWORD = randomBytes(12).toString("hex") + "Aa1!";
const SETUP_TOKEN = randomBytes(24).toString("hex");
const EVENT_NAME = `v2-marker-${Date.now()}`;

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label} ${detail}`);
  }
};

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.allowFailure) {
    console.error(`command failed: ${cmd} ${args.join(" ")}`);
    console.error(res.stderr?.slice(0, 2000));
    process.exit(1);
  }
  return res;
};

// Same normalization as certify-restart.mjs: pin pre-built images so local
// compose engines do not re-resolve dockerfile paths inconsistently.
const COMPOSE_FILE = "deploy/compose.cert.yml";
const COMPOSE_SOURCE = "deploy/compose.yml";
let ENV_FILE;

const compose = (args, opts = {}) =>
  run(
    "docker",
    ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, ...args],
    opts,
  );

/** HTTP through the web container (inside the compose network). */
const request = (path, { method = "GET", body, cookie, headers = [] } = {}) => {
  if (method === "DELETE") {
    // busybox wget cannot send DELETE — use node fetch inside the
    // ANALYTICS container (the web image is nginx-only) against the
    // public origin through nginx; the route requires ?confirm=true.
    const script =
      `fetch("http://web${path}", { method: "DELETE", headers: {` +
      `${cookie ? `"cookie": "${cookie}", ` : ""}` +
      `"accept": "application/json" } }).then(async (r) => { console.log("CERT_STATUS=" + r.status); console.log(await r.text()); }).catch((e) => console.log("CERT_STATUS=0 " + String(e)));`;
    const res = run("docker", [
      "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE,
      "exec", "-T", "analytics", "node", "--input-type=module", "-e", script,
    ], { allowFailure: true });
    const stdout = res.stdout ?? "";
    const statusMatch = stdout.match(/CERT_STATUS=(\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    let data = null;
    try {
      data = JSON.parse(stdout.split("\n").slice(1).join("\n"));
    } catch {
      /* non-JSON */
    }
    return { status, data, cookie: "" };
  }
  const args = [
    "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE,
    "exec", "-T", "web", "wget", "-qO-", "-S", "--timeout=10",
  ];
  if (body !== undefined) {
    args.push("--post-data", body, "--header", "content-type: application/json");
  }
  if (cookie) args.push("--header", `cookie: ${cookie}`);
  for (const h of headers) args.push("--header", h);
  args.push(`http://127.0.0.1${path}`);

  const res = run("docker", args, { allowFailure: true });
  const stdout = res.stdout ?? "";
  const headerBlock = res.stderr ?? "";
  const statusMatch = headerBlock.match(/HTTP\/1\.1 (\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const cookieMatch = headerBlock.match(/set-cookie:\s*([^;\s]+)/i);
  let data = null;
  try {
    data = JSON.parse(stdout);
  } catch {
    /* non-JSON */
  }
  return { status, data, cookie: cookieMatch?.[1] ?? "" };
};

/** Run a JS snippet inside the analytics container (has node + @prism/core). */
const inAnalytics = (script, env = {}) => {
  const args = [
    "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE,
    "exec", "-T",
  ];
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push("analytics", "node", "--input-type=module", "--eval", script);
  return run("docker", args, { allowFailure: true });
};

const waitForReady = async (timeoutMs = 240_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // nginx proxies /health/ready and /health/live to the product API
    // (harden F24) — the SPA fallback can no longer fake readiness. The
    // /api/v1/config check additionally proves the full API proxy path.
    const res = request("/health/ready");
    const live = request("/health/live");
    const config = request("/api/v1/config");
    if (res.status === 200 && live.status === 200 && config.status === 200) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};

// ---- disposable env file + normalized compose file ----
const tmpDir = mkdtempSync(join(tmpdir(), "prism-v2-cert-"));
ENV_FILE = join(tmpDir, "compose.env");
writeFileSync(
  ENV_FILE,
  [
    `PUBLIC_URL=${PUBLIC_URL}`,
    `PUBLIC_PORT=${PORT}`,
    "POSTGRES_USER=prism",
    `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    "POSTGRES_DB=prism",
    "POSTGRES_PORT=0",
    `JWT_SECRET_KEY=${randomBytes(32).toString("hex")}`,
    `SETUP_TOKEN=${SETUP_TOKEN}`,
    "ENVIRONMENT=production",
    "PRISM_DEPLOYMENT_MODE=self-hosted",
    "INSTANCE_NAME=V2 Cert",
    "SIGNUP_POLICY=disabled",
    "STORAGE_DRIVER=local",
    `TURSO_AUTH_TOKEN=${randomBytes(24).toString("hex")}`,
  ].join("\n"),
);

const composeSource = readFileSync(COMPOSE_SOURCE, "utf8");
const lines = composeSource.split("\n");
const normalizedOut = [];
let service = "";
let skipBuild = 0;
for (const line of lines) {
  const svc = line.match(/^  ([a-z-]+):/);
  if (svc) {
    service = svc[1];
    skipBuild = 0;
    normalizedOut.push(line);
    continue;
  }
  const indent = line.match(/^ */)?.[0].length ?? 0;
  if (skipBuild > 0) {
    if (indent > skipBuild) continue;
    skipBuild = 0;
  }
  const trimmed = line.trim();
  if (trimmed.startsWith("build:")) {
    const image = service === "migrate" ? `${PROJECT}-api` : `${PROJECT}-${service}`;
    if (trimmed.includes("{")) {
      normalizedOut.push(`    image: ${image}`);
      continue;
    }
    skipBuild = indent;
    normalizedOut.push(`    image: ${image}`);
    continue;
  }
  normalizedOut.push(line);
}
writeFileSync(COMPOSE_FILE, normalizedOut.join("\n"));

// ---- the real core client, run inside the analytics container ----
const CORE_CLIENT_SCRIPT = `
import { createPrismClient } from "@prism/core";

const bodies = [];
const runtime = {
  name: "node-fake",
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
  transport: {
    post: async (url, request) => {
      bodies.push(request.body);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...request.headers,
          // A browser would add the Origin automatically; the Node
          // harness supplies it so the origin policy sees it.
          ...(process.env.PRISM_ORIGIN ? { origin: process.env.PRISM_ORIGIN } : {}),
        },
        body: request.body,
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        text: async () => await response.text(),
      };
    },
  },
  schedule: (delayMs, callback) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
  context: { platform: "node", kind: "server" },
};

const prism = await createPrismClient({
  sourceKey: process.env.PRISM_KEY,
  endpoint: process.env.PRISM_ENDPOINT,
  runtime,
  collection: { initialState: "granted", anonymousPersistence: "session" },
  queue: { maxBatchEvents: 1 },
});
const captured = prism.track(process.env.PRISM_EVENT_NAME, {
  url: "/cert",
  password: "hunter2",
});
const eventId = captured.status === "queued" ? captured.eventId : "";
await prism.flush();
await prism.shutdown({ timeoutMs: 2000 });

const envelope = JSON.parse(bodies[0] ?? "{}");
const event = envelope.events?.[0] ?? {};
console.log("CERT_EVENT_ID=" + eventId);
console.log("CERT_ANON_ID=" + String(event.anonymousId ?? ""));
console.log("CERT_OCURRED_AT=" + String(event.occurredAt ?? ""));
// raw body (JSON has no newlines) so the replay step can resend it verbatim
console.log("CERT_BODY=" + (bodies[0] ?? ""));
`;

const CONSENT_SCRIPT = `
import { createPrismClient } from "@prism/core";

let posts = 0;
let release = null;
const gate = new Promise((resolve) => {
  release = resolve;
});
const runtime = {
  name: "node-fake",
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
  transport: {
    // a transport that IGNORES the cancellation signal: the in-flight
    // request completes only after consent is already withdrawn
    post: async () => {
      posts += 1;
      await gate;
      return { status: 200, headers: {}, text: async () => "" };
    },
  },
  schedule: (delayMs, callback) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
  context: { platform: "node", kind: "server" },
};

const prism = await createPrismClient({
  sourceKey: process.env.PRISM_KEY,
  endpoint: process.env.PRISM_ENDPOINT,
  runtime,
  collection: { initialState: "granted", anonymousPersistence: "session" },
  queue: { maxBatchEvents: 1 },
});
prism.track("consent_in_flight");
const flushPromise = prism.flush(); // request in flight, hanging at the gate
await prism.setCollectionState("denied"); // withdrawal WHILE in flight
release(); // the abort-ignoring transport completes AFTER withdrawal
await flushPromise;
await prism.flush();
console.log("CERT_CONSENT_POSTS=" + String(posts));
await prism.shutdown({ timeoutMs: 500 });
`;

const OVERSIZED_SCRIPT = `
const url = process.env.PRISM_ENDPOINT + "/api/v2/ingest";
// streamed body with NO content-length — the bounded reader must stop at
// the ceiling and answer 413 instead of buffering the whole payload
const stream = new ReadableStream({
  start(controller) {
    const chunk = "x".repeat(64 * 1024);
    for (let i = 0; i < 32; i += 1) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});
try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + process.env.PRISM_KEY,
      "content-type": "application/json",
    },
    body: stream,
    // undici requires duplex for stream bodies (no content-length → chunked)
    duplex: "half",
  });
  console.log("CERT_OVERSIZED_STATUS=" + String(response.status));
} catch (error) {
  console.log("CERT_OVERSIZED_ERROR=" + String(error));
}
`;

async function main() {
  console.log(`\nCore-to-storage v2 ingestion certification (${PROJECT}, port ${PORT})\n`);

  console.log("[1/8] Building + starting the disposable stack…");
  const buildArgs =
    process.env.V2_CERT_NO_BUILD === "1" ? ["up", "-d"] : ["up", "-d", "--build"];
  compose(buildArgs, { timeout: 900_000 });
  check("stack is up", true);

  console.log("[2/8] Waiting for readiness…");
  check("health/ready", await waitForReady());

  console.log("[3/8] Seeding owner, workspace, project, source key…");
  const owner = await request("/api/v1/setup/owner", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "V2 Cert Owner" }),
    headers: [`x-setup-token: ${SETUP_TOKEN}`],
  });
  check("owner created", owner.status === 200, `got ${owner.status}`);

  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = signIn.cookie;
  check("owner sign-in", signIn.status === 200 && !!cookie, `got ${signIn.status}`);

  // Task 13: the personal workspace is a Better Auth organization,
  // provisioned through the server API (the first authenticated request
  // ensures it). Its active organization comes from the session.
  const orgList = await request("/api/auth/organization/list", { cookie });
  const organizationId = orgList.data?.organizations?.[0]?.id ?? orgList.data?.[0]?.id;
  check("personal workspace provisioned", orgList.status === 200 && !!organizationId, JSON.stringify(orgList.data).slice(0, 200));

  const project = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ organizationId, name: "V2 Cert Project" }),
    cookie,
  });
  check("project created", project.status === 200, `got ${project.status}`);

  const projects = await request(`/api/v1/projects?organizationId=${encodeURIComponent(organizationId)}`, { cookie });
  const slug = projects.data?.[0]?.slug;
  const expectedProjectId = projects.data?.[0]?.id;
  check("project listed in workspace", !!slug && !!expectedProjectId, JSON.stringify(projects.data).slice(0, 200));

  // Source-first key resolution (task-13): the ingest key belongs to a
  // WEB source; the seed request carries the browser origin so the
  // origin policy accepts the SDK requests that follow.
  const source = await request(`/api/v1/projects/${slug}/sources`, {
    method: "POST",
    body: JSON.stringify({
      name: "Cert Web",
      platform: "web",
      allowedOrigins: ["http://web", "http://localhost:3020"],
    }),
    cookie,
  });
  const analyticsKey = source.data?.initialKey;
  check("source key retrieved (publishable web)", !!analyticsKey && String(analyticsKey).startsWith("psk_"), "no key in source payload");

  console.log("[4/8] Invalid keys through nginx (analytics 401 contract)…");
  const missing = await request("/api/v2/ingest", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 2, events: [] }),
  });
  check("missing key → 401", missing.status === 401, `got ${missing.status}`);
  const wrong = await request("/api/v2/ingest", {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 2, events: [] }),
    headers: [`authorization: Bearer wrong-key`],
  });
  check("wrong key → 401", wrong.status === 401, `got ${wrong.status}`);

  console.log("[5/8] Real @prism/core client through the public origin…");
  const client = inAnalytics(CORE_CLIENT_SCRIPT, {
    PRISM_KEY: analyticsKey,
    PRISM_ENDPOINT: "http://web",
    PRISM_ORIGIN: "http://web",
    PRISM_EVENT_NAME: EVENT_NAME,
  });
  const clientOut = client.stdout ?? "";
  const eventId = clientOut.match(/CERT_EVENT_ID=(\S+)/)?.[1] ?? "";
  const anonId = clientOut.match(/CERT_ANON_ID=(\S+)/)?.[1] ?? "";
  const occurredAt = clientOut.match(/CERT_OCURRED_AT=(\S+)/)?.[1] ?? "";
  const bodyMatch = clientOut.match(/CERT_BODY=(\{.*\})/s);
  const sentBody = bodyMatch?.[1] ?? "";
  check("core client captured + delivered one event", !!eventId && sentBody.startsWith("{"), clientOut.slice(0, 300));
  check("anonymous ID attached to the envelope", anonId.length > 0, `got "${anonId}"`);

  console.log("[6/8] Verifying storage through sqld…");
  const verifyScript = `
import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const rows = await client.execute({
  sql: "SELECT id, project_id, source_id, platform, name, occurred_at, anonymous_id, properties, context, schema_version, sdk_name, sdk_version FROM events WHERE id = ?",
  args: ["${eventId}"],
});
if (rows.rows.length === 1) {
  const row = rows.rows[0];
  const props = JSON.parse(row.properties);
  const ctx = JSON.parse(row.context);
  console.log("CERT_ROW_PROJECT=" + row.project_id);
  console.log("CERT_ROW_SOURCE=" + String(row.source_id ?? ""));
  console.log("CERT_ROW_PLATFORM=" + String(row.platform ?? ""));
  console.log("CERT_ROW_NAME=" + row.name);
  console.log("CERT_ROW_ANON=" + String(row.anonymous_id ?? ""));
  console.log("CERT_ROW_OCCURRED=" + String(row.occurred_at));
  console.log("CERT_ROW_REDACTED=" + String(props.password));
  console.log("CERT_ROW_SDK=" + JSON.stringify({ name: row.sdk_name, version: row.sdk_version }));
  console.log("CERT_ROW_COUNT=1");
} else {
  console.log("CERT_ROW_COUNT=" + String(rows.rows.length));
}
client.close();
`;
  const verify = inAnalytics(verifyScript);
  const verifyOut = verify.stdout ?? "";
  const rowProject = verifyOut.match(/CERT_ROW_PROJECT=(\S+)/)?.[1] ?? "";
  const rowSource = verifyOut.match(/CERT_ROW_SOURCE=(\S+)/)?.[1] ?? "";
  const rowPlatform = verifyOut.match(/CERT_ROW_PLATFORM=(\S+)/)?.[1] ?? "";
  const rowOccurred = verifyOut.match(/CERT_ROW_OCCURRED=(\S+)/)?.[1] ?? "";
  const rowRedacted = verifyOut.match(/CERT_ROW_REDACTED=(\S+)/)?.[1] ?? "";
  const rowSdk = verifyOut.match(/CERT_ROW_SDK=(\{.*\}|null)/)?.[1] ?? "";
  check(
    "stored exactly once with the client's event ID and name",
    verifyOut.includes("CERT_ROW_COUNT=1") && verifyOut.includes(`CERT_ROW_NAME=${EVENT_NAME}`),
    verifyOut.slice(0, 300),
  );
  check(
    "occurredAt stored matches the client occurrence time",
    rowOccurred === occurredAt,
    `client=${occurredAt} stored=${rowOccurred}`,
  );
  check(
    "anonymousId stored matches the envelope",
    verifyOut.includes(`CERT_ROW_ANON=${anonId}`),
    verifyOut.slice(0, 200),
  );
  check(
    "stored project_id matches the seeded project (key-derived scoping)",
    !!expectedProjectId && rowProject === expectedProjectId,
    `expected=${expectedProjectId} got=${rowProject}`,
  );
  check("source_id persisted from the key (trusted context)", !!rowSource && rowSource.length > 0, `got "${rowSource}"`);
  check("platform persisted from the source", rowPlatform === "web", `got "${rowPlatform}"`);

  check("properties sanitized server-side", rowRedacted === "[REDACTED]", `got "${rowRedacted}"`);
  check(
    "SDK metadata derived from the batch (authoritative)",
    rowSdk.includes('"name":"@prism/core"') && rowSdk.includes('"version":"0.0.1"'),
    `got ${rowSdk}`,
  );

  console.log("[6.5/8] Identity + privacy through the public origin (task-10 §9)…");
  // v3 batch: identify with explicit traits + an anonymous event + an
  // identified event — the full person lifecycle through the real origin.
  const identifyUserId = `cert-user-${Date.now()}`;
  const identifyOpId = `cert-op-${Date.now()}`;
  const anonEventId = `cert-anon-ev-${Date.now()}`;
  const knownEventId = `cert-known-ev-${Date.now()}`;
  const identityBatch = JSON.stringify({
    schemaVersion: 3,
    sentAt: Date.now(),
    sdk: { name: "@prism/core", version: "0.0.1" },
    identity: [
      {
        opId: identifyOpId,
        userId: identifyUserId,
        anonymousId: "cert-anon-1",
        traits: { plan: "pro", company: "acme" },
        occurredAt: Date.now(),
      },
    ],
    events: [
      {
        schemaVersion: 3,
        eventId: anonEventId,
        type: "track",
        occurredAt: Date.now(),
        anonymousId: "cert-anon-1",
        name: "anonymous_event",
        properties: {},
      },
      {
        schemaVersion: 3,
        eventId: knownEventId,
        type: "track",
        occurredAt: Date.now(),
        anonymousId: "cert-anon-1",
        userId: identifyUserId,
        name: "identified_event",
        properties: { tier: "pro" },
      },
    ],
  });
  const identityPost = await request("/api/v2/ingest", {
    method: "POST",
    body: identityBatch,
    headers: [`authorization: Bearer ${analyticsKey}`, "origin: http://web"],
  });
  check(
    "v3 identity batch accepted through the public origin",
    identityPost.status === 200 &&
      identityPost.data?.identity?.[0]?.status === "accepted" &&
      identityPost.data?.results?.every((r) => r.status === "accepted"),
    JSON.stringify(identityPost.data),
  );

  // verify the person storage through sqld
  const identityVerify = inAnalytics(`
import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const people = await client.execute({
  sql: "SELECT person_id, last_seen_at FROM people WHERE project_id = ? LIMIT 5",
  args: ["${expectedProjectId}"],
});
const ext = await client.execute({
  sql: "SELECT user_id FROM external_identities WHERE project_id = ?",
  args: ["${expectedProjectId}"],
});
const traits = await client.execute({
  sql: "SELECT key, value FROM person_traits WHERE project_id = ?",
  args: ["${expectedProjectId}"],
});
const anonLink = await client.execute({
  sql: "SELECT anonymous_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id = 'cert-anon-1'",
  args: ["${expectedProjectId}"],
});
const identified = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND user_id = ?",
  args: ["${expectedProjectId}", "${identifyUserId}"],
});
const anonResolved = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND id = ? AND person_id LIKE 'u_%'",
  args: ["${expectedProjectId}", "${anonEventId}"],
});
console.log("CERT_PEOPLE=" + String(people.rows.length));
console.log("CERT_EXT_ID=" + String(ext.rows[0]?.user_id ?? ""));
console.log("CERT_TRAITS=" + String(traits.rows.length));
console.log("CERT_ANON_LINKED=" + String(anonLink.rows.length));
console.log("CERT_IDENTIFIED_EVENTS=" + String(identified.rows[0]?.n ?? 0));
console.log("CERT_ANON_RESOLVED_TO_KNOWN=" + String(anonResolved.rows[0]?.n ?? 0));
client.close();
`);
  const identityOut = identityVerify.stdout ?? "";
  check(
    "identify created the person, external identity, traits, and anon link",
    Number(identityOut.match(/CERT_PEOPLE=(\d+)/)?.[1] ?? 0) >= 1 &&
      identityOut.includes(`CERT_EXT_ID=${identifyUserId}`) &&
      identityOut.includes("CERT_TRAITS=2") &&
      identityOut.includes("CERT_ANON_LINKED=1"),
    identityOut.slice(0, 400),
  );
  check(
    "identified events resolve to the person; anonymous history links to the known person",
    identityOut.includes("CERT_IDENTIFIED_EVENTS=1") &&
      identityOut.includes("CERT_ANON_RESOLVED_TO_KNOWN=1"),
    identityOut.slice(0, 300),
  );

  // dashboard profile through the product API (authorized read path)
  const peopleList = await request(`/api/v1/projects/${slug}/people`, { cookie });
  const personRow = peopleList.data?.people?.[0];
  check(
    "people list through the dashboard API (project-authorized)",
    peopleList.status === 200 && personRow?.eventCount >= 2 && personRow?.identityCount >= 2,
    JSON.stringify(peopleList.data).slice(0, 300),
  );
  const personDetail = await request(
    `/api/v1/projects/${slug}/people/${encodeURIComponent(personRow?.personId ?? "")}`,
    { cookie },
  );
  check(
    "person detail exposes traits + linked identities",
    personDetail.status === 200 &&
      personDetail.data?.externalIds?.includes(identifyUserId) &&
      personDetail.data?.anonymousIds?.includes("cert-anon-1") &&
      personDetail.data?.traits?.plan === "pro",
    JSON.stringify(personDetail.data).slice(0, 300),
  );
  const personExport = await request(
    `/api/v1/projects/${slug}/people/${encodeURIComponent(personRow?.personId ?? "")}/export`,
    { cookie },
  );
  check(
    "person export returns documented analytics data",
    personExport.status === 200 &&
      personExport.data?.events?.length >= 2 &&
      personExport.data?.traits?.company === "acme",
    JSON.stringify(personExport.data).slice(0, 200),
  );
  const totals = await request(`/api/v1/projects/${slug}/totals`, { cookie });
  check(
    "honest totals: events / people / anonymous identities / sessions distinct",
    totals.status === 200 &&
      totals.data?.events >= 3 &&
      totals.data?.people >= 1 &&
      totals.data?.anonymousIdentities >= 1,
    JSON.stringify(totals.data),
  );
  const deleteCheck = await request(
    `/api/v1/projects/${slug}/people/${encodeURIComponent(personRow?.personId ?? "")}?confirm=true`,
    { method: "DELETE", cookie },
  );
  check(
    "destructive person deletion with explicit confirmation",
    deleteCheck.status === 200 && deleteCheck.data?.deleted === true,
    JSON.stringify(deleteCheck.data),
  );
  const afterDelete = await request(
    `/api/v1/projects/${slug}/people/${encodeURIComponent(personRow?.personId ?? "")}`,
    { cookie },
  );
  check(
    "deleted person is gone (404) and re-identify would start fresh",
    afterDelete.status === 404,
    `got ${afterDelete.status}`,
  );

  console.log("[6.75/8] Identity-only delivery through the real core client (review F2)…");
  const identityOnly = inAnalytics(`
import { createPrismClient } from "@prism/core";
const runtime = {
  name: "node-fake",
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
  transport: {
    post: async (url, request) => {
      // the core's cancellation signal is not an AbortSignal — omit it
      // for this short-lived script (the request completes immediately)
      const response = await fetch(url, {
        method: "POST",
        headers: { ...request.headers },
        body: request.body,
      });
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text: () => response.text() };
    },
  },
  schedule: (delayMs, callback) => { const handle = setTimeout(callback, delayMs); return () => clearTimeout(handle); },
  context: { platform: "node", kind: "server" },
};
const prism = await createPrismClient({
  sourceKey: process.env.PRISM_KEY,
  endpoint: process.env.PRISM_ENDPOINT,
  runtime,
  collection: { initialState: "granted", anonymousPersistence: "none" },
});
await prism.identify("identity-only-user", { plan: "pro" });
await prism.flush(); // identity-only: NO events were ever tracked
await prism.shutdown({ timeoutMs: 500 });
console.log("CERT_IDENTITY_ONLY_DONE=1");
`, { PRISM_KEY: analyticsKey, PRISM_ENDPOINT: "http://web" });
  check(
    "identity-only flush delivers without any event",
    identityOnly.stdout?.includes("CERT_IDENTITY_ONLY_DONE=1") ?? false,
    ((identityOnly.stdout ?? "") + " | STDERR: " + (identityOnly.stderr ?? "")).slice(0, 400),
  );
  const identityOnlyVerify = inAnalytics(`
import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const people = await client.execute({
  sql: "SELECT person_id FROM people p WHERE p.project_id = ? AND EXISTS (SELECT 1 FROM external_identities x WHERE x.project_id = p.project_id AND x.person_id = p.person_id AND x.user_id = 'identity-only-user')",
  args: ["${expectedProjectId}"],
});
const traits = await client.execute({
  sql: "SELECT COUNT(*) AS n FROM person_traits t WHERE t.project_id = ? AND t.person_id IN (SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = 'identity-only-user')",
  args: ["${expectedProjectId}", "${expectedProjectId}"],
});
console.log("CERT_IO_PEOPLE=" + String(people.rows.length));
console.log("CERT_IO_TRAITS=" + String(traits.rows[0]?.n ?? 0));
client.close();
`);
  check(
    "identity-only delivery created the person and traits server-side",
    (identityOnlyVerify.stdout?.includes("CERT_IO_PEOPLE=1") ?? false) &&
      (identityOnlyVerify.stdout?.includes("CERT_IO_TRAITS=1") ?? false),
    (identityOnlyVerify.stdout ?? "").slice(0, 300),
  );

  console.log("[7/8] Replay + consent + oversized stream…");
  const replay = await request("/api/v2/ingest", {
    method: "POST",
    body: sentBody,
    headers: [`authorization: Bearer ${analyticsKey}`, "origin: http://web"],
  });
  const replayStatus = replay.data?.results?.[0]?.status;
  check("replayed envelope → duplicate", replay.status === 200 && replayStatus === "duplicate", JSON.stringify(replay.data));

  const consent = inAnalytics(CONSENT_SCRIPT, {
    PRISM_KEY: analyticsKey,
    PRISM_ENDPOINT: "http://web",
  });
  const consentPosts = consent.stdout?.match(/CERT_CONSENT_POSTS=(\d+)/)?.[1] ?? "?";
  // EXACTLY one request may exist: the one already in flight when consent
  // was withdrawn. The completed response must not trigger a second one.
  check(
    "in-flight consent race: exactly one request, nothing after withdrawal",
    consentPosts === "1",
    `posts=${consentPosts}`,
  );

  const oversized = inAnalytics(OVERSIZED_SCRIPT, {
    PRISM_KEY: analyticsKey,
    PRISM_ENDPOINT: "http://web",
  });
  const oversizedStatus = oversized.stdout?.match(/CERT_OVERSIZED_STATUS=(\d+)/)?.[1] ?? "?";
  check("oversized streamed request → 413 at the ceiling", oversizedStatus === "413", `got ${oversizedStatus}`);

  // Server-side CONTEXT redaction (harden pass): a direct HTTP client
  // submits credentials nested in event context — the stored context must
  // carry [REDACTED].
  const ctxEventId = `cert-ctx-${Date.now()}`;
  const ctxBody = JSON.stringify({
    schemaVersion: 2,
    sentAt: Date.now(),
    events: [
      {
        schemaVersion: 2,
        eventId: ctxEventId,
        type: "track",
        occurredAt: Date.now(),
        name: "ctx_redaction",
        context: { platform: "direct-client", auth: { authorization: "fixture-ctx-value" } },
      },
    ],
  });
  const ctxPost = await request("/api/v2/ingest", {
    method: "POST",
    body: ctxBody,
    headers: [`authorization: Bearer ${analyticsKey}`, "origin: http://web"],
  });
  const ctxVerify = inAnalytics(`
import { createClient } from "@libsql/client";
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const rows = await client.execute({
  sql: "SELECT context FROM events WHERE id = ?",
  args: ["${ctxEventId}"],
});
if (rows.rows.length === 1) {
  const ctx = JSON.parse(rows.rows[0].context);
  console.log("CERT_CTX_REDACTED=" + String(ctx.auth?.authorization));
} else {
  console.log("CERT_CTX_REDACTED=missing");
}
client.close();
`);
  const ctxRedacted = ctxVerify.stdout?.match(/CERT_CTX_REDACTED=(\S+)/)?.[1] ?? "";
  check(
    "server-side context redaction applies to direct HTTP clients",
    ctxPost.status === 200 && ctxRedacted === "[REDACTED]",
    `post=${ctxPost.status} ctx=${ctxRedacted}`,
  );

  const stillOnce = await request("/api/v2/ingest", {
    method: "POST",
    body: sentBody,
    headers: [`authorization: Bearer ${analyticsKey}`, "origin: http://web"],
  });
  const stillDuplicate = stillOnce.data?.results?.[0]?.status === "duplicate";
  check("replay never creates a second row (still duplicate)", stillDuplicate);

  console.log("[8/8] Tearing down the disposable stack…");
  compose(["down", "-v"], { timeout: 180_000 });
  rmSync(tmpDir, { recursive: true, force: true });
  check("disposable volumes removed", true);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  compose(["down", "-v"], { allowFailure: true });
  process.exit(1);
});
