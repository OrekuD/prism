import {
	Check,
	ChevronLeft,
	ChevronRight,
	Eye,
	RotateCcw,
	Search,
	TriangleAlert,
} from "lucide-react";
import React from "react";
import {
	Link,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";

import { MetricCard } from "@/components/public/metric-card";
import { PageHeader } from "@/components/public/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Frame } from "@/components/public/frame";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
	DeltaTag,
	LevelTag,
	PlatformLevelTag,
	dateLabel,
} from "@/components/errors/issue-visuals";
import type {
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@/lib/errorIssues";
import { STATUS_LABELS } from "@/lib/errorIssues";
import { useActiveMember } from "@/lib/workspace";
import { useIssueStateMutation } from "@/network/mutations/useIssueStateMutation";
import {
	useIssuesQuery,
	type IssueListQuery,
} from "@/network/queries/useIssuesQuery";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { ErrorPresentationStack } from "@/routes/projects/project/issue-detail";

type StatusFilter = "all" | ErrorIssueStatus;
type LevelFilter = "all" | ErrorIssueLevel;
type PlatformFilter = "all" | ErrorIssuePlatform;

const RANGES: Array<{ key: string; label: string }> = [
	{ key: "24h", label: "24h" },
	{ key: "seven-days", label: "7d" },
	{ key: "two-weeks", label: "14d" },
	{ key: "one-month", label: "30d" },
];

const RANGE_LABEL: Record<string, string> = {
	"24h": "24 hours",
	"seven-days": "7 days",
	"two-weeks": "14 days",
	"one-month": "30 days",
};

const TH =
	"px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]";

const fmt = new Intl.NumberFormat();
const fmtCompact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const fmtC = (n: number) => fmtCompact.format(n).replace("K", "k");

function IssueAction({
	issue,
	slug,
	canManage,
}: {
	issue: ErrorIssueResource;
	slug: string | undefined;
	canManage: boolean;
}) {
	const mutation = useIssueStateMutation(slug);
	if (!canManage) return null;

	const nextStatus: ErrorIssueStatus =
		issue.status === "unresolved" ? "resolved" : "unresolved";
	const isUnresolved = issue.status === "unresolved";
	const isResolved = issue.status === "resolved";
	const label = isUnresolved
		? "Resolve"
		: isResolved
			? "Reopen"
			: "Stop ignoring";
	const Icon = isUnresolved ? Check : isResolved ? RotateCcw : Eye;

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={(e) => {
				e.stopPropagation();
				mutation.mutate({ issueId: issue.id, status: nextStatus });
			}}
			disabled={mutation.isPending}
			aria-label={label}
			title={label}
		>
			<Icon className="size-4" />
		</Button>
	);
}

