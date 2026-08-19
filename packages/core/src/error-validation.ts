import type { JsonObject } from "./contract";
import type {
	ErrorBreadcrumb,
	ErrorFrame,
	ErrorLevel,
	ErrorReport,
	ErrorReportInput,
} from "./error-contract";
import { ERROR_LIMITS } from "./error-limits";
import { sanitizeProperties, validateJsonValue } from "./validation";

/**
 * Client-owned validation + normalization for error reports
 * (task-15 slice 3). TS types are not a trust boundary: every field the
 * SDK accepts is bounded at acceptance against the mirrored limits. The
 * SERVER re-validates and re-sanitizes regardless — this is the SDK
 * never-producing-oversized-items guarantee, not the security boundary.
 *
 * Rules:
 * - Structurally invalid CALLER input THROWS a specific Error (mirrors the
 *   analytics client contract): missing exception, non-string type,
 *   non-JSON extras/tags, non-finite frame line/column.
 * - COSMETIC overruns (message length, frame count, context entries) are
 *   bounded by truncation/capping, not by throwing — a logged exception
 *   with a 2 KB message must still report.
 * - Credentials in context extras/tags are redacted with the SAME
 *   sanitizer as analytics properties.
 */

const DENY_PATTERN =
	/(password|passcode|token|authorization|cookie|secret|api[_-]?key|credit[_-]?card|cvv|cvc|card[_-]?number|session)/i;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The build shape for attaching shared context: top-level fields are
 * writable during assembly and the result is returned as the immutable
 * ErrorReport contract.
 */
