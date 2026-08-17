#!/usr/bin/env node
/**
 * Restart-persistence certification (task-6 section 8, non-destructive).
 *
 * Boots a DISPOSABLE Compose project with generated secrets, seeds it
 * (first-boot owner, team, project, analytics key, session + event), runs
 * `docker compose restart` on every container, and verifies every marker
 * survived. The project is torn down with `down -v` afterwards — it never
 * touches Neon, Turso, or normal development databases.
 *
 * HTTP checks run INSIDE the compose network through the web container
 * (wget against the nginx single origin), so the full flow — browser
 * origin, /api proxy, analytics ingestion — is exercised without relying
 * on the host's port-publishing layer (OrbStack quirk; CI verifies the
 * real host mapping with its own daemon).
 *
 * Usage:
 *   node scripts/certify-restart.mjs [--port 3010]
 *   RESTART_CERT_NO_BUILD=1  — images pre-built manually (local compose
 *     versions differ on dockerfile-path resolution; CI builds via compose)
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3010";
const PUBLIC_URL = `http://localhost:${PORT}`;
const PROJECT = "prism-restart-cert";
const EMAIL = `restart-cert@example.com`;
const PASSWORD = randomBytes(12).toString("hex") + "Aa1!";
const SETUP_TOKEN = randomBytes(24).toString("hex");
const EVENT_NAME = `restart-marker-${Date.now()}`;

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

// Local compose engines resolve build paths inconsistently (compose-file
// vs CWD-relative), so the generated file drops the build sections and pins
// the pre-built images (tags = <project>-<service>). The runtime config is
// otherwise identical to deploy/compose.yml (CI builds from that file).
const COMPOSE_FILE = "deploy/compose.cert.yml";
const COMPOSE_SOURCE = "deploy/compose.yml";
let ENV_FILE;

const compose = (args, opts = {}) =>
  run("docker", [
    "compose",
    "-p",
    PROJECT,
    "-f",
    COMPOSE_FILE,
    "--env-file",
    ENV_FILE,
    ...args,
  ], opts);

/**
 * HTTP request through the web container (inside the compose network).
 * wget -S prints response headers to stderr; the body goes to stdout.
 */
