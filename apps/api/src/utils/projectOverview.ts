import {
  areQueryContextsEqual,
  compareInsightRank,
  containsCausalClaim,
  isCountChangeEligible,
  isIssueSignalEligible,
  isSnapshotReplayable,
  METRIC_REGISTRY,
  NON_CAUSAL_PHRASES,
  RELEASE_AFTER_WORDING,
  INSIGHT_THRESHOLDS,
  type ActivityArtifact,
  type AssistantArtifact,
  type InsightCandidate,
  type InsightKind,
  type InsightSeverity,
  type MetricFact,
  type MetricId,
  type ProjectCapabilities,
  type ProjectOverviewResource,
  type PublicQueryContext,
  type SecondaryArtifact,
  type DataQualitySummary,
} from "@prism-analytics/types";
import {
  measureMetrics,
  resolveMetricWindow,
  type CanonicalClient,
  type MeasureDeps,
  type MetricFilters,
  type MetricRange,
  type MetricScope,
  type MetricWindow,
} from "./projectMetrics";

/**
 * Deterministic insight detection + adaptive overview resource
 * (Task 21 slice 3).
 *
 * Boundaries:
 * - Insights rank facts from the SAME canonical snapshot as pulse/activity.
 *   Only `isSnapshotReplayable()` metrics feed change/error selection;
 *   `current-only` facts (errors.unresolved_issues) never drive headlines.
 * - Pulse slot selection is capability-only so a temporary zero never
 *   reorders the dashboard for identical capabilities.
 * - Activity/secondary derive from the analytics store with the same
 *   half-open `[from, to)` + `received_at <= asOf` + verified scope
 *   semantics as slice 2. Projection joins bound via `asOf`.
 * - Reads run SEQUENTIALLY (libSQL HTTP under Workers). No `Promise.all`.
 * - Never reads Live preview state: only `events`, `error_*`,
 *   `web_page_views`, `mobile_*`, and `external_identities`. There is no
 *   live/preview table in the analytics schema; a regression asserts no
 *   overview SQL references one.
 * - Release wording is associational only ("associated with"); a
 *   `containsCausalClaim` guard pins it in tests.
 */

export type PulsePlan = { metricId: MetricId; filters?: MetricFilters };

/**
 * Stable adaptive pulse selection (capability-only, exactly 3).
 *
 * 1. Prefer the first sorted observed Standard Event as the key outcome
 *    (`standard_event.occurrences` + exact key filter).
 * 2. Include one audience/usage metric supported by actual sources
 *    (web → page views, mobile → app opens, else accepted events).
 * 3. Include reliability when error collection is configured or observed.
 * 4. Fill with the strongest supported Web/Mobile/Standard Event metric.
 * 5. Identical capabilities always yield identical slots (no value input).
 */
