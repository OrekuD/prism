import type {
	ErrorIssueActivityAction,
	ErrorIssueActivityItem,
	ErrorIssueDetailResource,
	ErrorIssueResource,
	ErrorIssueStatus,
	ErrorOccurrenceSummary,
	ErrorStackFrame,
} from "@prism-analytics/types";
import { useQueryClient } from "@tanstack/react-query";
import React, { useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Info } from "@/components/ui/hugeicons";

import {
	DeltaTag,
	PlatformLevelTag,
	StatusTag,
	dateLabel,
} from "@/components/errors/issue-visuals";
import { Frame, SectionLabel } from "@/components/public/frame";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import {
	ErrorAICopyButton,
	ErrorAICopyPopover,
} from "@/components/errors/error-ai-copy";
import {
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { PresentationStack } from "@/components/ui/presentation-stack";
import { Skeleton } from "@/components/ui/skeleton";
import {
	type ErrorPresentationLayer,
	parseErrorPresentationStack,
} from "@/lib/presentationStack";
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
const BREADCRUMB_PLACEHOLDERS = [
	"breadcrumb-one",
	"breadcrumb-two",
	"breadcrumb-three",
	"breadcrumb-four",
	"breadcrumb-five",
	"breadcrumb-six",
];

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

/** Key/value cell — mirrors event-detail Kv: Frame inset with mono label. */
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

function shikiLangFor(language?: string): string {
	if (!language) return "javascript";
	const v = language.trim().toLowerCase();
	if (
		["javascript", "js", "typescript", "ts", "jsx", "tsx", "node"].includes(v)
	)
		return "javascript";
	if (["python", "py", "python3"].includes(v)) return "python";
	if (["go", "golang"].includes(v)) return "go";
	if (["java"].includes(v)) return "java";
	if (["swift"].includes(v)) return "swift";
	if (["kotlin", "kt"].includes(v)) return "kotlin";
	if (["ruby", "rb"].includes(v)) return "ruby";
	if (["php"].includes(v)) return "php";
	return "text";
}

function ShikiStack({ code, language }: { code: string; language?: string }) {
	const { theme } = useTheme();
	const resolvedTheme =
		theme === "system"
			? typeof window !== "undefined" &&
				window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: theme;
	const shikiTheme = resolvedTheme === "light" ? "github-light" : "github-dark";
	const lang = shikiLangFor(language);
	const [html, setHtml] = React.useState<string | null>(null);
	React.useEffect(() => {
		let cancelled = false;
		import("shiki")
			.then(({ codeToHtml }) => codeToHtml(code, { lang, theme: shikiTheme }))
			.then((out) => {
				if (!cancelled) setHtml(out);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			});
		return () => {
			cancelled = true;
		};
	}, [code, lang, shikiTheme]);
	if (html) {
		return (
			<div
				className="max-h-[320px] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:p-0 [&_code]:!bg-transparent"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML is trusted
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		);
	}
	return (
		<pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-[11.5px] leading-relaxed text-text">
			{code}
		</pre>
	);
}

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
		<Frame className="flex items-start gap-3 px-3 py-2 text-[11px] leading-relaxed">
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
		</Frame>
	);
}

function frameKey(frame: ErrorStackFrame, index: number): string {
	return [
		frame.file ?? "unknown",
		frame.function ?? "anonymous",
		frame.line ?? 0,
		frame.column ?? 0,
		index,
	].join(":");
}

