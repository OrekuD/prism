/**
 * Reserved page-view contract (Task 17 slice 1).
 *
 * Page views ride the EXISTING consent/queue/batch/retry/source-key lane as
 * a reserved analytics event (`$prism_page_view`). They are NOT a second
 * delivery path: the same wire envelope, idempotency, byte limits, and
 * redaction policy apply. What distinguishes them is:
 *
 * 1. A reserved `$prism_` name that public `track()` calls can never use.
 * 2. A strict, versioned property schema validated independently by the
 *    Browser SDK (before queueing) and the ingestion service (before
 *    persistence). Malformed reserved events are individually rejected —
 *    they are never silently stored as ordinary custom events.
 *
 * This module is the ONE shared definition used by Core, Browser, React,
 * and the analytics ingestion service.
 */

/** SDK-owned analytics event namespace. Public `track()` rejects it. */
export const RESERVED_EVENT_PREFIX = "$prism_" as const;

/** The canonical page-view event name (reserved, see above). */
export const PAGE_VIEW_EVENT_NAME = "$prism_page_view" as const;

/** How the SDK observed the navigation (frozen vocabulary). */
export type PageViewNavigation =
	| "initial"
	| "push"
	| "replace"
	| "pop"
	| "manual";

/**
 * The immutable candidate the tracker builds per navigation, BEFORE
 * consent/sanitization/reserved-event wrapping. `beforeCapture` receives
 * this shape and may normalize or drop it.
 */
export interface PageViewCandidate {
	/** Lowercased hostname (IDNA-safe), e.g. `"acme.com"`. Never a full URL. */
	readonly host: string;
	/** Canonical path starting at `/`. No query, no hash. Empty path → `/`. */
	readonly path: string;
	readonly navigation: PageViewNavigation;
	/** Per-session monotonic counter starting at 1. */
	readonly sequence: number;
	/** Previous canonical path in this Web session, when known. */
	readonly previousPath?: string;
	/** Document title — captured only when `captureTitle: true` (default false). */
	readonly title?: string;
}

/** Wire properties for `$prism_page_view` (strict, bounded). Stands alone
 * from `JsonObject`: every field is JSON-serializable by construction, but
 * the exact shape must not be widened back into arbitrary-JSON land. */
export interface PageViewWireProperties {
	readonly $page: {
		readonly host: string;
		readonly path: string;
		readonly navigation: PageViewNavigation;
		readonly sequence: number;
		readonly previousPath?: string;
		readonly title?: string;
	};
	/** External referrer host ONLY — never its path/query/hash. Same-host
	 * referrers are omitted (internal traffic is not acquisition). */
	readonly $referrer?: { readonly host: string };
	/** Only allowlisted UTM parameters, credential-redacted like any value. */
	readonly $campaign?: {
		readonly source?: string;
		readonly medium?: string;
		readonly name?: string;
	};
}

/** Input accepted by the manual-mode `pageViews.capture()` controller. */
export interface ManualPageViewInput {
	/** Developer-normalized route (hash-router safe). Defaults to location.pathname. */
	readonly path?: string;
	/** Override the host (rare: multi-domain apps driving one SPA). */
	readonly host?: string;
	/** Explicit navigation kind; defaults to `"manual"`. */
	readonly navigation?: Extract<PageViewNavigation, "manual">;
	readonly title?: string;
}

/** Router-neutral React hook input (Task 17 §React integration). The hook
 * accepts a normalized route from ANY router; it never reads
 * location.search/location.hash implicitly. */
export interface UsePrismPageViewOptions {
	/** Developer-normalized route path starting at `/`. */
	readonly path: string;
	/** Optional explicit title override (respects captureTitle policy). */
	readonly title?: string;
}

