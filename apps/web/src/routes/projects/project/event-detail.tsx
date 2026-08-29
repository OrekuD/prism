import type { EventResource } from "@prism-analytics/types";
import { useQueryClient } from "@tanstack/react-query";
import React, { useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { SectionLabel } from "@/components/public/frame";
import { CopyButton } from "@/components/ui/copy-button";
import {
	Sheet,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	agoLabel,
	clockLabel,
	isoLabel,
	platformDotClass,
	platformFamily,
	platformLabel,
} from "@/lib/events";
import { cn } from "@/lib/utils";

/**
 * Event detail (task-16 dashboard slice) — a route-backed Sheet.
 *
 * Same URL-as-state pattern as the Errors issue sheet: `/events/:eventId`
 * renders the list (still mounted through <Outlet />) with the event in a
 * Sheet. Browser back or Escape closes it; refresh or a pasted link keeps
 * it open. Closing navigates deterministically to the list base.
 *
 * The header renders from the loaded events cache (instant open); the body
 * shows the complete stored payload — identifiers, timing/SDK, trusted
 * source attribution, identity, sanitized properties and context — grouped
 * like the v2 design drawer. Values are escaped text nodes, never HTML.
 */

const ENTRIES_PREFIX = (slug: string | undefined) => ["project-events", slug];

function findEvent(
	queryClient: ReturnType<typeof useQueryClient>,
	slug: string | undefined,
	eventId: string | undefined,
): EventResource | undefined {
	if (!slug || !eventId) return undefined;
	const entries = queryClient.getQueriesData<EventResource[]>({
		queryKey: ENTRIES_PREFIX(slug),
	});
	for (const [, payload] of entries) {
		const found = (payload ?? []).find((event) => event.id === eventId);
		if (found) return found;
	}
	return undefined;
}

function useEventFromCache(
	slug: string | undefined,
	eventId: string | undefined,
): EventResource | undefined {
	const queryClient = useQueryClient();
	return useSyncExternalStore(
		(callback) => queryClient.getQueryCache().subscribe(callback),
		() => findEvent(queryClient, slug, eventId),
		() => undefined,
	);
}

/** Key/value cell like the v2 `ev-detail-kv`. */
function Kv({ k, children }: { k: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0 rounded-[2px] border border-border bg-surface px-3 py-2.5">
			<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
				{k}
			</div>
			<div className="break-words font-mono text-[12px] leading-[1.4] text-text">
				{children}
			</div>
		</div>
	);
}

function NullValue({ label = "null" }: { label?: string }) {
	return <span className="text-text-subtle">{label}</span>;
}

/** Bounded JSON kv grid for properties/context objects. */
function KvGrid({
	value,
}: {
	value: Record<string, unknown> | null | undefined;
}) {
	if (!value || Object.keys(value).length === 0) {
		return (
			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				<Kv k="empty">
					<NullValue label="No values stored." />
				</Kv>
			</div>
		);
	}
	// Deterministic order; bounded value preview with full value in title.
	return (
		<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{Object.entries(value).map(([key, val]) => {
				const text =
					typeof val === "object" && val !== null
						? JSON.stringify(val)
						: String(val);
				return (
					<Kv key={key} k={key}>
						<span className="break-all" title={text}>
							{text.length > 140 ? `${text.slice(0, 140)}…` : text}
						</span>
					</Kv>
				);
			})}
		</div>
	);
}

function Tag({
	children,
	tone = "default",
}: {
	children: React.ReactNode;
	tone?: "default" | "ok";
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-[2px] border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em]",
				tone === "ok"
					? "border-success/40 bg-success/10 text-success"
					: "text-text-muted",
			)}
		>
			{children}
		</span>
	);
}

