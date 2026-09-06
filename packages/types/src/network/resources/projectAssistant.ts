/**
 * Project overview + grounded assistant contracts (Task 21 slice 1, revised
 * per the R1 review and the multi-chat / OpenRouter amendment).
 *
 * This module is the frozen product language for the adaptive Project
 * overview and the Prism assistant. Dashboard adapters, insight detectors,
 * assistant tools, fixtures, formatting, and drill-down links must resolve
 * through these contracts — never through duplicated formulas in React or
 * raw storage/column names.
 *
 * Deliberate boundaries:
 *
 * - Query-context tokens are OPAQUE here. Issuance and verification live in
 *   server-only code (`apps/api/src/utils/queryContextToken.ts`, HMAC) and
 *   must never be bundled for the browser. This module only freezes the
 *   opaque string shape.
 * - Full artifact snapshots persist for replay, but only compact
 *   `modelSummary` facts ever enter model context (see `buildModelSummary`
 *   and `extractModelText`).
 * - Slices 2+ implement the service, storage, runtime, and UI behind these
 *   types. Anything marked `v1` is intentionally bounded; extensions bump
 *   `DEFINITION_VERSION` rather than widening existing fields.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Deep immutability (R1-F7)
// ---------------------------------------------------------------------------

/**
 * The registries below read as canonical constants. `Object.freeze` alone
 * only freezes the top level, so every nested definition, array, and limit
 * object is frozen at module initialization. Consumers must treat lookups
 * as read-only; strict-mode mutation attempts throw.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item);
    } else {
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Definition version + overview ranges
// ---------------------------------------------------------------------------

/** Bump when any metric definition, dimension, or comparison semantic changes. */
export const DEFINITION_VERSION = 1;

/** Supported v1 overview ranges. */
export const OVERVIEW_RANGES = deepFreeze([
  "24h",
  "7d",
  "14d",
  "30d",
  "90d",
] as const);
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];
export const OverviewRangeSchema = z.enum(OVERVIEW_RANGES);

/** Fixed range lengths in ms (UTC calendar math stays in slice 2). */
export const OVERVIEW_RANGE_MS: Record<OverviewRange, number> = deepFreeze({
  "24h": 24 * 3_600_000,
  "7d": 7 * 86_400_000,
  "14d": 14 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
});

// ---------------------------------------------------------------------------
// Drill-down destinations (R1-F8)
// ---------------------------------------------------------------------------

/**
 * Stored source platforms. `ios`/`android` cover future Swift/Kotlin SDKs;
 * they feed the same Mobile metric definitions as `react-native` without
 * changing this contract.
 */
export const SOURCE_PLATFORMS = deepFreeze([
  "web",
  "ios",
  "android",
  "react-native",
  "server",
] as const);
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

/**
 * Canonical Task 19 Standard Event keys. Package boundaries forbid importing
 * `@prism-analytics/core` here (core depends on types), so this enum mirrors
 * `STANDARD_EVENT_DEFINITIONS`; `standard-event-key-drift.test.ts` in core
 * fails closed on any drift. Memory payloads and observed-event lists must
 * reference these exact keys - never free-form strings, `$prism_*`
 * protected names, or case/whitespace variants.
 */
export const STANDARD_EVENT_KEYS = deepFreeze([
  "sign_up",
  "login",
  "logout",
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "lead_generated",
  "invite_sent",
  "invite_accepted",
  "trial_started",
  "trial_ended",
  "subscription_started",
  "subscription_renewed",
  "subscription_changed",
  "subscription_paused",
  "subscription_resumed",
  "subscription_cancelled",
  "subscription_expired",
  "payment_succeeded",
  "payment_failed",
  "purchase",
  "refund",
  "search",
  "share",
  "feedback_submitted",
] as const);
export type StandardEventKeyCode = (typeof STANDARD_EVENT_KEYS)[number];
export const StandardEventKeySchema = z.enum(STANDARD_EVENT_KEYS);

/**
 * Signed source-scope discriminator (R4-F1): `all` = no source filter,
 * `selected` = the explicit ID list (possibly empty). Declared early so
 * drill-down filters, the public context, and the token payload share one
 * enum.
 */
export const SourceScopeSchema = z.enum(["all", "selected"]);
export type SourceScope = z.infer<typeof SourceScopeSchema>;

/**
 * Typed drill-down filter intent (R2-F4). Facts and artifacts carry the
 * resolved values that define them; the route builder encodes the same
 * values so a drill-down opens the filtered view behind the number — never
 * an unfiltered destination showing a different value. Keys are
 * destination-specific (see `DRILLDOWN_FILTER_ALLOWLIST`); arbitrary model
 * query records are never accepted.
 */
export const DrilldownFiltersSchema = z.strictObject({
  standardEventKey: StandardEventKeySchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 code")
    .optional(),
  path: z.string().min(1).max(200).optional(),
  host: z.string().min(1).max(253).optional(),
  traffic: z.enum(["human", "all"]).optional(),
  os: z.enum(["ios", "android"]).optional(),
  /**
   * Release filter bound (R7-F6): aligned with the error-ingestion
   * contract (`maxReleaseLength: 128`). Truncating here would make an
   * overview drill-down query a different release than the displayed
   * count, so the full identifier travels in filter semantics and only
   * display copy is ever shortened.
   */
  release: z.string().min(1).max(128).optional(),
  platform: z.enum(SOURCE_PLATFORMS).optional(),
  environment: z.string().min(1).max(64).optional(),
  sourceId: z.string().min(1).max(128).optional(),
  /**
   * Signed source scope echo (R4-F1): facts and drill-downs carry the same
   * `all` | `selected` discriminator as their query context so an explicit
   * empty intersection never renders as an unfiltered link. Optional for
   * backward-compatible parsing; the service always sets it.
   */
  sourceScope: SourceScopeSchema.optional(),
});
export type DrilldownFilters = z.infer<typeof DrilldownFiltersSchema>;

type DrilldownFilterKey = keyof DrilldownFilters;

const DRILLDOWN_FILTER_ALLOWLIST: Record<
  DrilldownDestinationId,
  readonly DrilldownFilterKey[]
> = deepFreeze({
  overview: ["sourceScope"],
  events: ["standardEventKey", "currency", "sourceId", "sourceScope"],
  people: ["sourceScope"],
  "web-analytics": ["path", "host", "traffic", "sourceScope"],
  "mobile-analytics": ["os", "release", "sourceScope"],
  errors: ["platform", "environment", "release", "sourceId", "sourceScope"],
  "errors-issue": ["sourceScope"],
  sources: ["sourceScope"],
});

/**
 * Typed drill-down destinations. The registry stores a destination ID plus
 * filter intent — never a context-free pathname. Final URLs resolve through
 * `buildDrilldownUrl` with the current workspace/project slugs and the
 * verified snapshot token, so every drill-down opens the same project and
 * snapshot as its facts.
 *
 * Segments mirror the real Web router under
 * `/workspace/:wrkSlug/projects/:slug` (`events`, `web-analytics`,
 * `mobile-analytics`, `people`, `errors`, `sources`).
 */
export const DRILLDOWN_DESTINATIONS = deepFreeze([
  "overview",
  "events",
  "people",
  "web-analytics",
  "mobile-analytics",
  "errors",
  "errors-issue",
  "sources",
] as const);
export type DrilldownDestinationId = (typeof DRILLDOWN_DESTINATIONS)[number];

export const DrilldownDestinationSchema = z
  .strictObject({
    destination: z.enum(DRILLDOWN_DESTINATIONS),
    label: z.string().min(1).max(80),
    /** Required exactly when destination is `errors-issue`. */
    issueId: z.string().min(1).max(128).optional(),
    /** Resolved filter values defining the source fact/artifact. */
    filters: DrilldownFiltersSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.destination === "errors-issue" && !value.issueId) {
      context.addIssue({
        code: "custom",
        message: "issueId is required for an errors-issue drill-down",
      });
    }
    if (value.destination !== "errors-issue" && value.issueId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "issueId is only valid for an errors-issue drill-down",
      });
    }
    if (value.filters) {
      const allowed = DRILLDOWN_FILTER_ALLOWLIST[value.destination];
      for (const key of Object.keys(value.filters) as DrilldownFilterKey[]) {
        if (value.filters[key] !== undefined && !allowed.includes(key)) {
          context.addIssue({
            code: "custom",
            message: `filter ${key} is not valid for ${value.destination}`,
          });
        }
      }
    }
  });
export type DrilldownDestination = z.infer<typeof DrilldownDestinationSchema>;

const DRILLDOWN_SEGMENTS: Record<DrilldownDestinationId, string> = deepFreeze({
  overview: "",
  events: "events",
  people: "people",
  "web-analytics": "web-analytics",
  "mobile-analytics": "mobile-analytics",
  errors: "errors",
  "errors-issue": "errors",
  sources: "sources",
});

