/**
 * Error payload sanitization (task-15 slice 1 — privacy defaults are
 * stricter than analytics defaults).
 *
 * - Recursively redacts conservative sensitive keys (credentials, tokens,
 *   session ids, e-mail-like identifiers, payment fields) in tags/extras
 *   BEFORE fingerprinting, persistence, logs, or diagnostics.
 * - Sanitizes URL fields to origin + path (query + fragment removed,
 *   userinfo stripped) unless an operator later opts into an allowlist.
 * - Bounds everything: message length, exception chain depth, frames,
 *   context entries, breadcrumbs. Oversized items are truncated, not
 *   dropped — except where truncation would hide an attack (rejected by
 *   the validation layer before sanitization runs).
 *
 * This is a defense-in-depth boundary: the SDK slice applies the same
 * policy client-side, but direct HTTP clients never bypass it here.
 */

import {
	ERROR_INGEST_LIMITS,
	type ErrorIngestRejectReason,
} from "./errorIngestLimits.js";

export const REDACTED = "[REDACTED]";

/** Conservative key denylist (documented limits, not perfect PII detection). */
const SENSITIVE_KEY =
	/(password|passwd|pwd|secret|token|auth|api[_-]?key|access[_-]?key|private[_-]?key|session|session[_-]?id|cookie|credential|credit[_-]?card|ccv|cvv|iban|routing|ssn|social[_-]?security|bearer|refresh[_-]?token|jwt|email|e-mail|phone|phone[_-]?number)/i;

export type RedactOptions = {
	maxDepth: number;
	maxStringLength: number;
};

/**
 * Recursively redact sensitive keys and bound string lengths. Arrays are
 * walked element-wise; objects recurse; scalars are length-truncated.
 * Unknown shapes degrade to "[REDACTED]" rather than leaking.
 */
export function redactAndBound(
	value: unknown,
	options: RedactOptions,
	depth = 0,
): unknown {
	if (depth > options.maxDepth) return REDACTED;
	if (typeof value === "string") {
		return value.length > options.maxStringLength
			? value.slice(0, options.maxStringLength)
			: value;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactAndBound(entry, options, depth + 1));
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (SENSITIVE_KEY.test(key)) {
				out[key] = REDACTED;
			} else {
				out[key] = redactAndBound(entry, options, depth + 1);
			}
		}
		return out;
	}
	return REDACTED;
}

/**
 * Sanitize a URL to origin + path: strip userinfo, query and fragment.
 * Returns the raw value (truncated) when it is not a valid URL, so a
 * malicious or malformed frame location is still bounded and recorded.
 */
export function sanitizeUrl(raw: string): string {
	const value = raw.trim();
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		const cleaned = url.origin + url.pathname;
		return cleaned.length > ERROR_INGEST_LIMITS.maxUrlLength
			? cleaned.slice(0, ERROR_INGEST_LIMITS.maxUrlLength)
			: cleaned;
	} catch {
		return value.length > ERROR_INGEST_LIMITS.maxUrlLength
			? value.slice(0, ERROR_INGEST_LIMITS.maxUrlLength)
			: value;
	}
}

/** Bound a frame record (file URL sanitized, identifiers bounded). */
export function sanitizeFrame(frame: {
	file?: unknown;
	function?: unknown;
	line?: unknown;
	column?: unknown;
	inApp?: unknown;
}) {
	return {
		file: typeof frame.file === "string" ? sanitizeUrl(frame.file) : null,
		function:
			typeof frame.function === "string"
				? frame.function.slice(0, ERROR_INGEST_LIMITS.maxTypeLength)
				: null,
		line: typeof frame.line === "number" ? frame.line : null,
		column: typeof frame.column === "number" ? frame.column : null,
		inApp: frame.inApp === true,
	};
}

/**
 * Build the persisted, sanitized payload for one validated item: the
 * exception chain is bounded and URL-sanitized, context is redacted and
 * bounded, breadcrumbs are bounded. Returns the JSON payload plus the
 * issue title/location derived from the SANITIZED exception (the same
 * values the fingerprint uses, so grouping is never fed raw input).
 */
