import {
  areQueryContextsEqual,
  compareInsightRank,
  containsCausalClaim,
  isCountChangeEligible,
  isIssueSignalEligible,
  isRateChangeEligible,
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
  factIdFor,
  measureMetrics,
  resolveMetricWindow,
  sha256Hex,
  type CanonicalClient,
  type MeasureDeps,
  type MetricFilters,
  type MetricRange,
  type MetricScope,
  type MetricWindow,
} from "./projectMetrics";

/**
 * Deterministic insight detection + adaptive overview resource
 * (Task 21 slice 3, revised per review rounds 7 and 8).
 *
 * Accuracy boundaries:
 * - Change/rate insights consume the STRUCTURED basis on each returned
 *   fact (`comparisonBasis.previousValue` + rate denominators, R8-F3) —
 *   populated by the canonical service in the same pass that computes the
 *   displayed comparison. Rounded percentages are presentation only, and
 *   human-readable text is never the sole carrier of "before".
 * - Rates are canonical percentage-point values (`100` renders as `100%`,
 *   R8-F1): the frozen five-point rule is `5`, display never multiplies by
 *   100, and decimal means stay out of the rate branch until a dedicated
 *   decimal-change rule is frozen.
 * - Detection runs over a bounded capability-driven DETECTION set wider
 *   than the three display pulse slots; referenced non-pulse facts travel
 *   in bounded `supportingFacts` (R7-F2/R8-F4).
 * - One canonical measurement pass per overview (R8-F4): prior values and
 *   denominators come from each domain loader's already-computed
 *   comparison data (plus one bounded prior entry-session aggregate for
 *   bounce). A shared run memo lets the Web/Mobile loaders serve every
 *   metric from one pass each. No previous-window re-measurement.
 * - Pulse slot selection is capability-only, and the observed Standard
 *   Event set is project-level (`received_at <= asOf`), so a temporary
 *   zero keeps its slot (R7-F3).
 * - Source readiness is ingest readiness with an explicit retained-data
 *   statement (R7-F4).
 * - Secondary issues require current-period occurrences
 *   (`HAVING current_n > 0`, R7-F5).
 * - Release identifiers travel whole in filter semantics (128-char bound);
 *   only display copy shortens, and bounded IDs carry a truncated
 *   server-only SHA-256 digest over a domain-separated value (R7-F6/R8-F5).
 * - The activity chart cites the canonical `project.accepted_events`
 *   detection fact; the shared schema enforces context equality,
 *   reference resolution, and chart-total agreement in production and
 *   tests alike (R7-F7/R8-F6).
 * - Reads run SEQUENTIALLY (libSQL HTTP under Workers). No `Promise.all`.
 * - Never reads Live preview state: only `events`, `error_*`,
 *   `web_page_views`, `mobile_*`, and `external_identities`.
 */

export type PulsePlan = { metricId: MetricId; filters?: MetricFilters };

/**
 * Stable adaptive pulse selection (capability-only, exactly 3).
 *
 * 1. Prefer the first sorted observed Standard Event as the key outcome
 *    (`standard_event.occurrences` + exact key filter). The observed set
 *    is project-level (see the endpoint), so a range-local zero keeps its
 *    slot with a zero fact.
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

/**
 * Bounded capability-driven DETECTION set (R7-F2/R8-F4): the pulse plans
 * plus every other metric whose change can headline (audience counts and
 * the bounce rate with its denominator basis). Display shows three cards;
 * detection sees the full set. Everything is measured in ONE canonical
 * pass; the shared run memo lets each domain loader serve all of its
 * metrics from a single sequential read model.
 */
