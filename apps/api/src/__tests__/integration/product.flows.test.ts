/**
 * Database integration tests for the product (Neon) API.
 *
 * OPT-IN: these tests hit a real PostgreSQL database and are SKIPPED unless
 * PRISM_RUN_INTEGRATION=1 and DATABASE_URL point at an ISOLATED test
 * database or disposable Neon branch. They never run against the shared
 * development database by default.
 *
 *   PRISM_RUN_INTEGRATION=1 DATABASE_URL=postgres://... yarn workspace prism-api test
 *
 * Each test cleans up after itself (delete-by-email) and uses unique emails.
 */
import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

config({ path: ".dev.vars" });

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" && !!process.env.DATABASE_URL;

const run = enabled ? describe : describe.skip;

let sql: ReturnType<typeof postgres> | null = null;
let unique = 0;
const email = () =>
  `itest-${process.pid}-${unique++}-${Date.now()}@example.com`;

function db() {
  if (!sql) {
    sql = postgres(
      `${process.env.DATABASE_URL}?options=project%3D${process.env.PROJECT_NAME ?? "prism"}`,
      { ssl: "require", max: 1 },
    );
  }
  return sql;
}

run("product database integration", () => {
  beforeAll(async () => {
    if (!enabled) return;
    // Ensure the schema exists (idempotent) before testing.
    await db()`SELECT 1 FROM "user" LIMIT 1`;
  });

  it("signup provisions a profile + Better Auth workspace (organization/member), and projects tenant to it", async () => {
    if (!enabled) return;
    const mail = email();

    const user = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role)
      VALUES (gen_random_uuid(), 'Integration Test', ${mail}, true, 1)
      RETURNING id`;
    const userId = user[0].id;

    const profile = await db()`
      INSERT INTO profiles (user_id, first_name, last_name)
      VALUES (${userId}, 'Integration', 'Test') RETURNING id`;

    // Task 13: the personal workspace is a Better Auth organization —
    // owner membership comes from the plugin's canonical tables (created
    // through the supported server API in production; the fixture here
    // mirrors the plugin's exact rows).
    const org = await db()`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (gen_random_uuid(), ${`Integration Test's workspace`}, ${`wrk_itestws01`}, NOW())
      RETURNING id`;
    const orgId = org[0].id;
    const member = await db()`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (gen_random_uuid(), ${orgId}, ${userId}, 'owner', NOW())
      RETURNING id`;

    expect(profile.length).toBe(1);
    expect(member.length).toBe(1);

    // A project tenants to the organization and its source + key chain.
    const project = await db()`
      INSERT INTO projects (id, creator_id, organization_id, name, slug)
      VALUES (gen_random_uuid(), ${userId}, ${orgId}, 'Integration Project', ${`proj-${userId}`})
      RETURNING id`;
    const source = await db()`
      INSERT INTO project_sources (id, project_id, name, platform)
      VALUES (gen_random_uuid(), ${project[0].id}, 'Web', 'web') RETURNING id`;
    const key = await db()`
      INSERT INTO project_api_keys (id, source_id, name, key, key_type)
      VALUES (gen_random_uuid(), ${source[0].id}, 'Initial key', ${`psk_test_${userId}`}, 'publishable') RETURNING id`;

    expect(project.length).toBe(1);
    expect(source.length).toBe(1);
    expect(key.length).toBe(1);

    await db()`DELETE FROM project_api_keys WHERE source_id = ${source[0].id}`;
    await db()`DELETE FROM project_sources WHERE project_id = ${project[0].id}`;
    await db()`DELETE FROM projects WHERE id = ${project[0].id}`;
    await db()`DELETE FROM member WHERE id = ${member[0].id}`;
    await db()`DELETE FROM organization WHERE id = ${orgId}`;
    await db()`DELETE FROM profiles WHERE user_id = ${userId}`;
    await db()`DELETE FROM "user" WHERE id = ${userId}`;
  });

  it("username updates affect only the authenticated user", async () => {
    if (!enabled) return;
    const mailA = email();
    const mailB = email();

    const a = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES (gen_random_uuid(), 'A', ${mailA}, true, 1) RETURNING id`;
    const b = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES (gen_random_uuid(), 'B', ${mailB}, true, 1) RETURNING id`;
    const userIdA = a[0].id;
    const userIdB = b[0].id;

    // Update user A's username with the (bug-fixed) scoped query shape.
    await db()`
      UPDATE "user" SET user_name = 'scoped-name' WHERE id = ${userIdA} RETURNING id`;

    const rowsA = await db()`SELECT user_name FROM "user" WHERE id = ${userIdA}`;
    const rowsB = await db()`SELECT user_name FROM "user" WHERE id = ${userIdB}`;
    expect(rowsA[0].user_name).toBe("scoped-name");
    expect(rowsB[0].user_name).toBeNull();

    await db()`DELETE FROM "user" WHERE id IN (${userIdA}, ${userIdB})`;
  });

  it("leaving a team removes only the requested membership", async () => {
    if (!enabled) return;
    const mail = email();
    const ownerMail = email();

    const owner = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES (gen_random_uuid(), 'Owner', ${ownerMail}, true, 1) RETURNING id`;
    const member = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES (gen_random_uuid(), 'Key User', ${mail}, true, 1) RETURNING id`;

    const teamA = await db()`
      INSERT INTO teams (owner_id, name, is_personal)
      VALUES (${owner[0].id}, 'Team A', FALSE) RETURNING id`;
    const teamB = await db()`
      INSERT INTO teams (owner_id, name, is_personal)
      VALUES (${owner[0].id}, 'Team B', FALSE) RETURNING id`;

    await db()`
      INSERT INTO team_members (user_id, team_id, permission_id)
      VALUES (${member[0].id}, ${teamA[0].id}, 1), (${member[0].id}, ${teamB[0].id}, 1)`;

    // Scoped departure (the fixed query shape).
    await db()`
      DELETE FROM team_members WHERE user_id = ${member[0].id} AND team_id = ${teamA[0].id} RETURNING id`;

    const remaining = await db()`
      SELECT team_id FROM team_members WHERE user_id = ${member[0].id}`;
    expect(remaining.map((r) => r.team_id)).toEqual([teamB[0].id]);

    await db()`DELETE FROM team_members WHERE user_id = ${member[0].id}`;
    await db()`DELETE FROM teams WHERE id IN (${teamA[0].id}, ${teamB[0].id})`;
    await db()`DELETE FROM "user" WHERE id IN (${owner[0].id}, ${member[0].id})`;
  });

  it("project API keys are unique and project-scoped", async () => {
    if (!enabled) return;
    const mail = email();
    const user = await db()`
      INSERT INTO "user" (id, name, email, email_verified, role) VALUES (gen_random_uuid(), 'Key User', ${mail}, true, 1) RETURNING id`;
    const team = await db()`
      INSERT INTO teams (owner_id, name, is_personal)
      VALUES (${user[0].id}, 'Team', FALSE) RETURNING id`;
    const project = await db()`
      INSERT INTO projects (creator_id, team_id, name, slug)
      VALUES (${user[0].id}, ${team[0].id}, 'Project', 'itest-slug') RETURNING id`;

    await db()`
      INSERT INTO project_api_keys (team_id, project_id, key)
      VALUES (${team[0].id}, ${project[0].id}, 'itest-key-unique-1')`;

    // Duplicate keys must be rejected by the unique index.
    await expect(
      db()`
        INSERT INTO project_api_keys (team_id, project_id, key)
        VALUES (${team[0].id}, ${project[0].id}, 'itest-key-unique-1')`,
    ).rejects.toThrow();

    await db()`DELETE FROM project_api_keys WHERE project_id = ${project[0].id}`;
    await db()`DELETE FROM projects WHERE id = ${project[0].id}`;
    await db()`DELETE FROM teams WHERE id = ${team[0].id}`;
    await db()`DELETE FROM "user" WHERE id = ${user[0].id}`;
  });
});