export function selectPulsePlans(
  capabilities: ProjectCapabilities,
): [PulsePlan, PulsePlan, PulsePlan] {
  const plans: PulsePlan[] = [];
  const pushUnique = (plan: PulsePlan): void => {
    const key = `${plan.metricId}|${plan.filters?.standardEventKey ?? ""}`;
    if (
      plans.some(
        (p) => `${p.metricId}|${p.filters?.standardEventKey ?? ""}` === key,
      )
    )
      return;
    if (plans.length < 3) plans.push(plan);
  };

  const observed = [...capabilities.standardEventsObserved].sort();
  if (observed.length > 0 && observed[0]) {
    pushUnique({
      metricId: "standard_event.occurrences",
      filters: { standardEventKey: observed[0] },
    });
  }
  if (capabilities.web) {
    pushUnique({ metricId: "web.page_views" });
  } else if (capabilities.mobile) {
    pushUnique({ metricId: "mobile.app_opens" });
  } else {
    pushUnique({ metricId: "project.accepted_events" });
  }
  if (
    capabilities.errorCollection.configured ||
    capabilities.errorCollection.observed
  ) {
    pushUnique({ metricId: "errors.occurrences" });
  }
  // Deterministic fill order: strongest supported first, then canonical
  // project fallbacks. Never a multi-row currency metric (pulse is 1:1).
  const fill: PulsePlan[] = [];
  if (capabilities.web) fill.push({ metricId: "web.sessions" });
  if (capabilities.mobile) fill.push({ metricId: "mobile.sessions" });
  if (observed.length > 1 && observed[1]) {
    fill.push({
      metricId: "standard_event.occurrences",
      filters: { standardEventKey: observed[1] },
    });
  }
  fill.push(
    { metricId: "project.accepted_events" },
    { metricId: "project.sessions" },
    { metricId: "project.active_people" },
    { metricId: "errors.occurrences" },
  );
  for (const plan of fill) {
    if (plans.length >= 3) break;
    // Skip metrics whose collection requirement is unmet — except the
    // project-domain fallbacks (no requirements) which always render
    // honest zeros rather than a missing slot.
    const requirements =
      METRIC_REGISTRY[plan.metricId].sourceRequirements;
    let supported = true;
    for (const requirement of requirements) {
      if (requirement === "web_collection" && !capabilities.web)
        supported = false;
      if (requirement === "mobile_collection" && !capabilities.mobile)
        supported = false;
      if (
        requirement === "error_collection" &&
        !capabilities.errorCollection.configured &&
        !capabilities.errorCollection.observed
      )
        supported = false;
    }
    if (!supported) continue;
    pushUnique(plan);
  }
  while (plans.length < 3) {
    const fallback: PulsePlan =
      plans.length === 0
        ? { metricId: "project.accepted_events" }
        : plans.length === 1
          ? { metricId: "project.sessions" }
          : { metricId: "project.active_people" };
    if (
      plans.some(
        (p) =>
          p.metricId === fallback.metricId &&
          (p.filters?.standardEventKey ?? "") === "",
      )
    )
      break;
    plans.push(fallback);
  }
  const first = plans[0];
  const second = plans[1];
  const third = plans[2];
  if (!first || !second || !third) {
    throw new Error("pulse selection must yield three plans");
  }
  return [first, second, third];
}

/** Bucket for the primary trend (same thresholds as Web analytics). */
export function trendBucketForOverview(
  from: number,
  to: number,
): { bucket: "hourly" | "daily" | "weekly"; ms: number } {
  const span = to - from;
  if (span <= 26 * 3_600_000) return { bucket: "hourly", ms: 3_600_000 };
  if (span <= 91 * 86_400_000) return { bucket: "daily", ms: 86_400_000 };
  return { bucket: "weekly", ms: 7 * 86_400_000 };
}

export type OverviewIssueRow = {
  id: string;
  title: string;
  status: "unresolved" | "resolved" | "ignored";
  current: number;
  previous: number;
  users: number;
  snapshotFirstSeen: number | null;
};

export type OverviewReleaseRow = { release: string; count: number };

function previousOfFact(fact: MetricFact): number | null {
  if (fact.value === null) return null;
  const comparison = fact.comparison;
  if (!comparison) return null;
  if (comparison.kind === "no-prior-data") return null;
  if (comparison.kind === "new") return 0;
  if (
    comparison.kind === "percent" &&
    comparison.direction === "flat" &&
    (comparison.percent ?? 0) === 0
  ) {
    return fact.value;
  }
  if (comparison.kind === "percent" && typeof comparison.percent === "number") {
    const ratio = 1 + comparison.percent / 100;
    if (ratio <= 0) return null;
    return Math.max(0, Math.round(fact.value / ratio));
  }
  return null;
}

function formatDirection(comparison: MetricFact["comparison"]): string {
  if (!comparison || comparison.kind !== "percent") return "changed";
  if (comparison.direction === "up") return `up ${comparison.percent}%`;
  if (comparison.direction === "down")
    return `down ${Math.abs(comparison.percent ?? 0)}%`;
  return "flat";
}

function severityForChange(current: number, previous: number): InsightSeverity {
  const absolute = Math.abs(current - previous);
  const ratio = previous === 0 ? 1 : absolute / previous;
  if (ratio >= 1 || absolute >= 100) return "critical";
  if (ratio >= 0.5 || absolute >= 20) return "attention";
  return "info";
}

/**
 * Deterministic insight selection (pure, testable).
 *
 * Inputs are same-snapshot facts plus bounded issue/release derivations.
 * - Change: replayable count facts with eligible current/previous.
 * - Error: new/regressing issues with >=3 current occurrences.
 * - Coverage: inactive sources name the source dimension + measured share.
 * - Definition: missing outcome when nothing observed/confirmed.
 * - Release: observed release stated associationally, never causally.
 * Ranked by severity/recency/stable ID, capped at 3.
 */