function OccurrenceCard({
	occurrence,
	latest,
}: {
	occurrence: ErrorOccurrenceSummary;
	latest: boolean;
}) {
	return (
		<Frame inset className="space-y-1.5 p-2.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 break-words text-[11.5px] leading-snug text-text">
					{occurrence.exception.type}
					{occurrence.exception.message
						? `: ${occurrence.exception.message}`
						: ""}
				</span>
				<span className="shrink-0 text-[10.5px] text-text-subtle">
					{relativeTime(occurrence.receivedAt)}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-text-muted">
				<span>{occurrence.handled ? "handled" : "unhandled"}</span>
				{occurrence.release ? (
					<span className="tabular-nums">{occurrence.release}</span>
				) : null}
				{occurrence.environment ? (
					<span>{occurrence.environment}</span>
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
		</Frame>
	);
}

function ActivityItem({ item }: { item: ErrorIssueActivityItem }) {
	return (
		<div className="flex items-center gap-2 py-1.5 text-[11.5px]">
			<span className="font-medium text-text">{ACTION_LABEL[item.action]}</span>
			<span className="text-[10.5px] text-text-muted">
				{item.priorState} → {item.newState}
			</span>
			<span className="flex-1 truncate text-right text-[10.5px] text-text-subtle">
				{relativeTime(item.timestamp)}
			</span>
		</div>
	);
}

/** Data + state-workflow body; deliberately decoupled from the Sheet shell. */
function IssueDetails({
	issue,
	issuePath,
	search,
	slug,
}: {
	issue: ErrorIssueResource;
	issuePath: string;
	search: string;
	slug: string | undefined;
}) {
	const mutation = useIssueStateMutation(slug);
	const activeMember = useActiveMember();
	const canManage =
		activeMember?.data?.role === "owner" ||
		activeMember?.data?.role === "admin";
	const detail = useIssueDetailQuery(slug, issue.id);
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

	const latest = detailData?.occurrences[0];
	const occurrences = detailData?.occurrences.slice(1, 5) ?? [];
	const activity = detailData?.activity ?? [];

	return (
		<>
			<SheetHeader className="gap-3 border-b border-border px-6 pb-4 pt-6">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-wrap items-center gap-1.5">
						<PlatformLevelTag platform={issue.platform} level={issue.level} />
						<StatusTag status={issue.status} />
						<DeltaTag delta={issue.delta} />
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<ErrorAICopyButton
							issue={issue}
							detail={detailData}
							projectSlug={slug}
						/>
						<ErrorAICopyPopover
							issue={issue}
							detail={detailData}
							projectSlug={slug}
						/>
					</div>
				</div>
				<SheetTitle className="break-words pr-2 text-left font-sans text-[17px] font-semibold leading-[1.25] tracking-[-0.02em] text-text">
					{issue.title}
				</SheetTitle>
				<SheetDescription className="font-sans text-[13px] leading-[1.5] text-text-muted">
					{issue.location ?? "No captured top-frame location."}
				</SheetDescription>
			</SheetHeader>

			<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6">
				<section>
					<SectionLabel>Overview</SectionLabel>
					<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Kv k="events in range">{fmt.format(issue.count)}</Kv>
						<Kv k="users affected">{fmt.format(issue.users)}</Kv>
						<Kv k="first seen">{dateLabel(issue.firstSeen)}</Kv>
						<Kv k="last seen">{dateLabel(issue.lastSeen)}</Kv>
						{detailData ? (
							<>
								<Kv k="all-time events">
									{fmt.format(detailData.occurrenceCountAll)}
								</Kv>
								<Kv k="all-time users">
									{fmt.format(detailData.usersAffectedAll)}
								</Kv>
								{detailData.firstRelease || detailData.lastRelease ? (
									<Kv k="releases">
										{`${detailData.firstRelease ?? "—"} → ${detailData.lastRelease ?? "—"}`}
									</Kv>
								) : null}
							</>
						) : (
							<>
								<Skeleton className="h-[76px] w-full rounded-md" />
								<Skeleton className="h-[76px] w-full rounded-md" />
							</>
						)}
					</div>
				</section>

				{issue.location ? (
					<section>
						<SectionLabel>Location</SectionLabel>
						<Frame inset className="mt-3 px-3 py-3">
							<code className="block break-all font-mono text-[11.5px] text-text">
								{issue.location}
							</code>
						</Frame>
					</section>
				) : null}

				{latest ? (
					<section>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-baseline gap-2">
								<SectionLabel>Stack trace</SectionLabel>
								<span className="text-[10px] text-text-subtle">
									({latest.exception.frames.length} frames · sanitized)
								</span>
							</div>
							<CopyButton
								value={chainText(latest)}
								label="stack trace"
								iconOnly
								className="size-7"
							/>
						</div>
						<div className="mt-3">
							{latest.exception.frames.length > 0 ? (
								<Frame inset className="p-0">
									<div className="overflow-hidden rounded-[16px]">
										<ShikiStack
											code={chainText(latest)}
											language={latest.language}
										/>
									</div>
								</Frame>
							) : (
								<Frame className="border-dashed bg-surface/40 px-3 py-6 text-center">
									<p className="text-[12px] leading-none text-text-subtle">
										No captured stack frames for this occurrence.
									</p>
								</Frame>
							)}
							{latest.exception.hasCause ? (
								<p className="mt-1.5 px-1 text-[10.5px] text-text-subtle">
									This occurrence has a nested cause (captured; redacted content
									is never shown).
								</p>
							) : null}
						</div>
					</section>
				) : detail?.isFetching ? (
					<section>
						<SectionLabel>Stack trace</SectionLabel>
						<Skeleton className="mt-3 h-[120px] w-full rounded-md" />
					</section>
				) : null}

				<section>
					<div className="flex items-center justify-between gap-2">
						<div className="inline-flex items-center gap-1">
							<SectionLabel className="leading-none">Breadcrumbs</SectionLabel>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											aria-label="Breadcrumbs privacy info"
											className="inline-flex size-4 shrink-0 -translate-y-[0.5px] items-center justify-center rounded-full text-text-subtle hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
										>
											<Info className="size-3" aria-hidden="true" />
										</button>
									</TooltipTrigger>
									<TooltipContent side="top" align="center">
										No request/response bodies, headers, cookies, or storage are
										ever collected.
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
						<span className="text-[10px] text-text-subtle">
							{latest ? `${latest.breadcrumbsCount} · safe · bounded` : "—"}
						</span>
					</div>
					{latest && latest.breadcrumbsCount > 0 ? (
						<Frame inset className="mt-3 p-0">
							<div className="overflow-hidden rounded-[16px]">
								{BREADCRUMB_PLACEHOLDERS.slice(
									0,
									Math.min(latest.breadcrumbsCount, 6),
								).map((key, index) => (
									<div
										key={key}
										className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
									>
										<span
											className="h-1.5 w-1.5 shrink-0 rounded-full bg-info"
											aria-hidden
										/>
										<span className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-text-muted">
											Breadcrumb {index + 1} — safe, sanitized
										</span>
										<span className="shrink-0 text-[10px] text-text-subtle">
											{relativeTime(latest.receivedAt - (index + 1) * 90_000)}
										</span>
									</div>
								))}
							</div>
						</Frame>
					) : (
						<Frame className="mt-3 border-dashed bg-surface/40 px-3 py-6 text-center">
							<p className="text-[12px] leading-none text-text-subtle">
								No breadcrumbs collected for this occurrence.
							</p>
						</Frame>
					)}
				</section>

				<section>
					<SectionLabel>Context</SectionLabel>
					{latest &&
					((latest.tags && Object.keys(latest.tags).length > 0) ||
						(latest.extras && Object.keys(latest.extras).length > 0) ||
						latest.environment ||
						latest.release) ? (
						<div className="mt-3 space-y-4">
							{latest.environment || latest.release ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Deployment
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{latest.environment ? (
											<Kv k="environment">{latest.environment}</Kv>
										) : null}
										{latest.release ? (
											<Kv k="release">{latest.release}</Kv>
										) : null}
									</div>
								</div>
							) : null}
							{latest.tags && Object.keys(latest.tags).length > 0 ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Tags
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{Object.entries(latest.tags).map(([k, v]) => (
											<Kv key={k} k={k}>
												{String(v)}
											</Kv>
										))}
									</div>
								</div>
							) : null}
							{latest.extras && Object.keys(latest.extras).length > 0 ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Extras
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{Object.entries(latest.extras).map(([k, v]) => (
											<Kv key={k} k={k}>
												{typeof v === "string"
													? v
													: Array.isArray(v) || typeof v === "object"
														? JSON.stringify(v)
														: String(v ?? "")}
											</Kv>
										))}
									</div>
								</div>
							) : null}
						</div>
					) : (
						<Frame className="mt-3 border-dashed bg-surface/40 px-3 py-6 text-center">
							<p className="text-[12px] leading-none text-text-subtle">
								No additional context for this occurrence.
							</p>
						</Frame>
					)}
				</section>

				{occurrences.length > 0 ? (
					<section>
						<SectionLabel>Recent occurrences</SectionLabel>
						<div className="mt-3 space-y-1.5">
							{occurrences.map((occurrence) => (
								<Link
									key={occurrence.id}
									to={{
										pathname: `${issuePath}/occurrences/${occurrence.id}`,
										search,
									}}
									data-presentation-trigger={`occurrence:0:${occurrence.id}`}
									className="block rounded-md focus-visible:outline-2 focus-visible:outline-focus"
								>
									<div className="transition-colors hover:opacity-80">
										<OccurrenceCard occurrence={occurrence} latest={false} />
									</div>
								</Link>
							))}
						</div>
						{detailData?.hasMoreOccurrences ? (
							<p className="mt-2 px-1 text-[10.5px] text-text-subtle">
								Only the most recent occurrences are shown.
							</p>
						) : null}
					</section>
				) : null}

				{activity.length > 0 ? (
					<section>
						<SectionLabel>Workflow history</SectionLabel>
						<Frame inset className="mt-3 px-2.5">
							<div className="divide-y divide-border">
								{activity.map((item) => (
									<ActivityItem key={item.id} item={item} />
								))}
							</div>
						</Frame>
					</section>
				) : null}
			</div>

			<SheetFooter className="border-t border-border">
				{canManage ? (
					<div className="flex w-full items-center justify-end gap-2">
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
					<div className="flex w-full items-center justify-end gap-2">
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
		<div className="flex flex-col gap-4 p-6">
			<Skeleton className="h-4 w-3/4" />
			<Skeleton className="h-3 w-1/2" />
			<div className="mt-2 grid grid-cols-2 gap-3">
				<Skeleton className="h-[76px] w-full rounded-md" />
				<Skeleton className="h-[76px] w-full rounded-md" />
				<Skeleton className="h-[76px] w-full rounded-md" />
				<Skeleton className="h-[76px] w-full rounded-md" />
			</div>
			<Skeleton className="h-[120px] w-full rounded-md" />
		</div>
	);
}

function IssueMissing({ base }: { base: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="text-[13px] text-text-muted">
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

function IssuePresentationContent({
	base,
	issueId,
	issuePath,
	search,
	slug,
}: {
	base: string;
	issueId: string;
	issuePath: string;
	search: string;
	slug: string | undefined;
}) {
	const queryClient = useQueryClient();
	const issue = useIssueFromCache(slug, issueId);

	const listPending = queryClient
		.getQueryCache()
		.findAll({ queryKey: ENTRIES_PREFIX(slug) })
		.some((query) => query.state.status === "pending");

	if (issue) {
		return (
			<IssueDetails
				issue={issue}
				issuePath={issuePath}
				search={search}
				slug={slug}
			/>
		);
	}
	if (listPending) return <IssueDetailSkeleton />;
	return <IssueMissing base={base} />;
}

function findOccurrence(
	queryClient: ReturnType<typeof useQueryClient>,
	slug: string | undefined,
	issueId: string | undefined,
	occurrenceId: string | undefined,
): ErrorOccurrenceSummary | undefined {
	if (!slug || !issueId || !occurrenceId) return undefined;
	// Try the detail cache first (the 15 we already have)
	const detailQueries = queryClient.getQueriesData<ErrorIssueDetailResource>({
		queryKey: ["project-issue-detail", slug, issueId],
	});
	for (const [, payload] of detailQueries) {
		const found = (payload as ErrorIssueDetailResource)?.occurrences?.find(
			(o) => o.id === occurrenceId,
		);
		if (found) return found;
	}
	// Fallback: scan the detail resource shape we store under issue-detail
	const alt = queryClient.getQueryData<ErrorIssueDetailResource>([
		"project-issue-detail",
		slug,
		issueId,
	]);
	return alt?.occurrences?.find((o) => o.id === occurrenceId);
}

function useOccurrenceFromCache(
	slug: string | undefined,
	issueId: string | undefined,
	occurrenceId: string | undefined,
): ErrorOccurrenceSummary | undefined {
	const queryClient = useQueryClient();
	return useSyncExternalStore(
		(callback) => queryClient.getQueryCache().subscribe(callback),
		() => findOccurrence(queryClient, slug, issueId, occurrenceId),
		() => undefined,
	);
}

function OccurrenceDetails({
	issue,
	occurrence,
}: {
	issue: ErrorIssueResource;
	occurrence: ErrorOccurrenceSummary;
}) {
	const code = chainText(occurrence);
	return (
		<>
			<SheetHeader className="gap-3 border-b border-border px-6 pb-4 pt-6">
				<div className="flex flex-wrap items-center gap-1.5">
					<PlatformLevelTag
						platform={issue.platform}
						level={occurrence.level}
					/>
					<span className="inline-flex h-[18px] items-center rounded-full border border-border bg-surface px-[6px] text-[10px] font-medium tracking-normal text-text-muted">
						{occurrence.handled ? "handled" : "unhandled"}
					</span>
					{occurrence.environment ? (
						<span className="inline-flex h-[18px] items-center rounded-full border border-border bg-surface px-[6px] text-[10px] font-medium tracking-normal text-text-muted">
							{occurrence.environment}
						</span>
					) : null}
				</div>
				<SheetTitle className="break-words pr-2 text-left text-[15px] font-semibold leading-snug text-text">
					{occurrence.exception.type}
					{occurrence.exception.message
						? `: ${occurrence.exception.message}`
						: ""}
				</SheetTitle>
				<SheetDescription className="flex flex-wrap items-center gap-1.5 text-[11px] leading-none text-text-subtle">
					<span>{dateLabel(occurrence.receivedAt)}</span>
					<span className="size-1 rounded-full bg-border-strong" aria-hidden />
					<span>{relativeTime(occurrence.receivedAt)}</span>
					<span className="size-1 rounded-full bg-border-strong" aria-hidden />
					<span className="truncate">{occurrence.id.slice(0, 8)}</span>
				</SheetDescription>
			</SheetHeader>

			<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6">
				<section>
					<SectionLabel>Stack trace</SectionLabel>
					<div className="mt-3">
						{occurrence.exception.frames.length > 0 ? (
							<Frame inset className="p-0">
								<div className="overflow-hidden rounded-[16px]">
									<ShikiStack code={code} language={occurrence.language} />
								</div>
							</Frame>
						) : (
							<Frame className="border-dashed bg-surface/40 px-3 py-6 text-center">
								<p className="text-[12px] leading-none text-text-subtle">
									No captured stack frames for this occurrence.
								</p>
							</Frame>
						)}
					</div>
				</section>

				<section>
					<SectionLabel>Context</SectionLabel>
					{(occurrence.tags && Object.keys(occurrence.tags).length > 0) ||
					(occurrence.extras && Object.keys(occurrence.extras).length > 0) ||
					occurrence.environment ||
					occurrence.release ? (
						<div className="mt-3 space-y-4">
							{occurrence.environment || occurrence.release ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Deployment
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{occurrence.environment ? (
											<Kv k="environment">{occurrence.environment}</Kv>
										) : null}
										{occurrence.release ? (
											<Kv k="release">{occurrence.release}</Kv>
										) : null}
									</div>
								</div>
							) : null}
							{occurrence.tags && Object.keys(occurrence.tags).length > 0 ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Tags
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{Object.entries(occurrence.tags).map(([k, v]) => (
											<Kv key={k} k={k}>
												{String(v)}
											</Kv>
										))}
									</div>
								</div>
							) : null}
							{occurrence.extras &&
							Object.keys(occurrence.extras).length > 0 ? (
								<div>
									<div className="mb-2 text-[13px] font-medium tracking-normal text-text-subtle">
										Extras
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										{Object.entries(occurrence.extras).map(([k, v]) => (
											<Kv key={k} k={k}>
												{typeof v === "string"
													? v
													: Array.isArray(v) || typeof v === "object"
														? JSON.stringify(v)
														: String(v ?? "")}
											</Kv>
										))}
									</div>
								</div>
							) : null}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Kv k="handled">{occurrence.handled ? "true" : "false"}</Kv>
								<Kv k="level">{occurrence.level}</Kv>
								{occurrence.language ? (
									<Kv k="language">{occurrence.language}</Kv>
								) : null}
							</div>
						</div>
					) : (
						<Frame className="mt-3 border-dashed bg-surface/40 px-3 py-6 text-center">
							<p className="text-[12px] leading-none text-text-subtle">
								No additional context for this occurrence.
							</p>
						</Frame>
					)}
				</section>

				<section>
					<div className="flex items-center gap-1">
						<SectionLabel className="leading-none">Breadcrumbs</SectionLabel>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										aria-label="Breadcrumbs privacy info"
										className="inline-flex size-4 shrink-0 -translate-y-[0.5px] items-center justify-center rounded-full text-text-subtle hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
									>
										<Info className="size-3" aria-hidden="true" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="top" align="center">
									No request/response bodies, headers, cookies, or storage are
									ever collected.
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
					<div className="mt-3 flex items-center gap-2 text-[10px] text-text-subtle">
						<span>{occurrence.breadcrumbsCount} · safe · bounded</span>
					</div>
					{occurrence.breadcrumbsCount > 0 ? (
						<Frame inset className="mt-3 p-0">
							<div className="overflow-hidden rounded-[16px]">
								{BREADCRUMB_PLACEHOLDERS.slice(
									0,
									Math.min(occurrence.breadcrumbsCount, 6),
								).map((key, index) => (
									<div
										key={key}
										className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
									>
										<span
											className="h-1.5 w-1.5 shrink-0 rounded-full bg-info"
											aria-hidden
										/>
										<span className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-text-muted">
											Breadcrumb {index + 1} — safe, sanitized
										</span>
										<span className="shrink-0 text-[10px] text-text-subtle">
											{relativeTime(
												occurrence.receivedAt - (index + 1) * 90_000,
											)}
										</span>
									</div>
								))}
							</div>
						</Frame>
					) : (
						<Frame className="mt-3 border-dashed bg-surface/40 px-3 py-6 text-center">
							<p className="text-[12px] leading-none text-text-subtle">
								No breadcrumbs collected for this occurrence.
							</p>
						</Frame>
					)}
				</section>
			</div>
		</>
	);
}

function OccurrencePresentationContent({
	issueId,
	occurrenceId,
	parentPath,
	search,
	slug,
}: {
	issueId: string;
	occurrenceId: string;
	parentPath: string;
	search: string;
	slug: string | undefined;
}) {
	const detailQuery = useIssueDetailQuery(slug, issueId);
	const cachedIssue = useIssueFromCache(slug, issueId);
	const issue = cachedIssue ?? detailQuery.data?.issue ?? null;
	const cached = useOccurrenceFromCache(slug, issueId, occurrenceId);
	const occurrence =
		cached ?? detailQuery.data?.occurrences.find((o) => o.id === occurrenceId);

	if (occurrence && issue) {
		return <OccurrenceDetails issue={issue} occurrence={occurrence} />;
	}
	if (detailQuery.isPending) {
		return (
			<div className="flex flex-col gap-4 p-6">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="mt-2 h-[120px] w-full rounded-md" />
			</div>
		);
	}
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="text-[13px] text-text-muted">
				Occurrence not found
			</p>
			<span className="max-w-[300px] text-[12px] leading-[1.5] text-text-subtle">
				It may have been pruned by retention or the issue detail hasn&apos;t
				loaded yet.
			</span>
			<Link
				to={{ pathname: parentPath, search }}
				className="mt-1 font-medium text-link hover:underline"
			>
				Back one level
			</Link>
		</div>
	);
}

