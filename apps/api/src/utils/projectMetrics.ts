import {
  areQueryContextsEqual,
  compareValues,
  DEFINITION_VERSION,
  METRIC_IDS,
  METRIC_REGISTRY,
  queryContextFingerprint,
  StandardEventKeySchema,
  type ComparisonValue,
  type CoverageSummary,
  type DrilldownDestination,
  type DrilldownFilters,
  type MetricFact,
  type MetricId,
  type ProjectCapabilities,
  type PublicQueryContext,
} from "@prism-analytics/types";
import { standardEventDefinitionForKey } from "@prism-analytics/core";
import { loadMobileAnalytics } from "./mobileAnalyticsLoader";
import type { MobileAnalyticsQueryParams } from "./mobileAnalyticsStore";
import { loadWebAnalytics } from "./webAnalyticsLoader";
import type { WebAnalyticsQueryParams } from "./webAnalyticsStore";

/**
 * Canonical project metric service (Task 21 slice 2).
 *
 * One authority for dashboard and assistant measurements. Every metric
 * resolves through `METRIC_REGISTRY`; formulas live with their owning
 * read models (Web/Mobile loaders, identity/error tables) and are adapted
 * here — never copied into React or reimplemented per surface.
 *
 * Canonical semantics:
 * - Half-open occurrence ranges: `from <= occurred_at < to`.
 * - Immediately preceding equal-length comparison windows.
 * - Snapshot cutoff: records received after `asOf` are excluded, even when
 *   their client occurrence time falls inside the range. Projection tables
 *   without `received_at` join `events` (web/mobile) or bound their
 *   start/insertion time by `asOf` (sessions/installations); identity-link
 *   creation has no ingestion timestamp and is documented at the query.
 * - Analytics reads run SEQUENTIALLY (the libSQL HTTP client hangs on
 *   large concurrent sets under Workers). No `Promise.all` over clients.
 * - Comparisons reuse each domain's frozen function (Web/Mobile loader
 *   comparisons map 1:1 onto the canonical shape) so dashboard numbers and
 *   assistant facts agree byte-for-byte; domains without one use the frozen
 *   `compareValues` helper.
 */

