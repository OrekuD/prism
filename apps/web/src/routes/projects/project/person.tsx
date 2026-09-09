import type { EventResource, PeopleListResource, PersonDetailResource } from "@prism-analytics/types";
import { useQueryClient } from "@tanstack/react-query";
import { Download } from "@/components/ui/lucide-icons";
import React, { useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Frame, SectionLabel } from "@/components/public/frame";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import {
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EventDetails } from "@/routes/projects/project/event-detail";
import { PresentationStack } from "@/components/ui/presentation-stack";
import { axiosInstance } from "@/utils/axiosInstance";
import { platformDotClass, platformLabel } from "@/lib/events";
import {
	type PersonPresentationLayer,
	parsePersonPresentationStack,
} from "@/lib/presentationStack";
import { useActiveMember } from "@/lib/workspace";
import { usePersonActivityQuery, usePersonQuery } from "@/network/queries/usePeopleQueries";
import { cn } from "@/lib/utils";

/**
 * Person profile (task-20) as a nested presentation layer — the same sheet
 * grammar as the Errors issue sheet: tags/title/description header, an
 * Overview Kv grid, identity and context sections, recent activity as
 * cards that open nested event sheets (like recent occurrences), and
 * role-gated actions in the footer (like the workflow footer).
 *
 * The URL IS the open state: `/people/:personId` renders the list (still
 * mounted through <Outlet />) with the person in a Sheet;
 * `/people/:personId/events/:eventId` stacks the event on top. Browser
 * back or Escape pops one level; refresh or a pasted link keeps the stack
 * open. Dismissal navigates deterministically to the parent path (never
 * history -1). Export/delete are owner/admin actions in the UI and are
 * enforced independently by the API.
 */

const PROFILE_KEYS = ["name", "username", "email"] as const;

/**
 * Bounded, TEXT-ONLY JSON rendering for custom traits (R1-F4): depth,
 * item-count, and string-length limits with explicit truncation markers.
 * Values reach the DOM as React text nodes — never HTML, never a fetched
 * URL — so hostile-looking trait values cannot inject anything.
 */
const TRAIT_MAX_DEPTH = 3;
const TRAIT_MAX_ITEMS = 8;
const TRAIT_MAX_STRING = 120;

function boundedTraitText(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.length > TRAIT_MAX_STRING
      ? `${value.slice(0, TRAIT_MAX_STRING - 1)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (depth >= TRAIT_MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, TRAIT_MAX_ITEMS)
      .map((item) => boundedTraitText(item, depth + 1));
    const extra = value.length > TRAIT_MAX_ITEMS ? `, …+${value.length - TRAIT_MAX_ITEMS}` : "";
    return `[${items.join(", ")}${extra}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      TRAIT_MAX_ITEMS,
    );
    const extra =
      Object.keys(value as Record<string, unknown>).length > TRAIT_MAX_ITEMS
        ? ", …"
        : "";
    const rendered = entries
      .map(
        ([key, entry]) =>
          `${key.length > TRAIT_MAX_STRING ? `${key.slice(0, TRAIT_MAX_STRING - 1)}…` : key}: ${boundedTraitText(entry, depth + 1)}`,
      )
      .join(", ");
    return `{ ${rendered}${extra} }`;
  }
  return "Unsupported value";
}

function formatTraitValue(value: unknown): string | null {
  if (value === undefined) return null;
  return boundedTraitText(value);
}

