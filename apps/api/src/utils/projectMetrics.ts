import { createHash } from "node:crypto";
import { z } from "zod";
import {
  areQueryContextsEqual,
  capabilityFingerprint,
  compareValues,
  DEFINITION_VERSION,
  isSnapshotReplayable,
  MAX_CURRENCY_ROWS,
  METRIC_IDS,
  METRIC_REGISTRY,
  queryContextFingerprint,
  StandardEventKeySchema,
  type ComparisonBasis,
  type ComparisonValue,
  type CoverageSummary,
  type DrilldownDestination,
  type DrilldownFilters,
  type MetricFact,
  type MetricId,
  type ProjectCapabilities,
  type PublicQueryContext,
  type SourceScope,
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

/**
 * Canonical source scope (R4-F1, R5-F1): `all` = no source filter,
 * `selected` = the explicit ID list (possibly empty for an explicit empty
 * intersection). The scope travels in the public context, token, cache
 * key, fact filters, and drill-down — never inferred from list length.
 */
export type MetricScope = {
  sourceScope: SourceScope;
  sourceIds: string[];
};

const MetricScopeSchema = z
  .strictObject({
    sourceScope: z.enum(["all", "selected"]),
    sourceIds: z.array(z.string().min(1).max(128)).max(64),
  })
  .superRefine((value, context) => {
    if (new Set(value.sourceIds).size !== value.sourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "sourceIds must not contain duplicates",
      });
    }
    if (value.sourceScope === "all" && value.sourceIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "sourceScope all must carry an empty sourceIds list",
      });
    }
  });

/**
 * Parse and validate a shared source scope at the canonical service
 * boundary (R5-F1). `all` must carry no IDs; `selected` IDs are bounded
 * (64), deduplicated, and length-checked. Rejects mismatched scopes
 * before any SQL runs so a mislabeled scope can never widen a read.
 */
export function parseMetricScope(raw: unknown): MetricScope {
  const parsed = MetricScopeSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((entry) => `${entry.path.join(".") || "scope"}: ${entry.message}`)
      .join("; ")
      .slice(0, 280);
    throw new MetricQueryError("invalid-filter", `Invalid source scope: ${detail}`);
  }
  return {
    sourceScope: parsed.data.sourceScope,
    sourceIds: [...parsed.data.sourceIds],
  };
}

/** Set-equality for scope/filter agreement (order-insensitive). */
function scopeIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((id) => set.has(id));
}

/** Sync SHA-256 hex (server-only; R8-F5 release IDs, R8-F2 filter IDs). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Canonical fact ID from normalized semantic filter identity (R8-F2, R9-F2).
 * Bounded enum filters travel inline (`standardEventKey`, `currency` —
 * both are required on a Standard Event currency fact); any other present
 * filter folds into a domain-separated SHA-256 digest over the sorted JSON
 * `[key, value]` tuple array, so `path="/x&traffic=all"` and
 * `path="/x", traffic="all"` never serialize alike. At least 128 digest
 * bits travel in the ID and unbounded telemetry never does. `sourceIds`
 * are excluded: the source scope lives in the query context, never the ID.
 */
export function factIdFor(metricId: MetricId, filters: MetricFilters): string {
  const parts: string[] = [metricId];
  if (filters.standardEventKey) parts.push(filters.standardEventKey);
  if (filters.currency) parts.push(filters.currency);
  const rest: Array<[string, string]> = [];
  if (filters.traffic) rest.push(["traffic", filters.traffic]);
  if (filters.os) rest.push(["os", filters.os]);
  if (filters.release) rest.push(["release", filters.release]);
  if (filters.host) rest.push(["host", filters.host]);
  if (filters.path) rest.push(["path", filters.path]);
  if (filters.platform) rest.push(["platform", filters.platform]);
  if (filters.environment) rest.push(["environment", filters.environment]);
  if (rest.length > 0) {
    rest.sort(([a], [b]) => (a < b ? -1 : 1));
    const digest = sha256Hex(
      `metric-filter\0${metricId}\0${JSON.stringify(rest)}`,
    ).slice(0, 32);
    parts.push(`f${digest}`);
  }
  return parts.join(":");
}

/**
 * Strict shared release-filter boundary (R8-F7): values of length 1
 * through 128 (the ingestion bound) pass through exactly — never trimmed,
 * never sliced. Anything else is a non-disclosing `invalid_filter` at the
 * route, never a silent query for an unrelated prefix.
 */
export function parseReleaseFilter(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 128) {
    throw new MetricQueryError("invalid-filter", "Invalid release filter");
  }
  return raw;
}

/**
 * Exact comparison basis for one canonical measurement (R8-F3): the
 * previous-window value the comparison was computed from, plus exact rate
 * denominators where the metric has them. Callers pass the numbers they
 * already hold — never a reversed rounded percentage.
 */