type MutableErrorReport = {
	-readonly [K in keyof ErrorReport]: ErrorReport[K];
} & {
	exception: {
		type: string;
		message?: string;
		frames?: ErrorFrame[];
		cause?: unknown;
	};
	context?: {
		tags?: Record<string, string | number | boolean>;
		extras?: Record<string, unknown>;
	};
	breadcrumbs?: ErrorBreadcrumb[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function checkSafeKey(key: string): void {
	if (DANGEROUS_KEYS.has(key)) {
		throw new Error("error context contains a dangerous key");
	}
}

function boundedString(value: string, max: number): string {
	return value.trim().slice(0, max);
}

/** Validate + bound a single frame (may have no file/line — that is honest). */
function normalizeFrame(raw: unknown): ErrorFrame | null {
	if (!isPlainObject(raw)) return null;
	const frame: ErrorFrame = {};
	if (typeof raw.file === "string" && raw.file.trim().length > 0) {
		frame.file = boundedString(raw.file.trim(), ERROR_LIMITS.maxUrlLength);
	}
	if (typeof raw.function === "string") {
		const fn = raw.function.trim().slice(0, ERROR_LIMITS.maxTypeLength);
		if (fn.length > 0) frame.function = fn;
	}
	if (typeof raw.line === "number" && Number.isFinite(raw.line)) {
		frame.line = Math.trunc(raw.line);
	}
	if (typeof raw.column === "number" && Number.isFinite(raw.column)) {
		frame.column = Math.trunc(raw.column);
	}
	if (typeof raw.inApp === "boolean") frame.inApp = raw.inApp;
	return frame;
}

/** Truncate a frame list to the ceiling (top frames first). */
function normalizeFrames(raw: unknown): ErrorFrame[] {
	if (!Array.isArray(raw)) return [];
	const frames: ErrorFrame[] = [];
	for (const entry of raw) {
		if (frames.length >= ERROR_LIMITS.maxFramesPerException) break;
		const frame = normalizeFrame(entry);
		if (frame) frames.push(frame);
	}
	return frames;
}

/** Flatten a bounded top-level exception (+ typed cause chain). */
function normalizeException(
	raw: unknown,
	depth: number,
): { type: string; message?: string; frames?: ErrorFrame[]; cause?: unknown } {
	if (!isPlainObject(raw)) throw new Error("exception must be an object");
	const type = raw.type;
	if (typeof type !== "string" || type.trim().length === 0) {
		throw new Error("exception.type is required");
	}
	const exception: {
		type: string;
		message?: string;
		frames?: ErrorFrame[];
		cause?: unknown;
	} = {
		type: boundedString(type, ERROR_LIMITS.maxTypeLength),
	};
	if (typeof raw.message === "string") {
		const message = raw.message.trim();
		if (message.length > 0) {
			exception.message = boundedString(message, ERROR_LIMITS.maxMessageLength);
		}
	}
	if (Array.isArray(raw.frames)) {
		const frames = normalizeFrames(raw.frames);
		if (frames.length > 0) exception.frames = frames;
	}
	if (raw.cause !== undefined && raw.cause !== null) {
		if (depth + 1 >= ERROR_LIMITS.maxExceptionChain) {
			// Deeper than the persisted chain: keep it as opaque sanitized JSON.
			exception.cause = sanitizeOpaque(raw.cause);
		} else {
			try {
				exception.cause = normalizeException(raw.cause, depth + 1);
			} catch {
				// A non-exception-shaped cause is preserved as opaque JSON.
				exception.cause = sanitizeOpaque(raw.cause);
			}
		}
	}
	return exception;
}

/** Sanitize an arbitrary cause/extra value with credentials redacted. */
function sanitizeOpaque(value: unknown): Record<string, unknown> | unknown {
	if (isPlainObject(value)) {
		const validation = validateJsonValue(value, {
			maxDepth: 12,
			maxStringLength: ERROR_LIMITS.maxContextStringLength,
			maxKeys: ERROR_LIMITS.maxContextEntries,
			maxArrayElements: ERROR_LIMITS.maxContextEntries,
		});
		if (!validation.ok) {
			return { __value: boundedString(String(value), 128) };
		}
		return sanitizeProperties(value as unknown as JsonObject, {
			maxDepth: 12,
			maxStringLength: ERROR_LIMITS.maxContextStringLength,
		});
	}
	return value;
}

function normalizeContext(raw: unknown):
	| {
			tags?: Record<string, string | number | boolean>;
			extras?: Record<string, unknown>;
	  }
	| undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!isPlainObject(raw)) throw new Error("error context must be an object");
	const tags: Record<string, string | number | boolean> = {};
	const extras: Record<string, unknown> = {};

	const rawTags = raw.tags;
	if (rawTags !== undefined) {
		if (!isPlainObject(rawTags))
			throw new Error("context.tags must be an object");
		for (const [key, value] of Object.entries(rawTags)) {
			checkSafeKey(key);
			if (key.length === 0 || key.length > ERROR_LIMITS.maxContextKeyLength)
				continue;
			if (
				typeof value === "string" ||
				typeof value === "number" ||
				typeof value === "boolean"
			) {
				tags[key.slice(0, ERROR_LIMITS.maxContextKeyLength)] =
					typeof value === "string"
						? value.slice(0, ERROR_LIMITS.maxContextStringLength)
						: value;
			}
		}
	}

	const rawExtras = raw.extras;
	if (rawExtras !== undefined) {
		if (!isPlainObject(rawExtras))
			throw new Error("context.extras must be an object");
		for (const [key, value] of Object.entries(rawExtras)) {
			checkSafeKey(key);
			if (key.length === 0 || key.length > ERROR_LIMITS.maxContextKeyLength)
				continue;
			const boundedKey = key.slice(0, ERROR_LIMITS.maxContextKeyLength);
			if (DENY_PATTERN.test(key)) {
				extras[boundedKey] = "[REDACTED]";
				continue;
			}
			const validation = validateJsonValue(value, {
				maxDepth: 12,
				maxStringLength: ERROR_LIMITS.maxContextStringLength,
				maxKeys: ERROR_LIMITS.maxContextEntries,
				maxArrayElements: ERROR_LIMITS.maxContextEntries,
			});
			if (!validation.ok) {
				extras[boundedKey] = boundedString(String(value ?? ""), 128);
				continue;
			}
			if (isPlainObject(value)) {
				extras[boundedKey] = sanitizeProperties(
					value as unknown as JsonObject,
					{
						maxDepth: 12,
						maxStringLength: ERROR_LIMITS.maxContextStringLength,
					},
				);
			} else {
				extras[boundedKey] = value;
			}
		}
	}

	const result: {
		tags?: Record<string, string | number | boolean>;
		extras?: Record<string, unknown>;
	} = {};
	if (Object.keys(tags).length > 0) result.tags = tags;
	if (Object.keys(extras).length > 0) result.extras = extras;
	return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeBreadcrumbs(raw: unknown): ErrorBreadcrumb[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw))
		throw new Error("error breadcrumbs must be an array");
	const crumbs: ErrorBreadcrumb[] = [];
	for (const entry of raw) {
		if (crumbs.length >= ERROR_LIMITS.maxBreadcrumbs) break;
		if (!isPlainObject(entry)) continue;
		const crumb: ErrorBreadcrumb = {};
		if (
			typeof entry.timestamp === "number" &&
			Number.isFinite(entry.timestamp)
		) {
			crumb.timestamp = entry.timestamp;
		}
		if (typeof entry.type === "string" && entry.type.length > 0) {
			crumb.type = entry.type.slice(0, 64);
		}
		if (typeof entry.message === "string" && entry.message.trim().length > 0) {
			crumb.message = entry.message
				.trim()
				.slice(0, ERROR_LIMITS.maxBreadcrumbMessageLength);
		}
		if (
			typeof entry.level === "string" &&
			["debug", "info", "warning", "error"].includes(entry.level)
		) {
			crumb.level = entry.level as ErrorBreadcrumb["level"];
		}
		crumbs.push(crumb);
	}
	return crumbs.length > 0 ? crumbs : undefined;
}

/**
 * Validate + normalize caller input into the immutable bounded report.
 * Throws a specific Error for structurally invalid input. The report is
 * produced WITHOUT shared context (attached later, consent-gated).
 */