export function sanitizeErrorPayload(item: {
	exception: {
		type: string;
		message?: string;
		frames?: Array<{
			file?: string;
			function?: string;
			line?: number;
			column?: number;
			inApp?: boolean;
		}>;
		cause?: unknown;
	};
	handled: boolean;
	release?: string;
	environment?: string;
	language?: string;
	context?: {
		tags?: Record<string, unknown>;
		extras?: Record<string, unknown>;
	};
	breadcrumbs?: Array<Record<string, unknown>>;
}): {
	payload: string;
	title: string;
	location?: string;
} {
	const chainDepth = ERROR_INGEST_LIMITS.maxExceptionChain;

	const walk = (
		exception: (typeof item)["exception"],
		depth: number,
	): unknown => {
		if (depth > chainDepth) return undefined;
		const frames = (exception.frames ?? [])
			.slice(0, ERROR_INGEST_LIMITS.maxFramesPerException)
			.map((frame) => sanitizeFrame(frame));
		const next: Record<string, unknown> = {
			type: exception.type,
			...(exception.message !== undefined
				? {
						message:
							exception.message.length > ERROR_INGEST_LIMITS.maxMessageLength
								? exception.message.slice(
										0,
										ERROR_INGEST_LIMITS.maxMessageLength,
									)
								: exception.message,
					}
				: {}),
			frames,
		};
		const cause = exception.cause as
			| { type?: string; message?: string; frames?: unknown[]; cause?: unknown }
			| undefined;
		if (cause && typeof cause === "object" && typeof cause.type === "string") {
			next.cause = walk(
				{
					type: cause.type,
					message:
						typeof cause.message === "string" ? cause.message : undefined,
					frames: Array.isArray(cause.frames)
						? (cause.frames as Array<{
								file?: string;
								function?: string;
								line?: number;
								column?: number;
								inApp?: boolean;
							}>)
						: [],
					cause: cause.cause,
				},
				depth + 1,
			);
		}
		return next;
	};

	const firstFrame = item.exception.frames?.[0];
	const location =
		typeof firstFrame?.file === "string" && firstFrame.file.trim() !== ""
			? `${sanitizeUrl(firstFrame.file)}${
					typeof firstFrame.line === "number" ? `:${firstFrame.line}` : ""
				}`
			: undefined;

	const message = item.exception.message ?? "";
	const title =
		message.trim() === ""
			? item.exception.type
			: `${item.exception.type}: ${message.slice(0, 200)}`;

	const payload = {
		exception: walk(item.exception, 1),
		handled: item.handled,
		...(item.release !== undefined ? { release: item.release } : {}),
		...(item.environment !== undefined
			? { environment: item.environment }
			: {}),
		...(item.language !== undefined
			? { language: item.language.slice(0, 32).toLowerCase() }
			: {}),
		context:
			item.context?.tags || item.context?.extras
				? {
						tags: item.context?.tags
							? redactAndBound(item.context.tags, {
									maxDepth: 3,
									maxStringLength: ERROR_INGEST_LIMITS.maxContextStringLength,
								})
							: undefined,
						extras: item.context?.extras
							? redactAndBound(item.context.extras, {
									maxDepth: 3,
									maxStringLength: ERROR_INGEST_LIMITS.maxContextStringLength,
								})
							: undefined,
					}
				: undefined,
		breadcrumbs: (item.breadcrumbs ?? [])
			.slice(0, ERROR_INGEST_LIMITS.maxBreadcrumbs)
			.map((breadcrumb) => ({
				...breadcrumb,
				...(typeof breadcrumb.message === "string"
					? {
							message:
								breadcrumb.message.length >
								ERROR_INGEST_LIMITS.maxBreadcrumbMessageLength
									? breadcrumb.message.slice(
											0,
											ERROR_INGEST_LIMITS.maxBreadcrumbMessageLength,
										)
									: breadcrumb.message,
						}
					: {}),
			})),
	};

	return {
		payload: JSON.stringify(payload),
		title: title.slice(0, 300),
		...(location !== undefined ? { location } : {}),
	};
}

export type SanitizeResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: ErrorIngestRejectReason };
