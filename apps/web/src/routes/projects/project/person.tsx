import type { EventResource, PersonDetailResource } from "@prism-analytics/types";
import { ArrowLeft, Download } from "lucide-react";
import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Frame, SectionLabel } from "@/components/public/frame";
import { MetricCard } from "@/components/public/metric-card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { axiosInstance } from "@/utils/axiosInstance";
import { platformDotClass, platformLabel } from "@/lib/events";
import { useActiveMember } from "@/lib/workspace";
import { usePersonActivityQuery, usePersonQuery } from "@/network/queries/usePeopleQueries";
import { cn } from "@/lib/utils";

/**
 * Person profile (task-20): answers "who is this user and what did they
 * do?" — display identity from explicit traits, a bounded summary, supplied
 * traits, linked identities (anonymous history collapsed), technical
 * details, and a source-aware activity timeline that opens the canonical
 * Events detail. Export/delete are owner/admin actions in the UI and are
 * enforced independently by the API.
 */

const PROFILE_KEYS = ["name", "username", "email", "avatarUrl"] as const;

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

function formatTraitValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
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
			<span className="min-w-0 break-all font-mono text-[12px] text-text">{id}</span>
			<span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle">
				{kind}
			</span>
		</div>
	);
}

function ActivityRow({ event, basePath }: { event: EventResource; basePath: string }) {
	const displayName =
		event.standardEvent?.displayName ?? event.name ?? "Unknown event";
	const platform = event.platform ?? event.source?.platform ?? null;
	return (
		<li>
			<Link
				to={`${basePath}/events/${encodeURIComponent(event.id)}`}
				className="group flex items-center gap-3 border-t border-border px-1 py-2.5 transition-colors first:border-t-0 hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-focus"
			>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[13px] font-medium leading-none text-text group-hover:text-link">
						{displayName}
					</span>
					<span className="mt-1.5 flex items-center gap-2">
						{platform ? (
							<>
								<span
									className={cn("size-1.5 shrink-0 rounded-full", platformDotClass(platform))}
									aria-hidden="true"
								/>
								<span className="truncate font-mono text-[10.5px] leading-none text-text-subtle">
									{event.source?.name ?? platformLabel(platform)}
								</span>
							</>
						) : null}
						{event.sessionId ? (
							<span className="truncate font-mono text-[10.5px] leading-none text-text-subtle" title={event.sessionId}>
								· {event.sessionId.slice(0, 8)}…
							</span>
						) : null}
					</span>
				</span>
				<time
					dateTime={new Date(event.occurredAt).toISOString()}
					className="shrink-0 font-mono text-[11px] leading-none text-text-muted tabular-nums"
				>
					{fullTimestamp(event.occurredAt)}
				</time>
			</Link>
		</li>
	);
}