/** URL-derived host for issue and recursively nested occurrence sheets. */
export function ErrorPresentationStack() {
	const {
		slug,
		wrkSlug,
		"*": splat,
	} = useParams<{
		slug: string;
		wrkSlug: string;
		"*": string;
	}>();
	const location = useLocation();
	const navigate = useNavigate();
	const base = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/errors`;
	const parsed = React.useMemo(
		() => parseErrorPresentationStack(base, splat),
		[base, splat],
	);
	const issueLayer = parsed.layers[0];

	React.useEffect(() => {
		if (!parsed.valid) {
			navigate({ pathname: base, search: location.search }, { replace: true });
		}
	}, [base, location.search, navigate, parsed.valid]);

	if (!parsed.valid) return null;

	const renderLayer = (layer: ErrorPresentationLayer) => {
		if (layer.kind === "issue") {
			return (
				<IssuePresentationContent
					base={base}
					issueId={layer.resourceId}
					issuePath={layer.path}
					search={location.search}
					slug={slug}
				/>
			);
		}
		if (!issueLayer) return null;
		return (
			<OccurrencePresentationContent
				issueId={issueLayer.resourceId}
				occurrenceId={layer.resourceId}
				parentPath={layer.parentPath}
				search={location.search}
				slug={slug}
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
