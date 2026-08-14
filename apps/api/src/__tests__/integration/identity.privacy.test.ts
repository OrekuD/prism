/**
 * Identity/privacy e2e integration (task-10 §6): export + deletion against
 * a REAL analytics store (Turso/sqld).
 *
 * OPT-IN like the other integration suites: PRISM_RUN_INTEGRATION=1 +
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN pointing at an ISOLATED store.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { applyPendingMigrations, readMigrationFiles } from "../../../../analytics-api/src/database/migrations";
import { buildIdentityStatements, personIdForUser } from "../../../../analytics-api/src/utils/identityResolution";
import { exportPerson, deletePerson, personExists } from "../../utils/peopleStore";

config({ path: ".dev.vars" });

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" && !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

const PROJECT = "e2e-privacy-project";
const OTHER = "e2e-other-project";

run("identity privacy e2e (§6)", () => {
  it("exports, deletes, and never silently restores deleted history", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });
    const clean = async () => {
      await client.batch(
        [
          "DELETE FROM events",
          "DELETE FROM external_identities",
          "DELETE FROM anonymous_identities",
          "DELETE FROM person_traits",
          "DELETE FROM identity_ops",
          "DELETE FROM people",
        ].map((sql) => ({ sql })),
        "write",
      );
    };
    const userId = `e2e-user-${Date.now()}`;
    const personId = personIdForUser(PROJECT, userId);

    try {
      await applyPendingMigrations(client, readMigrationFiles());
      await clean();

      // identify with traits + an event
      await client.batch(
        buildIdentityStatements(PROJECT, {
          opId: `op-${Date.now()}`,
          userId,
          anonymousId: "e2e-anon",
          traits: { plan: "pro" },
        }, Date.now()) as never,
        "write",
      );
      await client.execute({
        sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, user_id, person_id, properties, context, sdk_name, sdk_version)
              VALUES (?, ?, 'track', 'page_viewed', 3, ?, ?, ?, ?, '{}', '{}', NULL, NULL)`,
        args: [`ev-${Date.now()}`, PROJECT, Date.now(), Date.now(), userId, personId],
      });

      const exported = await exportPerson(client, PROJECT, personId);
      expect(exported).not.toBeNull();
      expect(exported?.externalIds).toEqual([userId]);
      expect(exported?.traits).toMatchObject({ plan: "pro" });
      expect(exported?.events.length).toBe(1);

      // an event lands BETWEEN export and delete (deletion during ingestion)
      await client.execute({
        sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, user_id, person_id, properties, context, sdk_name, sdk_version)
              VALUES (?, ?, 'track', 'late_event', 3, ?, ?, ?, ?, '{}', '{}', NULL, NULL)`,
        args: [`late-${Date.now()}`, PROJECT, Date.now(), Date.now(), userId, personId],
      });

      const deleted = await deletePerson(client, PROJECT, personId);
      expect(deleted.deleted).toBe(true);
      expect(await personExists(client, PROJECT, personId)).toBe(false);
      expect(await exportPerson(client, PROJECT, personId)).toBeNull();

      // repeated deletion is a safe no-op
      expect((await deletePerson(client, PROJECT, personId)).deleted).toBe(false);

      // a FUTURE identify with the SAME userId creates a NEW person with
      // a clean slate — deleted history never silently returns
      await client.batch(
        buildIdentityStatements(PROJECT, {
          opId: `op2-${Date.now()}`,
          userId,
          anonymousId: "e2e-anon-2",
          traits: { plan: "enterprise" },
        }, Date.now()) as never,
        "write",
      );
      const fresh = await exportPerson(client, PROJECT, personId);
      expect(fresh).not.toBeNull();
      expect(fresh?.events).toHaveLength(0); // no resurrected history
      expect(fresh?.traits).toMatchObject({ plan: "enterprise" });

      // cross-project isolation: deleting in PROJECT never touches OTHER
      await client.batch(
        buildIdentityStatements(OTHER, {
          opId: `op3-${Date.now()}`,
          userId: "other-user",
          anonymousId: "other-anon",
          traits: {},
        }, Date.now()) as never,
        "write",
      );
      const otherPerson = personIdForUser(OTHER, "other-user");
      await deletePerson(client, PROJECT, otherPerson);
      expect(await personExists(client, OTHER, otherPerson)).toBe(true);
    } finally {
      await clean();
      client.close();
    }
  }, 60_000);
});