const assertSlug = (name: string, slug: string): void => {
  if (!slug || slug.length > 128 || /[/?#]/.test(slug)) {
    throw new TypeError(`Invalid ${name} slug for drill-down URL`);
  }
};

/** Project-aware path for a drill-down destination. */
export function buildProjectPath(
  wrkSlug: string,
  projectSlug: string,
  drilldown: DrilldownDestination,
): string {
  assertSlug("workspace", wrkSlug);
  assertSlug("project", projectSlug);
  const base = `/workspace/${encodeURIComponent(wrkSlug)}/projects/${encodeURIComponent(projectSlug)}`;
  const segment = DRILLDOWN_SEGMENTS[drilldown.destination];
  if (drilldown.destination === "errors-issue") {
    return `${base}/${segment}/${encodeURIComponent(drilldown.issueId ?? "")}`;
  }
  return segment ? `${base}/${segment}` : base;
}

/**
 * Snapshot-aware drill-down URL. The token is opaque here; the server
 * verifies it (HMAC, scope, expiry, source membership) before serving the
 * snapshot. Resolved filter values travel as bounded query params so the
 * destination opens the filtered view behind the number. The link first
 * shows the snapshot that supported the answer; a **Refresh to latest**
 * action is a UI concern in later slices.
 */
export function buildDrilldownUrl(
  wrkSlug: string,
  projectSlug: string,
  drilldown: DrilldownDestination,
  queryContextToken?: string,
): string {
  const path = buildProjectPath(wrkSlug, projectSlug, drilldown);
  const params: string[] = [];
  if (queryContextToken) {
    params.push(`ctx=${encodeURIComponent(queryContextToken)}`);
  }
  const filters = drilldown.filters ?? {};
  const entries: [DrilldownFilterKey, string][] = [
    ["standardEventKey", "event"],
    ["currency", "currency"],
    ["path", "path"],
    ["host", "host"],
    ["traffic", "traffic"],
    ["os", "os"],
    ["release", "release"],
    ["platform", "platform"],
    ["environment", "environment"],
    ["sourceId", "source"],
    ["sourceScope", "scope"],
  ];
  for (const [key, param] of entries) {
    const value = filters[key];
    if (value !== undefined) {
      params.push(`${param}=${encodeURIComponent(value)}`);
    }
  }
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
}

// ---------------------------------------------------------------------------
// Metric registry
// ---------------------------------------------------------------------------

/** Frozen v1 metric IDs — the only metrics overview/tools may reference. */
export const METRIC_IDS = deepFreeze([
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
] as const);
export type MetricId = (typeof METRIC_IDS)[number];
export const MetricIdSchema = z.enum(METRIC_IDS);

export const DIMENSION_IDS = deepFreeze([
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
] as const);
export type DimensionId = (typeof DIMENSION_IDS)[number];
export const DimensionIdSchema = z.enum(DIMENSION_IDS);

export const FILTER_IDS = deepFreeze([
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
] as const);
export type FilterId = (typeof FILTER_IDS)[number];
export const FilterIdSchema = z.enum(FILTER_IDS);

/** Collection capabilities a metric can require. */
export const SOURCE_CAPABILITIES = deepFreeze([
  "web_collection",
  "mobile_collection",
  "server_collection",
  "error_collection",
] as const);
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
  /**
   * Temporal replay semantics (R4-F4): `replayable` facts are pure
   * functions of the cutoff-visible store and return byte-identical values
   * for the same signed snapshot; `current-only` facts read mutable
   * projection state and must never feed deterministic insight selection
   * or historical comparison. Only `errors.unresolved_issues` is
   * current-only in v1.
   */
  snapshot: "replayable" | "current-only";
  drilldown: DrilldownDestination;
};

const def = (definition: MetricDefinition): MetricDefinition =>
  deepFreeze(definition);

