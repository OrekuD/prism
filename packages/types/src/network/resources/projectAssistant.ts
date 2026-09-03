/**
 * Project overview + grounded assistant contracts (Task 21 slice 1).
 *
 * This module is the frozen product language for the adaptive Project
 * overview and the Prism assistant. Dashboard adapters, insight detectors,
 * assistant tools, fixtures, formatting, and drill-down links must resolve
 * through these contracts — never through duplicated formulas in React or
 * raw storage/column names.
 *
 * Slices 2+ implement the service, storage, runtime, and UI behind these
 * types. Anything marked `v1` is intentionally bounded; extensions bump
 * `DEFINITION_VERSION` rather than widening existing fields.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Definition version + overview ranges
// ---------------------------------------------------------------------------

/** Bump when any metric definition, dimension, or comparison semantic changes. */
export const DEFINITION_VERSION = 1;

/** Supported v1 overview ranges. */
export const OVERVIEW_RANGES = ["24h", "7d", "14d", "30d", "90d"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];
export const OverviewRangeSchema = z.enum(OVERVIEW_RANGES);

/** Fixed range lengths in ms (UTC calendar math stays in slice 2). */
export const OVERVIEW_RANGE_MS: Record<OverviewRange, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 86_400_000,
  "14d": 14 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

// ---------------------------------------------------------------------------
// Metric registry
// ---------------------------------------------------------------------------

/** Frozen v1 metric IDs — the only metrics overview/tools may reference. */
export const METRIC_IDS = [
  // Cross-source project metrics
  "project.accepted_events",
  "project.sessions",
  "project.active_people",
  "project.new_people",
  "project.active_anonymous",
  "standard_event.occurrences",
  "standard_event.people",
  "standard_event.value_by_currency",
  // Web (Task 17 definitions)
  "web.page_views",
  "web.visitors",
  "web.sessions",
  "web.views_per_session",
  "web.bounce_rate",
  "web.excluded_bots",
  // Mobile (Task 18 definitions)
  "mobile.app_opens",
  "mobile.visitors",
  "mobile.sessions",
  "mobile.screens_per_session",
  "mobile.foreground_duration",
  "mobile.observed_installations",
  // Errors (Task 15 aggregates)
  "errors.occurrences",
  "errors.unresolved_issues",
  "errors.new_issues",
  "errors.regressing_issues",
  "errors.affected_identities",
  "errors.handled",
  "errors.unhandled",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];
export const MetricIdSchema = z.enum(METRIC_IDS);

export const DIMENSION_IDS = [
  "source",
  "platform_family",
  "platform",
  "event_name",
  "standard_event_key",
  "currency",
  "page_host",
  "page_path",
  "referrer_host",
  "campaign_name",
  "country",
  "region",
  "city",
  "browser",
  "os",
  "device",
  "viewport",
  "language",
  "screen",
  "release",
  "issue_status",
  "environment",
  "handled",
] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];
export const DimensionIdSchema = z.enum(DIMENSION_IDS);

export const FILTER_IDS = [
  "source_ids",
  "host",
  "path",
  "traffic",
  "os",
  "release",
  "standard_event_key",
  "issue_status",
  "platform",
  "environment",
  "currency",
] as const;
export type FilterId = (typeof FILTER_IDS)[number];
export const FilterIdSchema = z.enum(FILTER_IDS);

/** Collection capabilities a metric can require. */
export const SOURCE_CAPABILITIES = [
  "web_collection",
  "mobile_collection",
  "server_collection",
  "error_collection",
] as const;
export type SourceCapability = (typeof SOURCE_CAPABILITIES)[number];

/** Product-level source family. Native iOS/Android feed `mobile`. */
export type PlatformFamily = "web" | "mobile" | "server";

export type MetricDefinition = {
  id: MetricId;
  version: number;
  label: string;
  description: string;
  valueKind: "count" | "decimal" | "duration-ms" | "rate" | "money-minor";
  domain: "project" | "events" | "people" | "web" | "mobile" | "errors";
  supportedDimensions: readonly DimensionId[];
  supportedFilters: readonly FilterId[];
  sourceRequirements: readonly SourceCapability[];
  /** A metric that cannot be computed without this filter (e.g. event key). */
  requiresFilter?: FilterId;
  comparison: "supported" | "not-supported";
  drilldown: { path: string; label: string };
};

const def = (definition: MetricDefinition): MetricDefinition => definition;

