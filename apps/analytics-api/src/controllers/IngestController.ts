import { randomUUID } from "node:crypto";
import {
	INGEST_LIMITS,
	type IngestResponseBody,
	type IngestResult,
	type JsonObject,
	sanitizeProperties,
} from "@prism-analytics/core";
import type { SessionResource } from "@prism-analytics/types";
import { config } from "dotenv";
import type { Context } from "hono";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import WebSocketManager from "../managers/WebSocketManager.js";
import { IngestRepository } from "../repositories/IngestRepository.js";
import { RateLimiter } from "../utils/RateLimiter.js";
import {
	personIdForUser,
	resolveEventPerson,
} from "../utils/identityResolution.js";
import {
	type ValidatedIdentityOp,
	validateIdentityOp,
} from "../utils/ingestValidation.js";
import {
	type ValidatedEvent,
	eventIdOf,
	parseBatchBody,
	utf8Length,
	validateEvent,
} from "../utils/ingestValidation.js";
import { logger } from "../utils/logger.js";
import { readBoundedBody } from "../utils/readBoundedBody.js";

config();

/**
 * Event-weighted abuse protection (task-9 §8): the per-IP request limiter
 * bounds REQUEST volume; this bounds EVENTS per project so batching cannot
 * multiply the effective ingestion allowance by the batch size. The quota
 * is a deliberate configured default (env-overridable).
 */
const EVENT_QUOTA_PER_MINUTE =
	Number(process.env.ANALYTICS_EVENT_RATE_LIMIT) || 10_000;
export const eventLimiter = new RateLimiter(60_000, EVENT_QUOTA_PER_MINUTE);

/** Coarse error envelope — never echoes payloads, keys, or values. */
interface IngestErrorBody {
	readonly ok: false;
	readonly error: { readonly code: string; readonly message: string };
}