export function normalizeErrorReport(
	input: ErrorReportInput,
	id: string,
	occurredAt: number,
): ErrorReport {
	if (!isPlainObject(input)) {
		throw new Error("error report must be an object");
	}
	if (input.exception === undefined || input.exception === null) {
		throw new Error("error report requires an exception");
	}
	const exception = normalizeException(input.exception, 0);
	const level: ErrorLevel = input.level === "warning" ? "warning" : "error";
	const context = normalizeContext(input.context);
	const breadcrumbs = normalizeBreadcrumbs(input.breadcrumbs);
	return {
		id,
		occurredAt,
		level,
		handled: input.handled ?? false,
		exception,
		...(typeof input.release === "string" && input.release.trim().length > 0
			? {
					release: input.release.trim().slice(0, ERROR_LIMITS.maxReleaseLength),
				}
			: {}),
		...(typeof input.environment === "string" &&
		input.environment.trim().length > 0
			? {
					environment: input.environment
						.trim()
						.slice(0, ERROR_LIMITS.maxEnvironmentLength),
				}
			: {}),
		...(context ? { context } : {}),
		...(breadcrumbs ? { breadcrumbs } : {}),
	} as ErrorReport;
}

/** Attach sanitized shared context — ONLY used when consent is granted. */
export function attachSharedContext(
	report: ErrorReport,
	shared: {
		anonymousId?: string | null;
		sessionId?: string | null;
		userId?: string | null;
		globalProperties?: Record<string, unknown>;
	},
	maxDepth: number,
): ErrorReport {
	const copy = { ...report } as MutableErrorReport;
	if (typeof shared.anonymousId === "string" && shared.anonymousId.length > 0) {
		copy.anonymousId = shared.anonymousId.slice(
			0,
			ERROR_LIMITS.maxAnonymousIdLength,
		);
	}
	if (typeof shared.sessionId === "string" && shared.sessionId.length > 0) {
		copy.sessionId = shared.sessionId.slice(
			0,
			ERROR_LIMITS.maxAnonymousIdLength,
		);
	}
	if (typeof shared.userId === "string" && shared.userId.length > 0) {
		copy.userId = shared.userId.slice(0, ERROR_LIMITS.maxAnonymousIdLength);
	}
	const globals = shared.globalProperties;
	if (globals && isPlainObject(globals)) {
		const validation = validateJsonValue(globals, {
			maxDepth,
			maxStringLength: ERROR_LIMITS.maxContextStringLength,
			maxKeys: ERROR_LIMITS.maxContextEntries,
			maxArrayElements: ERROR_LIMITS.maxContextEntries,
		});
		if (validation.ok) {
			const sanitized = sanitizeProperties(globals as unknown as JsonObject, {
				denyList: [],
				maxDepth,
				maxStringLength: ERROR_LIMITS.maxContextStringLength,
			}) as Record<string, unknown>;
			const reportExtras = copy.context?.extras ?? {};
			// Developer-supplied report extras WIN over globals (same precedence
			// as per-event properties over analytics globals).
			copy.context = {
				...copy.context,
				extras: { ...sanitized, ...reportExtras },
			};
		}
	}
	return copy;
}

/**
 * Serialize a report to the frozen wire item (schemaVersion 1). Drops
 * undefined optional fields so the JSON stays within the server's strict
 * schema.
 */
export function toWireErrorItem(
	report: Readonly<ErrorReport>,
): WireErrorItemLike {
	const item: WireErrorItemLike = {
		id: report.id,
		occurredAt: report.occurredAt,
		level: report.level,
		handled: report.handled,
		exception: report.exception as unknown as { type: string },
	};
	if (report.exception.message !== undefined) {
		(item.exception as { message?: string }).message = report.exception.message;
	}
	if (report.exception.frames && report.exception.frames.length > 0) {
		(item.exception as { frames?: ErrorFrame[] }).frames = [
			...report.exception.frames,
		];
	}
	if (report.exception.cause !== undefined) {
		(item.exception as { cause?: unknown }).cause = report.exception.cause;
	}
	if (report.release !== undefined) item.release = report.release;
	if (report.environment !== undefined) item.environment = report.environment;
	if (report.context && (report.context.tags || report.context.extras)) {
		item.context = {};
		if (report.context.tags) item.context.tags = { ...report.context.tags };
		if (report.context.extras) {
			item.context.extras = JSON.parse(
				JSON.stringify(report.context.extras),
			) as Record<string, unknown>;
		}
	}
	if (report.breadcrumbs && report.breadcrumbs.length > 0) {
		item.breadcrumbs = report.breadcrumbs.map((crumb) => ({ ...crumb }));
	}
	if (report.anonymousId !== undefined) item.anonymousId = report.anonymousId;
	return item;
}

type WireErrorItemLike = {
	id: string;
	occurredAt: number;
	level: ErrorLevel;
	handled: boolean;
	exception: { type: string } & Record<string, unknown>;
	release?: string;
	environment?: string;
	context?: {
		tags?: Record<string, string | number | boolean>;
		extras?: Record<string, unknown>;
	};
	breadcrumbs?: Array<Record<string, unknown>>;
	anonymousId?: string;
};