export const METRIC_REGISTRY: Record<MetricId, MetricDefinition> = deepFreeze({
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
    snapshot: "replayable",
    drilldown: { destination: "events", label: "Open Events" },
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
    snapshot: "replayable",
    drilldown: { destination: "events", label: "Open Events" },
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
    snapshot: "replayable",
    drilldown: { destination: "people", label: "Open People" },
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
    snapshot: "replayable",
    drilldown: { destination: "people", label: "Open People" },
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
    snapshot: "replayable",
    drilldown: { destination: "people", label: "Open People" },
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
    snapshot: "replayable",
    drilldown: { destination: "events", label: "Open Events" },
  }),
  "standard_event.people": def({
    id: "standard_event.people",
    version: 1,
    label: "Standard Event people",
    description: "Distinct identified people for one exact Standard Event key.",
    valueKind: "count",
    domain: "people",
    supportedDimensions: ["source", "platform_family"],
    supportedFilters: ["source_ids", "standard_event_key"],
    sourceRequirements: [],
    requiresFilter: "standard_event_key",
    comparison: "supported",
    snapshot: "replayable",
    drilldown: { destination: "people", label: "Open People" },
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
    snapshot: "replayable",
    drilldown: { destination: "events", label: "Open Events" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: { destination: "web-analytics", label: "Open Web Analytics" },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    snapshot: "replayable",
    drilldown: {
      destination: "mobile-analytics",
      label: "Open Mobile Analytics",
    },
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
    supportedFilters: ["source_ids", "platform", "environment", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
  "errors.unresolved_issues": def({
    id: "errors.unresolved_issues",
    version: 1,
    label: "Unresolved issues",
    description: "Grouped issues currently unresolved.",
    valueKind: "count",
    domain: "errors",
    supportedDimensions: ["platform", "release"],
    supportedFilters: ["platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "not-supported",
    snapshot: "current-only",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
  "errors.new_issues": def({
    id: "errors.new_issues",
    version: 1,
    label: "New issues",
    description: "Issues first observed in the range.",
    valueKind: "count",
    domain: "errors",
    supportedDimensions: ["platform", "release"],
    supportedFilters: ["platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "not-supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
  "errors.regressing_issues": def({
    id: "errors.regressing_issues",
    version: 1,
    label: "Regressing issues",
    description: "Issues trending up versus the previous window.",
    valueKind: "count",
    domain: "errors",
    supportedDimensions: ["platform", "release"],
    supportedFilters: ["platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "not-supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
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
    supportedFilters: ["source_ids", "platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
  "errors.handled": def({
    id: "errors.handled",
    version: 1,
    label: "Handled occurrences",
    description: "Occurrences captured as handled in the range.",
    valueKind: "count",
    domain: "errors",
    supportedDimensions: ["platform", "release"],
    supportedFilters: ["source_ids", "platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
  "errors.unhandled": def({
    id: "errors.unhandled",
    version: 1,
    label: "Unhandled occurrences",
    description: "Occurrences captured as unhandled in the range.",
    valueKind: "count",
    domain: "errors",
    supportedDimensions: ["platform", "release"],
    supportedFilters: ["source_ids", "platform", "release"],
    sourceRequirements: ["error_collection"],
    comparison: "supported",
    snapshot: "replayable",
    drilldown: { destination: "errors", label: "Open Errors" },
  }),
});

/**
 * Machine-readable temporal boundary (R4-F4): deterministic insight
 * selection (Slice 3) and the future agent must consult this before
 * comparing or replaying a fact. `current-only` facts (only
 * `errors.unresolved_issues` in v1) are valid at fresh snapshots and
 * unavailable for historical ones — never compared across time.
 */
export function isSnapshotReplayable(metricId: MetricId): boolean {
  return METRIC_REGISTRY[metricId].snapshot === "replayable";
}

// ---------------------------------------------------------------------------
// Source platform family (future-native proof lives here)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Canonical query context + opaque snapshot token (R1-F1)
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
  sourceScope: SourceScope;
  sourceIds: readonly string[];
  definitionVersion: number;
};

/** The browser/model-safe projection: ranges, snapshot, filters, version. */
export const PublicQueryContextSchema = z
  .strictObject({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    compareFrom: z.number().int().nonnegative(),
    compareTo: z.number().int().nonnegative(),
    asOf: z.number().int().nonnegative(),
    timezone: z.literal("UTC"),
    /**
     * Signed source-scope discriminator (R4-F1): `all` means no source
     * filter (every project source), `selected` means the explicit ID list
     * — which may itself be empty for an explicit empty intersection.
     * Both scopes share `sourceIds: []` on the wire for the empty cases,
     * so the scope is the only machine-readable distinction. Old tokens
     * without a scope fail as malformed and never verify as `all`.
     */
    sourceScope: SourceScopeSchema,
    sourceIds: z.array(z.string().min(1).max(128)).max(64).readonly(),
    definitionVersion: z.literal(DEFINITION_VERSION),
  })
  .superRefine((value, context) => {
    if (hasDuplicateStrings(value.sourceIds)) {
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
export type PublicQueryContext = z.infer<typeof PublicQueryContextSchema>;

/**
 * Opaque snapshot token (R1-F1). The string shape is the entire shared
 * contract: issuance and verification are server-only (HMAC, key versioning,
 * expiry, scope + source-membership checks) and must never ship to the
 * browser. A forged or edited token fails server verification even when it
 * is well-formed base64.
 */
export const QueryContextTokenSchema = z.string().min(16).max(2048);
export type QueryContextToken = z.infer<typeof QueryContextTokenSchema>;

/** Half-open range membership: `from <= ts < to`. */
export function isInQueryRange(
  timestamp: number,
  from: number,
  to: number,
): boolean {
  return timestamp >= from && timestamp < to;
}

/** Duplicate IDs would let reordered/duplicated sets alias one snapshot. */
export function hasDuplicateStrings(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Canonical context fingerprint (R2-F3, R4-F1): deterministic source-ID
 * order so the same scope always hashes identically regardless of input
 * order. The signed `sourceScope` joins the fingerprint so `all` (`[]`)
 * and `selected` (`[]`, explicit empty intersection) never alias.
 * Duplicate source IDs are a contract violation, not a distinct snapshot.
 */
export function queryContextFingerprint(context: PublicQueryContext): string {
  const sources = [...context.sourceIds].sort().join(",");
  return [
    context.from,
    context.to,
    context.compareFrom,
    context.compareTo,
    context.asOf,
    context.timezone,
    context.definitionVersion,
    context.sourceScope,
    sources,
  ].join("|");
}

/** Snapshot equality for overview/artifact consistency refinements. */
export function areQueryContextsEqual(
  a: PublicQueryContext,
  b: PublicQueryContext,
): boolean {
  return queryContextFingerprint(a) === queryContextFingerprint(b);
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
 *
 * Canonical comparison decisions (R9-F1), frozen for every surface:
 * prior-null yields no-prior-data; prior-zero yields new (current > 0)
 * or flat (both zero); otherwise a SIGNED one-decimal percentage with an
 * up/down/flat direction. The same function covers counts, decimal and
 * duration means, and percentage-point rates — loaders must reuse it
 * rather than shadowing it with local absolute/percentage variants.
 */
export type CanonicalComparison =
  | { kind: "percent"; direction: "up" | "down" | "flat"; percent: number }
  | { kind: "new" }
  | { kind: "no-prior-data" };

export function compareValues(
  current: number,
  previous: number | null,
): CanonicalComparison {
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

/**
 * Strict exact-comparison basis (R8-F3): the canonical service carries the
 * exact prior-window value (and, for rate metrics, both exact denominators)
 * on every comparison-supported fact. Rounded percentages stay display-only
 * inside `comparison`; any claim an insight or widget makes about "before"
 * must come from here. Metrics without comparison support carry explicit
 * nulls — never a reversed estimate.
 */
export const ComparisonBasisSchema = z.strictObject({
  previousValue: z.number().nullable(),
  denominatorCurrent: z.number().nullable(),
  denominatorPrevious: z.number().nullable(),
});
export type ComparisonBasis = z.infer<typeof ComparisonBasisSchema>;

export const MetricFactSchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    metricId: MetricIdSchema,
    definitionVersion: z.literal(DEFINITION_VERSION),
    label: z.string().min(1).max(160),
    value: z.number().nullable(),
    formattedValue: z.string().min(1).max(64),
    unit: z.string().max(32).nullable(),
    comparison: ComparisonValueSchema.nullable(),
    /** Exact prior value + rate denominators backing `comparison` (R8-F3). */
    comparisonBasis: ComparisonBasisSchema,
    queryContext: PublicQueryContextSchema,
    /** Structured coverage is the source of truth (R1-F2). */
    coverage: CoverageSummarySchema,
    /** Short display sentence derived from `coverage`, not the truth. */
    coverageNote: z.string().max(200),
    /** Resolved filter values defining this fact (registry declares support). */
    filters: DrilldownFiltersSchema,
    drilldown: DrilldownDestinationSchema,
  })
  .superRefine(checkFactComparisonAgreement);
export type MetricFact = z.infer<typeof MetricFactSchema>;

/**
 * Definition-aware comparison agreement (R9-F1): the displayed comparison
 * must be exactly what the frozen `compareValues` derives from the fact's
 * own value and structured basis — one function, one representation
 * (prior-null → no-prior-data, prior-zero → new/flat, signed percent,
 * uniform across counts, means, durations, and point-scale rates).
 * Unavailable facts (null value) and comparison-unsupported metrics carry
 * the explicit all-null state instead.
 */
function checkFactComparisonAgreement(
  fact: MetricFact,
  context: z.RefinementCtx,
): void {
  const definition = METRIC_REGISTRY[fact.metricId];
  const basis = fact.comparisonBasis;
  const nullBasis =
    basis.previousValue === null &&
    basis.denominatorCurrent === null &&
    basis.denominatorPrevious === null;
  if (fact.value === null) {
    if (fact.comparison !== null || !nullBasis) {
      context.addIssue({
        code: "custom",
        message: "unavailable facts must carry the explicit null state",
      });
    }
    return;
  }
  if (definition.comparison !== "supported") {
    if (fact.comparison !== null || !nullBasis) {
      context.addIssue({
        code: "custom",
        message: "comparison-unsupported facts must carry the null state",
      });
    }
    return;
  }
  const expected = compareValues(fact.value, basis.previousValue);
  if (JSON.stringify(fact.comparison) !== JSON.stringify(expected)) {
    context.addIssue({
      code: "custom",
      message: "comparison must equal compareValues(value, basis.previousValue)",
    });
    return;
  }
  // Denominator evidence (R10-F4): rate facts must carry both exact
  // denominators — a widget may not render while deterministic analysis
  // silently skips for lack of evidence. Non-rate facts must carry none
  // unless a versioned definition declares denominator semantics.
  const { denominatorCurrent, denominatorPrevious } = basis;
  const isRate = definition.valueKind === "rate";
  const validDenominator = (value: number | null): boolean =>
    value !== null &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0;
  if (denominatorCurrent === null || denominatorPrevious === null) {
    if (denominatorCurrent !== denominatorPrevious) {
      context.addIssue({
        code: "custom",
        message: "rate denominators must be paired finite non-negative integers",
      });
    } else if (isRate) {
      context.addIssue({
        code: "custom",
        message: "rate facts must carry both exact denominators",
      });
    }
    return;
  }
  if (!isRate) {
    context.addIssue({
      code: "custom",
      message: "only rate metrics declare denominator semantics",
    });
    return;
  }
  if (
    !validDenominator(denominatorCurrent) ||
    !validDenominator(denominatorPrevious)
  ) {
    context.addIssue({
      code: "custom",
      message: "rate denominators must be paired finite non-negative integers",
    });
  }
}

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
  standardEventsObserved: z.array(StandardEventKeySchema).max(25),
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
 * Canonical capability fingerprint for the snapshot cache (R5-F3): every
 * capability value that can affect a cached fact or its coverage joins the
 * key — total AND active source counts, collection flags, traffic policy,
 * and the sorted observed Standard Event set. `lastReceivedAt` is excluded:
 * no cached fact or coverage field renders it, so including it would only
 * churn the cache. Facts embed `coverage.sourcesConfigured`, so omitting
 * `total` (or aliasing event sets by length) would serve stale coverage.
 */
export function capabilityFingerprint(
  capabilities: ProjectCapabilities,
): string {
  const events = [...capabilities.standardEventsObserved].sort().join(",");
  return [
    capabilities.web ? 1 : 0,
    capabilities.mobile ? 1 : 0,
    capabilities.server ? 1 : 0,
    capabilities.errorCollection.configured ? 1 : 0,
    capabilities.errorCollection.observed ? 1 : 0,
    capabilities.trafficPolicy,
    capabilities.sources.total,
    capabilities.sources.active,
    events,
  ].join(",");
}

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
export const INSIGHT_THRESHOLDS = deepFreeze({
  /** Minimum combined observations for a count change. */
  countMinCombined: 20,
  /** Minimum absolute count change. */
  countMinAbsolute: 5,
  /** Minimum absolute count change ratio. */
  countMinRatio: 0.2,
  /** Minimum denominator records in BOTH periods for a rate change. */
  rateMinDenominator: 30,
  /**
   * Minimum absolute rate change in percentage points (R8-F1): rates are
   * canonical percentage-point values (`100` renders as `100%`), so the
   * frozen five-point rule is `5`, never `0.05`.
   */
  rateMinDelta: 5,
  /** Minimum current occurrences for a new/regressing issue signal. */
  issueMinOccurrences: 3,
  /** Maximum headline insights per overview. */
  maxInsights: 3,
} as const);

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

/**
 * Non-causal wording contract (R2-F4). Correlation is reported with
 * association language only; "caused" requires a future causal contract.
 * The deterministic reading of "did errors rise after release X" is equal
 * windows around the first observation of that release, reported as
 * co-occurrence — never as the release causing the change.
 */
export const NON_CAUSAL_PHRASES = deepFreeze([
  "associated with",
  "coincided with",
] as const);
export const RELEASE_AFTER_WORDING = "associated with";

const CAUSAL_CLAIM_PHRASES = [
  "caused",
  "causes",
  "causing",
  "led to",
  "triggered",
  "resulted in",
  "drove the",
];

/** Grounded-answer validation: reject causal claims from correlation. */
export function containsCausalClaim(text: string): boolean {
  return new RegExp(`\\b(${CAUSAL_CLAIM_PHRASES.join("|")})\\b`, "i").test(
    text,
  );
}

const SEVERITY_RANK: Record<InsightSeverity, number> = deepFreeze({
  critical: 0,
  attention: 1,
  info: 2,
});

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

// ---------------------------------------------------------------------------
// Typed answer artifacts (R1-F2, R1-F3)
// ---------------------------------------------------------------------------

export const ASSISTANT_ARTIFACT_KINDS = deepFreeze([
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
] as const);
export type AssistantArtifactKind = (typeof ASSISTANT_ARTIFACT_KINDS)[number];

const ArtifactBaseSchema = z.strictObject({
  /** Stable run-scoped ID: answers, traces, and audit records cite this. */
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(140),
  /** Accessible text summary: what the widget shows, in words. */
  summary: z.string().min(1).max(500),
  factIds: z.array(z.string().min(1).max(128)).max(16),
  queryContext: PublicQueryContextSchema,
  drilldown: DrilldownDestinationSchema,
});

/** Bound every list/series before it can enter model context or the UI. */
/**
 * Maximum currency rows for one Standard Event value read (R3-F4). Currency
 * cardinality is tiny in practice; the bound keeps a multi-currency metric
 * from overflowing the 27-fact resource maximum. Overflow is deterministic
 * (currency ASC) with a coverage warning — never silent truncation.
 */
export const MAX_CURRENCY_ROWS = 10;

export const ARTIFACT_LIMITS = deepFreeze({
  maxSeries: 3,
  maxSeriesPoints: 93,
  maxRankRows: 10,
  maxTableRows: 10,
  maxTableColumns: 5,
  maxBreakdownRows: 9,
} as const);

const TimeseriesPointSchema = z.strictObject({
  t: z.number().int().nonnegative(),
  value: z.number(),
});

export const MetricArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("metric"),
  fact: MetricFactSchema,
});
export const ComparisonArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("comparison"),
  current: MetricFactSchema,
  previous: MetricFactSchema,
});
export const TimeseriesArtifactSchema = ArtifactBaseSchema.extend({
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
});
export const BreakdownArtifactSchema = ArtifactBaseSchema.extend({
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
});
export const RankedListArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("ranked-list"),
  entity: z.enum(["page", "screen", "event", "source", "release", "location"]),
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
});
export const TableArtifactSchema = ArtifactBaseSchema.extend({
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
});
export const IssueListArtifactSchema = ArtifactBaseSchema.extend({
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
        drilldown: DrilldownDestinationSchema,
      }),
    )
    .max(ARTIFACT_LIMITS.maxRankRows),
});
export const CoverageArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("coverage"),
  coverage: CoverageSummarySchema,
});
export const DefinitionArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("definition"),
  proposalId: z.string().min(1).max(128),
  memoryKey: z.enum([
    "signup-definition",
    "activation-definition",
    "key-outcome-definition",
  ]),
  description: z.string().min(1).max(500),
  status: z.enum(["proposed", "confirmed"]),
});
export const EmptyArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("empty"),
  reason: z.string().min(1).max(280),
});
export const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  kind: z.literal("unavailable"),
  reason: z.string().min(1).max(280),
  nextAction: z.string().min(1).max(280),
});

export const AssistantArtifactSchema = z
  .discriminatedUnion("kind", [
    MetricArtifactSchema,
    ComparisonArtifactSchema,
    TimeseriesArtifactSchema,
    BreakdownArtifactSchema,
    RankedListArtifactSchema,
    TableArtifactSchema,
    IssueListArtifactSchema,
    CoverageArtifactSchema,
    DefinitionArtifactSchema,
    EmptyArtifactSchema,
    UnavailableArtifactSchema,
  ])
  .superRefine(checkArtifactConsistency);
export type AssistantArtifact = z.infer<typeof AssistantArtifactSchema>;

/**
 * One snapshot per artifact (R2-F3): embedded facts must share the
 * artifact's query context, and every embedded fact ID must appear exactly
 * once in `factIds` alongside unique references. A total from one
 * range/source subset can never sit beside a chart from another.
 */
function checkArtifactConsistency(
  artifact: AssistantArtifact,
  context: z.RefinementCtx,
): void {
  if (new Set(artifact.factIds).size !== artifact.factIds.length) {
    context.addIssue({ code: "custom", message: "factIds must be unique" });
  }
  const embedded: MetricFact[] = [];
  if (artifact.kind === "metric") embedded.push(artifact.fact);
  if (artifact.kind === "comparison") {
    embedded.push(artifact.current, artifact.previous);
  }
  for (const fact of embedded) {
    if (!areQueryContextsEqual(fact.queryContext, artifact.queryContext)) {
      context.addIssue({
        code: "custom",
        message: "embedded facts must share the artifact query context",
      });
    }
    const occurrences = artifact.factIds.filter((id) => id === fact.id).length;
    if (occurrences !== 1) {
      context.addIssue({
        code: "custom",
        message: `fact ${fact.id} must appear exactly once in factIds`,
      });
    }
  }
}

/** Release panels reuse ranked-list with `entity: "release"` (R1-F2). */
export const SecondaryArtifactSchema = z.union([
  RankedListArtifactSchema,
  TableArtifactSchema,
  IssueListArtifactSchema,
]);
export type SecondaryArtifact = z.infer<typeof SecondaryArtifactSchema>;

export const ActivityArtifactSchema = z.union([
  TimeseriesArtifactSchema,
  EmptyArtifactSchema,
]);
export type ActivityArtifact = z.infer<typeof ActivityArtifactSchema>;

export const InsightCandidateSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: InsightKindSchema,
  severity: InsightSeveritySchema,
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(500),
  factIds: z.array(z.string().min(1).max(128)).max(8),
  /** The renderable evidence artifact — slice 7 renders this directly. */
  artifact: AssistantArtifactSchema,
  drilldown: DrilldownDestinationSchema,
  askPrompt: z.string().min(1).max(280),
  /** Observation time driving recency ranking. */
  observedAt: z.number().int().nonnegative(),
});
export type InsightCandidate = z.infer<typeof InsightCandidateSchema>;