export const METRIC_REGISTRY: Record<MetricId, MetricDefinition> =
  Object.freeze({
    "project.accepted_events": def({
      id: "project.accepted_events",
      version: 1,
      label: "Accepted events",
      description: "Accepted event occurrences in the range and snapshot.",
      valueKind: "count",
      domain: "project",
      supportedDimensions: ["source", "platform_family", "event_name"],
      supportedFilters: ["source_ids"],
      sourceRequirements: [],
      comparison: "supported",
      drilldown: { path: "/events", label: "Open Events" },
    }),
    "project.sessions": def({
      id: "project.sessions",
      version: 1,
      label: "Sessions",
      description: "Distinct valid project session IDs started in the range.",
      valueKind: "count",
      domain: "project",
      supportedDimensions: ["source", "platform_family"],
      supportedFilters: ["source_ids"],
      sourceRequirements: [],
      comparison: "supported",
      drilldown: { path: "/events", label: "Open Events" },
    }),
    "project.active_people": def({
      id: "project.active_people",
      version: 1,
      label: "Active identified people",
      description: "Identified people with accepted activity in the range.",
      valueKind: "count",
      domain: "people",
      supportedDimensions: ["source", "platform_family"],
      supportedFilters: ["source_ids"],
      sourceRequirements: [],
      comparison: "supported",
      drilldown: { path: "/people", label: "Open People" },
    }),
    "project.new_people": def({
      id: "project.new_people",
      version: 1,
      label: "New identified people",
      description:
        "People whose first external identity link falls in the range. No inferred acquisition dimensions.",
      valueKind: "count",
      domain: "people",
      supportedDimensions: [],
      supportedFilters: [],
      sourceRequirements: [],
      comparison: "supported",
      drilldown: { path: "/people", label: "Open People" },
    }),
    "project.active_anonymous": def({
      id: "project.active_anonymous",
      version: 1,
      label: "Active anonymous subjects",
      description:
        "Anonymous-only analytics subjects active in the range. Never presented as unique humans.",
      valueKind: "count",
      domain: "people",
      supportedDimensions: ["source", "platform_family"],
      supportedFilters: ["source_ids"],
      sourceRequirements: [],
      comparison: "supported",
      drilldown: { path: "/people", label: "Open People" },
    }),
    "standard_event.occurrences": def({
      id: "standard_event.occurrences",
      version: 1,
      label: "Standard Event occurrences",
      description:
        "Accepted occurrences of one exact Standard Event key. Count across currencies; never convert.",
      valueKind: "count",
      domain: "events",
      supportedDimensions: ["source", "platform_family", "currency"],
      supportedFilters: ["source_ids", "standard_event_key", "currency"],
      sourceRequirements: [],
      requiresFilter: "standard_event_key",
      comparison: "supported",
      drilldown: { path: "/events", label: "Open Events" },
    }),
    "standard_event.people": def({
      id: "standard_event.people",
      version: 1,
      label: "Standard Event people",
      description:
        "Distinct identified people for one exact Standard Event key.",
      valueKind: "count",
      domain: "people",
      supportedDimensions: ["source", "platform_family"],
      supportedFilters: ["source_ids", "standard_event_key"],
      sourceRequirements: [],
      requiresFilter: "standard_event_key",
      comparison: "supported",
      drilldown: { path: "/people", label: "Open People" },
    }),
    "standard_event.value_by_currency": def({
      id: "standard_event.value_by_currency",
      version: 1,
      label: "Standard Event value",
      description:
        "Sum of valueMinor within one exact currency. Returned as separate rows per currency; never converted.",
      valueKind: "money-minor",
      domain: "events",
      supportedDimensions: ["currency", "source", "platform_family"],
      supportedFilters: ["source_ids", "standard_event_key", "currency"],
      sourceRequirements: [],
      requiresFilter: "standard_event_key",
      comparison: "supported",
      drilldown: { path: "/events", label: "Open Events" },
    }),
    "web.page_views": def({
      id: "web.page_views",
      version: 1,
      label: "Page views",
      description: "Accepted Web page views in the range (Task 17).",
      valueKind: "count",
      domain: "web",
      supportedDimensions: [
        "source",
        "page_host",
        "page_path",
        "referrer_host",
        "campaign_name",
        "country",
        "region",
        "city",
        "browser",
        "os",
        "device",
        "viewport",
        "language",
      ],
      supportedFilters: ["source_ids", "host", "path", "traffic"],
      sourceRequirements: ["web_collection"],
      comparison: "supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "web.visitors": def({
      id: "web.visitors",
      version: 1,
      label: "Web visitors",
      description: "Observed Web visitors in the range (Task 17).",
      valueKind: "count",
      domain: "web",
      supportedDimensions: ["source", "country", "browser", "os", "device"],
      supportedFilters: ["source_ids", "host", "path", "traffic"],
      sourceRequirements: ["web_collection"],
      comparison: "supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "web.sessions": def({
      id: "web.sessions",
      version: 1,
      label: "Web sessions",
      description: "Web sessions in the range (Task 17).",
      valueKind: "count",
      domain: "web",
      supportedDimensions: ["source", "referrer_host", "campaign_name"],
      supportedFilters: ["source_ids", "host", "path", "traffic"],
      sourceRequirements: ["web_collection"],
      comparison: "supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "web.views_per_session": def({
      id: "web.views_per_session",
      version: 1,
      label: "Views per session",
      description: "Mean page views per Web session (Task 17).",
      valueKind: "decimal",
      domain: "web",
      supportedDimensions: ["source"],
      supportedFilters: ["source_ids", "host", "path", "traffic"],
      sourceRequirements: ["web_collection"],
      comparison: "supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "web.bounce_rate": def({
      id: "web.bounce_rate",
      version: 1,
      label: "Bounce rate",
      description:
        "Eligible entry-session bounce rate (Task 17). Null when the denominator is insufficient — never zero-filled.",
      valueKind: "rate",
      domain: "web",
      supportedDimensions: ["page_path", "source"],
      supportedFilters: ["source_ids", "host", "path", "traffic"],
      sourceRequirements: ["web_collection"],
      comparison: "supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "web.excluded_bots": def({
      id: "web.excluded_bots",
      version: 1,
      label: "Excluded bots",
      description: "Bot page views excluded by the traffic policy.",
      valueKind: "count",
      domain: "web",
      supportedDimensions: ["source"],
      supportedFilters: ["source_ids", "host", "path"],
      sourceRequirements: ["web_collection"],
      comparison: "not-supported",
      drilldown: { path: "/analytics", label: "Open Web Analytics" },
    }),
    "mobile.app_opens": def({
      id: "mobile.app_opens",
      version: 1,
      label: "App opens",
      description: "Accepted Mobile app opens in the range (Task 18).",
      valueKind: "count",
      domain: "mobile",
      supportedDimensions: ["source", "os", "release", "country"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "mobile.visitors": def({
      id: "mobile.visitors",
      version: 1,
      label: "Mobile visitors",
      description: "Observed Mobile visitors in the range (Task 18).",
      valueKind: "count",
      domain: "mobile",
      supportedDimensions: ["source", "os", "device", "country"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "mobile.sessions": def({
      id: "mobile.sessions",
      version: 1,
      label: "App sessions",
      description: "Mobile app sessions in the range (Task 18).",
      valueKind: "count",
      domain: "mobile",
      supportedDimensions: ["source", "os", "release"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "mobile.screens_per_session": def({
      id: "mobile.screens_per_session",
      version: 1,
      label: "Screens per session",
      description: "Mean screens per Mobile session (Task 18).",
      valueKind: "decimal",
      domain: "mobile",
      supportedDimensions: ["source", "os"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "mobile.foreground_duration": def({
      id: "mobile.foreground_duration",
      version: 1,
      label: "Foreground duration",
      description:
        "Mean foreground-active duration per Mobile session. Null when insufficient completed sessions.",
      valueKind: "duration-ms",
      domain: "mobile",
      supportedDimensions: ["source", "os"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "mobile.observed_installations": def({
      id: "mobile.observed_installations",
      version: 1,
      label: "Observed installations",
      description:
        "Instrumentation count only — not App Store / Play Store attribution.",
      valueKind: "count",
      domain: "mobile",
      supportedDimensions: ["source", "os"],
      supportedFilters: ["source_ids", "os", "release"],
      sourceRequirements: ["mobile_collection"],
      comparison: "supported",
      drilldown: { path: "/mobile", label: "Open Mobile Analytics" },
    }),
    "errors.occurrences": def({
      id: "errors.occurrences",
      version: 1,
      label: "Error occurrences",
      description: "Error occurrences in the range (Task 15).",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: [
        "source",
        "platform",
        "release",
        "environment",
        "handled",
      ],
      supportedFilters: ["source_ids", "platform", "environment"],
      sourceRequirements: ["error_collection"],
      comparison: "supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.unresolved_issues": def({
      id: "errors.unresolved_issues",
      version: 1,
      label: "Unresolved issues",
      description: "Grouped issues currently unresolved.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["platform"],
      sourceRequirements: ["error_collection"],
      comparison: "not-supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.new_issues": def({
      id: "errors.new_issues",
      version: 1,
      label: "New issues",
      description: "Issues first observed in the range.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["platform"],
      sourceRequirements: ["error_collection"],
      comparison: "not-supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.regressing_issues": def({
      id: "errors.regressing_issues",
      version: 1,
      label: "Regressing issues",
      description: "Issues trending up versus the previous window.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["platform"],
      sourceRequirements: ["error_collection"],
      comparison: "not-supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.affected_identities": def({
      id: "errors.affected_identities",
      version: 1,
      label: "Affected identities",
      description:
        "Affected identity count under the exact Task 15 error identity definition.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["source_ids", "platform"],
      sourceRequirements: ["error_collection"],
      comparison: "supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.handled": def({
      id: "errors.handled",
      version: 1,
      label: "Handled occurrences",
      description: "Occurrences captured as handled in the range.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["source_ids", "platform"],
      sourceRequirements: ["error_collection"],
      comparison: "supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
    "errors.unhandled": def({
      id: "errors.unhandled",
      version: 1,
      label: "Unhandled occurrences",
      description: "Occurrences captured as unhandled in the range.",
      valueKind: "count",
      domain: "errors",
      supportedDimensions: ["platform", "release"],
      supportedFilters: ["source_ids", "platform"],
      sourceRequirements: ["error_collection"],
      comparison: "supported",
      drilldown: { path: "/errors", label: "Open Errors" },
    }),
  });

// ---------------------------------------------------------------------------
// Source platform family (future-native proof lives here)
// ---------------------------------------------------------------------------

/**
 * Stored source platforms. `ios`/`android` cover future Swift/Kotlin SDKs;
 * they feed the same Mobile metric definitions as `react-native` without
 * changing this contract.
 */
export const SOURCE_PLATFORMS = [
  "web",
  "ios",
  "android",
  "react-native",
  "server",
] as const;
export type AssistantSourcePlatform = (typeof SOURCE_PLATFORMS)[number];
export const AssistantSourcePlatformSchema = z.enum(SOURCE_PLATFORMS);

/** React Native is the SDK/source platform; `os` is the runtime dimension. */
export function platformFamilyOf(
  platform: AssistantSourcePlatform,
): PlatformFamily {
  if (platform === "web") return "web";
  if (platform === "server") return "server";
  return "mobile";
}

// ---------------------------------------------------------------------------
// Canonical query context + snapshot token
// ---------------------------------------------------------------------------

/**
 * Server-owned query context. projectId/organizationId are injected by the
 * API — never model supplied, never browser supplied.
 */
export type ProjectQueryContext = {
  projectId: string;
  organizationId: string;
  from: number;
  to: number;
  compareFrom: number;
  compareTo: number;
  asOf: number;
  timezone: "UTC";
  sourceIds: readonly string[];
  definitionVersion: number;
};

/** The browser/model-safe projection: ranges, snapshot, filters, version. */
export const PublicQueryContextSchema = z.strictObject({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  compareFrom: z.number().int().nonnegative(),
  compareTo: z.number().int().nonnegative(),
  asOf: z.number().int().nonnegative(),
  timezone: z.literal("UTC"),
  sourceIds: z.array(z.string().min(1).max(128)).max(64).readonly(),
  definitionVersion: z.literal(DEFINITION_VERSION),
});
export type PublicQueryContext = z.infer<typeof PublicQueryContextSchema>;

const QueryContextTokenPayloadSchema = z.strictObject({
  projectId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  compareFrom: z.number().int().nonnegative(),
  compareTo: z.number().int().nonnegative(),
  asOf: z.number().int().nonnegative(),
  sourceIds: z.array(z.string().min(1).max(128)).max(64),
  definitionVersion: z.literal(DEFINITION_VERSION),
});
type QueryContextTokenPayload = z.infer<typeof QueryContextTokenPayloadSchema>;

const base64UrlEncode = (json: string): string => {
  if (typeof Buffer !== "undefined") {
    return (
      Buffer as unknown as {
        from(s: string): { toString(e: string): string };
      }
    )
      .from(json)
      .toString("base64url");
  }
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64UrlDecode = (token: string): string | null => {
  try {
    if (typeof Buffer !== "undefined") {
      return (
        Buffer as unknown as {
          from(s: string, e: string): { toString(e: string): string };
        }
      )
        .from(token, "base64url")
        .toString("utf8");
    }
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return atob(b64);
  } catch {
    return null;
  }
};

/** Opaque snapshot token binding ranges + snapshot + scope. */
export function encodeQueryContextToken(context: ProjectQueryContext): string {
  const payload: QueryContextTokenPayload = {
    projectId: context.projectId,
    organizationId: context.organizationId,
    from: context.from,
    to: context.to,
    compareFrom: context.compareFrom,
    compareTo: context.compareTo,
    asOf: context.asOf,
    sourceIds: [...context.sourceIds],
    definitionVersion: DEFINITION_VERSION,
  };
  return base64UrlEncode(JSON.stringify(payload));
}

/** Strict decode. Returns null for malformed, tampered, or inverted ranges. */
export function decodeQueryContextToken(
  token: string,
): ProjectQueryContext | null {
  if (!token || token.length > 4096) return null;
  const json = base64UrlDecode(token);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = QueryContextTokenPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  const payload = result.data;
  if (payload.from >= payload.to) return null;
  if (payload.compareFrom >= payload.compareTo) return null;
  if (payload.to - payload.from !== payload.compareTo - payload.compareFrom) {
    return null;
  }
  return {
    projectId: payload.projectId,
    organizationId: payload.organizationId,
    from: payload.from,
    to: payload.to,
    compareFrom: payload.compareFrom,
    compareTo: payload.compareTo,
    asOf: payload.asOf,
    timezone: "UTC",
    sourceIds: payload.sourceIds,
    definitionVersion: payload.definitionVersion,
  };
}

/**
 * Scope check for chat follow-ups and drill-down links: the token's bound
 * project/organization must equal the request scope. The browser and model
 * cannot change scope by editing the token — any edit fails the decode.
 */
export function validateTokenScope(
  token: string,
  projectId: string,
  organizationId: string,
): ProjectQueryContext | null {
  const context = decodeQueryContextToken(token);
  if (!context) return null;
  if (
    context.projectId !== projectId ||
    context.organizationId !== organizationId
  ) {
    return null;
  }
  return context;
}

/** Half-open range membership: `from <= ts < to`. */
export function isInQueryRange(
  timestamp: number,
  from: number,
  to: number,
): boolean {
  return timestamp >= from && timestamp < to;
}

// ---------------------------------------------------------------------------
// Facts, comparisons, coverage, data quality
// ---------------------------------------------------------------------------

/**
 * Canonical comparison. Prior-zero yields `new`, missing prior yields
 * `no-prior-data` — never infinity, never zero-filled.
 */
export const ComparisonValueSchema = z.strictObject({
  kind: z.enum(["percent", "new", "no-prior-data"]),
  direction: z.enum(["up", "down", "flat"]).optional(),
  percent: z.number().optional(),
});
export type ComparisonValue = z.infer<typeof ComparisonValueSchema>;

/**
 * Shared current-vs-previous semantics for dashboard and assistant.
 * `previous === null` means no prior data exists for the window.
 */
export function compareValues(
  current: number,
  previous: number | null,
): ComparisonValue {
  if (previous === null) return { kind: "no-prior-data" };
  if (previous === 0) {
    if (current === 0)
      return { kind: "percent", direction: "flat", percent: 0 };
    return { kind: "new" };
  }
  if (current === previous) {
    return { kind: "percent", direction: "flat", percent: 0 };
  }
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return {
    kind: "percent",
    direction: percent > 0 ? "up" : "down",
    percent,
  };
}

export const MetricFactSchema = z.strictObject({
  id: z.string().min(1).max(128),
  metricId: MetricIdSchema,
  definitionVersion: z.literal(DEFINITION_VERSION),
  label: z.string().min(1).max(160),
  value: z.number().nullable(),
  formattedValue: z.string().min(1).max(64),
  unit: z.string().max(32).nullable(),
  comparison: ComparisonValueSchema.nullable(),
  queryContext: PublicQueryContextSchema,
  coverage: z.string().max(200),
  drilldown: z.string().min(1).max(256),
});
export type MetricFact = z.infer<typeof MetricFactSchema>;

export const CoverageSummarySchema = z.strictObject({
  sourcesConfigured: z.number().int().nonnegative(),
  sourcesActive: z.number().int().nonnegative(),
  enrichments: z
    .array(
      z.strictObject({
        dimension: z.string().min(1).max(64),
        coveragePercent: z.number().min(0).max(100),
      }),
    )
    .max(16),
  warnings: z.array(z.string().min(1).max(280)).max(8),
});
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

export const DataQualitySummarySchema = z.strictObject({
  hasAcceptedData: z.boolean(),
  definitionState: z.enum(["confirmed", "standard-event", "missing"]),
  definitionLabel: z.string().max(120).nullable(),
  warnings: z.array(z.string().min(1).max(280)).max(8),
});
export type DataQualitySummary = z.infer<typeof DataQualitySummarySchema>;

// ---------------------------------------------------------------------------
// Capabilities, insights, overview resource
// ---------------------------------------------------------------------------

export const ProjectCapabilitiesSchema = z.strictObject({
  web: z.boolean(),
  mobile: z.boolean(),
  server: z.boolean(),
  errorCollection: z.strictObject({
    configured: z.boolean(),
    observed: z.boolean(),
  }),
  standardEventsObserved: z.array(z.string().min(1).max(64)).max(25),
  sources: z.strictObject({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    lastReceivedAt: z.number().int().nonnegative().nullable(),
  }),
  /** The assistant preserves the selected traffic policy; never compares across it. */
  trafficPolicy: z.enum(["human", "all"]),
});
export type ProjectCapabilities = z.infer<typeof ProjectCapabilitiesSchema>;

/**
 * Derive collection capabilities from stored source platforms. Future
 * Swift/Kotlin (`ios`/`android`) sources feed `mobile` with no contract
 * change — proven by the future-native fixtures.
 */
export function capabilitiesFromPlatforms(
  platforms: readonly AssistantSourcePlatform[],
): Pick<ProjectCapabilities, "web" | "mobile" | "server"> {
  let web = false;
  let mobile = false;
  let server = false;
  for (const platform of platforms) {
    const family = platformFamilyOf(platform);
    if (family === "web") web = true;
    else if (family === "mobile") mobile = true;
    else server = true;
  }
  return { web, mobile, server };
}

export const InsightKindSchema = z.enum([
  "change",
  "error",
  "coverage",
  "definition",
  "release",
]);
export type InsightKind = z.infer<typeof InsightKindSchema>;
export const InsightSeveritySchema = z.enum(["info", "attention", "critical"]);
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>;

/** Deterministic eligibility thresholds (Task 21 §Deterministic insight detection). */
export const INSIGHT_THRESHOLDS = {
  /** Minimum combined observations for a count change. */
  countMinCombined: 20,
  /** Minimum absolute count change. */
  countMinAbsolute: 5,
  /** Minimum absolute count change ratio. */
  countMinRatio: 0.2,
  /** Minimum denominator records in BOTH periods for a rate change. */
  rateMinDenominator: 30,
  /** Minimum absolute rate change in percentage points (0..1 fraction). */
  rateMinDelta: 0.05,
  /** Minimum current occurrences for a new/regressing issue signal. */
  issueMinOccurrences: 3,
  /** Maximum headline insights per overview. */
  maxInsights: 3,
} as const;

/** Count-change eligibility: combined volume, absolute, and ratio guards. */
export function isCountChangeEligible(
  current: number,
  previous: number,
): boolean {
  if (current < 0 || previous < 0) return false;
  const combined = current + previous;
  if (combined < INSIGHT_THRESHOLDS.countMinCombined) return false;
  const absolute = Math.abs(current - previous);
  if (absolute < INSIGHT_THRESHOLDS.countMinAbsolute) return false;
  if (previous === 0) return true;
  return absolute / previous >= INSIGHT_THRESHOLDS.countMinRatio;
}

/** Rate-change eligibility: adequate denominators plus a 5-point move. */
export function isRateChangeEligible(
  current: number,
  previous: number,
  denominatorCurrent: number,
  denominatorPrevious: number,
): boolean {
  if (
    denominatorCurrent < INSIGHT_THRESHOLDS.rateMinDenominator ||
    denominatorPrevious < INSIGHT_THRESHOLDS.rateMinDenominator
  ) {
    return false;
  }
  return Math.abs(current - previous) >= INSIGHT_THRESHOLDS.rateMinDelta;
}

/** New/regressing issue eligibility. */
export function isIssueSignalEligible(occurrences: number): boolean {
  return occurrences >= INSIGHT_THRESHOLDS.issueMinOccurrences;
}

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  attention: 1,
  info: 2,
};

/**
 * Deterministic ranking: severity, then recency (observedAt desc), then
 * stable ID. Same inputs always produce the same order.
 */
export function compareInsightRank(
  a: { severity: InsightSeverity; observedAt: number; id: string },
  b: { severity: InsightSeverity; observedAt: number; id: string },
): number {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  }
  if (a.observedAt !== b.observedAt) return b.observedAt - a.observedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Artifact kinds are declared here so InsightCandidate can reference them.
export const ASSISTANT_ARTIFACT_KINDS = [
  "metric",
  "comparison",
  "timeseries",
  "breakdown",
  "ranked-list",
  "table",
  "issue-list",
  "coverage",
  "definition",
  "empty",
  "unavailable",
] as const;
export type AssistantArtifactKind = (typeof ASSISTANT_ARTIFACT_KINDS)[number];

export const InsightCandidateSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: InsightKindSchema,
  severity: InsightSeveritySchema,
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(500),
  factIds: z.array(z.string().min(1).max(128)).max(8),
  artifactKind: z.enum(ASSISTANT_ARTIFACT_KINDS),
  drilldown: z.string().min(1).max(256),
  askPrompt: z.string().min(1).max(280),
  /** Observation time driving recency ranking. */
  observedAt: z.number().int().nonnegative(),
});
export type InsightCandidate = z.infer<typeof InsightCandidateSchema>;

export const ProjectOverviewResourceSchema = z.strictObject({
  queryContext: PublicQueryContextSchema,
  capabilities: ProjectCapabilitiesSchema,
  insights: z.array(InsightCandidateSchema).max(INSIGHT_THRESHOLDS.maxInsights),
  /** Exactly three adaptive pulse metrics in v1. */
  pulse: z.array(MetricFactSchema).length(3),
  activityKind: z.enum(["timeseries", "empty"]),
  /** v1 secondary panel: a ranking, release, or issue-list artifact kind. */
  secondaryKind: z.enum(["ranked-list", "release", "issue-list"]),
  dataQuality: DataQualitySummarySchema,
});
export type ProjectOverviewResource = z.infer<
  typeof ProjectOverviewResourceSchema
>;

// ---------------------------------------------------------------------------
// Typed answer artifacts
// ---------------------------------------------------------------------------

const ArtifactBaseSchema = z.strictObject({
  title: z.string().min(1).max(140),
  /** Accessible text summary: what the widget shows, in words. */
  summary: z.string().min(1).max(500),
  factIds: z.array(z.string().min(1).max(128)).max(16),
  queryContext: PublicQueryContextSchema,
  drilldown: z.string().min(1).max(256),
});

/** Bound every list/series before it can enter model context or the UI. */
export const ARTIFACT_LIMITS = {
  maxSeries: 3,
  maxSeriesPoints: 93,
  maxRankRows: 10,
  maxTableRows: 10,
  maxTableColumns: 5,
  maxBreakdownRows: 9,
} as const;

const TimeseriesPointSchema = z.strictObject({
  t: z.number().int().nonnegative(),
  value: z.number(),
});

export const AssistantArtifactSchema = z.discriminatedUnion("kind", [
  ArtifactBaseSchema.extend({
    kind: z.literal("metric"),
    fact: MetricFactSchema,
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("comparison"),
    current: MetricFactSchema,
    previous: MetricFactSchema,
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("timeseries"),
    bucket: z.enum(["hourly", "daily", "weekly"]),
    series: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(80),
          points: z
            .array(TimeseriesPointSchema)
            .max(ARTIFACT_LIMITS.maxSeriesPoints),
        }),
      )
      .min(1)
      .max(ARTIFACT_LIMITS.maxSeries),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("breakdown"),
    metricId: MetricIdSchema,
    total: z.number(),
    rows: z
      .array(
        z.strictObject({
          key: z.string().max(160),
          label: z.string().min(1).max(160),
          value: z.number(),
          sharePercent: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(ARTIFACT_LIMITS.maxBreakdownRows),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("ranked-list"),
    entity: z.enum([
      "page",
      "screen",
      "event",
      "source",
      "release",
      "location",
    ]),
    rows: z
      .array(
        z.strictObject({
          key: z.string().max(200),
          label: z.string().min(1).max(200),
          value: z.number(),
          sharePercent: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(ARTIFACT_LIMITS.maxRankRows),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("table"),
    columns: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(ARTIFACT_LIMITS.maxTableColumns),
    rows: z
      .array(
        z
          .array(z.union([z.string(), z.number()]).nullable())
          .max(ARTIFACT_LIMITS.maxTableColumns),
      )
      .max(ARTIFACT_LIMITS.maxTableRows),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("issue-list"),
    issues: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(128),
          title: z.string().min(1).max(200),
          status: z.enum(["unresolved", "resolved", "ignored"]),
          count: z.number().int().nonnegative(),
          users: z.number().int().nonnegative(),
          delta: z.enum(["new", "regressing", "declining"]).nullable(),
          drilldown: z.string().min(1).max(256),
        }),
      )
      .max(ARTIFACT_LIMITS.maxRankRows),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("coverage"),
    coverage: CoverageSummarySchema,
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("definition"),
    proposalId: z.string().min(1).max(128),
    memoryKey: z.enum([
      "signup-definition",
      "activation-definition",
      "key-outcome-definition",
    ]),
    description: z.string().min(1).max(500),
    status: z.enum(["proposed", "confirmed"]),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("empty"),
    reason: z.string().min(1).max(280),
  }),
  ArtifactBaseSchema.extend({
    kind: z.literal("unavailable"),
    reason: z.string().min(1).max(280),
    nextAction: z.string().min(1).max(280),
  }),
]);
export type AssistantArtifact = z.infer<typeof AssistantArtifactSchema>;

// ---------------------------------------------------------------------------
// Agent tools: internal capability + friendly presentation
// ---------------------------------------------------------------------------

export const TOOL_IDS = [
  "resolve_definition",
  "measure_metric",
  "compare_periods",
  "analyze_trend",
  "break_down_metric",
  "rank_entities",
  "review_error_health",
  "inspect_issue",
  "check_coverage",
  "read_project_knowledge",
  "propose_definition",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export const ToolIdSchema = z.enum(TOOL_IDS);

export type ToolPresentation = {
  label: string;
  activeLabel: string;
  completedLabel: string;
};

export type ToolDefinition = {
  id: ToolId;
  description: string;
  presentation: ToolPresentation;
};

/**
 * `{metric}` interpolates the server-resolved metric label — never raw
 * telemetry or model text.
 */
export const TOOL_REGISTRY: Record<ToolId, ToolDefinition> = Object.freeze({
  resolve_definition: {
    id: "resolve_definition",
    description: "Find a Standard Event or confirmed project definition.",
    presentation: {
      label: "Definition lookup",
      activeLabel: "Resolving the {metric} definition",
      completedLabel: "Resolved the {metric} definition",
    },
  },
  measure_metric: {
    id: "measure_metric",
    description: "Return one exact metric fact.",
    presentation: {
      label: "Metric measurement",
      activeLabel: "Measuring {metric}",
      completedLabel: "Measured {metric}",
    },
  },
  compare_periods: {
    id: "compare_periods",
    description: "Return current, previous, and comparison semantics.",
    presentation: {
      label: "Period comparison",
      activeLabel: "Comparing time periods",
      completedLabel: "Compared time periods",
    },
  },
  analyze_trend: {
    id: "analyze_trend",
    description: "Return a bounded time series and change points.",
    presentation: {
      label: "Trend analysis",
      activeLabel: "Analyzing the {metric} trend",
      completedLabel: "Analyzed the {metric} trend",
    },
  },
  break_down_metric: {
    id: "break_down_metric",
    description: "Group one metric by an approved dimension.",
    presentation: {
      label: "Metric breakdown",
      activeLabel: "Comparing {metric} by dimension",
      completedLabel: "Compared {metric} by dimension",
    },
  },
  rank_entities: {
    id: "rank_entities",
    description: "Return a bounded ranking.",
    presentation: {
      label: "Ranking",
      activeLabel: "Finding the top {metric}",
      completedLabel: "Found the top {metric}",
    },
  },
  review_error_health: {
    id: "review_error_health",
    description: "Return canonical error aggregates or issues.",
    presentation: {
      label: "Error review",
      activeLabel: "Reviewing related errors",
      completedLabel: "Reviewed related errors",
    },
  },
  inspect_issue: {
    id: "inspect_issue",
    description: "Return one authorized sanitized issue summary.",
    presentation: {
      label: "Issue inspection",
      activeLabel: "Inspecting an error issue",
      completedLabel: "Inspected an error issue",
    },
  },
  check_coverage: {
    id: "check_coverage",
    description: "Explain sources, enrichment, and missing data.",
    presentation: {
      label: "Coverage check",
      activeLabel: "Checking data coverage",
      completedLabel: "Checked data coverage",
    },
  },
  read_project_knowledge: {
    id: "read_project_knowledge",
    description: "Read confirmed typed memory.",
    presentation: {
      label: "Knowledge lookup",
      activeLabel: "Checking the project's definitions",
      completedLabel: "Checked the project's definitions",
    },
  },
  propose_definition: {
    id: "propose_definition",
    description:
      "Create a definition proposal. Requires UI confirmation; cannot confirm or activate.",
    presentation: {
      label: "Definition proposal",
      activeLabel: "Preparing a metric definition",
      completedLabel: "Prepared a metric definition",
    },
  },
});

/** Friendly activity-step states shown in the "How I answered" trace. */
export const ACTIVITY_STEP_STATES = [
  "pending",
  "running",
  "complete",
  "failed",
] as const;
export type ActivityStepState = (typeof ACTIVITY_STEP_STATES)[number];

export function formatToolLabel(template: string, metricLabel: string): string {
  return template.replace(/\{metric\}/g, metricLabel);
}

// ---------------------------------------------------------------------------
// Structured answer contract
// ---------------------------------------------------------------------------

export const ANSWER_LIMITS = {
  maxObservations: 3,
  maxFollowUps: 3,
  maxAssumptions: 5,
  maxSummaryChars: 2000,
  maxQuestionChars: 2000,
  maxSteps: 8,
} as const;

export const AssistantAnswerSchema = z.strictObject({
  summary: z.string().min(1).max(ANSWER_LIMITS.maxSummaryChars),
  observations: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(500),
        /** Every material claim cites facts from this run. */
        factIds: z.array(z.string().min(1).max(128)).min(1).max(8),
      }),
    )
    .max(ANSWER_LIMITS.maxObservations),
  primaryArtifactId: z.string().min(1).max(128).nullable(),
  supportingArtifactIds: z.array(z.string().min(1).max(128)).max(4),
  assumptions: z
    .array(z.string().min(1).max(280))
    .max(ANSWER_LIMITS.maxAssumptions),
  followUps: z
    .array(z.string().min(1).max(200))
    .max(ANSWER_LIMITS.maxFollowUps),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;

// ---------------------------------------------------------------------------
// Conversation, run, and memory persistence contracts
// ---------------------------------------------------------------------------

export const ConversationSchema = z.strictObject({
  id: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  epoch: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastMessageAt: z.number().int().nonnegative().nullable(),
});
export type AssistantConversation = z.infer<typeof ConversationSchema>;

export const AssistantMessageSchema = z.strictObject({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  epoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant"]),
  status: z.enum(["pending", "streaming", "complete", "cancelled", "failed"]),
  /** Validated UI message parts only — never raw provider payloads. */
  parts: z
    .array(
      z.strictObject({ type: z.literal("text"), text: z.string().max(8000) }),
    )
    .max(16),
  failureCode: z.string().max(64).nullable(),
  clientRequestId: z.string().min(1).max(128).nullable(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

export const AssistantRunSchema = z.strictObject({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  queryContextHash: z.string().min(1).max(128),
  definitionVersion: z.literal(DEFINITION_VERSION),
  model: z.string().min(1).max(128),
  provider: z.string().min(1).max(64),
  status: z.enum(["running", "complete", "cancelled", "failed"]),
  stepCount: z.number().int().min(0).max(ANSWER_LIMITS.maxSteps),
  toolIds: z.array(ToolIdSchema).max(ANSWER_LIMITS.maxSteps),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  failureCode: z.string().max(64).nullable(),
});
export type AssistantRun = z.infer<typeof AssistantRunSchema>;

export const MEMORY_SCOPES = ["project", "workspace", "member"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_KEYS = [
  "signup-definition",
  "activation-definition",
  "key-outcome-definition",
  "business-term",
  "preferred-comparison-range",
] as const;
export type MemoryKey = (typeof MEMORY_KEYS)[number];

export const MEMORY_STATUSES = [
  "proposed",
  "confirmed",
  "superseded",
  "rejected",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MemoryRecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128).nullable(),
  scope: z.enum(MEMORY_SCOPES),
  key: z.enum(MEMORY_KEYS),
  status: z.enum(MEMORY_STATUSES),
  value: z.strictObject({
    version: z.number().int().nonnegative(),
    label: z.string().min(1).max(160),
    description: z.string().max(500),
    payload: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean()]).nullable(),
      )
      .optional(),
  }),
  proposerId: z.string().min(1).max(128).nullable(),
  confirmerId: z.string().min(1).max(128).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

/**
 * Confirmation permission (recommended default): any member may propose,
 * but only owner/admin may confirm shared project/workspace knowledge.
 * Member-scoped preferences never need confirmation.
 */
export type MemoryConfirmerRole = "owner" | "admin" | "member";

export function canProposeMemory(_role: MemoryConfirmerRole): boolean {
  return true;
}

export function canConfirmMemory(
  role: MemoryConfirmerRole,
  scope: MemoryScope,
): boolean {
  if (scope === "member") return true;
  return role === "owner" || role === "admin";
}

/**
 * Proposal state transitions. Confirm/reject apply only to `proposed`
 * records; anything else returns null so concurrent confirmations cannot
 * double-apply (slice 4 adds the transactional guard).
 */
export function transitionProposal(
  current: MemoryStatus,
  action: "confirm" | "reject",
): MemoryStatus | null {
  if (current !== "proposed") return null;
  return action === "confirm" ? "confirmed" : "rejected";
}

// ---------------------------------------------------------------------------
// Stream protocol + provider configuration (names frozen, behavior later)
// ---------------------------------------------------------------------------

/** Validated custom data parts for the UI message stream. */
export const STREAM_PART_NAMES = [
  "data-run-start",
  "data-activity-step",
  "data-fact",
  "data-artifact",
  "data-run-finish",
  "data-run-error",
] as const;
export type StreamPartName = (typeof STREAM_PART_NAMES)[number];

/** Hosted Prism server-only configuration names. */
export const PRISM_AI_ENV_NAMES = [
  "PRISM_AI_ENABLED",
  "PRISM_AI_PROVIDER",
  "PRISM_AI_MODEL",
  "OPENAI_API_KEY",
  "PRISM_AI_MAX_STEPS",
  "PRISM_AI_MAX_INPUT_CHARS",
] as const;
export type PrismAiEnvName = (typeof PRISM_AI_ENV_NAMES)[number];