const request = (path, { method = "GET", body, cookie, headers = [] } = {}) => {
  const args = [
    "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE,
    "exec", "-T", "web", "wget", "-qO-", "-S", "--timeout=10",
  ];
  if (body !== undefined) {
    args.push("--post-data", JSON.stringify(body), "--header", "content-type: application/json");
  }
  if (cookie) args.push("--header", `cookie: ${cookie}`);
  for (const h of headers) args.push("--header", h);
  args.push(`http://127.0.0.1${path}`);

  const res = run("docker", args, { allowFailure: true });
  // busybox wget -S: the body goes to stdout, the header block to stderr.
  const stdout = res.stdout ?? "";
  const headerBlock = res.stderr ?? "";
  if (process.env.CERT_DEBUG) {
    console.error("[debug] status line:", (headerBlock.split("\n")[0] ?? "").slice(0, 60));
  }
  const statusMatch = headerBlock.match(/HTTP\/1\.1 (\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const cookieMatch = headerBlock.match(/set-cookie:\s*([^;\s]+)/i);
  if (process.env.CERT_DEBUG && cookieMatch) {
    console.error("[debug] set-cookie:", cookieMatch[1].slice(0, 40));
  }
  let data = null;
  try {
    data = JSON.parse(stdout);
  } catch {
    /* non-JSON */
  }
  return { status, data, cookie: cookieMatch?.[1] ?? "" };
};

const waitForReady = async (timeoutMs = 240_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // health/ready + the runtime config: exercises nginx, the api proxy,
    // and the product database — the full single-origin path.
    const res = request("/health/ready");
    const config = request("/api/v1/config");
    if (res.status === 200 && config.status === 200) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};

// ---- disposable env file + normalized compose file ----
const tmpDir = mkdtempSync(join(tmpdir(), "prism-restart-cert-"));
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
    "INSTANCE_NAME=Restart Cert",
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
    // migrate runs the api image (its build uses the api Dockerfile).
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

async function main() {
  console.log(`\nRestart-persistence certification (${PROJECT}, port ${PORT})\n`);

  console.log("[1/7] Building + starting the disposable stack…");
  const buildArgs =
    process.env.RESTART_CERT_NO_BUILD === "1" ? ["up", "-d"] : ["up", "-d", "--build"];
  compose(buildArgs, { timeout: 900_000 });
  check("stack is up", true);

  console.log("[2/7] Waiting for readiness…");
  check("health/ready before restart", await waitForReady());

  console.log("[3/7] First boot: owner creation…");
  const ownerBody = { email: EMAIL, password: PASSWORD, name: "Restart Cert Owner" };
  const owner = await request("/api/v1/setup/owner", {
    method: "POST",
    body: ownerBody,
  });
  check(
    "setup/owner without token is rejected (401)",
    owner.status === 401,
    `got ${owner.status}`,
  );
  const ownerWithToken = await request("/api/v1/setup/owner", {
    method: "POST",
    body: ownerBody,
    headers: [`x-setup-token: ${SETUP_TOKEN}`],
  });
  check(
    "setup/owner with token succeeds (200)",
    ownerWithToken.status === 200,
    `got ${ownerWithToken.status}`,
  );
  const replay = await request("/api/v1/setup/owner", {
    method: "POST",
    body: ownerBody,
    headers: [`x-setup-token: ${SETUP_TOKEN}`],
  });
  check("setup replay is closed (404)", replay.status === 404, `got ${replay.status}`);

  console.log("[4/7] Seeding team, project, key, session, event…");
  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const cookie = signIn.cookie;
  const hasSessionCookie =
    cookie.startsWith("prism.session_token") ||
    cookie.startsWith("__Secure-prism.session_token"); // production prefix
  check("owner sign-in sets a session cookie", signIn.status === 200 && hasSessionCookie, `got ${signIn.status}`);

  const team = await request("/api/v1/teams", {
    method: "POST",
    body: { name: "Cert Team" },
    cookie,
  });
  const teamId = team.data?.team?.id ?? team.data?.id;
  check("team created", team.status === 200 && !!teamId, `got ${team.status}`);

  const project = await request(`/api/v1/projects/${teamId}`, {
    method: "POST",
    body: { teamId, name: "Cert Project" },
    cookie,
  });
  check("project created", project.status === 200, `got ${project.status}`);

  const projects = await request(`/api/v1/teams/${teamId}/projects`, { cookie });
  const slug = projects.data?.[0]?.slug;
  const projectInfo = await request(`/api/v1/projects/${slug}`, { cookie });
  const analyticsKey = projectInfo.data?.apiKey;
  check("analytics key retrieved", !!analyticsKey, "no key in project payload");

  // v2 ingestion (task-9 slice 6): the v1 analytics routes were removed —
  // the drill seeds through the versioned batch endpoint.
  const event = await request("/api/v2/ingest", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 2,
      sentAt: Date.now(),
      sdk: { name: "@prism-analytics/core", version: "0.0.1" },
      events: [
        {
          schemaVersion: 2,
          eventId: `restart-ev-${Date.now()}`,
          type: "track",
          occurredAt: Date.now(),
          name: EVENT_NAME,
          properties: { marker: true },
        },
      ],
    }),
    headers: [`authorization: Bearer ${analyticsKey}`],
  });
  check(
    "v2 event ingested",
    event.status === 200 && event.data?.results?.[0]?.status === "accepted",
    `got ${event.status} ${JSON.stringify(event.data)}`,
  );

  const eventsBefore = await request(`/api/v1/projects/${slug}/events`, { cookie });
  check(
    "event visible before restart",
    eventsBefore.status === 200 && JSON.stringify(eventsBefore.data).includes(EVENT_NAME),
    `got ${eventsBefore.status}`,
  );

  console.log("[5/7] Restarting every container…");
  compose(["restart"], { timeout: 180_000 });
  check("restart completed", true);

  console.log("[6/7] Verifying persistence after restart…");
  check("health/ready after restart", await waitForReady());

  const config = await request("/api/v1/config");
  check(
    "config reports setupRequired false",
    config.data?.setupRequired === false,
    JSON.stringify(config.data),
  );

  const replayAfter = await request("/api/v1/setup/owner", {
    method: "POST",
    body: ownerBody,
    headers: [`x-setup-token: ${SETUP_TOKEN}`],
  });
  check("setup stays closed after restart (404)", replayAfter.status === 404, `got ${replayAfter.status}`);

  const signInAfter = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const cookieAfter = signInAfter.cookie;
  const hasSessionCookieAfter =
    cookieAfter.startsWith("prism.session_token") ||
    cookieAfter.startsWith("__Secure-prism.session_token");
  check(
    "owner can sign in after restart",
    signInAfter.status === 200 && hasSessionCookieAfter,
    `got ${signInAfter.status}`,
  );

  const projectsAfter = await request(`/api/v1/teams/${teamId}/projects`, {
    cookie: cookieAfter,
  });
  check(
    "project survived restart",
    projectsAfter.status === 200 &&
      (projectsAfter.data?.length ?? 0) >= 1 &&
      JSON.stringify(projectsAfter.data).includes(slug ?? "Cert Project"),
    JSON.stringify(projectsAfter.data),
  );

  const eventsAfter = await request(`/api/v1/projects/${slug}/events`, { cookie: cookieAfter });
  check(
    "event survived restart (analytics store persisted)",
    eventsAfter.status === 200 && JSON.stringify(eventsAfter.data).includes(EVENT_NAME),
    `got ${eventsAfter.status}`,
  );

  console.log("\n[7/7] Tearing down the disposable stack…");
  compose(["down", "-v"], { timeout: 180_000, allowFailure: true });
  rmSync(tmpDir, { recursive: true, force: true });
  try {
    unlinkSync(COMPOSE_FILE);
  } catch {
    /* already gone */
  }

  console.log(`\nRestart-persistence certification: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  try {
    unlinkSync(COMPOSE_FILE);
  } catch {
    /* already gone */
  }
  console.error("certification failed:", error);
  process.exit(1);
});
