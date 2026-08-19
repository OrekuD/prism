/**
 * POST /api/v1/errors/ingest (task-15 slice 1) — the versioned, bounded
 * error batch API. Project/source/platform/key-class are derived from the
 * authenticated source key (AnalyticsMiddleware); client payload fields
 * can never override them. Per-item outcomes preserve submitted order and
 * never echo payload values.
 *
 * Flow: bounded stream read → envelope validation → server-source key
 * check → per-project quota → per-item validation + sanitization +
 * server-side fingerprinting → ONE atomic persistence transaction.
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import type { Context } from "hono";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import {
	ErrorIngestRepository,
	type ErrorPersistItem,
} from "../repositories/ErrorIngestRepository.js";
import { RateLimiter } from "../utils/RateLimiter.js";
import {
	FINGERPRINT_VERSION,
	fingerprintV1,
	issueIdFor,
} from "../utils/errorFingerprint.js";
import { ERROR_INGEST_LIMITS } from "../utils/errorIngestLimits.js";
import {
	parseErrorEnvelope,
	validateErrorItem,
} from "../utils/errorIngestValidation.js";
import { sanitizeErrorPayload } from "../utils/errorSanitize.js";
import { utf8Length } from "../utils/ingestValidation.js";
import { readBoundedBody } from "../utils/readBoundedBody.js";

config();

/**
 * Per-project error quota (events-weighted sibling of the analytics
 * quota): bounds ERROR ITEMS per project per minute so a batch cannot
 * multiply the request allowance. Env-overridable default.
 */
const ERROR_QUOTA_PER_MINUTE =
	Number(process.env.ANALYTICS_ERROR_RATE_LIMIT) || 1_000;
export const errorLimiter = new RateLimiter(60_000, ERROR_QUOTA_PER_MINUTE);

/** Coarse envelope-level error body — never echoes payloads or keys. */
interface ErrorIngestErrorBody {
	readonly ok: false;
	readonly error: { readonly code: string; readonly message: string };
}

function ingestError(code: string, message: string): ErrorIngestErrorBody {
	return { ok: false, error: { code, message } };
}

/** Result of one submitted item (submitted order preserved). */
export type ErrorItemResult = {
	index: number;
	id: string;
	status: "accepted" | "rejected";
	reason?: string;
	/** True when the client event id was already stored (idempotent retry). */
	duplicate?: boolean;
};

/** The client id of a rejected item, bounded and non-disclosing. */
function clientIdOf(raw: unknown): string {
	if (typeof raw === "object" && raw !== null) {
		const id = (raw as { id?: unknown }).id;
		if (typeof id === "string") {
			return id.slice(0, ERROR_INGEST_LIMITS.maxClientEventIdLength);
		}
	}
	return "";
}

export class ErrorIngestController {
	public static async ingest(ctx: Context) {
		// Content type + cheap Content-Length precheck BEFORE streaming.
		const contentType = ctx.req.header("content-type") ?? "";
		if (!contentType.toLowerCase().includes("application/json")) {
			return ctx.json(
				ingestError(
					"invalid-envelope",
					"content-type must be application/json",
				),
				400,
			);
		}
		const contentLength = Number(ctx.req.header("content-length") ?? "0");
		if (
			Number.isFinite(contentLength) &&
			contentLength > ERROR_INGEST_LIMITS.maxBatchBytes
		) {
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}

		// The REAL enforcement: bounded streaming read (never full buffering).
		const read = await readBoundedBody(
			ctx.req.raw.body,
			ERROR_INGEST_LIMITS.maxBatchBytes,
		);
		if (!read.ok) {
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}
		if (utf8Length(read.body) > ERROR_INGEST_LIMITS.maxBatchBytes) {
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}

		const parsed = parseErrorEnvelope(read.body);
		if (!parsed.ok) {
			return ctx.json(
				ingestError(
					parsed.reason,
					parsed.reason === "unsupported-schema"
						? "unsupported envelope schema version"
						: "error batch envelope is invalid",
				),
				400,
			);
		}

		// Trusted source context comes from the key, never from the payload.
		const projectId = ctx.get("projectId") ?? "";
		const sourceId = ctx.get("sourceId") ?? "";
		const platform = ctx.get("platform") ?? "";
		const keyType = ctx.get("keyType") ?? "";

		// A server source requires its secret source key (task-15 contract).
		// Non-disclosing: same code as any other auth failure.
		if (platform === "server" && keyType !== "secret") {
			return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
		}

		// Per-project item quota before validation work (abuse protection).
		const { allowed, retryAfterSeconds } = errorLimiter.hit(
			projectId,
			Math.max(parsed.errors.length, 1),
		);
		if (!allowed) {
			ctx.header("Retry-After", String(retryAfterSeconds));
			return ctx.json(ingestError("rate-limited", "error quota exceeded"), 429);
		}

		// Validate + sanitize + fingerprint the COMPLETE batch before any
		// write starts: rejected items never enter the transaction.
		const results: Array<ErrorItemResult | null> = new Array(
			parsed.errors.length,
		).fill(null);
		const items: ErrorPersistItem[] = [];
		const receivedAt = Date.now();

		for (let index = 0; index < parsed.errors.length; index += 1) {
			const raw = parsed.errors[index];
			const validation = validateErrorItem(raw);
			if (!validation.ok) {
				results[index] = {
					index,
					id: clientIdOf(raw),
					status: "rejected",
					reason: validation.reason,
				};
				continue;
			}
			const item = validation.item;
			const fingerprint = fingerprintV1(item.exception);
			const sanitized = sanitizeErrorPayload(item);
			items.push({
				index,
				occurrenceId: randomUUID(),
				clientEventId: item.id,
				issueId: issueIdFor(projectId, platform, fingerprint),
				projectId,
				sourceId,
				platform,
				level: item.level,
				handled: item.handled,
				occurredAt: item.occurredAt,
				receivedAt,
				release: item.release,
				environment: item.environment,
				anonymousId: item.anonymousId,
				fingerprintVersion: FINGERPRINT_VERSION,
				fingerprint,
				title: sanitized.title,
				...(sanitized.location !== undefined
					? { location: sanitized.location }
					: {}),
				payload: sanitized.payload,
			});
			results[index] = { index, id: item.id, status: "accepted" };
		}

		try {
			const outcome = await new ErrorIngestRepository().persistBatch(items);
			for (const { index, duplicate } of outcome) {
				const result = results[index];
				if (result && duplicate) {
					result.status = "accepted";
					result.duplicate = true;
				}
			}
		} catch {
			return ctx.json(
				ingestError("internal", "could not persist the error batch"),
				500,
			);
		}

		return ctx.json(
			{
				ok: true,
				results: results.filter(
					(result): result is ErrorItemResult => result !== null,
				),
			},
			200,
		);
	}
}