export class IngestController {
	/**
	 * POST /api/v2/ingest — the versioned, idempotent batch ingestion API
	 * (ADR 0002 §2, task-9 §8). The project is derived from the authenticated
	 * write key; client-provided ownership fields are ignored. Persistence
	 * is atomic per request (one Turso write batch — review F6).
	 */
	/**
	 * Project-scoped realtime broadcast for an accepted session_started
	 * event. A failing socket never disrupts delivery to healthy clients
	 * (the WebSocketManager's safeSend handles that).
	 */
	private static emitSessionStarted(
		projectId: string,
		event: ValidatedEvent,
		receivedAt: number,
	): void {
		const message = JSON.stringify({
			type: "session-started",
			data: {
				session: buildSessionResource(event, projectId, receivedAt),
			},
		});
		WebSocketManager.emitToClient(projectId, message);
	}

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
			contentLength > INGEST_LIMITS.maxBatchBytes
		) {
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}

		// The REAL enforcement: bounded streaming read (never full buffering).
		const read = await readBoundedBody(
			ctx.req.raw.body,
			INGEST_LIMITS.maxBatchBytes,
		);
		if (!read.ok) {
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}
		if (utf8Length(read.body) > INGEST_LIMITS.maxBatchBytes) {
			// Defensive: decoded length must match the byte accounting.
			return ctx.json(
				ingestError("too-large", "request exceeds the byte limit"),
				413,
			);
		}

		const parsed = parseBatchBody(read.body);
		if (!parsed.ok) {
			return ctx.json(
				ingestError("invalid-envelope", "batch envelope is invalid"),
				400,
			);
		}

		// The project id is derived from the API key, never from the body.
		const projectId = ctx.get("projectId") ?? "";

		// Event-weighted quota first — a big batch must not dodge the limit.
		// Identity-only envelopes weight by their operation count (F2): a
		// request with no events still carries a positive cost.
		const ingestWeight =
			parsed.batch.events.length + (parsed.batch.identity?.length ?? 0);
		const { allowed, retryAfterSeconds } = eventLimiter.hit(
			projectId,
			Math.max(ingestWeight, 1),
		);
		if (!allowed) {
			ctx.header("Retry-After", String(retryAfterSeconds));
			return ctx.json(ingestError("rate-limited", "event quota exceeded"), 429);
		}

		// Validate + sanitize the COMPLETE batch before any write starts (F6):
		// rejected events never enter the transaction.
		const now = Date.now();
		// Positional results keep the response in SUBMITTED ORDER even though
		// rejected results are decided before the atomic persistence pass.
		const results: Array<IngestResult | null> = new Array(
			parsed.batch.events.length,
		).fill(null);
		const validEvents: Array<{ index: number; event: ValidatedEvent }> = [];

		for (let index = 0; index < parsed.batch.events.length; index += 1) {
			const raw = parsed.batch.events[index];
			const validation = validateEvent(raw, now);
			if (!validation.ok) {
				results[index] = {
					index,
					id: eventIdOf(raw),
					status: "rejected",
					reason: validation.reason,
				};
				continue;
			}
			const event = validation.event;
			// The SDK sanitizes; direct HTTP clients do not — sanitize on the
			// server too (defense in depth, same rules and limits as the core).
			// Context receives the SAME redaction policy as properties (F4).
			const sanitized = {
				...event,
				properties: sanitizeProperties(event.properties as JsonObject, {
					maxDepth: INGEST_LIMITS.maxPropertyDepth,
					maxStringLength: INGEST_LIMITS.maxStringLength,
				}),
				context: event.context
					? (sanitizeProperties(event.context as JsonObject, {
							maxDepth: INGEST_LIMITS.maxPropertyDepth,
							maxStringLength: INGEST_LIMITS.maxStringLength,
						}) as ValidatedEvent["context"])
					: undefined,
			};
			validEvents.push({ index, event: sanitized });
		}

		// Identity operations (task-10 §4): validated like events — rejected
		// ops never enter the transaction (review F8/F12): op ids are
		// deduplicated WITHIN the request; the idempotency read skips known
		// ops; guarded statements make the claim transactional (a duplicate
		// payload can never apply its side effects).
		type IngestOp = {
			index: number;
			op?: ValidatedIdentityOp;
			status?: string;
			reason?: string;
		};
		const validOps: IngestOp[] = [];
		const seenOpIds = new Set<string>();
		// R6-F3: iterate with the SOURCE index — every submitted identity entry
		// keeps its position, and malformed entries receive a coarse
		// per-operation rejection instead of vanishing.
		for (const [sourceIndex, raw] of (parsed.batch.identity ?? []).entries()) {
			const validation = validateIdentityOp(raw);
			if (!validation.ok) {
				logger.warn("analytics:ingest", "rejected identity op", {
					projectId,
				});
				validOps.push({
					index: sourceIndex,
					status: "rejected",
					reason: "invalid-op",
				});
				continue;
			}
			const op = validation.op;
			if (seenOpIds.has(op.opId)) {
				// R5-F3: a repeated opId in ONE request keeps its submitted index
				// and receives an explicit rejected outcome — it never disappears.
				logger.warn(
					"analytics:ingest",
					"duplicate identity op within request",
					{
						projectId,
					},
				);
				validOps.push({
					index: sourceIndex,
					op,
					status: "rejected",
					reason: "duplicate-op-id",
				});
				continue;
			}
			seenOpIds.add(op.opId);
			// F12: traits from DIRECT HTTP clients are sanitized server-side —
			// the same dangerous-key, strict-JSON, and credential-redaction
			// policy applied to event properties.
			const sanitizedOp: ValidatedIdentityOp = {
				...op,
				...(op.traits !== undefined
					? {
							traits: sanitizeProperties(op.traits as JsonObject, {
								maxDepth: INGEST_LIMITS.maxPropertyDepth,
								maxStringLength: INGEST_LIMITS.maxStringLength,
							}),
						}
					: {}),
			};
			validOps.push({
				index: sourceIndex,
				op: sanitizedOp,
			});
		}
		// F7 + R3-F3: durable link maps are loaded for EVERY distinct user and
		// anonymous ID in the batch — events and identity operations alike —
		// so a later event-only request with an already-linked anonymous ID
		// resolves to the same person. The identity-op outcomes are decided
		// AUTHORITATIVELY by the persistence transaction (R5-F1): the
		// claim's rowsAffected + the stored payload hash — never by this
		// pre-read alone.
		let externalLinks: Map<string, string> = new Map();
		let anonymousLinks: Map<string, string> = new Map();
		const replacementPersonIds: Map<string, string> = new Map();
		const batchUserIds = new Set<string>();
		const batchAnonIds = new Set<string>();
		for (const entry of validOps) {
			if (entry.status === "rejected" || !entry.op) continue; // never folded (R4-F4)
			batchUserIds.add(entry.op.userId);
			batchAnonIds.add(entry.op.anonymousId);
		}
		for (const entry of validEvents) {
			if (entry.event.userId) batchUserIds.add(entry.event.userId);
			if (entry.event.anonymousId) batchAnonIds.add(entry.event.anonymousId);
		}
		if (batchUserIds.size > 0 || batchAnonIds.size > 0) {
			const opUserIds = [...batchUserIds];
			const opAnonIds = [...batchAnonIds];
			const [links, anonLinks, deleted] = await Promise.all([
				TursoDatabaseManager.instance.execute({
					sql: `SELECT user_id, person_id FROM external_identities WHERE project_id = ? AND user_id IN (${opUserIds.map(() => "?").join(",")})`,
					args: [projectId, ...opUserIds],
				}),
				TursoDatabaseManager.instance.execute({
					sql: `SELECT anonymous_id, person_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id IN (${opAnonIds.map(() => "?").join(",")})`,
					args: [projectId, ...opAnonIds],
				}),
				TursoDatabaseManager.instance.execute({
					sql: `SELECT person_id FROM deleted_people WHERE project_id = ? AND person_id IN (${opUserIds.map(() => "?").join(",")})`,
					args: [
						projectId,
						...opUserIds.map((userId) => personIdForUser(projectId, userId)),
					],
				}),
			]);
			externalLinks = new Map(
				links.rows.map((row) => [
					String((row as { user_id?: unknown }).user_id ?? ""),
					String((row as { person_id?: unknown }).person_id ?? ""),
				]),
			);
			anonymousLinks = new Map(
				anonLinks.rows.map((row) => [
					String((row as { anonymous_id?: unknown }).anonymous_id ?? ""),
					String((row as { person_id?: unknown }).person_id ?? ""),
				]),
			);
			// R3-F6: the tombstone yields a fresh id ONLY when no ACTIVE
			// external link exists for the user yet — repeat identifies after
			// the first fresh link converge on that link instead of
			// fragmenting (active links win over tombstones).
			const activeLinkedPersons = new Set(externalLinks.values());
			for (const row of deleted.rows) {
				const deletedId = String(
					(row as { person_id?: unknown }).person_id ?? "",
				);
				const userOf = [...batchUserIds].find(
					(userId) => personIdForUser(projectId, userId) === deletedId,
				);
				const active = userOf ? externalLinks.get(userOf) : undefined;
				if (active && activeLinkedPersons.has(active)) {
					continue;
				}
				replacementPersonIds.set(deletedId, `u_${randomUUID()}`);
			}
			// NOTE: the ops' OWN links are folded inside the persistence
			// transaction, ONLY for successfully claimed ops, and never
			// replacing a durable mapping (R5-F1/R5-F2).
		}

		let persistedEvents: Array<{ eventId: string; duplicate: boolean }> = [];
		let identityResults: Array<{
			index: number;
			opId: string;
			status: "accepted" | "duplicate" | "rejected";
			reason?: string;
		}> = [];
		if (validEvents.length > 0 || validOps.length > 0) {
			try {
				const persisted = await new IngestRepository().persistBatch(
					projectId,
					validEvents.map((entry) => entry.event),
					now,
					parsed.batch.sdk,
					validOps.filter(
						(
							entry,
						): entry is {
							index: number;
							op: ValidatedIdentityOp;
							status?: string;
							reason?: string;
						} => entry.op !== undefined,
					),
					externalLinks,
					anonymousLinks,
					replacementPersonIds,
					// Task 13: trusted source context from the KEY, never the body.
					{
						sourceId: ctx.get("sourceId") ?? "",
						platform: ctx.get("platform") ?? "",
					},
				);
				persistedEvents = persisted.results;
				identityResults = persisted.identity;
				// R6-F3: malformed and no-op duplicate entries never reach the
				// transaction — their coarse rejected outcomes are merged back in
				// submitted order.
				const preTxRejected = validOps
					.filter((entry) => entry.status === "rejected" && !entry.op)
					.map((entry) => ({
						index: entry.index,
						opId: "",
						status: "rejected" as const,
						reason: entry.reason ?? "invalid-op",
					}));
				identityResults = [...preTxRejected, ...identityResults].sort(
					(a, b) => a.index - b.index,
				);
			} catch (error) {
				// One database outcome per request: nothing was committed. Coarse
				// retryable 503 — never SQL, database URLs, event content, or
				// stack traces; never per-event results for rolled-back rows.
				logger.error("analytics:ingest", "v2 batch persistence failed", {
					message: error instanceof Error ? error.message : "unknown",
					projectId,
				});
				return ctx.json(
					ingestError("unavailable", "storage unavailable — retry later"),
					503,
				);
			}
			for (const [position, outcome] of persistedEvents.entries()) {
				const entry = validEvents[position];
				if (!entry) continue;
				results[entry.index] = {
					index: entry.index,
					id: outcome.eventId,
					status: outcome.duplicate ? "duplicate" : "accepted",
				};
				// Realtime session updates (task-9 slice 6): a freshly accepted
				// session_started event broadcasts a project-scoped, authorized
				// "session-started" message to subscribed dashboard sockets.
				// Duplicates never re-broadcast.
				if (
					!outcome.duplicate &&
					entry.event.name === "session_started" &&
					entry.event.sessionId
				) {
					IngestController.emitSessionStarted(projectId, entry.event, now);
				}
			}
		}
		const orderedResults = results.filter(
			(result): result is IngestResult => result !== null,
		);

		const counts = {
			accepted: orderedResults.filter((r) => r.status === "accepted").length,
			duplicate: orderedResults.filter((r) => r.status === "duplicate").length,
			rejected: orderedResults.filter((r) => r.status === "rejected").length,
		};
		// Safe correlation log: counts + ids only, never properties or values.
		logger.info("analytics:ingest", "v2 batch ingested", {
			projectId,
			batchSize: orderedResults.length,
			...counts,
		});

		return ctx.json(
			{
				ok: true,
				results: orderedResults,
				...(identityResults.length > 0 ? { identity: identityResults } : {}),
			} satisfies IngestResponseBody,
			200,
		);
	}
}

function ingestError(code: string, message: string): IngestErrorBody {
	return { ok: false, error: { code, message } };
}

/**
 * Broadcast a project-scoped session-started message. The session resource
 * carries no raw IP and no approximate coordinates (task-9 §9) — the
 * dashboard renders a useful non-map session row from context/lastSeenAt.
 */
export function buildSessionResource(
	event: ValidatedEvent,
	projectId: string,
	receivedAt: number,
): SessionResource {
	return {
		sessionId: event.sessionId ?? "",
		projectId,
		anonymousId: event.anonymousId ?? null,
		startedAt: event.occurredAt,
		endedAt: null,
		lastSeenAt: receivedAt,
		context: (event.context as Record<string, unknown> | undefined) ?? null,
		isOnline: 1,
	};
}
