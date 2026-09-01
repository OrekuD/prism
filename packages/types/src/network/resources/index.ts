import type { Roles } from "../../enums";

export type ErrorResource = {
	errors: Array<string>;
};

export type OkResource = {
	message: string;
};

export type ProfilePictureResource = {
	profilePictureUrl: string;
};

export type TeamInviteLinkResource = {
	teamInviteUrl: string;
};

export type ProfileResource = {
	firstName: string;
	lastName: string;
	gender: string | null;
	profilePictureUrl: string | null;
	emailVerifiedAt: string | null;
};

export type UserResource = {
	id: string;
	email: string;
	userName: string | null;
	role: Roles;
	profile: ProfileResource | null;
};

export type ProjectResource = {
	id: string;
	name: string;
	slug: string;
	summary: Array<{ date: string; desktop: number; mobile: number }>;
};

/**
 * v2 session resource (task-9 slice 6): client-generated IDs, camelCase,
 * decoded context JSON. Raw IP and approximate coordinates are NOT part
 * of the model — a null-geo session still renders as a useful list row.
 */
export type SessionResource = {
	sessionId: string;
	projectId: string;
	anonymousId: string | null;
	startedAt: number;
	endedAt: number | null;
	lastSeenAt: number;
	context: Record<string, unknown> | null;
	isOnline: 0 | 1;
	/** F16.1: origin source that emitted session_started — nullable for migrated rows. */
	source?: EventSourceAttribution | null;
};

/**
 * v2 event resource: properties are DECODED at the API boundary into a
 * typed JSON value (never a JSON string the dashboard prints verbatim).
 *
 * Task 16 Events UI: carries the trusted stored fields (type, source,
 * platform, identity, SDK) so the dashboard can render source attribution
 * without reconstructing it from properties. `source` is hydrated by the
 * product API from Postgres; the analytics-store row only has source_id.
 */
export type EventResource = {
	id: string;
	sessionId: string | null;
	projectId: string;
	name: string;
	/** Envelope event type — currently always "track". */
	type?: string;
	properties: Record<string, unknown> | null;
	context?: Record<string, unknown> | null;
	occurredAt: number;
	receivedAt: number;
	schemaVersion: number;
	anonymousId?: string | null;
	userId?: string | null;
	personId?: string | null;
	/** Trusted — derived from the ingestion key's source, never client payload. */
	sourceId?: string | null;
	platform?: string | null;
	sdkName?: string | null;
	sdkVersion?: string | null;
	/** Hydrated source attribution (pre-archive interim shape until slice 2 adds status). */
	source?: { id: string; name: string; platform: string } | null;
	standardEvent?: StandardEventAttribution | null;
};

// ---------------------------------------------------------------------------
// Task 16 — canonical event contracts (slice 1)
// ---------------------------------------------------------------------------

/** Trusted source platform — exact persisted value. UI groups into Web/Mobile/Server. */
export type SourcePlatform = "web" | "ios" | "android" | "react-native" | "server";

export type SourceStatus = "active" | "archived";

/** Source that sent an event — derived from the ingestion key, never client-supplied. */
export type EventSourceAttribution = {
	id: string;
	name: string;
	platform: SourcePlatform;
	status: SourceStatus;
};

/** Frozen Standard Event display metadata — derived from the shared Core registry, never from client payload. */
export type StandardEventKey =
	| "sign_up"
	| "login"
	| "logout"
	| "onboarding_started"
	| "onboarding_step_completed"
	| "onboarding_completed"
	| "lead_generated"
	| "invite_sent"
	| "invite_accepted"
	| "trial_started"
	| "trial_ended"
	| "subscription_started"
	| "subscription_renewed"
	| "subscription_changed"
	| "subscription_paused"
	| "subscription_resumed"
	| "subscription_cancelled"
	| "subscription_expired"
	| "payment_succeeded"
	| "payment_failed"
	| "purchase"
	| "refund"
	| "search"
	| "share"
	| "feedback_submitted";

