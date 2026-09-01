import { digestInstallation } from "../enrichment/mobileScreenView.js";
import { randomUUID } from "node:crypto";
import {
	INGEST_LIMITS,
	type IngestResponseBody,
	type IngestResult,
	type JsonObject,
	sanitizeProperties,
} from "@prism-analytics/core";
import {
	APP_LIFECYCLE_EVENT_NAME,
	PAGE_VIEW_EVENT_NAME,
	SCREEN_VIEW_EVENT_NAME,
	PAGE_VIEW_LIMITS,
	validateAppLifecycleProperties,
	validatePageViewProperties,
	validateScreenViewProperties,
	STANDARD_EVENT_BY_PROTECTED_NAME,
	validateStandardEventProperties,
} from "@prism-analytics/core";
import type { SessionResource } from "@prism-analytics/types";
import { config } from "dotenv";
import type { Context } from "hono";
import {
	UA_PARSER_VERSION,
	classifyTechnology,
	geoProviderFromEnv,
	incrementPageViewCounter,
	resolveClientIp,
} from "../enrichment/webPageView.js";
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
	type IngestRejectReason,
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

		// Task 18: reserved mobile screen + lifecycle validated similarly, gated on react-native source
		// Task 18: mobile screen/lifecycle gated to react-native source, installation digested, projected atomically
  // Task 17 slice 4: reserved page views are validated against the
		// frozen wire schema and the trusted Web-source boundary BEFORE any
		// write. Malformed or misattributed attempts are INDIVIDUALLY
		// rejected - never silently stored as ordinary custom events.
		const platform = ctx.get("platform") ?? "";
		const requestOriginHost = (() => {
			try {
				const origin = ctx.req.header("origin");
				if (!origin) return null;
				return new URL(origin).hostname.toLowerCase();
			} catch {
				return null;
			}
		})();
		const pageProjectionIndexes = new Set<number>();
		// R3-F2: rejected reserved entries are PARTITIONED OUT of the
		// persistence input - the sentinel-rename hack let them persist and be
		// reported accepted after the post-tx merge overwrote the rejection.
		const reservedRejectedEvents = new Set<ValidatedEvent>();
		for (const entry of validEvents) {
			if (entry.event.name !== PAGE_VIEW_EVENT_NAME) continue;
			const index = entry.index;
			if (platform !== "web") {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "page-view-requires-web-source",
				};
				reservedRejectedEvents.add(entry.event);
				incrementPageViewCounter("page_view_rejected_non_web");
				continue;
			}
			const validation = validatePageViewProperties(entry.event.properties);
			if (!validation.ok) {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "invalid-page-view",
				};
				reservedRejectedEvents.add(entry.event);
				incrementPageViewCounter("page_view_rejected_invalid");
				continue;
			}
			const page = (entry.event.properties as { $page?: { host?: string } })
				.$page;
			if (requestOriginHost && page?.host && page.host !== requestOriginHost) {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "page-view-host-mismatch",
				};
				reservedRejectedEvents.add(entry.event);
				incrementPageViewCounter("page_view_rejected_host_mismatch");
				continue;
			}
			pageProjectionIndexes.add(index);
			incrementPageViewCounter("page_view_validated");
		}

		// Task 18 (R2-F2): reserved MOBILE records get the same trusted-boundary
		// treatment as Web page views - gated on the key's react-native source
		// platform, independently normalized against the frozen wire schema,
		// installation IDs digested with a SERVER secret before persistence,
		// and projected only inside the event transaction. A direct HTTP client
		// can never store a malformed or misattributed mobile record.
		// Task 13: the key-derived source identity - never client-supplied.
		const trustedSourceId = ctx.get("sourceId") ?? "";
		const MOBILE_ID_MAX = 64;
		const mobilePlatform = platform === "react-native";
		// R3-F3: the digest secret is REQUIRED - a missing server secret is a
		// deployment fault, so reserved mobile ingestion fails closed rather
		// than silently dropping installation attribution.
		const installationSalt = process.env.ANALYTICS_INSTALLATION_SALT ?? "";
		interface MobileScreenRow {
			eventId: string;
			sourceId: string;
			occurredAt: number;
			sessionId: string;
			sessionSequence: number;
			screenName: string;
			routePattern: string | null;
			navigation: string;
			previousScreen: string | null;
			appVersion: string | null;
			appBuild: string | null;
			appEnvironment: string | null;
			os: string | null;
			osVersion: string | null;
			installationDigest: string | null;
		}
		interface MobileLifecycleRow {
			eventId: string;
			sourceId: string;
			occurredAt: number;
			sessionId: string;
			sequence: number;
			durationMs: number | null;
		}
		const mobileScreenProjections: Array<{ index: number; row: MobileScreenRow }> = [];
		const mobileLifecycleProjections: Array<{ index: number; row: MobileLifecycleRow }> = [];
		for (const entry of validEvents) {
			const isScreen = entry.event.name === SCREEN_VIEW_EVENT_NAME;
			const isLifecycle = entry.event.name === APP_LIFECYCLE_EVENT_NAME;
			if (!isScreen && !isLifecycle) continue;
			const index = entry.index;
			const reject = (reason: IngestRejectReason) => {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason,
				};
				reservedRejectedEvents.add(entry.event);
			};
			if (!mobilePlatform) {
				reject("mobile-record-requires-react-native-source");
				continue;
			}
			if (!entry.event.sessionId) {
				reject("mobile-record-requires-session");
				continue;
			}
			if (!installationSalt) {
				reject("mobile-digest-unconfigured");
				continue;
			}
			// Read bounded extras from the ORIGINAL properties BEFORE the
			// normalized value replaces them (the normalized result drops
				// $app/$installation so raw values never persist).
			let persistProps: Record<string, unknown>;
			const originalProps = (entry.event.properties ?? {}) as {
				$app?: Record<string, unknown>;
				$installation?: unknown;
			};
			if (isScreen) {
				const validation = validateScreenViewProperties(entry.event.properties);
				if (!validation.ok) {
					reject("invalid-mobile-screen");
					continue;
				}
				// RAW installation value never persists - strip it via rest spread
				// (no delete: shape-stable and lint-clean).
				const { $installation: _raw, ...persistable } = validation.value as unknown as Record<string, unknown>;
				void _raw;
				persistProps = persistable;
				entry.event.properties =
					persistProps as unknown as typeof entry.event.properties;
				const screen = validation.value.$screen;
				const bound = (v: unknown, max: number): string | null =>
					typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
				const rawInstallation = originalProps.$installation;
				if (
					typeof rawInstallation !== "string" ||
					rawInstallation.length === 0 ||
					rawInstallation.length > MOBILE_ID_MAX
				) {
					reject("mobile-installation-required");
					continue;
				}
				// Keyed, project/source-scoped digest over an unambiguous message.
				const ctxOs = ((entry.event.context as Record<string, unknown> | undefined)?.os);
				mobileScreenProjections.push({
					index,
					row: {
						eventId: entry.event.eventId,
						sourceId: trustedSourceId,
						occurredAt: entry.event.occurredAt,
						sessionId: entry.event.sessionId ?? "",
						sessionSequence: screen.sequence,
						screenName: screen.name,
						routePattern: screen.routePattern ?? null,
						navigation: String(screen.navigation),
						previousScreen: screen.previousScreen ?? null,
						appVersion: bound(originalProps.$app?.version, 32),
						appBuild: bound(originalProps.$app?.build, 16),
						appEnvironment: bound(originalProps.$app?.environment, 16),
						os:
							typeof ctxOs === "string" && ["ios", "android"].includes(ctxOs)
								? ctxOs
								: null,
						osVersion: bound((entry.event.context as Record<string, unknown> | undefined)?.osVersion, 16),
						installationDigest: digestInstallation(
							projectId,
							trustedSourceId,
							rawInstallation,
							installationSalt,
						),
					},
				});
			} else {
				const validation = validateAppLifecycleProperties(entry.event.properties);
				if (!validation.ok) {
					reject("invalid-mobile-lifecycle");
					continue;
				}
				entry.event.properties =
					validation.value as unknown as typeof entry.event.properties;
				mobileLifecycleProjections.push({
					index,
					row: {
						eventId: entry.event.eventId,
						sourceId: trustedSourceId,
						occurredAt: entry.event.occurredAt,
						sessionId: entry.event.sessionId ?? "",
						sequence: validation.value.$lifecycle.sequence,
						durationMs:
							validation.value.$lifecycle.durationMs ?? null,
					},
				});
			}
		}

		// Task 19: Standard Events — strict, shared validation for every
		// protected `$prism_*` name. Accepted events persist as normal
		// canonical events (no second table); rejected ones are partitioned
		// out of persistence exactly like page/mobile rejections.
		const STANDARD_ALLOWED_PLATFORMS = new Set(["web", "react-native", "server"]);
		for (const entry of validEvents) {
			// Already rejected as page/mobile — never re-evaluate.
			if (reservedRejectedEvents.has(entry.event)) continue;
			if (!entry.event.name.startsWith("$prism_")) continue;
			// Existing automatic events already handled.
			if (
				entry.event.name === PAGE_VIEW_EVENT_NAME ||
				entry.event.name === SCREEN_VIEW_EVENT_NAME ||
				entry.event.name === APP_LIFECYCLE_EVENT_NAME
			)
				continue;
			const index = entry.index;
			const isKnownStandard = STANDARD_EVENT_BY_PROTECTED_NAME.has(entry.event.name);
			if (!isKnownStandard) {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "unknown-reserved-event",
				};
				reservedRejectedEvents.add(entry.event);
				continue;
			}
			if (!STANDARD_ALLOWED_PLATFORMS.has(platform)) {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "invalid-standard-event",
				};
				reservedRejectedEvents.add(entry.event);
				continue;
			}
			const validation = validateStandardEventProperties(entry.event.name, entry.event.properties);
			if (!validation.ok) {
				results[index] = {
					index,
					id: entry.event.eventId,
					status: "rejected",
					reason: "invalid-standard-event",
				};
				reservedRejectedEvents.add(entry.event);
				continue;
			}
			// Persist the normalized value — never the raw invalid input.
			entry.event.properties = validation.value as unknown as typeof entry.event.properties;
		}

		// Enrichment is computed ONCE per request at the trusted boundary:
		// technology from a pinned parser; coarse geography via the optional
		// configured provider, only for FRESH deliveries inside the frozen
		// late-delivery cutoff. Raw UA/IP never leave this block.
		let technology: ReturnType<typeof classifyTechnology> | null = null;
		let coarseLocation: Awaited<
			ReturnType<NonNullable<ReturnType<typeof geoProviderFromEnv>>["lookup"]>
		> | null = null;
		const hasPageViews = pageProjectionIndexes.size > 0;
		if (hasPageViews) {
			technology = classifyTechnology(ctx.req.header("user-agent"));
			if (technology.isBot) incrementPageViewCounter("page_view_bot");
			const env = (ctx.env ?? {}) as Record<string, string | undefined>;
			const provider = geoProviderFromEnv(env);
			if (provider) {
				const ip = resolveClientIp(ctx, env);
				if (ip) {
					try {
						coarseLocation = await provider.lookup(ip);
						if (coarseLocation) {
							incrementPageViewCounter("page_view_geo_known");
						} else {
							incrementPageViewCounter("page_view_geo_unknown");
						}
					} catch {
						coarseLocation = null;
						incrementPageViewCounter("page_view_geo_error");
					}
				} else {
					incrementPageViewCounter("page_view_geo_untrusted_ip");
				}
			}
		}
		const pageProjections = hasPageViews
			? validEvents
					.filter((entry) => pageProjectionIndexes.has(entry.index))
					.flatMap((entry) => {
						const props = entry.event.properties as {
							$page?: {
								host: string;
								path: string;
								navigation: string;
								sequence: number;
								previousPath?: string;
								title?: string;
							};
							$referrer?: { host: string };
							$campaign?: { source?: string; medium?: string; name?: string };
						};
						const page = props.$page;
						if (!page) return [];
						const context = (entry.event.context ?? {}) as {
							screenSize?: { width?: number; height?: number };
							locale?: string;
						};
						// Copy ONLY allowlisted context values into the projection.
						const viewportWidth =
							typeof context.screenSize?.width === "number"
								? Math.round(context.screenSize.width)
								: null;
						const viewportHeight =
							typeof context.screenSize?.height === "number"
								? Math.round(context.screenSize.height)
								: null;
						const primaryLanguage = context.locale
							? context.locale.slice(0, 12).split("-")[0] || null
							: null;
						const fresh =
							now - entry.event.occurredAt <=
							PAGE_VIEW_LIMITS.lateDeliveryGeoCutoffMs;
						const geo = fresh ? coarseLocation : null;
						if (!fresh && geo === null) {
							incrementPageViewCounter("page_view_late_no_geo");
						}
						return [
							{
								index: entry.index,
								row: {
									occurredAt: entry.event.occurredAt,
									host: page.host,
									path: page.path,
									title: page.title ?? null,
									navigationType: String(page.navigation),
									pageSequence: page.sequence,
									previousPath: page.previousPath ?? null,
									referrerHost: props.$referrer?.host ?? null,
									campaignSource: props.$campaign?.source ?? null,
									campaignMedium: props.$campaign?.medium ?? null,
									campaignName: props.$campaign?.name ?? null,
									browserFamily: technology?.browserFamily ?? null,
									browserMajor: technology?.browserMajor ?? null,
									osFamily: technology?.osFamily ?? null,
									osMajor: technology?.osMajor ?? null,
									deviceType: technology?.deviceType ?? "unknown",
									isBot: technology?.isBot ?? false,
									uaParserVersion: UA_PARSER_VERSION,
									viewportWidth,
									viewportHeight,
									primaryLanguage,
									countryCode: geo?.countryCode ?? null,
									region: geo?.region ?? null,
									city: geo?.city ?? null,
									geoProvider: geo?.provider ?? null,
								},
							},
						];
					})
			: [];

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

		// R3-F2: reserved-rejected entries are excluded from persistence.
		let persistableEntries: typeof validEvents = validEvents.filter(
			(entry) => !reservedRejectedEvents.has(entry.event),
		);
		let persistedEvents: Array<{ eventId: string; duplicate: boolean }> = [];
		let identityResults: Array<{
			index: number;
			opId: string;
			status: "accepted" | "duplicate" | "rejected";
			reason?: string;
		}> = [];
		if (validEvents.length > 0 || validOps.length > 0) {
			try {
				// R3-F2: rejected reserved entries never enter the transaction.
				persistableEntries = validEvents.filter(
					(entry) => !reservedRejectedEvents.has(entry.event),
				);
				const persistenceIndex = new Map<number, number>();
				persistableEntries.forEach((entry, i) => persistenceIndex.set(entry.index, i));
				const remap = <T extends { index: number }>(rows: T[]) =>
					rows.flatMap((row) => {
						const mapped = persistenceIndex.get(row.index);
						return mapped === undefined ? [] : [{ ...row, index: mapped }];
					});
				const persistedPageProjections = remap(pageProjections);
				const persistedMobileScreens = remap(mobileScreenProjections);
				const persistedMobileLifecycles = remap(mobileLifecycleProjections);
				const persisted = await new IngestRepository().persistBatch(
					projectId,
					persistableEntries.map((entry) => entry.event),
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
					persistedPageProjections,
					persistedMobileScreens,
					persistedMobileLifecycles,
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
				const entry = persistableEntries[position];
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