export function selectInsights(input: {
  facts: readonly MetricFact[];
  capabilities: ProjectCapabilities;
  issues: readonly OverviewIssueRow[];
  releases: readonly OverviewReleaseRow[];
  queryContext: PublicQueryContext;
  observedAt: number;
}): InsightCandidate[] {
  const { facts, capabilities, issues, releases, queryContext, observedAt } =
    input;
  const candidates: InsightCandidate[] = [];

  for (const fact of facts) {
    if (!isSnapshotReplayable(fact.metricId)) continue;
    const definition = METRIC_REGISTRY[fact.metricId];
    if (definition.valueKind !== "count") continue;
    if (fact.value === null) continue;
    const previous = previousOfFact(fact);
    if (previous === null) continue;
    if (!isCountChangeEligible(fact.value, previous)) continue;
    const direction = formatDirection(fact.comparison);
    const severity = severityForChange(fact.value, previous);
    const title = `${definition.label} ${direction} vs previous period`;
    const summary = `${definition.label} moved from ${previous} to ${fact.value} in this period (${direction}). Evidence: ${fact.formattedValue}.`;
    const id = `change-${fact.metricId}`;
    const artifact: AssistantArtifact = {
      kind: "metric",
      id: `artifact-${id}`,
      title: definition.label,
      summary: `${definition.label}: ${fact.formattedValue} (${direction}).`,
      factIds: [fact.id],
      queryContext,
      drilldown: fact.drilldown,
      fact,
    };
    candidates.push({
      id,
      kind: "change",
      severity,
      title: title.slice(0, 140),
      summary: summary.slice(0, 500),
      factIds: [fact.id].slice(0, 8),
      artifact,
      drilldown: fact.drilldown,
      askPrompt: `What changed in ${definition.label.toLowerCase()}?`.slice(
        0,
        280,
      ),
      observedAt,
    });
  }

  for (const issue of issues) {
    if (!isIssueSignalEligible(issue.current)) continue;
    const isNew =
      issue.snapshotFirstSeen !== null &&
      issue.snapshotFirstSeen >= queryContext.from &&
      issue.snapshotFirstSeen < queryContext.to;
    const isRegressing =
      !isNew && issue.previous > 0 && issue.current > issue.previous;
    if (!isNew && !isRegressing) continue;
    const kind: InsightKind = "error";
    const severity: InsightSeverity = isNew ? "attention" : "critical";
    const label = isNew ? "New issue" : "Regressing issue";
    const id = `error-${issue.id}`;
    const artifact: AssistantArtifact = {
      kind: "issue-list",
      id: `artifact-${id}`,
      title: label,
      summary: `${issue.title}: ${issue.current} occurrences, ${issue.users} affected.`,
      factIds: [],
      queryContext,
      drilldown: { destination: "errors", label: "Open Errors" },
      issues: [
        {
          id: issue.id,
          title: issue.title.slice(0, 200),
          status: issue.status,
          count: issue.current,
          users: issue.users,
          delta: isNew ? "new" : "regressing",
          drilldown: {
            destination: "errors-issue",
            label: "Open issue",
            issueId: issue.id,
          },
        },
      ],
    };
    candidates.push({
      id,
      kind,
      severity,
      title: `${label}: ${issue.title}`.slice(0, 140),
      summary: `${issue.title} has ${issue.current} occurrences in this period (${isNew ? "first seen here" : `up from ${issue.previous}`}).`.slice(
        0,
        500,
      ),
      factIds: [],
      artifact,
      drilldown: { destination: "errors", label: "Open Errors" },
      askPrompt: "What are the largest unresolved errors?",
      observedAt,
    });
  }

  if (
    capabilities.sources.total > 0 &&
    capabilities.sources.active < capabilities.sources.total
  ) {
    const coveragePercent =
      Math.round(
        (capabilities.sources.active / capabilities.sources.total) * 1000,
      ) / 10;
    const id = "coverage-sources";
    const summary = `Source dimension coverage is ${coveragePercent}% (${capabilities.sources.active} of ${capabilities.sources.total} sources active). Only active sources contribute data in this period.`;
    const artifact: AssistantArtifact = {
      kind: "coverage",
      id: `artifact-${id}`,
      title: "Source coverage",
      summary: summary.slice(0, 500),
      factIds: [],
      queryContext,
      drilldown: { destination: "sources", label: "Open Sources" },
      coverage: {
        sourcesConfigured: capabilities.sources.total,
        sourcesActive: capabilities.sources.active,
        enrichments: [],
        warnings: [],
      },
    };
    candidates.push({
      id,
      kind: "coverage",
      severity: "info",
      title: "Some sources are inactive",
      summary: summary.slice(0, 500),
      factIds: [],
      artifact,
      drilldown: { destination: "sources", label: "Open Sources" },
      askPrompt: "Which sources are sending data?".slice(0, 280),
      observedAt,
    });
  }

  if (
    capabilities.standardEventsObserved.length === 0 &&
    !capabilities.errorCollection.configured &&
    !capabilities.errorCollection.observed
  ) {
    const id = "definition-key-outcome";
    const artifact: AssistantArtifact = {
      kind: "definition",
      id: `artifact-${id}`,
      title: "Define a key outcome",
      summary:
        "No key outcome is confirmed yet. Confirm signup or activation so the overview can track it.",
      factIds: [],
      queryContext,
      drilldown: { destination: "overview", label: "Open Overview" },
      proposalId: "pending-key-outcome",
      memoryKey: "key-outcome-definition",
      description:
        "Confirm which Standard Event represents the project's key outcome.",
      status: "proposed",
    };
    candidates.push({
      id,
      kind: "definition",
      severity: "info",
      title: "Define a key outcome to track",
      summary:
        "No key outcome is confirmed yet. Confirm one so the pulse can track what matters.",
      factIds: [],
      artifact,
      drilldown: { destination: "overview", label: "Open Overview" },
      askPrompt: "How do I define signup for this project?",
      observedAt,
    });
  }

  const topRelease = [...releases].sort((a, b) =>
    b.count !== a.count
      ? b.count - a.count
      : a.release < b.release
        ? -1
        : 1,
  )[0];
  if (topRelease) {
    const wording = RELEASE_AFTER_WORDING;
    void NON_CAUSAL_PHRASES;
    const summary = `Release ${topRelease.release} was observed ${wording} ${topRelease.count} occurrences in this period. Co-occurrence only.`;
    if (!containsCausalClaim(summary)) {
      const id = `release-${topRelease.release}`;
      const artifact: AssistantArtifact = {
        kind: "ranked-list",
        id: `artifact-${id}`,
        title: "Observed releases",
        summary: summary.slice(0, 500),
        factIds: [],
        queryContext,
        drilldown: { destination: "errors", label: "Open Errors" },
        entity: "release",
        rows: releases.slice(0, 10).map((row) => ({
          key: row.release.slice(0, 200),
          label: row.release.slice(0, 200),
          value: row.count,
          sharePercent: null,
        })),
      };
      candidates.push({
        id,
        kind: "release",
        severity: "info",
        title: `Release ${topRelease.release} observed`,
        summary: summary.slice(0, 500),
        factIds: [],
        artifact,
        drilldown: {
          destination: "errors",
          label: "Open Errors",
          filters: { release: topRelease.release.slice(0, 64) },
        },
        askPrompt: `Did errors rise after release ${topRelease.release}?`.slice(
          0,
          280,
        ),
        observedAt,
      });
    }
  }

  candidates.sort(compareInsightRank);
  return candidates.slice(0, INSIGHT_THRESHOLDS.maxInsights);
}