function traitString(person: PersonDetailResource, key: string): string | null {
	const value = person.traits[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function personDisplayName(person: PersonDetailResource): string {
	return (
		traitString(person, "name") ??
		traitString(person, "username") ??
		traitString(person, "email") ??
		person.primaryExternalId ??
		"Identified user"
	);
}

function fullTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Compact relative time ("3m ago") using real elapsed time. */
function relativeTime(timestamp: number): string {
	const seconds = Math.round((timestamp - Date.now()) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 60) return "just now";
	if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
	if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
	return `${Math.round(abs / 86400)}d ago`;
}

/** Key/value cell — the Errors sheet Kv: Frame inset with mono label. */
function Kv({ k, children }: { k: string; children: React.ReactNode }) {
	return (
		<Frame inset className="min-w-0 px-3 py-3">
			<div className="mb-1.5 text-[13px] font-medium tracking-normal text-text-subtle">
				{k}
			</div>
			<div className="break-words text-[12.5px] leading-[1.5] text-text">
				{children}
			</div>
		</Frame>
	);
}

function IdentityRow({ id, kind }: { id: string; kind: "external" | "anonymous" }) {
	return (
		<div className="flex items-center gap-2.5 py-1.5">
			<span
				className={cn(
					"inline-block h-1.5 w-1.5 shrink-0 rounded-full",
					kind === "external" ? "bg-success" : "bg-border-strong",
				)}
				aria-hidden="true"
			/>
			<span className="min-w-0 break-all text-[12px] text-text tabular-nums">{id}</span>
			<span className="ml-auto shrink-0 text-[10px] tracking-normal text-text-subtle">
				{kind}
			</span>
		</div>
	);
}

function ActivityRow({
	event,
	eventPath,
	search,
}: {
	event: EventResource;
	eventPath: string;
	search: string;
}) {
	const displayName =
		event.standardEvent?.displayName ?? event.name ?? "Unknown event";
	const platform = event.platform ?? event.source?.platform ?? null;
	const sourceName = event.source?.name ?? (platform ? platformLabel(platform) : null);
	return (
		<li>
			<Link
				to={{ pathname: eventPath, search }}
				data-presentation-trigger={`event:0:${event.id}`}
				className="group flex flex-col gap-1 border-t border-border px-1 py-2.5 transition-colors first:border-t-0 hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-focus"
			>
				<span className="flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-text group-hover:text-link">
						{displayName}
					</span>
					<time
						dateTime={new Date(event.occurredAt).toISOString()}
						title={fullTimestamp(event.occurredAt)}
						className="shrink-0 text-[10.5px] leading-none text-text-subtle tabular-nums"
					>
						{relativeTime(event.occurredAt)}
					</time>
				</span>
				<span className="flex items-center gap-2 text-[10.5px] leading-none text-text-muted">
					{platform ? (
						<span
							className={cn("size-1.5 shrink-0 rounded-full", platformDotClass(platform))}
							aria-hidden="true"
						/>
					) : null}
					{sourceName ? (
						<span className="truncate">{sourceName}</span>
					) : null}
					{event.sessionId ? (
						<span className="truncate" title={event.sessionId}>
							· {event.sessionId.slice(0, 8)}…
						</span>
					) : null}
				</span>
			</Link>
		</li>
	);
}

function findPersonEvent(
	queryClient: ReturnType<typeof useQueryClient>,
	slug: string | undefined,
	personId: string | undefined,
	eventId: string | undefined,
): EventResource | undefined {
	if (!slug || !personId || !eventId) return undefined;
	const entries = queryClient.getQueriesData<EventResource[]>({
		queryKey: ["person-activity", slug, personId],
	});
	for (const [, payload] of entries) {
		const found = (payload ?? []).find((event) => event.id === eventId);
		if (found) return found;
	}
	return undefined;
}

function usePersonEventFromCache(
	slug: string | undefined,
	personId: string | undefined,
	eventId: string | undefined,
): EventResource | undefined {
	const queryClient = useQueryClient();
	return useSyncExternalStore(
		(callback) => queryClient.getQueryCache().subscribe(callback),
		() => findPersonEvent(queryClient, slug, personId, eventId),
		() => undefined,
	);
}

function PersonEventLayer({
	slug,
	personId,
	eventId,
	personPath,
	search,
}: {
	slug: string | undefined;
	personId: string;
	eventId: string;
	personPath: string;
	search: string;
}) {
	const queryClient = useQueryClient();
	const event = usePersonEventFromCache(slug, personId, eventId);
	const activityPending = queryClient
		.getQueryCache()
		.findAll({ queryKey: ["person-activity", slug, personId] })
		.some((query) => query.state.status === "pending");

	if (event) {
		return <EventDetails event={event} base={personPath} />;
	}
	if (activityPending) {
		return (
			<div className="flex flex-col gap-4 p-6">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-[120px] w-full rounded-md" />
			</div>
		);
	}
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="font-sans text-[14px] font-medium tracking-[-0.01em] text-text">
				Event not in this person&apos;s activity
			</p>
			<p className="max-w-[320px] text-pretty text-[12.5px] leading-[1.5] text-text-muted">
				This event isn&apos;t in the loaded activity window. It may have
				aged out or the person&apos;s activity was cleared.
			</p>
			<Link
				to={{ pathname: personPath, search }}
				className="mt-1 inline-flex h-8 items-center rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text hover:bg-surface-hover"
			>
				Back to person
			</Link>
		</div>
	);
}

function PersonProfile({
	slug,
	personId,
	listBase,
	search,
}: {
	slug: string | undefined;
	personId: string;
	listBase: string;
	search: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const activeMember = useActiveMember();
	const canManage =
		activeMember?.data?.role === "owner" || activeMember?.data?.role === "admin";
	const { data, isLoading, isError, refetch } = usePersonQuery(slug, personId);
	const activity = usePersonActivityQuery(slug, personId);
	const [confirmText, setConfirmText] = React.useState("");
	const [confirmingDelete, setConfirmingDelete] = React.useState(false);
	const [deleting, setDeleting] = React.useState(false);
	const [deleteError, setDeleteError] = React.useState<string | null>(null);
	const [exporting, setExporting] = React.useState(false);
	const [exportError, setExportError] = React.useState<string | null>(null);

	const personPath = `${listBase}/${encodeURIComponent(personId)}`;

	const handleExport = async () => {
		if (!slug || !personId || exporting) return;
		setExporting(true);
		setExportError(null);
		try {
			const response = await axiosInstance.get(
				`/projects/${slug}/people/${encodeURIComponent(personId)}/export`,
			);
			const blob = new Blob([JSON.stringify(response.data, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `person-${personId.slice(0, 8)}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch {
			setExportError("Export failed. Try again.");
		} finally {
			setExporting(false);
		}
	};

	const handleDelete = async () => {
		if (!slug || !personId || deleting || confirmText !== "delete") return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await axiosInstance.delete(
				`/projects/${slug}/people/${encodeURIComponent(personId)}?confirm=true`,
			);
			// R2-F1: a successful deletion must never leave the deleted person
			// in a cached list page. The list stays mounted behind this
			// sheet and usePeopleQuery reuses the previous page as
			// placeholderData during a refetch (the observer reports success
			// while the fresh fetch runs) — removing the queries alone lets
			// the deleted row flash back. So first remove the row from every
			// cached page (identified drops honestly by one; the range-bound
			// counts refresh on the refetch below), then remove the queries
			// so nothing stale survives. The profile/activity caches are
			// dead too.
			queryClient.setQueriesData<PeopleListResource>(
				{ queryKey: ["people", slug] },
				(previous) => {
					if (!previous) return previous;
					const people = previous.people.filter(
						(row) => row.personId !== personId,
					);
					if (people.length === previous.people.length) return previous;
					return {
						...previous,
						people,
						summary: {
							...previous.summary,
							identifiedPeople: Math.max(
								0,
								previous.summary.identifiedPeople - 1,
							),
						},
					};
				},
			);
			queryClient.removeQueries({ queryKey: ["person", slug, personId] });
			queryClient.removeQueries({
				queryKey: ["person-activity", slug, personId],
			});
			queryClient.removeQueries({ queryKey: ["people", slug] });
			navigate(listBase);
		} catch {
			setDeleteError("Deletion failed. Try again.");
			setDeleting(false);
		}
	};

	if (isLoading) {
		return (
			<div className="grid gap-4 p-6" aria-busy="true" aria-label="Loading person">
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	if (isError || !data) {
		return (
			<div className="p-6">
				<ErrorState
					title="Could not load person"
					description="Prism could not reach the people store. Check your connection and try again."
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	const displayName = personDisplayName(data);
	const email = traitString(data, "email");
	const username = traitString(data, "username");
	const showPrimaryId = displayName !== data.primaryExternalId;
	const profileEntries = Object.entries(data.traits).filter(
		([key, value]) =>
			!(PROFILE_KEYS as readonly string[]).includes(key) &&
			formatTraitValue(value) !== null,
	);
	const externalCount = data.externalIds.length;
	const anonymousCount = data.anonymousIds.length;
	const linkedIdsCount = externalCount + anonymousCount;

	return (
		<>
			<SheetHeader className="gap-3 border-b border-border px-6 pb-4 pt-6">
				<SheetTitle className="break-words pr-2 text-left font-sans text-[17px] font-semibold leading-[1.25] tracking-[-0.02em] text-text">
					{displayName}
				</SheetTitle>
				{showPrimaryId && data.primaryExternalId ? (
					<p
						className="truncate text-[12.5px] leading-none text-text-subtle"
						title={data.primaryExternalId}
					>
						{data.primaryExternalId}
					</p>
				) : null}
			</SheetHeader>

			<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6">
				<section>
					<SectionLabel>Overview</SectionLabel>
					<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Kv k="sessions">{data.sessionCount.toLocaleString("en-US")}</Kv>
						<Kv k="events">{data.eventCount.toLocaleString("en-US")}</Kv>
						<Kv k="external ids">{data.externalIdentityCount.toLocaleString("en-US")}</Kv>
						<Kv k="anonymous ids">{data.anonymousIdentityCount.toLocaleString("en-US")}</Kv>
						<Kv k="first seen">{fullTimestamp(data.firstSeenAt)}</Kv>
						<Kv k="last seen">{fullTimestamp(data.lastSeenAt)}</Kv>
					</div>
				</section>

				<section>
					<SectionLabel>Identity</SectionLabel>
					<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Kv k="email">
							{email ?? <span className="text-text-subtle">Not supplied</span>}
						</Kv>
						<Kv k="username">
							{username ?? <span className="text-text-subtle">Not supplied</span>}
						</Kv>
					</div>
					{profileEntries.length > 0 ? (
						<div className="mt-4">
							<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
								Supplied traits
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{profileEntries.map(([key, value]) => (
									<Kv key={key} k={key}>
										{formatTraitValue(value)}
									</Kv>
								))}
							</div>
						</div>
					) : null}
				</section>

				<section>
					<div className="flex items-center justify-between gap-2">
						<SectionLabel className="leading-none">Linked identities</SectionLabel>
						<span className="text-[10px] text-text-subtle">
							{externalCount} external · {anonymousCount} anonymous
						</span>
					</div>
					<div className="mt-3">
						{linkedIdsCount === 0 ? (
							<Frame inset className="border-dashed bg-surface/40 px-3 py-6 text-center">
								<p className="text-[12px] leading-none text-text-subtle">
									No linked identities.
								</p>
							</Frame>
						) : (
							<Frame inset className="p-0">
								<div className="overflow-hidden rounded-[16px]">
									{data.externalIds.map((id) => (
										<div key={`ext-${id}`} className="border-t border-border px-3 first:border-t-0">
											<IdentityRow id={id} kind="external" />
										</div>
									))}
									{data.anonymousIds.length > 0 ? (
										<details className="border-t border-border px-3 py-2">
											<summary className="cursor-pointer text-[11px] text-text-subtle transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-focus">
												Anonymous history ({data.anonymousIds.length})
											</summary>
											<div className="pb-1">
												{data.anonymousIds.map((id) => (
													<IdentityRow key={`anon-${id}`} id={id} kind="anonymous" />
												))}
											</div>
										</details>
									) : null}
								</div>
							</Frame>
						)}
					</div>
				</section>

				<section>
					<div className="flex items-center justify-between gap-2">
						<SectionLabel className="leading-none">Activity</SectionLabel>
						<span className="text-[10px] text-text-subtle">newest first</span>
					</div>
					<div className="mt-3">
						{activity.isLoading ? (
							<div aria-busy="true" aria-label="Loading activity">
								<Skeleton className="h-[46px] w-full rounded-md" />
								<Skeleton className="mt-2 h-[46px] w-full rounded-md" />
								<Skeleton className="mt-2 h-[46px] w-full rounded-md" />
							</div>
						) : activity.isError ? (
							<Frame className="border-dashed bg-surface/40 px-3 py-6 text-center">
								<p className="text-[12px] text-text-subtle">
									Could not load activity.
								</p>
								<Button
									variant="outline"
									size="sm"
									className="mt-3 h-8"
									onClick={() => activity.refetch()}
								>
									Retry
								</Button>
							</Frame>
						) : (activity.data?.length ?? 0) === 0 ? (
							<Frame className="border-dashed bg-surface/40 px-3 py-6 text-center">
								<p className="text-[12px] leading-none text-text-subtle">
									No events recorded under this person&apos;s identities yet.
								</p>
							</Frame>
						) : (
							<Frame className="p-0">
								<div className="overflow-hidden rounded-[16px]">
									<ol aria-label="Event timeline">
										{activity.data?.map((event) => (
											<ActivityRow
												key={event.id}
												event={event}
												eventPath={`${personPath}/events/${encodeURIComponent(event.id)}`}
												search={search}
											/>
										))}
									</ol>
								</div>
							</Frame>
						)}
					</div>
				</section>
			</div>

			<SheetFooter className="border-t border-border">
				{canManage ? (
					confirmingDelete ? (
						<div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2">
							<label
								htmlFor="delete-confirm"
								className="w-full text-[12px] text-text-subtle"
							>
								Type <code className="tabular-nums">delete</code> to confirm:
							</label>
							<Input
								id="delete-confirm"
								value={confirmText}
								onChange={(event) => setConfirmText(event.target.value)}
								placeholder="delete"
								autoComplete="off"
								className="h-8 min-w-0 flex-1 basis-40 tabular-nums text-[12.5px]"
								aria-describedby="delete-confirm-hint"
							/>
							<p id="delete-confirm-hint" className="sr-only">
								The destructive action requires typing the word delete exactly.
							</p>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-8"
								disabled={deleting}
								onClick={() => {
									setConfirmingDelete(false);
									setConfirmText("");
									setDeleteError(null);
								}}
							>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								className="h-8 bg-danger text-white hover:bg-danger/90"
								disabled={confirmText !== "delete" || deleting}
								onClick={() => void handleDelete()}
							>
								{deleting ? "Deleting…" : "Confirm delete"}
							</Button>
							{deleteError ? (
								<p className="w-full text-[12px] text-destructive" role="alert">
									{deleteError}
								</p>
							) : null}
						</div>
					) : (
						<div className="flex w-full items-center gap-2">
							<span
								className="min-w-0 flex-1 truncate text-[11px] text-text-subtle"
								title={data.personId}
							>
								{data.personId}
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="h-8 shrink-0 gap-1.5"
								onClick={() => void handleExport()}
								disabled={exporting}
							>
								<Download className="size-3.5" aria-hidden="true" />
								{exporting ? "Exporting…" : "Export person data"}
							</Button>
							{exportError ? (
								<p className="text-[12px] text-destructive" role="alert">
									{exportError}
								</p>
							) : null}
							<Button
								type="button"
								size="sm"
								variant="destructive"
								className="h-8 shrink-0 bg-danger text-primary-foreground hover:bg-danger/90"
								onClick={() => setConfirmingDelete(true)}
							>
								Delete person
							</Button>
						</div>
					)
				) : (
					<div className="flex w-full items-center gap-2">
						<span
							className="min-w-0 flex-1 truncate text-[11px] text-text-subtle"
							title={data.personId}
						>
							{data.personId}
						</span>
						<span className="shrink-0 text-[11px] text-text-subtle">
							Owners and admins can export or delete this person.
						</span>
					</div>
				)}
			</SheetFooter>
		</>
	);
}

export function PersonPresentationStack() {
	const {
		slug,
		wrkSlug,
		personId,
		"*": splat,
	} = useParams<{
		slug: string;
		wrkSlug: string;
		personId: string;
		"*": string;
	}>();
	const location = useLocation();
	const navigate = useNavigate();
	const listBase = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/people`;
	const parsed = React.useMemo(
		() => parsePersonPresentationStack(listBase, personId, splat),
		[listBase, personId, splat],
	);

	React.useEffect(() => {
		if (!parsed.valid) {
			navigate({ pathname: listBase, search: location.search }, { replace: true });
		}
	}, [listBase, location.search, navigate, parsed.valid]);

	if (!parsed.valid) return null;

	const renderLayer = (layer: PersonPresentationLayer) => {
		if (layer.kind === "event") {
			const personLayer = parsed.layers[0];
			if (!personLayer || personLayer.kind !== "person") return null;
			return (
				<PersonEventLayer
					slug={slug}
					personId={personLayer.resourceId}
					eventId={layer.resourceId}
					personPath={personLayer.path}
					search={location.search}
				/>
			);
		}
		return (
			<PersonProfile
				slug={slug}
				personId={layer.resourceId}
				listBase={listBase}
				search={location.search}
			/>
		);
	};

	return (
		<PresentationStack
			items={parsed.layers}
			onDismiss={(layer) =>
				navigate({ pathname: layer.parentPath, search: location.search })
			}
			renderItem={renderLayer}
		/>
	);
}
