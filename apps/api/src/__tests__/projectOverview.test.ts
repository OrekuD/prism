import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import {
  containsCausalClaim,
  isSnapshotReplayable,
  ProjectOverviewResourceSchema,
  type MetricFact,
  type ProjectCapabilities,
  type PublicQueryContext,
} from "@prism-analytics/types";
import {
  clearMetricSnapshotCache,
  measureMetrics,
  resolveMetricWindow,
  type CanonicalClient,
  type MetricWindow,
} from "../utils/projectMetrics";
import {
  basisKeyForFact,
  buildDataQuality,
  buildOverviewResource,
  previousWindowOf,
  selectDetectionPlans,
  selectInsights,
  selectPulsePlans,
  trendBucketForOverview,
  validateOverviewReferences,
  type InsightBasis,
  type OverviewIssueRow,
  type OverviewReleaseRow,
} from "../utils/projectOverview";

/**
 * Deterministic overview tests (Task 21 slice 3, revised per review
 * round 7): REAL in-memory libSQL with the ACTUAL analytics migrations.
 * Exact previous basis, detection-beyond-pulse, stable project-level
 * outcomes, readiness wording, current-only secondary, identifier bounds,
 * and evidence grounding are exercised against production SQL.
 */

const NOW = 1_785_628_800_000;
const SPAN = 7 * 86_400_000;
const FROM = NOW - SPAN;
const CFROM = FROM - SPAN;
const P = "proj_overview";

let client: Client;

async function exec(sql: string, args: Array<string | number | null> = []) {
  await client.execute({ sql, args });
}

async function seedEvent(row: {
  id: string;
  project?: string;
  occurred: number;
  received?: number;
  source?: string | null;
  name?: string;
  session?: string | null;
  person?: string | null;
  properties?: string;
}) {
  await exec(
    `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
      received_at, session_id, anonymous_id, user_id, person_id, properties,
      context, sdk_name, sdk_version, source_id, platform)
     VALUES (?, ?, 'track', ?, 1, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, 'web')`,
    [
      row.id,
      row.project ?? P,
      row.name ?? "click",
      row.occurred,
      row.received ?? row.occurred,
      row.session ?? null,
      `anon-${row.id}`,
      row.person ?? null,
      row.properties ?? "{}",
      row.source ?? "s1",
    ],
  );
}

function stdProps(key: string) {
  return JSON.stringify({ $standard: { schemaVersion: 1, key, data: {} } });
}

async function seedIssue(id: string, title: string, status = "unresolved") {
  await exec(
    `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
     VALUES (?, ?, 'web', 1, ?, 'error', ?, ?, ?, ?, 0, 0, NULL, NULL)`,
    [id, P, `fp-${id}`, status, title, FROM, NOW],
  );
}

async function seedOcc(
  id: string,
  issueId: string,
  occurred: number,
  release: string | null = null,
) {
  await exec(
    `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
     VALUES (?, ?, ?, ?, 's1', 'web', 'error', 0, ?, ?, ?, 'production', ?, '{}')`,
    [id, `c-${id}`, issueId, P, occurred, occurred, release, `u-${id}`],
  );
}

const WINDOW: MetricWindow = {
  from: FROM,
  to: NOW,
  compareFrom: CFROM,
  compareTo: FROM,
  asOf: NOW,
};

function capabilitiesFor(
  overrides: Partial<ProjectCapabilities> = {},
): ProjectCapabilities {
  return {
    web: false,
    mobile: false,
    server: false,
    errorCollection: { configured: false, observed: false },
    standardEventsObserved: [],
    sources: { total: 0, active: 0, lastReceivedAt: null },
    trafficPolicy: "human",
    ...overrides,
  };
}

function contextFor(): PublicQueryContext {
  return {
    from: FROM,
    to: NOW,
    compareFrom: CFROM,
    compareTo: FROM,
    asOf: NOW,
    timezone: "UTC",
    sourceScope: "all",
    sourceIds: [],
    definitionVersion: 1,
  };
}

