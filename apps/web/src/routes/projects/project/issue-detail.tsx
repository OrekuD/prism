import type {
	ErrorIssueDelta,
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";
import { useQueryClient } from "@tanstack/react-query";
import React, { useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
	DeltaTag,
	PlatformLevelTag,
	StatusTag,
	dateLabel,
} from "@/components/errors/issue-visuals";
import { SectionLabel } from "@/components/public/frame";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABELS } from "@/lib/errorIssues";
import { useActiveMember } from "@/lib/workspace";
import { useIssueStateMutation } from "@/network/mutations/useIssueStateMutation";

/**
 * Error issue detail (task-15 detail UI) — a route-backed Sheet.
 *
 * The URL IS the open state: `/errors/:issueId` renders the list (still
 * mounted through <Outlet />) with the issue in a Sheet. Browser back or
 * Escape closes it; refresh or a pasted link keeps it open. Closing
 * navigates deterministically to the list base (never `navigate(-1)`, per
 * the React Router guidance on history-delta navigation).
 *
 * The data-rendering <IssueDetails /> is separated from the sheet shell so
 * it can later render inside a full page, dialog, or mobile view too.
 */

/** Keep the labels/dates on one formatter for the sheet body. */
const fmt = new Intl.NumberFormat();

const ENTRIES_PREFIX = (slug: string | undefined) => ["project-issues", slug];

function findIssue(
	queryClient: ReturnType<typeof useQueryClient>,
	slug: string | undefined,
	issueId: string | undefined,
): ErrorIssueResource | undefined {
	if (!slug || !issueId) return undefined;
	const entries = queryClient.getQueriesData<ErrorIssueResource[]>({
		queryKey: ENTRIES_PREFIX(slug),
	});
	for (const [, issues] of entries) {
		const found = (issues ?? []).find((issue) => issue.id === issueId);
		if (found) return found;
	}
	return undefined;
}

/** Reactive read of the issue from the list cache (all loaded ranges). */
function useIssueFromCache(
	slug: string | undefined,
	issueId: string | undefined,
): ErrorIssueResource | undefined {
	const queryClient = useQueryClient();
	return useSyncExternalStore(
		(callback) => queryClient.getQueryCache().subscribe(callback),
		() => findIssue(queryClient, slug, issueId),
		() => undefined,
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
				{label}
			</span>
			<span className="truncate font-mono text-[14px] font-[500] tracking-[-0.01em] text-text">
				{value}
			</span>
		</div>
	);
}

const DELTA_CAPTION: Record<Exclude<ErrorIssueDelta, null>, string> = {
	new: "First occurrence within this range.",
	regressing: "More events than the previous window.",
	declining: "Fewer events than the previous window.",
};

