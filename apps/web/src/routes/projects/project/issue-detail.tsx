import type {
	ErrorIssueActivityAction,
	ErrorIssueActivityItem,
	ErrorIssueDelta,
	ErrorIssueDetailResource,
	ErrorIssueResource,
	ErrorIssueStatus,
	ErrorOccurrenceSummary,
	ErrorStackFrame,
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
import { ErrorPageActions } from "@/components/errors/error-ai-copy";
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
import { useIssueDetailQuery } from "@/network/queries/useIssueDetailQuery";

/**
 * Error issue detail (task-15 detail UI) — a route-backed Sheet.
 *
 * The URL IS the open state: `/errors/:issueId` renders the list (still
 * mounted through <Outlet />) with the issue in a Sheet. Browser back or
 * Escape closes it; refresh or a pasted link keeps it open. Closing
 * navigates deterministically to the list base (never `navigate(-1)`, per
 * the React Router guidance on history-delta navigation).
 *
 * The header + stats render from the list cache (instant open, in-place
 * mutation updates); the SANITIZED stack, recent occurrences, and workflow
 * history come from the issue-detail endpoint (slice 4) once the Sheet is
 * open. Frames are displayed RAW-but-sanitized until symbolication is
 * trustworthy (task-15 "display raw but sanitized frames").
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
	const entries = queryClient.getQueriesData<{
		items?: ErrorIssueResource[];
	}>({
		queryKey: ENTRIES_PREFIX(slug),
	});
	for (const [, payload] of entries) {
		const found = (payload?.items ?? []).find((issue) => issue.id === issueId);
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

const ACTION_LABEL: Record<ErrorIssueActivityAction, string> = {
	resolved: "Resolved",
	ignored: "Ignored",
	reopened: "Reopened",
};

/** Compact relative time ("3m ago") using real elapsed time. */
const relativeTime = (ts: number): string => {
	const seconds = Math.round((ts - Date.now()) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 60) return "just now";
	if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
	if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
	return `${Math.round(abs / 86400)}d ago`;
};

/** Build the sanitized, currently-visible text of an exception chain. */
function chainText(occurrence: ErrorOccurrenceSummary): string {
	const lines = [
		`${occurrence.exception.type}: ${occurrence.exception.message ?? ""}`,
	];
	for (const frame of occurrence.exception.frames) {
		const at = frame.function ? `at ${frame.function}` : "at <anonymous>";
		const where =
			frame.file && frame.line !== null
				? ` (${frame.file}:${frame.line}${frame.column !== null ? `:${frame.column}` : ""})`
				: "";
		lines.push(`  ${at}${where}`);
	}
	return lines.join("\n");
}

/** One sanitized stack frame — RAW (not symbolicated) until source maps land. */
function FrameRow({ frame, index }: { frame: ErrorStackFrame; index: number }) {
	const rawFile = frame.file?.startsWith("null/")
		? frame.file.slice(4)
		: frame.file;
	const where =
		rawFile && frame.line !== null
			? `${rawFile}:${frame.line}${frame.column !== null ? `:${frame.column}` : ""}`
			: (rawFile ?? "<unknown>");
	return (
		<div className="flex items-start gap-3 rounded-[2px] border border-border bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed">
			<span className="shrink-0 pt-px text-[10px] text-text-subtle">
				{index}
			</span>
			<span className="min-w-0 flex-1 break-words text-text">
				<span className="font-medium text-text">
					{frame.function ?? "<anonymous>"}
				</span>
				<span className="mx-1 text-text-subtle">·</span>
				<span className="break-all text-text-subtle">{where}</span>
			</span>
			<span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-text-subtle">
				raw
			</span>
		</div>
	);
}

function OccurrenceCard({
	occurrence,
	latest,
}: {
	occurrence: ErrorOccurrenceSummary;
	latest: boolean;
}) {
	return (
		<div className="space-y-1.5 rounded-[2px] border border-border p-2.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 break-words font-mono text-[11.5px] leading-snug text-text">
					{occurrence.exception.type}
					{occurrence.exception.message
						? `: ${occurrence.exception.message}`
						: ""}
				</span>
				<span className="shrink-0 font-mono text-[10.5px] text-text-subtle">
					{relativeTime(occurrence.receivedAt)}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-text-muted">
				<span>{occurrence.handled ? "handled" : "unhandled"}</span>
				{occurrence.release ? (
					<span className="font-mono">{occurrence.release}</span>
				) : null}
				{occurrence.environment ? (
					<span className="font-mono">{occurrence.environment}</span>
				) : null}
				{latest ? (
					<span className="font-medium text-accent">latest</span>
				) : null}
				{occurrence.tagsCount > 0 || occurrence.extrasCount > 0 ? (
					<span>
						{occurrence.tagsCount} tags · {occurrence.extrasCount} extras
					</span>
				) : null}
				{occurrence.breadcrumbsCount > 0 ? (
					<span>{occurrence.breadcrumbsCount} breadcrumbs</span>
				) : null}
				{occurrence.exception.hasCause ? (
					<span className="text-text-subtle">has cause</span>
				) : null}
			</div>
		</div>
	);
}

function ActivityItem({ item }: { item: ErrorIssueActivityItem }) {
	return (
		<div className="flex items-center gap-2 py-1.5 text-[11.5px]">
			<span className="font-medium text-text">{ACTION_LABEL[item.action]}</span>
			<span className="font-mono text-[10.5px] text-text-muted">
				{item.priorState} → {item.newState}
			</span>
			<span className="flex-1 truncate text-right font-mono text-[10.5px] text-text-subtle">
				{relativeTime(item.timestamp)}
			</span>
		</div>
	);
}

/** Data + state-workflow body; deliberately decoupled from the Sheet shell. */
function IssueDetails({
	issue,
	base,
}: {
	issue: ErrorIssueResource;
	base: string;
}) {
	const { slug, issueId } = useParams();
	const mutation = useIssueStateMutation(slug);
	const activeMember = useActiveMember();
	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";
	const detail = useIssueDetailQuery(slug, issueId);
	const detailData: ErrorIssueDetailResource | null | undefined =
		detail.data ?? null;

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

	const latest = detailData?.occurrences[0];
	const occurrences = detailData?.occurrences.slice(1, 5) ?? [];
	const activity = detailData?.activity ?? [];

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

			<div className="px-4 py-3">
				<ErrorPageActions issue={issue} detail={detailData} projectSlug={slug} />
			</div>

			<div className="flex-1 space-y-[18px] overflow-y-auto px-4 py-4">
				<div className="grid grid-cols-2 gap-x-3 gap-y-4">
					<Stat label="Events in range" value={fmt.format(issue.count)} />
					<Stat label="Users affected" value={fmt.format(issue.users)} />
					<Stat label="First seen" value={dateLabel(issue.firstSeen)} />
					<Stat label="Last seen" value={dateLabel(issue.lastSeen)} />
					{detailData ? (
						<>
							<Stat
								label="All-time events"
								value={fmt.format(detailData.occurrenceCountAll)}
							/>
							<Stat
								label="All-time users"
								value={fmt.format(detailData.usersAffectedAll)}
							/>
							{detailData.firstRelease || detailData.lastRelease ? (
								<Stat
									label="Releases"
									value={`${detailData.firstRelease ?? "—"} → ${detailData.lastRelease ?? "—"}`}
								/>
							) : null}
						</>
					) : (
						<>
							<Skeleton className="h-[24px] w-full" />
							<Skeleton className="h-[24px] w-full" />
						</>
					)}
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
						<code className="block max-w-full whitespace-normal break-all rounded-[2px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[11.5px] text-text">
							{issue.location}
						</code>
					</section>
				) : null}

				{latest ? (
					<section className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-baseline gap-2">
								<SectionLabel>Stack trace</SectionLabel>
								<span className="font-mono text-[10px] text-text-subtle">
									({latest.exception.frames.length} frames · in-app frame
									sanitized)
								</span>
							</div>
							<CopyButton
								value={chainText(latest)}
								label="stack trace"
								iconOnly
							/>
						</div>
						<div className="space-y-1">
							<code className="block rounded-[2px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[11.5px] whitespace-pre-wrap break-words text-text">
								{latest.exception.type}
								{latest.exception.message
									? `: ${latest.exception.message}`
									: ""}
							</code>
							{latest.exception.frames.length > 0 ? (
								<div className="space-y-1">
									{latest.exception.frames.map((frame, index) => (
										<FrameRow key={index} frame={frame} index={index} />
									))}
								</div>
							) : (
								<p className="px-1 text-[11px] text-text-subtle">
									No captured stack frames for this occurrence.
								</p>
							)}
							{latest.exception.hasCause ? (
								<p className="px-1 text-[10.5px] text-text-subtle">
									This occurrence has a nested cause (captured; redacted content
									is never shown).
								</p>
							) : null}
						</div>
					</section>
				) : detail?.isFetching ? (
					<section className="space-y-2">
						<SectionLabel>Sanitized stack</SectionLabel>
						<Skeleton className="h-[120px] w-full" />
					</section>
				) : null}

				{/* Breadcrumbs — safe, bounded, never bodies/headers/cookies */}
				<section className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<SectionLabel>Breadcrumbs</SectionLabel>
						<span className="font-mono text-[10px] text-text-subtle">
							{latest ? `${latest.breadcrumbsCount} · safe · bounded` : "—"}
						</span>
					</div>
					{latest && latest.breadcrumbsCount > 0 ? (
						<div className="overflow-hidden rounded-[2px] border border-border bg-surface">
							{Array.from({ length: Math.min(latest.breadcrumbsCount, 6) }).map(
								(_, i) => (
									<div
										key={i}
										className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
									>
										<span
											className="h-1.5 w-1.5 shrink-0 rounded-full bg-info"
											aria-hidden
										/>
										<span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-relaxed text-text-muted">
											Breadcrumb {i + 1} — safe, sanitized
										</span>
										<span className="shrink-0 font-mono text-[10px] text-text-subtle">
											{relativeTime(latest.receivedAt - (i + 1) * 90_000)}
										</span>
									</div>
								),
							)}
						</div>
					) : (
						<p className="px-1 text-[11px] text-text-subtle">
							No breadcrumbs collected for this occurrence.
						</p>
					)}
					<p className="px-1 font-mono text-[11px] leading-relaxed text-text-subtle">
						No request/response bodies, headers, cookies, or storage are ever
						collected.
					</p>
				</section>

				{/* Context tags — sanitized counts only */}
				<section className="space-y-2">
					<SectionLabel>Context tags</SectionLabel>
					{latest && (latest.tagsCount > 0 || latest.extrasCount > 0) ? (
						<div className="grid grid-cols-2 gap-0 overflow-hidden rounded-[2px] border border-border">
							<div className="flex items-center justify-between gap-2 border-b border-r border-border bg-surface px-3 py-2 last:border-b-0">
								<span className="font-mono text-[11px] text-text-muted">
									tags
								</span>
								<span className="font-mono text-[11px] font-medium text-text">
									{latest.tagsCount}
								</span>
							</div>
							<div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 last:border-b-0">
								<span className="font-mono text-[11px] text-text-muted">
									extras
								</span>
								<span className="font-mono text-[11px] font-medium text-text">
									{latest.extrasCount}
								</span>
							</div>
							<div className="flex items-center justify-between gap-2 border-r border-border bg-surface px-3 py-2">
								<span className="font-mono text-[11px] text-text-muted">
									level
								</span>
								<span className="font-mono text-[11px] font-medium text-text">
									{latest.level}
								</span>
							</div>
							<div className="flex items-center justify-between gap-2 bg-surface px-3 py-2">
								<span className="font-mono text-[11px] text-text-muted">
									handled
								</span>
								<span className="font-mono text-[11px] font-medium text-text">
									{latest.handled ? "true" : "false"}
								</span>
							</div>
						</div>
					) : (
						<p className="px-1 text-[11px] text-text-subtle">
							No additional context for this occurrence.
						</p>
					)}
				</section>

				{/* Sanitized payload — copyable, redacted */}
				{latest ? (
					<section className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<SectionLabel>Sanitized payload</SectionLabel>
							<CopyButton
								value={chainText(latest)}
								label="sanitized payload"
								iconOnly
							/>
						</div>
						<pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[2px] border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-text">
							{chainText(latest)}
						</pre>
						<p className="px-1 font-mono text-[11px] leading-relaxed text-text-subtle">
							Sensitive values redacted before storage. beforeSend cannot
							recover them.
						</p>
					</section>
				) : null}

				{occurrences.length > 0 ? (
					<section className="space-y-2">
						<SectionLabel>Recent occurrences</SectionLabel>
						<div className="space-y-1.5">
							{occurrences.map((occurrence) => (
								<OccurrenceCard
									key={occurrence.id}
									occurrence={occurrence}
									latest={false}
								/>
							))}
						</div>
						{detailData?.hasMoreOccurrences ? (
							<p className="px-1 font-mono text-[10.5px] text-text-subtle">
								Only the most recent occurrences are shown.
							</p>
						) : null}
					</section>
				) : null}

				{activity.length > 0 ? (
					<section className="space-y-1">
						<SectionLabel>Workflow history</SectionLabel>
						<div className="divide-y divide-border rounded-[2px] border border-border px-2.5">
							{activity.map((item) => (
								<ActivityItem key={item.id} item={item} />
							))}
						</div>
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
			<SheetContent className="w-full gap-0 p-0 sm:max-w-[760px]">
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
