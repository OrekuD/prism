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
};

/**
 * v2 event resource: properties are DECODED at the API boundary into a
 * typed JSON value (never a JSON string the dashboard prints verbatim).
 */
export type EventResource = {
	id: string;
	sessionId: string | null;
	projectId: string;
	name: string;
	properties: Record<string, unknown> | null;
	occurredAt: number;
	receivedAt: number;
	schemaVersion: number;
};

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
