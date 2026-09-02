import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { applyPendingMigrations, readMigrationFiles } from "../../../analytics-api/src/database/migrations";
import {
  peopleList,
  personDetail,
  personActivity,
  filteredEvents,
  breakdown,
  honestTotals,
  exportPerson,
  deletePerson,
  personExists,
} from "../utils/peopleStore";
import { personIdForUser, personIdForAnonymous, buildIdentityStatements } from "../../../analytics-api/src/utils/identityResolution";

/**
 * People store tests (task-10 §5): REAL in-memory libSQL with the ACTUAL
 * migrations — every read is exercised against the production schema,
 * including EXPLAIN QUERY PLAN verification for the justified indexes.
 */
let client: Client;

const PROJECT = "itest-people-project";
const OTHER = "itest-other-project";

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  await applyPendingMigrations(client, readMigrationFiles());

  // representative data: 3 people across two projects
  const now = Date.now();
  const insert = async (projectId: string, personId: string, events: number, sessionIds: string[], userId?: string, anonId?: string) => {
    await client.execute({
      sql: "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      args: [personId, projectId, now - 10_000, now],
    });
    for (let i = 0; i < events; i += 1) {
      await client.execute({
        sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, session_id, anonymous_id, user_id, person_id, properties, context, sdk_name, sdk_version)
              VALUES (?, ?, 'track', 'page_viewed', 3, ?, ?, ?, ?, ?, ?, '{}', '{}', NULL, NULL)`,
        args: [
          `${projectId}-ev-${personId}-${i}`,
          projectId,
          now - i,
          now - i,
          sessionIds[i % Math.max(sessionIds.length, 1)] ?? null,
          anonId ?? null,
          userId ?? null,
          personId,
        ],
      });
    }
  };

  const u1 = personIdForUser(PROJECT, "user-1");
  const u2 = personIdForUser(PROJECT, "user-2");
  const a1 = personIdForAnonymous(PROJECT, "anon-1");
  const a2 = personIdForAnonymous(PROJECT, "anon-2");
  await insert(PROJECT, u1, 5, ["sess-1", "sess-2"], "user-1", "anon-1");
  await insert(PROJECT, u2, 2, ["sess-3"], "user-2");
  await insert(PROJECT, a1, 1, ["sess-4"], undefined, "anon-1");
  // an anonymous-only person that is NEVER linked (stays anonymous)
  await insert(PROJECT, a2, 1, ["sess-5"], undefined, "anon-2");
  await insert(OTHER, personIdForUser(OTHER, "user-1"), 9, ["other-sess"], "user-1");

  // traits + links via the real identity statements
  await client.batch(
    buildIdentityStatements(PROJECT, {
      opId: "op-test-1",
      userId: "user-1",
      anonymousId: "anon-1",
      traits: { plan: "pro", company: "acme" },
      occurredAt: now,
    }, now).map((s) => ({ sql: s.sql, args: s.args as never })) as never,
    "write",
  );
  await client.execute({
    sql: "INSERT INTO external_identities (project_id, user_id, person_id, linked_at) VALUES (?, ?, ?, ?)",
    args: [PROJECT, "user-2", u2, now],
  });
});

describe("people list", () => {
  it("returns bounded, project-scoped people with honest counts", async () => {
    const result = await peopleList(client, PROJECT, {});
    expect(result.people.length).toBe(2);
    const byId = new Map(result.people.map((p) => [p.personId, p]));
    const user1 = byId.get(personIdForUser(PROJECT, "user-1"));
    // the linked anonymous history was reassigned to the known person
    expect(user1?.eventCount).toBe(6); // 5 + the linked anon-1 event
    expect(user1?.sessionCount).toBe(3); // DISTINCT sessions, not events
    expect(user1?.primaryExternalId).toBe("user-1");
    expect(user1?.externalIdentityCount).toBe(1);
    expect(user1?.anonymousIdentityCount).toBe(1);
    expect(user1?.traits).toMatchObject({ plan: "pro", company: "acme" });
    // Anonymous-only subjects remain analytics data, not People rows.
    expect(byId.has(personIdForAnonymous(PROJECT, "anon-2"))).toBe(false);
    // the OTHER project's people never leak
    expect(byId.has(personIdForUser(OTHER, "user-1"))).toBe(false);
  });

  it("paginates with keyset cursors without loading the project", async () => {
    const page1 = await peopleList(client, PROJECT, { limit: 1 });
    expect(page1.people.length).toBe(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await peopleList(client, PROJECT, { limit: 1, cursor: page1.nextCursor ?? undefined });
    expect(page2.people.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set([...page1.people, ...page2.people].map((p) => p.personId));
    expect(ids.size).toBe(2); // no overlap, no loss
  });

  it("returns honest identified, active, new, and anonymous summary counts", async () => {
    const now = Date.now();
    const result = await peopleList(client, PROJECT, {
      from: now - 60_000,
      to: now + 1,
      range: "30d",
    });

    expect(result.summary).toMatchObject({
      range: "30d",
      identifiedPeople: 2,
      activePeople: 2,
      newPeople: 2,
      anonymousPeople: 1,
    });
    expect(result.summary.from).toBe(now - 60_000);
    expect(result.summary.to).toBe(now + 1);
  });

  it("searches by EXACT external id only", async () => {
    const hit = await peopleList(client, PROJECT, { searchUserId: "user-1" });
    expect(hit.people.map((p) => p.personId)).toEqual([personIdForUser(PROJECT, "user-1")]);
    const miss = await peopleList(client, PROJECT, { searchUserId: "user" }); // no prefix/fuzzy
    expect(miss.people).toHaveLength(0);
  });

  it("searches by an exact indexed safe trait", async () => {
    const hit = await peopleList(client, PROJECT, { searchTrait: { key: "plan", value: "pro" } });
    expect(hit.people.map((p) => p.personId)).toEqual([personIdForUser(PROJECT, "user-1")]);
  });
});

describe("person detail + activity", () => {
  it("returns traits and all linked identities", async () => {
    const person = await personDetail(client, PROJECT, personIdForUser(PROJECT, "user-1"));
    expect(person?.externalIds).toEqual(["user-1"]);
    expect(person?.anonymousIds).toEqual(["anon-1"]);
    expect(person?.traits).toMatchObject({ company: "acme" });
    expect(await personDetail(client, PROJECT, "u_missing")).toBeNull();
  });

  it("returns a bounded chronological activity timeline", async () => {
    const events = await personActivity(client, PROJECT, personIdForUser(PROJECT, "user-1"), 2);
    expect(events.length).toBe(2);
    expect(events[0]?.receivedAt).toBeGreaterThanOrEqual(events[1]?.receivedAt ?? 0);
  });
});

describe("filters, breakdowns, totals", () => {
  it("filters events by date range, name, person, and session", async () => {
    const now = Date.now();
    const byName = await filteredEvents(client, PROJECT, { name: "page_viewed" });
    expect(byName.length).toBe(9);
    const byPerson = await filteredEvents(client, PROJECT, {
      personId: personIdForUser(PROJECT, "user-2"),
    });
    expect(byPerson.length).toBe(2);
    const bySession = await filteredEvents(client, PROJECT, { sessionId: "sess-1" });
    expect(bySession.length).toBe(3);
    // generous window: the seed's timestamps are relative to beforeAll
    const byDate = await filteredEvents(client, PROJECT, { from: now - 60_000, to: now + 1 });
    expect(byDate.length).toBeGreaterThan(0);
  });

  it("filters by a safe property value", async () => {
    // an event with a property
    await client.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, person_id, properties, sdk_name, sdk_version)
            VALUES ('prop-ev', ?, 'track', 'checkout', 3, ?, ?, ?, '{"tier":"gold"}', NULL, NULL)`,
      args: [PROJECT, Date.now(), Date.now(), personIdForUser(PROJECT, "user-1")],
    });
    const hit = await filteredEvents(client, PROJECT, {
      propertyKey: "tier",
      propertyValue: "gold",
    });
    expect(hit.map((e) => e.id)).toContain("prop-ev");
    const miss = await filteredEvents(client, PROJECT, {
      propertyKey: "tier",
      propertyValue: "bronze",
    });
    expect(miss.map((e) => e.id)).not.toContain("prop-ev");
  });

  it("produces bounded breakdowns with honest distinct sessions", async () => {
    const byEvent = await breakdown(client, PROJECT, "event");
    expect(byEvent.rows).toEqual([
      { key: "page_viewed", count: 9 },
      { key: "checkout", count: 1 },
    ]);
    const bySession = await breakdown(client, PROJECT, "session");
    expect(bySession.rows).toHaveLength(5); // distinct sessions
    expect(bySession.rows[0]?.count).toBe(3); // sess-1
  });

  it("keeps the four totals distinct and honest", async () => {
    const totals = await honestTotals(client, PROJECT);
    expect(totals.events).toBe(10); // 5 + 2 + 1 + 1 (anon-2) + 1 (prop-ev)
    // F15: "people" counts KNOWN people (active external identities only);
    // anonymous subjects are reported separately and never double-counted.
    expect(totals.people).toBe(2);
    expect(totals.sessions).toBe(5);
    expect(totals.anonymousIdentities).toBe(2); // anon-1 + anon-2
  });
});

