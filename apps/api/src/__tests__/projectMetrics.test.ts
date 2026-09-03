import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import {
  MetricFactSchema,
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
  return measureMetrics(
    client as unknown as CanonicalClient,
    P,
    window,
    [],
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
    person: "p1",
    anon: "au1",
  });
  await seedEvent({ id: "e2", occurred: NOW - 1, session: "s1", person: "p1" });
  await seedEvent({ id: "e3", occurred: NOW, session: "s1", person: "p1" }); // excluded: to boundary
  await seedEvent({
    id: "e4",
    occurred: FROM + 1000,
    received: NOW + 5000,
    person: "p1",
  }); // excluded: late arrival
  await seedEvent({ id: "e5", occurred: CFROM, session: "s0", person: "p1" }); // previous window
  await seedEvent({ id: "e6", project: PX, occurred: FROM + 10, person: "p1" }); // other project
  await seedEvent({
    id: "e7",
    occurred: FROM + 2000,
    session: "s2",
    person: "p1",
    source: S,
    platform: "server",
  });
  await seedEvent({
    id: "e8",
    occurred: FROM + 3000,
    session: "s3",
    anon: "anon1",
  });
  await seedEvent({ id: "e9", occurred: CFROM + 100, anon: "anon1" });

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
  await signUp("su1", FROM + 4000, "p1");
  await signUp("su2", FROM + 5000, "p2");
  await signUp("su3", CFROM + 200, "p1");
  await seedEvent({
    id: "bad1",
    name: "$prism_sign_up",
    occurred: FROM + 9000,
    person: "p1",
    properties: "{}",
  }); // malformed legacy: counts as event, never as sign_up
  const purchase = (
    id: string,
    occurred: number,
    valueMinor: number,
    currency: string,
    person = "p1",
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
  await purchase("pu2", FROM + 7000, 2000, "EUR", "p2");
  await purchase("pu3", CFROM + 300, 400, "USD");
  await seedEvent({
    id: "rf1",
    name: "$prism_refund",
    occurred: FROM + 8000,
    person: "p1",
    properties: stdProps("refund", {
      valueMinor: 500,
      currency: "USD",
      refundId: "r-1",
      transactionId: "t-pu1",
    }),
  });

  // --- identity links (no people rows needed: canonical counts are event/link based) ---
  await exec(
    "INSERT INTO external_identities (project_id, user_id, person_id, linked_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
    [
      P,
      "u1",
      "p1",
      CFROM - 1000,
      P,
      "u2",
      "p2",
      FROM + 4500,
      P,
      "u_new",
      "p_new",
      FROM + 5000,
    ],
  );

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
  await pageView("w1", FROM + 10000, "example.com", "/a", 0, "p1", "s1");
  await pageView("w2", FROM + 11000, "example.com", "/b", 0, "p1", "s4");
  await pageView("w3", FROM + 12000, "example.com", "/a", 1, "p2", "s5");
  await pageView("w0", CFROM + 400, "example.com", "/a", 0, "p1", "s0");
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
    anon: "m_anon1",
    source: M,
    platform: "react-native",
  });
  await seedEvent({
    id: "se2",
    name: "$prism_screen_view",
    occurred: FROM + 11200,
    session: "m1",
    anon: "m_anon1",
    source: M,
    platform: "react-native",
  });
  await seedEvent({
    id: "se3",
    name: "$prism_screen_view",
    occurred: FROM + 12100,
    session: "m2",
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
    // e1 e2 e7 e8 su1 su2 pu1 pu2 rf1 bad1 (10) + w1 w2 w3 (3) + se1 se2 se3 (3) = 16.
    // e3 (to boundary), e4 (late arrival), e5/e9/su3/pu3/w0 (previous), e6 (other project) excluded.
    const fact = factById(facts, "project.accepted_events");
    expect(fact.value).toBe(16);
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 220,
    });
  });

  it("filters events by source without leaking other sources", async () => {
    const facts = await measure([
      { metricId: "project.accepted_events", filters: { sourceIds: [W] } },
    ]);
    const fact = factById(facts, "project.accepted_events");
    // excludes e7 (server) and se1..se3 (mobile): 16 - 1 - 3 = 12.
    expect(fact.value).toBe(12);
    expect(fact.filters).toEqual({ sourceId: W });
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
    expect(fact.value).toBe(2); // p1 (web+server), p2 — never double-counted
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 100,
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
    expect(fact.value).toBe(2); // anon1, m_anon1
    expect(fact.comparison).toMatchObject({
      kind: "percent",
      direction: "up",
      percent: 100,
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
    expect(factById(facts, "standard_event.occurrences").value).toBe(2); // bad1 never counts
    const people = await measure([
      {
        metricId: "standard_event.people",
        filters: { standardEventKey: "sign_up" },
      },
    ]);
    expect(factById(people, "standard_event.people").value).toBe(2);
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
    expect(factById(facts, "mobile.app_opens").value).toBe(1);
    expect(factById(facts, "mobile.app_opens").filters).toEqual({ os: "ios" });
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
    expect(factById(facts, "errors.occurrences").value).toBe(5); // iss_new 3 + iss_res 2
    const release = await measure([
      { metricId: "errors.occurrences", filters: { release: "2.4.1" } },
    ]);
    expect(factById(release, "errors.occurrences").value).toBe(8);
  });

  it("maps release filters to first/last release for state counts", async () => {
    const fresh = await measure([
      { metricId: "errors.new_issues", filters: { release: "2.4.1" } },
    ]);
    expect(factById(fresh, "errors.new_issues").value).toBe(1);
    const none = await measure([
      { metricId: "errors.new_issues", filters: { release: "9.9" } },
    ]);
    expect(factById(none, "errors.new_issues").value).toBe(0);
    const unresolved = await measure([
      { metricId: "errors.unresolved_issues", filters: { platform: "web" } },
    ]);
    expect(factById(unresolved, "errors.unresolved_issues").value).toBe(1); // iss_new only
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
    expect(replay[0]?.value).toBe(16);
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
    ).toThrowError(/Unknown Standard Event key/);
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
    ).toThrowError(/Unknown filter/);
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
    expect(events[0]?.value).toBe(16);
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
