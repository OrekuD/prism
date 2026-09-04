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
  resolveMetricWindow,
  type CanonicalClient,
  type MetricWindow,
} from "../utils/projectMetrics";
import {
  buildDataQuality,
  buildOverviewResource,
  selectInsights,
  selectPulsePlans,
  trendBucketForOverview,
  type OverviewIssueRow,
  type OverviewReleaseRow,
} from "../utils/projectOverview";

/**
 * Deterministic overview tests (Task 21 slice 3): REAL in-memory libSQL
 * with the ACTUAL analytics migrations. Pulse stability, insight
 * eligibility/ranking/wording, activity/secondary selection, data-quality,
 * replayable gating, and the Live-preview exclusion are all exercised
 * against production SQL — never mocked aggregates.
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
}) {
  await exec(
    `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
      received_at, session_id, anonymous_id, user_id, person_id, properties,
      context, sdk_name, sdk_version, source_id, platform)
     VALUES (?, ?, 'track', ?, 1, ?, ?, NULL, ?, NULL, NULL, '{}', NULL, NULL, NULL, ?, 'web')`,
    [
      row.id,
      row.project ?? P,
      row.name ?? "click",
      row.occurred,
      row.received ?? row.occurred,
      `anon-${row.id}`,
      row.source ?? "s1",
    ],
  );
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
      // Deterministic for identical capabilities.
      expect(selectPulsePlans(capabilities), label).toEqual(plans);
      // Web projects surface Web; mobile projects surface Mobile;
      // error-configured projects surface reliability.
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
      // Never a multi-row currency metric (pulse is 1:1).
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

  it("keeps slots stable when values collapse to temporary zeros", async () => {
    const capabilities = capabilitiesFor({
      web: true,
      errorCollection: { configured: true, observed: true },
      sources: { total: 1, active: 1, lastReceivedAt: NOW },
    });
    const before = selectPulsePlans(capabilities).map((p) => p.metricId);
    // Same capabilities after data disappears must not rearrange.
    const after = selectPulsePlans(capabilities).map((p) => p.metricId);
    expect(after).toEqual(before);
    clearMetricSnapshotCache();
  });
});

describe("insight eligibility and ranking", () => {
  it("suppresses low-volume changes and promotes eligible ones", () => {
    const queryContext = contextFor();
    // Observed outcome suppresses the definition signal so change
    // eligibility is isolated.
    const capabilities = capabilitiesFor({ standardEventsObserved: ["sign_up"] });
    const changesOf = (facts: MetricFact[]) =>
      selectInsights({
        facts,
        capabilities,
        issues: [],
        releases: [],
        queryContext,
        observedAt: NOW,
      }).filter((insight) => insight.kind === "change");
    const low = changesOf([countFact("project.accepted_events", 3, 2)]);
    expect(low).toHaveLength(0);

    const smallAbsolute = changesOf([countFact("project.accepted_events", 12, 10)]);
    expect(smallAbsolute).toHaveLength(0);

    const smallRatio = changesOf([countFact("project.accepted_events", 100, 95)]);
    expect(smallRatio).toHaveLength(0);

    const eligible = selectInsights({
      facts: [countFact("project.accepted_events", 30, 10)],
      capabilities,
      issues: [],
      releases: [],
      queryContext,
      observedAt: NOW,
    });
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.kind).toBe("change");
    expect(eligible[0]?.askPrompt.length).toBeGreaterThan(0);
  });

  it("treats sufficient prior-zero volume as a headline change, not silence", () => {
    const capabilities = capabilitiesFor({ standardEventsObserved: ["sign_up"] });
    const insights = selectInsights({
      facts: [countFact("project.accepted_events", 25, 0)],
      capabilities,
      issues: [],
      releases: [],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    const changes = insights.filter((insight) => insight.kind === "change");
    expect(changes).toHaveLength(1);
  });

  it("never feeds current-only facts into headlines", () => {
    expect(isSnapshotReplayable("errors.unresolved_issues")).toBe(false);
    const unresolved = countFact("errors.unresolved_issues", 50, 10);
    const insights = selectInsights({
      facts: [unresolved],
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
    const capabilities = capabilitiesFor({ standardEventsObserved: ["sign_up"] });
    const thin: OverviewIssueRow[] = [
      { id: "thin", title: "Thin", status: "unresolved", current: 2, previous: 0, users: 2, snapshotFirstSeen: FROM + 10 },
    ];
    expect(
      selectInsights({ facts: [], capabilities, issues: thin, releases: [], queryContext, observedAt: NOW }).filter((insight) => insight.kind === "error"),
    ).toHaveLength(0);
    const eligible: OverviewIssueRow[] = [
      { id: "thick", title: "Thick", status: "unresolved", current: 5, previous: 0, users: 4, snapshotFirstSeen: FROM + 10 },
    ];
    const insights = selectInsights({ facts: [], capabilities, issues: eligible, releases: [], queryContext, observedAt: NOW });
    expect(insights.filter((insight) => insight.kind === "error")).toHaveLength(1);
  });

  it("ranks critical before attention before info with stable IDs", () => {
    const queryContext = contextFor();
    const insights = selectInsights({
      facts: [
        countFact("project.accepted_events", 30, 10, "a-change"),
        countFact("web.page_views", 200, 50, "b-change"),
      ],
      capabilities: capabilitiesFor(),
      issues: [],
      releases: [{ release: "1.0", count: 4 }],
      queryContext,
      observedAt: NOW,
    });
    expect(insights.length).toBeLessThanOrEqual(3);
    const severities = insights.map((insight) => insight.severity);
    const rank = (severity: string) =>
      severity === "critical" ? 0 : severity === "attention" ? 1 : 2;
    for (let index = 1; index < severities.length; index += 1) {
      const current = severities[index];
      const prior = severities[index - 1];
      if (current === undefined || prior === undefined) continue;
      expect(rank(current)).toBeGreaterThanOrEqual(rank(prior));
    }
  });

  it("caps headlines at three", () => {
    const insights = selectInsights({
      facts: [
        countFact("project.accepted_events", 100, 10, "f1"),
        countFact("web.page_views", 200, 20, "f2"),
        countFact("mobile.app_opens", 300, 30, "f3"),
        countFact("errors.occurrences", 400, 40, "f4"),
      ],
      capabilities: capabilitiesFor(),
      issues: [],
      releases: [{ release: "9.9", count: 9 }],
      queryContext: contextFor(),
      observedAt: NOW,
    });
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it("words coverage with a named dimension and measured share, never event loss", () => {
    const insights = selectInsights({
      facts: [],
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
    expect(coverage?.summary.toLowerCase()).not.toContain("lost");
    expect(coverage?.summary.toLowerCase()).not.toContain("loss");
  });

  it("words releases associationally, never causally", () => {
    const releases: OverviewReleaseRow[] = [{ release: "2.4.1", count: 7 }];
    const insights = selectInsights({
      facts: [],
      capabilities: capabilitiesFor(),
      issues: [],
      releases,
      queryContext: contextFor(),
      observedAt: NOW,
    });
    const release = insights.find((insight) => insight.kind === "release");
    expect(release).toBeDefined();
    expect(release?.summary).toContain("associated with");
    expect(containsCausalClaim(release?.summary ?? "")).toBe(false);
    expect(containsCausalClaim(release?.title ?? "")).toBe(false);
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
    const window = { ...WINDOW };
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: PX,
      window,
      scope: { sourceScope: "all", sourceIds: [] },
      capabilities: capabilitiesFor({
        web: true,
        sources: { total: 1, active: 1, lastReceivedAt: NOW },
      }),
      deps: {
        capabilities: capabilitiesFor({
          web: true,
          sources: { total: 1, active: 1, lastReceivedAt: NOW },
        }),
        now: NOW,
      },
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
    clearMetricSnapshotCache();
  });

  it("renders explicit empty states with no significant-change headlines", async () => {
    const PX = "proj_ov_flat";
    // Flat eligible-volume traffic: 15 vs 15 is ineligible (no change).
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
    // Observed outcome suppresses the definition signal; flat traffic and
    // no issues/releases/coverage gaps leave zero headlines — the calm
    // "no significant changes" state the UI renders from [].
    expect(resource.insights).toHaveLength(0);
    expect(resource.dataQuality.definitionState).toBe("standard-event");
    expect(resource.dataQuality.definitionLabel).toBe("sign_up");
    clearMetricSnapshotCache();
  });

  it("surfaces error issues in secondary and headlines with snapshot semantics", async () => {
    const PX = "proj_ov_err";
    // Baseline traffic so activity is non-empty.
    for (let n = 0; n < 5; n += 1) {
      await seedEvent({ id: `e${n}`, project: PX, occurred: FROM + n });
    }
    await seedIssue("iss_new", "New crash");
    await exec(
      `UPDATE error_issues SET project_id = ? WHERE id IN ('iss_new')`,
      [PX],
    );
    for (let n = 0; n < 5; n += 1) {
      await seedOcc(`n${n}`, "iss_new", FROM + 100 + n);
    }
    await exec(
      `UPDATE error_occurrences SET project_id = ? WHERE id LIKE 'n%'`,
      [PX],
    );
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

  it("uses real release metadata for secondary when issues are absent", async () => {
    const PX = "proj_ov_rel";
    for (let n = 0; n < 5; n += 1) {
      await seedEvent({ id: `r${n}`, project: PX, occurred: FROM + n });
    }
    await seedIssue("iss_old", "Old crash", "resolved");
    await exec(`UPDATE error_issues SET project_id = ? WHERE id = 'iss_old'`, [PX]);
    await seedOcc("ro0", "iss_old", FROM + 10, "2.4.1");
    await seedOcc("ro1", "iss_old", FROM + 20, "2.4.1");
    await exec(`UPDATE error_occurrences SET project_id = ? WHERE id LIKE 'ro%'`, [PX]);
    // No error collection: issues are not read, so real release metadata
    // drives the ranked-list secondary instead of an empty shell.
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
});