export interface CanonicalClient {
  execute(input: {
    sql: string;
    args: Array<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export const METRIC_RANGES = ["24h", "7d", "14d", "30d", "90d"] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

const RANGE_MS: Record<MetricRange, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 86_400_000,
  "14d": 14 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

export function parseMetricRange(
  raw: string | null | undefined,
): MetricRange | null {
  if (!raw) return null;
  return (METRIC_RANGES as readonly string[]).includes(raw)
    ? (raw as MetricRange)
    : null;
}

export type MetricWindow = {
  from: number;
  to: number;
  compareFrom: number;
  compareTo: number;
  asOf: number;
};

/** Resolve [from, to) plus the immediately preceding equal-length window. */
export function resolveMetricWindow(
  now: number,
  range: MetricRange,
): MetricWindow {
  const span = RANGE_MS[range];
  const to = now;
  const from = now - span;
  return { from, to, compareFrom: from - span, compareTo: from, asOf: now };
}

export type MetricFilters = {
  sourceIds?: string[];
  standardEventKey?: string;
  traffic?: "human" | "all";
  os?: "ios" | "android";
  release?: string;
  host?: string;
  path?: string;
  platform?: "web" | "ios" | "android" | "react-native" | "server";
  environment?: string;
  currency?: string;
};

export type MetricRequest = {
  metricId: string;
  filters?: MetricFilters;
};

export class MetricQueryError extends Error {
  readonly code:
    "unknown-metric" | "invalid-filter" | "missing-filter" | "invalid-range";
  constructor(code: MetricQueryError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const FILTER_KEYS = [
  "sourceIds",
  "standardEventKey",
  "traffic",
  "os",
  "release",
  "host",
  "path",
  "platform",
  "environment",
  "currency",
] as const;

/** Registry filter kinds each request key satisfies. */
const FILTER_KIND: Record<(typeof FILTER_KEYS)[number], string> = {
  sourceIds: "source_ids",
  standardEventKey: "standard_event_key",
  traffic: "traffic",
  os: "os",
  release: "release",
  host: "host",
  path: "path",
  platform: "platform",
  environment: "environment",
  currency: "currency",
};

/**
 * Validate one request against the frozen registry. Unknown metrics,
 * unsupported filters, missing required filters, and malformed values
 * throw `MetricQueryError` before any SQL runs.
 */
export function validateMetricRequest(request: MetricRequest): {
  metricId: MetricId;
  filters: MetricFilters;
} {
  if (!(METRIC_IDS as readonly string[]).includes(request.metricId)) {
    throw new MetricQueryError(
      "unknown-metric",
      `Unknown metric: ${request.metricId}`,
    );
  }
  const metricId = request.metricId as MetricId;
  const definition = METRIC_REGISTRY[metricId];
  const filters = request.filters ?? {};
  for (const key of Object.keys(filters) as Array<keyof MetricFilters>) {
    if (!FILTER_KEYS.includes(key)) {
      throw new MetricQueryError(
        "invalid-filter",
        `Unknown filter: ${String(key)}`,
      );
    }
    const value = filters[key];
    if (value === undefined) continue;
    if (!definition.supportedFilters.includes(FILTER_KIND[key] as never)) {
      throw new MetricQueryError(
        "invalid-filter",
        `Metric ${metricId} does not support filter ${String(key)}`,
      );
    }
  }
  if (definition.requiresFilter) {
    const requiredKey = (
      Object.keys(FILTER_KIND) as Array<keyof typeof FILTER_KIND>
    ).find((key) => FILTER_KIND[key] === definition.requiresFilter);
    if (!requiredKey || filters[requiredKey] === undefined) {
      throw new MetricQueryError(
        "missing-filter",
        `Metric ${metricId} requires filter ${definition.requiresFilter}`,
      );
    }
  }
  const standardEventKey = filters.standardEventKey;
  if (standardEventKey !== undefined) {
    const parsed = StandardEventKeySchema.safeParse(standardEventKey);
    if (!parsed.success) {
      throw new MetricQueryError(
        "invalid-filter",
        "Unknown Standard Event key",
      );
    }
  }
  if (filters.currency !== undefined && !/^[A-Z]{3}$/.test(filters.currency)) {
    throw new MetricQueryError(
      "invalid-filter",
      "Currency must be an ISO 4217 code",
    );
  }
  if (
    filters.traffic !== undefined &&
    filters.traffic !== "human" &&
    filters.traffic !== "all"
  ) {
    throw new MetricQueryError(
      "invalid-filter",
      "Traffic must be human or all",
    );
  }
  if (
    filters.os !== undefined &&
    filters.os !== "ios" &&
    filters.os !== "android"
  ) {
    throw new MetricQueryError("invalid-filter", "OS must be ios or android");
  }
  return { metricId, filters };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Zero-decimal ISO currencies: minor units ARE major units. */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "PYG",
  "RWF",
  "UGX",
  "XAF",
  "XOF",
  "XPF",
  "BIF",
  "DJF",
  "GNF",
  "ISK",
  "KMF",
]);

function trimDecimal(value: number, places: number): string {
  const fixed = value.toFixed(places);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}

/** Display formatting per frozen value kind (pure, unit-tested). */
export function formatMetricValue(
  valueKind: "count" | "decimal" | "duration-ms" | "rate" | "money-minor",
  value: number,
  currency?: string,
): { formattedValue: string; unit: string | null } {
  switch (valueKind) {
    case "count":
      return {
        formattedValue: Math.trunc(value).toLocaleString("en-US"),
        unit: null,
      };
    case "decimal":
      return { formattedValue: trimDecimal(value, 2), unit: null };
    case "duration-ms":
      if (value < 1000)
        return { formattedValue: `${trimDecimal(value, 0)}ms`, unit: "ms" };
      if (value < 60000)
        return {
          formattedValue: `${trimDecimal(value / 1000, 1)}s`,
          unit: "ms",
        };
      return {
        formattedValue: `${trimDecimal(value / 60000, 1)}m`,
        unit: "ms",
      };
    case "rate":
      return { formattedValue: `${trimDecimal(value, 1)}%`, unit: "%" };
    case "money-minor": {
      const code = currency ?? "USD";
      const major = ZERO_DECIMAL_CURRENCIES.has(code) ? value : value / 100;
      try {
        return {
          formattedValue: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: code,
          }).format(major),
          unit: code,
        };
      } catch {
        return { formattedValue: `${major.toFixed(2)} ${code}`, unit: code };
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Capabilities (pure; controller composes the inputs)                 */
/* ------------------------------------------------------------------ */

export type SourceCapabilityInput = {
  platform: string;
  /** Active = holds a non-revoked ingestion key. */
  active: boolean;
  lastReceivedAt: number | null;
};

export function resolveProjectCapabilities(input: {
  sources: SourceCapabilityInput[];
  errorConfigured: boolean;
  errorObserved: boolean;
  standardEventsObserved: string[];
}): ProjectCapabilities {
  let web = false;
  let mobile = false;
  let server = false;
  let active = 0;
  let lastReceivedAt: number | null = null;
  for (const source of input.sources) {
    if (source.platform === "web") web = true;
    else if (
      source.platform === "react-native" ||
      source.platform === "ios" ||
      source.platform === "android"
    )
      mobile = true;
    else if (source.platform === "server") server = true;
    if (source.active) active += 1;
    if (
      source.lastReceivedAt !== null &&
      (lastReceivedAt === null || source.lastReceivedAt > lastReceivedAt)
    ) {
      lastReceivedAt = source.lastReceivedAt;
    }
  }
  const observed = input.standardEventsObserved.flatMap((key) => {
    const parsed = StandardEventKeySchema.safeParse(key);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    web,
    mobile,
    server,
    errorCollection: {
      configured: input.errorConfigured,
      observed: input.errorObserved,
    },
    standardEventsObserved: [...new Set(observed)],
    sources: { total: input.sources.length, active, lastReceivedAt },
    trafficPolicy: "human",
  };
}

/** Capability shortfall for a metric, or null when collectible. */
export function capabilityShortfall(
  metricId: MetricId,
  capabilities: ProjectCapabilities,
): string | null {
  const requirements = METRIC_REGISTRY[metricId].sourceRequirements;
  for (const requirement of requirements) {
    if (requirement === "web_collection" && !capabilities.web)
      return "Requires a Web source";
    if (requirement === "mobile_collection" && !capabilities.mobile)
      return "Requires a Mobile source";
    if (requirement === "server_collection" && !capabilities.server)
      return "Requires a server source";
    if (
      requirement === "error_collection" &&
      !capabilities.errorCollection.configured &&
      !capabilities.errorCollection.observed
    )
      return "Requires error collection";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Snapshot cache + run memo                                           */
/* ------------------------------------------------------------------ */

const SNAPSHOT_CACHE_TTL_MS = 60_000;
const SNAPSHOT_CACHE_MAX_ENTRIES = 500;

type CacheEntry = { expiresAt: number; facts: MetricFact[] };
const snapshotCache = new Map<string, CacheEntry>();

export function clearMetricSnapshotCache(): void {
  snapshotCache.clear();
}

function cacheKey(
  projectId: string,
  queryContext: PublicQueryContext,
  metricId: MetricId,
  filters: MetricFilters,
): string {
  return [
    projectId,
    queryContextFingerprint(queryContext),
    metricId,
    JSON.stringify(filters),
  ].join("|");
}

function cachedFacts(key: string, now: number): MetricFact[] | null {
  const entry = snapshotCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    snapshotCache.delete(key);
    return null;
  }
  return entry.facts;
}

function storeFacts(key: string, facts: MetricFact[], now: number): void {
  if (snapshotCache.size >= SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = snapshotCache.keys().next();
    if (!oldest.done) snapshotCache.delete(oldest.value);
  }
  snapshotCache.set(key, { expiresAt: now + SNAPSHOT_CACHE_TTL_MS, facts });
}

/* ------------------------------------------------------------------ */
/* SQL helpers (sequential execution only)                             */
/* ------------------------------------------------------------------ */

function eventScope(
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  sourceIds: string[] | undefined,
  table = "events",
): { clauses: string[]; args: Array<string | number | null> } {
  const clauses = [
    `${table}.project_id = ?`,
    `${table}.occurred_at >= ?`,
    `${table}.occurred_at < ?`,
    `${table}.received_at <= ?`,
  ];
  const args: Array<string | number | null> = [projectId, from, to, asOf];
  if (sourceIds && sourceIds.length > 0) {
    clauses.push(
      `${table}.source_id IN (${sourceIds.map(() => "?").join(",")})`,
    );
    args.push(...sourceIds);
  }
  return { clauses, args };
}

async function countEvents(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  extra: { sourceIds?: string[]; name?: string; standardKey?: string } = {},
): Promise<number> {
  const { clauses, args } = eventScope(
    projectId,
    from,
    to,
    asOf,
    extra.sourceIds,
  );
  if (extra.name) {
    clauses.push("events.name = ?");
    args.push(extra.name);
  }
  if (extra.standardKey) {
    // Structural core of Standard Event validity (name + key + version +
    // object data). Full per-key data validation lives in ingestion and the
    // deriveStandardEvent boundary; counts never relabel custom events.
    clauses.push(`json_extract(events.properties, '$."$standard".key') = ?`);
    args.push(extra.standardKey);
    clauses.push(
      `json_extract(events.properties, '$."$standard".schemaVersion') = 1`,
    );
  }
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM events WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function countDistinctPeople(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  sourceIds?: string[],
): Promise<number> {
  // Identified = holds a developer-supplied external identity. Anonymous-only
  // subjects (person row without external identity) never count here.
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.person_id IS NOT NULL");
  clauses.push(`EXISTS (SELECT 1 FROM external_identities x
    WHERE x.project_id = events.project_id AND x.person_id = events.person_id)`);
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT events.person_id) AS n FROM events WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function countAnonymousSubjects(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  sourceIds?: string[],
): Promise<number> {
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.person_id IS NULL");
  clauses.push("events.anonymous_id IS NOT NULL");
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT events.anonymous_id) AS n FROM events WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function countSessionsStarted(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  sourceIds?: string[],
): Promise<number> {
  // sessions_v2 carries no received_at; a session cannot be observed before
  // it starts, so started_at <= asOf is the honest snapshot bound.
  const clauses = [
    "project_id = ?",
    "started_at >= ?",
    "started_at < ?",
    "started_at <= ?",
  ];
  const args: Array<string | number | null> = [projectId, from, to, asOf];
  if (sourceIds && sourceIds.length > 0) {
    clauses.push(`source_id IN (${sourceIds.map(() => "?").join(",")})`);
    args.push(...sourceIds);
  }
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT session_id) AS n FROM sessions_v2 WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function countNewPeople(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
): Promise<number> {
  // Identity-link creation has no ingestion timestamp; the half-open window
  // applies to linked_at. No inferred acquisition dimensions.
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM (
            SELECT person_id FROM external_identities
            WHERE project_id = ?
            GROUP BY person_id
            HAVING MIN(linked_at) >= ? AND MIN(linked_at) < ?
          )`,
    args: [projectId, from, to],
  });
  return Number(rows[0]?.n ?? 0);
}

function protectedNameFor(key: string): string {
  const definition = standardEventDefinitionForKey(
    key as Parameters<typeof standardEventDefinitionForKey>[0],
  );
  if (!definition)
    throw new MetricQueryError("invalid-filter", "Unknown Standard Event key");
  return definition.protectedName;
}

async function standardPeople(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  name: string,
  key: string,
  sourceIds?: string[],
): Promise<number> {
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.name = ?");
  args.push(name);
  clauses.push(`json_extract(events.properties, '$."$standard".key') = ?`);
  args.push(key);
  clauses.push("events.person_id IS NOT NULL");
  clauses.push(`EXISTS (SELECT 1 FROM external_identities x
    WHERE x.project_id = events.project_id AND x.person_id = events.person_id)`);
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT events.person_id) AS n FROM events WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

export type StandardValueRow = { currency: string; totalMinor: number };

async function standardValues(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  name: string,
  key: string,
  sourceIds?: string[],
  currency?: string,
): Promise<StandardValueRow[]> {
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.name = ?");
  args.push(name);
  clauses.push(`json_extract(events.properties, '$."$standard".key') = ?`);
  args.push(key);
  clauses.push(
    `json_extract(events.properties, '$."$standard".data.valueMinor') IS NOT NULL`,
  );
  if (currency) {
    clauses.push(
      `json_extract(events.properties, '$."$standard".data.currency') = ?`,
    );
    args.push(currency);
  }
  const { rows } = await client.execute({
    sql: `SELECT
            json_extract(events.properties, '$."$standard".data.currency') AS currency,
            SUM(CAST(json_extract(events.properties, '$."$standard".data.valueMinor') AS INTEGER)) AS total
          FROM events WHERE ${clauses.join(" AND ")}
          GROUP BY currency ORDER BY currency ASC`,
    args,
  });
  return rows.map((row) => ({
    currency: String(row.currency ?? "UNKNOWN"),
    totalMinor: Number(row.total ?? 0),
  }));
}

async function errorOccurrenceCount(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  filters: {
    sourceIds?: string[];
    platform?: string;
    release?: string;
    environment?: string;
    handled?: 0 | 1;
  } = {},
): Promise<number> {
  const clauses = [
    "project_id = ?",
    "occurred_at >= ?",
    "occurred_at < ?",
    "received_at <= ?",
  ];
  const args: Array<string | number | null> = [projectId, from, to, asOf];
  if (filters.sourceIds && filters.sourceIds.length > 0) {
    clauses.push(
      `source_id IN (${filters.sourceIds.map(() => "?").join(",")})`,
    );
    args.push(...filters.sourceIds);
  }
  if (filters.platform) {
    clauses.push("platform = ?");
    args.push(filters.platform);
  }
  if (filters.release) {
    clauses.push("release = ?");
    args.push(filters.release);
  }
  if (filters.environment) {
    clauses.push("environment = ?");
    args.push(filters.environment);
  }
  if (filters.handled !== undefined) {
    clauses.push("handled = ?");
    args.push(filters.handled);
  }
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM error_occurrences WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function errorAffectedIdentities(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  filters: { sourceIds?: string[]; platform?: string } = {},
): Promise<number> {
  // Exact Task 15 identity definition: distinct anonymous ids in window.
  const clauses = [
    "project_id = ?",
    "occurred_at >= ?",
    "occurred_at < ?",
    "received_at <= ?",
    "anonymous_id IS NOT NULL",
  ];
  const args: Array<string | number | null> = [projectId, from, to, asOf];
  if (filters.sourceIds && filters.sourceIds.length > 0) {
    clauses.push(
      `source_id IN (${filters.sourceIds.map(() => "?").join(",")})`,
    );
    args.push(...filters.sourceIds);
  }
  if (filters.platform) {
    clauses.push("platform = ?");
    args.push(filters.platform);
  }
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT anonymous_id) AS n FROM error_occurrences WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

export type ErrorStateFilter = { platform?: string; release?: string };

/**
 * Project issue-state aggregates (Task 15 semantics, canonical windows).
 * New = first observed inside the window; regressing = growing versus a
 * positive prior baseline and not new (the issueDelta rule applied over one
 * grouped read instead of row-by-row copies). Release narrows by
 * first_release for new issues and last_release for current-state counts —
 * co-occurrence only, never a causal claim.
 */
export async function errorIssueStateCounts(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  compareFrom: number,
  compareTo: number,
  asOf: number,
  filter: ErrorStateFilter = {},
): Promise<{ unresolved: number; fresh: number; regressing: number }> {
  // NOTE: `?` placeholders bind in TEXTUAL order. The six SUM window
  // parameters precede the WHERE clause in the statement below, so they
  // come first in args (a previous revision ordered projectId first and
  // silently matched zero rows — caught by projectMetrics tests).
  const issueClauses = ["i.project_id = ?"];
  const scopeArgs: Array<string | number | null> = [projectId];
  if (filter.platform) {
    issueClauses.push("i.platform = ?");
    scopeArgs.push(filter.platform);
  }
  const { rows } = await client.execute({
    sql: `SELECT
            i.status AS status,
            i.first_seen_at AS first_seen_at,
            i.first_release AS first_release,
            i.last_release AS last_release,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? THEN 1 ELSE 0 END) AS current_n,
            SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? THEN 1 ELSE 0 END) AS previous_n
          FROM error_issues i
          LEFT JOIN error_occurrences o
            ON o.issue_id = i.id AND o.project_id = i.project_id
          WHERE ${issueClauses.join(" AND ")}
          GROUP BY i.id, i.status, i.first_seen_at, i.first_release, i.last_release`,
    args: [from, to, asOf, compareFrom, compareTo, asOf, ...scopeArgs],
  });
  let unresolved = 0;
  let fresh = 0;
  let regressing = 0;
  for (const row of rows) {
    const status = String(row.status ?? "");
    const firstSeen = Number(row.first_seen_at ?? 0);
    const current = Number(row.current_n ?? 0);
    const previous = Number(row.previous_n ?? 0);
    const isNew = firstSeen >= from && firstSeen < to;
    if (filter.release) {
      if (isNew && row.first_release !== filter.release) continue;
      if (!isNew && row.last_release !== filter.release) continue;
    }
    if (status === "unresolved") unresolved += 1;
    if (isNew) {
      fresh += 1;
    } else if (previous > 0 && current > previous) {
      regressing += 1;
    }
  }
  return { unresolved, fresh, regressing };
}

export type MeasureDeps = {
  capabilities: ProjectCapabilities;
  memo?: Map<string, unknown>;
  now?: number;
};

function publicContextFor(
  projectId: string,
  organizationId: string,
  window: MetricWindow,
  scopeSourceIds: string[],
): {
  queryContext: PublicQueryContext;
  projectId: string;
  organizationId: string;
} {
  void projectId;
  void organizationId;
  return {
    projectId,
    organizationId,
    queryContext: {
      from: window.from,
      to: window.to,
      compareFrom: window.compareFrom,
      compareTo: window.compareTo,
      asOf: window.asOf,
      timezone: "UTC",
      sourceIds: [...scopeSourceIds],
      definitionVersion: DEFINITION_VERSION,
    },
  };
}

function coverageFor(
  capabilities: ProjectCapabilities,
  warnings: string[] = [],
  enrichments: CoverageSummary["enrichments"] = [],
): CoverageSummary {
  return {
    sourcesConfigured: capabilities.sources.total,
    sourcesActive: capabilities.sources.active,
    enrichments,
    warnings: warnings.slice(0, 8),
  };
}

function drilldownFor(
  metricId: MetricId,
  filters: MetricFilters,
): DrilldownDestination {
  const base = METRIC_REGISTRY[metricId].drilldown;
  const picked: DrilldownFilters = {};
  if (
    filters.standardEventKey &&
    (base.destination === "events" || base.destination === "people")
  ) {
    picked.standardEventKey = filters.standardEventKey as never;
  }
  if (filters.currency && base.destination === "events") {
    picked.currency = filters.currency;
  }
  if (filters.path && base.destination === "web-analytics")
    picked.path = filters.path;
  if (filters.host && base.destination === "web-analytics")
    picked.host = filters.host;
  if (filters.traffic && base.destination === "web-analytics")
    picked.traffic = filters.traffic;
  if (filters.os && base.destination === "mobile-analytics")
    picked.os = filters.os;
  if (
    filters.release &&
    (base.destination === "mobile-analytics" || base.destination === "errors")
  ) {
    picked.release = filters.release;
  }
  if (filters.platform && base.destination === "errors") {
    picked.platform = filters.platform as never;
  }
  if (filters.environment && base.destination === "errors")
    picked.environment = filters.environment;
  if (
    filters.sourceIds &&
    filters.sourceIds.length === 1 &&
    (base.destination === "events" || base.destination === "errors")
  ) {
    picked.sourceId = filters.sourceIds[0];
  }
  return {
    ...base,
    ...(Object.keys(picked).length > 0 ? { filters: picked } : {}),
  };
}

/** Request filters as canonical drill-down filter values on the fact. */
function factFiltersFor(filters: MetricFilters): DrilldownFilters {
  const picked: DrilldownFilters = {};
  if (filters.standardEventKey) {
    picked.standardEventKey = filters.standardEventKey as never;
  }
  if (filters.currency) picked.currency = filters.currency;
  if (filters.path) picked.path = filters.path;
  if (filters.host) picked.host = filters.host;
  if (filters.traffic) picked.traffic = filters.traffic;
  if (filters.os) picked.os = filters.os;
  if (filters.release) picked.release = filters.release;
  if (filters.platform) picked.platform = filters.platform as never;
  if (filters.environment) picked.environment = filters.environment;
  if (filters.sourceIds && filters.sourceIds.length === 1) {
    picked.sourceId = filters.sourceIds[0];
  }
  return picked;
}

function makeFact(args: {
  metricId: MetricId;
  idSuffix?: string;
  value: number | null;
  comparison: ComparisonValue | null;
  queryContext: PublicQueryContext;
  coverage: CoverageSummary;
  coverageNote: string;
  drilldown: DrilldownDestination;
  currency?: string;
  labelSuffix?: string;
  requestFilters?: MetricFilters;
}): MetricFact {
  const definition = METRIC_REGISTRY[args.metricId];
  const { formattedValue, unit } =
    args.value === null
      ? { formattedValue: "—", unit: null }
      : formatMetricValue(definition.valueKind, args.value, args.currency);
  return {
    id: args.idSuffix ? `${args.metricId}:${args.idSuffix}` : args.metricId,
    metricId: args.metricId,
    definitionVersion: DEFINITION_VERSION,
    label: args.labelSuffix
      ? `${definition.label} (${args.labelSuffix})`
      : definition.label,
    value: args.value,
    formattedValue,
    unit,
    comparison: args.comparison,
    queryContext: args.queryContext,
    coverage: args.coverage,
    coverageNote: args.coverageNote.slice(0, 200),
    filters: factFiltersFor(args.requestFilters ?? {}),
    drilldown: args.drilldown,
  };
}

function unsupportedFact(
  metricId: MetricId,
  queryContext: PublicQueryContext,
  coverage: CoverageSummary,
  reason: string,
  drilldown: DrilldownDestination,
  requestFilters: MetricFilters = {},
): MetricFact {
  return makeFact({
    metricId,
    value: null,
    comparison: null,
    queryContext,
    coverage: {
      ...coverage,
      warnings: [...coverage.warnings, reason].slice(0, 8),
    },
    coverageNote: reason,
    drilldown,
    requestFilters,
  });
}

function memoized<T>(
  memo: Map<string, unknown> | undefined,
  key: string,
): T | undefined {
  return memo?.get(key) as T | undefined;
}

function remember<T>(
  memo: Map<string, unknown> | undefined,
  key: string,
  value: T,
): T {
  memo?.set(key, value);
  return value;
}

/**
 * Measure one validated metric. Domain snapshots memoize within the run so
 * the overview adapter and the agent adapter share identical inputs — and
 * therefore byte-equivalent facts — for the same query context.
 */
async function measureOne(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scopeSourceIds: string[],
  metricId: MetricId,
  filters: MetricFilters,
  deps: MeasureDeps,
): Promise<MetricFact[]> {
  const { queryContext } = publicContextFor(
    projectId,
    "",
    window,
    scopeSourceIds,
  );
  const coverage = coverageFor(deps.capabilities);
  const drilldown = drilldownFor(metricId, filters);
  const shortfall = capabilityShortfall(metricId, deps.capabilities);
  if (shortfall) {
    return [
      unsupportedFact(
        metricId,
        queryContext,
        coverage,
        shortfall,
        drilldown,
        filters,
      ),
    ];
  }
  const sourceIds = filters.sourceIds;
  const w = window;

  switch (metricId) {
    case "project.accepted_events": {
      const current = await countEvents(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        { sourceIds },
      );
      const previous = await countEvents(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        { sourceIds },
      );
      return [
        makeFact({
          metricId,
          value: current,
          comparison: compareValues(current, previous),
          queryContext,
          coverage,
          coverageNote: "Accepted event occurrences",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
    case "project.sessions": {
      const current = await countSessionsStarted(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        sourceIds,
      );
      const previous = await countSessionsStarted(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        sourceIds,
      );
      return [
        makeFact({
          metricId,
          value: current,
          comparison: compareValues(current, previous),
          queryContext,
          coverage,
          coverageNote: "Sessions started in range",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
    case "project.active_people": {
      const current = await countDistinctPeople(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        sourceIds,
      );
      const previous = await countDistinctPeople(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        sourceIds,
      );
      return [
        makeFact({
          metricId,
          value: current,
          comparison: compareValues(current, previous),
          queryContext,
          coverage,
          coverageNote: "Identified people with activity",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
    case "project.new_people": {
      const current = await countNewPeople(client, projectId, w.from, w.to);
      const previous = await countNewPeople(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
      );
      return [
        makeFact({
          metricId,
          value: current,
          comparison: compareValues(current, previous),
          queryContext,
          coverage,
          coverageNote: "First external identity links",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
    case "project.active_anonymous": {
      const current = await countAnonymousSubjects(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        sourceIds,
      );
      const previous = await countAnonymousSubjects(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        sourceIds,
      );
      return [
        makeFact({
          metricId,
          value: current,
          comparison: compareValues(current, previous),
          queryContext,
          coverage,
          coverageNote: "Anonymous-only subjects, not unique humans",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
    case "standard_event.occurrences":
    case "standard_event.people":
    case "standard_event.value_by_currency": {
      const key = filters.standardEventKey as string;
      const name = protectedNameFor(key);
      if (metricId === "standard_event.occurrences") {
        const current = await countEvents(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          { sourceIds, name, standardKey: key },
        );
        const previous = await countEvents(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          { sourceIds, name, standardKey: key },
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
            queryContext,
            coverage,
            coverageNote: `Accepted ${key} occurrences`,
            drilldown,
            requestFilters: filters,
          }),
        ];
      }
      if (metricId === "standard_event.people") {
        const current = await standardPeople(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          name,
          key,
          sourceIds,
        );
        const previous = await standardPeople(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          name,
          key,
          sourceIds,
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
            queryContext,
            coverage,
            coverageNote: `Identified people with ${key}`,
            drilldown,
            requestFilters: filters,
          }),
        ];
      }
      const rows = await standardValues(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        name,
        key,
        sourceIds,
        filters.currency,
      );
      if (rows.length === 0) return [];
      const previousRows = await standardValues(
        client,
        projectId,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        name,
        key,
        sourceIds,
        filters.currency,
      );
      const previousByCurrency = new Map(
        previousRows.map((row) => [row.currency, row.totalMinor]),
      );
      return rows.map((row) =>
        makeFact({
          metricId,
          idSuffix: row.currency,
          value: row.totalMinor,
          comparison: compareValues(
            row.totalMinor,
            previousByCurrency.get(row.currency) ?? 0,
          ),
          queryContext,
          coverage,
          coverageNote: `${key} value in ${row.currency}; never converted`,
          drilldown,
          currency: /^[A-Z]{3}$/.test(row.currency) ? row.currency : undefined,
          labelSuffix: row.currency,
          requestFilters: filters,
        }),
      );
    }
    case "web.page_views":
    case "web.visitors":
    case "web.sessions":
    case "web.views_per_session":
    case "web.bounce_rate":
    case "web.excluded_bots": {
      const params: WebAnalyticsQueryParams = {
        projectId,
        from: w.from,
        to: w.to,
        sourceIds: sourceIds ?? [],
        host: filters.host ?? null,
        path: filters.path ?? null,
        // Excluded bots are measured under all-traffic by definition (the
        // metric counts what the human policy removes); traffic is not a
        // supported filter for it and never reaches this branch validated.
        traffic:
          metricId === "web.excluded_bots"
            ? "all"
            : (filters.traffic ?? "human"),
      };
      const memoKey = `web|${w.from}|${w.to}|${w.asOf}|${JSON.stringify(params)}`;
      let resource = memoized<Awaited<ReturnType<typeof loadWebAnalytics>>>(
        deps.memo,
        memoKey,
      );
      if (!resource) {
        resource = await loadWebAnalytics(
          { ...params, asOf: w.asOf },
          w.asOf,
          client,
        );
        remember(deps.memo, memoKey, resource);
      }
      const webCoverage = coverageFor(
        deps.capabilities,
        [],
        [
          {
            dimension: "technology",
            coveragePercent: resource.coverage.technologyPercent,
          },
          {
            dimension: "geography",
            coveragePercent: resource.coverage.geographyPercent,
          },
          {
            dimension: "campaign",
            coveragePercent: resource.coverage.campaignPercent,
          },
        ],
      );
      const note = `${filters.traffic ?? "human"} traffic`;
      const pick = (
        id: MetricId,
        value: number | null,
        comparison: ComparisonValue | null,
      ): MetricFact =>
        makeFact({
          metricId: id,
          value,
          comparison,
          queryContext,
          coverage: webCoverage,
          coverageNote: note,
          drilldown: drilldownFor(id, filters),
          requestFilters: filters,
        });
      switch (metricId) {
        case "web.page_views":
          return [
            pick(
              metricId,
              resource.totals.pageViews,
              resource.comparison.pageViews,
            ),
          ];
        case "web.visitors":
          return [
            pick(
              metricId,
              resource.totals.visitors,
              resource.comparison.visitors,
            ),
          ];
        case "web.sessions":
          return [
            pick(
              metricId,
              resource.totals.sessions,
              resource.comparison.sessions,
            ),
          ];
        case "web.views_per_session":
          return [
            pick(
              metricId,
              resource.totals.viewsPerSession,
              resource.comparison.viewsPerSession,
            ),
          ];
        case "web.bounce_rate":
          return [
            pick(
              metricId,
              resource.totals.bounceRate,
              resource.totals.bounceRate === null
                ? null
                : resource.comparison.bounceRate,
            ),
          ];
        case "web.excluded_bots":
          return [pick(metricId, resource.totals.excludedBots, null)];
      }
      break;
    }
    case "mobile.app_opens":
    case "mobile.visitors":
    case "mobile.sessions":
    case "mobile.screens_per_session":
    case "mobile.foreground_duration":
    case "mobile.observed_installations": {
      const params: MobileAnalyticsQueryParams = {
        projectId,
        from: w.from,
        to: w.to,
        sourceIds: sourceIds ?? [],
        os: filters.os ?? null,
        release: filters.release ?? null,
      };
      const memoKey = `mobile|${w.from}|${w.to}|${w.asOf}|${JSON.stringify(params)}`;
      let resource = memoized<Awaited<ReturnType<typeof loadMobileAnalytics>>>(
        deps.memo,
        memoKey,
      );
      if (!resource) {
        resource = await loadMobileAnalytics(client, {
          ...params,
          asOf: w.asOf,
        });
        remember(deps.memo, memoKey, resource);
      }
      const mobileCoverage = coverageFor(
        deps.capabilities,
        [],
        [
          {
            dimension: "technology",
            coveragePercent: resource.coverage.technologyPercent,
          },
          {
            dimension: "geography",
            coveragePercent: resource.coverage.geographyPercent,
          },
        ],
      );
      const note = "Observed instrumentation counts";
      const pick = (
        id: MetricId,
        value: number | null,
        comparison: ComparisonValue | null,
      ): MetricFact =>
        makeFact({
          metricId: id,
          value,
          comparison,
          queryContext,
          coverage: mobileCoverage,
          coverageNote: note,
          drilldown: drilldownFor(id, filters),
          requestFilters: filters,
        });
      switch (metricId) {
        case "mobile.app_opens":
          return [
            pick(
              metricId,
              resource.totals.appOpens,
              resource.comparison.appOpens,
            ),
          ];
        case "mobile.visitors":
          return [
            pick(
              metricId,
              resource.totals.visitors,
              resource.comparison.visitors,
            ),
          ];
        case "mobile.sessions":
          return [
            pick(
              metricId,
              resource.totals.appSessions,
              resource.comparison.appSessions,
            ),
          ];
        case "mobile.screens_per_session":
          return [pick(metricId, resource.totals.avgScreensPerSession, null)];
        case "mobile.foreground_duration":
          return [pick(metricId, resource.totals.avgSessionDurationMs, null)];
        case "mobile.observed_installations":
          return [
            pick(
              metricId,
              resource.totals.observedInstallations,
              resource.comparison.observedInstallations,
            ),
          ];
      }
      break;
    }
    case "errors.occurrences":
    case "errors.affected_identities":
    case "errors.handled":
    case "errors.unhandled":
    case "errors.unresolved_issues":
    case "errors.new_issues":
    case "errors.regressing_issues": {
      const errorFilters = {
        sourceIds,
        platform: filters.platform,
        release: filters.release,
        environment: filters.environment,
      };
      if (metricId === "errors.occurrences") {
        const current = await errorOccurrenceCount(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          errorFilters,
        );
        const previous = await errorOccurrenceCount(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          errorFilters,
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
            queryContext,
            coverage,
            coverageNote: "Error occurrences in range",
            drilldown,
            requestFilters: filters,
          }),
        ];
      }
      if (metricId === "errors.affected_identities") {
        const current = await errorAffectedIdentities(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          errorFilters,
        );
        const previous = await errorAffectedIdentities(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          errorFilters,
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
            queryContext,
            coverage,
            coverageNote: "Distinct anonymous ids in range",
            drilldown,
            requestFilters: filters,
          }),
        ];
      }
      if (metricId === "errors.handled" || metricId === "errors.unhandled") {
        const handled = metricId === "errors.handled" ? 1 : 0;
        const current = await errorOccurrenceCount(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          { ...errorFilters, handled: handled as 0 | 1 },
        );
        const previous = await errorOccurrenceCount(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          { ...errorFilters, handled: handled as 0 | 1 },
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
            queryContext,
            coverage,
            coverageNote:
              handled === 1 ? "Handled occurrences" : "Unhandled occurrences",
            drilldown,
            requestFilters: filters,
          }),
        ];
      }
      const states = await errorIssueStateCounts(
        client,
        projectId,
        w.from,
        w.to,
        w.compareFrom,
        w.compareTo,
        w.asOf,
        { platform: filters.platform, release: filters.release },
      );
      const value =
        metricId === "errors.unresolved_issues"
          ? states.unresolved
          : metricId === "errors.new_issues"
            ? states.fresh
            : states.regressing;
      return [
        makeFact({
          metricId,
          value,
          comparison: null,
          queryContext,
          coverage,
          coverageNote: "Issue state aggregate",
          drilldown,
          requestFilters: filters,
        }),
      ];
    }
  }
}

/**
 * Measure validated metrics sequentially with snapshot caching and optional
 * run-level memoization. Unknown metrics/filters throw `MetricQueryError`;
 * unmet capabilities yield null-valued facts (explicit unsupported states),
 * never fabricated zeros.
 */
export async function measureMetrics(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scopeSourceIds: string[],
  requests: MetricRequest[],
  deps: MeasureDeps,
): Promise<MetricFact[]> {
  const now = deps.now ?? Date.now();
  const { queryContext } = publicContextFor(
    projectId,
    "",
    window,
    scopeSourceIds,
  );
  const facts: MetricFact[] = [];
  for (const request of requests) {
    const { metricId, filters } = validateMetricRequest(request);
    const key = cacheKey(projectId, queryContext, metricId, filters);
    const cached = cachedFacts(key, now);
    const cacheHit =
      cached?.every((fact) =>
        areQueryContextsEqual(fact.queryContext, queryContext),
      ) ?? false;
    if (cacheHit && cached) {
      facts.push(...cached);
      continue;
    }
    const measured = await measureOne(
      client,
      projectId,
      window,
      scopeSourceIds,
      metricId,
      filters,
      deps,
    );
    storeFacts(key, measured, now);
    facts.push(...measured);
  }
  return facts;
}