export function PersonDetail() {
	const { slug, personId, wrkSlug } = useParams<{
		slug: string;
		personId: string;
		wrkSlug: string;
	}>();
	const navigate = useNavigate();
	const activeMember = useActiveMember();
	const canManage =
		activeMember?.data?.role === "owner" || activeMember?.data?.role === "admin";
	const { data, isLoading, isError, refetch } = usePersonQuery(slug, personId);
	const activity = usePersonActivityQuery(slug, personId);
	const [confirmText, setConfirmText] = React.useState("");
	const [deleting, setDeleting] = React.useState(false);
	const [deleteError, setDeleteError] = React.useState<string | null>(null);
	const [exporting, setExporting] = React.useState(false);
	const [exportError, setExportError] = React.useState<string | null>(null);

	const basePath = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}`;

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
			navigate(`${basePath}/people`);
		} catch {
			setDeleteError("Deletion failed. Try again.");
			setDeleting(false);
		}
	};

	if (isLoading) {
		return (
			<div className="grid gap-4" aria-busy="true" aria-label="Loading person">
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	if (isError || !data) {
		return (
			<ErrorState
				title="Could not load person"
				description="Prism could not reach the people store. Check your connection and try again."
				onRetry={() => refetch()}
			/>
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
	const linkedIdsCount = data.externalIds.length + data.anonymousIds.length;

	return (
		<div className="flex flex-1 flex-col">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<Link
						to={`${basePath}/people`}
						className="inline-flex items-center gap-1.5 rounded-[2px] font-mono text-[11px] text-text-subtle transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
					>
						<ArrowLeft className="size-3" aria-hidden="true" />
						Back to People
					</Link>
					<h1 className="mt-2 truncate font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
						{displayName}
					</h1>
					{showPrimaryId && data.primaryExternalId ? (
						<p
							className="mt-1 truncate font-mono text-[12.5px] leading-none text-text-subtle"
							title={data.primaryExternalId}
						>
							{data.primaryExternalId}
						</p>
					) : null}
				</div>
			</div>

			<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
				<MetricCard label="Sessions" caption="distinct project sessions">
					<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text tabular-nums">
						{data.sessionCount.toLocaleString("en-US")}
					</span>
				</MetricCard>
				<MetricCard label="Events" caption="accepted event occurrences">
					<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text tabular-nums">
						{data.eventCount.toLocaleString("en-US")}
					</span>
				</MetricCard>
				<MetricCard
					label="Linked IDs"
					caption={`${data.externalIdentityCount} external · ${data.anonymousIdentityCount} anonymous`}
				>
					<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text tabular-nums">
						{linkedIdsCount.toLocaleString("en-US")}
					</span>
				</MetricCard>
			</div>

			<div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-2">
				<section>
					<SectionLabel>Identity</SectionLabel>
					<div className="mt-3 grid grid-cols-1 gap-3">
						<Frame inset className="px-3 py-3">
							<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
								Email
							</div>
							<div className="break-all font-mono text-[12.5px] leading-[1.5] text-text">
								{email ?? <span className="text-text-subtle">Not supplied</span>}
							</div>
						</Frame>
						<Frame inset className="px-3 py-3">
							<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
								Username
							</div>
							<div className="break-all font-mono text-[12.5px] leading-[1.5] text-text">
								{username ?? <span className="text-text-subtle">Not supplied</span>}
							</div>
						</Frame>
						{profileEntries.length > 0 ? (
							<Frame inset className="px-3 py-3">
								<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
									Supplied traits
								</div>
								<dl className="grid gap-1.5">
									{profileEntries.map(([key, value]) => (
										<div key={key} className="flex items-baseline justify-between gap-4">
											<dt className="min-w-0 truncate font-mono text-[11px] text-text-subtle">{key}</dt>
											<dd className="min-w-0 break-all text-right font-mono text-[12px] text-text">
												{formatTraitValue(value)}
											</dd>
										</div>
									))}
								</dl>
							</Frame>
						) : null}
					</div>
				</section>

				<section>
					<SectionLabel>Linked identities</SectionLabel>
					<div className="mt-3">
						{linkedIdsCount === 0 ? (
							<Frame inset className="border-dashed bg-surface/40 px-3 py-6 text-center">
								<p className="font-mono text-[12px] leading-none text-text-subtle">
									No linked identities.
								</p>
							</Frame>
						) : (
							<Frame inset className="p-0">
								<div className="overflow-hidden rounded-[2px]">
									{data.externalIds.map((id) => (
										<div key={`ext-${id}`} className="border-t border-border px-3 first:border-t-0">
											<IdentityRow id={id} kind="external" />
										</div>
									))}
									{data.anonymousIds.length > 0 ? (
										<details className="border-t border-border px-3 py-2">
											<summary className="cursor-pointer font-mono text-[11px] text-text-subtle transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-focus">
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

					<div className="mt-7">
						<SectionLabel>Technical details</SectionLabel>
						<div className="mt-3 grid grid-cols-1 gap-3">
							<Frame inset className="px-3 py-3">
								<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
									Prism person ID
								</div>
								<div className="break-all font-mono text-[12px] leading-[1.5] text-text-muted">
									{data.personId}
								</div>
							</Frame>
							<Frame inset className="px-3 py-3">
								<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
									First seen
								</div>
								<div className="font-mono text-[12px] leading-[1.5] text-text-muted tabular-nums">
									{fullTimestamp(data.firstSeenAt)}
								</div>
							</Frame>
							<Frame inset className="px-3 py-3">
								<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
									Last seen
								</div>
								<div className="font-mono text-[12px] leading-[1.5] text-text-muted tabular-nums">
									{fullTimestamp(data.lastSeenAt)}
								</div>
							</Frame>
						</div>
					</div>
				</section>
			</div>

			<section className="mt-7">
				<div className="flex items-center justify-between gap-2">
					<SectionLabel className="leading-none">Activity</SectionLabel>
					<span className="font-mono text-[10px] text-text-subtle">newest first</span>
				</div>
				<div className="mt-3">
					{activity.isLoading ? (
						<div aria-busy="true" aria-label="Loading activity">
							<Skeleton className="h-[46px] w-full rounded-[2px]" />
							<Skeleton className="mt-2 h-[46px] w-full rounded-[2px]" />
							<Skeleton className="mt-2 h-[46px] w-full rounded-[2px]" />
						</div>
					) : activity.isError ? (
						<Frame className="border-dashed bg-surface/40 px-3 py-6 text-center">
							<p className="font-mono text-[12px] text-text-subtle">
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
							<p className="font-mono text-[12px] leading-none text-text-subtle">
								No events recorded under this person's identities yet.
							</p>
						</Frame>
					) : (
						<Frame className="p-0">
							<div className="overflow-hidden rounded-[2px]">
								<ol aria-label="Event timeline">
									{activity.data?.map((event) => (
										<ActivityRow key={event.id} event={event} basePath={basePath} />
									))}
								</ol>
							</div>
						</Frame>
					)}
				</div>
			</section>

			{canManage ? (
				<section className="mt-7 mb-8" aria-label="Data controls">
					<SectionLabel>Data controls</SectionLabel>
					<div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
						<Frame inset className="px-3 py-3">
							<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
								Export
							</div>
							<p className="text-[12.5px] leading-[1.5] text-text-muted">
								Download this person's documented analytics data: identity
								references, supplied traits, sessions, events, and error
								occurrences.
							</p>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="mt-3 h-8 gap-1.5"
								onClick={() => void handleExport()}
								disabled={exporting}
							>
								<Download className="size-3.5" aria-hidden="true" />
								{exporting ? "Exporting…" : "Export person data"}
							</Button>
							{exportError ? (
								<p className="mt-2 text-[12px] text-destructive" role="alert">
									{exportError}
								</p>
							) : null}
						</Frame>
						<Frame className="border-destructive/40 px-3 py-3">
							<div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-destructive">
								Permanent deletion
							</div>
							<p className="text-[12.5px] leading-[1.5] text-text-muted">
								Removing this person deletes their identity links, traits,
								sessions, and events permanently. A future
								<code className="mx-1 font-mono text-[11.5px]">identify()</code>
								with the same external ID starts a fresh person — deleted
								history never returns.
							</p>
							<label
								htmlFor="delete-confirm"
								className="mt-3 block text-[12px] text-text-subtle"
							>
								Type <code className="font-mono">delete</code> to confirm:
							</label>
							<Input
								id="delete-confirm"
								value={confirmText}
								onChange={(event) => setConfirmText(event.target.value)}
								placeholder="delete"
								className="mt-1.5 h-8 max-w-[220px] font-mono text-[12.5px]"
								aria-describedby="delete-confirm-hint"
							/>
							<p id="delete-confirm-hint" className="sr-only">
								The destructive action requires typing the word delete exactly.
							</p>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								className="mt-2 h-8"
								onClick={() => void handleDelete()}
								disabled={confirmText !== "delete" || deleting}
							>
								{deleting ? "Deleting…" : "Delete person"}
							</Button>
							{deleteError ? (
								<p className="mt-2 text-[12px] text-destructive" role="alert">
									{deleteError}
								</p>
							) : null}
						</Frame>
					</div>
				</section>
			) : null}
		</div>
	);
}