export function selectDetectionPlans(
  capabilities: ProjectCapabilities,
): PulsePlan[] {
  const plans: PulsePlan[] = [];
  const pushUnique = (plan: PulsePlan): void => {
    const key = `${plan.metricId}|${plan.filters?.standardEventKey ?? ""}`;
    if (
      plans.some(
        (p) => `${p.metricId}|${p.filters?.standardEventKey ?? ""}` === key,
      )
    )
      return;
    plans.push(plan);
  };
  // Activity grounding + universal audience baseline.
  pushUnique({ metricId: "project.accepted_events" });
  pushUnique({ metricId: "project.sessions" });
  for (const plan of selectPulsePlans(capabilities)) pushUnique(plan);
  // Exact count headlines and the sole rate metric beyond the pulse cards.
  if (capabilities.web) {
    pushUnique({ metricId: "web.sessions" });
    pushUnique({ metricId: "web.bounce_rate" });
  }
  if (capabilities.mobile) {
    pushUnique({ metricId: "mobile.sessions" });
  }
  return plans;
}

/**
 * Bounded release identity (R8-F5): truncated server-only SHA-256 over the
 * domain-separated full identifier. Sixty-four bits with domain
 * separation is the documented collision-resistant length for these
 * small per-project release sets — never another 32-bit hash, and never
 * raw telemetry inside a capped ID.
 */
