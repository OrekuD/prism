import type { ColumnDef, Row } from "@tanstack/react-table";
import {
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import React from "react";
import {
	Outlet,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";

import { Frame } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { Button } from "@/components/ui/button";
import { DataTablePagination } from "@/components/ui/data-pagination";
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
import {
	FAMILY_LABELS,
	type PlatformFamily,
	agoLabel,
	clockLabel,
	platformDotClass,
	platformFamily,
} from "@/lib/events";
import { cn } from "@/lib/utils";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import type { EventResource } from "@prism-analytics/types";

const fmt = new Intl.NumberFormat();

type TypeFilter = "all" | PlatformFamily;

/** Family → exact platform values it expands to (v2 filter semantics). */
function familyOf(event: EventResource): PlatformFamily | null {
	const platform = event.platform ?? event.source?.platform ?? null;
	return platform ? platformFamily(platform) : null;
}

function SourceCell({ event }: { event: EventResource }) {
	const source = event.source;
	if (!source) {
		return <span className="font-mono text-[11px] text-text-subtle">—</span>;
	}
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span
				className={cn(
					"size-[7px] shrink-0 rounded-full",
					platformDotClass(source.platform),
				)}
				aria-hidden="true"
			/>
			<b className="whitespace-nowrap font-mono text-[12px] font-medium text-text">
				{source.name}
			</b>
			<span className="whitespace-nowrap font-mono text-[11px] text-text-subtle">
				· {source.platform}
			</span>
		</div>
	);
}

function PersonCell({ event }: { event: EventResource }) {
	if (event.userId) {
		return (
			<span className="block max-w-[140px] truncate font-mono text-[12px] text-text">
				{event.userId}
			</span>
		);
	}
	if (event.personId) {
		return (
			<span
				className="block max-w-[140px] truncate font-mono text-[12px] text-text-muted"
				title={event.anonymousId ?? undefined}
			>
				{event.personId.slice(0, 10)}…
			</span>
		);
	}
	return (
		<span className="font-mono text-[12px] text-text-muted">Anonymous</span>
	);
}

export function ProjectEvents() {
	const { slug, wrkSlug } = useParams<{ slug: string; wrkSlug: string }>();
	const navigate = useNavigate();
	// URL is the source of truth for filters (same pattern as Errors).
	const [searchParams, setSearchParams] = useSearchParams();
	const q = searchParams.get("q") ?? "";
	const type = (searchParams.get("type") ?? "all") as TypeFilter;
	const sourceId = searchParams.get("source") ?? "all";
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
		setSearchParams(next, { replace: true });
	};

	const { data, isLoading, isError, refetch } = useProjectEventsQuery(slug);
	const sourcesQuery = useSourcesQuery(slug);
	const events = React.useMemo(() => data ?? [], [data]);

	const hasActiveFilter =
		q.trim() !== "" || type !== "all" || sourceId !== "all";

	// Pre-filter outside TanStack (typed URL-backed filters); the table owns
	// pagination + the global text search over name/identity columns.
	const filteredData = React.useMemo(() => {
		let rows = events;
		if (type !== "all") {
			rows = rows.filter((event) => familyOf(event) === type);
		}
		if (sourceId !== "all") {
			rows = rows.filter((event) => event.source?.id === sourceId);
		}
		return rows;
	}, [events, type, sourceId]);

	const openEvent = React.useCallback(
		(row: Row<EventResource>) => {
			navigate(
				`/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/events/${row.original.id}`,
			);
		},
		[navigate, slug, wrkSlug],
	);

	const columns = React.useMemo<ColumnDef<EventResource>[]>(() => {
		const onOpen = openEvent;
		const eventColumn: ColumnDef<EventResource> = {
			id: "name",
			accessorFn: (row) => row.name,
			header: "Event",
			filterFn: "includesString",
			cell: ({ row }) => {
				const event = row.original;
				const propEntries = Object.entries(event.properties ?? {});
				const firstProp = propEntries[0];
				return (
					<div className="min-w-0 py-0.5">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onOpen(row);
							}}
							className="block max-w-[240px] cursor-pointer truncate rounded-[2px] text-left font-mono text-[13px] text-text hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
							title={`Open ${event.name}`}
						>
							{event.name}
						</button>
						{firstProp ? (
							<div className="mt-0.5 max-w-[240px] truncate font-mono text-[11px] text-text-subtle">
								{firstProp[0]}: {String(firstProp[1]).slice(0, 40)}
								{propEntries.length > 1 ? ` · +${propEntries.length - 1}` : ""}
							</div>
						) : null}
						{event.sdkName ? (
							<div className="mt-0.5 max-w-[240px] truncate font-mono text-[11px] text-text-subtle">
								{event.sdkName.split("/").pop()} {event.sdkVersion ?? ""} · v
								{event.schemaVersion}
							</div>
						) : null}
					</div>
				);
			},
		};
		const sourceColumn: ColumnDef<EventResource> = {
			id: "source",
			accessorFn: (row) =>
				row.source ? `${row.source.name} ${row.source.platform}` : "",
			header: "Source",
			filterFn: "includesString",
			cell: ({ row }) => <SourceCell event={row.original} />,
		};
		const personColumn: ColumnDef<EventResource> = {
			id: "person",
			accessorFn: (row) =>
				[row.userId, row.anonymousId, row.personId].filter(Boolean).join(" "),
			header: "Person",
			filterFn: "includesString",
			cell: ({ row }) => <PersonCell event={row.original} />,
		};
		const sessionColumn: ColumnDef<EventResource> = {
			id: "session",
			accessorFn: (row) => row.sessionId ?? "",
			header: "Session",
			filterFn: "includesString",
			cell: ({ row }) =>
				row.original.sessionId ? (
					<span
						className="block max-w-[110px] truncate font-mono text-[12px] text-text-muted"
						title={row.original.sessionId}
					>
						{row.original.sessionId.slice(0, 8)}…
					</span>
				) : (
					<span className="font-mono text-[12px] text-text-subtle">—</span>
				),
		};
		const timeColumn: ColumnDef<EventResource> = {
			id: "time",
			accessorFn: (row) => row.occurredAt,
			header: () => <div className="text-right">Time</div>,
			cell: ({ row }) => (
				<div className="whitespace-nowrap text-right">
					<div className="font-mono text-[12px] leading-[1.4] text-text-muted">
						{agoLabel(row.original.occurredAt)}
					</div>
					<div className="font-mono text-[11px] text-text-subtle">
						{clockLabel(row.original.occurredAt)}
					</div>
				</div>
			),
		};
		return [eventColumn, sourceColumn, personColumn, sessionColumn, timeColumn];
	}, [openEvent]);

	const globalFilter = q.trim();

	const table = useReactTable({
		data: filteredData,
		columns,
		state: { globalFilter },
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: { pagination: { pageSize: 10 } },
		autoResetPageIndex: true,
	});

	const sourceOptions = (sourcesQuery.data ?? []).filter((s) => {
		if (type === "all") return true;
		return platformFamily(s.platform) === type;
	});

	return (
		<div className="flex flex-1 flex-col">
			<PageHeader
				title="Events"
				description={`Trusted event stream · ${fmt.format(filteredData.length)} events${
					type === "all" ? "" : ` · ${FAMILY_LABELS[type]}`
				}.`}
			/>

			{/* Filters */}
			<div className="mb-3 mt-6 flex flex-wrap items-center gap-2.5">
				<div className="relative min-w-[220px] flex-1">
					<Search
						className="pointer-events-none absolute left-2.5 top-1/2 size-[15px] -translate-y-1/2 text-text-subtle"
						aria-hidden="true"
					/>
					<input
						type="search"
						defaultValue={q}
						placeholder="Filter by event name, source or person"
						aria-label="Search events"
						onChange={(e) => {
							const value = e.target.value;
							if (searchTimer.current) window.clearTimeout(searchTimer.current);
							searchTimer.current = window.setTimeout(() => {
								updateFilter({ q: value || null });
							}, 250);
						}}
						className="h-[34px] w-full rounded-[2px] border border-border-strong bg-surface pl-8 pr-3 font-mono text-[13px] text-text placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-focus"
					/>
				</div>
				<Select
					value={type}
					onValueChange={(value) =>
						updateFilter({
							type: value === "all" ? null : value,
							source: null,
						})
					}
				>
					<SelectTrigger className="h-[34px] w-[170px] font-mono text-[13px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All source types</SelectItem>
						<SelectItem value="web">Web</SelectItem>
						<SelectItem value="mobile">Mobile</SelectItem>
						<SelectItem value="server">Server</SelectItem>
					</SelectContent>
				</Select>
				<Select
					value={sourceId}
					onValueChange={(value) =>
						updateFilter({ source: value === "all" ? null : value })
					}
				>
					<SelectTrigger className="h-[34px] w-[190px] font-mono text-[13px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All sources</SelectItem>
						{sourceOptions.map((s) => (
							<SelectItem key={s.id} value={s.id}>
								{s.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						updateFilter({
							q: null,
							type: null,
							source: null,
						})
					}
					disabled={!hasActiveFilter}
				>
					Clear filters
				</Button>
			</div>

			{isLoading ? (
				<div className="space-y-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : isError ? (
				<Frame className="p-6">
					<p className="text-[13px] text-text-muted">Could not load events.</p>
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				</Frame>
			) : table.getRowModel().rows.length > 0 ? (
				<>
					<div className="rounded-[2px] border border-border">
						<Table aria-label="Events">
							<TableHeader>
								{table.getHeaderGroups().map((headerGroup) => (
									<TableRow key={headerGroup.id}>
										{headerGroup.headers.map((header) => (
											<TableHead key={header.id}>
												{header.isPlaceholder
													? null
													: typeof header.column.columnDef.header === "function"
														? header.column.columnDef.header(
																header.getContext(),
															)
														: header.column.columnDef.header}
											</TableHead>
										))}
									</TableRow>
								))}
							</TableHeader>
							<TableBody>
								{table.getRowModel().rows.map((row) => (
									<TableRow
										key={row.id}
										onClick={() => openEvent(row)}
										className="cursor-pointer align-top"
									>
										{row.getVisibleCells().map((cell) => (
											<TableCell key={cell.id}>
												{typeof cell.column.columnDef.cell === "function"
													? cell.column.columnDef.cell(cell.getContext())
													: cell.getValue()}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					<DataTablePagination table={table} totalRows={events.length} />
				</>
			) : (
				<Frame className="p-6">
					<h3 className="text-[15px] font-semibold tracking-[-0.01em]">
						{hasActiveFilter || q.trim()
							? "No events match these filters."
							: events.length === 0
								? "No events yet"
								: "No matching events"}
					</h3>
					<p className="mt-1.5 text-[13px] text-text-muted">
						{hasActiveFilter || q.trim()
							? "Try a different query or clear the filters."
							: 'Log events from your site, app or server with prism.track("name", { … }) using the project key.'}
					</p>
					{hasActiveFilter || q.trim() ? (
						<Button
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() =>
								updateFilter({
									q: null,
									type: null,
									source: null,
								})
							}
						>
							Clear filters
						</Button>
					) : null}
				</Frame>
			)}

			<p className="mt-3 font-mono text-[11px] leading-[1.5] text-text-subtle">
				Source attribution is trusted from the ingestion key and cannot be
				spoofed. Client-supplied source or platform fields are ignored at
				ingestion.
			</p>

			{/* Detail sheet renders here when an event is open */}
			<Outlet />
		</div>
	);
}