function countFact(
  metricId: string,
  current: number,
  previous: number | null,
  id?: string,
): MetricFact {
  const queryContext = contextFor();
  const comparison =
    previous === null
      ? { kind: "no-prior-data" as const }
      : previous === 0
        ? current === 0
          ? { kind: "percent" as const, direction: "flat" as const, percent: 0 }
          : { kind: "new" as const }
        : current === previous
          ? { kind: "percent" as const, direction: "flat" as const, percent: 0 }
          : {
              kind: "percent" as const,
              direction: current > previous ? ("up" as const) : ("down" as const),
              percent:
                Math.round(((current - previous) / previous) * 1000) / 10,
            };
  return {
    id: id ?? metricId,
    metricId: metricId as MetricFact["metricId"],
    definitionVersion: 1,
    label: metricId,
    value: current,
    formattedValue: String(current),
    unit: null,
    comparison,
    queryContext,
    coverage: {
      sourcesConfigured: 1,
      sourcesActive: 1,
      enrichments: [],
      warnings: [],
    },
    coverageNote: "",
    filters: { sourceScope: "all" },
    drilldown: { destination: "events", label: "Open Events" },
  };
}

function basisFor(
  entries: Array<[MetricFact, number | null]>,
  rates: Record<string, { current: number; previous: number }> = {},
): InsightBasis {
  const previousByKey: Record<string, number | null> = {};
  for (const [fact, previous] of entries) {
    previousByKey[basisKeyForFact(fact)] = previous;
  }
  const rateDenominatorsByKey: Record<string, { current: number; previous: number }> = {};
  for (const [key, value] of Object.entries(rates)) {
    rateDenominatorsByKey[key] = value;
  }
  return { previousByKey, rateDenominatorsByKey };
}

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  await applyPendingMigrations(client, readMigrationFiles());
});

describe("adaptive pulse selection", () => {
  it("covers every source combination with exactly three stable slots", () => {
    const combos: Array<[string, ProjectCapabilities]> = [
      ["web-only", capabilitiesFor({ web: true, sources: { total: 1, active: 1, lastReceivedAt: NOW } })],
      ["mobile-only", capabilitiesFor({ mobile: true, sources: { total: 1, active: 1, lastReceivedAt: NOW } })],
      ["server-only", capabilitiesFor({ server: true, sources: { total: 1, active: 1, lastReceivedAt: NOW } })],
      [
        "web-mobile-server",
        capabilitiesFor({
          web: true,
          mobile: true,
          server: true,
          errorCollection: { configured: true, observed: true },
          standardEventsObserved: ["sign_up"],
          sources: { total: 3, active: 3, lastReceivedAt: NOW },
        }),
      ],
      ["empty", capabilitiesFor()],
      ["errors-configured-zero", capabilitiesFor({ web: true, errorCollection: { configured: true, observed: false }, sources: { total: 1, active: 1, lastReceivedAt: NOW } })],
      ["future-native-ios", capabilitiesFor({ mobile: true, sources: { total: 1, active: 1, lastReceivedAt: NOW } })],
    ];
    for (const [label, capabilities] of combos) {
      const plans = selectPulsePlans(capabilities);
      expect(plans, label).toHaveLength(3);
      expect(selectPulsePlans(capabilities), label).toEqual(plans);
      const ids = plans.map((plan) => plan.metricId);
      if (capabilities.web) {
        expect(ids.some((id) => id.startsWith("web.")), label).toBe(true);
      }
      if (capabilities.mobile && !capabilities.web) {
        expect(ids, label).toContain("mobile.app_opens");
      }
      if (capabilities.errorCollection.configured || capabilities.errorCollection.observed) {
        expect(ids, label).toContain("errors.occurrences");
      }
      expect(ids, label).not.toContain("standard_event.value_by_currency");
    }
  });

  it("prefers the first sorted observed Standard Event as the key outcome", () => {
    const plans = selectPulsePlans(
      capabilitiesFor({ standardEventsObserved: ["purchase", "sign_up", "login"] }),
    );
    expect(plans[0]?.metricId).toBe("standard_event.occurrences");
    expect(plans[0]?.filters?.standardEventKey).toBe("login");
  });

  it("selects a bounded detection set covering pulse plus rate bases", () => {
    const capabilities = capabilitiesFor({
      web: true,
      mobile: true,
      errorCollection: { configured: true, observed: true },
      standardEventsObserved: ["sign_up"],
      sources: { total: 3, active: 3, lastReceivedAt: NOW },
    });
    const detection = selectDetectionPlans(capabilities);
    const pulseIds = selectPulsePlans(capabilities).map(
      (plan) => `${plan.metricId}|${plan.filters?.standardEventKey ?? ""}`,
    );
    for (const pulseId of pulseIds) {
      expect(
        detection.some(
          (plan) => `${plan.metricId}|${plan.filters?.standardEventKey ?? ""}` === pulseId,
        ),
      ).toBe(true);
    }
    const ids = detection.map((plan) => plan.metricId);
    for (const required of [
      "project.accepted_events",
      "project.sessions",
      "web.bounce_rate",
      "web.views_per_session",
      "mobile.screens_per_session",
    ]) {
      expect(ids).toContain(required);
    }
    expect(detection.length).toBeLessThanOrEqual(13);
  });
});

