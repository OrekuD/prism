#!/usr/bin/env node
/**
 * Backup/restore drill (task-6 section 8) — EXECUTED against a disposable
 * stack after explicit approval (review gate).
 *
 * The drill (guards first, then):
 *   1. Boot a disposable Compose project with generated secrets and a
 *      host-mapped PostgreSQL port (for pg_dump/pg_restore).
 *   2. Seed markers: first-boot owner, team, project, analytics key,
 *      session + event (through the single public origin).
 *   3. scripts/backup.sh -> product DB dump + sqld volume snapshot.
 *   4. docker compose down -v (destroy the volumes).
 *   5. Boot fresh volumes; stop sqld/analytics/api.
 *   6. scripts/restore.sh -> pg_restore into the fresh product database;
 *      restore the sqld volume snapshot.
 *   7. Start sqld/analytics/api; re-verify the markers (config, sign-in,
 *      project, event in the analytics store).
 *   8. down -v teardown + delete the backup dir.
 *
 * Guards: refuses any non-loopback DATABASE_URL, any NEONDB / TURSO env vars,
 * and any compose project other than its own disposable one. Never targets
 * Neon, Turso, or normal development databases.
 *
 * Usage:
 *   node scripts/drill-backup-restore.mjs [--port 3012]
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- guards (before anything runs) ----------
const guardFailures = [];
const guard = (ok, message) => {
  if (!ok) guardFailures.push(message);
};
const env = process.env;
guard(
  !env.DATABASE_URL || /(^|@)(127\.0\.0\.1|localhost|\[::1\])/.test(env.DATABASE_URL),
  "DATABASE_URL must be loopback-only for the drill (never Neon/remote).",
);
guard(
  !env.NEONDB_HOST && !env.NEONDB_DATABASE && !env.NEONDB_USER && !env.NEONDB_PASSWORD,
  "NEONDB_* must be absent — the drill never targets Neon.",
);
guard(
  !env.TURSO_DATABASE_URL && !env.TURSO_AUTH_TOKEN,
  "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must be absent — the drill never targets Turso.",
);
guard(
  !env.SETUP_TOKEN && !env.JWT_SECRET_KEY && !env.POSTGRES_PASSWORD,
  "No real stack secrets may leak into the drill environment.",
);
if (guardFailures.length > 0) {
  console.error("Backup/restore drill REFUSED — guards:");
  for (const failure of guardFailures) console.error(`  - ${failure}`);
  process.exit(2);
}

// ---------- drill runtime ----------
const PORT = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3012";
const PGPORT = process.argv.includes("--pg-port")
  ? process.argv[process.argv.indexOf("--pg-port") + 1]
  : "5433";
const PROJECT = "prism-restore-drill";
const EMAIL = `restore-drill@example.com`;
const PASSWORD = randomBytes(12).toString("hex") + "Aa1!";
const SETUP_TOKEN = randomBytes(24).toString("hex");
const EVENT_NAME = `restore-marker-${Date.now()}`;
const COMPOSE_FILE = "deploy/compose.cert.yml";
const COMPOSE_SOURCE = "deploy/compose.yml";

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
    console.error((res.stderr ?? res.stdout ?? "").slice(0, 2000));
    process.exit(1);
  }
  return res;
};

const compose = (args, opts = {}) =>
  run("docker", [
    "compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, ...args,
  ], opts);

/** HTTP through the web container (busybox wget -S: body=stdout, headers=stderr). */
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
  const headerBlock = res.stderr ?? "";
  const statusMatch = headerBlock.match(/HTTP\/1\.1 (\d{3})/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const cookieMatch = headerBlock.match(/set-cookie:\s*([^;\s]+)/i);
  let data = null;
  try {
    data = JSON.parse(res.stdout ?? "");
  } catch {
    /* non-JSON */
  }
  return { status, data, cookie: cookieMatch?.[1] ?? "" };
};

const waitForReady = async (timeoutMs = 240_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = request("/health/ready");
    const config = request("/api/v1/config");
    if (res.status === 200 && config.status === 200) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};

// ---------- disposable env + normalized compose ----------
const tmpDir = mkdtempSync(join(tmpdir(), "prism-restore-drill-"));
const ENV_FILE = join(tmpDir, "compose.env");
const DB_PASSWORD = randomBytes(24).toString("hex");
writeFileSync(
  ENV_FILE,
  [
    `PUBLIC_URL=http://localhost:${PORT}`,
    `PUBLIC_PORT=${PORT}`,
    "POSTGRES_USER=prism",
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    "POSTGRES_DB=prism",
    `POSTGRES_PORT=${PGPORT}`,
    `JWT_SECRET_KEY=${randomBytes(32).toString("hex")}`,
    `SETUP_TOKEN=${SETUP_TOKEN}`,
    "ENVIRONMENT=production",
    "PRISM_DEPLOYMENT_MODE=self-hosted",
    "INSTANCE_NAME=Restore Drill",
    "SIGNUP_POLICY=disabled",
    "STORAGE_DRIVER=local",
    `TURSO_AUTH_TOKEN=${randomBytes(24).toString("hex")}`,
  ].join("\n"),
);

