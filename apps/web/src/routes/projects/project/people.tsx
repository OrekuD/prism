import type { PeopleRange, PeopleResource } from "@prism-analytics/types";
import { ChevronLeft, ChevronRight, Search, SearchX, X } from "lucide-react";
import React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { MetricCard } from "@/components/public/metric-card";
import { PageHeader } from "@/components/public/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { usePeopleQuery } from "@/network/queries/usePeopleQueries";

const RANGE_LABELS: Record<PeopleRange, string> = {
	"7d": "7 days",
	"30d": "30 days",
	"90d": "90 days",
};

const numberFormat = new Intl.NumberFormat();
const compactNumberFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

function compactNumber(value: number): string {
	return compactNumberFormat.format(value).replace("K", "k");
}

function traitString(person: PeopleResource, key: string): string | null {
	const value = person.traits[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function personDisplayName(person: PeopleResource): string {
	return (
		traitString(person, "name") ??
		traitString(person, "username") ??
		traitString(person, "email") ??
		person.primaryExternalId ??
		"Identified user"
	);
}

function personInitials(person: PeopleResource): string {
	const display = personDisplayName(person);
	const words = display.split(/\s+/).filter(Boolean);
	if (words.length > 1) {
		return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
	}
	return display.slice(0, 2).toUpperCase();
}

function compactTraitValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

function visibleTraits(person: PeopleResource): Array<[string, string]> {
	const profileKeys = new Set(["name", "email", "username", "avatarUrl"]);
	return Object.entries(person.traits)
		.filter(([key]) => !profileKeys.has(key))
		.flatMap(([key, value]) => {
			const display = compactTraitValue(value);
			return display === null ? [] : [[key, display] as [string, string]];
		})
		.slice(0, 2);
}

function timeLabel(timestamp: number): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "Unknown";
	return date.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function PersonIdentity({ person }: { person: PeopleResource }) {
	const name = personDisplayName(person);
	const email = traitString(person, "email");
	const secondary = email && email !== name ? email : person.primaryExternalId;

	return (
		<div className="flex min-w-0 items-center gap-3">
			<span
				className="grid size-8 shrink-0 place-items-center rounded-[2px] border border-border bg-surface font-mono text-[11px] font-semibold text-text-muted"
				aria-hidden="true"
			>
				{personInitials(person)}
			</span>
			<div className="min-w-0">
				<p className="truncate text-[13px] font-medium leading-tight text-text">
					{name}
				</p>
				{secondary && secondary !== name ? (
					<p
						className="mt-1 truncate font-mono text-[11px] leading-none text-text-subtle"
						title={secondary}
					>
						{secondary}
					</p>
				) : null}
			</div>
		</div>
	);
}

function TraitSummary({ person }: { person: PeopleResource }) {
	const traits = visibleTraits(person);
	if (traits.length === 0) {
		return <span className="text-[12px] text-text-subtle">No profile traits</span>;
	}
	return (
		<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
			{traits.map(([key, value]) => (
				<span key={key} className="min-w-0 text-[12px]">
					<span className="font-mono text-text-subtle">{key}</span>{" "}
					<span className="text-text-muted">{value}</span>
				</span>
			))}
		</div>
	);
}

function PeopleMetrics({
	data,
	isLoading,
	range,
}: {
	data:
		| {
				identifiedPeople: number;
				activePeople: number;
				newPeople: number;
				anonymousPeople: number;
		  }
		| undefined;
	isLoading: boolean;
	range: PeopleRange;
}) {
	const metrics = [
		{
			label: "Identified",
			value: data?.identifiedPeople,
			caption: "total known users",
		},
		{
			label: "Active",
			value: data?.activePeople,
			caption: `with activity in ${RANGE_LABELS[range]}`,
		},
		{
			label: "New",
			value: data?.newPeople,
			caption: `identified in ${RANGE_LABELS[range]}`,
		},
		{
			label: "Anonymous-only",
			value: data?.anonymousPeople,
			caption: `active without identify()`,
		},
	];

	return (
		<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{metrics.map((metric) => (
				<MetricCard key={metric.label} label={metric.label} caption={metric.caption}>
					{isLoading || metric.value === undefined ? (
						<Skeleton className="h-[23px] w-14 rounded-[2px]" />
					) : (
						<span
							className="font-mono text-[23px] leading-none tracking-[-0.06em] text-text tabular-nums"
							title={numberFormat.format(metric.value)}
						>
							{compactNumber(metric.value)}
						</span>
					)}
				</MetricCard>
			))}
		</div>
	);
}

export function ProjectPeople() {
	const { slug, wrkSlug } = useParams<{ slug: string; wrkSlug: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const range = (searchParams.get("range") === "7d" ||
	searchParams.get("range") === "90d"
		? searchParams.get("range")
		: "30d") as PeopleRange;
	const query = searchParams.get("q") ?? "";
	const [search, setSearch] = React.useState(query);
	const [limit, setLimit] = React.useState(10);
	const [cursorStack, setCursorStack] = React.useState<Array<string | null>>([
		null,
	]);
	const currentCursor = cursorStack[cursorStack.length - 1] ?? undefined;
	const pageIndex = cursorStack.length - 1;

	React.useEffect(() => {
		setSearch(query);
	}, [query]);
	React.useEffect(() => {
		setCursorStack([null]);
	}, [query, range, limit]);

	const { data, isLoading, isError, refetch, isFetching } = usePeopleQuery(
		slug,
		{
			cursor: currentCursor,
			q: query || undefined,
			limit,
			range,
		},
	);
	const people = data?.people ?? [];
	const nextCursor = data?.nextCursor ?? null;
	const hasPrevious = cursorStack.length > 1;
	const hasFilter = query.length > 0;
	const basePath = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}`;

	const updateUrl = (patch: { q?: string | null; range?: PeopleRange }) => {
		const next = new URLSearchParams(searchParams);
		if (patch.q !== undefined) {
			if (patch.q) next.set("q", patch.q);
			else next.delete("q");
		}
		if (patch.range !== undefined) {
			if (patch.range === "30d") next.delete("range");
			else next.set("range", patch.range);
		}
		setSearchParams(next, { replace: true });
	};

	return (
		<div className="flex flex-1 flex-col">
			<PageHeader
				title="People"
				description="Identified users and the product activity connected to them."
			>
				<Select
					value={range}
					onValueChange={(value) => updateUrl({ range: value as PeopleRange })}
				>
					<SelectTrigger
					aria-label="People date range"
					className="h-9 w-[132px] font-mono text-[12px]"
				>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="7d">Last 7 days</SelectItem>
						<SelectItem value="30d">Last 30 days</SelectItem>
						<SelectItem value="90d">Last 90 days</SelectItem>
					</SelectContent>
				</Select>
			</PageHeader>

			<PeopleMetrics data={data?.summary} isLoading={isLoading} range={range} />

			<div className="mt-5">
				<form
					className="max-w-[460px]"
					onSubmit={(event) => {
						event.preventDefault();
						updateUrl({ q: search.trim() || null });
					}}
				>
					<label
						htmlFor="people-search"
						className="mb-1.5 block font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted"
					>
						Search by exact user ID
					</label>
					<div className="flex items-center gap-2">
						<div className="relative min-w-0 flex-1">
							<Search
								className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-subtle"
								aria-hidden="true"
							/>
							<input
								id="people-search"
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="user_123"
								className="h-9 w-full rounded-[2px] border border-border bg-background py-2 pl-9 pr-8 font-mono text-[13px] text-text placeholder:text-text-subtle focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong [&::-webkit-search-cancel-button]:hidden"
							/>
							{search ? (
								<button
									type="button"
									aria-label="Clear user search"
									onClick={() => {
										setSearch("");
										updateUrl({ q: null });
									}}
									className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[2px] text-text-subtle hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
								>
									<X className="size-3.5" />
								</button>
							) : null}
						</div>
						<Button type="submit" variant="outline" size="sm" className="h-9">
							Search
						</Button>
					</div>
					<p className="mt-1.5 text-[11px] text-text-subtle">
						Matches the exact developer-supplied user ID.
					</p>
				</form>
			</div>

			<div className="mt-4 flex-1">
				{isLoading ? (
					<div
						className="overflow-hidden rounded-[2px] border border-border"
						aria-busy="true"
						aria-label="Loading people"
					>
						<div className="border-b border-border bg-surface/50 px-3.5 py-2.5">
							<Skeleton className="h-3 w-24" />
						</div>
						<div className="divide-y divide-border">
							{Array.from({ length: 5 }).map((_, index) => (
								<div key={`person-skeleton-${index}`} className="flex h-[58px] items-center gap-3 px-3.5">
									<Skeleton className="size-8 rounded-[2px]" />
									<Skeleton className="h-3 w-36" />
									<Skeleton className="ml-auto h-3 w-20" />
								</div>
							))}
						</div>
					</div>
				) : isError ? (
					<EmptyState
						icon={<SearchX className="size-4" aria-hidden="true" />}
						title="Could not load people"
						description="The identity store is temporarily unavailable. Retry or check your connection."
						action={
							<Button variant="outline" size="sm" onClick={() => refetch()}>
								Retry
							</Button>
						}
					/>
				) : people.length > 0 ? (
					<>
						<div className="hidden overflow-hidden rounded-[2px] border border-border bg-background md:block">
							<Table aria-label="Identified people" className="table-fixed">
								<TableHeader className="bg-surface/50">
									<TableRow className="hover:bg-transparent">
										<TableHead className="w-[25%]">Person</TableHead>
										<TableHead className="w-[18%]">User ID</TableHead>
										<TableHead className="w-[21%]">Traits</TableHead>
										<TableHead className="w-[9%] text-right">Sessions</TableHead>
										<TableHead className="w-[9%] text-right">Events</TableHead>
										<TableHead className="w-[18%] text-right">Last active</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody className={isFetching ? "opacity-60" : undefined}>
									{people.map((person) => {
										const href = `${basePath}/people/${encodeURIComponent(person.personId)}`;
										return (
											<TableRow key={person.personId} className="h-[58px] hover:bg-surface/60">
												<TableCell>
													<Link className="block rounded-[2px] focus-visible:outline-2 focus-visible:outline-focus" to={href}>
														<PersonIdentity person={person} />
													</Link>
												</TableCell>
												<TableCell>
													<span className="block truncate font-mono text-[12px] text-text-muted" title={person.primaryExternalId ?? undefined}>
														{person.primaryExternalId ?? "Not set"}
													</span>
												</TableCell>
												<TableCell><TraitSummary person={person} /></TableCell>
												<TableCell className="text-right font-mono tabular-nums">{numberFormat.format(person.sessionCount)}</TableCell>
												<TableCell className="text-right font-mono tabular-nums">{numberFormat.format(person.eventCount)}</TableCell>
												<TableCell className="whitespace-nowrap text-right font-mono text-[12px] text-text-muted tabular-nums">
													<time dateTime={new Date(person.lastSeenAt).toISOString()}>{timeLabel(person.lastSeenAt)}</time>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>

						<div className="divide-y divide-border rounded-[2px] border border-border md:hidden">
							{people.map((person) => (
								<Link
									key={person.personId}
									to={`${basePath}/people/${encodeURIComponent(person.personId)}`}
									className="block px-3.5 py-3.5 hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-focus"
								>
									<PersonIdentity person={person} />
									<div className="mt-3 grid grid-cols-3 gap-3 font-mono text-[11px] text-text-subtle">
										<span>{person.sessionCount} sessions</span>
										<span>{person.eventCount} events</span>
										<span className="text-right">{timeLabel(person.lastSeenAt)}</span>
									</div>
								</Link>
							))}
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-3">
							<p className="font-mono text-[12px] text-text-muted tabular-nums">
								{isFetching
									? "Loading..."
									: `Page ${pageIndex + 1}. ${people.length} ${people.length === 1 ? "person" : "people"}${nextCursor ? ". More available" : ""}`}
							</p>
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<span className="hidden font-mono text-[11px] text-text-subtle sm:inline">Rows per page</span>
									<Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
										<SelectTrigger className="h-8 w-[72px] font-mono text-[12px]"><SelectValue /></SelectTrigger>
										<SelectContent side="top">
											{[10, 25, 50].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-1.5">
									<Button variant="outline" size="icon-sm" className="size-8" onClick={() => setCursorStack((current) => current.slice(0, -1))} disabled={!hasPrevious || isFetching} aria-label="Previous page">
										<ChevronLeft className="size-4" />
									</Button>
									<Button variant="outline" size="icon-sm" className="size-8" onClick={() => nextCursor && setCursorStack((current) => [...current, nextCursor])} disabled={!nextCursor || isFetching} aria-label="Next page">
										<ChevronRight className="size-4" />
									</Button>
								</div>
							</div>
						</div>
					</>
				) : (
					<EmptyState
						icon={hasFilter ? <SearchX className="size-4" aria-hidden="true" /> : undefined}
						title={hasFilter ? "No matching person" : "No people yet"}
						description={
							hasFilter
								? "No identified user has that exact external ID in this range."
								: "People appear here after a Prism SDK calls identify() with your application's user ID."
						}
						action={
							hasFilter ? (
								<Button variant="outline" size="sm" onClick={() => { setSearch(""); updateUrl({ q: null }); }}>
									Clear search
								</Button>
							) : (
								<Button asChild size="sm"><Link to={`${basePath}/sources`}>Set up a source</Link></Button>
							)
						}
					/>
				)}
			</div>
		</div>
	);
}