describe("exact previous basis (R7-F1)", () => {
  // Observed outcome suppresses the definition signal so change
  // eligibility is isolated in these unit cases.
  const capabilities = () =>
    capabilitiesFor({ standardEventsObserved: ["sign_up"] });

  it("states the exact previous value for large awkward ratios", () => {
    const fact = countFact("project.accepted_events", 1_000_000, 42.9);
    const insights = selectInsights({
      facts: [fact],
      basis: basisFor([[fact, 700_000]]),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights).toHaveLength(1);
    // Reversing the rounded 42.9% would yield 699790 — the insight must
    // carry the exact canonical 700000.
    expect(insights[0]?.summary).toContain("from 700000 to 1000000");
  });

  it("matches a direct canonical measurement of the previous window", async () => {
    const PX = "proj_ov_exact";
    for (let n = 0; n < 30; n += 1) {
      await seedEvent({ id: `x${n}`, project: PX, occurred: FROM + n * 1000 });
    }
    for (let n = 0; n < 10; n += 1) {
      await seedEvent({ id: `xp${n}`, project: PX, occurred: CFROM + n * 1000 });
    }
    const caps = capabilitiesFor({
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities: caps,
      deps: { capabilities: caps, now: NOW },
    });
    const change = resource.insights.find(
      (insight) => insight.kind === "change",
    );
    expect(change).toBeDefined();
    // Independent canonical read of the previous window as current.
    const previous = (await measureMetrics(
      client as unknown as CanonicalClient,
      PX,
      previousWindowOf({ ...WINDOW }),
      { sourceScope: "all", sourceIds: [] },
      [{ metricId: "project.accepted_events" }],
      { capabilities: caps, now: NOW },
    )) as MetricFact[];
    expect(change?.summary).toContain(
      `from ${previous[0]?.value} to 30`,
    );
    clearMetricSnapshotCache();
  });

  it("skips change headlines when the exact basis is missing", () => {
    const fact = countFact("project.accepted_events", 100, 900);
    const insights = selectInsights({
      facts: [fact],
      basis: basisFor([]),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights.filter((insight) => insight.kind === "change")).toHaveLength(0);
  });
});

describe("insight eligibility and ranking", () => {
  const capabilities = () =>
    capabilitiesFor({ standardEventsObserved: ["sign_up"] });

  it("suppresses low-volume changes and promotes eligible ones", () => {
    const queryContext = contextFor();
    const changesOf = (fact: MetricFact, previous: number) =>
      selectInsights({
        facts: [fact],
        basis: basisFor([[fact, previous]]),
        capabilities: capabilities(),
        issues: [],
        releases: [],
        queryContext,
        observedAt: NOW,
      }).filter((insight) => insight.kind === "change");
    expect(changesOf(countFact("project.accepted_events", 3, 2), 2)).toHaveLength(0);
    expect(changesOf(countFact("project.accepted_events", 12, 10), 10)).toHaveLength(0);
    expect(changesOf(countFact("project.accepted_events", 100, 95), 95)).toHaveLength(0);
    const eligible = selectInsights({
      facts: [countFact("project.accepted_events", 30, 10)],
      basis: basisFor([[countFact("project.accepted_events", 30, 10), 10]]),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext,
      observedAt: NOW,
    });
    expect(eligible.filter((insight) => insight.kind === "change")).toHaveLength(1);
  });

  it("treats sufficient prior-zero volume as a headline change", () => {
    const fact = countFact("project.accepted_events", 25, 0);
    const insights = selectInsights({
      facts: [fact],
      basis: basisFor([[fact, 0]]),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights.filter((insight) => insight.kind === "change")).toHaveLength(1);
  });

  it("never feeds current-only facts into headlines", () => {
    expect(isSnapshotReplayable("errors.unresolved_issues")).toBe(false);
    const unresolved = countFact("errors.unresolved_issues", 50, 10);
    const insights = selectInsights({
      facts: [unresolved],
      basis: basisFor([[unresolved, 10]]),
      capabilities: capabilitiesFor({
        errorCollection: { configured: true, observed: true },
      }),
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights).toHaveLength(0);
  });

  it("requires at least 3 occurrences for new/regressing issue signals", () => {
    const queryContext = contextFor();
    const thin: OverviewIssueRow[] = [
      { id: "thin", title: "Thin", status: "unresolved", current: 2, previous: 0, users: 2, snapshotFirstSeen: FROM + 10 },
    ];
    expect(
      selectInsights({ facts: [], basis: basisFor([]), capabilities: capabilities(), issues: thin, releases: [], queryContext, observedAt: NOW }).filter((insight) => insight.kind === "error"),
    ).toHaveLength(0);
    const eligible: OverviewIssueRow[] = [
      { id: "thick", title: "Thick", status: "unresolved", current: 5, previous: 0, users: 4, snapshotFirstSeen: FROM + 10 },
    ];
    const insights = selectInsights({ facts: [], basis: basisFor([]), capabilities: capabilities(), issues: eligible, releases: [], queryContext, observedAt: NOW });
    expect(insights.filter((insight) => insight.kind === "error")).toHaveLength(1);
  });

  it("emits rate insights from exact denominators and suppresses thin ones", () => {
    const queryContext = contextFor();
    const bounce = countFact("web.bounce_rate", 0.55, 0.4);
    const key = basisKeyForFact(bounce);
    const eligible = selectInsights({
      facts: [bounce],
      basis: basisFor([[bounce, 0.4]], { [key]: { current: 60, previous: 55 } }),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext,
      observedAt: NOW,
    });
    expect(eligible.filter((insight) => insight.kind === "change")).toHaveLength(1);
    const thin = selectInsights({
      facts: [bounce],
      basis: basisFor([[bounce, 0.4]], { [key]: { current: 20, previous: 55 } }),
      capabilities: capabilities(),
      issues: [],
      releases: [],
      queryContext,
      observedAt: NOW,
    });
    expect(thin.filter((insight) => insight.kind === "change")).toHaveLength(0);
  });

  it("ranks critical before attention before info with stable IDs", () => {
    const queryContext = contextFor();
    const a = countFact("project.accepted_events", 30, 10, "a-change");
    const b = countFact("web.page_views", 200, 50, "b-change");
    const insights = selectInsights({
      facts: [a, b],
      basis: basisFor([[a, 10], [b, 50]]),
      capabilities: capabilities(),
      issues: [],
      releases: [{ release: "1.0", count: 4 }],
      queryContext,
      observedAt: NOW,
    });
    expect(insights.length).toBeLessThanOrEqual(3);
    const rank = (severity: string) =>
      severity === "critical" ? 0 : severity === "attention" ? 1 : 2;
    const severities = insights.map((insight) => insight.severity);
    for (let index = 1; index < severities.length; index += 1) {
      const current = severities[index];
      const prior = severities[index - 1];
      if (current === undefined || prior === undefined) continue;
      expect(rank(current)).toBeGreaterThanOrEqual(rank(prior));
    }
  });

  it("caps headlines at three", () => {
    const facts = [
      countFact("project.accepted_events", 100, 10, "f1"),
      countFact("web.page_views", 200, 20, "f2"),
      countFact("mobile.app_opens", 300, 30, "f3"),
      countFact("errors.occurrences", 400, 40, "f4"),
    ];
    const insights = selectInsights({
      facts,
      basis: basisFor(facts.map((fact) => [fact, 10] as [MetricFact, number])),
      capabilities: capabilities(),
      issues: [],
      releases: [{ release: "9.9", count: 9 }],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it("words readiness with a named dimension and retained-data statement", () => {
    const insights = selectInsights({
      facts: [],
      basis: basisFor([]),
      capabilities: capabilitiesFor({ sources: { total: 4, active: 2, lastReceivedAt: NOW } }),
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    const coverage = insights.find((insight) => insight.kind === "coverage");
    expect(coverage).toBeDefined();
    expect(coverage?.summary).toMatch(/source/i);
    expect(coverage?.summary).toMatch(/50%/);
    expect(coverage?.summary).toMatch(/remains included/);
    expect(coverage?.summary.toLowerCase()).not.toContain("event loss");
  });

  it("words releases associationally with digest-bounded IDs", () => {
    const release = `r-${"x".repeat(120)}`;
    const releases: OverviewReleaseRow[] = [{ release, count: 7 }];
    const insights = selectInsights({
      facts: [],
      basis: basisFor([]),
      capabilities: capabilitiesFor({ standardEventsObserved: ["sign_up"] }),
      issues: [],
      releases,
      queryContext: contextFor(),
      observedAt: NOW,
    });
    const candidate = insights.find((insight) => insight.kind === "release");
    expect(candidate).toBeDefined();
    expect(candidate?.summary).toContain("associated with");
    expect(containsCausalClaim(candidate?.summary ?? "")).toBe(false);
    expect(candidate?.id.length).toBeLessThanOrEqual(128);
    expect(candidate?.drilldown.filters?.release).toBe(release);
  });
});

describe("overview resource over real storage", () => {
  it("returns a schema-valid snapshot with one context everywhere", async () => {
    const PX = "proj_ov_valid";
    for (let n = 0; n < 30; n += 1) {
      await seedEvent({ id: `v${n}`, project: PX, occurred: FROM + n * 1000 });
    }
    for (let n = 0; n < 10; n += 1) {
      await seedEvent({ id: `vp${n}`, project: PX, occurred: CFROM + n * 1000 });
    }
    const caps = capabilitiesFor({
      web: true,
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities: caps,
      deps: { capabilities: caps, now: NOW },
    });
    const parsed = ProjectOverviewResourceSchema.safeParse({
      ...resource,
      queryContextToken: "x".repeat(16),
    });
    expect(parsed.success).toBe(true);
    expect(resource.pulse).toHaveLength(3);
    expect(resource.insights.length).toBeLessThanOrEqual(3);
    expect(resource.activity.kind).toBe("timeseries");
    if (resource.activity.kind === "timeseries") {
      expect(resource.activity.series[0]?.points.length).toBeGreaterThan(0);
      expect(resource.activity.series[0]?.points.length).toBeLessThanOrEqual(93);
    }
    expect(resource.dataQuality.hasAcceptedData).toBe(true);
    // Evidence grounding (R7-F7): every cited ID resolves and the chart
    // total agrees with the canonical accepted-events fact.
    expect(validateOverviewReferences({ ...resource, queryContextToken: "x".repeat(16) }).ok).toBe(true);
    clearMetricSnapshotCache();
  });

  it("headlines non-pulse detection changes with supporting evidence", async () => {
    const PX = "proj_ov_nonpulse";
    // No web_page_views rows: every Web fact is flat zero while accepted
    // events (detection-only for this capability mix) move 30 vs 10.
    for (let n = 0; n < 30; n += 1) {
      await seedEvent({ id: `np${n}`, project: PX, occurred: FROM + n * 1000 });
    }
    for (let n = 0; n < 10; n += 1) {
      await seedEvent({ id: `npp${n}`, project: PX, occurred: CFROM + n * 1000 });
    }
    const caps = capabilitiesFor({
      web: true,
      errorCollection: { configured: true, observed: false },
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities: caps,
      deps: { capabilities: caps, now: NOW },
    });
    const pulseIds = new Set(resource.pulse.map((fact) => fact.metricId));
    expect(pulseIds.has("project.accepted_events")).toBe(false);
    const change = resource.insights.find(
      (insight) => insight.kind === "change" && insight.factIds.length > 0,
    );
    expect(change).toBeDefined();
    const supportingIds = new Set(resource.supportingFacts.map((fact) => fact.id));
    for (const id of change?.factIds ?? []) {
      const inPulse = resource.pulse.some((fact) => fact.id === id);
      expect(inPulse || supportingIds.has(id)).toBe(true);
    }
    expect(validateOverviewReferences({ ...resource, queryContextToken: "x".repeat(16) }).ok).toBe(true);
    clearMetricSnapshotCache();
  });

  it("renders explicit empty states with no significant-change headlines", async () => {
    const PX = "proj_ov_flat";
    for (let n = 0; n < 15; n += 1) {
      await seedEvent({ id: `f${n}`, project: PX, occurred: FROM + n * 1000 });
    }
    for (let n = 0; n < 15; n += 1) {
      await seedEvent({ id: `fp${n}`, project: PX, occurred: CFROM + n * 1000 });
    }
    const capabilities = capabilitiesFor({
      standardEventsObserved: ["sign_up"],
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    expect(
      resource.insights.filter(
        (insight) => insight.kind === "change" || insight.kind === "error",
      ),
    ).toHaveLength(0);
    expect(resource.dataQuality.definitionState).toBe("standard-event");
    expect(resource.dataQuality.definitionLabel).toBe("sign_up");
    clearMetricSnapshotCache();
  });

  it("surfaces error issues in secondary and headlines with snapshot semantics", async () => {
    const PX = "proj_ov_err";
    for (let n = 0; n < 5; n += 1) {
      await seedEvent({ id: `e${n}`, project: PX, occurred: FROM + n });
    }
    await seedIssue("iss_new", "New crash");
    await exec(`UPDATE error_issues SET project_id = ? WHERE id = 'iss_new'`, [PX]);
    for (let n = 0; n < 5; n += 1) {
      await seedOcc(`n${n}`, "iss_new", FROM + 100 + n);
    }
    await exec(`UPDATE error_occurrences SET project_id = ? WHERE id LIKE 'n%'`, [PX]);
    const capabilities = capabilitiesFor({
      errorCollection: { configured: true, observed: true },
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    expect(resource.secondary.kind).toBe("issue-list");
    const errorInsight = resource.insights.find((insight) => insight.kind === "error");
    expect(errorInsight).toBeDefined();
    clearMetricSnapshotCache();
  });

  it("falls back to event ranking when issues are historical-only (R7-F5)", async () => {
    const PX = "proj_ov_hist";
    for (let n = 0; n < 8; n += 1) {
      await seedEvent({ id: `h${n}`, project: PX, occurred: FROM + n * 1000 });
    }
    await seedIssue("iss_hist", "Old crash");
    await exec(`UPDATE error_issues SET project_id = ? WHERE id = 'iss_hist'`, [PX]);
    // Occurrences only in the previous window: current_n is zero.
    for (let n = 0; n < 4; n += 1) {
      await seedOcc(`hh${n}`, "iss_hist", CFROM + 100 + n);
    }
    await exec(`UPDATE error_occurrences SET project_id = ? WHERE id LIKE 'hh%'`, [PX]);
    const capabilities = capabilitiesFor({
      errorCollection: { configured: true, observed: true },
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    // No zero-row Top issues panel: the event ranking renders instead.
    expect(resource.secondary.kind).toBe("ranked-list");
    if (resource.secondary.kind === "ranked-list") {
      expect(resource.secondary.entity).toBe("event");
      expect(resource.secondary.rows.length).toBeGreaterThan(0);
    }
    expect(
      resource.insights.filter((insight) => insight.kind === "error"),
    ).toHaveLength(0);
    clearMetricSnapshotCache();
  });

  it("uses real release metadata for the defensive release fallback", async () => {
    const PX = "proj_ov_rel";
    for (let n = 0; n < 5; n += 1) {
      await seedEvent({ id: `r${n}`, project: PX, occurred: FROM + n });
    }
    await seedIssue("iss_old", "Old crash", "resolved");
    await exec(`UPDATE error_issues SET project_id = ? WHERE id = 'iss_old'`, [PX]);
    await seedOcc("ro0", "iss_old", FROM + 10, "2.4.1");
    await seedOcc("ro1", "iss_old", FROM + 20, "2.4.1");
    await exec(`UPDATE error_occurrences SET project_id = ? WHERE id LIKE 'ro%'`, [PX]);
    // Error collection off: issues are not read, so real release metadata
    // drives the ranked-list fallback instead of an empty shell.
    const capabilities = capabilitiesFor({
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    expect(resource.secondary.kind).toBe("ranked-list");
    if (resource.secondary.kind === "ranked-list") {
      expect(resource.secondary.entity).toBe("release");
      expect(resource.secondary.rows[0]?.key).toBe("2.4.1");
    }
    const release = resource.insights.find((insight) => insight.kind === "release");
    expect(release?.summary).toContain("associated with");
    clearMetricSnapshotCache();
  });

  it("counts retained events from inactive sources with readiness wording (R7-F4)", async () => {
    const PX = "proj_ov_ready";
    await seedEvent({ id: "rk1", project: PX, occurred: FROM + 1, source: "kept" });
    await seedEvent({ id: "rk2", project: PX, occurred: FROM + 2, source: "retired" });
    const capabilities = capabilitiesFor({
      sources: { total: 2, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    const accepted = resource.pulse.find((fact) => fact.metricId === "project.accepted_events")
      ?? resource.supportingFacts.find((fact) => fact.metricId === "project.accepted_events");
    // Retained historical data from every source stays included.
    expect(accepted?.value).toBe(2);
    expect(resource.dataQuality.warnings.join(" ")).toMatch(/accept new data/);
    expect(resource.dataQuality.warnings.join(" ")).toMatch(/remains included/);
    const coverage = resource.insights.find((insight) => insight.kind === "coverage");
    expect(coverage?.summary).toMatch(/remains included/);
    clearMetricSnapshotCache();
  });

  it("grounds the chart in accepted events for web, mobile, and outcome heads (R7-F7)", async () => {
    const cases: Array<{ id: string; capabilities: ProjectCapabilities }> = [
      {
        id: "web",
        capabilities: capabilitiesFor({
          web: true,
          sources: { total: 1, active: 1, lastReceivedAt: NOW },
        }),
      },
      {
        id: "mobile",
        capabilities: capabilitiesFor({
          mobile: true,
          sources: { total: 1, active: 1, lastReceivedAt: NOW },
        }),
      },
      {
        id: "outcome",
        capabilities: capabilitiesFor({
          standardEventsObserved: ["sign_up"],
          sources: { total: 1, active: 1, lastReceivedAt: NOW },
        }),
      },
    ];
    for (const { id, capabilities } of cases) {
      const PX = `proj_ov_g_${id}`;
      for (let n = 0; n < 6; n += 1) {
        await seedEvent({ id: `g${id}${n}`, project: PX, occurred: FROM + n * 1000 });
      }
      const resource = await buildOverviewResource({
        client: client as unknown as CanonicalClient,
        projectId: PX,
        window: { ...WINDOW },
        scope: { sourceScope: "all", sourceIds: [] },
        capabilities,
        deps: { capabilities, now: NOW },
      });
      expect(resource.activity.kind, id).toBe("timeseries");
      if (resource.activity.kind !== "timeseries") continue;
      const cited = resource.activity.factIds
        .map((factId) => [...resource.pulse, ...resource.supportingFacts].find((fact) => fact.id === factId))
        .find((fact) => fact?.metricId === "project.accepted_events");
      expect(cited, id).toBeDefined();
      expect(cited?.metricId, id).toBe("project.accepted_events");
      const total = resource.activity.series.reduce(
        (sum, entry) => sum + entry.points.reduce((inner, point) => inner + point.value, 0),
        0,
      );
      expect(total, id).toBe(cited?.value);
      expect(
        validateOverviewReferences({ ...resource, queryContextToken: "x".repeat(16) }).ok,
        id,
      ).toBe(true);
      clearMetricSnapshotCache();
    }
  });

  it("detects bounce-rate moves from exact entry-session denominators", async () => {
    const PX = "proj_ov_bounce";
    const pageView = async (
      eventId: string,
      occurred: number,
      session: string,
      seq: number,
      person: string,
    ) => {
      await seedEvent({
        id: eventId,
        project: PX,
        occurred,
        name: "$prism_page_view",
        session,
        person,
      });
      await exec(
        `INSERT INTO web_page_views (project_id, event_id, occurred_at, host, path, navigation_type, page_sequence, is_bot)
         VALUES (?, ?, ?, 'example.com', '/a', 'initial', ?, 0)`,
        [PX, eventId, occurred, seq],
      );
    };
    // Current: 40 single-view (bounced) completed sessions.
    for (let n = 0; n < 40; n += 1) {
      await pageView(`bc${n}`, FROM + n * 1000, `bcs${n}`, 1, `bcp${n}`);
    }
    // Previous: 40 two-view (engaged) completed sessions.
    for (let n = 0; n < 40; n += 1) {
      await pageView(`bp${n}a`, CFROM + n * 1000, `bps${n}`, 1, `bpp${n}`);
      await pageView(`bp${n}b`, CFROM + n * 1000 + 60_000, `bps${n}`, 2, `bpp${n}`);
    }
    const caps = capabilitiesFor({
      web: true,
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities: caps,
      deps: { capabilities: caps, now: NOW },
    });
    const bounce = resource.insights.find(
      (insight) => insight.id === "rate-web.bounce_rate",
    );
    expect(bounce).toBeDefined();
    expect(bounce?.summary).toMatch(/40 eligible records/);
    expect(validateOverviewReferences({ ...resource, queryContextToken: "x".repeat(16) }).ok).toBe(true);
    clearMetricSnapshotCache();
  });

  it("never references Live preview storage", async () => {
    const seen: string[] = [];
    const counting = {
      execute: async (input: { sql: string; args: Array<string | number | null> }) => {
        seen.push(input.sql.toLowerCase());
        return (client as unknown as CanonicalClient).execute(input);
      },
    } as unknown as CanonicalClient;
    const capabilities = capabilitiesFor({
      web: true,
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    await buildOverviewResource({
      client: counting,
      projectId: "proj_ov_live",
      window: { ...WINDOW },
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const sql of seen) {
      expect(sql).not.toContain("live");
      expect(sql).not.toContain("preview");
    }
    clearMetricSnapshotCache();
  });

  it("reads sequentially and honors the verified scope", async () => {
    const PX = "proj_ov_scope";
    await seedEvent({ id: "sc1", project: PX, occurred: FROM + 1, source: "kept" });
    await seedEvent({ id: "sc2", project: PX, occurred: FROM + 2, source: "dropped" });
    const capabilities = capabilitiesFor({
      sources: { total: 2, active: 2, lastReceivedAt: NOW },
    });
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window: { ...WINDOW },
      scope: { sourceScope: "selected", sourceIds: ["kept"] },
      capabilities,
      deps: { capabilities, now: NOW },
    });
    expect(resource.queryContext.sourceScope).toBe("selected");
    expect(resource.queryContext.sourceIds).toEqual(["kept"]);
    clearMetricSnapshotCache();
  });
});

describe("overview helpers", () => {
  it("buckets hourly/daily/weekly on the frozen thresholds", () => {
    expect(trendBucketForOverview(FROM, FROM + 24 * 3_600_000).bucket).toBe("hourly");
    expect(trendBucketForOverview(FROM, FROM + 7 * 86_400_000).bucket).toBe("daily");
    expect(trendBucketForOverview(FROM, FROM + 100 * 86_400_000).bucket).toBe("weekly");
  });

  it("builds data-quality states explicitly", () => {
    const missing = buildDataQuality({
      hasAcceptedData: false,
      capabilities: capabilitiesFor(),
      warnings: ["a", "b"],
    });
    expect(missing).toEqual({
      hasAcceptedData: false,
      definitionState: "missing",
      definitionLabel: null,
      warnings: ["a", "b"],
    });
    const confirmed = buildDataQuality({
      hasAcceptedData: true,
      capabilities: capabilitiesFor({ standardEventsObserved: ["sign_up"] }),
      warnings: [],
    });
    expect(confirmed.definitionState).toBe("standard-event");
    expect(confirmed.definitionLabel).toBe("sign_up");
  });

  it("resolves the canonical window for overview ranges", () => {
    const window = resolveMetricWindow(NOW, "7d");
    expect(window.to - window.from).toBe(7 * 86_400_000);
    expect(window.from - window.compareFrom).toBe(7 * 86_400_000);
  });

  it("derives previous windows with the same cutoff", () => {
    const previous = previousWindowOf({ ...WINDOW });
    expect(previous.from).toBe(CFROM);
    expect(previous.to).toBe(FROM);
    expect(previous.asOf).toBe(NOW);
    expect(previous.to - previous.from).toBe(SPAN);
  });
});