describe("query plans justify the indexes", () => {
  it("uses the person index for person-scoped reads", async () => {
    const plan = await client.execute({
      sql: "EXPLAIN QUERY PLAN SELECT * FROM events WHERE project_id = ? AND person_id = ?",
      args: [PROJECT, personIdForUser(PROJECT, "user-1")],
    });
    expect(JSON.stringify(plan.rows)).toMatch(/USING (COVERING )?INDEX/i);
  });

  it("uses the identity indexes for exact searches", async () => {
    const plan = await client.execute({
      sql: "EXPLAIN QUERY PLAN SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = ?",
      args: [PROJECT, "user-1"],
    });
    expect(JSON.stringify(plan.rows)).toMatch(/USING (COVERING )?INDEX/i);
    const traitPlan = await client.execute({
      sql: "EXPLAIN QUERY PLAN SELECT person_id FROM person_traits WHERE project_id = ? AND key = ? AND value = ?",
      args: [PROJECT, "plan", JSON.stringify("pro")],
    });
    expect(JSON.stringify(traitPlan.rows)).toMatch(/USING (COVERING )?INDEX/i);
  });
});

describe("privacy export + deletion (§6)", () => {
  it("exports documented analytics data only", async () => {
    const exported = await exportPerson(client, PROJECT, personIdForUser(PROJECT, "user-1"));
    expect(exported?.externalIds).toEqual(["user-1"]);
    expect(exported?.anonymousIds).toEqual(["anon-1"]);
    expect(exported?.traits).toMatchObject({ plan: "pro" });
    expect(exported?.sessions.length).toBeGreaterThanOrEqual(3);
    expect(exported?.events.length).toBeGreaterThanOrEqual(6);
    // never contains keys/tokens/raw IPs or other users' data
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("projectKey");
    expect(serialized).not.toContain("user-2");
    await expect(exportPerson(client, PROJECT, "u_missing")).resolves.toBeNull();
  });

  it("deletes a person atomically with idempotent retries", async () => {
    // a fresh anonymous-only person to delete
    const anon = personIdForAnonymous(PROJECT, "anon-delete-me");
    await client.execute({
      sql: "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
      args: [anon, PROJECT, 1, 2],
    });
    await client.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, anonymous_id, person_id, properties, context, sdk_name, sdk_version)
            VALUES ('del-ev', ?, 'track', 'x', 3, 1, 2, 'anon-delete-me', ?, '{}', '{}', NULL, NULL)`,
      args: [PROJECT, anon],
    });

    const first = await deletePerson(client, PROJECT, anon);
    expect(first.deleted).toBe(true);
    // everything is gone: links, traits, events, person
    expect(await personExists(client, PROJECT, anon)).toBe(false);
    const events = await personActivity(client, PROJECT, anon, 10);
    expect(events).toHaveLength(0);

    // idempotent retry: no error, reports not-deleted
    const second = await deletePerson(client, PROJECT, anon);
    expect(second.deleted).toBe(false);
  });

  it("never deletes a person in another project", async () => {
    const other = personIdForUser(OTHER, "user-1");
    const before = await personExists(client, OTHER, other);
    expect(before).toBe(true);
    const result = await deletePerson(client, PROJECT, other);
    expect(result.deleted).toBe(false); // scoped: nothing matched in PROJECT
    expect(await personExists(client, OTHER, other)).toBe(true);
  });
});