export const ProjectOverviewResourceSchema = z
  .strictObject({
    queryContext: PublicQueryContextSchema,
    /** Opaque server-issued token; drill-downs reuse this exact snapshot. */
    queryContextToken: QueryContextTokenSchema,
    capabilities: ProjectCapabilitiesSchema,
    insights: z
      .array(InsightCandidateSchema)
      .max(INSIGHT_THRESHOLDS.maxInsights),
    /** Exactly three adaptive pulse metrics in v1. */
    pulse: z.array(MetricFactSchema).length(3),
    /**
     * Bounded evidence grounding (R7-F7): detection facts referenced by
     * activity/insights that are not among the three pulse cards (for
     * example the canonical `project.accepted_events` fact behind the
     * activity chart). Every referenced ID must resolve here, in pulse,
     * or in an embedded metric/comparison fact — never to an unreturned
     * metric.
     */
    supportingFacts: z.array(MetricFactSchema).max(8).default([]),
    /** The complete primary trend payload (never a kind pointer). */
    activity: ActivityArtifactSchema,
    /** The complete secondary panel payload (ranking, release, or issues). */
    secondary: SecondaryArtifactSchema,
    dataQuality: DataQualitySummarySchema,
  })
  .superRefine(checkOverviewConsistency);
export type ProjectOverviewResource = z.infer<
  typeof ProjectOverviewResourceSchema
>;

/**
 * Canonical multi-metric read (Task 21 slice 2): bounded metric IDs over
 * one resolved snapshot. The overview adapter (slice 3) and the agent
 * adapter (slice 5) consume these same facts — dashboard and assistant
 * agree byte-for-byte for the same query context.
 */
