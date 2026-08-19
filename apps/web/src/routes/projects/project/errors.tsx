import { Search, TriangleAlert } from "lucide-react";
import React from "react";
import {
	Link,
	Outlet,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";

import { Frame } from "@/components/public/frame";
import { MetricCard } from "@/components/public/metric-card";
import { PageHeader } from "@/components/public/page-header";
import { Button } from "@/components/ui/button";
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
	fetchIssuePage,
	useIssuesQuery,
	type IssueListQuery,
} from "@/network/queries/useIssuesQuery";
import { useProjectQuery } from "@/network/queries/useProjectQuery";

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
	const label =
		issue.status === "unresolved"
			? "Resolve"
			: issue.status === "resolved"
				? "Reopen"
				: "Stop ignoring";

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => mutation.mutate({ issueId: issue.id, status: nextStatus })}
			disabled={mutation.isPending}
		>
			{label}
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

	const queryParams: IssueListQuery = {
		range,
		status: status === "all" ? undefined : status,
		level: level === "all" ? undefined : level,
		platform: platform === "all" ? undefined : platform,
		q: query || undefined,
	};
	const { data, isLoading, isError, refetch } = useIssuesQuery(
		slug,
		queryParams,
	);
	const projectQuery = useProjectQuery({ slug, duration: "seven-days" });
	const activeMember = useActiveMember();

	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";

	// Accumulate pages as the user loads more; reset whenever the server query
	// (filters/range) changes so the base page is always the freshly filtered one.
	const [accumulated, setAccumulated] = React.useState<ErrorIssueResource[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loadingMore, setLoadingMore] = React.useState(false);

	React.useEffect(() => {
		setAccumulated(data?.items ?? []);
		setNextCursor(data?.nextCursor ?? null);
	}, [data]);

	const issues = accumulated;

	const loadMore = async (): Promise<void> => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const page = await fetchIssuePage(slug, queryParams, nextCursor);
			setAccumulated((prev) => {
				const seen = new Set(prev.map((issue) => issue.id));
				const fresh = page.items.filter((issue) => !seen.has(issue.id));
				return [...prev, ...fresh];
			});
			setNextCursor(page.nextCursor);
		} finally {
			setLoadingMore(false);
		}
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
					{[0, 1, 2, 3].map((i) => (
						<Frame key={i} className="p-4 pt-5">
							<Skeleton className="h-[12px] w-1/2" />
							<Skeleton className="mt-3 h-[24px] w-2/3" />
						</Frame>
					))}
				</div>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<MetricCard label="Error events" caption="occurrences in range">
						<span className="font-mono text-[23px] tracking-[-0.06em] text-text">
							{fmt.format(totalEvents)}
						</span>
					</MetricCard>
					<MetricCard label="Unresolved" caption="issues needing triage">
						<span className="font-mono text-[23px] tracking-[-0.06em] text-text">
							{fmt.format(unresolvedCount)}
						</span>
					</MetricCard>
					<MetricCard label="New in range" caption="first seen this range">
						<span className="font-mono text-[23px] tracking-[-0.06em] text-text">
							{fmt.format(newInRange)}
						</span>
					</MetricCard>
					<MetricCard label="Users affected" caption="across all issues">
						<span className="font-mono text-[23px] tracking-[-0.06em] text-text">
							{fmt.format(usersAffected)}
						</span>
					</MetricCard>
				</div>
			)}

			<div className="mt-5 flex flex-wrap items-center gap-3">
				<fieldset className="m-0 inline-flex min-w-0 items-center overflow-hidden rounded-[2px] border border-border p-0">
					<legend className="sr-only">Issue status</legend>
					{(["all", "unresolved", "resolved", "ignored"] as const).map(
						(entry, index) => (
							<button
								key={entry}
								type="button"
								onClick={() => updateFilter({ status: entry })}
								className={cn(
									"inline-flex h-8 items-center gap-1.5 px-3.5 text-[13px] font-medium transition-colors",
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
										"font-mono text-[11px]",
										status === entry ? "text-accent" : "text-text-subtle",
									)}
								>
									{statusCounts[entry]}
								</span>
							</button>
						),
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
					<Frame className="flex flex-col items-center justify-center gap-2.5 p-10 text-center">
						<TriangleAlert
							className="size-[22px] text-text-subtle"
							aria-hidden="true"
						/>
						<p className="font-mono text-[13px] text-text-muted">
							Could not load issues.
						</p>
						<span className="max-w-[400px] text-[12px] leading-[1.5] text-text-subtle">
							The error list is unavailable right now. Nothing is shown until
							the request succeeds — no fabricated issues or graphs.
						</span>
						<Button variant="outline" size="sm" onClick={() => refetch()}>
							Retry
						</Button>
					</Frame>
				) : isLoading ? (
					<div className="space-y-2">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				) : !showEmpty ? ( <>
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
								{issues.map((issue) => (
									<tr
										key={issue.id}
										className="group cursor-pointer border-t border-border"
										onClick={() => navigate(issue.id)}
									>
										<td className="max-w-[300px] px-3.5 py-2.5">
											<Link
												to={issue.id}
												onClick={(event) => event.stopPropagation()}
												className="block truncate font-mono text-[13px] font-[550] text-text transition-colors hover:text-link"
												aria-label={`Open issue: ${issue.title}`}
											>
												{issue.title}
											</Link>
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
											{fmt.format(issue.count)}
										</td>
										<td className="px-3.5 py-2.5 text-right font-mono text-text">
											{fmt.format(issue.users)}
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
											<span
												onClick={(event) => event.stopPropagation()}
												className="flex items-center justify-end opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
											>
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
					{nextCursor ? (
						<div className="mt-3 flex justify-center">
							<Button
								variant="outline"
								size="sm"
								onClick={() => void loadMore()}
								disabled={loadingMore}
							>
								{loadingMore ? "Loading…" : "Load more"}
							</Button>
						</div>
					) : null} </>
				) : (
					<Frame className="flex flex-col items-center justify-center gap-2.5 p-10 text-center">
						<TriangleAlert
							className="size-[22px] text-text-subtle"
							aria-hidden="true"
						/>
						{!hasActiveFilter && hasNoIssues ? (
							<>
								<p className="font-mono text-[13px] text-text-muted">
									No captured errors yet.
								</p>
								<span className="max-w-[420px] text-[12px] leading-[1.5] text-text-subtle">
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
							</>
						) : (
							<>
								<p className="font-mono text-[13px] text-text-muted">
									No issues match this search.
								</p>
								<span className="text-[12px] text-text-subtle">
									Try a different query or clear the filters.
								</span>
							</>
						)}
					</Frame>
				)}
			</div>
			<Outlet />
		</div>
	);
}