export function exactBasis(
  previousValue: number | null,
  denominators?: { current: number | null; previous: number | null },
): ComparisonBasis {
  return {
    previousValue,
    denominatorCurrent: denominators?.current ?? null,
    denominatorPrevious: denominators?.previous ?? null,
  };
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

/**
 * Strict metric-query schema at the service boundary (R3-F1). Every value
 * is bounded and validated even when the caller is an internal agent tool:
 * source IDs are capped at the public/token contract limit of 64 with no
 * duplicates, enums are exact, and unknown keys are rejected (strict
 * object) rather than silently ignored by structural typing.
 */
const MetricFiltersSchema = z.strictObject({
  sourceIds: z
    .array(z.string().min(1).max(128))
    .max(64)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "sourceIds must not contain duplicates",
    })
    .optional(),
  standardEventKey: StandardEventKeySchema.optional(),
  traffic: z.enum(["human", "all"]).optional(),
  os: z.enum(["ios", "android"]).optional(),
  release: z.string().min(1).max(128).optional(),
  host: z.string().min(1).max(253).optional(),
  path: z.string().min(1).max(2048).optional(),
  platform: z
    .enum(["web", "ios", "android", "react-native", "server"])
    .optional(),
  environment: z.string().min(1).max(64).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code")
    .optional(),
});

export const MetricRequestSchema = z.strictObject({
  metricId: z.enum(METRIC_IDS),
  filters: MetricFiltersSchema.optional(),
});