/** Browser `pageViews` configuration (Task 17 §Public SDK contract). */
export interface BrowserPageViewOptions {
	/**
	 * - `history`: patch pushState/replaceState/popstate once per browser
	 *   context (reference-counted across clients) and capture real changes.
	 * - `manual`: install NO listeners; the developer (or the React hook)
	 *   calls `client.pageViews.capture({ path })`.
	 */
	readonly mode: "history" | "manual";
	/** Capture document.title per view. Default `false` (titles can contain
	 * user names or search terms). */
	readonly captureTitle?: boolean;
	/** UTM parameter allowlist. Default: utm_source, utm_medium, utm_campaign.
	 * Extending requires listing exact names here; the full query is never read. */
	readonly campaignParameters?: readonly string[];
	/**
	 * Synchronous normalization hook. Receives an immutable candidate and
	 * returns a replacement candidate or `null` to drop the page view. If it
	 * throws, the page view is dropped and a safe diagnostic is emitted;
	 * application navigation is never broken.
	 */
	readonly beforeCapture?: (
		page: Readonly<PageViewCandidate>,
	) => PageViewCandidate | null;
}

/** Frozen metric/boundary constants shared by SDK, server, and dashboard. */
export const PAGE_VIEW_LIMITS = {
	/** Hostname ceiling (DNS spec upper bound). */
	maxHostLength: 255,
	/** Canonical path ceiling. Longer paths are dropped at capture. */
	maxPathLength: 2048,
	/** Previous-path ceiling (same as path). */
	maxPreviousPathLength: 2048,
	/** Title ceiling when captureTitle is enabled. */
	maxTitleLength: 512,
	/** Referrer/campaign value ceiling. */
	maxAttributionValueLength: 255,
	/** Fixed Web-session inactivity timeout (NOT configurable in v1). */
	webSessionInactivityTimeoutMs: 30 * 60_000,
	/** Page views older than this at delivery receive no geography. */
	lateDeliveryGeoCutoffMs: 15 * 60_000,
	/** Maximum dashboard query range (raw projection): ~13 months. */
	maxDashboardRangeMs: 366 * 86_400_000,
	/** Maximum rows returned per ranking group. */
	rankingRowLimit: 50,
	/** Region/city privacy suppression threshold (sessions). Smaller groups
	 * fold into `Other`; country totals stay visible. */
	citySuppressionMinSessions: 5,
} as const;

/** Bounded viewport width buckets (never exact w×h pairs). */
export const VIEWPORT_WIDTH_BUCKETS = [
	"<480",
	"480-767",
	"768-1023",
	"1024-1439",
	"1440+",
] as const;

export type ViewportWidthBucket = (typeof VIEWPORT_WIDTH_BUCKETS)[number];

export function viewportWidthBucket(width: number): ViewportWidthBucket {
	if (width < 480) return "<480";
	if (width < 768) return "480-767";
	if (width < 1024) return "768-1023";
	if (width < 1440) return "1024-1439";
	return "1440+";
}

const HOST_PATTERN =
	/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function isBoundedString(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Structural check shared by capture and ingestion for one bounded field. */
export function isValidCanonicalPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("/") &&
		value.length <= PAGE_VIEW_LIMITS.maxPathLength &&
		!value.includes("?") &&
		!value.includes("#")
	);
}

export function isValidPageHost(value: unknown): value is string {
	return (
		isBoundedString(value, PAGE_VIEW_LIMITS.maxHostLength) &&
		HOST_PATTERN.test(value)
	);
}

export type PageViewValidationResult =
	| { ok: true }
	| { ok: false; reason: string };

/**
 * Strict validation for `$prism_page_view` wire properties (SDK pre-send
 * AND server pre-persistence use this ONE implementation). Anything that
 * fails here is an individually rejected outcome, never a silent custom
 * event.
 */