export const ProjectMetricsResourceSchema = z
  .strictObject({
    queryContext: PublicQueryContextSchema,
    queryContextToken: QueryContextTokenSchema,
    facts: z.array(MetricFactSchema).max(27),
  })
  .superRefine((resource, context) => {
    // Fail-closed identity (R9-F3): duplicate fact IDs would merge
    // distinct measurements under one persisted reference.
    const seen = new Set<string>();
    for (const fact of resource.facts) {
      if (seen.has(fact.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate fact ID ${fact.id}`,
        });
        return;
      }
      seen.add(fact.id);
    }
    // Snapshot consistency (R10-F2): every fact must share the signed
    // top-level context — the same canonical equality the overview
    // schema enforces — so a future adapter or cache regression cannot
    // pair project/range A facts with a project/range B token.
    for (const fact of resource.facts) {
      if (!areQueryContextsEqual(fact.queryContext, resource.queryContext)) {
        context.addIssue({
          code: "custom",
          message: `fact ${fact.id} must share the response query context`,
        });
        return;
      }
    }
  });
export type ProjectMetricsResource = z.infer<
  typeof ProjectMetricsResourceSchema
>;

/**
 * One snapshot per response (R2-F3): every nested fact and artifact context
 * must equal the top-level context behind `queryContextToken`. The server
 * binds the token to that same context at issuance (HMAC + scope checks),
 * so equality here plus token verification there closes the mixed-snapshot
 * hole end to end.
 *
 * Referential grounding (R7-F7): every fact ID cited by activity, secondary,
 * or insight artifacts must resolve to a returned pulse fact, a bounded
 * supporting fact, or an embedded metric/comparison fact — so a chart can
 * never cite whichever metric happens to occupy a pulse slot.
 */
function checkOverviewConsistency(
  resource: {
    queryContext: PublicQueryContext;
    pulse: readonly MetricFact[];
    supportingFacts?: readonly MetricFact[];
    activity: ActivityArtifact;
    secondary: SecondaryArtifact;
    insights: readonly InsightCandidate[];
  },
  context: z.RefinementCtx,
): void {
  const top = resource.queryContext;
  const nested: { where: string; context: PublicQueryContext }[] = [];
  for (const fact of resource.pulse) {
    nested.push({ where: "pulse fact", context: fact.queryContext });
  }
  for (const fact of resource.supportingFacts ?? []) {
    nested.push({ where: "supporting fact", context: fact.queryContext });
  }
  const artifacts = [
    resource.activity,
    resource.secondary,
    ...resource.insights.map((insight) => insight.artifact),
  ];
  for (const artifact of artifacts) {
    nested.push({ where: "artifact", context: artifact.queryContext });
    if (artifact.kind === "metric") {
      nested.push({
        where: "embedded fact",
        context: artifact.fact.queryContext,
      });
    }
    if (artifact.kind === "comparison") {
      nested.push(
        { where: "embedded fact", context: artifact.current.queryContext },
        { where: "embedded fact", context: artifact.previous.queryContext },
      );
    }
  }
  for (const { where, context: nestedContext } of nested) {
    if (!areQueryContextsEqual(nestedContext, top)) {
      context.addIssue({
        code: "custom",
        message: `${where} must share the overview query context`,
      });
      return;
    }
  }
  // Fail-closed identity (R9-F3, R10-F3): one shared helper enforces
  // pulse/supporting uniqueness and disjointness, cited resolution,
  // embedded deep-equality, and insight/artifact uniqueness — in both the
  // schema boundary and the pre-storage builder assertion, so the two can
  // never drift.
  for (const problem of overviewIdentityProblems(resource)) {
    context.addIssue({ code: "custom", message: problem });
    return;
  }
  // Activity grounding (R8-F6, production-enforced): a timeseries chart
  // must cite the canonical accepted-events fact and its zero-filled
  // total must agree with that fact. An empty chart cites nothing.
  const byId = new Map<string, MetricFact>();
  for (const fact of resource.pulse) byId.set(fact.id, fact);
  for (const fact of resource.supportingFacts ?? []) byId.set(fact.id, fact);
  const activity = resource.activity;
  if (activity.kind === "empty") {
    if (activity.factIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "empty activity must not cite facts",
      });
      return;
    }
  } else {
    const citedAccepted = activity.factIds
      .map((id) => byId.get(id))
      .find((fact) => fact?.metricId === "project.accepted_events");
    if (!citedAccepted) {
      context.addIssue({
        code: "custom",
        message: "activity chart must cite accepted events",
      });
      return;
    }
    if (citedAccepted.value === null) {
      context.addIssue({
        code: "custom",
        message: "activity chart cites an unavailable accepted-events fact",
      });
      return;
    }
    const total = activity.series.reduce(
      (sum, entry) =>
        sum + entry.points.reduce((inner, point) => inner + point.value, 0),
      0,
    );
    if (total !== citedAccepted.value) {
      context.addIssue({
        code: "custom",
        message: "activity total disagrees with accepted events",
      });
      return;
    }
  }
}

/**
 * Shared overview identity invariant (R10-F3): the single helper behind
 * both the response-schema refinement and the builder's pre-storage
 * assertion. Every cited fact ID must resolve to a returned pulse or
 * supporting fact; every embedded fact must resolve AND deep-equal the
 * returned fact (an absent ID never self-validates); pulse/supporting
 * IDs are unique and disjoint; insight and top-level artifact IDs are
 * unique. Returns every violation found (empty means valid).
 */
export function overviewIdentityProblems(resource: {
  pulse: readonly MetricFact[];
  supportingFacts?: readonly MetricFact[];
  insights: readonly InsightCandidate[];
  activity: ActivityArtifact;
  secondary: SecondaryArtifact;
}): string[] {
  const problems: string[] = [];
  const returned = new Map<string, MetricFact>();
  for (const fact of resource.pulse) {
    if (returned.has(fact.id)) {
      problems.push(`duplicate pulse fact ID ${fact.id}`);
    } else {
      returned.set(fact.id, fact);
    }
  }
  for (const fact of resource.supportingFacts ?? []) {
    if (returned.has(fact.id)) {
      problems.push(`supporting fact overlaps pulse ID ${fact.id}`);
    } else {
      returned.set(fact.id, fact);
    }
  }
  const artifacts = [
    resource.activity,
    resource.secondary,
    ...resource.insights.map((insight) => insight.artifact),
  ];
  const cited: { where: string; id: string }[] = [];
  for (const id of resource.activity.factIds) {
    cited.push({ where: "activity", id });
  }
  for (const id of resource.secondary.factIds) {
    cited.push({ where: "secondary", id });
  }
  for (const insight of resource.insights) {
    for (const id of insight.factIds) {
      cited.push({ where: `insight ${insight.id}`, id });
    }
    for (const id of insight.artifact.factIds) {
      cited.push({ where: `insight ${insight.id} artifact`, id });
    }
  }
  for (const { where, id } of cited) {
    if (!returned.has(id)) {
      problems.push(`${where} cites unreturned fact ${id}`);
    }
  }
  for (const artifact of artifacts) {
    const embedded: MetricFact[] =
      artifact.kind === "metric"
        ? [artifact.fact]
        : artifact.kind === "comparison"
          ? [artifact.current, artifact.previous]
          : [];
    for (const fact of embedded) {
      const expected = returned.get(fact.id);
      if (expected === undefined) {
        problems.push(
          `embedded fact ${fact.id} resolves to no returned fact`,
        );
      } else if (JSON.stringify(expected) !== JSON.stringify(fact)) {
        problems.push(
          `embedded fact ${fact.id} disagrees with the returned fact`,
        );
      }
    }
  }
  const insightIds = new Set<string>();
  for (const insight of resource.insights) {
    if (insightIds.has(insight.id)) {
      problems.push(`duplicate insight ID ${insight.id}`);
    } else {
      insightIds.add(insight.id);
    }
  }
  const artifactIds = new Set<string>();
  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.id)) {
      problems.push(`duplicate artifact ID ${artifact.id}`);
    } else {
      artifactIds.add(artifact.id);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Compact model summaries: the only data channel into model context (R1-F3)
// ---------------------------------------------------------------------------

/**
 * Prism code performs all measurement and interpretation that can be
 * deterministic. Each tool returns this compact summary to the agent loop;
 * the full UI artifact travels outside model context (streamed/stored for
 * the UI). Full timeseries, rankings, issue rows, and artifact JSON are
 * never serialized back into language-model messages.
 */
export const ModelSummarySchema = z.strictObject({
  factIds: z.array(z.string().min(1).max(128)).max(12),
  text: z.string().max(4000),
  truncated: z.boolean(),
  omittedFacts: z.number().int().nonnegative(),
});
export type ModelSummary = z.infer<typeof ModelSummarySchema>;

/**
 * Strict summary-item boundary (R2-F2): `label` is a trusted canonical
 * metric label (single line, server-resolved); `value` is untrusted
 * observed data serialized as an explicit JSON-quoted envelope, so hostile
 * telemetry can never read as instructions. Newlines, prompt-injection
 * probes, and control characters stay inside the quoted string.
 */
export const ModelSummaryItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  label: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[^\r\n]*$/, "label must be a single line"),
  value: z.string().min(1).max(200),
});
export type ModelSummaryItem = z.infer<typeof ModelSummaryItemSchema>;

// ---------------------------------------------------------------------------
// Assistant evidence facts (R17-F4): every ID advertised to the model
// ---------------------------------------------------------------------------

/**
 * Bounded non-metric evidence the model may cite. Measurements stay
 * canonical `MetricFact`s; everything else the model can quote — an
 * error aggregate, one sanitized issue row, a coverage count, or a
 * definition/memory reference — is one of these explicit shapes. Raw
 * issues, traits, stack data, and arbitrary memory payloads are never
 * evidence: only these server-composed, length-bounded projections.
 * Every shape is JSON-bounded so runs can persist it in slice 6.
 */
export const EvidenceCountSchema = z.strictObject({
  kind: z.literal("count"),
  id: z.string().min(1).max(128),
  label: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[^\r\n]*$/, "label must be a single line"),
  value: z.number().int().nonnegative(),
  unit: z.string().max(32),
});
export type EvidenceCount = z.infer<typeof EvidenceCountSchema>;

export const EvidenceIssueSchema = z.strictObject({
  kind: z.literal("issue"),
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  status: z.enum(["unresolved", "resolved", "ignored"]),
  count: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  delta: z.enum(["new", "regressing", "declining"]).nullable(),
});
export type EvidenceIssue = z.infer<typeof EvidenceIssueSchema>;

export const EvidenceDefinitionSchema = z.strictObject({
  kind: z.literal("definition"),
  id: z.string().min(1).max(128),
  label: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[^\r\n]*$/, "label must be a single line"),
  state: z.enum(["confirmed", "proposed", "standard-event", "missing"]),
  /** Display reference (event key, term name, or state word), verbatim. */
  reference: z.string().min(1).max(200),
});
export type EvidenceDefinition = z.infer<typeof EvidenceDefinitionSchema>;

export const EvidenceMetricSchema = z.strictObject({
  kind: z.literal("metric"),
  fact: MetricFactSchema,
});
export type EvidenceMetric = z.infer<typeof EvidenceMetricSchema>;

export const AssistantEvidenceFactSchema = z.discriminatedUnion("kind", [
  EvidenceMetricSchema,
  EvidenceCountSchema,
  EvidenceIssueSchema,
  EvidenceDefinitionSchema,
]);
export type AssistantEvidenceFact = z.infer<typeof AssistantEvidenceFactSchema>;

/** Stable evidence ID: metric facts keep their canonical ID. */
export function evidenceId(evidence: AssistantEvidenceFact): string {
  return evidence.kind === "metric" ? evidence.fact.id : evidence.id;
}

/** Citable numeric tokens for one evidence record (structured first). */
export function evidenceNumbers(evidence: AssistantEvidenceFact): string[] {
  const tokens = new Set<string>();
  const addToken = (value: string): void => {
    const matches = value.match(/-?\d[\d,]*(?:\.\d+)?%?/g);
    for (const match of matches ?? []) {
      tokens.add(match.replace(/,/g, "").replace(/%$/, ""));
    }
  };
  const addRaw = (value: number | null): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      tokens.add(String(value).replace(/,/g, ""));
    }
  };
  if (evidence.kind === "metric") {
    addToken(evidence.fact.formattedValue);
    addRaw(evidence.fact.value);
    addRaw(evidence.fact.comparisonBasis.previousValue);
    if (
      evidence.fact.comparison !== null &&
      evidence.fact.comparison.kind === "percent" &&
      typeof evidence.fact.comparison.percent === "number"
    ) {
      addRaw(evidence.fact.comparison.percent);
    }
    return [...tokens];
  }
  if (evidence.kind === "count") {
    addRaw(evidence.value);
    return [...tokens];
  }
  if (evidence.kind === "issue") {
    addRaw(evidence.count);
    addRaw(evidence.users);
    return [...tokens];
  }
  addToken(evidence.reference);
  return [...tokens];
}

/**
 * Claimed-direction support for one evidence record: metric comparisons
 * only. Counts, issues, and definitions carry no trend semantics, so
 * trend language about them is never grounded.
 */
export function evidenceDirection(
  evidence: AssistantEvidenceFact,
): "up" | "down" | "flat" | null {
  if (evidence.kind !== "metric") return null;
  const comparison = evidence.fact.comparison;
  if (comparison === null || comparison.kind !== "percent") return null;
  return comparison.direction ?? null;
}

const clampPositiveInt = (value: number, fallback: number, max: number) => {
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  if (floored < 1) return fallback;
  return Math.min(floored, max);
};

/**
 * Deterministic rank-and-truncate: keep input order (already relevance
 * ranked), cap at 12 facts, then drop trailing whole lines past 4,000
 * chars. Overrides are clamped to `AGENT_LIMITS` so callers cannot bypass
 * the model-data ceiling, and the result is parsed through
 * `ModelSummarySchema` before it can enter a provider message. The model
 * is always told additional rows exist.
 */
export function buildModelSummary(
  items: readonly unknown[],
  maxFacts = AGENT_LIMITS.maxModelSummaryFacts,
  maxChars = AGENT_LIMITS.maxModelSummaryChars,
): ModelSummary {
  const safeMaxFacts = clampPositiveInt(
    maxFacts,
    AGENT_LIMITS.maxModelSummaryFacts,
    AGENT_LIMITS.maxModelSummaryFacts,
  );
  const safeMaxChars = clampPositiveInt(
    maxChars,
    AGENT_LIMITS.maxModelSummaryChars,
    AGENT_LIMITS.maxModelSummaryChars,
  );
  const parsed = items.map((item, index) => {
    const result = ModelSummaryItemSchema.safeParse(item);
    if (!result.success) {
      throw new TypeError(`Invalid model summary item at index ${index}`);
    }
    return result.data;
  });
  const selected = parsed.slice(0, safeMaxFacts);
  const lines: string[] = [];
  const factIds: string[] = [];
  const NEWLINE = "\n";
  for (const item of selected) {
    const line = `${item.label}: ${JSON.stringify(item.value)}`;
    if (
      lines.length > 0 &&
      lines.join(NEWLINE).length + 1 + line.length > safeMaxChars
    ) {
      break;
    }
    if (line.length > safeMaxChars) break;
    lines.push(line);
    factIds.push(item.id);
  }
  const omittedFacts = parsed.length - factIds.length;
  const validated = ModelSummarySchema.safeParse({
    factIds,
    text: lines.join(NEWLINE),
    truncated: omittedFacts > 0,
    omittedFacts,
  });
  if (!validated.success) {
    throw new TypeError("Model summary exceeded its schema bounds");
  }
  return validated.data;
}

// ---------------------------------------------------------------------------
// Agent tools: internal capability + friendly presentation
// ---------------------------------------------------------------------------

export const TOOL_IDS = deepFreeze([
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
] as const);
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
export const TOOL_REGISTRY: Record<ToolId, ToolDefinition> = deepFreeze({
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
export const ACTIVITY_STEP_STATES = deepFreeze([
  "pending",
  "running",
  "complete",
  "failed",
] as const);
export type ActivityStepState = (typeof ACTIVITY_STEP_STATES)[number];

export function formatToolLabel(template: string, metricLabel: string): string {
  return template.replace(/\{metric\}/g, metricLabel);
}

// ---------------------------------------------------------------------------
// Agent budgets (R1-F6): five default steps, six max, hard context ceilings
// ---------------------------------------------------------------------------

export const AGENT_LIMITS = deepFreeze({
  defaultSteps: 5,
  maxSteps: 6,
  maxInputTokens: 8000,
  maxOutputTokens: 600,
  defaultRecentMessages: 8,
  maxRecentMessages: 12,
  maxModelSummaryFacts: 12,
  maxModelSummaryChars: 4000,
} as const);

/**
 * Run-scoped activity-step identity (R2-F5). The six-step loop may call one
 * tool several times, so every step carries a server-generated opaque
 * `stepId` plus a zero-based `sequence`. The client keys rows by `stepId`;
 * replay restores the exact streamed trace without relying on label text.
 * The model never provides either field.
 */
export const ActivityStepSchema = z.strictObject({
  stepId: z.string().min(1).max(128),
  sequence: z
    .number()
    .int()
    .min(0)
    .max(AGENT_LIMITS.maxSteps - 1),
  toolId: ToolIdSchema,
  state: z.enum(ACTIVITY_STEP_STATES),
  /** Friendly label only — never internal names, inputs, or JSON. */
  label: z.string().min(1).max(160),
});
export type ActivityStep = z.infer<typeof ActivityStepSchema>;

const TERMINAL_STEP_STATES: readonly ActivityStepState[] = [
  "complete",
  "failed",
];

/**
 * Transition guard for one `stepId`: same tool and sequence, forward-only
 * motion, and no resurrection from terminal states. Returns false (never
 * throws) so stream reducers can translate it into a safe error part.
 */
export function isValidActivityTransition(
  previous: Pick<ActivityStep, "toolId" | "sequence" | "state">,
  next: Pick<ActivityStep, "toolId" | "sequence" | "state">,
): boolean {
  if (previous.toolId !== next.toolId) return false;
  if (previous.sequence !== next.sequence) return false;
  if (previous.state === next.state) return false;
  if ((TERMINAL_STEP_STATES as readonly string[]).includes(previous.state)) {
    return false;
  }
  if (previous.state === "pending") return true;
  return next.state === "complete" || next.state === "failed";
}

/**
 * Stream/replay reducer keyed by `stepId`. New IDs append a row (which must
 * start as pending or running); known IDs advance in place through the
 * transition guard. Throws a TypeError on protocol violations so bugs in
 * the runtime surface loudly instead of corrupting the trace.
 */
export function applyActivityStep(
  steps: readonly ActivityStep[],
  event: ActivityStep,
): ActivityStep[] {
  const index = steps.findIndex((step) => step.stepId === event.stepId);
  if (index === -1) {
    if (event.state !== "pending" && event.state !== "running") {
      throw new TypeError("New activity steps must start pending or running");
    }
    return [...steps, event];
  }
  const previous = steps[index];
  if (previous === undefined || !isValidActivityTransition(previous, event)) {
    throw new TypeError(`Invalid activity transition for ${event.stepId}`);
  }
  return steps.map((step, position) => (position === index ? event : step));
}

export const ANSWER_LIMITS = deepFreeze({
  maxObservations: 3,
  maxFollowUps: 3,
  maxAssumptions: 5,
  maxSummaryChars: 2000,
  maxQuestionChars: 2000,
} as const);

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
// Stream protocol: validated payloads, not bare names (R1-F3)
// ---------------------------------------------------------------------------

/** Validated custom data parts for the UI message stream. */
export const STREAM_PART_NAMES = deepFreeze([
  "data-run-start",
  "data-activity-step",
  "data-fact",
  "data-artifact",
  "data-run-finish",
  "data-run-error",
] as const);
export type StreamPartName = (typeof STREAM_PART_NAMES)[number];

export const StreamErrorCodeSchema = z.enum([
  "provider-error",
  "tool-error",
  "quota-exhausted",
  "cost-exhausted",
  "cancelled",
  "validation-failed",
  "disabled",
]);
export type StreamErrorCode = z.infer<typeof StreamErrorCodeSchema>;

export const AssistantStreamPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("data-run-start"),
    runId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("data-activity-step"),
    stepId: z.string().min(1).max(128),
    sequence: z
      .number()
      .int()
      .min(0)
      .max(AGENT_LIMITS.maxSteps - 1),
    toolId: ToolIdSchema,
    state: z.enum(ACTIVITY_STEP_STATES),
    /** Friendly label only — never internal names, inputs, or JSON. */
    label: z.string().min(1).max(160),
  }),
  z.strictObject({
    kind: z.literal("data-fact"),
    fact: MetricFactSchema,
  }),
  z.strictObject({
    kind: z.literal("data-artifact"),
    artifact: AssistantArtifactSchema,
  }),
  z.strictObject({
    kind: z.literal("data-run-finish"),
    answer: AssistantAnswerSchema,
    factIds: z.array(z.string().min(1).max(128)).max(64),
    artifactIds: z.array(z.string().min(1).max(128)).max(16),
  }),
  z.strictObject({
    kind: z.literal("data-run-error"),
    code: StreamErrorCodeSchema,
    /** Sanitized, display-safe message. Never a raw provider error. */
    message: z.string().min(1).max(280),
    retryable: z.boolean(),
  }),
]);
export type AssistantStreamPart = z.infer<typeof AssistantStreamPartSchema>;

// ---------------------------------------------------------------------------
// Multi-chat conversations (R1-F5)
// ---------------------------------------------------------------------------

/**
 * One chat inside `(user, project)`. No epochs: history, switching, and
 * deletion operate on visible chats. A new chat starts with an empty
 * transcript but still receives confirmed project/workspace knowledge and
 * the member's applicable preferences — never another chat's transcript.
 */
export const InsightSeedSchema = z.strictObject({
  type: z.literal("insight"),
  /** Deterministic insight ID; the server reloads evidence, never the client. */
  insightId: z.string().min(1).max(128),
});
export type InsightSeed = z.infer<typeof InsightSeedSchema>;

/**
 * URL slug for one chat: `chat_` + 12 lowercase alphanumerics, the same
 * opaque crypto-random recipe as workspace `wrk_` slugs. Globally unique
 * (unique index), immutable after creation, and the only chat identifier
 * that ever appears in URLs or the browser. Row IDs (`conv_*`) stay
 * server-internal: runs, messages, and audit trails keep referencing
 * them, and every slug resolves through an ownership-checked lookup
 * that preserves the non-disclosing 404 policy.
 */
export const ConversationSlugSchema = z
  .string()
  .regex(/^chat_[a-z0-9]{12}$/)
  .max(32);
export type ConversationSlug = z.infer<typeof ConversationSlugSchema>;

export const ConversationSchema = z.strictObject({
  id: z.string().min(1).max(128),
  slug: ConversationSlugSchema,
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  title: z.string().min(1).max(80),
  seed: InsightSeedSchema.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastMessageAt: z.number().int().nonnegative().nullable(),
});
export type AssistantConversation = z.infer<typeof ConversationSchema>;

export const ConversationListItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  slug: ConversationSlugSchema,
  title: z.string().min(1).max(80),
  lastMessageAt: z.number().int().nonnegative().nullable(),
  messageCount: z.number().int().nonnegative(),
  hasActiveRun: z.boolean(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

const ConversationCursorPayloadSchema = z.strictObject({
  lastMessageAt: z.number().int().nonnegative().nullable(),
  id: z.string().min(1).max(128),
});

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

/**
 * Opaque history cursor for `(lastMessageAt DESC, id DESC)` pagination.
 * Pagination-only: it carries no authorization — the server still binds
 * every read to the current user and route project.
 */
export function encodeConversationCursor(cursor: {
  lastMessageAt: number | null;
  id: string;
}): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

export function decodeConversationCursor(
  cursor: string,
): { lastMessageAt: number | null; id: string } | null {
  if (!cursor || cursor.length > 512) return null;
  const json = base64UrlDecode(cursor);
  if (!json) return null;
  try {
    const result = ConversationCursorPayloadSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * History ordering: most recent first, chats without messages last, stable
 * by ID descending. Mirrors the required list index.
 */
export function compareConversationOrder(
  a: { lastMessageAt: number | null; id: string },
  b: { lastMessageAt: number | null; id: string },
): number {
  const aTime = a.lastMessageAt ?? -1;
  const bTime = b.lastMessageAt ?? -1;
  if (aTime !== bTime) return bTime - aTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Ownership check: the chat must belong to the user AND the route project. */
export function canAccessConversation(
  conversation: Pick<AssistantConversation, "userId" | "projectId">,
  userId: string,
  projectId: string,
): boolean {
  return conversation.userId === userId && conversation.projectId === projectId;
}

/** Lazy creation: a chat exists only once the member actually submits. */
export const ConversationCreateSchema = z.strictObject({
  clientRequestId: z.string().min(1).max(128),
  firstMessage: z.string().min(1).max(ANSWER_LIMITS.maxQuestionChars),
  seed: InsightSeedSchema.nullable(),
  queryContextToken: QueryContextTokenSchema,
});
export type ConversationCreate = z.infer<typeof ConversationCreateSchema>;

export const DeleteConversationResultSchema = z.strictObject({
  id: z.string().min(1).max(128),
  deleted: z.literal(true),
  /** Deleting a chat aborts its active run when one is running. */
  abortedRun: z.boolean(),
});
export type DeleteConversationResult = z.infer<
  typeof DeleteConversationResultSchema
>;

/** Deterministic chat titles: no model call, unicode-safe truncation. */
export const CHAT_TITLE_MAX_CHARS = 60;

export function deriveChatTitle(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  const chars = Array.from(normalized);
  if (chars.length <= CHAT_TITLE_MAX_CHARS) return normalized;
  return `${chars.slice(0, CHAT_TITLE_MAX_CHARS - 1).join("")}…`;
}

/**
 * One active run per `(user, project)` (v1 concurrency + cost control).
 * The member may keep many chats but must stop or finish the active run
 * before starting another. Enforced by a database-backed constraint in
 * slice 4, never only a browser flag.
 */
/**
 * Run-scoped authorization cache shape (task §Authorization cache). The
 * cache itself lives server-side for one request/run; this freezes its
 * key, contents, and scope checks. The model never receives or controls
 * the key, so prompt injection cannot alter authorization.
 *
 * Rules encoded here: key by immutable `(userId, organizationId,
 * projectId)` — never slugs, conversation IDs, or model values; 10s
 * positive-entry TTL, destroyed with the run; denials never cached across
 * requests; every repository query still binds the cached project ID and
 * restricts sources to `allowedSourceIds`; memory confirm/reject, chat
 * deletion, and future project writes take a fresh transactional check
 * (never the cache).
 */
export const AUTHORIZATION_CACHE_TTL_MS = 10_000;

export const AuthorizedProjectContextSchema = z.strictObject({
  userId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  role: z.enum(["owner", "admin", "member"]),
  allowedSourceIds: z.array(z.string().min(1).max(128)).max(256).readonly(),
  permissions: z.strictObject({
    canConfirmMemory: z.boolean(),
    canManageProject: z.boolean(),
  }),
  cachedAt: z.number().int().nonnegative(),
});
export type AuthorizedProjectContext = z.infer<
  typeof AuthorizedProjectContextSchema
>;

export type AuthorizedContextKey = {
  userId: string;
  organizationId: string;
  projectId: string;
};

/** Cache key from server-verified IDs only — never slugs or model values. */
export function keyForAuthorizedContext(key: AuthorizedContextKey): string {
  return [key.userId, key.organizationId, key.projectId]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Scope gate for tool requests: any model-supplied project, organization,
 * user, or source scope outside the cached context is rejected before any
 * analytics query runs.
 */
export function isToolScopeAllowed(
  cache: Pick<
    AuthorizedProjectContext,
    "userId" | "organizationId" | "projectId" | "allowedSourceIds"
  >,
  scope: {
    userId?: string;
    organizationId?: string;
    projectId?: string;
    sourceIds?: readonly string[];
  },
): boolean {
  if (scope.userId !== undefined && scope.userId !== cache.userId) {
    return false;
  }
  if (
    scope.organizationId !== undefined &&
    scope.organizationId !== cache.organizationId
  ) {
    return false;
  }
  if (scope.projectId !== undefined && scope.projectId !== cache.projectId) {
    return false;
  }
  if (scope.sourceIds !== undefined) {
    const allowed = new Set(cache.allowedSourceIds);
    if (!scope.sourceIds.every((id) => allowed.has(id))) return false;
  }
  return true;
}

export const RunConflictSchema = z.strictObject({
  code: z.literal("active-run-exists"),
  projectId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  activeConversationId: z.string().min(1).max(128),
  activeRunId: z.string().min(1).max(128),
});
export type RunConflict = z.infer<typeof RunConflictSchema>;

// ---------------------------------------------------------------------------
// Persisted messages: replayable widgets, model-blind payloads (R1-F3)
// ---------------------------------------------------------------------------

const TextPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().max(8000),
});
const ArtifactPartSchema = z.strictObject({
  type: z.literal("artifact"),
  /** Full bounded snapshot: reload recreates the exact widget. */
  artifact: AssistantArtifactSchema,
});
const TracePartSchema = z.strictObject({
  type: z.literal("trace"),
  steps: z.array(ActivityStepSchema).max(AGENT_LIMITS.maxSteps),
});

/**
 * Persisted UI parts. Text renders and re-enters model context; artifact
 * and trace parts render on reload but are EXCLUDED from model messages
 * (see `extractModelText`). Only compact `ModelSummary` facts return to
 * the agent loop.
 */
export const AssistantMessagePartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  ArtifactPartSchema,
  TracePartSchema,
]);
export type AssistantMessagePart = z.infer<typeof AssistantMessagePartSchema>;

/** Model-context conversion: text only — full widgets never re-enter. */
export function extractModelText(
  parts: readonly AssistantMessagePart[],
): string[] {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text);
}

export const AssistantMessageSchema = z.strictObject({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant"]),
  status: z.enum(["pending", "streaming", "complete", "cancelled", "failed"]),
  /** Validated UI message parts only — never raw provider payloads. */
  parts: z.array(AssistantMessagePartSchema).max(16),
  failureCode: z.string().max(64).nullable(),
  clientRequestId: z.string().min(1).max(128).nullable(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

// ---------------------------------------------------------------------------
// Runs, usage accounting, quotas, routing policy (R1-F6)
// ---------------------------------------------------------------------------

/**
 * Exact usage accounting. Cost is an integer count of micro-USD (smallest
 * accounting unit) — never a binary floating-point dollar value.
 */
export const RunUsageSchema = z.strictObject({
  model: z.string().min(1).max(128),
  gateway: z.literal("openrouter"),
  upstreamProvider: z.string().min(1).max(128).nullable(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  costMicroUsd: z.number().int().nonnegative(),
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

export const QuotaDecisionSchema = z.enum([
  "allowed",
  "denied-quota",
  "denied-cost",
  "stopped-exhausted",
]);
export type QuotaDecision = z.infer<typeof QuotaDecisionSchema>;

export const QuotaOutcomeSchema = z.strictObject({
  decision: QuotaDecisionSchema,
  limitType: z
    .enum(["daily-user", "daily-workspace", "per-run-cost"])
    .nullable(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
});
export type QuotaOutcome = z.infer<typeof QuotaOutcomeSchema>;

/**
 * OpenRouter routing policy (v1): one pinned model, no fallback list, tool
 * and structured-output support required, provider data collection denied,
 * zero-data-retention endpoints by default, lowest eligible price
 * preferred, hard per-million-token price caps. Verify the exact
 * provider-options shape against the installed adapter version in
 * slice 5.
 *
 * `requireZeroDataRetention` is boolean (not a literal) for exactly one
 * reason: local evaluation against models with no ZDR endpoint
 * (`PRISM_AI_REQUIRE_ZDR=0`). That weakens the privacy posture —
 * prompts and tool summaries may be retained upstream — so production
 * must never set it. The eval harness records the effective value in
 * every report.
 */
export const OpenRouterRoutingPolicySchema = z.strictObject({
  allowedModels: z.array(z.string().min(1).max(128)).length(1),
  allowFallbackModels: z.literal(false),
  requireToolSupport: z.literal(true),
  requireStructuredOutput: z.literal(true),
  denyDataCollection: z.literal(true),
  requireZeroDataRetention: z.boolean(),
  preferLowestPrice: z.literal(true),
  maxPromptPricePerMillion: z.number().nonnegative(),
  maxCompletionPricePerMillion: z.number().nonnegative(),
});
export type OpenRouterRoutingPolicy = z.infer<
  typeof OpenRouterRoutingPolicySchema
>;

export const AssistantRunSchema = z.strictObject({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  queryContextHash: z.string().min(1).max(128),
  definitionVersion: z.literal(DEFINITION_VERSION),
  model: z.string().min(1).max(128),
  provider: z.literal("openrouter"),
  status: z.enum(["running", "complete", "cancelled", "failed"]),
  stepCount: z.number().int().min(0).max(AGENT_LIMITS.maxSteps),
  toolIds: z.array(ToolIdSchema).max(AGENT_LIMITS.maxSteps),
  usage: RunUsageSchema.nullable(),
  /** Fact/artifact references required to reproduce the visible answer. */
  factIds: z.array(z.string().min(1).max(128)).max(64),
  artifactIds: z.array(z.string().min(1).max(128)).max(16),
  latencyMs: z.number().int().nonnegative().nullable(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  failureCode: z.string().max(64).nullable(),
});
export type AssistantRun = z.infer<typeof AssistantRunSchema>;

// ---------------------------------------------------------------------------
// Typed memory: scope-owned, key-typed, invariant-checked (R1-F4)
// ---------------------------------------------------------------------------

export const MEMORY_SCOPES = deepFreeze([
  "project",
  "workspace",
  "member",
] as const);
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_KEYS = deepFreeze([
  "signup-definition",
  "activation-definition",
  "key-outcome-definition",
  "business-term",
  "preferred-comparison-range",
] as const);
export type MemoryKey = (typeof MEMORY_KEYS)[number];

export const MEMORY_STATUSES = deepFreeze([
  "proposed",
  "confirmed",
  "superseded",
  "rejected",
] as const);
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/**
 * Scope matrix: outcome definitions are project knowledge; business terms
 * are shared project/workspace knowledge; comparison preference is a
 * member-scoped preference that never needs confirmation.
 */
const PROJECT_MEMORY_KEYS = [
  "signup-definition",
  "activation-definition",
  "key-outcome-definition",
  "business-term",
] as const;
const WORKSPACE_MEMORY_KEYS = ["business-term"] as const;
const MEMBER_MEMORY_KEYS = ["preferred-comparison-range"] as const;

const DefinitionPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("standard-event"),
    eventKey: StandardEventKeySchema,
  }),
  z.strictObject({
    kind: z.literal("custom-event"),
    eventName: z.string().min(1).max(120),
  }),
]);
const BusinessTermPayloadSchema = z.strictObject({
  name: z.string().min(1).max(80),
  description: z.string().max(280),
});
const ComparisonRangePayloadSchema = z.strictObject({
  range: OverviewRangeSchema,
});
const MemoryPayloadSchema = z.union([
  DefinitionPayloadSchema,
  BusinessTermPayloadSchema,
  ComparisonRangePayloadSchema,
]);
export type MemoryPayload = z.infer<typeof MemoryPayloadSchema>;

const MemoryBaseSchema = z.strictObject({
  id: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  status: z.enum(MEMORY_STATUSES),
  value: z.strictObject({
    version: z.number().int().nonnegative(),
    label: z.string().min(1).max(160),
    description: z.string().max(500),
    payload: MemoryPayloadSchema,
  }),
  proposerId: z.string().min(1).max(128).nullable(),
  confirmerId: z.string().min(1).max(128).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const checkPayloadForKey = (
  key: MemoryKey,
  payload: MemoryPayload,
  context: z.RefinementCtx,
): void => {
  if (
    key === "signup-definition" ||
    key === "activation-definition" ||
    key === "key-outcome-definition"
  ) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("kind" in payload)
    ) {
      context.addIssue({
        code: "custom",
        message: `${key} requires a definition payload`,
      });
    }
    return;
  }
  if (key === "business-term") {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("name" in payload)
    ) {
      context.addIssue({
        code: "custom",
        message: "business-term requires a name and description",
      });
    }
    return;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("range" in payload)
  ) {
    context.addIssue({
      code: "custom",
      message: "preferred-comparison-range requires a range",
    });
  }
};

const checkProvenance = (
  record: {
    status: MemoryStatus;
    scope: MemoryScope;
    proposerId: string | null;
    confirmerId: string | null;
  },
  context: z.RefinementCtx,
): void => {
  if (record.status === "proposed" && !record.proposerId) {
    context.addIssue({
      code: "custom",
      message: "proposed records require a proposer",
    });
  }
  if (
    record.status === "confirmed" &&
    record.scope !== "member" &&
    !record.confirmerId
  ) {
    context.addIssue({
      code: "custom",
      message: "confirmed shared records require a confirmer",
    });
  }
};

export const MemoryRecordSchema = z
  .discriminatedUnion("scope", [
    MemoryBaseSchema.extend({
      scope: z.literal("project"),
      key: z.enum(PROJECT_MEMORY_KEYS),
      /** Project knowledge always belongs to exactly one project. */
      projectId: z.string().min(1).max(128),
      subjectUserId: z.null(),
    }),
    MemoryBaseSchema.extend({
      scope: z.literal("workspace"),
      key: z.enum(WORKSPACE_MEMORY_KEYS),
      /** Workspace knowledge never carries a project ID. */
      projectId: z.null(),
      subjectUserId: z.null(),
    }),
    MemoryBaseSchema.extend({
      scope: z.literal("member"),
      key: z.enum(MEMBER_MEMORY_KEYS),
      projectId: z.string().min(1).max(128).nullable(),
      /** Member preferences are owned by exactly one member. */
      subjectUserId: z.string().min(1).max(128),
    }),
  ])
  .superRefine((record, context) => {
    checkPayloadForKey(record.key, record.value.payload, context);
    checkProvenance(record, context);
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
// Provider and deployment configuration (R1-F6)
// ---------------------------------------------------------------------------

/** Hosted Prism server-only configuration names (OpenRouter gateway). */
export const PRISM_AI_ENV_NAMES = deepFreeze([
  "PRISM_AI_ENABLED",
  "PRISM_AI_MODEL",
  "OPENROUTER_API_KEY",
  "PRISM_AI_MAX_STEPS",
  "PRISM_AI_MAX_INPUT_CHARS",
  "PRISM_AI_MAX_INPUT_TOKENS",
  "PRISM_AI_MAX_OUTPUT_TOKENS",
  "PRISM_AI_MAX_PROMPT_PRICE_PER_MILLION",
  "PRISM_AI_MAX_COMPLETION_PRICE_PER_MILLION",
  "PRISM_AI_REQUIRE_ZDR",
] as const);
export type PrismAiEnvName = (typeof PRISM_AI_ENV_NAMES)[number];