export type StandardEventAttribution = {
	key: StandardEventKey;
	displayName: string;
	category: string;
	schemaVersion: 1;
};

/** Lightweight list item — what the Events table renders without opening detail. */
export type EventListItemResource = {
	id: string;
	projectId: string;
	name: string;
	type: string;
	occurredAt: number;
	receivedAt: number;
	personId: string | null;
	sessionId: string | null;
	source: EventSourceAttribution | null;
	standardEvent: StandardEventAttribution | null;
};

/** Full detail — authorized view for the drawer/route. Identity/context/SDK are nullable. */
export type EventDetailResource = EventListItemResource & {
	anonymousId: string | null;
	userId: string | null;
	properties: Record<string, unknown> | null;
	context: Record<string, unknown> | null;
	sdk: { name: string; version: string } | null;
	schemaVersion: number;
};

export type EventsListResource = {
	events: EventListItemResource[];
	nextCursor: string | null;
};

/** Bounded filter for GET /projects/:slug/events (slice 5). All fields are optional and validated. */
export type EventFilterRequest = {
	from?: number;
	to?: number;
	eventName?: string;
	sourceId?: string;
	sourcePlatform?: SourcePlatform;
	personId?: string;
	sessionId?: string;
	/** Exact property match — both key and value are bounded. */
	propertyKey?: string;
	propertyValue?: string;
	cursor?: string;
	limit?: number;
};

/** Opaque keyset cursor for (received_at, id). */
export type EventCursor = {
	receivedAt: number;
	id: string;
};

export function encodeEventCursor(cursor: EventCursor): string {
	const json = JSON.stringify([cursor.receivedAt, cursor.id]);
	if (typeof Buffer !== "undefined") return (Buffer as unknown as { from(s: string): { toString(e: string): string } }).from(json).toString("base64url");
	const b64 = btoa(json);
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeEventCursor(cursor: string): EventCursor | null {
	try {
		let json: string;
		if (typeof Buffer !== "undefined") {
			json = (Buffer as unknown as { from(s: string, e: string): { toString(e: string): string } }).from(cursor, "base64url").toString("utf8");
		} else {
			let b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
			while (b64.length % 4) b64 += "=";
			json = atob(b64);
		}
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed) || parsed.length !== 2) return null;
		const [receivedAt, id] = parsed as [unknown, unknown];
		if (typeof receivedAt !== "number" || typeof id !== "string") return null;
		if (!Number.isFinite(receivedAt) || id.length === 0 || id.length > 100) return null;
		return { receivedAt, id };
	} catch {
		return null;
	}
}

/**
 * Person resource (task-10 §5): opaque personId (the deterministic
 * internal id — clients need it for detail/export/delete), safe trait
 * values, first/last seen, and honest distinct counts. No email/name
 * inference — only developer-supplied data is ever present.
 */
export type PeopleResource = {
	personId: string;
	firstSeenAt: number;
	lastSeenAt: number;
	traits: Record<string, unknown>;
	/** Distinct linked identities (external + anonymous). */
	identityCount: number;
	/** Distinct sessions across the person's events. */
	sessionCount: number;
	/** Event occurrences. */
	eventCount: number;
};

export type PersonDetailResource = PeopleResource & {
	externalIds: string[];
	anonymousIds: string[];
};

export type PeopleListResource = {
	people: Array<PeopleResource>;
	/** Keyset cursor for the next page (opaque; absent on the last page). */
	nextCursor: string | null;
};

export type BreakdownResource = {
	dimension: string;
	rows: Array<{ key: string; count: number }>;
};

export type TotalsResource = {
	events: number;
	people: number;
	anonymousIdentities: number;
	sessions: number;
};

export type ProjectDetailedResource = {
	id: string;
	name: string;
	slug: string;
	organizationId: string;
	analytics: {
		/** Per-day session counts over the requested duration (bounded aggregate). */
		summary: Array<{ date: string; desktop: number; mobile: number }>;
		device: {
			desktop: number;
			mobile: number;
		};
	};
};