export function validatePageViewProperties(
	properties: unknown,
): PageViewValidationResult {
	if (
		typeof properties !== "object" ||
		properties === null ||
		Array.isArray(properties)
	) {
		return { ok: false, reason: "page-view properties must be an object" };
	}
	const record = properties as Record<string, unknown>;
	const allowedTopKeys = new Set(["$page", "$referrer", "$campaign"]);
	for (const key of Object.keys(record)) {
		if (!allowedTopKeys.has(key)) {
			return { ok: false, reason: `unknown page-view property "${key}"` };
		}
	}

	const page = record.$page;
	if (typeof page !== "object" || page === null || Array.isArray(page)) {
		return { ok: false, reason: "$page is required" };
	}
	const p = page as Record<string, unknown>;
	const allowedPageKeys = new Set([
		"host",
		"path",
		"navigation",
		"sequence",
		"previousPath",
		"title",
	]);
	for (const key of Object.keys(p)) {
		if (!allowedPageKeys.has(key)) {
			return { ok: false, reason: `unknown $page field "${key}"` };
		}
	}
	if (!isValidPageHost(p.host)) {
		return { ok: false, reason: "$page.host must be a normalized hostname" };
	}
	if (!isValidCanonicalPath(p.path)) {
		return {
			ok: false,
			reason:
				'$page.path must be a bounded canonical path starting with "/" without query/hash',
		};
	}
	const navigation = p.navigation;
	if (
		navigation !== "initial" &&
		navigation !== "push" &&
		navigation !== "replace" &&
		navigation !== "pop" &&
		navigation !== "manual"
	) {
		return { ok: false, reason: "$page.navigation must be a known kind" };
	}
	const sequence = p.sequence;
	if (
		typeof sequence !== "number" ||
		!Number.isInteger(sequence) ||
		sequence < 1 ||
		sequence > 10_000
	) {
		return { ok: false, reason: "$page.sequence must be a positive integer" };
	}
	if (p.previousPath !== undefined) {
		if (!isValidCanonicalPath(p.previousPath)) {
			return {
				ok: false,
				reason: "$page.previousPath must be a canonical path",
			};
		}
	}
	if (p.title !== undefined) {
		if (
			typeof p.title !== "string" ||
			p.title.length > PAGE_VIEW_LIMITS.maxTitleLength
		) {
			return {
				ok: false,
				reason: `$page.title must be a string of at most ${PAGE_VIEW_LIMITS.maxTitleLength} characters`,
			};
		}
	}

	if (record.$referrer !== undefined) {
		const referrer = record.$referrer as Record<string, unknown>;
		const keys = Object.keys(referrer);
		if (keys.length !== 1 || keys[0] !== "host") {
			return { ok: false, reason: "$referrer accepts only { host }" };
		}
		if (!isValidPageHost(referrer.host)) {
			return {
				ok: false,
				reason: "$referrer.host must be a normalized hostname",
			};
		}
		if (referrer.host === p.host) {
			// Internal navigation never carries acquisition attribution.
			return { ok: false, reason: "$referrer must differ from the page host" };
		}
	}

	if (record.$campaign !== undefined) {
		const campaign = record.$campaign as Record<string, unknown>;
		const allowedCampaignKeys = new Set(["source", "medium", "name"]);
		for (const key of Object.keys(campaign)) {
			if (!allowedCampaignKeys.has(key)) {
				return { ok: false, reason: `unknown $campaign field "${key}"` };
			}
		}
		for (const key of ["source", "medium", "name"] as const) {
			const value = campaign[key];
			if (value === undefined) continue;
			if (
				typeof value !== "string" ||
				value.length === 0 ||
				value.length > PAGE_VIEW_LIMITS.maxAttributionValueLength
			) {
				return {
					ok: false,
					reason: `$campaign.${key} must be 1-${PAGE_VIEW_LIMITS.maxAttributionValueLength} characters`,
				};
			}
		}
	}

	return { ok: true };
}

/** True when a public `track()` name enters the reserved SDK namespace. */
export function isReservedAnalyticsEventName(name: string): boolean {
	return name.startsWith(RESERVED_EVENT_PREFIX);
}