/** Data + state-workflow body; deliberately decoupled from the Sheet shell. */
function IssueDetails({
	issue,
	base,
}: {
	issue: ErrorIssueResource;
	base: string;
}) {
	const { slug } = useParams();
	const mutation = useIssueStateMutation(slug);
	const activeMember = useActiveMember();
	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";

	const setStatus = (status: ErrorIssueStatus) => {
		if (mutation.isPending) return;
		mutation.mutate({ issueId: issue.id, status });
	};

	const next: ErrorIssueStatus =
		issue.status === "unresolved" ? "resolved" : "unresolved";
	const primaryLabel =
		issue.status === "unresolved"
			? "Resolve"
			: issue.status === "resolved"
				? "Reopen"
				: "Stop ignoring";

	const trendCaption =
		issue.delta === null
			? "No previous window to compare against."
			: DELTA_CAPTION[issue.delta];

	return (
		<>
			<SheetHeader className="gap-2 border-b border-border pr-10">
				<div className="flex flex-wrap items-center gap-1.5">
					<PlatformLevelTag platform={issue.platform} level={issue.level} />
					<StatusTag status={issue.status} />
					<DeltaTag delta={issue.delta} />
				</div>
				<SheetTitle className="font-mono text-[17px] leading-snug font-[550] tracking-[-0.012em] text-text">
					{issue.title}
				</SheetTitle>
				<SheetDescription className="font-mono text-[12px] text-text-subtle">
					{issue.location ?? "No captured top-frame location."}
				</SheetDescription>
			</SheetHeader>

			<div className="flex-1 space-y-[18px] overflow-y-auto px-4 py-4">
				<div className="grid grid-cols-2 gap-x-3 gap-y-4">
					<Stat label="Events in range" value={fmt.format(issue.count)} />
					<Stat label="Users affected" value={fmt.format(issue.users)} />
					<Stat label="First seen" value={dateLabel(issue.firstSeen)} />
					<Stat label="Last seen" value={dateLabel(issue.lastSeen)} />
				</div>

				<section className="space-y-2">
					<SectionLabel>Fingerprint</SectionLabel>
					<div className="flex items-center gap-2">
						<code className="min-w-0 flex-1 truncate rounded-[2px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[11.5px] text-text-muted">
							{issue.fingerprint}
						</code>
						<CopyButton
							value={issue.fingerprint}
							label="fingerprint"
							iconOnly
						/>
					</div>
				</section>

				<section className="space-y-2">
					<SectionLabel>Trend</SectionLabel>
					<div className="flex items-center gap-2">
						<DeltaTag delta={issue.delta} />
						<span className="text-[12px] leading-[1.4] text-text-subtle">
							{trendCaption}
						</span>
					</div>
				</section>

				{issue.location ? (
					<section className="space-y-2">
						<SectionLabel>Location</SectionLabel>
						<code className="block overflow-x-auto rounded-[2px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[11.5px] whitespace-nowrap text-text">
							{issue.location}
						</code>
					</section>
				) : null}
			</div>

			<SheetFooter className="border-t border-border">
				{canManage ? (
					<div className="flex w-full items-center justify-between gap-2">
						<span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">
							{STATUS_LABELS[issue.status]}
						</span>
						<div className="flex items-center gap-2">
							{issue.status === "unresolved" ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setStatus("ignored")}
									disabled={mutation.isPending}
								>
									Ignore
								</Button>
							) : null}
							<Button
								variant={issue.status === "ignored" ? "outline" : "default"}
								size="sm"
								onClick={() => setStatus(next)}
								disabled={mutation.isPending}
							>
								{primaryLabel}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex w-full items-center justify-between gap-2">
						<span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">
							{STATUS_LABELS[issue.status]}
						</span>
						<span className="text-[11px] text-text-subtle">
							Owner or admin can change issue state
						</span>
					</div>
				)}
			</SheetFooter>
		</>
	);
}

function IssueDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4 p-4">
			<Skeleton className="h-[16px] w-3/4" />
			<Skeleton className="h-[12px] w-1/2" />
			<div className="mt-2 grid grid-cols-2 gap-4">
				<Skeleton className="h-[24px] w-full" />
				<Skeleton className="h-[24px] w-full" />
				<Skeleton className="h-[24px] w-full" />
				<Skeleton className="h-[24px] w-full" />
			</div>
		</div>
	);
}

function IssueMissing({ base }: { base: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="font-mono text-[13px] text-text-muted">
				This issue isn't in the loaded range.
			</p>
			<span className="max-w-[300px] text-[12px] leading-[1.5] text-text-subtle">
				It may have fallen outside the current range filters, or the project's
				issue list was cleared.
			</span>
			<Link to={base} className="mt-1 font-medium text-link hover:underline">
				Back to all errors
			</Link>
		</div>
	);
}

export function IssueDetail() {
	const { slug, wrkSlug, issueId } = useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const issue = useIssueFromCache(slug, issueId);

	const listPending = queryClient
		.getQueryCache()
		.findAll({ queryKey: ENTRIES_PREFIX(slug) })
		.some((query) => query.state.status === "pending");

	const base = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/errors`;

	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) navigate(base);
			}}
		>
			<SheetContent className="w-full gap-0 p-0 sm:max-w-[560px]">
				{issue ? (
					<IssueDetails issue={issue} base={base} />
				) : listPending ? (
					<IssueDetailSkeleton />
				) : (
					<IssueMissing base={base} />
				)}
			</SheetContent>
		</Sheet>
	);
}