export function buildDataQuality(input: {
  hasAcceptedData: boolean;
  capabilities: ProjectCapabilities;
  warnings: string[];
}): DataQualitySummary {
  const observed = [...input.capabilities.standardEventsObserved].sort();
  return {
    hasAcceptedData: input.hasAcceptedData,
    definitionState: observed.length > 0 ? "standard-event" : "missing",
    definitionLabel: observed[0] ?? null,
    warnings: input.warnings.slice(0, 8),
  };
}

async function readActivitySeries(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scope: MetricScope,
): Promise<{ bucket: "hourly" | "daily" | "weekly"; points: { t: number; value: number }[] }> {
  const { bucket, ms } = trendBucketForOverview(window.from, window.to);
  // Explicit empty intersection: honest zeros without touching storage.
  if (scope.sourceScope === "selected" && scope.sourceIds.length === 0) {
    const points: { t: number; value: number }[] = [];
    for (let t = Math.floor(window.from / ms) * ms; t < window.to; t += ms) {
      points.push({ t, value: 0 });
      if (points.length >= 93) break;
    }
    return { bucket, points };
  }
  const clauses = [
    "project_id = ?",
    "occurred_at >= ?",
    "occurred_at < ?",
    "received_at <= ?",
  ];
  const args: Array<string | number | null> = [
    projectId,
    window.from,
    window.to,
    window.asOf,
  ];
  if (scope.sourceScope === "selected" && scope.sourceIds.length > 0) {
    clauses.push(`source_id IN (${scope.sourceIds.map(() => "?").join(",")})`);
    args.push(...scope.sourceIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT (occurred_at / ?) * ? AS bucket_start, COUNT(*) AS n FROM events
          WHERE ${clauses.join(" AND ")} GROUP BY bucket_start ORDER BY bucket_start ASC`,
    args: [ms, ms, ...args],
  });
  const byBucket = new Map<number, number>();
  for (const row of rows) {
    const start = Math.floor(Number(row.bucket_start ?? 0) / ms) * ms;
    byBucket.set(start, Number(row.n ?? 0));
  }
  const points: { t: number; value: number }[] = [];
  for (
    let t = Math.floor(window.from / ms) * ms;
    t < window.to;
    t += ms
  ) {
    points.push({ t, value: byBucket.get(t) ?? 0 });
    if (points.length >= 93) break;
  }
  return { bucket, points };
}

async function readTopEvents(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scope: MetricScope,
  limit = 10,
): Promise<{ name: string; count: number }[]> {
  if (scope.sourceScope === "selected" && scope.sourceIds.length === 0) {
    return [];
  }
  const clauses = [
    "project_id = ?",
    "occurred_at >= ?",
    "occurred_at < ?",
    "received_at <= ?",
  ];
  const args: Array<string | number | null> = [
    projectId,
    window.from,
    window.to,
    window.asOf,
  ];
  if (scope.sourceScope === "selected" && scope.sourceIds.length > 0) {
    clauses.push(`source_id IN (${scope.sourceIds.map(() => "?").join(",")})`);
    args.push(...scope.sourceIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT name AS name, COUNT(*) AS n FROM events
          WHERE ${clauses.join(" AND ")} GROUP BY name ORDER BY n DESC, name ASC LIMIT ?`,
    args: [...args, limit],
  });
  return rows.map((row) => ({
    name: String(row.name ?? ""),
    count: Number(row.n ?? 0),
  }));
}