/** Parse an untrusted metric request (HTTP or future agent tool). */
export function parseMetricRequest(raw: unknown): {
  metricId: MetricId;
  filters: MetricFilters;
} {
  const parsed = MetricRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue && issue.path.join(".") === "metricId") {
      throw new MetricQueryError(
        "unknown-metric",
        `Unknown metric: ${String((raw as { metricId?: unknown })?.metricId)}`,
      );
    }
    const detail = parsed.error.issues
      .map((entry) => `${entry.path.join(".") || "request"}: ${entry.message}`)
      .join("; ")
      .slice(0, 280);
    throw new MetricQueryError(
      "invalid-filter",
      `Invalid metric query: ${detail}`,
    );
  }
  return { metricId: parsed.data.metricId, filters: parsed.data.filters ?? {} };
}

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
  // Strict value validation first (bounds, enums, duplicates, unknown
  // keys), then registry support checks per metric.
  const { metricId, filters } = parseMetricRequest(request);
  const definition = METRIC_REGISTRY[metricId];
  for (const key of Object.keys(filters) as Array<keyof MetricFilters>) {
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

/**
 * Freshness boundary for current-only facts (R3-F5): snapshots at least
 * this far behind measurement time are historical, and status-derived
 * facts carry an explicit caveat instead of posing as frozen history.
 */
export const HISTORICAL_SNAPSHOT_SKEW_MS = 60_000;

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
  capabilities: ProjectCapabilities,
): string {
  // Capabilities join the key (R3-F2, R5-F3): configuring error collection
  // (or any collection) must never serve a stale unsupported fact, and
  // coverage-embedded counts (total/active) plus the observed event set
  // must never alias across capability changes for 60 seconds.
  return [
    projectId,
    queryContextFingerprint(queryContext),
    metricId,
    JSON.stringify(filters),
    capabilityFingerprint(capabilities),
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
  extra: {
    sourceIds?: string[];
    name?: string;
    standardKey?: string;
    currency?: string;
  } = {},
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
  if (extra.currency) {
    // Currency scopes occurrences exactly like values (R3-F4): a
    // USD-filtered occurrence fact never counts EUR rows.
    clauses.push(
      `json_extract(events.properties, '$."$standard".data.currency') = ?`,
    );
    args.push(extra.currency);
  }
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM events WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return Number(rows[0]?.n ?? 0);
}

async function countIdentifiedPeople(
  client: CanonicalClient,
  projectId: string,
  from: number,
  to: number,
  asOf: number,
  sourceIds?: string[],
): Promise<number> {
  // Identified AT THE SNAPSHOT (R3-F3): the event's person holds a
  // developer-supplied external identity linked at or before `asOf`. A
  // later identify cannot reclassify this historical fact, and ordinary
  // anonymous traffic (deterministic `a_*` person IDs, never null) is
  // excluded by the link check rather than by nullability.
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.person_id IS NOT NULL");
  clauses.push(`EXISTS (SELECT 1 FROM external_identities x
    WHERE x.project_id = events.project_id AND x.person_id = events.person_id
      AND x.linked_at <= ?)`);
  args.push(asOf);
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
  // Anonymous-only subjects AT THE SNAPSHOT (R4-F2): the stable subject
  // key is the IMMUTABLE event `anonymous_id` where present — ingestion
  // reassigns `person_id` from `a_*` to `u_*` on identify and deletes the
  // anonymous person row, so `COUNT(DISTINCT person_id)` undercounts
  // history after a merge (two `a_*` subjects become one `u_*` row).
  // `anonymous_id` never mutates, so the old snapshot still sees two
  // subjects. Attributable events lacking `anonymous_id` fall back to
  // `person_id` (documented); events without any person carry no subject
  // and are excluded, never conflated.
  const { clauses, args } = eventScope(projectId, from, to, asOf, sourceIds);
  clauses.push("events.person_id IS NOT NULL");
  clauses.push(`NOT EXISTS (SELECT 1 FROM external_identities x
    WHERE x.project_id = events.project_id AND x.person_id = events.person_id
      AND x.linked_at <= ?)`);
  args.push(asOf);
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT COALESCE(events.anonymous_id, events.person_id)) AS n FROM events WHERE ${clauses.join(" AND ")}`,
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
    WHERE x.project_id = events.project_id AND x.person_id = events.person_id
      AND x.linked_at <= ?)`);
  args.push(asOf);
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
  filters: { sourceIds?: string[]; platform?: string; release?: string } = {},
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
  if (filters.release) {
    clauses.push("release = ?");
    args.push(filters.release);
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
 *
 * Release membership comes from the SAME cutoff-visible occurrence set
 * (R4-F4, R5-F2) — never from the mutable `first_release`/`last_release`
 * projection that later receipts keep updating. Co-occurrence only, never
 * a causal claim.
 *
 * Each counter has its own independent release rule (R6-F3): unresolved
 * uses current status plus any-visible release membership, new uses the
 * first visible occurrence's release, and regressing uses current-window
 * co-occurrence. One counter's rule never short-circuits another, so an
 * issue first seen in `1.0` with later `2.0` activity counts for
 * unresolved-under-`2.0` while correctly missing new-under-`2.0`.
 *
 * Bounded transfer (R6-F4): the per-issue derivation lives in a CTE and an
 * outer aggregate returns exactly one totals row. Query count and result
 * rows stay constant no matter how many issues a project holds, so a large
 * error-tracking project cannot blow a Worker budget through this path.
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
  // NOTE: `?` placeholders bind in TEXTUAL order. SELECT aggregates precede
  // the WHERE clause, so window parameters come first in args (a previous
  // revision ordered projectId first and silently matched zero rows).
  const issueClauses = ["i.project_id = ?"];
  const scopeArgs: Array<string | number | null> = [projectId];
  if (filter.platform) {
    issueClauses.push("i.platform = ?");
    scopeArgs.push(filter.platform);
  }
  const release = filter.release ?? null;
  // Ordering key for "earliest visible occurrence" (R5-F2): zero-padded
  // occurred/received (lexical MIN == chronological MIN for equal-width
  // integers) plus the id tie-break. An issue's first visible release is
  // `filter` exactly when the MIN key over the release subset equals the
  // MIN key over all visible occurrences — no release payload to parse.
  const ORDER_KEY =
    "printf('%020d|%020d|%s', o.occurred_at, o.received_at, o.id)";
  const cteExtras: string[] = [];
  const cteArgs: Array<string | number | null> = [];
  if (release !== null) {
    cteExtras.push(
      `MIN(CASE WHEN o.received_at <= ? THEN ${ORDER_KEY} END) AS first_any`,
    );
    cteArgs.push(asOf);
    cteExtras.push(
      `MIN(CASE WHEN o.received_at <= ? AND o.release = ? THEN ${ORDER_KEY} END) AS first_filter`,
    );
    cteArgs.push(asOf, release);
    cteExtras.push(
      "SUM(CASE WHEN o.received_at <= ? AND o.release = ? THEN 1 ELSE 0 END) AS any_n",
    );
    cteArgs.push(asOf, release);
    cteExtras.push(
      "SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? AND o.release = ? THEN 1 ELSE 0 END) AS window_n",
    );
    cteArgs.push(from, to, asOf, release);
  }
  // Independent per-counter predicates (R6-F3): each outer SUM tests only
  // its own release rule. Fresh needs a first-seen inside the window (and
  // first-release match when filtered); regressing needs a non-new growing
  // issue (and window co-occurrence when filtered); unresolved needs
  // current status (and any-visible membership when filtered). One
  // counter's rule never short-circuits another, so an issue first seen
  // in `1.0` with later `2.0` activity counts for unresolved-under-`2.0`
  // while correctly missing new-under-`2.0`.
  const freshRelease =
    release !== null
      ? "AND first_filter IS NOT NULL AND first_filter = first_any"
      : "";
  const regressingRelease = release !== null ? "AND window_n > 0" : "";
  const unresolvedRelease = release !== null ? "AND any_n > 0" : "";
  // Bounded transfer (R6-F4): the per-issue derivation lives in the CTE and
  // the outer aggregate returns exactly one totals row. Query count and
  // result rows stay constant no matter how many issues a project holds.
  const { rows } = await client.execute({
    sql: `WITH per_issue AS (
            SELECT
              i.status AS status,
              SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? THEN 1 ELSE 0 END) AS current_n,
              SUM(CASE WHEN o.occurred_at >= ? AND o.occurred_at < ? AND o.received_at <= ? THEN 1 ELSE 0 END) AS previous_n,
              MIN(CASE WHEN o.received_at <= ? THEN o.occurred_at END) AS snapshot_first_seen
              ${cteExtras.length > 0 ? `, ${cteExtras.join(", ")}` : ""}
            FROM error_issues i
            LEFT JOIN error_occurrences o
              ON o.issue_id = i.id AND o.project_id = i.project_id
            WHERE ${issueClauses.join(" AND ")}
            GROUP BY i.id, i.status
          )
          SELECT
            SUM(CASE WHEN status = 'unresolved' ${unresolvedRelease} THEN 1 ELSE 0 END) AS unresolved,
            SUM(CASE WHEN snapshot_first_seen IS NOT NULL AND snapshot_first_seen >= ? AND snapshot_first_seen < ? ${freshRelease} THEN 1 ELSE 0 END) AS fresh,
            SUM(CASE WHEN snapshot_first_seen IS NOT NULL AND NOT (snapshot_first_seen >= ? AND snapshot_first_seen < ?) AND previous_n > 0 AND current_n > previous_n ${regressingRelease} THEN 1 ELSE 0 END) AS regressing
          FROM per_issue`,
    args: [
      from,
      to,
      asOf,
      compareFrom,
      compareTo,
      asOf,
      asOf,
      ...cteArgs,
      ...scopeArgs,
      from,
      to,
      from,
      to,
    ],
  });
  const row = rows[0] ?? {};
  return {
    unresolved: Number(row.unresolved ?? 0),
    fresh: Number(row.fresh ?? 0),
    regressing: Number(row.regressing ?? 0),
  };
}

