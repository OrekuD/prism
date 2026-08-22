/**
 * Web page analytics dashboard contracts (Task 17 slice 1).
 *
 * One authorized project-scoped endpoint returns the complete page payload.
 * Metric definitions are frozen in tasks/task-17.md §7 and mirrored by
 * PAGE_VIEW_LIMITS in @prism-analytics/core; the server owns every number
 * here — the dashboard never recomputes metrics from raw rows.
 */

/** Trusted source platform is always `web` for this module (Task 17 boundary). */
export type WebAnalyticsSourceFilter = {
	id: string;
	name: string;
	platform: "web";
	status: "active" | "archived";
};

export type WebAnalyticsFilters = {
	sourceIds: string[];
	host: string | null;
	path: string | null;
	traffic: "human" | "all";
};

export type WebAnalyticsTotals = {
	pageViews: number;
	visitors: number;
	sessions: number;
	viewsPerSession: number;
	/** null = not enough completed sessions — never render as 0. */
	bounceRate: number | null;
	excludedBots: number;
};

/**
 * Prior-period change for one metric. When the prior value is zero the API
 * returns `kind: "new"` instead of an infinite percentage (Task 17 §7).
 */
export type WebAnalyticsComparisonValue =
	| { kind: "percent"; direction: "up" | "down" | "flat"; percent: number }
	| { kind: "new" }
	| { kind: "no-prior-data" };

export type WebAnalyticsComparison = {
	pageViews: WebAnalyticsComparisonValue;
	visitors: WebAnalyticsComparisonValue;
	sessions: WebAnalyticsComparisonValue;
	viewsPerSession: WebAnalyticsComparisonValue;
	bounceRate: WebAnalyticsComparisonValue | null;
};

/** UTC-bucketed trend point. Zero buckets are explicit, never interpolated. */
export type WebAnalyticsTrendPoint = {
	bucketStartUtc: number;
	pageViews: number;
	visitors: number;
	sessions: number;
};

export type WebAnalyticsTrendSeries = "pageViews" | "visitors" | "sessions";

/** Bucket granularity implied by the selected range (Task 17 §Layout). */
export type WebAnalyticsBucket = "hourly" | "daily" | "weekly";

export type WebAnalyticsPageRow = {
	path: string;
	title: string | null;
	host: string | null;
	pageViews: number;
	visitors: number;
	entrances: number;
	sharePercent: number;
	/** Bounce rate for sessions entering on this page; null when ineligible. */
	bounceRate: number | null;
};

export type WebAnalyticsReferrerRow = {
	/** `null` = Direct (no external referrer and no campaign source). */
	referrerHost: string | null;
	sessions: number;
	visitors: number;
	sharePercent: number;
};

export type WebAnalyticsCampaignRow = {
	source: string | null;
	medium: string | null;
	name: string | null;
	sessions: number;
	visitors: number;
	sharePercent: number;
};

export type WebAnalyticsLocationRow = {
	countryCode: string | null;
	region: string | null;
	city: string | null;
	sessions: number;
	visitors: number;
	pageViews: number;
	sharePercent: number;
};

/** Privacy-suppressed region/city rows collapse under this label. */
export const WEB_ANALYTICS_OTHER_LABEL = "Other";
/** Eligible traffic that could not be enriched. */
export const WEB_ANALYTICS_UNKNOWN_LABEL = "Unknown";

export type WebAnalyticsLocationGroups = {
	countries: WebAnalyticsLocationRow[];
	regions: WebAnalyticsLocationRow[];
	cities: WebAnalyticsLocationRow[];
	coveragePercent: number;
};

export type WebAnalyticsTechnologyRow = {
	key: string;
	label: string;
	pageViews: number;
	visitors: number;
	sharePercent: number;
};

export type WebAnalyticsDeviceType =
	| "desktop"
	| "mobile"
	| "tablet"
	| "bot"
	| "unknown";

export type WebAnalyticsTechnologyGroups = {
	browsers: WebAnalyticsTechnologyRow[];
	operatingSystems: WebAnalyticsTechnologyRow[];
	devices: Array<
		WebAnalyticsTechnologyRow & { deviceType: WebAnalyticsDeviceType }
	>;
	viewports: WebAnalyticsTechnologyRow[];
	languages: WebAnalyticsTechnologyRow[];
	coveragePercent: number;
};

export type WebAnalyticsCoverage = {
	technologyPercent: number;
	geographyPercent: number;
	campaignPercent: number;
};

/**
 * Migration-owned projection row (`web_page_views`, Task 17 §6). The
 * accepted event stays the source of truth; this row exists so bounded
 * page queries never re-group arbitrary JSON. Source/session/person and
 * SDK identity are read through the linked event — duplicated authorities
 * are deliberately NOT stored here.
 */
export type WebPageViewProjection = {
	projectId: string;
	eventId: string;
	occurredAt: number;
	host: string;
	path: string;
	title: string | null;
	navigationType: "initial" | "push" | "replace" | "pop" | "manual";
	pageSequence: number;
	previousPath: string | null;
	referrerHost: string | null;
	campaignSource: string | null;
	campaignMedium: string | null;
	campaignName: string | null;
	browserFamily: string | null;
	browserMajor: number | null;
	osFamily: string | null;
	osMajor: number | null;
	deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
	isBot: 0 | 1;
	uaParserVersion: string | null;
	viewportWidth: number | null;
	viewportHeight: number | null;
	primaryLanguage: string | null;
	countryCode: string | null;
	region: string | null;
	city: string | null;
	geoProvider: string | null;
};

/** Query params for GET /projects/:slug/web-analytics (all validated server-side). */
export type WebAnalyticsRequest = {
	from: number;
	to: number;
	sourceId?: string[];
	host?: string;
	path?: string;
	traffic?: "human" | "all";
};

export type WebAnalyticsResource = {
	range: { from: number; to: number; timezone: "UTC" };
	filters: WebAnalyticsFilters;
	totals: WebAnalyticsTotals;
	comparison: WebAnalyticsComparison;
	trend: {
		bucket: WebAnalyticsBucket;
		points: WebAnalyticsTrendPoint[];
	};
	pages: WebAnalyticsPageRow[];
	referrers: WebAnalyticsReferrerRow[];
	campaigns: WebAnalyticsCampaignRow[];
	locations: WebAnalyticsLocationGroups;
	technology: WebAnalyticsTechnologyGroups;
	coverage: WebAnalyticsCoverage;
};