async function readIssueRows(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  limit = 10,
  scope?: MetricScope,
): Promise<OverviewIssueRow[]> {
  if (scope?.sourceScope === "selected" && scope.sourceIds.length === 0) {
    return [];
  }
  const sourceFilter =
    scope?.sourceScope === "selected" && scope.sourceIds.length > 0
      ? `AND o.source_id IN (${scope.sourceIds.map(() => "?").join(",")})`
      : "";
  const sourceArgs =
    scope?.sourceScope === "selected" && scope.sourceIds.length > 0
      ? [...scope.sourceIds]
      : [];
  const { rows } = await client.execute({
    sql: `SELECT i.id AS id, i.title AS title, i.status AS status,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN 1 ELSE 0 END) AS current_n,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN 1 ELSE 0 END) AS previous_n,
            MIN(CASE WHEN o.received_at <= ? ${sourceFilter} THEN o.occurred_at END) AS snapshot_first_seen,
            COUNT(DISTINCT CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN o.anonymous_id END) AS users_n
          FROM error_issues i LEFT JOIN error_occurrences o
            ON o.issue_id = i.id AND o.project_id = i.project_id
          WHERE i.project_id = ? GROUP BY i.id, i.title, i.status
          ORDER BY current_n DESC, id ASC LIMIT ?`,
    args: [
      window.from,
      window.to,
      window.asOf,
      ...sourceArgs,
      window.compareFrom,
      window.compareTo,
      window.asOf,
      ...sourceArgs,
      window.asOf,
      ...sourceArgs,
      window.from,
      window.to,
      window.asOf,
      ...sourceArgs,
      projectId,
      limit,
    ],
  });
  return rows.map((row) => {
    const status = String(row.status ?? "unresolved");
    return {
      id: String(row.id ?? ""),
      title: String(row.title ?? "Untitled issue"),
      status:
        status === "resolved" || status === "ignored"
          ? status
          : ("unresolved" as const),
      current: Number(row.current_n ?? 0),
      previous: Number(row.previous_n ?? 0),
      users: Number(row.users_n ?? 0),
      snapshotFirstSeen:
        row.snapshot_first_seen === null || row.snapshot_first_seen === undefined
          ? null
          : Number(row.snapshot_first_seen),
    };
  });
}

