import type { ColumnDef, Row } from "@tanstack/react-table";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search, SearchX, X } from "@/components/ui/lucide-icons";
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
import {
  type PlatformFamily,
  agoLabel,
  clockLabel,
  platformDotClass,
  platformFamily,
  platformLabel,
} from "@/lib/events";
import { cn } from "@/lib/utils";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import type { EventResource, EventListItemResource } from "@prism-analytics/types";

function formatTimeDisplay(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (Number.isNaN(new Date(ts).getTime())) return String(ts);
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
    return clockLabel(ts);
  }
  if (diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000) {
    return agoLabel(ts);
  }
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceCell({ event }: { event: EventResource }) {
  const source = event.source;
  if (!source) {
    return <span className="text-[11px] text-text-subtle">—</span>;
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          platformDotClass(source.platform)
        )}
        aria-hidden="true"
      />
      <span className="truncate whitespace-nowrap text-[12.5px] font-medium leading-none tracking-[-0.01em] text-text">
        {source.name}
      </span>
      <span className="shrink-0 whitespace-nowrap text-[11px] leading-none text-text-subtle">
        {platformLabel(source.platform)}
      </span>
    </div>
  );
}

type TypeFilter = "all" | PlatformFamily;

export function ProjectEvents() {
  const { slug, wrkSlug } = useParams<{ slug: string; wrkSlug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const type = (searchParams.get("type") ?? "all") as TypeFilter;
  const sourceId = searchParams.get("source") ?? "all";
  // Snapshot drill-down mode (R6-F1): a `ctx` token carries the verified
  // range + source scope. It reaches the API untouched; any user filter
  // change clears it so a stale token never mixes with new filter state.
  const snapshotCtx = searchParams.get("ctx") ?? undefined;
  const searchTimer = React.useRef<number | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const updateFilter = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams);
    next.delete("ctx");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    setSearchParams(next, { replace: true });
  };

  const exitSnapshot = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete("ctx");
    setSearchParams(next, { replace: true });
  };

  // Server pagination state — keyset cursor stack.
  const [limit, setLimit] = React.useState(10);
  const [cursorStack, setCursorStack] = React.useState<Array<string | null>>([
    null,
  ]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? undefined;
  const pageIndex = cursorStack.length - 1;

  // Reset to first page when filters, snapshot, or page size change.
  React.useEffect(() => {
    setCursorStack([null]);
  }, [q, type, sourceId, snapshotCtx, limit]);

  const platformFamilyParam = type === "all" ? undefined : type;
  const sourceIdParam = sourceId === "all" ? undefined : sourceId;
  const qParam = q.trim() ? q.trim() : undefined;

  const { data, isLoading, isError, isFetching, refetch } =
    useProjectEventsQuery(slug, {
      q: qParam,
      // In snapshot mode the signed scope is authoritative server-side;
      // local source/type selections are not sent with the token.
      sourceId: snapshotCtx ? undefined : sourceIdParam,
      platformFamily: snapshotCtx ? undefined : platformFamilyParam,
      cursor: currentCursor ?? undefined,
      limit,
      ctx: snapshotCtx,
    });

  const sourcesQuery = useSourcesQuery(slug);
  const events = data?.events ?? [];
  const nextCursor = data?.nextCursor ?? null;
  const hasNext = Boolean(nextCursor);
  const hasPrev = cursorStack.length > 1;

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
  };
  const handlePrev = () => {
    setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const hasActiveFilter =
    q.trim() !== "" || type !== "all" || sourceId !== "all";

  const openEvent = React.useCallback(
    (row: Row<EventResource>) => {
      navigate(
        `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/events/${row.original.id}`
      );
    },
    [navigate, slug, wrkSlug]
  );

  const columns = React.useMemo<ColumnDef<EventResource>[]>(() => {
    const onOpen = openEvent;
    const eventColumn: ColumnDef<EventResource> = {
      id: "name",
      accessorFn: (row) => row.name,
      header: "Event",
      size: 280,
      cell: ({ row }) => {
        const event = row.original as EventResource & { standardEvent?: EventListItemResource["standardEvent"] };
        const std = event.standardEvent ?? null;
        if (std) {
          return (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(row);
                  }}
                  className="max-w-[160px] truncate rounded-md text-left text-[13px] font-medium leading-none tracking-[-0.01em] text-text underline-offset-4 hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  title={`Open ${std.displayName} — ${event.name}`}
                  aria-label={`${std.displayName}, Standard ${std.category}`}
                >
                  {std.displayName}
                </button>
                <span className="inline-flex shrink-0 items-center gap-1" aria-hidden="true">
                  <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-normal text-text-subtle">
                    Standard
                  </span>
                  <span className="text-[10px] leading-none tracking-normal text-text-subtle">
                    {std.category}
                  </span>
                </span>
              </div>
              <span className="block max-w-[260px] truncate text-[11px] leading-none text-text-subtle" title={event.name}>
                {event.name}
              </span>
            </div>
          );
        }
        return (
          <div className="min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(row);
              }}
              className="block max-w-[260px] cursor-pointer truncate rounded-md text-left text-[13px] font-medium leading-none tracking-[-0.01em] text-text underline-offset-4 hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              title={`Open ${event.name}`}
            >
              {event.name}
            </button>
          </div>
        );
      },
    };
    const sourceColumn: ColumnDef<EventResource> = {
      id: "source",
      accessorFn: (row) =>
        row.source ? `${row.source.name} ${row.source.platform}` : "",
      header: "Source",
      size: 200,
      cell: ({ row }) => <SourceCell event={row.original} />,
    };
    const sessionColumn: ColumnDef<EventResource> = {
      id: "session",
      accessorFn: (row) => row.sessionId ?? "",
      header: "Session",
      size: 130,
      cell: ({ row }) =>
        row.original.sessionId ? (
          <span
            className="block max-w-[112px] truncate text-[12px] leading-none text-text-muted tabular-nums"
            title={row.original.sessionId}
          >
            {row.original.sessionId.slice(0, 8)}…
          </span>
        ) : (
          <span className="text-[12px] leading-none text-text-subtle">
            —
          </span>
        ),
    };
    const timeColumn: ColumnDef<EventResource> = {
      id: "time",
      accessorFn: (row) => row.occurredAt,
      header: "Time",
      size: 152,
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-right text-[12.5px] leading-none tracking-[-0.01em] text-text tabular-nums">
          <span
            title={`${agoLabel(row.original.occurredAt)} · ${clockLabel(row.original.occurredAt)} — ${new Date(row.original.occurredAt).toLocaleString()}`}
          >
            {formatTimeDisplay(row.original.occurredAt)}
          </span>
        </div>
      ),
    };
    return [eventColumn, sourceColumn, sessionColumn, timeColumn];
  }, [openEvent]);

  const table = useReactTable({
    data: events,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const sourceOptions = (sourcesQuery.data ?? []).filter((s) => {
    if (type === "all") return true;
    return platformFamily(s.platform) === type;
  });

  React.useEffect(() => {
    if (!searchInputRef.current) return;
    if (searchInputRef.current.value !== q) {
      searchInputRef.current.value = q;
    }
  }, [q]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Events"
        description="Raw event stream for this project."
      />

      {/* Filters */}
      {snapshotCtx ? (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border bg-surface px-3 py-2"
        >
          <span className="text-[13px] text-text-muted">
            Viewing a shared snapshot — range and sources are fixed by the link.
          </span>
          <Button variant="ghost" size="sm" onClick={exitSnapshot} className="h-8 px-3 text-[13px]">
            Exit snapshot
          </Button>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-[14px] -translate-y-1/2 text-text-subtle"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            defaultValue={q}
            placeholder="Filter by event name or source…"
            aria-label="Search events"
            onChange={(e) => {
              const value = e.target.value;
              if (searchTimer.current) window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => {
                updateFilter({ q: value || null });
              }, 250);
            }}
            className="h-9 w-full rounded-[10px] border border-border bg-background py-2 pl-9 pr-8 text-[13px] leading-none text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:border-border-strong [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                if (searchInputRef.current) searchInputRef.current.value = "";
                updateFilter({ q: null });
              }}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-text-subtle hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
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
          <SelectTrigger className="h-9 w-[172px] text-[13px]">
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
          <SelectTrigger className="h-9 w-[188px] text-[13px]">
            <SelectValue placeholder="All sources" />
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
        {hasActiveFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateFilter({ q: null, type: null, source: null })}
            className="h-9 px-3 text-[13px]"
          >
            Clear
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled
            className="h-9 px-3 text-[13px] disabled:opacity-40"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="mt-4 flex-1">
        {isLoading ? (
          <div className="overflow-hidden rounded-[16px] border border-border">
            <div className="border-b border-border bg-surface/50 px-3.5 py-2.5">
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3.5 py-[14px]"
                >
                  <Skeleton className="h-3 w-[160px]" />
                  <Skeleton className="hidden h-3 w-[148px] sm:block" />
                  <Skeleton className="hidden h-3 w-[120px] md:block" />
                  <Skeleton className="ml-auto h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        ) : isError ? (
          <EmptyState
            icon={<SearchX className="size-4" aria-hidden="true" />}
            title="Could not load events"
            description="The stream is temporarily unavailable. Retry or check your connection."
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8">
                Retry
              </Button>
            }
          />
        ) : table.getRowModel().rows.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-[16px] border border-border bg-background">
              <Table aria-label="Events" className="table-fixed">
                <TableHeader className="bg-surface/50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow
                      key={headerGroup.id}
                      className="border-border bg-transparent hover:bg-transparent"
                    >
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className={
                            header.column.id === "time"
                              ? "text-right"
                              : undefined
                          }
                        >
                          {header.isPlaceholder
                            ? null
                            : typeof header.column.columnDef.header ===
                                "function"
                              ? header.column.columnDef.header(
                                  header.getContext()
                                )
                              : header.column.columnDef.header}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {isFetching
                    ? Array.from({ length: limit }).map((_, i) => (
                        <TableRow key={`skeleton-${i}`} className="h-[44px] border-border">
                          <TableCell style={{ width: 280 }} className="h-[44px] py-0 align-middle">
                            <Skeleton className="h-3 w-[140px]" />
                          </TableCell>
                          <TableCell style={{ width: 200 }} className="h-[44px] py-0 align-middle">
                            <Skeleton className="h-3 w-[120px]" />
                          </TableCell>
                          <TableCell style={{ width: 130 }} className="h-[44px] py-0 align-middle">
                            <Skeleton className="h-3 w-[80px]" />
                          </TableCell>
                          <TableCell style={{ width: 152 }} className="h-[44px] py-0 align-middle">
                            <div className="ml-auto flex flex-col items-end gap-1">
                              <Skeleton className="h-3 w-20" />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          onClick={() => openEvent(row)}
                          className="h-[44px] cursor-pointer hover:bg-surface/60"
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                              className="h-[44px] py-0 align-middle"
                            >
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
            <div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-3">
              <div className="text-[12px] text-text-muted tabular-nums">
                {isFetching ? (
                  "Loading…"
                ) : (
                  <>
                    Page {pageIndex + 1} · {events.length} event
                    {events.length === 1 ? "" : "s"}
                    {hasNext ? " · more" : ""}
                  </>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-text-subtle sm:inline">
                    Rows per page
                  </span>
                  <Select
                    value={String(limit)}
                    onValueChange={(value) => setLimit(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[72px] text-[12px]">
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
            </div>
          </>
        ) : (
          <EmptyState
            icon={<SearchX className="size-4" aria-hidden="true" />}
            title={hasActiveFilter ? "No matching events" : "No events yet"}
            description={
              hasActiveFilter
                ? "Try a different query or clear the filters to see more of the stream."
                : "Raw event stream for this project. Once your sources emit events, they'll appear here for inspection."
            }
            action={
              hasActiveFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[13px]"
                  onClick={() => updateFilter({ q: null, type: null, source: null })}
                >
                  Clear filters
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="h-8 text-[13px]"
                    onClick={() => navigate(`/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/sources`)}
                  >
                    View sources
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-[13px]" asChild>
                    <a href="https://prism.dev/docs" target="_blank" rel="noreferrer">
                      View docs
                    </a>
                  </Button>
                </>
              )
            }
          />
        )}
      </div>

      <Outlet />
    </div>
  );
}