export type MeasureDeps = {
  capabilities: ProjectCapabilities;
  memo?: Map<string, unknown>;
  now?: number;
};

function normalizeScope(
  scope: MetricScope | readonly string[] | undefined,
  fallbackFilters?: MetricFilters,
): MetricScope {
  if (scope === undefined) {
    // No shared scope supplied: infer from the request's own filter
    // presence — explicit (even empty) means selected.
    if (fallbackFilters?.sourceIds !== undefined) {
      return { sourceScope: "selected", sourceIds: [...fallbackFilters.sourceIds] };
    }
    return { sourceScope: "all", sourceIds: [] };
  }
  if (Array.isArray(scope as unknown as unknown[])) {
    // Legacy callers pass only IDs: an empty list meant `all`. New code
    // passes the explicit object; per-request filters still drive SQL.
    return { sourceScope: "all", sourceIds: [...(scope as readonly string[])] };
  }
  const explicit = scope as MetricScope;
  return { sourceScope: explicit.sourceScope, sourceIds: [...explicit.sourceIds] };
}

function publicContextFor(
  projectId: string,
  organizationId: string,
  window: MetricWindow,
  scope: MetricScope | readonly string[],
): {
  queryContext: PublicQueryContext;
  projectId: string;
  organizationId: string;
} {
  void projectId;
  void organizationId;
  const normalized = normalizeScope(scope);
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
      sourceScope: normalized.sourceScope,
      sourceIds: [...normalized.sourceIds],
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
  scope?: MetricScope,
): DrilldownDestination {
  const base = METRIC_REGISTRY[metricId].drilldown;
  const picked: DrilldownFilters = {};
  // R4-F1: the signed scope echoes in every drill-down so an explicit
  // empty intersection never renders as an unfiltered link.
  picked.sourceScope = scope?.sourceScope ?? (filters.sourceIds !== undefined ? "selected" : "all");
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
function factFiltersFor(
  filters: MetricFilters,
  scope?: MetricScope,
): DrilldownFilters {
  const picked: DrilldownFilters = {};
  // R4-F1: scope is the only distinction between `all` ([]) and an
  // explicit empty intersection (`selected` + []).
  picked.sourceScope = scope?.sourceScope ?? (filters.sourceIds !== undefined ? "selected" : "all");
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
  idFilters?: MetricFilters;
  value: number | null;
  comparison: ComparisonValue | null;
  comparisonBasis?: ComparisonBasis;
  queryContext: PublicQueryContext;
  coverage: CoverageSummary;
  coverageNote: string;
  drilldown: DrilldownDestination;
  currency?: string;
  labelSuffix?: string;
  requestFilters?: MetricFilters;
  scope?: MetricScope;
}): MetricFact {
  const definition = METRIC_REGISTRY[args.metricId];
  const { formattedValue, unit } =
    args.value === null
      ? { formattedValue: "—", unit: null }
      : formatMetricValue(definition.valueKind, args.value, args.currency);
  // Canonical ID (R8-F2, R9-F2): every fact ID derives from the metric
  // plus its complete normalized filter set — no bypass. Callers measuring
  // one row per filter combination pass that row's exact filters via
  // `idFilters` (e.g. per-currency rows); it defaults to the request
  // filters. A Standard Event currency fact therefore carries both key
  // and currency.
  const identityFilters = args.idFilters ?? args.requestFilters ?? {};
  const id = factIdFor(args.metricId, identityFilters);
  return {
    id,
    metricId: args.metricId,
    definitionVersion: DEFINITION_VERSION,
    label: args.labelSuffix
      ? `${definition.label} (${args.labelSuffix})`
      : definition.label,
    value: args.value,
    formattedValue,
    unit,
    comparison: args.comparison,
    comparisonBasis: args.comparisonBasis ?? {
      previousValue: null,
      denominatorCurrent: null,
      denominatorPrevious: null,
    },
    queryContext: args.queryContext,
    coverage: args.coverage,
    coverageNote: args.coverageNote.slice(0, 200),
    filters: factFiltersFor(identityFilters, args.scope),
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
  scope?: MetricScope,
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
    scope,
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
  scopeInput: MetricScope | readonly string[],
  metricId: MetricId,
  filters: MetricFilters,
  deps: MeasureDeps,
): Promise<MetricFact[]> {
  const scope = normalizeScope(scopeInput, filters);
  const { queryContext } = publicContextFor(projectId, "", window, scope);
  const coverage = coverageFor(deps.capabilities);
  const drilldown = drilldownFor(metricId, filters, scope);
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
        scope,
      ),
    ];
  }
  // Known-inaccurate Mobile series (R10-F1, Task 18 R4-F3): visitor
  // folding counts installation digests instead of resolved people, and
  // installations ignore os/release filters. Until that read-model
  // contract lands, these facts are explicitly unsupported anywhere they
  // could reach pulse, evidence, widgets, or assistant tools — never
  // served numbers with filtered metadata. The Mobile dashboard keeps
  // its loader-direct reads; Task 18 owns that surface.
  if (
    metricId === "mobile.visitors" ||
    metricId === "mobile.observed_installations"
  ) {
    return [
      unsupportedFact(
        metricId,
        queryContext,
        coverage,
        "Mobile visitor and installation counts are unavailable pending Task 18 R4-F3 (identity folding; observation-time dimensions)",
        drilldown,
        filters,
        scope,
      ),
    ];
  }
  // Explicit empty source intersection (R3-F1, R4-F1): `selected` + `[]`
  // is a successful read over an empty scope — honest zeros, never a
  // widened all-source query. `all` still means every project source.
  // The verified scope (not list length) drives the branch so a follow-up
  // reusing the token cannot widen. Capability shortfalls win above.
  // measureMetrics already enforces scope/filter agreement, so reaching
  // here with a mismatch is a caller bug — but scope still drives SQL.
  const isEmptySelected =
    scope.sourceScope === "selected" && scope.sourceIds.length === 0;
  if (isEmptySelected) {
    if (metricId === "standard_event.value_by_currency") {
      // No currency rows exist over an empty scope — except an explicit
      // currency request, which always yields its one (real zero) fact.
      if (!filters.currency) return [];
      return [
        makeFact({
          metricId,
          value: 0,
          comparison: compareValues(0, 0),
          comparisonBasis: exactBasis(0),
          queryContext,
          coverage,
          coverageNote: "No requested sources belong to this project",
          drilldown,
          currency: filters.currency,
          labelSuffix: filters.currency,
          requestFilters: filters,
          scope,
        }),
      ];
    }
    // Empty selections yield honest zeros, but comparison-unsupported
  // metrics keep the explicit null state (R9-F1): a zero value with no
  // comparison claim and null basis, never a flat comparison the metric
  // definition does not support. Rate metrics carry zero denominators —
  // zero eligible records — so the required-denominator rule (R10-F4)
  // holds over empty scopes as well.
  const emptyDefinition = METRIC_REGISTRY[metricId];
  const emptySupported = emptyDefinition.comparison === "supported";
  const emptyIsRate = emptyDefinition.valueKind === "rate";
  return [
      makeFact({
        metricId,
        value: 0,
        comparison: emptySupported ? compareValues(0, 0) : null,
        // Counts stay comparable over the empty scope; unsupported metrics
        // keep the explicit null state (R9-F1) — value zero, no comparison.
        comparisonBasis: emptySupported
          ? exactBasis(0, emptyIsRate ? { current: 0, previous: 0 } : undefined)
          : undefined,
        queryContext,
        coverage,
        coverageNote: "No requested sources belong to this project",
        drilldown,
        requestFilters: filters,
        scope,
      }),
    ];
  }
  // Selected-source contexts cannot widen through metrics that lack source
  // filtering (R5-F1): omit with an explicit unavailable fact instead of
  // computing all-source data under selected metadata. Empty selections
  // already returned honest zeros above.
  if (
    scope.sourceScope === "selected" &&
    !(METRIC_REGISTRY[metricId].supportedFilters as readonly string[]).includes(
      "source_ids",
    )
  ) {
    return [
      unsupportedFact(
        metricId,
        queryContext,
        coverage,
        "Metric does not support source filtering in a selected-source context",
        drilldown,
        filters,
        scope,
      ),
    ];
  }
  // Authoritative source filter (R5-F1): SQL reads the verified scope, never
  // a per-request copy. Agreement was enforced in measureMetrics.
  const sourceIds =
    scope.sourceScope === "all" ? undefined : [...scope.sourceIds];
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
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage,
          coverageNote: "Accepted event occurrences",
          drilldown,
          requestFilters: filters,
          scope,
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
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage,
          coverageNote: "Sessions started in range",
          drilldown,
          requestFilters: filters,
          scope,
        }),
      ];
    }
    case "project.active_people": {
      const current = await countIdentifiedPeople(
        client,
        projectId,
        w.from,
        w.to,
        w.asOf,
        sourceIds,
      );
      const previous = await countIdentifiedPeople(
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
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage,
          coverageNote: "Identified people with activity",
          drilldown,
          requestFilters: filters,
          scope,
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
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage,
          coverageNote: "First external identity links",
          drilldown,
          requestFilters: filters,
          scope,
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
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage,
          coverageNote: "Anonymous-only subjects, not unique humans",
          drilldown,
          requestFilters: filters,
          scope,
        }),
      ];
    }
    case "standard_event.occurrences":
    case "standard_event.people":
    case "standard_event.value_by_currency": {
      const key = filters.standardEventKey as string;
      const name = protectedNameFor(key);
      if (metricId === "standard_event.occurrences") {
        const extra = {
          sourceIds,
          name,
          standardKey: key,
          currency: filters.currency,
        };
        const current = await countEvents(
          client,
          projectId,
          w.from,
          w.to,
          w.asOf,
          extra,
        );
        const previous = await countEvents(
          client,
          projectId,
          w.compareFrom,
          w.compareTo,
          w.asOf,
          extra,
        );
        return [
          makeFact({
            metricId,
            value: current,
            comparison: compareValues(current, previous),
          comparisonBasis: exactBasis(previous),
            queryContext,
            coverage,
            coverageNote: `Accepted ${key} occurrences`,
            drilldown,
            requestFilters: filters,
            scope,
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
          comparisonBasis: exactBasis(previous),
            queryContext,
            coverage,
            coverageNote: `Identified people with ${key}`,
            drilldown,
            requestFilters: filters,
            scope,
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
      // Deterministic union of both windows' currencies (R3-F4): a missing
      // side reads as zero, so new currencies and complete drops are both
      // represented. An explicit currency request always yields exactly one
      // fact after a successful read — including a real zero.
      const currencies = new Set<string>();
      if (filters.currency) {
        currencies.add(filters.currency);
      } else {
        for (const row of rows) currencies.add(row.currency);
        for (const row of previousRows) currencies.add(row.currency);
      }
      const ordered = [...currencies].sort();
      const currentByCurrency = new Map(
        rows.map((row) => [row.currency, row.totalMinor]),
      );
      const truncated = ordered.length > MAX_CURRENCY_ROWS;
      const kept = ordered.slice(0, MAX_CURRENCY_ROWS);
      return kept.map((currency) => {
        const total = currentByCurrency.get(currency) ?? 0;
        const previous = previousByCurrency.get(currency) ?? 0;
        const warnings =
          truncated && currency === kept[kept.length - 1]
            ? [
                ...coverage.warnings,
                `Currency rows capped at ${MAX_CURRENCY_ROWS}; remaining currencies omitted`,
              ]
            : coverage.warnings;
        return makeFact({
          metricId,
          idFilters: { ...filters, currency },
          value: total,
          comparison: compareValues(total, previous),
          comparisonBasis: exactBasis(previous),
          queryContext,
          coverage: { ...coverage, warnings: warnings.slice(0, 8) },
          coverageNote: `${key} value in ${currency}; never converted`,
          drilldown: drilldownFor(metricId, { ...filters, currency }, scope),
          currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
          labelSuffix: currency,
          requestFilters: filters,
          scope,
        });
      });
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
      let loaded = memoized<Awaited<ReturnType<typeof loadWebAnalytics>>>(
        deps.memo,
        memoKey,
      );
      if (!loaded) {
        loaded = await loadWebAnalytics(
          { ...params, asOf: w.asOf },
          w.asOf,
          client,
        );
        remember(deps.memo, memoKey, loaded);
      }
      const resource = loaded.resource;
      const webBasis = loaded.basis;
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
        basis?: ComparisonBasis,
      ): MetricFact =>
        makeFact({
          metricId: id,
          value,
          comparison,
          comparisonBasis: basis,
          queryContext,
          coverage: webCoverage,
          coverageNote: note,
          drilldown: drilldownFor(id, filters, scope),
          requestFilters: filters,
          scope,
        });
      switch (metricId) {
        case "web.page_views":
          return [
            pick(
              metricId,
              resource.totals.pageViews,
              resource.comparison.pageViews,
              exactBasis(webBasis.previous.pageViews),
            ),
          ];
        case "web.visitors":
          return [
            pick(
              metricId,
              resource.totals.visitors,
              resource.comparison.visitors,
              exactBasis(webBasis.previous.visitors),
            ),
          ];
        case "web.sessions":
          return [
            pick(
              metricId,
              resource.totals.sessions,
              resource.comparison.sessions,
              exactBasis(webBasis.previous.sessions),
            ),
          ];
        case "web.views_per_session":
          return [
            pick(
              metricId,
              resource.totals.viewsPerSession,
              resource.comparison.viewsPerSession,
              exactBasis(webBasis.previous.viewsPerSession),
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
              resource.totals.bounceRate === null
                ? undefined
                : exactBasis(webBasis.previous.bounceRate, {
                    current: webBasis.bounceDenominators.current,
                    previous: webBasis.bounceDenominators.previous,
                  }),
            ),
          ];
        case "web.excluded_bots":
          return [pick(metricId, resource.totals.excludedBots, null)];
      }
      break;
    }
    case "mobile.app_opens":
    case "mobile.sessions":
    case "mobile.screens_per_session":
    case "mobile.foreground_duration": {
      const params: MobileAnalyticsQueryParams = {
        projectId,
        from: w.from,
        to: w.to,
        sourceIds: sourceIds ?? [],
        os: filters.os ?? null,
        release: filters.release ?? null,
      };
      const memoKey = `mobile|${w.from}|${w.to}|${w.asOf}|${JSON.stringify(params)}`;
      let loaded = memoized<Awaited<ReturnType<typeof loadMobileAnalytics>>>(
        deps.memo,
        memoKey,
      );
      if (!loaded) {
        loaded = await loadMobileAnalytics(client, {
          ...params,
          asOf: w.asOf,
        });
        remember(deps.memo, memoKey, loaded);
      }
      const resource = loaded.resource;
      const mobilePrevious = loaded.basis.previous;
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
        basis?: ComparisonBasis,
      ): MetricFact =>
        makeFact({
          metricId: id,
          value,
          comparison,
          comparisonBasis: basis,
          queryContext,
          coverage: mobileCoverage,
          coverageNote: note,
          drilldown: drilldownFor(id, filters, scope),
          requestFilters: filters,
          scope,
        });
      switch (metricId) {
        case "mobile.app_opens":
          return [
            pick(
              metricId,
              resource.totals.appOpens,
              resource.comparison.appOpens,
              mobilePrevious === null
                ? undefined
                : exactBasis(mobilePrevious.appOpens),
            ),
          ];
        case "mobile.sessions":
          return [
            pick(
              metricId,
              resource.totals.appSessions,
              resource.comparison.appSessions,
              mobilePrevious === null
                ? undefined
                : exactBasis(mobilePrevious.sessions),
            ),
          ];
        case "mobile.screens_per_session":
          return [
            pick(
              metricId,
              resource.totals.avgScreensPerSession,
              // Decimal means compare through the one canonical function
              // (R9-F1) instead of advertising support while returning null.
              resource.totals.avgScreensPerSession === null
                ? null
                : compareValues(
                    resource.totals.avgScreensPerSession,
                    mobilePrevious?.screensPerSession ?? null,
                  ),
              mobilePrevious === null ||
              resource.totals.avgScreensPerSession === null
                ? undefined
                : exactBasis(mobilePrevious.screensPerSession),
            ),
          ];
        case "mobile.foreground_duration":
          return [
            pick(
              metricId,
              resource.totals.avgSessionDurationMs,
              resource.totals.avgSessionDurationMs === null
                ? null
                : compareValues(
                    resource.totals.avgSessionDurationMs,
                    mobilePrevious?.foregroundDurationMs ?? null,
                  ),
              mobilePrevious === null ||
              resource.totals.avgSessionDurationMs === null
                ? undefined
                : exactBasis(mobilePrevious.foregroundDurationMs),
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
          comparisonBasis: exactBasis(previous),
            queryContext,
            coverage,
            coverageNote: "Error occurrences in range",
            drilldown,
            requestFilters: filters,
            scope,
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
          comparisonBasis: exactBasis(previous),
            queryContext,
            coverage,
            coverageNote: "Distinct anonymous ids in range",
            drilldown,
            requestFilters: filters,
            scope,
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
          comparisonBasis: exactBasis(previous),
            queryContext,
            coverage,
            coverageNote:
              handled === 1 ? "Handled occurrences" : "Unhandled occurrences",
            drilldown,
            requestFilters: filters,
            scope,
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
      const now = deps.now ?? Date.now();
      const isHistorical = w.asOf < now - HISTORICAL_SNAPSHOT_SKEW_MS;
      // R4-F4: `errors.unresolved_issues` is current-only (typed
      // `snapshot: "current-only"` in the registry). No timestamped status
      // history exists — including system reopen-on-occurrence — so a
      // historical snapshot cannot replay it. Fresh snapshots return the
      // live count; historical ones return an explicit typed unavailable
      // (null) fact, never a numeric value with only a warning string.
      // `isSnapshotReplayable()` is the machine-readable gate Slice 3
      // insight selection must consult before comparing or replaying.
      if (metricId === "errors.unresolved_issues" && isHistorical) {
        void isSnapshotReplayable(metricId);
        const unavailableCoverage = {
          ...coverage,
          warnings: [
            ...coverage.warnings,
            "Unresolved status is current-only and unavailable for historical snapshots",
          ].slice(0, 8),
        };
        return [
          makeFact({
            metricId,
            value: null,
            comparison: null,
            queryContext,
            coverage: unavailableCoverage,
            coverageNote: "Current issue state; not a historical snapshot",
            drilldown,
            requestFilters: filters,
            scope,
          }),
        ];
      }
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
          scope,
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
 *
 * `scope` is the shared signed source scope (R4-F1): `all` or the explicit
 * `selected` list. Legacy callers may pass a bare ID array (treated as
 * `all`); new code passes the explicit object so `all` (`[]`) and
 * `selected` (`[]`) share no cache entry, fingerprint, or token.
 */
export async function measureMetrics(
  client: CanonicalClient,
  projectId: string,
  window: MetricWindow,
  scopeInput: MetricScope | readonly string[],
  requests: MetricRequest[],
  deps: MeasureDeps,
): Promise<MetricFact[]> {
  // Authoritative scope (R5-F1): the shared scope is validated once, then
  // every per-request filter must agree with it exactly. Bare arrays are
  // legacy `all` (empty only — anything else must use the explicit object).
  let scope: MetricScope;
  if (Array.isArray(scopeInput as unknown as unknown[])) {
    const ids = [...(scopeInput as readonly string[])];
    if (ids.length > 0) {
      throw new MetricQueryError(
        "invalid-filter",
        "Bare source ID arrays are legacy all-scope only; pass an explicit MetricScope",
      );
    }
    scope = parseMetricScope({ sourceScope: "all", sourceIds: ids });
  } else {
    scope = parseMetricScope(scopeInput as MetricScope);
  }
  const now = deps.now ?? Date.now();
  const { queryContext } = publicContextFor(projectId, "", window, scope);
  const facts: MetricFact[] = [];
  for (const request of requests) {
    const { metricId, filters } = validateMetricRequest(request);
    // Scope/filter agreement (R5-F1): for source-capable metrics `all`
    // carries no per-request IDs and `selected` must carry exactly the
    // verified set (order-insensitive) — omitted or conflicting filters
    // reject instead of widening. Metrics without source support cannot
    // carry per-request IDs (registry validation already rejects them);
    // they stay measurable under any scope and resolve to honest zeros
    // (empty selections) or explicit unavailable facts (non-empty
    // selections) inside measureOne — never all-source data relabeled.
    const supportsSources = (
      METRIC_REGISTRY[metricId].supportedFilters as readonly string[]
    ).includes("source_ids");
    if (supportsSources) {
      if (scope.sourceScope === "all") {
        if (filters.sourceIds !== undefined) {
          throw new MetricQueryError(
            "invalid-filter",
            "all-source scope must not carry per-request sourceIds",
          );
        }
      } else if (
        filters.sourceIds === undefined ||
        !scopeIdsEqual(scope.sourceIds, filters.sourceIds)
      ) {
        throw new MetricQueryError(
          "invalid-filter",
          "per-request sourceIds must exactly match the verified source scope",
        );
      }
    }
    const key = cacheKey(
      projectId,
      queryContext,
      metricId,
      filters,
      deps.capabilities,
    );
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
      scope,
      metricId,
      filters,
      deps,
    );
    storeFacts(key, measured, now);
    facts.push(...measured);
  }
  return capResponseFacts(facts);
}

/**
 * Response-level fact bound (R3-F4): the frozen resource caps at 27 facts
 * while one value metric can emit up to MAX_CURRENCY_ROWS. Only currency
 * rows are ever truncated — request order otherwise — deterministically by
 * currency ASC with the overflow recorded on the kept rows' coverage.
 */
export function capResponseFacts(facts: MetricFact[]): MetricFact[] {
  if (facts.length <= 27) return facts;
  // Only one metric (per-currency values) emits multi-row facts, and
  // single-row metrics are bounded by the 27 request IDs — so truncation
  // only ever touches currency rows. Deterministic by request order, with
  // the overflow recorded on the kept rows' coverage.
  const singles = facts.filter((fact) => !fact.id.includes(":"));
  const multis = facts.filter((fact) => fact.id.includes(":"));
  const room = Math.max(0, 27 - singles.length);
  const kept = [...singles, ...multis.slice(0, room)];
  const dropped = multis
    .slice(room)
    .map((fact) => fact.id.split(":").slice(1).join(":"));
  if (dropped.length === 0) return kept;
  const note = `Currency rows capped for the 27-fact response bound; omitted ${dropped.sort().join(", ")}`;
  return kept.map((fact) =>
    fact.metricId === "standard_event.value_by_currency"
      ? {
          ...fact,
          coverage: {
            ...fact.coverage,
            warnings: [...fact.coverage.warnings, note].slice(0, 8),
          },
        }
      : fact,
  );
}
