/**
 * Standard Events real-store integration (task-19 review R1-F5).
 *
 * OPT-IN: these tests hit a REAL libSQL/Turso store and are SKIPPED unless
 * PRISM_RUN_INTEGRATION=1 (with TURSO_DATABASE_URL/TURSO_AUTH_TOKEN pointing
 * at an ISOLATED analytics test database). They never run against the shared
 * development database by default.
 *
 *   PRISM_RUN_INTEGRATION=1 yarn workspace prism-analytics-api test
 *
 * Unlike the mocked IngestController suite, these tests prove REAL
 * persistence: actual table rows, stored (normalized) property JSON,
 * person/identity resolution through external_identities/people, mobile
 * projections, and the complete absence of rows for every rejected
 * protected event — across the three creatable source platforms
 * (web, react-native, server).
 *
 * Rows created by this suite are deleted at the end of each test.
 */
import "./../testEnv.js";
import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { IngestController } from "../../controllers/IngestController.js";

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" &&
  !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

const PROJECT = "itest-std-project-0000-0000-0000-000000000001";
const WEB_SRC = "itest-std-src-web-0000-0000-0000-000000000001";
const RN_SRC = "itest-std-src-rn-00000000-0000-0000-0000-000000000001";
const SRV_SRC = "itest-std-src-srv-00000000-0000-0000-0000-000000000001";

// The mobile installation digest fails closed without a server secret —
// an isolated test store still needs one for the react-native lane.
process.env.ANALYTICS_INSTALLATION_SALT ??= "itest-installation-salt";

function streamOf(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

/** Trusted context values mirror what the key-auth middleware derives. */
function makeCtx(
  body: string,
  sourceId: string,
  platform: "web" | "react-native" | "server",
) {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "application/json"
          : String(body.length),
      raw: { body: streamOf(body) },
    },
    header: () => undefined,
    json: (value: unknown, status?: number) => ({ __json: value, status }),
    get: (name: string) =>
      ({ projectId: PROJECT, sourceId, platform, keyType: "publishable" })[
        name
      ] ?? "",
  } as never;
}

interface IngestBody {
  __json: {
    ok?: boolean;
    results?: Array<{ index: number; id: string; status: string; reason?: string }>;
  };
  status?: number;
}

async function ingest(
  body: string,
  sourceId: string,
  platform: "web" | "react-native" | "server",
): Promise<IngestBody> {
  return (await IngestController.ingest(
    makeCtx(body, sourceId, platform),
  )) as unknown as IngestBody;
}

/** A protected Standard Event batch entry with the exact wire shape. */
function stdEvent(
  key: string,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    eventId: `itest-std-${key}-${Math.random().toString(36).slice(2, 8)}`,
    type: "track",
    occurredAt: Date.now(),
    anonymousId: `itest-std-anon-${Math.random().toString(36).slice(2, 8)}`,
    name: `$prism_${key}`,
    properties: { $standard: { schemaVersion: 1, key, data } },
    ...overrides,
  };
}

function batch(events: unknown[]): string {
  return JSON.stringify({
    schemaVersion: 3,
    sentAt: Date.now(),
    sdk: { name: "@prism-analytics/core", version: "0.0.3" },
    events,
  });
}

/** Open the real store and register the full-suite cleanup. */
function openStore(): { client: Client; cleanup: () => Promise<void> } {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });
  const cleanup = async () => {
    // Canonical events + every projection/identity surface the lane writes.
    for (const table of [
      "events",
      "web_page_views",
      "mobile_screen_views",
      "mobile_app_sessions",
      "mobile_installations",
      "sessions_v2",
      "person_traits",
      "external_identities",
      "anonymous_identities",
      "people",
      "identity_ops",
    ]) {
      await client.execute({
        sql: `DELETE FROM ${table} WHERE project_id = ?`,
        args: [PROJECT],
      });
    }
    client.close();
  };
  return { client, cleanup };
}