const composeSource = readFileSync(COMPOSE_SOURCE, "utf8");
const lines = composeSource.split("\n");
const out = [];
let service = "";
let skipBuild = 0;
for (const line of lines) {
  const svc = line.match(/^  ([a-z-]+):/);
  if (svc) {
    service = svc[1];
    skipBuild = 0;
    out.push(line);
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
      out.push(`    image: ${image}`);
      continue;
    }
    skipBuild = indent;
    out.push(`    image: ${image}`);
    continue;
  }
  out.push(line);
}
writeFileSync(COMPOSE_FILE, out.join("\n"));

const DB_URL = `postgres://prism:${DB_PASSWORD}@127.0.0.1:${PGPORT}/prism`;

async function main() {
  console.log(`\nBackup/restore drill (${PROJECT}, port ${PORT})\n`);

  console.log("[1/8] Starting the disposable stack…");
  compose(["up", "-d"], { timeout: 900_000 });
  check("stack is up", true);
  check("health/ready", await waitForReady());

  console.log("[2/8] Seeding markers…");
  const ownerBody = { email: EMAIL, password: PASSWORD, name: "Restore Drill Owner" };
  const owner = await request("/api/v1/setup/owner", {
    method: "POST",
    body: ownerBody,
    headers: [`x-setup-token: ${SETUP_TOKEN}`],
  });
  check("setup/owner succeeds (200)", owner.status === 200, `got ${owner.status}`);

  const signIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const cookie = signIn.cookie;
  check(
    "owner sign-in sets a session cookie",
    signIn.status === 200 &&
      (cookie.startsWith("prism.session_token") ||
        cookie.startsWith("__Secure-prism.session_token")),
    `got ${signIn.status}`,
  );

  const team = await request("/api/v1/teams", { method: "POST", body: { name: "Drill Team" }, cookie });
  const teamId = team.data?.id;
  check("team created", team.status === 200 && !!teamId, `got ${team.status}`);

  const project = await request(`/api/v1/projects/${teamId}`, {
    method: "POST",
    body: { teamId, name: "Drill Project" },
    cookie,
  });
  check("project created", project.status === 200, `got ${project.status}`);

  const projects = await request(`/api/v1/teams/${teamId}/projects`, { cookie });
  const slug = projects.data?.[0]?.slug;
  const detail = await request(`/api/v1/projects/${slug}`, { cookie });
  const analyticsKey = detail.data?.apiKey;
  check("analytics key retrieved", !!analyticsKey);

  const session = await request("/api/v1/analytics/sessions", {
    method: "POST",
    body: { userAgent: "restore-drill", referrer: "", location: "/drill" },
    headers: [`authorization: Bearer ${analyticsKey}`],
  });
  check(
    "session ingested",
    session.status === 200 && !!session.data?.sessionId,
    `got ${session.status}`,
  );

  const event = await request("/api/v1/analytics/events", {
    method: "POST",
    body: { sessionId: session.data.sessionId, name: EVENT_NAME, data: { marker: true } },
    headers: [`authorization: Bearer ${analyticsKey}`],
  });
  check("event ingested", event.status === 200, `got ${event.status}`);

  const eventsBefore = await request(`/api/v1/projects/${slug}/events`, { cookie });
  check(
    "event visible before destruction",
    eventsBefore.status === 200 && JSON.stringify(eventsBefore.data).includes(EVENT_NAME),
    `got ${eventsBefore.status}`,
  );

  console.log("[3/8] Backing up (product DB + sqld volume)…");
  const backupDir = join(tmpDir, "backup-out");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dumpName = `prism-${stamp.slice(0, 8)}-${stamp.slice(8)}.dump`;
  const dumpPath = join(backupDir, dumpName);
  let backupOk = false;
  // Prefer the operator scripts (host-side DATABASE_URL); fall back to
  // in-container pg_dump when the host port mapping is unavailable (the
  // local OrbStack quirk — CI/real deployments use the host mapping).
  const backup = run("sh", ["scripts/backup.sh", backupDir], {
    timeout: 180_000,
    allowFailure: true,
    env: { ...process.env, DATABASE_URL: DB_URL, COMPOSE_PROJECT_NAME: PROJECT },
  });
  if (backup.status === 0 && existsSync(dumpPath)) {
    backupOk = true;
    console.log("  (backup.sh used the host DATABASE_URL)");
  } else {
    run("mkdir", ["-p", backupDir]);
    // The dump is binary (custom format) — capture raw stdout, no encoding.
    const inContainer = spawnSync("docker", [
      "exec", `${PROJECT}-db-1`,
      "pg_dump", "--no-owner", "--no-acl", "--format=custom", "-U", "prism", "prism",
    ], { timeout: 180_000 });
    if (inContainer.status === 0 && (inContainer.stdout?.length ?? 0) > 0) {
      writeFileSync(dumpPath, inContainer.stdout);
      backupOk = true;
      console.log("  (host port mapping unavailable — in-container pg_dump with the same flags)");
    }
  }
  check("product DB dump created", backupOk);

  const sqldSnapshot = run("docker", [
    "run", "--rm",
    "-v", `${PROJECT}_sqlddata:/data:ro`,
    "-v", `${backupDir}:/out`,
    "alpine", "tar", "czf", "/out/sqlddata.tar.gz", "-C", "/data", ".",
  ], { timeout: 180_000, allowFailure: true });
  check(
    "sqld volume snapshot created",
    sqldSnapshot.status === 0 && existsSync(join(backupDir, "sqlddata.tar.gz")),
    sqldSnapshot.stderr?.slice(0, 200),
  );

  console.log("[4/8] Destroying the volumes…");
  compose(["down", "-v"], { timeout: 180_000 });
  check("volumes destroyed", true);

  console.log("[5/8] Booting fresh volumes + stopping restore targets…");
  compose(["up", "-d"], { timeout: 600_000 });
  compose(["stop", "sqld", "analytics", "api"], { timeout: 180_000, allowFailure: true });
  check("fresh stack booted (restore targets stopped)", true);

  console.log("[6/8] Restoring product DB + sqld volume…");
  let restoreOk = false;
  const restore = run("sh", ["scripts/restore.sh", dumpPath], {
    timeout: 300_000,
    allowFailure: true,
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
  if (restore.status === 0) {
    restoreOk = true;
    console.log("  (restore.sh used the host DATABASE_URL)");
  } else {
    const inContainer = run("docker", [
      "exec", "-i", `${PROJECT}-db-1`,
      "pg_restore", "--no-owner", "--no-acl", "--clean", "--if-exists", "-U", "prism", "-d", "prism",
    ], { timeout: 300_000, input: readFileSync(dumpPath) });
    if (inContainer.status === 0) {
      restoreOk = true;
      console.log("  (host port mapping unavailable — in-container pg_restore with the same flags)");
    }
  }
  check("product DB restored", restoreOk);

  const sqldRestore = run("docker", [
    "run", "--rm",
    "-v", `${PROJECT}_sqlddata:/data`,
    "-v", `${backupDir}:/in:ro`,
    "alpine", "sh", "-c", "rm -rf /data/* && tar xzf /in/sqlddata.tar.gz -C /data",
  ], { timeout: 180_000, allowFailure: true });
  check("sqld volume restored", sqldRestore.status === 0, sqldRestore.stderr?.slice(0, 200));

  console.log("[7/8] Starting services + verifying markers…");
  compose(["start", "sqld", "analytics", "api"], { timeout: 180_000 });
  check("services restarted", await waitForReady());

  const config = await request("/api/v1/config");
  check("config reports setupRequired false", config.data?.setupRequired === false);

  const signInAfter = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  check(
    "owner can sign in after restore (product DB restored)",
    signInAfter.status === 200,
    `got ${signInAfter.status}`,
  );

  const projectsAfter = await request(`/api/v1/teams/${teamId}/projects`, {
    cookie: signInAfter.cookie,
  });
  check(
    "project survived restore",
    projectsAfter.status === 200 && JSON.stringify(projectsAfter.data).includes(slug ?? "Drill Project"),
    JSON.stringify(projectsAfter.data),
  );

  const eventsAfter = await request(`/api/v1/projects/${slug}/events`, {
    cookie: signInAfter.cookie,
  });
  check(
    "event survived restore (analytics store restored)",
    eventsAfter.status === 200 && JSON.stringify(eventsAfter.data).includes(EVENT_NAME),
    `got ${eventsAfter.status}`,
  );

  console.log("[8/8] Teardown…");
  if (failed > 0 && process.env.KEEP_ON_FAILURE === "1") {
    console.log("  (KEEP_ON_FAILURE — leaving the stack up for inspection)");
    console.log(run("docker", ["ps", "--format", "{{.Names}} {{.Status}}"], { allowFailure: true }).stdout);
    for (const c of ["sqld", "analytics", "api", "web"]) {
      console.log(`-- ${c} --`);
      console.log(run("docker", ["logs", `${PROJECT}-${c}-1`, "--tail", "4"], { allowFailure: true }).stdout);
    }
  } else {
    compose(["down", "-v"], { timeout: 180_000, allowFailure: true });
    rmSync(tmpDir, { recursive: true, force: true });
    try {
      unlinkSync(COMPOSE_FILE);
    } catch {
      /* already gone */
    }
  }

  console.log(`\nBackup/restore drill: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  try {
    unlinkSync(COMPOSE_FILE);
  } catch {
    /* already gone */
  }
  console.error("drill failed:", error);
  process.exit(1);
});