function EventDetails({ event, base }: { event: EventResource; base: string }) {
	const platform = event.platform ?? event.source?.platform ?? null;
	const lagMs = Math.max(0, event.receivedAt - event.occurredAt);
	const payload = React.useMemo(
		() =>
			JSON.stringify(
				{
					id: event.id,
					name: event.name,
					type: event.type ?? "track",
					occurredAt: event.occurredAt,
					receivedAt: event.receivedAt,
					sessionId: event.sessionId,
					properties: event.properties,
					source: event.source ?? null,
					person: {
						personId: event.personId ?? null,
						userId: event.userId ?? null,
						anonymousId: event.anonymousId ?? null,
					},
					sdk:
						event.sdkName || event.sdkVersion
							? { name: event.sdkName, version: event.sdkVersion }
							: null,
					context: event.context ?? null,
					schema_version: event.schemaVersion,
				},
				null,
				2,
			),
		[event],
	);

	return (
		<>
			<SheetHeader className="gap-2 border-b border-border pr-10">
				<div className="flex flex-wrap items-center gap-2">
					<SheetTitle className="break-words font-sans text-[16px] font-medium tracking-[-0.015em] text-text">
						{event.name}
					</SheetTitle>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Tag>{event.type ?? "track"}</Tag>
					<Tag>v{event.schemaVersion}</Tag>
					{platform ? <Tag>{platform}</Tag> : null}
					{platform ? (
						<Tag tone="ok">{platformFamily(platform)} family</Tag>
					) : null}
				</div>
			</SheetHeader>

			<div className="flex flex-col gap-5 overflow-y-auto p-4 pb-6">
				<section>
					<SectionLabel>Identifiers · stored internally</SectionLabel>
					<div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<Kv k="id (idempotency)">
							<span className="break-all text-[11px]">{event.id}</span>
						</Kv>
						<Kv k="project_id (derived)">
							<span className="break-all text-[11px]">{event.projectId}</span>
						</Kv>
						<Kv k="source_id (trusted)">
							{event.sourceId ? (
								<span className="break-all text-[11px]">{event.sourceId}</span>
							) : (
								<NullValue />
							)}
						</Kv>
						<Kv k="platform (trusted)">
							{platform ? platformLabel(platform) : <NullValue />}
						</Kv>
					</div>
				</section>

				<section>
					<SectionLabel>Timing & SDK</SectionLabel>
					<div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<Kv k="occurred_at (client)">
							<span className="text-[11px]">{isoLabel(event.occurredAt)}</span>
							<br />
							<span className="text-text-subtle">
								{agoLabel(event.occurredAt)}
							</span>
						</Kv>
						<Kv k="received_at (server)">
							<span className="text-[11px]">{isoLabel(event.receivedAt)}</span>
							<br />
							<span className="text-text-subtle">+{fmtLag(lagMs)}ms lag</span>
						</Kv>
						<Kv k="sdk_name + version">
							{event.sdkName ? (
								<span>
									{event.sdkName} @ {event.sdkVersion ?? "?"}
								</span>
							) : (
								<NullValue label="null — pre-SDK-column row" />
							)}
						</Kv>
						<Kv k="schema_version">v{event.schemaVersion}</Kv>
					</div>
					<p className="mt-2 text-[11px] leading-[1.5] text-text-subtle">
						Source attribution: Bearer key → project_api_keys → source_id →
						project_sources → trusted source_id & platform. Client-supplied
						fields cannot override.
					</p>
				</section>

				<section>
					<SectionLabel>Source</SectionLabel>
					{event.source ? (
						<div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-[2px] border border-border bg-surface px-3 py-2.5">
							<span
								className={cn(
									"size-[7px] shrink-0 rounded-full",
									platformDotClass(event.source.platform),
								)}
								aria-hidden="true"
							/>
							<b className="font-mono text-[13px] font-medium text-text">
								{event.source.name}
							</b>
							<span className="font-mono text-[12px] text-text-muted">
								· {platformLabel(event.source.platform)}
							</span>
							<span className="ml-auto break-all font-mono text-[11px] text-text-subtle">
								{event.source.id}
							</span>
						</div>
					) : (
						<p className="mt-2.5 font-mono text-[12px] text-text-muted">
							This event predates source attribution (no source_id stored).
						</p>
					)}
				</section>

				<section>
					<SectionLabel>Person & session</SectionLabel>
					<div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<Kv k="person_id (Prism person)">
							{event.personId ? (
								<span className="break-all text-[11px]">{event.personId}</span>
							) : (
								<NullValue />
							)}
						</Kv>
						<Kv k="user_id (identify)">
							{event.userId ? (
								event.userId
							) : (
								<NullValue label="null — anonymous" />
							)}
						</Kv>
						<Kv k="anonymous_id (SDK)">
							{event.anonymousId ? (
								<span className="break-all text-[11px]">
									{event.anonymousId}
								</span>
							) : (
								<NullValue />
							)}
						</Kv>
						<Kv k="session_id">
							{event.sessionId ? (
								<span className="break-all text-[11px]">{event.sessionId}</span>
							) : (
								<NullValue label="null — server event has no session" />
							)}
						</Kv>
					</div>
				</section>

				<section>
					<SectionLabel>Properties · sanitized</SectionLabel>
					<div className="mt-2.5">
						<KvGrid value={event.properties} />
					</div>
				</section>

				<section>
					<SectionLabel>Context · sanitized runtime</SectionLabel>
					<div className="mt-2.5">
						<KvGrid value={event.context} />
					</div>
				</section>

				<section>
					<div className="flex items-center justify-between gap-2">
						<SectionLabel>Complete payload</SectionLabel>
						<CopyButton value={payload} label="Copy JSON" />
					</div>
					<pre className="mt-2.5 max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[2px] border border-border bg-surface p-3 font-mono text-[12px] leading-[1.6] text-text">
						{payload}
					</pre>
					<p className="mt-2 font-mono text-[11px] leading-[1.5] text-text-subtle">
						Read API:{" "}
						<span className="break-all">
							GET /api/v1/projects/…/events?name={event.name}&limit=50
						</span>
					</p>
				</section>
			</div>

			<SheetFooter className="border-t border-border">
				<div className="flex w-full items-center justify-between gap-2">
					{event.personId ? (
						<Link
							to={`/workspace/${base.split("/").at(-3)}/projects/${base.split("/").at(-1)}/people/${event.personId}`}
							className="font-mono text-[12px] font-medium text-link hover:underline"
						>
							View person →
						</Link>
					) : (
						<span className="font-mono text-[11px] text-text-subtle">
							Anonymous event
						</span>
					)}
					<CopyButton value={payload} label="Copy payload" />
				</div>
			</SheetFooter>
		</>
	);
}