run("Standard Events real-store integration (task-19 R1-F5)", () => {
  it("WEB source: identify() + identified sign_up persists with REAL person/identity attribution", async () => {
    if (!enabled) return;
    const { client, cleanup } = openStore();
    try {
      // The documented SDK flow: prism.identify(user.id) then
      // prism.events.signUp(...) — one identify op ships in the same
      // batch as the event, and the event carries the op's anonymousId.
      const userId = `itest-user-web-${Date.now()}`;
      const anonymousId = `itest-std-anon-web-${Date.now()}`;
      const eventId = `itest-std-su-${Date.now()}`;
      const body = JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        sdk: { name: "@prism-analytics/core", version: "0.0.3" },
        identity: [
          {
            opId: `itest-std-op-${Date.now()}`,
            userId,
            anonymousId,
            occurredAt: Date.now(),
          },
        ],
        events: [
          stdEvent("sign_up", { method: "email" }, { eventId, userId, anonymousId }),
        ],
      });
      const result = await ingest(body, WEB_SRC, "web");
      expect(result.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);
      expect(result.__json.ok).toBe(true);

      // The REAL events row: trusted attribution + normalized properties.
      const rows = await client.execute({
        sql: `SELECT id, name, platform, source_id, user_id, person_id, properties
              FROM events WHERE project_id = ? AND id = ?`,
        args: [PROJECT, eventId],
      });
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0] as unknown as {
        name: string;
        platform: string;
        source_id: string;
        user_id: string | null;
        person_id: string | null;
        properties: string;
      };
      expect(row.name).toBe("$prism_sign_up");
      expect(row.platform).toBe("web"); // key-derived, never payload
      expect(row.source_id).toBe(WEB_SRC);
      expect(row.user_id).toBe(userId);
      // persisted properties are the validator's NORMALIZED value
      expect(row.properties).toBe(
        JSON.stringify({
          $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } },
        }),
      );

      // Identity attribution resolved through the REAL identity tables:
      // the durable external link, the person row, the anonymous link,
      // and the event's person all agree on ONE project-scoped person.
      const link = await client.execute({
        sql: "SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = ?",
        args: [PROJECT, userId],
      });
      expect(link.rows).toHaveLength(1);
      const personId = String(
        (link.rows[0] as unknown as { person_id: string }).person_id,
      );
      expect(personId).toBeTruthy();
      const people = await client.execute({
        sql: "SELECT person_id FROM people WHERE project_id = ? AND person_id = ?",
        args: [PROJECT, personId],
      });
      expect(people.rows).toHaveLength(1);
      const anonLink = await client.execute({
        sql: "SELECT person_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id = ?",
        args: [PROJECT, anonymousId],
      });
      expect(anonLink.rows).toHaveLength(1);
      expect(
        String((anonLink.rows[0] as unknown as { person_id: string }).person_id),
      ).toBe(personId);
      expect(row.person_id).toBe(personId);
    } finally {
      await cleanup();
    }
  });

  it("WEB source: anonymous identity-required events are rejected and leave NOTHING behind", async () => {
    if (!enabled) return;
    const { client, cleanup } = openStore();
    try {
      const cases = [
        { key: "sign_up", data: { method: "email" } },
        { key: "login", data: { method: "google" } },
        { key: "logout", data: {} },
      ] as const;
      const anonIds: string[] = [];
      const eventIds: string[] = [];
      for (const { key, data } of cases) {
        const anonId = `itest-std-anon-rej-${key}-${Date.now()}`;
        const eventId = `itest-std-rej-${key}-${Date.now()}`;
        anonIds.push(anonId);
        eventIds.push(eventId);
        const result = await ingest(
          batch([stdEvent(key, data as Record<string, unknown>, { eventId, anonymousId: anonId })]),
          WEB_SRC,
          "web",
        );
        // R1-F1 at the trust boundary: anonymous identity events never persist
        expect(result.__json.results).toEqual([
          { index: 0, id: eventId, status: "rejected", reason: "invalid-standard-event" },
        ]);
      }

      // No canonical event row for ANY rejected submission
      for (const eventId of eventIds) {
        const rows = await client.execute({
          sql: "SELECT id FROM events WHERE project_id = ? AND id = ?",
          args: [PROJECT, eventId],
        });
        expect(rows.rows).toHaveLength(0);
      }
      // No person/identity resolution ran for the rejected anonymous events
      for (const anonId of anonIds) {
        const links = await client.execute({
          sql: "SELECT anonymous_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id = ?",
          args: [PROJECT, anonId],
        });
        expect(links.rows).toHaveLength(0);
      }
      const people = await client.execute({
        sql: "SELECT person_id FROM people WHERE project_id = ?",
        args: [PROJECT],
      });
      expect(people.rows).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it("REACT-NATIVE source: Standard Event persists, and the mobile screen-view projection still works", async () => {
    if (!enabled) return;
    const { client, cleanup } = openStore();
    try {
      const searchId = `itest-std-rn-search-${Date.now()}`;
      const search = await ingest(
        batch([stdEvent("search", { category: "documentation", resultCount: 8 }, { eventId: searchId })]),
        RN_SRC,
        "react-native",
      );
      expect(search.__json.results).toEqual([
        { index: 0, id: searchId, status: "accepted" },
      ]);
      const searchRows = await client.execute({
        sql: "SELECT name, platform, source_id, properties FROM events WHERE project_id = ? AND id = ?",
        args: [PROJECT, searchId],
      });
      expect(searchRows.rows).toHaveLength(1);
      const searchRow = searchRows.rows[0] as unknown as {
        name: string;
        platform: string;
        source_id: string;
        properties: string;
      };
      expect(searchRow.name).toBe("$prism_search");
      expect(searchRow.platform).toBe("react-native");
      expect(searchRow.source_id).toBe(RN_SRC);
      expect(searchRow.properties).toBe(
        JSON.stringify({
          $standard: {
            schemaVersion: 1,
            key: "search",
            data: { category: "documentation", resultCount: 8 },
          },
        }),
      );

      // Existing protected mobile lane does not regress: a real
      // $prism_screen_view persists its projection with a DIGESTED
      // installation (the raw id never reaches storage).
      const sessionId = `itest-std-rn-sess-${Date.now()}`;
      const rawInstallation = `itest-install-${Date.now()}`;
      const screenId = `itest-std-rn-screen-${Date.now()}`;
      const screen = await ingest(
        batch([
          {
            schemaVersion: 3,
            eventId: screenId,
            type: "track",
            occurredAt: Date.now(),
            sessionId,
            anonymousId: `itest-std-anon-rn-${Date.now()}`,
            name: "$prism_screen_view",
            properties: {
              $screen: { name: "Home", navigation: "initial", sequence: 1 },
              $installation: rawInstallation,
            },
          },
        ]),
        RN_SRC,
        "react-native",
      );
      expect(screen.__json.results).toEqual([
        { index: 0, id: screenId, status: "accepted" },
      ]);
      const projections = await client.execute({
        sql: `SELECT session_id, session_sequence, screen_name, navigation,
                     installation_digest, source_id
              FROM mobile_screen_views WHERE project_id = ? AND event_id = ?`,
        args: [PROJECT, screenId],
      });
      expect(projections.rows).toHaveLength(1);
      const projection = projections.rows[0] as unknown as {
        session_id: string;
        session_sequence: number;
        screen_name: string;
        navigation: string;
        installation_digest: string | null;
        source_id: string;
      };
      expect(projection.session_id).toBe(sessionId);
      expect(projection.session_sequence).toBe(1);
      expect(projection.screen_name).toBe("Home");
      expect(projection.navigation).toBe("initial");
      expect(projection.source_id).toBe(RN_SRC);
      // digested, not raw — and never equal to the raw installation id
      expect(projection.installation_digest).toMatch(/^[0-9a-f]{32}$/);
      expect(projection.installation_digest).not.toBe(rawInstallation);
      // the RAW installation id never persists on the event either
      const screenEvent = await client.execute({
        sql: "SELECT properties FROM events WHERE project_id = ? AND id = ?",
        args: [PROJECT, screenId],
      });
      const storedProps = String(
        (screenEvent.rows[0] as unknown as { properties: string }).properties,
      );
      expect(storedProps).not.toContain(rawInstallation);
    } finally {
      await cleanup();
    }
  });

  it("SERVER source: subscription_cancelled with the per-call actor persists with user attribution", async () => {
    if (!enabled) return;
    const { client, cleanup } = openStore();
    try {
      const userId = `itest-user-srv-${Date.now()}`;
      const eventId = `itest-std-srv-${Date.now()}`;
      const effectiveAtMs = Date.now() + 86_400_000;
      const result = await ingest(
        batch([
          stdEvent(
            "subscription_cancelled",
            {
              subscriptionId: "sub_itest_01",
              planId: "pro_monthly",
              reasonCode: "customer_requested",
              effectiveAtMs,
            },
            { eventId, userId },
          ),
        ]),
        SRV_SRC,
        "server",
      );
      expect(result.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);
      const rows = await client.execute({
        sql: "SELECT name, platform, source_id, user_id, properties FROM events WHERE project_id = ? AND id = ?",
        args: [PROJECT, eventId],
      });
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0] as unknown as {
        name: string;
        platform: string;
        source_id: string;
        user_id: string | null;
        properties: string;
      };
      expect(row.name).toBe("$prism_subscription_cancelled");
      expect(row.platform).toBe("server");
      expect(row.source_id).toBe(SRV_SRC);
      expect(row.user_id).toBe(userId);
      expect(row.properties).toBe(
        JSON.stringify({
          $standard: {
            schemaVersion: 1,
            key: "subscription_cancelled",
            data: {
              subscriptionId: "sub_itest_01",
              planId: "pro_monthly",
              reasonCode: "customer_requested",
              effectiveAtMs,
            },
          },
        }),
      );
    } finally {
      await cleanup();
    }
  });

  it("mixed batch on WEB: only valid rows persist — rejected protected events are completely absent", async () => {
    if (!enabled) return;
    const { client, cleanup } = openStore();
    try {
      const userId = `itest-user-mixed-${Date.now()}`;
      const customId = `itest-std-mixed-custom-${Date.now()}`;
      const anonSignUpId = `itest-std-mixed-anonsu-${Date.now()}`;
      const unknownId = `itest-std-mixed-unknown-${Date.now()}`;
      const malformedId = `itest-std-mixed-malformed-${Date.now()}`;
      const loginId = `itest-std-mixed-login-${Date.now()}`;
      const anonSignUpAnon = `itest-std-mixed-anon-${Date.now()}`;

      const result = await ingest(
        batch([
          { ...stdEvent("search", {}), eventId: customId, name: "checkout_completed", properties: { format: "csv" } },
          stdEvent("sign_up", { method: "email" }, { eventId: anonSignUpId, anonymousId: anonSignUpAnon }), // no user
          stdEvent("not_a_catalog_event", {}, { eventId: unknownId }), // unknown protected name
          stdEvent("sign_up", { method: "email", smuggled: true } as Record<string, unknown>, { eventId: malformedId, userId }), // bad schema
          stdEvent("login", { method: "password" }, { eventId: loginId, userId }), // valid
        ]),
        WEB_SRC,
        "web",
      );
      expect(result.__json.results).toEqual([
        { index: 0, id: customId, status: "accepted" },
        { index: 1, id: anonSignUpId, status: "rejected", reason: "invalid-standard-event" },
        { index: 2, id: unknownId, status: "rejected", reason: "unknown-reserved-event" },
        { index: 3, id: malformedId, status: "rejected", reason: "invalid-standard-event" },
        { index: 4, id: loginId, status: "accepted" },
      ]);

      // REAL persistence: exactly the two accepted rows exist
      const allRows = await client.execute({
        sql: "SELECT id, name FROM events WHERE project_id = ?",
        args: [PROJECT],
      });
      expect(allRows.rows).toHaveLength(2);
      const ids = allRows.rows.map((r) => String((r as unknown as { id: string }).id));
      expect(ids).toContain(customId);
      expect(ids).toContain(loginId);
      // every rejected id is completely absent from the store
      for (const rejectedId of [anonSignUpId, unknownId, malformedId]) {
        expect(ids).not.toContain(rejectedId);
      }
      // and no identity resolution ran for the rejected anonymous sign_up
      const anonLinks = await client.execute({
        sql: "SELECT anonymous_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id = ?",
        args: [PROJECT, anonSignUpAnon],
      });
      expect(anonLinks.rows).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});
