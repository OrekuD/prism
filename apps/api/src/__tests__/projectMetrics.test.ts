import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import {
  personIdForAnonymous,
  personIdForUser,
  identityClaimStatement,
  identityMutationStatements,
} from "../../../analytics-api/src/utils/identityResolution";
import { peopleList } from "../utils/peopleStore";
import {
  MetricFactSchema,
  isSnapshotReplayable,
  type MetricFact,
  type ProjectCapabilities,
} from "@prism-analytics/types";
import {
  capabilityShortfall,
  clearMetricSnapshotCache,
  errorIssueStateCounts,
  formatMetricValue,
  measureMetrics,
  parseMetricRange,
  resolveMetricWindow,
  resolveProjectCapabilities,
  validateMetricRequest,
  factIdFor,
  MetricQueryError,
  type CanonicalClient,
  type MetricWindow,
} from "../utils/projectMetrics";

/**
 * Canonical metric service tests (Task 21 slice 2): REAL in-memory libSQL
 * with the ACTUAL analytics migrations. Every aggregate reads production
 * SQL against the production schema — time boundaries, late arrivals,
 * snapshot cutoffs, source filters, cross-source uniqueness, currencies,
 * archived sources, and project isolation are all exercised, not mocked.
 */

const NOW = 1_785_628_800_000;
const SPAN = 7 * 86_400_000;
const FROM = NOW - SPAN;
const CFROM = FROM - SPAN;
const P = "proj_metrics";
const PX = "proj_other";
const W = "src_web";
const S = "src_server";
const M = "src_mob";

let client: Client;

async function exec(sql: string, args: Array<string | number | null> = []) {
  await client.execute({ sql, args });
}

function stdProps(key: string, data?: Record<string, unknown>) {
  return JSON.stringify({
    $standard: { schemaVersion: 1, key, data: data ?? {} },
  });
}

async function seedEvent(row: {
  id: string;
  project?: string;
  name?: string;
  occurred: number;
  received?: number;
  session?: string | null;
  person?: string | null;
  anon?: string | null;
  source?: string | null;
  platform?: string | null;
  properties?: string;
}) {
  await exec(
    `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
      received_at, session_id, anonymous_id, user_id, person_id, properties,
      context, sdk_name, sdk_version, source_id, platform)
     VALUES (?, ?, 'track', ?, 1, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?)`,
    [
      row.id,
      row.project ?? P,
      row.name ?? "click",
      row.occurred,
      row.received ?? row.occurred,
      row.session ?? null,
      row.anon ?? null,
      row.person ?? null,
      row.properties ?? "{}",
      row.source ?? W,
      row.platform ?? "web",
    ],
  );
}

const WINDOW: MetricWindow = {
  from: FROM,
  to: NOW,
  compareFrom: CFROM,
  compareTo: FROM,
  asOf: NOW,
};

// Resolver-shaped identities (R3-F3): anonymous traffic carries
// deterministic `a_*` person IDs exactly as ingestion stores them —
// `person_id IS NULL` never marks anonymous subjects.
const P1 = personIdForUser(P, "u1");
const P2 = personIdForUser(P, "u2");
const P_NEW = personIdForUser(P, "u_new");
const A1 = personIdForAnonymous(P, "anon1");
const AM = personIdForAnonymous(P, "m_anon1");
const A_LATE = personIdForAnonymous(P, "late");
const A2 = personIdForAnonymous(P, "anon2");

const CAPABILITIES: ProjectCapabilities = {
  web: true,
  mobile: true,
  server: true,
  errorCollection: { configured: true, observed: true },
  standardEventsObserved: ["sign_up", "purchase", "refund"],
  sources: { total: 3, active: 3, lastReceivedAt: NOW - 1 },
  trafficPolicy: "human",
};

async function measure(
  requests: Array<{
    metricId: string;
    filters?: Record<string, never> | Record<string, string | string[]>;
  }>,
  window: MetricWindow = WINDOW,
  capabilities: ProjectCapabilities = CAPABILITIES,
  memo?: Map<string, unknown>,
) {
  // R4-F1: the shared snapshot scope is explicit. Derive it from the
  // batch's own filters so scoped reads carry `selected` (even when the
  // narrowed list is empty) and unfiltered reads carry `all`.
  const firstExplicit = requests.find(
    (request) =>
      (request as { filters?: { sourceIds?: unknown } }).filters?.sourceIds !==
      undefined,
  ) as { filters?: { sourceIds?: string[] } } | undefined;
  const scope =
    firstExplicit?.filters?.sourceIds !== undefined
      ? {
          sourceScope: "selected" as const,
          sourceIds: [...(firstExplicit.filters.sourceIds ?? [])],
        }
      : { sourceScope: "all" as const, sourceIds: [] as string[] };
  return measureMetrics(
    client as unknown as CanonicalClient,
    P,
    window,
    scope,
    requests as never,
    { capabilities, memo, now: NOW },
  );
}