/**
 * Error tracking contracts (task-15 §Read and workflow APIs).
 *
 * Mirrors the error_issues shape frozen in tasks/task-15.md: an issue is a
 * durable (project, platform, fingerprint) group with a workflow lifecycle
 * (unresolved/resolved/ignored). Counts and delta are windowed against the
 * Errors page range selector; the read API computes them in the database,
 * never by loading occurrences into application memory.
 */
export type ErrorIssueStatus = "unresolved" | "resolved" | "ignored";
export type ErrorIssueLevel = "error" | "warning";

/** Direction of the issue relative to the previous window. */
export type ErrorIssueDelta = "new" | "regressing" | "declining" | null;

export type ErrorIssuePlatform =
	| "web"
	| "ios"
	| "android"
	| "react-native"
	| "server";

/** Range selector for the Errors page; drives in-window counts + delta. */
export type ErrorIssueRange = "24h" | "seven-days" | "two-weeks" | "one-month";

export type ErrorIssueResource = {
	id: string;
	title: string;
	/** Server-computed canonical fingerprint (kept so clients can display it). */
	fingerprint: string;
	platform: ErrorIssuePlatform;
	level: ErrorIssueLevel;
	status: ErrorIssueStatus;
	/** Occurrence count in the selected range. */
	count: number;
	/** Distinct users/people affected in the selected range. */
	users: number;
	delta: ErrorIssueDelta;
	/** Normalized first/last occurrence time (epoch ms). */
	firstSeen: number;
	lastSeen: number;
	/** Stable top frame location, e.g. "lib/tree.ts:203". */
	location?: string;
};

export type ErrorIssueStateRequest = {
	status: ErrorIssueStatus;
};

/** A sanitized, URL-cleaned stack frame from a persisted occurrence. */
export type ErrorStackFrame = {
	file: string | null;
	function?: string;
	line: number | null;
	column: number | null;
	inApp: boolean;
};

/**
 * Bounded one-exception summary for an occurrence inside an issue detail.
 * Worst case this is the sanitized exception type/message plus the first 12
 * frames of the top exception — never raw secrets, cookies, bodies, or
 * headers (those are stripped at ingestion, before persistence).
 */
export type ErrorOccurrenceSummary = {
	id: string;
	occurredAt: number;
	receivedAt: number;
	level: ErrorIssueLevel;
	handled: boolean;
	release?: string;
	environment?: string;
	anonymousId?: string;
	language?: string;
	exception: {
		type: string;
		message?: string;
		frames: Array<ErrorStackFrame>;
		hasCause: boolean;
	};
	tagsCount: number;
	extrasCount: number;
	breadcrumbsCount: number;
	/** Sanitized tag map (string values, bounded, redacted) — for UI, not just count. */
	tags?: Record<string, string>;
	/** Sanitized extras map (bounded, redacted) — for UI. */
	extras?: Record<string, unknown>;
};

export type ErrorIssueActivityAction = "resolved" | "ignored" | "reopened";

/** One auditable, user-initiated issue state change. */
export type ErrorIssueActivityItem = {
	id: string;
	action: ErrorIssueActivityAction;
	priorState: ErrorIssueStatus;
	newState: ErrorIssueStatus;
	actorType: "member" | "system";
	actorId?: string;
	timestamp: number;
	note?: string;
};

/**
 * Issue detail (task-15 slice 4): the windowed list resource plus a bounded
 * page of sanitized occurrence summaries, workflow history, and safe
 * all-time aggregate counts. Occurrence ids are unguessable UUIDs reached
 * only through an authorized (project, issue) parent — there is no occurrence
 * endpoint, so nothing is globally enumerable.
 */
export type ErrorIssueDetailResource = {
	issue: ErrorIssueResource;
	occurrences: Array<ErrorOccurrenceSummary>;
	hasMoreOccurrences: boolean;
	activity: Array<ErrorIssueActivityItem>;
	occurrenceCountAll: number;
	usersAffectedAll: number;
	firstRelease?: string;
	lastRelease?: string;
};

export * from "./webAnalytics";
export * from "./mobileAnalytics";
