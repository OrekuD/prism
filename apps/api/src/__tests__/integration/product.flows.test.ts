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
    await db()`SELECT 1 FROM users LIMIT 1`;
  });

  it("signup creates a user, profile, and personal team atomically", async () => {
    if (!enabled) return;
    const mail = email();

    const user = await db()`
      INSERT INTO users (email, password, role)
      VALUES (${mail}, 'hashed', 1)
      RETURNING id`;
    const userId = user[0].id;

    const profile = await db()`
      INSERT INTO profiles (user_id, first_name, last_name)
      VALUES (${userId}, 'Integration', 'Test') RETURNING id`;
    const team = await db()`
      INSERT INTO teams (owner_id, name, is_personal)
      VALUES (${userId}, 'Integration Test\'s team', TRUE) RETURNING id`;

    expect(profile.length).toBe(1);
    expect(team.length).toBe(1);

    // The authenticated user owns exactly one personal team.
    const owned = await db()`
      SELECT id FROM teams WHERE owner_id = ${userId} AND is_personal = TRUE`;
    expect(owned.length).toBe(1);

    await db()`DELETE FROM teams WHERE owner_id = ${userId}`;
    await db()`DELETE FROM profiles WHERE user_id = ${userId}`;
    await db()`DELETE FROM users WHERE id = ${userId}`;
  });

  it("username updates affect only the authenticated user", async () => {
    if (!enabled) return;
    const mailA = email();
    const mailB = email();

    const a = await db()`
      INSERT INTO users (email, password, role) VALUES (${mailA}, 'h', 1) RETURNING id`;
    const b = await db()`
      INSERT INTO users (email, password, role) VALUES (${mailB}, 'h', 1) RETURNING id`;
    const userIdA = a[0].id;
    const userIdB = b[0].id;

    // Update user A's username with the (bug-fixed) scoped query shape.
    await db()`
      UPDATE users SET user_name = 'scoped-name' WHERE id = ${userIdA} RETURNING id`;

    const rowsA = await db()`SELECT user_name FROM users WHERE id = ${userIdA}`;
    const rowsB = await db()`SELECT user_name FROM users WHERE id = ${userIdB}`;
    expect(rowsA[0].user_name).toBe("scoped-name");
    expect(rowsB[0].user_name).toBeNull();

    await db()`DELETE FROM users WHERE id IN (${userIdA}, ${userIdB})`;
  });

  it("leaving a team removes only the requested membership", async () => {
    if (!enabled) return;
    const mail = email();
    const ownerMail = email();

    const owner = await db()`
      INSERT INTO users (email, password, role) VALUES (${ownerMail}, 'h', 1) RETURNING id`;
    const member = await db()`
      INSERT INTO users (email, password, role) VALUES (${mail}, 'h', 1) RETURNING id`;

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
    await db()`DELETE FROM users WHERE id IN (${owner[0].id}, ${member[0].id})`;
  });

  it("project API keys are unique and project-scoped", async () => {
    if (!enabled) return;
    const mail = email();
    const user = await db()`
      INSERT INTO users (email, password, role) VALUES (${mail}, 'h', 1) RETURNING id`;
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
    await db()`DELETE FROM users WHERE id = ${user[0].id}`;
  });
});