function factById(facts: MetricFact[], id: string): MetricFact {
  const found = facts.find((fact) => fact.id === id);
  if (!found) throw new Error(`missing fact ${id}`);
  return found;
}

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  await applyPendingMigrations(client, readMigrationFiles());

  // --- baseline events: boundaries, late arrivals, previous, isolation ---
  await seedEvent({
    id: "e1",
    occurred: FROM,
    session: "s1",
    person: P1,
    anon: "au1",
  });
  await seedEvent({ id: "e2", occurred: NOW - 1, session: "s1", person: P1 });
  await seedEvent({ id: "e3", occurred: NOW, session: "s1", person: P1 }); // excluded: to boundary
  await seedEvent({
    id: "e4",
    occurred: FROM + 1000,
    received: NOW + 5000,
    person: P1,
  }); // excluded: late arrival
  await seedEvent({ id: "e5", occurred: CFROM, session: "s0", person: P1 }); // previous window
  await seedEvent({ id: "e6", project: PX, occurred: FROM + 10, person: P1 }); // other project
  await seedEvent({
    id: "e7",
    occurred: FROM + 2000,
    session: "s2",
    person: P1,
    source: S,
    platform: "server",
  });
  await seedEvent({
    id: "e8",
    occurred: FROM + 3000,
    session: "s3",
    person: A1,
    anon: "anon1",
  });
  await seedEvent({
    id: "e9",
    occurred: CFROM + 100,
    person: A1,
    anon: "anon1",
  });
  // Later identification: link lands after the snapshot (see below).
  await seedEvent({ id: "e10", occurred: FROM + 13000, person: A_LATE });
  // Second anonymous subject on another source.
  await seedEvent({
    id: "e11",
    occurred: FROM + 14000,
    person: A2,
    anon: "anon2",
    source: S,
    platform: "server",
  });
  // Identified newcomer with real activity (keeps parity honest).
  await seedEvent({ id: "e12", occurred: FROM + 15000, person: P_NEW });

  // --- standard events ---
  const signUp = (
    id: string,
    occurred: number,
    person: string | null,
    extra = {},
  ) =>
    seedEvent({
      id,
      name: "$prism_sign_up",
      occurred,
      person,
      properties: stdProps("sign_up"),
      ...extra,
    });
  await signUp("su1", FROM + 4000, P1);
  await signUp("su2", FROM + 5000, P2);
  await signUp("su3", CFROM + 200, P1);
  await seedEvent({
    id: "bad1",
    name: "$prism_sign_up",
    occurred: FROM + 9000,
    person: P1,
    properties: "{}",
  }); // malformed legacy: counts as event, never as sign_up
  const purchase = (
    id: string,
    occurred: number,
    valueMinor: number,
    currency: string,
    person = P1,
  ) =>
    seedEvent({
      id,
      name: "$prism_purchase",
      occurred,
      person,
      properties: stdProps("purchase", {
        valueMinor,
        currency,
        transactionId: `t-${id}`,
      }),
    });
  await purchase("pu1", FROM + 6000, 1000, "USD");
  await purchase("pu2", FROM + 7000, 2000, "EUR", P2);
  await purchase("pu3", CFROM + 300, 400, "USD");
  await purchase("pu4", CFROM + 350, 700, "GBP");
  await seedEvent({
    id: "rf1",
    name: "$prism_refund",
    occurred: FROM + 8000,
    person: P1,
    properties: stdProps("refund", {
      valueMinor: 500,
      currency: "USD",
      refundId: "r-1",
      transactionId: "t-pu1",
    }),
  });

  // --- identity links: resolver-shaped persons, one link after the snapshot ---
  await exec(
    "INSERT INTO external_identities (project_id, user_id, person_id, linked_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
    [
      P,
      "u1",
      P1,
      CFROM - 1000,
      P,
      "u2",
      P2,
      FROM + 4500,
      P,
      "u_new",
      P_NEW,
      FROM + 5000,
      P,
      "u_late",
      A_LATE,
      NOW + 5000,
    ],
  );

  // --- people rows for the Task-20 parity check (last_seen mirrors activity) ---
  const personRow = (personId: string, firstSeen: number, lastSeen: number) =>
    exec(
      "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
      [personId, P, firstSeen, lastSeen],
    );
  await personRow(P1, CFROM - 1000, NOW - 1);
  await personRow(P2, FROM + 4500, NOW - 2);
  await personRow(P_NEW, FROM + 5000, FROM + 15000);
  await personRow(A1, CFROM + 100, FROM + 3000);
  await personRow(AM, FROM + 11100, FROM + 12100);
  await personRow(A_LATE, FROM + 13000, FROM + 13000);
  await personRow(A2, FROM + 14000, FROM + 14000);

  // --- sessions_v2 ---
  const session = (
    id: string,
    started: number,
    source: string | null,
    project = P,
  ) =>
    exec(
      `INSERT INTO sessions_v2 (session_id, project_id, anonymous_id, started_at, ended_at, last_seen_at, context, is_online, source_id, platform)
       VALUES (?, ?, 'a', ?, NULL, ?, NULL, 0, ?, 'web')`,
      [id, project, started, started, source],
    );
  await session("s1", FROM + 100, W);
  await session("s2", FROM + 200, S);
  await session("s0", CFROM + 50, W);
  await session("s9", NOW, W); // excluded: started_at boundary
  await session("sx", FROM + 150, W, PX);

  // --- web analytics ---
  const pageView = (
    eventId: string,
    occurred: number,
    host: string,
    path: string,
    isBot: number,
    person: string | null,
    session: string,
  ) =>
    seedEvent({
      id: eventId,
      name: "$prism_page_view",
      occurred,
      person,
      session,
    });
  await pageView("w1", FROM + 10000, "example.com", "/a", 0, P1, "s1");
  await pageView("w2", FROM + 11000, "example.com", "/b", 0, P1, "s4");
  await pageView("w3", FROM + 12000, "example.com", "/a", 1, P2, "s5");
  await pageView("w0", CFROM + 400, "example.com", "/a", 0, P1, "s0");
  const pv = (
    eventId: string,
    occurred: number,
    host: string,
    path: string,
    isBot: number,
    seq: number,
  ) =>
    exec(
      `INSERT INTO web_page_views (project_id, event_id, occurred_at, host, path, navigation_type, page_sequence, is_bot)
       VALUES (?, ?, ?, ?, ?, 'initial', ?, ?)`,
      [P, eventId, occurred, host, path, seq, isBot],
    );
  await pv("w1", FROM + 10000, "example.com", "/a", 0, 1);
  await pv("w2", FROM + 11000, "example.com", "/b", 0, 1);
  await pv("w3", FROM + 12000, "example.com", "/a", 1, 1);
  await pv("w0", CFROM + 400, "example.com", "/a", 0, 1);

  // --- mobile analytics ---
  await exec(
    `INSERT INTO mobile_app_sessions (project_id, session_id, source_id, installation_digest, started_at, last_active_at, foreground_active_ms, screen_count, app_version, os)
     VALUES (?, 'm1', ?, 'd1', ?, ?, 60000, 5, '1.0', 'ios'),
            (?, 'm2', ?, 'd2', ?, ?, 0, 3, '1.0', 'android'),
            (?, 'm0', ?, 'd1', ?, ?, 30000, 2, '0.9', 'ios')`,
    [
      P,
      M,
      FROM + 11000,
      FROM + 11500,
      P,
      M,
      FROM + 12000,
      FROM + 12100,
      P,
      M,
      CFROM + 500,
      CFROM + 600,
    ],
  );
  await exec(
    `INSERT INTO mobile_installations (project_id, installation_digest, source_id, first_seen_at, last_seen_at, last_os, last_app_version)
     VALUES (?, 'd1', ?, ?, ?, 'ios', '1.0'), (?, 'd2', ?, ?, ?, 'android', '1.0')`,
    [P, M, CFROM + 400, NOW - 100, P, M, FROM + 12000, FROM + 12100],
  );
  await seedEvent({
    id: "se1",
    name: "$prism_screen_view",
    occurred: FROM + 11100,
    session: "m1",
    person: AM,
    anon: "m_anon1",
    source: M,
    platform: "react-native",
  });
  await seedEvent({
    id: "se2",
    name: "$prism_screen_view",
    occurred: FROM + 11200,
    session: "m1",
    person: AM,
    anon: "m_anon1",
    source: M,
    platform: "react-native",
  });
  await seedEvent({
    id: "se3",
    name: "$prism_screen_view",
    occurred: FROM + 12100,
    session: "m2",
    person: AM,
    anon: "m_anon1",
    source: M,
    platform: "react-native",
  });
  const sv = (
    eventId: string,
    occurred: number,
    sess: string,
    digest: string,
    os: string,
    screenName: string,
    version: string,
  ) =>
    exec(
      `INSERT INTO mobile_screen_views (project_id, event_id, occurred_at, session_id, session_sequence, screen_name, navigation, source_id, os, app_version, installation_digest)
       VALUES (?, ?, ?, ?, 1, ?, 'initial', ?, ?, ?, ?)`,
      [P, eventId, occurred, sess, screenName, M, os, version, digest],
    );
  await sv("se1", FROM + 11100, "m1", "d1", "ios", "Home", "1.0");
  await sv("se2", FROM + 11200, "m1", "d1", "ios", "Home", "1.0");
  await sv("se3", FROM + 12100, "m2", "d2", "android", "Settings", "1.0");

  // --- error tracking ---
  const issue = (
    id: string,
    platform: string,
    status: string,
    firstSeen: number,
    firstRelease: string | null,
    lastRelease: string | null,
  ) =>
    exec(
      `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
       VALUES (?, ?, ?, 1, ?, 'error', ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        id,
        P,
        platform,
        `fp-${id}`,
        status,
        `Title ${id}`,
        firstSeen,
        NOW - 1,
        firstRelease,
        lastRelease,
      ],
    );
  await issue("iss_new", "web", "unresolved", FROM + 100, "2.4.1", "2.4.1");
  await issue(
    "iss_reg",
    "react-native",
    "unresolved",
    CFROM + 50,
    "2.3.0",
    "2.4.1",
  );
  await issue(
    "iss_dec",
    "server",
    "unresolved",
    CFROM - 1000,
    "2.2.0",
    "2.3.0",
  );
  await issue("iss_res", "web", "resolved", CFROM + 60, "2.3.0", "2.3.0");
  const occ = (
    id: string,
    issueId: string,
    occurred: number,
    handled: number,
    anon: string | null,
    platform: string,
    release: string | null,
    source = W,
  ) =>
    exec(
      `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, 'error', ?, ?, ?, ?, 'production', ?, '{}')`,
      [
        id,
        `c-${id}`,
        issueId,
        P,
        source,
        platform,
        handled,
        occurred,
        occurred,
        release,
        anon,
      ],
    );
  await occ("o1", "iss_new", FROM + 100, 1, "e_a1", "web", "2.4.1");
  await occ("o2", "iss_new", FROM + 200, 1, "e_a1", "web", "2.4.1");
  await occ("o3", "iss_new", FROM + 300, 1, "e_a1", "web", "2.4.1");
  await occ("o4", "iss_reg", FROM + 400, 1, "e_a2", "react-native", "2.4.1", S);
  await occ("o5", "iss_reg", FROM + 500, 0, "e_a2", "react-native", "2.4.1", S);
  await occ("o6", "iss_reg", FROM + 600, 0, "e_a2", "react-native", "2.4.1", S);
  await occ("o7", "iss_reg", FROM + 700, 0, "e_a2", "react-native", "2.4.1", S);
  await occ("o8", "iss_reg", FROM + 800, 0, "e_a2", "react-native", "2.4.1", S);
  await occ("o9", "iss_dec", FROM + 900, 0, "e_a3", "server", null, S);
  await occ("o10", "iss_res", FROM + 950, 1, "e_a4", "web", "2.3.0");
  await occ("o11", "iss_res", FROM + 960, 1, "e_a4", "web", "2.3.0");
  await occ(
    "p1",
    "iss_reg",
    CFROM + 100,
    0,
    "e_a0",
    "react-native",
    "2.3.0",
    S,
  );
  await occ(
    "p2",
    "iss_reg",
    CFROM + 200,
    0,
    "e_a0",
    "react-native",
    "2.3.0",
    S,
  );
  for (let i = 0; i < 5; i += 1) {
    await occ(
      `d${i}`,
      "iss_dec",
      CFROM + 300 + i,
      0,
      "e_a5",
      "server",
      "2.2.0",
      S,
    );
  }
  await occ("r1", "iss_res", CFROM + 400, 1, "e_a6", "web", "2.3.0");
}, 60000);

describe("canonical event and session aggregates", () => {
  it("counts accepted events with half-open boundaries and snapshot cutoff", async () => {
    const facts = await measure([{ metricId: "project.accepted_events" }]);
    // e1 e2 e7 e8 e10 e11 e12 su1 su2 pu1 pu2 rf1 bad1 (13)
    // + w1 w2 w3 (3) + se1 se2 se3 (3) = 19.
    // e3 (to boundary), e4 (late arrival), e5/e9/su3/pu3/pu4/w0 (previous),
    // e6 (other project) excluded.
    const fact = factById(facts, "project.accepted_events");
    expect(fact.value).toBe(19);
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 216.7,
    });
  });

  it("filters events by source without leaking other sources", async () => {
    const facts = await measure([
      { metricId: "project.accepted_events", filters: { sourceIds: [W] } },
    ]);
    const fact = factById(facts, "project.accepted_events");
    // excludes e7/e11 (server) and se1..se3 (mobile): 19 - 2 - 3 = 14.
    expect(fact.value).toBe(14);
    expect(fact.filters).toEqual({ sourceId: W, sourceScope: "selected" });
    expect(fact.queryContext.sourceScope).toBe("selected");
    expect(fact.queryContext.sourceIds).toEqual([W]);
  });

  it("counts sessions started in range from sessions_v2", async () => {
    const facts = await measure([{ metricId: "project.sessions" }]);
    const fact = factById(facts, "project.sessions");
    expect(fact.value).toBe(2); // s1, s2 (s9 starts at `to`; s0 previous; sx other project)
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 100,
    });
  });

  it("excludes sessions starting after a historical snapshot", async () => {
    const facts = await measure([{ metricId: "project.sessions" }], {
      ...WINDOW,
      asOf: FROM + 150,
    });
    expect(factById(facts, "project.sessions").value).toBe(1); // only s1
  });
});

describe("canonical people aggregates", () => {
  it("counts identified people once across sources", async () => {
    const facts = await measure([{ metricId: "project.active_people" }]);
    const fact = factById(facts, "project.active_people");
    expect(fact.value).toBe(3); // P1 (web+server), P2, P_NEW — never double-counted
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 200,
    });
  });

  it("counts first links in range as new, prior-zero as new comparison", async () => {
    const facts = await measure([{ metricId: "project.new_people" }]);
    const fact = factById(facts, "project.new_people");
    expect(fact.value).toBe(2); // p2, p_new
    expect(fact.comparison).toEqual({ kind: "new" });
  });

  it("keeps anonymous subjects separate from identified people", async () => {
    const facts = await measure([{ metricId: "project.active_anonymous" }]);
    const fact = factById(facts, "project.active_anonymous");
    expect(fact.value).toBe(4); // A1, AM, A_LATE, A2 — subjects, not proven humans
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 300,
    });
  });
});

describe("canonical standard event aggregates", () => {
  it("counts occurrences and people for one exact key", async () => {
    const facts = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "sign_up" },
      },
    ]);
    expect(factById(facts, factIdFor("standard_event.occurrences", { standardEventKey: "sign_up" })).value).toBe(2); // bad1 never counts
    const people = await measure([
      {
        metricId: "standard_event.people",
        filters: { standardEventKey: "sign_up" },
      },
    ]);
    expect(factById(people, factIdFor("standard_event.people", { standardEventKey: "sign_up" })).value).toBe(2);
  });

  it("returns one fact per currency, never converted", async () => {
    const facts = await measure([
      {
        metricId: "standard_event.value_by_currency",
        filters: { standardEventKey: "purchase" },
      },
    ]);
    expect(facts.map((fact) => fact.id).sort()).toEqual([
      "standard_event.value_by_currency:EUR",
      "standard_event.value_by_currency:GBP",
      "standard_event.value_by_currency:USD",
    ]);
    expect(factById(facts, "standard_event.value_by_currency:USD").value).toBe(
      1000,
    );
    expect(factById(facts, "standard_event.value_by_currency:EUR").value).toBe(
      2000,
    );
    expect(factById(facts, "standard_event.value_by_currency:USD").unit).toBe(
      "USD",
    );
    expect(
      factById(facts, "standard_event.value_by_currency:USD").formattedValue,
    ).toBe("$10.00");
    expect(
      factById(facts, "standard_event.value_by_currency:EUR").comparison,
    ).toEqual({ kind: "new" });
    expect(
      factById(facts, "standard_event.value_by_currency:USD").comparison,
    ).toMatchObject({
      kind: "percent",
      percent: 150,
    });
    // Previous-only currency: current zero with a complete drop, not silence.
    expect(factById(facts, "standard_event.value_by_currency:GBP").value).toBe(
      0,
    );
    expect(
      factById(facts, "standard_event.value_by_currency:GBP").comparison,
    ).toMatchObject({ kind: "percent", direction: "down", percent: -100 });
  });

  it("narrows value rows by exact currency", async () => {
    const facts = await measure([
      {
        metricId: "standard_event.value_by_currency",
        filters: { standardEventKey: "purchase", currency: "EUR" },
      },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.value).toBe(2000);
  });
});

describe("canonical fact identity and comparison basis (R8-F2, R8-F3)", () => {
  it("gives each Standard Event key its own stable fact ID", async () => {
    const first = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "sign_up" },
      },
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "purchase" },
      },
    ]);
    expect(first).toHaveLength(2);
    const ids = first.map((fact) => fact.id).sort();
    expect(ids).toEqual([
      "standard_event.occurrences:purchase",
      "standard_event.occurrences:sign_up",
    ]);
    expect(first.find((fact) => fact.id.endsWith(":sign_up"))?.value).toBe(2);
    expect(first.find((fact) => fact.id.endsWith(":purchase"))?.value).toBe(2);
    // Stable across repeated reads.
    const second = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "sign_up" },
      },
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "purchase" },
      },
    ]);
    expect(second.map((fact) => fact.id).sort()).toEqual(ids);
    clearMetricSnapshotCache();
  });

  it("digests unbounded filters instead of interpolating them", async () => {
    const a = await measure([
      { metricId: "web.page_views", filters: { host: "a.example.com" } },
    ]);
    const b = await measure([
      { metricId: "web.page_views", filters: { host: "b.example.com" } },
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.id).not.toBe(b[0]?.id);
    expect(a[0]?.id).not.toContain("a.example.com");
    expect(a[0]?.id).toMatch(/^web\.page_views:f[0-9a-f]{12}$/);
    const again = await measure([
      { metricId: "web.page_views", filters: { host: "a.example.com" } },
    ]);
    expect(again[0]?.id).toBe(a[0]?.id);
    clearMetricSnapshotCache();
  });

  it("carries the exact basis on count and bounce facts", async () => {
    const counts = await measure([{ metricId: "project.accepted_events" }]);
    const accepted = factById(counts, "project.accepted_events");
    expect(accepted.comparisonBasis.previousValue).not.toBeNull();
    const web = await measure([
      { metricId: "web.page_views" },
      { metricId: "web.bounce_rate" },
    ]);
    const bounce = factById(web, "web.bounce_rate");
    expect(bounce.comparisonBasis.denominatorCurrent).not.toBeNull();
    expect(bounce.comparisonBasis.denominatorPrevious).not.toBeNull();
    expect(typeof bounce.comparisonBasis.previousValue).toBe("number");
    // Comparison-supported null claims stay null-based.
    const states = await measure([{ metricId: "errors.unresolved_issues" }]);
    expect(
      factById(states, "errors.unresolved_issues").comparisonBasis,
    ).toEqual({
      previousValue: null,
      denominatorCurrent: null,
      denominatorPrevious: null,
    });
    clearMetricSnapshotCache();
  });
});

describe("canonical web facts reuse task-17 definitions", () => {
  it("maps totals and comparisons without recomputing them", async () => {
    const facts = await measure([
      { metricId: "web.page_views" },
      { metricId: "web.visitors" },
      { metricId: "web.sessions" },
      { metricId: "web.views_per_session" },
      { metricId: "web.bounce_rate" },
      { metricId: "web.excluded_bots" },
    ]);
    expect(factById(facts, "web.page_views").value).toBe(2); // human traffic: w3 bot excluded
    expect(factById(facts, "web.page_views").comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 100,
    });
    expect(factById(facts, "web.visitors").value).toBe(1); // p1 only (w3 bot view still person p2? no: bot excluded → visitors 1)
    expect(factById(facts, "web.sessions").value).toBe(2);
    expect(factById(facts, "web.views_per_session").value).toBe(1);
    // Week-old single-view sessions are complete and bounced: an honest 100.
    expect(factById(facts, "web.bounce_rate").value).toBe(100);
    expect(factById(facts, "web.bounce_rate").comparison).toMatchObject({
      kind: "percent",
      direction: "flat",
    });
    expect(factById(facts, "web.excluded_bots").value).toBe(1); // measured under all-traffic by definition
    expect(factById(facts, "web.excluded_bots").comparison).toBeNull();
  });

  it("counts excluded bots under all-traffic reads", async () => {
    const facts = await measure([{ metricId: "web.excluded_bots" }]);
    expect(factById(facts, "web.excluded_bots").value).toBe(1);
  });
});

describe("canonical mobile facts reuse task-18 definitions", () => {
  it("maps app opens, visitors, sessions, and installations", async () => {
    const facts = await measure([
      { metricId: "mobile.app_opens" },
      { metricId: "mobile.visitors" },
      { metricId: "mobile.sessions" },
      { metricId: "mobile.screens_per_session" },
      { metricId: "mobile.foreground_duration" },
      { metricId: "mobile.observed_installations" },
    ]);
    expect(factById(facts, "mobile.app_opens").value).toBe(2);
    expect(factById(facts, "mobile.app_opens").comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 100,
    });
    expect(factById(facts, "mobile.visitors").value).toBe(2); // d1, d2
    expect(factById(facts, "mobile.sessions").value).toBe(2);
    expect(factById(facts, "mobile.screens_per_session").value).toBe(4); // (5+3)/2
    expect(factById(facts, "mobile.foreground_duration").value).toBe(30000);
    expect(factById(facts, "mobile.observed_installations").value).toBe(2);
  });

  it("narrows mobile facts by runtime OS", async () => {
    const facts = await measure([
      { metricId: "mobile.app_opens", filters: { os: "ios" } },
    ]);
    expect(factById(facts, factIdFor("mobile.app_opens", { os: "ios" })).value).toBe(1);
    expect(factById(facts, factIdFor("mobile.app_opens", { os: "ios" })).filters).toEqual({
      os: "ios",
      sourceScope: "all",
    });
  });
});

describe("canonical error aggregates", () => {
  it("counts occurrences, states, identities, and handling", async () => {
    const facts = await measure([
      { metricId: "errors.occurrences" },
      { metricId: "errors.unresolved_issues" },
      { metricId: "errors.new_issues" },
      { metricId: "errors.regressing_issues" },
      { metricId: "errors.affected_identities" },
      { metricId: "errors.handled" },
      { metricId: "errors.unhandled" },
    ]);
    expect(factById(facts, "errors.occurrences").value).toBe(11);
    expect(factById(facts, "errors.occurrences").comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 37.5,
    });
    expect(factById(facts, "errors.unresolved_issues").value).toBe(3);
    expect(factById(facts, "errors.unresolved_issues").comparison).toBeNull();
    expect(factById(facts, "errors.new_issues").value).toBe(1);
    // iss_reg growing plus iss_res (resolved but growing again) — the
    // issueDelta rule counts both, matching the Errors page.
    expect(factById(facts, "errors.regressing_issues").value).toBe(2);
    expect(factById(facts, "errors.affected_identities").value).toBe(4); // e_a1..e_a4
    expect(factById(facts, "errors.handled").value).toBe(6);
    expect(factById(facts, "errors.unhandled").value).toBe(5);
  });

  it("filters occurrences by platform and release", async () => {
    const facts = await measure([
      { metricId: "errors.occurrences", filters: { platform: "web" } },
    ]);
    expect(factById(facts, factIdFor("errors.occurrences", { platform: "web" })).value).toBe(5); // iss_new 3 + iss_res 2
    const release = await measure([
      { metricId: "errors.occurrences", filters: { release: "2.4.1" } },
    ]);
    expect(factById(release, factIdFor("errors.occurrences", { release: "2.4.1" })).value).toBe(8);
  });

  it("maps release filters to first/last release for state counts", async () => {
    const fresh = await measure([
      { metricId: "errors.new_issues", filters: { release: "2.4.1" } },
    ]);
    expect(factById(fresh, factIdFor("errors.new_issues", { release: "2.4.1" })).value).toBe(1);
    const none = await measure([
      { metricId: "errors.new_issues", filters: { release: "9.9" } },
    ]);
    expect(factById(none, factIdFor("errors.new_issues", { release: "9.9" })).value).toBe(0);
    const unresolved = await measure([
      { metricId: "errors.unresolved_issues", filters: { platform: "web" } },
    ]);
    expect(factById(unresolved, factIdFor("errors.unresolved_issues", { platform: "web" })).value).toBe(1); // iss_new only
  });

  it("resolves state counts directly", async () => {
    const states = await errorIssueStateCounts(
      client as unknown as CanonicalClient,
      P,
      FROM,
      NOW,
      CFROM,
      FROM,
      NOW,
      {},
    );
    expect(states).toEqual({ unresolved: 3, fresh: 1, regressing: 2 });
  });
});

describe("parity, caching, and execution discipline", () => {
  it("returns byte-equivalent facts for overview and agent adapters", async () => {
    const requests = [
      { metricId: "project.accepted_events" },
      { metricId: "web.page_views" },
      { metricId: "errors.occurrences" },
    ] as never;
    const overviewFacts = await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      WINDOW,
      [],
      requests,
      { capabilities: CAPABILITIES, memo: new Map(), now: NOW },
    );
    const agentFacts = await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      WINDOW,
      [],
      requests,
      { capabilities: CAPABILITIES, memo: new Map(), now: NOW },
    );
    expect(agentFacts).toEqual(overviewFacts);
  });

  it("serves repeat snapshots from cache without touching the store", async () => {
    clearMetricSnapshotCache();
    let executions = 0;
    const counting: CanonicalClient = {
      execute: async (input) => {
        executions += 1;
        return client.execute(input);
      },
    };
    const requests = [{ metricId: "project.accepted_events" }];
    await measureMetrics(counting, P, WINDOW, [], requests, {
      capabilities: CAPABILITIES,
      now: NOW,
    });
    expect(executions).toBeGreaterThan(0);
    executions = 0;
    const replay = await measureMetrics(counting, P, WINDOW, [], requests, {
      capabilities: CAPABILITIES,
      now: NOW + 1000,
    });
    expect(executions).toBe(0);
    expect(replay[0]?.value).toBe(19);
    // A different snapshot re-queries.
    executions = 0;
    await measureMetrics(
      counting,
      P,
      { ...WINDOW, asOf: NOW + 1000 },
      [],
      requests,
      {
        capabilities: CAPABILITIES,
        now: NOW + 1000,
      },
    );
    expect(executions).toBeGreaterThan(0);
    clearMetricSnapshotCache();
  });

  it("never runs analytics reads concurrently", async () => {
    clearMetricSnapshotCache();
    let active = 0;
    let maximum = 0;
    const tracking: CanonicalClient = {
      execute: async (input) => {
        active += 1;
        maximum = Math.max(maximum, active);
        try {
          return await client.execute(input);
        } finally {
          active -= 1;
        }
      },
    };
    await measureMetrics(
      tracking,
      P,
      WINDOW,
      [],
      [
        { metricId: "project.accepted_events" },
        { metricId: "project.sessions" },
        { metricId: "web.page_views" },
        { metricId: "mobile.app_opens" },
        { metricId: "errors.occurrences" },
      ],
      { capabilities: CAPABILITIES, memo: new Map(), now: NOW },
    );
    expect(maximum).toBe(1);
    clearMetricSnapshotCache();
  });

  it("validates every measured fact against the frozen schema", async () => {
    clearMetricSnapshotCache();
    const facts = await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      WINDOW,
      [],
      [
        { metricId: "project.accepted_events" },
        { metricId: "project.sessions" },
        { metricId: "project.active_people" },
        { metricId: "project.new_people" },
        { metricId: "project.active_anonymous" },
        {
          metricId: "standard_event.occurrences",
          filters: { standardEventKey: "sign_up" },
        },
        {
          metricId: "standard_event.value_by_currency",
          filters: { standardEventKey: "purchase" },
        },
        { metricId: "web.page_views" },
        { metricId: "web.bounce_rate" },
        { metricId: "mobile.app_opens" },
        { metricId: "errors.occurrences" },
        { metricId: "errors.unresolved_issues" },
      ] as never,
      { capabilities: CAPABILITIES, memo: new Map(), now: NOW },
    );
    expect(facts.length).toBeGreaterThan(12);
    for (const fact of facts) {
      expect(MetricFactSchema.safeParse(fact).success).toBe(true);
    }
    clearMetricSnapshotCache();
  });
});

describe("request validation and capability gating", () => {
  it("rejects unknown metrics, filters, and missing keys before SQL", () => {
    expect(() =>
      validateMetricRequest({ metricId: "funnel.rate" }),
    ).toThrowError(MetricQueryError);
    expect(() =>
      validateMetricRequest({
        metricId: "project.sessions",
        filters: { os: "ios" },
      }),
    ).toThrowError(/does not support filter/);
    expect(() =>
      validateMetricRequest({ metricId: "standard_event.occurrences" }),
    ).toThrowError(/requires filter/);
    expect(() =>
      validateMetricRequest({
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "$prism_sign_up" },
      }),
    ).toThrowError(/Invalid metric query/);
    expect(() =>
      validateMetricRequest({
        metricId: "standard_event.value_by_currency",
        filters: { standardEventKey: "purchase", currency: "usd" },
      }),
    ).toThrowError(/ISO 4217/);
    expect(() =>
      validateMetricRequest({
        metricId: "web.page_views",
        filters: { bogus: "x" } as never,
      }),
    ).toThrowError(/Unrecognized key/);
  });

  it("rejects duplicates, oversized IDs, and unbounded requests", () => {
    expect(() =>
      validateMetricRequest({
        metricId: "project.accepted_events",
        filters: { sourceIds: ["a", "a"] },
      }),
    ).toThrowError(/duplicates/);
    expect(() =>
      validateMetricRequest({
        metricId: "project.accepted_events",
        filters: { sourceIds: new Array(65).fill("s") },
      }),
    ).toThrowError(MetricQueryError);
    expect(() =>
      validateMetricRequest({
        metricId: "project.accepted_events",
        filters: { sourceIds: ["x".repeat(129)] },
      }),
    ).toThrowError(MetricQueryError);
    // Release bound aligned with ingestion (R7-F6, max 128).
    expect(() =>
      validateMetricRequest({
        metricId: "errors.occurrences",
        filters: { release: "x".repeat(129) },
      }),
    ).toThrowError(MetricQueryError);
    expect(() =>
      validateMetricRequest({
        metricId: "errors.occurrences",
        filters: { release: "x".repeat(128) },
      }),
    ).not.toThrow();
    // 64 unique IDs are the documented maximum and validate cleanly.
    expect(() =>
      validateMetricRequest({
        metricId: "project.accepted_events",
        filters: { sourceIds: new Array(64).fill(0).map((_, i) => `s${i}`) },
      }),
    ).not.toThrow();
  });

  it("returns explicit unsupported facts when capabilities are missing", async () => {
    const empty: ProjectCapabilities = {
      web: false,
      mobile: false,
      server: false,
      errorCollection: { configured: false, observed: false },
      standardEventsObserved: [],
      sources: { total: 0, active: 0, lastReceivedAt: null },
      trafficPolicy: "human",
    };
    const facts = await measure(
      [{ metricId: "web.page_views" }],
      WINDOW,
      empty,
    );
    expect(facts[0]?.value).toBeNull();
    expect(facts[0]?.coverageNote).toMatch(/Web source/);
    // Capability-free project metrics still measure.
    const events = await measure(
      [{ metricId: "project.accepted_events" }],
      WINDOW,
      empty,
    );
    expect(events[0]?.value).toBe(19);
  });

  it("resolves capabilities from configured sources", () => {
    const capabilities = resolveProjectCapabilities({
      sources: [
        { platform: "web", active: true, lastReceivedAt: 100 },
        { platform: "ios", active: false, lastReceivedAt: null },
        { platform: "server", active: true, lastReceivedAt: 200 },
      ],
      errorConfigured: false,
      errorObserved: true,
      standardEventsObserved: ["sign_up", "bogus_key"],
    });
    expect(capabilities.web).toBe(true);
    expect(capabilities.mobile).toBe(true); // future-native feeds Mobile
    expect(capabilities.server).toBe(true);
    expect(capabilities.sources).toEqual({
      total: 3,
      active: 2,
      lastReceivedAt: 200,
    });
    expect(capabilities.errorCollection).toEqual({
      configured: false,
      observed: true,
    });
    expect(capabilities.standardEventsObserved).toEqual(["sign_up"]);
  });

  it("reports shortfalls per metric", () => {
    const empty: ProjectCapabilities = {
      web: false,
      mobile: false,
      server: false,
      errorCollection: { configured: false, observed: false },
      standardEventsObserved: [],
      sources: { total: 0, active: 0, lastReceivedAt: null },
      trafficPolicy: "human",
    };
    expect(capabilityShortfall("web.page_views", CAPABILITIES)).toBeNull();
    expect(capabilityShortfall("web.page_views", empty)).toMatch(/Web source/);
    expect(capabilityShortfall("errors.occurrences", empty)).toMatch(
      /error collection/,
    );
    expect(capabilityShortfall("project.accepted_events", empty)).toBeNull();
  });
});

describe("pure helpers", () => {
  it("parses ranges and resolves windows", () => {
    expect(parseMetricRange("7d")).toBe("7d");
    expect(parseMetricRange("century")).toBeNull();
    expect(parseMetricRange(null)).toBeNull();
    const window = resolveMetricWindow(NOW, "7d");
    expect(window).toEqual({
      from: FROM,
      to: NOW,
      compareFrom: CFROM,
      compareTo: FROM,
      asOf: NOW,
    });
  });

  it("formats every value kind honestly", () => {
    expect(formatMetricValue("count", 1234)).toEqual({
      formattedValue: "1,234",
      unit: null,
    });
    expect(formatMetricValue("decimal", 2.5)).toEqual({
      formattedValue: "2.5",
      unit: null,
    });
    expect(formatMetricValue("duration-ms", 340)).toEqual({
      formattedValue: "340ms",
      unit: "ms",
    });
    expect(formatMetricValue("duration-ms", 1500)).toEqual({
      formattedValue: "1.5s",
      unit: "ms",
    });
    expect(formatMetricValue("rate", 12.5)).toEqual({
      formattedValue: "12.5%",
      unit: "%",
    });
    expect(formatMetricValue("money-minor", 1000, "USD")).toEqual({
      formattedValue: "$10.00",
      unit: "USD",
    });
    // Zero-decimal currencies are never divided.
    expect(
      formatMetricValue("money-minor", 1000, "JPY").formattedValue,
    ).toContain("1,000");
    expect(formatMetricValue("money-minor", 1000, "XX")).toEqual({
      formattedValue: "10.00 XX",
      unit: "XX",
    });
  });

  it("returns flat zeros for empty projects, never infinity", async () => {
    const facts = await measureMetrics(
      client as unknown as CanonicalClient,
      "proj_nothing",
      WINDOW,
      [],
      [
        { metricId: "errors.occurrences" },
        { metricId: "project.accepted_events" },
      ],
      { capabilities: CAPABILITIES, now: NOW },
    );
    expect(factById(facts, "errors.occurrences").value).toBe(0);
    expect(factById(facts, "errors.occurrences").comparison).toEqual({
      kind: "percent",
      direction: "flat",
      percent: 0,
    });
  });
});

describe("explicit empty source scope (R3-F1)", () => {
  it("returns honest zeros instead of widening to all sources", async () => {
    const facts = await measure([
      { metricId: "errors.occurrences", filters: { sourceIds: [] } },
    ]);
    const fact = factById(facts, "errors.occurrences");
    expect(fact.value).toBe(0);
    expect(fact.comparison).toEqual({
      kind: "percent",
      direction: "flat",
      percent: 0,
    });
    expect(fact.coverageNote).toMatch(/No requested sources/);
  });

  it("keeps explicit-currency value reads single-fact over empty scope", async () => {
    const one = await measure([
      {
        metricId: "standard_event.value_by_currency",
        filters: {
          standardEventKey: "purchase",
          currency: "USD",
          sourceIds: [],
        },
      },
    ]);
    expect(one).toHaveLength(1);
    expect(one[0]?.value).toBe(0);
    const none = await measure([
      {
        metricId: "standard_event.value_by_currency",
        filters: { standardEventKey: "purchase", sourceIds: [] },
      },
    ]);
    expect(none).toEqual([]);
  });
});

describe("snapshot-aware identity (R3-F3)", () => {
  it("classifies by links at asOf: late identification stays anonymous", async () => {
    // At NOW the u_late link (NOW+5000) hasn't happened: A_LATE counts
    // anonymous and is excluded from identified people.
    const active = await measure([{ metricId: "project.active_people" }]);
    expect(factById(active, "project.active_people").value).toBe(3);
    // After the link lands, the same events read as identified.
    const later = await measure([{ metricId: "project.active_people" }], {
      ...WINDOW,
      asOf: NOW + 10000,
    });
    expect(factById(later, "project.active_people").value).toBe(4);
    const anonLater = await measure(
      [{ metricId: "project.active_anonymous" }],
      { ...WINDOW, asOf: NOW + 10000 },
    );
    expect(factById(anonLater, "project.active_anonymous").value).toBe(3);
  });

  it("agrees with the Task-20 People summary for the same identity state", async () => {
    const window = { ...WINDOW, asOf: NOW + 10000 };
    // Sequential: one analytics client, one flight at a time.
    const activeFacts = await measure(
      [{ metricId: "project.active_people" }],
      window,
    );
    const newFacts = await measure(
      [{ metricId: "project.new_people" }],
      window,
    );
    const anonFacts = await measure(
      [{ metricId: "project.active_anonymous" }],
      window,
    );
    const active = factById(activeFacts, "project.active_people").value;
    const fresh = factById(newFacts, "project.new_people").value;
    const anon = factById(anonFacts, "project.active_anonymous").value;
    const list = await peopleList(client as never, P, {
      from: FROM,
      to: NOW,
      range: "7d",
    });
    expect(active).toBe(list.summary.activePeople);
    expect(fresh).toBe(list.summary.newPeople);
    expect(anon).toBe(list.summary.anonymousPeople);
  });
});

describe("standard event currency accuracy (R3-F4)", () => {
  it("scopes occurrences by exact currency", async () => {
    const usd = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "purchase", currency: "USD" },
      },
    ]);
    expect(factById(usd, factIdFor("standard_event.occurrences", { standardEventKey: "purchase", currency: "USD" })).value).toBe(1); // pu1 only
    const eur = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "purchase", currency: "EUR" },
      },
    ]);
    expect(factById(eur, factIdFor("standard_event.occurrences", { standardEventKey: "purchase", currency: "EUR" })).value).toBe(1);
    // Sign-up rows carry no currency: a currency filter matches nothing.
    const none = await measure([
      {
        metricId: "standard_event.occurrences",
        filters: { standardEventKey: "sign_up", currency: "USD" },
      },
    ]);
    expect(factById(none, factIdFor("standard_event.occurrences", { standardEventKey: "sign_up", currency: "USD" })).value).toBe(0);
  });

  it("always returns one fact for an explicit currency, even empty", async () => {
    const facts = await measure([
      {
        metricId: "standard_event.value_by_currency",
        filters: { standardEventKey: "purchase", currency: "JPY" },
      },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.value).toBe(0);
    expect(facts[0]?.comparison).toEqual({
      kind: "percent",
      direction: "flat",
      percent: 0,
    });
  });
});

describe("currency overflow and response bounds (R3-F4)", () => {
  it("caps currency rows deterministically with a warning", async () => {
    const FX = "proj_fx";
    const codes = [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "CHF",
      "CAD",
      "AUD",
      "NZD",
      "SEK",
      "NOK",
      "MXN",
    ];
    for (const [index, currency] of codes.entries()) {
      await exec(
        `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
          received_at, session_id, anonymous_id, user_id, person_id, properties,
          context, sdk_name, sdk_version, source_id, platform)
         VALUES (?, ?, 'track', '$prism_refund', 1, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, 's', 'server')`,
        [
          `fx${index}`,
          FX,
          FROM + index,
          FROM + index,
          JSON.stringify({
            $standard: {
              schemaVersion: 1,
              key: "refund",
              data: {
                valueMinor: 100,
                currency,
                refundId: `r${index}`,
                transactionId: `t${index}`,
              },
            },
          }),
        ],
      );
    }
    const facts = await measureMetrics(
      client as unknown as CanonicalClient,
      FX,
      WINDOW,
      [],
      [
        {
          metricId: "standard_event.value_by_currency",
          filters: { standardEventKey: "refund" },
        },
      ],
      { capabilities: CAPABILITIES, now: NOW },
    );
    expect(facts).toHaveLength(10);
    expect(facts.map((fact) => fact.id.split(":")[1]).sort()).toEqual(
      [...codes].sort().slice(0, 10),
    );
    expect(
      facts.some((fact) =>
        fact.coverage.warnings.some((warning) =>
          warning.includes("capped at 10"),
        ),
      ),
    ).toBe(true);
  });

  it("holds the 27-fact resource bound across metrics", async () => {
    const { capResponseFacts } = await import("../utils/projectMetrics");
    const base = {
      metricId: "project.accepted_events",
      definitionVersion: 1,
      label: "Accepted events",
      value: 1,
      formattedValue: "1",
      unit: null,
      comparison: null,
      queryContext: {
        from: FROM,
        to: NOW,
        compareFrom: CFROM,
        compareTo: FROM,
        asOf: NOW,
        timezone: "UTC",
        sourceScope: "all",
        sourceIds: [],
        definitionVersion: 1,
      },
      coverage: {
        sourcesConfigured: 1,
        sourcesActive: 1,
        enrichments: [],
        warnings: [],
      },
      coverageNote: "",
      filters: {},
      drilldown: { destination: "events", label: "Open Events" },
    } as const;
    const singles = new Array(26)
      .fill(0)
      .map((_, index) => ({ ...base, id: `m${index}` }));
    const multis = ["EUR", "GBP", "USD"].map((currency) => ({
      ...base,
      id: `standard_event.value_by_currency:${currency}`,
      metricId: "standard_event.value_by_currency",
    }));
    const capped = capResponseFacts([...singles, ...multis] as never);
    expect(capped).toHaveLength(27);
    expect(capped.map((fact) => fact.id)).toContain(
      "standard_event.value_by_currency:EUR",
    );
    expect(capped.map((fact) => fact.id)).not.toContain(
      "standard_event.value_by_currency:USD",
    );
    expect(
      capped.some((fact) =>
        fact.coverage.warnings.some((warning) => warning.includes("27-fact")),
      ),
    ).toBe(true);
    // Deterministic: same input, same output.
    expect(capResponseFacts([...singles, ...multis] as never)).toEqual(capped);
  });
});

describe("error snapshot semantics (R3-F5)", () => {
  const PXE = "proj_err_snap";

  async function seedSnapErrors() {
    const issue = (
      id: string,
      status: string,
      firstSeen: number,
      firstRelease: string | null,
      lastRelease: string | null,
    ) =>
      exec(
        `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
         VALUES (?, ?, 'web', 1, ?, 'error', ?, ?, ?, ?, 0, 0, ?, ?)`,
        [
          id,
          PXE,
          `fp-${id}`,
          status,
          `Title ${id}`,
          firstSeen,
          NOW,
          firstRelease,
          lastRelease,
        ],
      );
    const occ = (
      id: string,
      issueId: string,
      occurred: number,
      received: number,
    ) =>
      exec(
        `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
         VALUES (?, ?, ?, ?, 's', 'web', 'error', 0, ?, ?, '2.4.1', 'production', 'snap', '{}')`,
        [id, `c-${id}`, issueId, PXE, occurred, received],
      );
    // Late first receipt: occurred in window, received after NOW.
    await issue("iss_late", "unresolved", FROM + 20000, "2.4.1", "2.4.1");
    await occ("ol1", "iss_late", FROM + 20000, NOW + 9000);
    // Ordinary historical issue.
    await issue("iss_hist", "unresolved", FROM - 100, "2.4.0", "2.4.0");
    await occ("oh1", "iss_hist", FROM - 100, FROM - 100);
    // Resolved after activity: current-only status. The previous-window
    // occurrence keeps it out of fresh/regressing at any snapshot.
    await issue("iss_rx", "resolved", FROM - 200, "2.4.0", "2.4.0");
    await occ("or1", "iss_rx", FROM + 600, FROM + 600);
    await occ("or2", "iss_rx", CFROM + 100, CFROM + 100);
  }

  it("excludes late-received first occurrences from earlier snapshots", async () => {
    await seedSnapErrors();
    const snap = { ...WINDOW, asOf: FROM + 1000 };
    const scoped = (metricId: string): Promise<MetricFact[]> =>
      measureMetrics(
        client as unknown as CanonicalClient,
        PXE,
        snap,
        [],
        [{ metricId }],
        { capabilities: CAPABILITIES, now: NOW },
      ).then((facts) => facts as MetricFact[]);
    // iss_late has no cutoff-visible occurrence: fresh and regressing
    // stay zero; iss_hist predates the window.
    expect(
      (await scoped("errors.new_issues")).map((fact) => fact.value),
    ).toEqual([0]);
    expect(
      (await scoped("errors.regressing_issues")).map((fact) => fact.value),
    ).toEqual([0]);
    // R4-F4: unresolved is current-only — historical snapshots return a
    // typed unavailable (null), never a numeric value with only a warning.
    const unresolved = await scoped("errors.unresolved_issues");
    expect(unresolved.map((fact) => fact.value)).toEqual([null]);
    expect(unresolved[0]?.formattedValue).toBe("—");
    expect(
      unresolved[0]?.coverage.warnings.some((warning) =>
        warning.includes("current-only"),
      ),
    ).toBe(true);
    expect(unresolved[0]?.coverageNote).toMatch(/not a historical snapshot/);
  });

  it("counts the late issue once its receipt is inside the snapshot", async () => {
    const facts = await measureMetrics(
      client as unknown as CanonicalClient,
      PXE,
      { ...WINDOW, asOf: NOW + 10000 },
      [],
      [{ metricId: "errors.new_issues" }],
      { capabilities: CAPABILITIES, now: NOW + 10000 },
    );
    expect((facts as MetricFact[]).map((fact) => fact.value)).toEqual([1]);
  });

  it("separates affected identities by release", async () => {
    const scoped = (release: string) =>
      measure([
        { metricId: "errors.affected_identities", filters: { release } },
      ]).then((facts) => factById(facts, factIdFor("errors.affected_identities", { release })).value);
    expect(await scoped("2.4.1")).toBe(2); // e_a1, e_a2
    expect(await scoped("2.3.0")).toBe(1); // e_a4
  });
});

describe("stable anonymous subjects across real identify merges (R4-F2)", () => {
  it("keeps two historical subjects after both identify to one user", async () => {
    const PX = "proj_ident_hist";
    const anonA = "histA";
    const anonB = "histB";
    const user = "u_merge";
    const aA = personIdForAnonymous(PX, anonA);
    const aB = personIdForAnonymous(PX, anonB);
    const u = personIdForUser(PX, user);
    const tA = FROM + 1000;
    const tB = FROM + 2000;
    const asOfHist = FROM + 5000;
    const receivedIdentify = NOW;
    // Two anonymous-only people with one event each (immutable anon IDs).
    await exec(
      "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
      [aA, PX, tA, tA],
    );
    await exec(
      "INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
      [aB, PX, tB, tB],
    );
    const seedHist = async (id: string, anon: string, person: string, at: number) =>
      exec(
        `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
          received_at, session_id, anonymous_id, user_id, person_id, properties,
          context, sdk_name, sdk_version, source_id, platform)
         VALUES (?, ?, 'track', 'click', 1, ?, ?, NULL, ?, NULL, ?, '{}', NULL, NULL, NULL, 's', 'web')`,
        [id, PX, at, at, anon, person],
      );
    await seedHist("hA", anonA, aA, tA);
    await seedHist("hB", anonB, aB, tB);
    const snapHist: MetricWindow = {
      from: FROM,
      to: NOW,
      compareFrom: CFROM,
      compareTo: FROM,
      asOf: asOfHist,
    };
    const caps: ProjectCapabilities = {
      ...CAPABILITIES,
      standardEventsObserved: [],
    };
    const readHist = (metricId: string) =>
      measureMetrics(
        client as unknown as CanonicalClient,
        PX,
        snapHist,
        { sourceScope: "all", sourceIds: [] },
        [{ metricId }],
        { capabilities: caps, now: NOW },
      ).then((facts) => (facts as MetricFact[])[0]?.value);
    expect(await readHist("project.active_anonymous")).toBe(2);
    expect(await readHist("project.active_people")).toBe(0);
    // Real production identify flow: claim + mutations per op, sequential.
    for (const [opId, anon] of [
      ["opA", anonA],
      ["opB", anonB],
    ] as const) {
      const op = {
        opId,
        userId: user,
        anonymousId: anon,
        occurredAt: asOfHist + 100,
      };
      const claim = identityClaimStatement(PX, op, receivedIdentify, u);
      const claimed = await client.execute({
        sql: claim.sql,
        args: claim.args as Array<string | number | null>,
      });
      expect(Number(claimed.rowsAffected ?? 0)).toBe(1);
      for (const statement of identityMutationStatements(
        PX,
        op,
        receivedIdentify,
        u,
      )) {
        await client.execute({
          sql: statement.sql,
          args: statement.args as Array<string | number | null>,
        });
      }
    }
    clearMetricSnapshotCache();
    // Old snapshot is immutable: still two anonymous subjects, zero identified.
    expect(await readHist("project.active_anonymous")).toBe(2);
    expect(await readHist("project.active_people")).toBe(0);
    // Current view reflects the merge: one identified person, no anonymous.
    const snapNow: MetricWindow = { ...snapHist, asOf: NOW };
    const readNow = (metricId: string) =>
      measureMetrics(
        client as unknown as CanonicalClient,
        PX,
        snapNow,
        { sourceScope: "all", sourceIds: [] },
        [{ metricId }],
        { capabilities: caps, now: NOW },
      ).then((facts) => (facts as MetricFact[])[0]?.value);
    expect(await readNow("project.active_people")).toBe(1);
    expect(await readNow("project.active_anonymous")).toBe(0);
    clearMetricSnapshotCache();
  });
});

describe("current-only status and release cutoffs (R4-F4)", () => {
  it("marks unresolved historical facts unavailable and gates insights", () => {
    expect(isSnapshotReplayable("errors.unresolved_issues")).toBe(false);
    expect(isSnapshotReplayable("errors.new_issues")).toBe(true);
    expect(isSnapshotReplayable("errors.regressing_issues")).toBe(true);
    expect(isSnapshotReplayable("project.accepted_events")).toBe(true);
  });

  it("replays the exact historical response after resolve/reopen and a new release", async () => {
    const PX = "proj_err_replay";
    const issueId = "iss_r1";
    await exec(
      `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
       VALUES (?, ?, 'web', 1, ?, 'error', 'unresolved', ?, ?, ?, 0, 0, ?, ?)`,
      [issueId, PX, `fp-${issueId}`, `Title ${issueId}`, FROM + 100, NOW, "2.4.1", "2.4.1"],
    );
    await exec(
      `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
       VALUES (?, ?, ?, ?, 's', 'web', 'error', 0, ?, ?, ?, 'production', 'r1', '{}')`,
      ["rr1", "c-rr1", issueId, PX, FROM + 100, FROM + 100, "2.4.1"],
    );
    const asOfHist = FROM + 1000;
    const snapHist: MetricWindow = {
      from: FROM,
      to: NOW,
      compareFrom: CFROM,
      compareTo: FROM,
      asOf: asOfHist,
    };
    const readHist = async () =>
      (await measureMetrics(
        client as unknown as CanonicalClient,
        PX,
        snapHist,
        { sourceScope: "all", sourceIds: [] },
        [
          { metricId: "errors.new_issues" },
          { metricId: "errors.regressing_issues" },
          { metricId: "errors.unresolved_issues" },
          {
            metricId: "errors.new_issues",
            filters: { release: "2.4.1" },
          },
          {
            metricId: "errors.new_issues",
            filters: { release: "9.9" },
          },
        ],
        { capabilities: CAPABILITIES, now: NOW },
      )) as MetricFact[];
    const before = await readHist();
    const factValue = (facts: MetricFact[], id: string, release?: string) =>
      facts.find(
        (fact) =>
          fact.metricId === id &&
          (release === undefined
            ? fact.filters.release === undefined
            : fact.filters.release === release),
      )?.value;
    expect(factValue(before, "errors.new_issues")).toBe(1);
    expect(factValue(before, "errors.new_issues", "2.4.1")).toBe(1);
    expect(factValue(before, "errors.new_issues", "9.9")).toBe(0);
    expect(factValue(before, "errors.unresolved_issues")).toBeNull();
    // Post-snapshot mutations: user resolves, then a later receipt in a new
    // release reopens (mutable projection moves to 9.9 + resolved→unresolved).
    await exec("UPDATE error_issues SET status = 'resolved' WHERE id = ?", [
      issueId,
    ]);
    await exec(
      `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
       VALUES (?, ?, ?, ?, 's', 'web', 'error', 0, ?, ?, ?, 'production', 'r2', '{}')`,
      ["rr2", "c-rr2", issueId, PX, FROM + 200, NOW + 9000, "9.9"],
    );
    await exec(
      "UPDATE error_issues SET status = 'unresolved', last_release = '9.9', last_seen_at = ? WHERE id = ?",
      [FROM + 200, issueId],
    );
    clearMetricSnapshotCache();
    const after = await readHist();
    // Exact replay: identical values, with historical unresolved still an
    // explicit unavailable — never a moved numeric.
    expect(after.map((fact) => [fact.id, fact.value])).toEqual(
      before.map((fact) => [fact.id, fact.value]),
    );
    expect(factValue(after, "errors.new_issues", "2.4.1")).toBe(1);
    expect(factValue(after, "errors.new_issues", "9.9")).toBe(0);
    expect(factValue(after, "errors.unresolved_issues")).toBeNull();
    clearMetricSnapshotCache();
  });
});

describe("verified scope authority (R5-F1)", () => {
  it("rejects omitted and conflicting per-request source filters", async () => {
    const scope = { sourceScope: "selected" as const, sourceIds: [W] };
    // Omitted filter with a selected scope must not widen to all.
    await expect(
      measureMetrics(
        client as unknown as CanonicalClient,
        P,
        WINDOW,
        scope,
        [{ metricId: "project.accepted_events" }],
        { capabilities: CAPABILITIES, now: NOW },
      ),
    ).rejects.toThrowError(MetricQueryError);
    // Conflicting IDs must not relabel another scope's value.
    await expect(
      measureMetrics(
        client as unknown as CanonicalClient,
        P,
        WINDOW,
        scope,
        [{ metricId: "project.accepted_events", filters: { sourceIds: [S] } }],
        { capabilities: CAPABILITIES, now: NOW },
      ),
    ).rejects.toThrowError(MetricQueryError);
    // all-scope must not carry per-request IDs.
    await expect(
      measureMetrics(
        client as unknown as CanonicalClient,
        P,
        WINDOW,
        { sourceScope: "all" as const, sourceIds: [] },
        [{ metricId: "project.accepted_events", filters: { sourceIds: [W] } }],
        { capabilities: CAPABILITIES, now: NOW },
      ),
    ).rejects.toThrowError(MetricQueryError);
    // Matching scope + filter succeeds with scoped metadata and value.
    const facts = (await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      WINDOW,
      scope,
      [{ metricId: "project.accepted_events", filters: { sourceIds: [W] } }],
      { capabilities: CAPABILITIES, now: NOW },
    )) as MetricFact[];
    expect(facts[0]?.value).toBe(14);
    expect(facts[0]?.queryContext.sourceScope).toBe("selected");
    clearMetricSnapshotCache();
  });

  it("returns unavailable for selected-source contexts on metrics without source support", async () => {
    const scope = { sourceScope: "selected" as const, sourceIds: [W] };
    const facts = (await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      WINDOW,
      scope,
      [{ metricId: "errors.new_issues" }],
      { capabilities: CAPABILITIES, now: NOW },
    )) as MetricFact[];
    // Never all-source data under selected metadata.
    expect(facts[0]?.value).toBeNull();
    expect(facts[0]?.coverageNote).toMatch(/selected-source/);
    expect(facts[0]?.queryContext.sourceScope).toBe("selected");
    clearMetricSnapshotCache();
  });
});

describe("bounded error release queries and capability cache (R5-F2, R5-F3)", () => {
  it("reads release-scoped states in one query regardless of issue count", async () => {
    const PX = "proj_err_count";
    const seedIssue = async (n: number) => {
      await exec(
        `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
         VALUES (?, ?, 'web', 1, ?, 'error', 'unresolved', ?, ?, ?, 0, 0, '2.4.1', '2.4.1')`,
        [`cnt${n}`, PX, `fp-cnt${n}`, `Title cnt${n}`, FROM + n, NOW],
      );
      await exec(
        `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
         VALUES (?, ?, ?, ?, 's', 'web', 'error', 0, ?, ?, '2.4.1', 'production', ?, '{}')`,
        [`co${n}`, `c-co${n}`, `cnt${n}`, PX, FROM + n, FROM + n, `u${n}`],
      );
    };
    for (let n = 0; n < 5; n += 1) await seedIssue(n);
    const counting = (counter: { n: number; rows: number }): CanonicalClient => ({
      execute: async (input) => {
        counter.n += 1;
        const result = await client.execute(input);
        counter.rows = Math.max(counter.rows, result.rows.length);
        return result;
      },
    });
    const window: MetricWindow = { ...WINDOW };
    const first = { n: 0, rows: 0 };
    const fresh5 = await errorIssueStateCounts(
      counting(first) as unknown as CanonicalClient,
      PX,
      FROM,
      NOW,
      CFROM,
      FROM,
      NOW,
      { release: "2.4.1" },
    );
    expect(fresh5.fresh).toBe(5);
    expect(first.n).toBe(1);
    expect(first.rows).toBe(1);
    for (let n = 5; n < 20; n += 1) await seedIssue(n);
    const second = { n: 0, rows: 0 };
    const fresh20 = await errorIssueStateCounts(
      counting(second) as unknown as CanonicalClient,
      PX,
      FROM,
      NOW,
      CFROM,
      FROM,
      NOW,
      { release: "2.4.1" },
    );
    expect(fresh20.fresh).toBe(20);
    expect(second.n).toBe(1);
    expect(second.rows).toBe(1);
    // Unfiltered states also stay single-query.
    const plain = { n: 0, rows: 0 };
    await errorIssueStateCounts(
      counting(plain) as unknown as CanonicalClient,
      PX,
      FROM,
      NOW,
      CFROM,
      FROM,
      NOW,
      {},
    );
    expect(plain.n).toBe(1);
  });

  it("separates cache entries by total sources and observed event sets", async () => {
    clearMetricSnapshotCache();
    const window: MetricWindow = { ...WINDOW };
    const base: ProjectCapabilities = {
      ...CAPABILITIES,
      sources: { total: 1, active: 1, lastReceivedAt: null },
      standardEventsObserved: ["sign_up"],
    };
    const first = (await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      window,
      { sourceScope: "all" as const, sourceIds: [] },
      [{ metricId: "project.accepted_events" }],
      { capabilities: base, now: NOW },
    )) as MetricFact[];
    expect(first[0]?.coverage.sourcesConfigured).toBe(1);
    // Same active count, new configured total: must not serve stale coverage.
    const totalChanged: ProjectCapabilities = {
      ...base,
      sources: { total: 2, active: 1, lastReceivedAt: null },
    };
    const second = (await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      window,
      { sourceScope: "all" as const, sourceIds: [] },
      [{ metricId: "project.accepted_events" }],
      { capabilities: totalChanged, now: NOW + 1000 },
    )) as MetricFact[];
    expect(second[0]?.coverage.sourcesConfigured).toBe(2);
    // Same length, different observed set: must not alias.
    const eventsChanged: ProjectCapabilities = {
      ...base,
      standardEventsObserved: ["purchase"],
    };
    const third = (await measureMetrics(
      client as unknown as CanonicalClient,
      P,
      window,
      { sourceScope: "all" as const, sourceIds: [] },
      [{ metricId: "project.accepted_events" }],
      { capabilities: eventsChanged, now: NOW + 2000 },
    )) as MetricFact[];
    expect(third[0]?.coverage.sourcesConfigured).toBe(1);
    expect(third).not.toEqual(second);
    clearMetricSnapshotCache();
  });
});

describe("independent release rules per counter (R6-F3)", () => {
  it("separates first-release, any-visible, and window rules across two releases", async () => {
    const PX = "proj_err_diverge";
    const issue = async (id: string, status: string, firstSeen: number) =>
      exec(
        `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
         VALUES (?, ?, 'web', 1, ?, 'error', ?, ?, ?, ?, 0, 0, NULL, NULL)`,
        [id, PX, `fp-${id}`, status, `Title ${id}`, firstSeen, NOW],
      );
    const occ = async (
      id: string,
      issueId: string,
      occurred: number,
      release: string | null,
    ) =>
      exec(
        `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
         VALUES (?, ?, ?, ?, 's', 'web', 'error', 0, ?, ?, ?, 'production', ?, '{}')`,
        [id, `c-${id}`, issueId, PX, occurred, occurred, release, `u-${id}`],
      );
    // New issue visible in two releases: first seen in 1.0, later also 2.0.
    await issue("iss_two", "unresolved", FROM + 100);
    await occ("dv1", "iss_two", FROM + 100, "1.0");
    await occ("dv2", "iss_two", FROM + 200, "2.0");
    // Non-new regressing issue with differing historical/current releases:
    // one previous-window 1.0 occurrence, two current-window 2.0.
    await issue("iss_reg2", "unresolved", CFROM + 100);
    await occ("dv0", "iss_reg2", CFROM + 100, "1.0");
    await occ("dv3", "iss_reg2", FROM + 300, "2.0");
    await occ("dv4", "iss_reg2", FROM + 400, "2.0");
    const read = async (metricId: string, release?: string) =>
      (await measureMetrics(
        client as unknown as CanonicalClient,
        PX,
        WINDOW,
        { sourceScope: "all" as const, sourceIds: [] },
        release === undefined
          ? [{ metricId }]
          : [{ metricId, filters: { release } }],
        { capabilities: CAPABILITIES, now: NOW },
      )) as MetricFact[];
    const valueOfFact = (facts: MetricFact[]) => facts[0]?.value;
    // First release includes the two-release issue in both counters...
    expect(valueOfFact(await read("errors.new_issues", "1.0"))).toBe(1);
    // ...while the later release includes it in unresolved but not new.
    expect(valueOfFact(await read("errors.new_issues", "2.0"))).toBe(0);
    expect(valueOfFact(await read("errors.unresolved_issues", "2.0"))).toBe(2);
    expect(valueOfFact(await read("errors.unresolved_issues", "1.0"))).toBe(2);
    // Regressing follows current-window co-occurrence, not history.
    expect(valueOfFact(await read("errors.regressing_issues", "2.0"))).toBe(1);
    expect(valueOfFact(await read("errors.regressing_issues", "1.0"))).toBe(0);
    clearMetricSnapshotCache();
  });
});