function fmtLag(ms: number): string {
	return ms.toLocaleString("en-US");
}

function EventDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4 p-4">
			<Skeleton className="h-[16px] w-3/4" />
			<Skeleton className="h-[12px] w-1/2" />
			<div className="mt-2 grid grid-cols-2 gap-4">
				<Skeleton className="h-[48px] w-full" />
				<Skeleton className="h-[48px] w-full" />
				<Skeleton className="h-[48px] w-full" />
				<Skeleton className="h-[48px] w-full" />
			</div>
		</div>
	);
}

function EventMissing({ base }: { base: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="font-mono text-[13px] text-text-muted">
				This event isn't in the loaded window.
			</p>
			<span className="max-w-[300px] text-[12px] leading-[1.5] text-text-subtle">
				It may have fallen outside the latest 200 events for this project, or
				filters changed after the link was copied.
			</span>
			<Link to={base} className="mt-1 font-medium text-link hover:underline">
				Back to all events
			</Link>
		</div>
	);
}

export function EventDetail() {
	const { slug, wrkSlug, eventId } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const event = useEventFromCache(slug, eventId);

	const base = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/events`;

	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) navigate(base);
			}}
		>
			<SheetContent className="w-full gap-0 p-0 sm:max-w-[640px]">
				{event ? (
					<EventDetails event={event} base={base} />
				) : queryClient
						.getQueryCache()
						.findAll({ queryKey: ENTRIES_PREFIX(slug) })
						.some((query) => query.state.status === "pending") ? (
					<EventDetailSkeleton />
				) : (
					<EventMissing base={base} />
				)}
			</SheetContent>
		</Sheet>
	);
}