export function releaseIdentityId(release: string): string {
  return `release-${sha256Hex(`release\0${release}`).slice(0, 16)}`;
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

function formatCountDirection(current: number, previous: number): string {
  if (previous === 0) return "new";
  if (current === previous) return "flat";
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return current > previous ? `up ${percent}%` : `down ${Math.abs(percent)}%`;
}

/** Percentage-point display (R8-F1): values already are points, never ×100. */
function formatPoints(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function formatRateDirection(current: number, previous: number): string {
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return "flat";
  const magnitude = Math.abs(delta);
  return delta > 0 ? `up ${magnitude} points` : `down ${magnitude} points`;
}

function severityForChange(current: number, previous: number): InsightSeverity {
  const absolute = Math.abs(current - previous);
  const ratio = previous === 0 ? 1 : absolute / previous;
  if (ratio >= 1 || absolute >= 100) return "critical";
  if (ratio >= 0.5 || absolute >= 20) return "attention";
  return "info";
}

/** Percentage-point severity (R8-F1): 20+ critical, 10+ attention. */
function severityForRate(deltaPoints: number): InsightSeverity {
  const absolute = Math.abs(deltaPoints);
  if (absolute >= 20) return "critical";
  if (absolute >= 10) return "attention";
  return "info";
}

/**
 * Deterministic insight selection (pure, testable).
 *
 * Consumes the STRUCTURED basis on each returned fact (R8-F3): exact
 * previous values and rate denominators populated by the canonical
 * service in the same pass as the displayed comparison. Missing basis
 * (null previous) never headlines — no reversal, no estimates.
 * - Change: replayable count facts with eligible exact (current, previous).
 * - Rate: the bounce-rate metric only (the sole `rate` valueKind), with
 *   eligible exact values and denominators under the frozen 30/30 +
 *   five-point rule. Decimal means stay out until a dedicated rule is
 *   frozen (R8-F1).
 * - Error: new/regressing issues with >=3 current occurrences.
 * - Coverage: ingest-readiness signal naming the source dimension and the
 *   measured ready share, stating retained-data inclusion (R7-F4).
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
    if (fact.value === null) continue;
    const definition = METRIC_REGISTRY[fact.metricId];
    const previous = fact.comparisonBasis.previousValue;
    if (previous === null) continue;
    if (definition.valueKind === "count") {
      if (!isCountChangeEligible(fact.value, previous)) continue;
      const direction = formatCountDirection(fact.value, previous);
      const severity = severityForChange(fact.value, previous);
      const title = `${definition.label} ${direction} vs previous period`;
      const summary = `${definition.label} moved from ${previous} to ${fact.value} in this period (${direction}). Evidence: ${fact.formattedValue}.`;
      const id = `change-${fact.id}`;
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
        id: id.slice(0, 128),
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
    } else if (definition.valueKind === "rate") {
      const denominators = {
        current: fact.comparisonBasis.denominatorCurrent,
        previous: fact.comparisonBasis.denominatorPrevious,
      };
      if (denominators.current === null || denominators.previous === null) {
        continue;
      }
      if (
        !isRateChangeEligible(
          fact.value,
          previous,
          denominators.current,
          denominators.previous,
        )
      )
        continue;
      const direction = formatRateDirection(fact.value, previous);
      const severity = severityForRate(fact.value - previous);
      const title = `${definition.label} ${direction} vs previous period`;
      const summary =
        `${definition.label} moved from ${formatPoints(previous)} ` +
        `to ${formatPoints(fact.value)} (${direction}) ` +
        `across ${denominators.current} eligible records (previous ${denominators.previous}).`;
      const id = `rate-${fact.id}`;
      const artifact: AssistantArtifact = {
        kind: "metric",
        id: `artifact-${id}`,
        title: definition.label,
        summary: `${definition.label}: ${formatPoints(fact.value)} (${direction}).`,
        factIds: [fact.id],
        queryContext,
        drilldown: fact.drilldown,
        fact,
      };
      candidates.push({
        id: id.slice(0, 128),
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
      id: id.slice(0, 128),
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

  // Ingest readiness (R7-F4): which sources can currently accept new
  // data, with the explicit retained-data statement so the signal can
  // never contradict the historical totals beside it.
  if (
    capabilities.sources.total > 0 &&
    capabilities.sources.active < capabilities.sources.total
  ) {
    const coveragePercent =
      Math.round(
        (capabilities.sources.active / capabilities.sources.total) * 1000,
      ) / 10;
    const id = "coverage-sources";
    const summary = `Source dimension readiness is ${coveragePercent}% (${capabilities.sources.active} of ${capabilities.sources.total} sources can currently accept new data). Historical data already accepted remains included in totals and charts.`;
    const artifact: AssistantArtifact = {
      kind: "coverage",
      id: `artifact-${id}`,
      title: "Source readiness",
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
      title: "Some sources cannot currently accept new data",
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
    const displayRelease = topRelease.release.slice(0, 80);
    const summary = `Release ${displayRelease} was observed ${wording} ${topRelease.count} occurrences in this period. Co-occurrence only.`;
    if (!containsCausalClaim(summary)) {
      // Digest-bounded ID (R8-F5): the full identifier travels in filter
      // semantics and row keys below; the capped ID carries only the
      // truncated SHA-256 of the domain-separated value.
      const id = releaseIdentityId(topRelease.release);
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
        title: `Release ${displayRelease} observed`,
        summary: summary.slice(0, 500),
        factIds: [],
        artifact,
        drilldown: {
          destination: "errors",
          label: "Open Errors",
          filters: { release: topRelease.release },
        },
        askPrompt: `Did errors rise after release ${displayRelease}?`.slice(
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
    // Accumulate: the SQL groups by float-division buckets, so several
    // rows can floor into one display bucket — overwriting would drop
    // all but the last row's count.
    const start = Math.floor(Number(row.bucket_start ?? 0) / ms) * ms;
    byBucket.set(start, (byBucket.get(start) ?? 0) + Number(row.n ?? 0));
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
  // Current-period restriction (R7-F5): only issues with in-period
  // occurrences take the secondary panel. Historical-only issues fall
  // through to the release/event ranking instead of a zero-row panel.
  const { rows } = await client.execute({
    sql: `SELECT i.id AS id, i.title AS title, i.status AS status,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN 1 ELSE 0 END) AS current_n,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN 1 ELSE 0 END) AS previous_n,
            MIN(CASE WHEN o.received_at <= ? ${sourceFilter} THEN o.occurred_at END) AS snapshot_first_seen,
            COUNT(DISTINCT CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? ${sourceFilter} THEN o.anonymous_id END) AS users_n
          FROM error_issues i LEFT JOIN error_occurrences o
            ON o.issue_id = i.id AND o.project_id = i.project_id
          WHERE i.project_id = ? GROUP BY i.id, i.title, i.status
          HAVING current_n > 0
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

function requestsFor(
  plans: readonly PulsePlan[],
  scope: MetricScope,
): { metricId: string; filters?: MetricFilters }[] {
  // Scope/filter agreement mirrors the metrics controller (R6-F2): the
  // shared scope attaches only where the registry supports `source_ids`
  // so mixed sets return scoped unavailable facts instead of 400.
  return plans.map((plan) => {
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
}

/**
 * Build the complete overview resource for one snapshot.
 * Sequential reads only, in ONE canonical measurement pass (R8-F4):
 * pulse and detection facts come from a single `measureMetrics` call
 * sharing one run memo, so each domain loader serves all of its metrics
 * from one sequential read model. Prior values and denominators ride on
 * the returned facts' structured basis — no previous-window rerun.
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
  const pulsePlans = selectPulsePlans(capabilities);
  const detectionPlans = selectDetectionPlans(capabilities);
  // Shared run memo (R8-F4): every metric in the single pass reuses its
  // domain loader's already-computed read model instead of rerunning it.
  const memo = deps.memo ?? new Map<string, unknown>();
  const requests = requestsFor(detectionPlans, scope);
  const detectionFacts = (await measureMetrics(
    client,
    projectId,
    window,
    scope,
    requests,
    { ...deps, memo },
  )) as MetricFact[];
  // Pulse resolves by canonical plan key (R8-F2): the fact ID embeds the
  // normalized filter identity, so two Standard Event keys never alias.
  const detectionById = new Map(detectionFacts.map((fact) => [fact.id, fact]));
  const pulseFacts: MetricFact[] = [];
  for (const plan of pulsePlans) {
    const found = detectionById.get(
      factIdFor(plan.metricId, plan.filters ?? {}),
    );
    if (!found) {
      throw new Error(`detection set must cover pulse metric ${plan.metricId}`);
    }
    pulseFacts.push(found);
  }
  if (pulseFacts.length !== 3) {
    throw new Error("overview pulse must contain exactly three facts");
  }
  const head = pulseFacts[0];
  const secondPulse = pulseFacts[1];
  const thirdPulse = pulseFacts[2];
  if (!head || !secondPulse || !thirdPulse) {
    throw new Error("overview pulse must contain exactly three facts");
  }
  const queryContext = head.queryContext;
  for (const fact of detectionFacts) {
    if (!areQueryContextsEqual(fact.queryContext, queryContext)) {
      throw new Error("overview detection facts must share one query context");
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

  // Activity grounding (R7-F7): the canonical accepted-events detection
  // fact — pulse or supporting, never whichever card is first.
  const acceptedFact = detectionFacts.find(
    (fact) => fact.metricId === "project.accepted_events",
  );
  if (!acceptedFact) {
    throw new Error("detection set must include accepted events");
  }
  const activity: ActivityArtifact = hasAcceptedData
    ? {
        kind: "timeseries",
        id: "activity-accepted-events",
        title: "Accepted events",
        summary: `Accepted events trend (${series.bucket}, ${series.points.length} buckets).`,
        factIds: [acceptedFact.id],
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
          // Display copy shortens (R7-F6); the issueId stays the exact key.
          title: issue.title.slice(0, 200),
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
        key: row.release.slice(0, 200),
        label: row.release.slice(0, 200),
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
    facts: detectionFacts,
    capabilities,
    issues,
    releases,
    queryContext,
    observedAt: window.to,
  });

  // Bounded evidence grounding (R7-F7): referenced non-pulse detection
  // facts travel in `supportingFacts` so every cited ID resolves.
  const pulseIds = new Set(pulseFacts.map((fact) => fact.id));
  const referenced = new Set<string>([acceptedFact.id]);
  for (const insight of insights) {
    for (const id of insight.factIds) referenced.add(id);
    for (const id of insight.artifact.factIds) referenced.add(id);
  }
  const supportingFacts = detectionFacts
    .filter((fact) => !pulseIds.has(fact.id) && referenced.has(fact.id))
    .slice(0, 8);

  // Ingest-readiness warnings (R7-F4): readiness plus the retained-data
  // statement — never a claim that inactive sources had no data.
  const warnings: string[] = [];
  if (
    capabilities.sources.total > 0 &&
    capabilities.sources.active < capabilities.sources.total
  ) {
    warnings.push(
      `${capabilities.sources.active} of ${capabilities.sources.total} sources can currently accept new data; retained historical data from all sources remains included.`,
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

  return {
    queryContext,
    capabilities,
    insights,
    pulse: [head, secondPulse, thirdPulse],
    supportingFacts,
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