export function ProjectErrors() {
	const { slug, wrkSlug } = useParams<{ slug: string; wrkSlug: string }>();
	const navigate = useNavigate();
	// URL is the source of truth for range + filters (task-15: preserved in
	// the URL). Changing any control refetches genuinely filtered server data.
	const [searchParams, setSearchParams] = useSearchParams();
	const range = searchParams.get("range") ?? "seven-days";
	const status = (searchParams.get("status") ?? "all") as StatusFilter;
	const level = (searchParams.get("level") ?? "all") as LevelFilter;
	const platform = (searchParams.get("platform") ?? "all") as PlatformFilter;
	const query = searchParams.get("q") ?? "";
	const searchTimer = React.useRef<number | null>(null);

	const updateFilter = (patch: Record<string, string | null>): void => {
		const next = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value === null || value === "" || value === "all") {
				next.delete(key);
			} else {
				next.set(key, value);
			}
		}
		// Changing a filter resets pagination to the first page.
		next.delete("cursor");
		setSearchParams(next, { replace: true });
	};

	const [limit, setLimit] = React.useState(10);
	const [cursorStack, setCursorStack] = React.useState<Array<string | null>>([
		null,
	]);
	const currentCursor = cursorStack[cursorStack.length - 1] ?? undefined;
	const pageIndex = cursorStack.length - 1;

	React.useEffect(() => {
		setCursorStack([null]);
	}, [range, status, level, platform, query, limit]);

	const queryParams: IssueListQuery = {
		range,
		status: status === "all" ? undefined : status,
		level: level === "all" ? undefined : level,
		platform: platform === "all" ? undefined : platform,
		q: query || undefined,
		cursor: currentCursor ?? undefined,
		limit,
	};
	const { data, isLoading, isError, isFetching, refetch } = useIssuesQuery(
		slug,
		queryParams,
	);
	const projectQuery = useProjectQuery({ slug, duration: "seven-days" });
	const activeMember = useActiveMember();

	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";

	const issues = data?.items ?? [];
	const nextCursor = data?.nextCursor ?? null;
	const hasNext = Boolean(nextCursor);
	const hasPrev = cursorStack.length > 1;
	const handleNext = () => {
		if (nextCursor) setCursorStack((prev) => [...prev, nextCursor]);
	};
	const handlePrev = () => {
		setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
	};

	const totalEvents = issues.reduce((sum, issue) => sum + issue.count, 0);
	const unresolvedCount = issues.filter(
		(issue) => issue.status === "unresolved",
	).length;
	const newInRange = issues.filter((issue) => issue.delta === "new").length;
	const usersAffected = issues.reduce((sum, issue) => sum + issue.users, 0);
	const statusCounts: Record<"all" | ErrorIssueStatus, number> = {
		all: issues.length,
		unresolved: unresolvedCount,
		resolved: issues.filter((issue) => issue.status === "resolved").length,
		ignored: issues.filter((issue) => issue.status === "ignored").length,
	};

	const projectName = (projectQuery.data as { name?: string } | undefined)
		?.name;
	const sourcesSetupPath = `/workspace/${wrkSlug}/projects/${slug}/sources/web/setup`;
	const hasNoIssues = issues.length === 0;
	const hasActiveFilter =
		status !== "all" || level !== "all" || platform !== "all" || !!query.trim();
	const showEmpty = hasNoIssues || issues.length === 0;

	return (
		<div className="flex flex-1 flex-col">
			<PageHeader
				title="Errors"
				description={`Grouped issues for ${
					projectName ?? "this project"
				} over the last ${RANGE_LABEL[range] ?? range}.`}
			/>

			{isLoading ? (
				<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard label="Error events" caption="occurrences in range">
						<Skeleton className="h-[23px] w-16 rounded-[2px]" />
					</MetricCard>
					<MetricCard label="Unresolved" caption="issues needing triage">
						<Skeleton className="h-[23px] w-12 rounded-[2px]" />
					</MetricCard>
					<MetricCard label="New in range" caption="first seen this range">
						<Skeleton className="h-[23px] w-12 rounded-[2px]" />
					</MetricCard>
					<MetricCard label="Users affected" caption="across all issues">
						<Skeleton className="h-[23px] w-16 rounded-[2px]" />
					</MetricCard>
				</div>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard label="Error events" caption="occurrences in range">
						<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text">
							{fmtC(totalEvents)}
						</span>
					</MetricCard>
					<MetricCard label="Unresolved" caption="issues needing triage">
						<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text">
							{fmtC(unresolvedCount)}
						</span>
					</MetricCard>
					<MetricCard label="New in range" caption="first seen this range">
						<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text">
							{fmtC(newInRange)}
						</span>
					</MetricCard>
					<MetricCard label="Users affected" caption="across all issues">
						<span className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text">
							{fmtC(usersAffected)}
						</span>
					</MetricCard>
				</div>
			)}

			<div className="mt-5 flex flex-wrap items-center gap-3">
				<fieldset className="m-0 inline-flex min-w-0 items-center overflow-hidden rounded-[2px] border border-border p-0">
					<legend className="sr-only">Issue status</legend>
					{(["all", "unresolved", "resolved", "ignored"] as const).map(
						(entry, index) => {
							const w =
								entry === "all"
									? "w-[72px]"
									: entry === "unresolved"
										? "w-[120px]"
										: entry === "resolved"
											? "w-[96px]"
											: "w-[92px]";
							return (
								<button
									key={entry}
									type="button"
									onClick={() => updateFilter({ status: entry })}
									className={cn(
										`inline-flex h-8 ${w} items-center justify-center gap-1.5 px-2 text-[13px] font-medium transition-colors`,
										index > 0 && "border-l border-border",
										status === entry
											? "bg-accent-soft text-text"
											: "text-text-muted hover:bg-surface-hover hover:text-text",
									)}
									aria-pressed={status === entry}
								>
									{entry === "all" ? "All" : STATUS_LABELS[entry]}
									<span
										className={cn(
											"font-mono text-[13px] font-medium tabular-nums leading-none",
											status === entry ? "text-accent" : "text-text-muted",
										)}
									>
										{fmtC(statusCounts[entry])}
									</span>
								</button>
							);
						},
					)}
				</fieldset>

				<div className="flex h-9 items-center gap-2 rounded-[2px] border border-border-strong bg-surface px-2.5">
					<Search className="size-[14px] text-text-subtle" aria-hidden="true" />
					<input
						type="search"
						value={query}
						onChange={(event) => {
							const raw = event.target.value;
							if (searchTimer.current) window.clearTimeout(searchTimer.current);
							if (raw.trim() === "") {
								updateFilter({ q: null });
								return;
							}
							searchTimer.current = window.setTimeout(() => {
								updateFilter({ q: raw });
							}, 300);
						}}
						placeholder="Search issues"
						aria-label="Search issues"
						className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-subtle"
					/>
				</div>

				<Select
					value={level}
					onValueChange={(value) => updateFilter({ level: value })}
				>
					<SelectTrigger aria-label="Filter by level" className="h-9 w-[140px]">
						<SelectValue placeholder="All levels" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All levels</SelectItem>
						<SelectItem value="error">Error</SelectItem>
						<SelectItem value="warning">Warning</SelectItem>
					</SelectContent>
				</Select>

				<Select
					value={platform}
					onValueChange={(value) => updateFilter({ platform: value })}
				>
					<SelectTrigger
						aria-label="Filter by platform"
						className="h-9 w-[150px]"
					>
						<SelectValue placeholder="All platforms" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All platforms</SelectItem>
						<SelectItem value="web">Web</SelectItem>
						<SelectItem value="ios">iOS</SelectItem>
						<SelectItem value="android">Android</SelectItem>
						<SelectItem value="server">Server</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="mt-5 mb-14">
				{isError ? (
					<EmptyState
						icon={<TriangleAlert className="size-4" aria-hidden="true" />}
						title="Could not load issues"
						description="The error list is unavailable right now. Nothing is shown until the request succeeds — no fabricated issues or graphs."
						action={
							<Button variant="outline" size="sm" onClick={() => refetch()}>
								Retry
							</Button>
						}
					/>
				) : isLoading ? (
					<div className="space-y-2">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				) : !showEmpty ? (
					<>
						<div className="overflow-x-auto rounded-[2px] border border-border">
							<table className="w-full border-collapse text-[13px]">
								<thead>
									<tr className="bg-canvas-subtle text-text-muted">
										<th className={TH}>Issue</th>
										<th className={cn(TH, "text-right")}>Events</th>
										<th className={cn(TH, "text-right")}>Users</th>
										<th className={TH}>Δ</th>
										<th className={TH}>Level</th>
										<th className={TH}>First seen</th>
										<th className={TH}>Last seen</th>
										<th className={cn(TH, "text-right")}>Actions</th>
									</tr>
								</thead>
								<tbody>
									{isFetching
										? Array.from({ length: limit }).map((_, i) => (
												<tr
													key={`skeleton-${i}`}
													className="border-t border-border"
												>
													<td className="px-3.5 py-2.5">
														<Skeleton className="h-3 w-[180px]" />
														<div className="mt-1 flex gap-2">
															<Skeleton className="h-4 w-12 rounded-[2px]" />
															<Skeleton className="h-3 w-20" />
														</div>
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="ml-auto h-3 w-10" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="ml-auto h-3 w-10" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="h-5 w-12 rounded-[2px]" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="h-5 w-12 rounded-[2px]" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="h-3 w-20" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="h-3 w-20" />
													</td>
													<td className="px-3.5 py-2.5">
														<Skeleton className="ml-auto size-8 rounded-[2px]" />
													</td>
												</tr>
											))
										: issues.map((issue) => (
												<tr
													key={issue.id}
													onClick={() =>
														navigate(
															`/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/errors/${issue.id}`,
														)
													}
													className="group cursor-pointer border-t border-border hover:bg-surface/60"
												>
													<td className="max-w-[300px] px-3.5 py-2.5">
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																navigate(
																	`/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/errors/${issue.id}`,
																);
															}}
															className="block max-w-full truncate text-left font-mono text-[13px] font-[550] text-text transition-colors hover:text-link group-hover:text-link focus-visible:outline-2 focus-visible:outline-focus"
															title={issue.title}
															aria-label={`Open issue: ${issue.title}`}
														>
															{issue.title}
														</button>
														<div className="mt-1 flex items-center gap-2">
															<PlatformLevelTag
																platform={issue.platform}
																level={issue.level}
															/>
															{issue.location ? (
																<span className="min-w-0 truncate font-mono text-[11px] text-text-subtle">
																	{issue.location}
																</span>
															) : null}
														</div>
													</td>
													<td className="px-3.5 py-2.5 text-right font-mono text-text">
														{fmtC(issue.count)}
													</td>
													<td className="px-3.5 py-2.5 text-right font-mono text-text">
														{fmtC(issue.users)}
													</td>
													<td className="px-3.5 py-2.5">
														<DeltaTag delta={issue.delta} />
													</td>
													<td className="px-3.5 py-2.5">
														<LevelTag level={issue.level} />
													</td>
													<td className="px-3.5 py-2.5 text-[12px] whitespace-nowrap text-text-muted">
														{dateLabel(issue.firstSeen)}
													</td>
													<td className="px-3.5 py-2.5 text-[12px] whitespace-nowrap text-text-muted">
														{dateLabel(issue.lastSeen)}
													</td>
													<td className="px-3.5 py-2.5">
														<span className="flex items-center justify-end">
															<IssueAction
																issue={issue}
																slug={slug}
																canManage={canManage}
															/>
														</span>
													</td>
												</tr>
											))}
								</tbody>
							</table>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-3">
							<div className="font-mono text-[12px] text-text-muted tabular-nums">
								{isFetching ? (
									"Loading…"
								) : (
									<>
										Page {pageIndex + 1} · {issues.length} issue
										{issues.length === 1 ? "" : "s"}
										{hasNext ? " · more" : ""}
									</>
								)}
							</div>
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<span className="hidden font-mono text-[11px] text-text-subtle sm:inline">
										Rows per page
									</span>
									<Select
										value={String(limit)}
										onValueChange={(value) => setLimit(Number(value))}
									>
										<SelectTrigger className="h-8 w-[72px] font-mono text-[12px]">
											<SelectValue />
										</SelectTrigger>
										<SelectContent side="top">
											{[10, 25, 50].map((size) => (
												<SelectItem key={size} value={String(size)}>
													{size}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-1.5">
									<Button
										variant="outline"
										size="icon-sm"
										className="size-8"
										onClick={handlePrev}
										disabled={!hasPrev || isFetching}
										aria-label="Previous page"
									>
										<ChevronLeft className="size-4" />
									</Button>
									<Button
										variant="outline"
										size="icon-sm"
										className="size-8"
										onClick={handleNext}
										disabled={!hasNext || isFetching}
										aria-label="Next page"
									>
										<ChevronRight className="size-4" />
									</Button>
								</div>
							</div>
						</div>{" "}
					</>
				) : (
					<EmptyState
						icon={<TriangleAlert className="size-4" aria-hidden="true" />}
						title={
							!hasActiveFilter && hasNoIssues
								? "No captured errors yet"
								: "No issues match this search"
						}
						description={
							!hasActiveFilter && hasNoIssues ? (
								<span>
									Aggregated issues appear here once a source connects opt-in
									error capture. Configure capture from{" "}
									<Link
										to={sourcesSetupPath}
										className="font-medium text-link hover:underline"
									>
										Sources → Setup
									</Link>
									.
								</span>
							) : (
								"Try a different query or clear the filters."
							)
						}
					/>
				)}
			</div>
			<ErrorPresentationStack />
		</div>
	);
}