async function readReleases(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scope: MetricScope,
  limit = 10,
): Promise<OverviewReleaseRow[]> {
  if (scope.sourceScope === "selected" && scope.sourceIds.length === 0) {
    return [];
  }
  const clauses = [
    "project_id = ?",
    "occurred_at >= ?",
    "occurred_at < ?",
    "received_at <= ?",
    "release IS NOT NULL",
  ];
  const args: Array<string | number | null> = [
    projectId,
    window.from,
    window.to,
    window.asOf,
  ];
  if (scope.sourceScope === "selected" && scope.sourceIds.length > 0) {
    clauses.push(`source_id IN (${scope.sourceIds.map(() => "?").join(",")})`);
    args.push(...scope.sourceIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT release AS release, COUNT(*) AS n FROM error_occurrences
          WHERE ${clauses.join(" AND ")} GROUP BY release ORDER BY n DESC, release ASC LIMIT ?`,
    args: [...args, limit],
  });
  return rows.map((row) => ({
    release: String(row.release ?? ""),
    count: Number(row.n ?? 0),
  }));
}

/**
 * Build the complete overview resource for one snapshot.
 * Sequential reads only; pulse facts come from the canonical service so
 * dashboard and assistant agree byte-for-byte.
 */
export async function buildOverviewResource(input: {
  client: CanonicalClient;
  projectId: string;
  window: MetricWindow;
  scope: MetricScope;
  capabilities: ProjectCapabilities;
  deps: MeasureDeps;
}): Promise<Omit<ProjectOverviewResource, "queryContextToken">> {
  const { client, projectId, window, scope, capabilities, deps } = input;
  const plans = selectPulsePlans(capabilities);
  // Scope/filter agreement mirrors the metrics controller (R6-F2): the
  // shared scope attaches only where the registry supports `source_ids`
  // so mixed pulse sets return scoped unavailable facts instead of 400.
  const requests = plans.map((plan) => {
    const definition = METRIC_REGISTRY[plan.metricId];
    const filters: MetricFilters = { ...(plan.filters ?? {}) };
    if (
      (definition.supportedFilters as readonly string[]).includes("source_ids")
    ) {
      if (scope.sourceScope === "selected") {
        filters.sourceIds = [...scope.sourceIds];
      } else {
        filters.sourceIds = undefined;
      }
    } else {
      filters.sourceIds = undefined;
    }
    return Object.keys(filters).length > 0
      ? { metricId: plan.metricId, filters }
      : { metricId: plan.metricId };
  });
  const facts = (await measureMetrics(
    client,
    projectId,
    window,
    scope,
    requests,
    deps,
  )) as MetricFact[];
  if (facts.length !== 3) {
    throw new Error("overview pulse must contain exactly three facts");
  }
  const head = facts[0];
  if (!head) throw new Error("overview pulse must contain exactly three facts");
  const queryContext = head.queryContext;
  for (const fact of facts) {
    if (!areQueryContextsEqual(fact.queryContext, queryContext)) {
      throw new Error("overview pulse facts must share one query context");
    }
  }

  // Sequential derivations: activity, issues, releases, top events.
  const series = await readActivitySeries(client, projectId, window, scope);
  const hasAcceptedData = series.points.some((point) => point.value > 0);
  const issues =
    capabilities.errorCollection.configured ||
    capabilities.errorCollection.observed
      ? await readIssueRows(client, projectId, window, 10, scope)
      : [];
  const releases = await readReleases(client, projectId, window, scope, 10);
  const topEvents = await readTopEvents(client, projectId, window, scope, 10);

  const activity: ActivityArtifact = hasAcceptedData
    ? {
        kind: "timeseries",
        id: "activity-accepted-events",
        title: "Accepted events",
        summary: `Accepted events trend (${series.bucket}, ${series.points.length} buckets).`,
        factIds: [head.id],
        queryContext,
        drilldown: { destination: "events", label: "Open Events" },
        bucket: series.bucket,
        series: [
          {
            name: "Accepted events",
            points: series.points.slice(0, 93),
          },
        ],
      }
    : {
        kind: "empty",
        id: "activity-empty",
        title: "No activity yet",
        summary: "No accepted events in this range.",
        factIds: [],
        queryContext,
        drilldown: { destination: "events", label: "Open Events" },
        reason: "No accepted events in the selected range.",
      };

  let secondary: SecondaryArtifact;
  if (issues.length > 0) {
    secondary = {
      kind: "issue-list",
      id: "secondary-issues",
      title: "Top issues",
      summary: `${issues.length} issues by occurrences in this period.`,
      factIds: [],
      queryContext,
      drilldown: { destination: "errors", label: "Open Errors" },
      issues: issues.map((issue) => {
        const isNew =
          issue.snapshotFirstSeen !== null &&
          issue.snapshotFirstSeen >= window.from &&
          issue.snapshotFirstSeen < window.to;
        return {
          id: issue.id,
          title: issue.title,
          status: issue.status,
          count: issue.current,
          users: issue.users,
          delta:
            isNew && issue.current > 0
              ? ("new" as const)
              : !isNew && issue.previous > 0 && issue.current > issue.previous
                ? ("regressing" as const)
                : null,
          drilldown: {
            destination: "errors-issue" as const,
            label: "Open issue",
            issueId: issue.id,
          },
        };
      }),
    };
  } else if (releases.length > 0) {
    secondary = {
      kind: "ranked-list",
      id: "secondary-releases",
      title: "Observed releases",
      summary: `${releases.length} releases observed in this period.`,
      factIds: [],
      queryContext,
      drilldown: { destination: "errors", label: "Open Errors" },
      entity: "release",
      rows: releases.map((row) => ({
        key: row.release,
        label: row.release,
        value: row.count,
        sharePercent: null,
      })),
    };
  } else {
    secondary = {
      kind: "ranked-list",
      id: "secondary-events",
      title: "Top events",
      summary:
        topEvents.length > 0
          ? `${topEvents.length} event names by occurrences.`
          : "No events in this period.",
      factIds: [],
      queryContext,
      drilldown: { destination: "events", label: "Open Events" },
      entity: "event",
      rows: topEvents.map((row) => ({
        key: row.name.slice(0, 200),
        label: row.name.slice(0, 200),
        value: row.count,
        sharePercent: null,
      })),
    };
  }

  const insights = selectInsights({
    facts,
    capabilities,
    issues,
    releases,
    queryContext,
    observedAt: window.to,
  });

  const warnings: string[] = [];
  if (
    capabilities.sources.total > 0 &&
    capabilities.sources.active < capabilities.sources.total
  ) {
    warnings.push(
      `${capabilities.sources.active} of ${capabilities.sources.total} sources active; inactive sources contribute no data.`,
    );
  }
  if (
    capabilities.errorCollection.configured &&
    !capabilities.errorCollection.observed
  ) {
    warnings.push("Error collection is configured but no errors observed.");
  }
  if (capabilities.standardEventsObserved.length === 0) {
    warnings.push("No key outcome confirmed yet.");
  }
  const dataQuality = buildDataQuality({
    hasAcceptedData,
    capabilities,
    warnings,
  });

  const second = facts[1];
  const third = facts[2];
  if (!second || !third) {
    throw new Error("overview pulse must contain exactly three facts");
  }
  return {
    queryContext,
    capabilities,
    insights,
    pulse: [head, second, third],
    activity,
    secondary,
    dataQuality,
  };
}

/** Resolve the canonical window for an overview range key. */
export function resolveOverviewWindow(
  now: number,
  range: MetricRange,
): MetricWindow {
  return resolveMetricWindow(now, range);
}
