/**
 * Server-owned runtime validation for POST /api/v1/errors/ingest
 * (task-15 slice 1). TypeScript types are not a trust boundary: every
 * field is validated at runtime against the frozen limits. Rejection is
 * per item with coarse reason codes; envelope-level failures use coarse
 * error codes. Never echo submitted keys or values.
 */

import { z } from "zod";
import {
	ERROR_INGEST_LIMITS,
	type ErrorIngestRejectReason,
} from "./errorIngestLimits.js";

const MAX = ERROR_INGEST_LIMITS;

const boundedString = (max: number) => z.string().trim().min(1).max(max);

const frameSchema = z
	.object({
		file: z.string().max(MAX.maxUrlLength).optional(),
		function: z.string().max(MAX.maxTypeLength).optional(),
		line: z.number().int().finite().optional(),
		column: z.number().int().finite().optional(),
		inApp: z.boolean().optional(),
	})
	.strict();

/**
 * Exception chain with a bounded depth: the top exception is typed, its
 * `cause` is typed, and anything deeper passes as opaque (the sanitizer
 * truncates the persisted chain to maxExceptionChain).
 */
const causeSchema = z
	.object({
		type: boundedString(MAX.maxTypeLength),
		message: z.string().max(MAX.maxMessageLength).optional(),
		frames: z.array(frameSchema).max(MAX.maxFramesPerException).optional(),
		cause: z.unknown().optional(),
	})
	.strict();

const exceptionSchema = z
	.object({
		type: boundedString(MAX.maxTypeLength),
		message: z.string().max(MAX.maxMessageLength).optional(),
		frames: z.array(frameSchema).max(MAX.maxFramesPerException).optional(),
		cause: causeSchema.optional(),
	})
	.strict();

const contextSchema = z
	.object({
		tags: z
			.record(
				z.string().max(MAX.maxContextKeyLength),
				z.union([z.string(), z.number(), z.boolean()]),
			)
			.refine((value) => Object.keys(value).length <= MAX.maxContextEntries, {
				message: "too many tags",
			})
			.optional(),
		extras: z
			.record(z.string().max(MAX.maxContextKeyLength), z.unknown())
			.refine((value) => Object.keys(value).length <= MAX.maxContextEntries, {
				message: "too many extras",
			})
			.optional(),
	})
	.strict();

const breadcrumbSchema = z
	.object({
		timestamp: z.number().finite().optional(),
		type: z.string().max(64).optional(),
		message: z.string().max(MAX.maxBreadcrumbMessageLength).optional(),
		level: z.enum(["debug", "info", "warning", "error"]).optional(),
	})
	.strict();

const errorItemSchema = z
	.object({
		id: boundedString(MAX.maxClientEventIdLength),
		occurredAt: z.number().finite(),
		level: z.enum(["error", "warning"]),
		handled: z.boolean().optional(),
		exception: exceptionSchema,
		release: z.string().max(MAX.maxReleaseLength).optional(),
		environment: z.string().max(64).optional(),
		context: contextSchema.optional(),
		breadcrumbs: z.array(breadcrumbSchema).max(MAX.maxBreadcrumbs).optional(),
		anonymousId: z.string().max(MAX.maxAnonymousIdLength).optional(),
	})
	.strict();

const envelopeSchema = z
	.object({
		schemaVersion: z.literal(1),
		sentAt: z.number().finite().optional(),
		sdk: z
			.object({
				name: z.string().max(128).optional(),
				version: z.string().max(64).optional(),
			})
			.optional(),
		errors: z.array(z.unknown()).max(MAX.maxErrorsPerBatch),
	})
	.strict();

/** Raw (untrusted) error item as submitted by the client. */
export type RawErrorItem = {
	id?: unknown;
	occurredAt?: unknown;
	level?: unknown;
	handled?: unknown;
	exception?: unknown;
	release?: unknown;
	environment?: unknown;
	context?: unknown;
	breadcrumbs?: unknown;
	anonymousId?: unknown;
};

/** Validated (not yet sanitized) item ready for sanitize + fingerprint. */
export interface ValidatedErrorItem {
	id: string;
	occurredAt: number;
	level: "error" | "warning";
	handled: boolean;
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
	release?: string;
	environment?: string;
	context?: {
		tags?: Record<string, unknown>;
		extras?: Record<string, unknown>;
	};
	breadcrumbs?: Array<Record<string, unknown>>;
	anonymousId?: string;
}

export type ErrorItemValidationResult =
	| { readonly ok: true; readonly item: ValidatedErrorItem }
	| { readonly ok: false; readonly reason: ErrorIngestRejectReason };

/** Parse the batch envelope; returns null for malformed JSON. */
export function parseErrorEnvelope(
	body: string,
):
	| { ok: true; errors: unknown[]; sdk?: { name?: string; version?: string } }
	| { ok: false; reason: "invalid-envelope" | "unsupported-schema" } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return { ok: false, reason: "invalid-envelope" };
	}
	const envelope = envelopeSchema.safeParse(parsed);
	if (!envelope.success) {
		// Distinguish schema mismatch (wrong version) from shape failures.
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"schemaVersion" in parsed &&
			(parsed as { schemaVersion?: unknown }).schemaVersion !== 1
		) {
			return { ok: false, reason: "unsupported-schema" };
		}
		return { ok: false, reason: "invalid-envelope" };
	}
	return { ok: true, errors: envelope.data.errors, sdk: envelope.data.sdk };
}

/** Validate one item; returns the validated item or a coarse reason. */
export function validateErrorItem(raw: unknown): ErrorItemValidationResult {
	const parsed = errorItemSchema.safeParse(raw);
	if (!parsed.success) {
		return { ok: false, reason: rejectReasonFor(parsed.error) };
	}
	const item = parsed.data;
	return {
		ok: true,
		item: {
			id: item.id,
			occurredAt: item.occurredAt,
			level: item.level,
			handled: item.handled ?? false,
			exception: item.exception as ValidatedErrorItem["exception"],
			release: item.release,
			environment: item.environment,
			context: item.context as ValidatedErrorItem["context"],
			breadcrumbs: item.breadcrumbs,
			anonymousId: item.anonymousId,
		},
	};
}

/** Map a zod issue to the coarsest honest reason code. */
function rejectReasonFor(error: z.ZodError): ErrorIngestRejectReason {
	const path = error.issues.map((issue) => issue.path.join(".")).join(",");
	if (path.includes("id")) return "invalid-id";
	if (path.includes("occurredAt")) return "invalid-timestamp";
	if (path.includes("level")) return "invalid-level";
	if (path.includes("exception")) return "invalid-exception";
	if (path.includes("context")) return "invalid-context";
	if (path.includes("breadcrumbs")) return "invalid-breadcrumbs";
	if (
		path.includes("anonymousId") ||
		path.includes("release") ||
		path.includes("environment")
	) {
		return "invalid-payload";
	}
	return "invalid-payload";
}
