import { Frame } from "@/components/public/frame";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import { useWebAnalyticsQuery } from "@/network/queries/useWebAnalyticsQuery";
import type {
  WebAnalyticsComparisonValue,
  WebAnalyticsResource,
} from "@prism-analytics/types";
import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";

import {
  DeltaBadge,
  PanelHead,
  Seg,
  numFmt,
} from "@/components/web-analytics/shared";
import {
  AnalyticsTable,
  AnalyticsTableBody,
  AnalyticsTableHead,
  AnalyticsTableHeaderCell,
  AnalyticsTableHeaderRow,
  AnalyticsTableRow,
  AnalyticsTableCell,
} from "@/components/web-analytics/analytics-table";
import {
  SERIES_META,
  TrendChart,
} from "@/components/web-analytics/trend-chart";
import type { SeriesKey } from "@/components/web-analytics/trend-chart";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

type WaRangeKey = "24h" | "7d" | "14d" | "30d" | "90d" | "12m";

const WA_RANGES: Array<{ key: WaRangeKey; label: string }> = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "12m", label: "12m" },
];

const RANGE_MS: Record<WaRangeKey, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 86_400_000,
  "14d": 14 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
  "12m": 365 * 86_400_000,
};

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export function ProjectWebAnalytics() {
  const { slug } = useParams<{ slug: string }>();
  const [params, setParams] = useSearchParams();

  const sourcesQuery = useSourcesQuery(slug);
  const webSources = React.useMemo(
    () => (sourcesQuery.data ?? []).filter((s) => s.platform === "web"),
    [sourcesQuery.data]
  );

  // URL state — range/compare/filters + per-section tabs
  const range = (params.get("range") as WaRangeKey) ?? "30d";
  const normalizedRange: WaRangeKey = range in RANGE_MS ? range : "30d";
  const compare = params.get("cmp") !== "off";
  const sourceId = params.get("src") ?? "all";
  const host = params.get("host") ?? "all";
  const traffic = params.get("traffic") === "all" ? "all" : "human";
  const path = params.get("path") ?? "";
  const series = (params.get("series") as SeriesKey) ?? "pageViews";
  const pagesTab = params.get("ptab") === "entry" ? "entry" : "all";
  const acqDim = (
    ["referrers", "source", "medium"] as const
  ).includes(params.get("acq") as never)
    ? (params.get("acq") as "referrers" | "source" | "medium")
    : "referrers";
  const techDim = (
    ["browsers", "operatingSystems", "devices"] as const
  ).includes(params.get("tdim") as never)
    ? (params.get("tdim") as "browsers" | "operatingSystems" | "devices")
    : "browsers";

  // expanded table dialogs
  const [expandedTable, setExpandedTable] = React.useState<string | null>(null);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // heal stale source/host
  const validSource =
    sourceId === "all" || webSources.some((s) => s.id === sourceId);
  const effSourceId = validSource ? sourceId : "all";
  const hosts = React.useMemo(() => {
    const scoped =
      effSourceId === "all"
        ? webSources
        : webSources.filter((s) => s.id === effSourceId);
    const out: string[] = [];
    for (const s of scoped) {
      for (const o of s.allowedOrigins ?? []) {
        const h = o.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (h && !out.includes(h)) out.push(h);
      }
    }
    return out;
  }, [webSources, effSourceId]);
  const effHost = hosts.includes(host) ? host : "all";

  // stable window — no custom range, no Date.now() on every render loop
  const { from, to } = React.useMemo(() => {
    const toMs = Date.now();
    return { from: toMs - RANGE_MS[normalizedRange], to: toMs };
  }, [normalizedRange]);
  const span = to - from;
  const prev = { from: from - span, to: from };

  const sourceIds = effSourceId === "all" ? undefined : [effSourceId];
  const query = useWebAnalyticsQuery({
    slug: slug ?? "",
    from,
    to,
    sourceIds,
    host: effHost === "all" ? null : effHost,
    path: path || null,
    traffic,
  });
  const prevQuery = useWebAnalyticsQuery({
    slug: slug ?? "",
    from: prev.from,
    to: prev.to,
    sourceIds,
    host: effHost === "all" ? null : effHost,
    path: path || null,
    traffic,
    enabled: compare,
  });

  const data = query.data;
  const loading = query.isLoading || sourcesQuery.isLoading;

  const filtersOn =
    effSourceId !== "all" ||
    effHost !== "all" ||
    traffic !== "human" ||
    Boolean(path);

  const resetFilters = () => {
    setParams(new URLSearchParams({ range: normalizedRange }), {
      replace: true,
    });
  };

  // acquisition regrouping (source / medium / campaign share same raw campaigns)
  const acqRows = React.useMemo(() => {
    if (!data) return [];
    if (acqDim === "referrers") return [];
    const groups = new Map<string, { sessions: number; visitors: number }>();
    for (const r of data.campaigns) {
      const raw =
        acqDim === "source"
          ? r.source
          : acqDim === "medium"
            ? r.medium
            : r.name;
      const key = raw ?? "(none)";
      const acc = groups.get(key) ?? { sessions: 0, visitors: 0 };
      acc.sessions += r.sessions;
      acc.visitors += r.visitors;
      groups.set(key, acc);
    }
    return [...groups.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 12);
  }, [data, acqDim]);

  if (!loading && webSources.length === 0) {
    return (
      <EmptyState
        title="No Web sources in this project."
        description="Web analytics aggregates page-view telemetry from sources with the Web platform."
        className="border border-border"
      />
    );
  }

  const isEmpty = !loading && !!data && data.totals.pageViews === 0;

  return (
    <div className="w-full">
      {/* head + filters — single row, no description */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[26px] font-semibold leading-[1.18] tracking-[-0.025em]">
          Web Analytics
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {filtersOn ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 items-center rounded-[2px] border border-border bg-canvas px-3 text-[13px] font-medium hover:bg-surface-hover"
            >
              Reset
            </button>
          ) : null}
          <Select
            value={effSourceId}
            onValueChange={(v) =>
              setParam({ src: v === "all" ? null : v, host: null })
            }
          >
            <SelectTrigger className="h-8 w-[170px] rounded-[2px] border-border bg-canvas text-[13px] data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All web sources</SelectItem>
              {webSources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hosts.length > 1 ? (
            <Select
              value={effHost}
              onValueChange={(v) => setParam({ host: v === "all" ? null : v })}
            >
              <SelectTrigger className="h-8 w-[150px] rounded-[2px] border-border bg-canvas text-[13px] data-[size=default]:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All hosts</SelectItem>
                {hosts.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select
            value={traffic}
            onValueChange={(v) =>
              setParam({ traffic: v === "all" ? "all" : null })
            }
          >
            <SelectTrigger className="h-8 w-[140px] rounded-[2px] border-border bg-canvas text-[13px] data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="human">Human traffic</SelectItem>
              <SelectItem value="all">Include bots</SelectItem>
            </SelectContent>
          </Select>

          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

          <Select
            value={normalizedRange}
            onValueChange={(v) => setParam({ range: v })}
          >
            <SelectTrigger className="h-8 w-[90px] rounded-[2px] border-border bg-canvas text-[13px] data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[90px]">
              {WA_RANGES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            aria-pressed={compare}
            onClick={() => setParam({ cmp: compare ? "off" : null })}
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-[2px] border px-3 text-[13px] font-medium leading-none transition-colors",
              compare
                ? "border-accent/45 bg-accent-soft text-text"
                : "border-border bg-canvas text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            Compare
          </button>

          <span
            title="All trend buckets and ranges are evaluated in UTC, not your local timezone"
            className="font-mono text-[11px] font-medium tracking-[0.04em] text-text-subtle"
          >
            UTC
          </span>

          {path ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-[2px] border border-border bg-canvas px-2 font-mono text-[11px] font-medium text-accent">
              <span className="max-w-[200px] truncate">{path}</span>
              <button
                type="button"
                aria-label="Remove page filter"
                onClick={() => setParam({ path: null })}
                className="ml-0.5 flex size-5 items-center justify-center rounded-[2px] hover:bg-accent/20"
              >
                ×
              </button>
            </span>
          ) : null}
        </div>
      </div>

      {/* metrics — only marks on this strip */}
      <Frame className="mb-3">
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              [
                "Page views",
                data?.totals.pageViews,
                data?.comparison.pageViews,
                false,
              ],
              [
                "Unique visitors",
                data?.totals.visitors,
                data?.comparison.visitors,
                false,
              ],
              [
                "Sessions",
                data?.totals.sessions,
                data?.comparison.sessions,
                false,
              ],
              [
                "Bounce rate",
                data
                  ? data.totals.bounceRate == null
                    ? null
                    : `${data.totals.bounceRate}%`
                  : undefined,
                data?.comparison.bounceRate ?? null,
                true,
              ],
              [
                "Views per session",
                data
                  ? Number(data.totals.viewsPerSession.toFixed(1))
                  : undefined,
                data?.comparison.viewsPerSession,
                false,
              ],
            ] as Array<
              [
                string,
                number | string | null | undefined,
                WebAnalyticsComparisonValue | null | undefined,
                boolean,
              ]
            >
          ).map(([label, value, cmp, invert]) => (
            <div
              key={label}
              className="flex h-[86px] min-w-0 flex-col justify-between bg-canvas p-4"
            >
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
                {label}
              </span>
              <div className="flex h-[22px] items-center justify-between gap-2">
                {loading || value === undefined ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <span className="whitespace-nowrap font-mono text-[22px] leading-none tracking-[-0.06em] tabular-nums">
                    {value === null
                      ? "—"
                      : typeof value === "number"
                        ? numFmt.format(value)
                        : value}
                  </span>
                )}
                <div className="flex min-h-[14px] min-w-[56px] items-center justify-end">
                  {!loading && value !== undefined ? (
                    <DeltaBadge
                      value={
                        (cmp ?? null) as WebAnalyticsComparisonValue | null
                      }
                      compareOn={compare}
                      invert={invert}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Frame>

      {/* trend — hidden when no data, the overall empty CTA replaces it */}
      {!isEmpty ? (
        <Frame className="mb-3 p-5 pb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-medium tracking-[-0.01em]">
              Page-view trend
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {compare ? (
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] text-text-muted">
                    <i
                      className="inline-block size-2 rounded-[1px]"
                      style={{ background: SERIES_META[series].color }}
                    />
                    Current
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] text-text-muted">
                    <i className="inline-block h-0.5 w-3.5 bg-[repeating-linear-gradient(90deg,var(--text-subtle)_0_4px,transparent_4px_7px)]" />
                    Previous
                  </span>
                </div>
              ) : null}
              <Seg
                label="Trend series"
                size="md"
                value={series}
                onChange={(s) => setParam({ series: s })}
                options={[
                  { key: "pageViews", label: "Page views" },
                  { key: "visitors", label: "Visitors" },
                  { key: "sessions", label: "Sessions" },
                ]}
              />
            </div>
          </div>
          {loading || !data ? (
            <Skeleton className="aspect-[3.2] min-h-[220px] w-full" />
          ) : (
            <TrendChart
              points={data.trend.points}
              prevPoints={prevQuery.data?.trend.points}
              compare={compare}
              series={series as SeriesKey}
              bucket={data.trend.bucket}
            />
          )}
        </Frame>
      ) : null}

      {/* empty overall state — replaces tables + trend when no page views */}
      {isEmpty ? (
        <div className="rounded-[2px] border border-dashed border-border bg-canvas p-8 text-center">
          <h3 className="text-[15px] font-medium">No page views yet</h3>
          <p className="mx-auto mt-1.5 max-w-[480px] text-sm leading-6 text-text-muted">
            Web analytics appears here once your Web source sends page views.
          </p>
          <a
            href="https://prism-analytics-docs.vercel.app/docs/features/page-analytics"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[2px] bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          >
            View page analytics docs
            <span aria-hidden="true">→</span>
          </a>
        </div>
      ) : (
        <>
          {/* Pages + Acquisition — Frame + main table design, 5 rows, header See more */}
          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Frame className="p-5">
              <div className="mb-3.5 flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em]">
                  Pages
                  <span
                    title="Top paths by views. Click a row to filter the whole report to that path."
                    aria-label="Top paths by views. Click a row to filter the whole report to that path."
                    className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] text-text-subtle"
                  >
                    ?
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {!loading && data && data.pages.length > 5 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedTable("pages")}
                      className="text-xs font-medium text-text-muted hover:text-text hover:underline"
                    >
                      View all ({data.pages.length})
                    </button>
                  ) : null}
                  <Seg
                    label="Pages tab"
                    size="md"
                    value={pagesTab}
                    onChange={(t) => setParam({ ptab: t })}
                    options={[
                      { key: "all", label: "All pages" },
                      { key: "entry", label: "Entry" },
                    ]}
                  />
                </div>
              </div>
              {loading || !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full rounded-[2px]" />
                  <Skeleton className="h-[42px] w-full rounded-[2px]" />
                  <Skeleton className="h-[42px] w-full rounded-[2px]" />
                  <Skeleton className="h-[42px] w-full rounded-[2px]" />
                  <Skeleton className="h-[42px] w-full rounded-[2px]" />
                  <Skeleton className="h-[42px] w-full rounded-[2px]" />
                </div>
              ) : data.pages.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-subtle">
                  No pages in this range.
                </p>
              ) : (
                <>
                  <AnalyticsTable>
                    <AnalyticsTableHead>
                      <AnalyticsTableHeaderRow>
                        {pagesTab === "all" ? (
                          <>
                            <AnalyticsTableHeaderCell>
                              Path
                            </AnalyticsTableHeaderCell>
                            <AnalyticsTableHeaderCell align="right">
                              Views
                            </AnalyticsTableHeaderCell>
                            <AnalyticsTableHeaderCell align="right">
                              Visitors
                            </AnalyticsTableHeaderCell>
                            <AnalyticsTableHeaderCell align="right">
                              Bounce
                            </AnalyticsTableHeaderCell>
                          </>
                        ) : (
                          <>
                            <AnalyticsTableHeaderCell>
                              Entry
                            </AnalyticsTableHeaderCell>
                            <AnalyticsTableHeaderCell align="right">
                              Entrances
                            </AnalyticsTableHeaderCell>
                            <AnalyticsTableHeaderCell align="right">
                              Share
                            </AnalyticsTableHeaderCell>
                          </>
                        )}
                      </AnalyticsTableHeaderRow>
                    </AnalyticsTableHead>
                    <AnalyticsTableBody>
                      {pagesTab === "all"
                        ? data.pages.slice(0, 5).map((p) => (
                            <AnalyticsTableRow
                              key={`${p.host ?? ""}${p.path}`}
                              selected={path === p.path}
                            >
                              <AnalyticsTableCell>
                                <button
                                  type="button"
                                  aria-label={`Filter report by ${p.path}`}
                                  onClick={() =>
                                    setParam({
                                      path: path === p.path ? null : p.path,
                                    })
                                  }
                                  className="block w-full text-left"
                                >
                                  <b className="block truncate font-mono text-[12.5px] font-medium">
                                    {p.path}
                                  </b>
                                  {/* <span className="block truncate text-[11px] text-text-muted">
                                    {p.title ?? ""}
                                    {p.host ? ` · ${p.host}` : ""}
                                  </span> */}
                                </button>
                              </AnalyticsTableCell>
                              <AnalyticsTableCell align="right">
                                {numFmt.format(p.pageViews)}
                              </AnalyticsTableCell>
                              <AnalyticsTableCell align="right">
                                {numFmt.format(p.visitors)}
                              </AnalyticsTableCell>
                              <AnalyticsTableCell align="right" subtle>
                                {p.bounceRate == null
                                  ? "—"
                                  : `${p.bounceRate}%`}
                              </AnalyticsTableCell>
                            </AnalyticsTableRow>
                          ))
                        : [...data.pages]
                            .sort((a, b) => b.entrances - a.entrances)
                            .slice(0, 5)
                            .map((p) => (
                              <AnalyticsTableRow
                                key={`entry-${p.host ?? ""}${p.path}`}
                                selected={path === p.path}
                              >
                                <AnalyticsTableCell>
                                  <button
                                    type="button"
                                    aria-label={`Filter report by ${p.path}`}
                                    onClick={() =>
                                      setParam({
                                        path: path === p.path ? null : p.path,
                                      })
                                    }
                                    className="block w-full text-left"
                                  >
                                    <b className="block truncate font-mono text-[12.5px] font-medium">
                                      {p.path}
                                    </b>
                                    {/* <span className="block truncate text-[11px] text-text-muted">
                                      {p.title ?? ""}
                                    </span> */}
                                  </button>
                                </AnalyticsTableCell>
                                <AnalyticsTableCell align="right">
                                  {numFmt.format(p.entrances)}
                                </AnalyticsTableCell>
                                <AnalyticsTableCell align="right" subtle>
                                  {p.sharePercent}%
                                </AnalyticsTableCell>
                              </AnalyticsTableRow>
                            ))}
                    </AnalyticsTableBody>
                  </AnalyticsTable>
                </>
              )}
            </Frame>

            <Frame className="p-5">
              <div className="mb-3.5 flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em]">
                  Acquisition
                  <span
                    title="Referrer hosts and UTM campaign attribution."
                    aria-label="Referrer hosts and UTM campaign attribution."
                    className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] text-text-subtle"
                  >
                    ?
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {!loading &&
                  data &&
                  (acqDim === "referrers"
                    ? data.referrers.length
                    : acqRows.length) > 5 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedTable("acquisition")}
                      className="text-xs font-medium text-text-muted hover:text-text hover:underline"
                    >
                      View all (
                      {acqDim === "referrers"
                        ? data.referrers.length
                        : acqRows.length}
                      )
                    </button>
                  ) : null}
                  <Seg
                    label="Acquisition dimension"
                    size="md"
                    value={acqDim}
                    onChange={(d) => setParam({ acq: d })}
                    options={[
                      { key: "referrers", label: "Referrers" },
                      { key: "source", label: "Source" },
                      { key: "medium", label: "Medium" },
                    ]}
                  />
                </div>
              </div>
              {loading || !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                </div>
              ) : acqDim === "referrers" ? (
                data.referrers.length === 0 ? (
                  <p className="py-10 text-center text-sm text-text-subtle">
                    No referrers in this range.
                  </p>
                ) : (
                  <>
                    <AnalyticsTable>
                      <AnalyticsTableHead>
                        <AnalyticsTableHeaderRow>
                          <AnalyticsTableHeaderCell>
                            Referrer
                          </AnalyticsTableHeaderCell>
                          <AnalyticsTableHeaderCell align="right">
                            Sessions
                          </AnalyticsTableHeaderCell>
                          <AnalyticsTableHeaderCell align="right">
                            Visitors
                          </AnalyticsTableHeaderCell>
                          <AnalyticsTableHeaderCell align="right">
                            Share
                          </AnalyticsTableHeaderCell>
                        </AnalyticsTableHeaderRow>
                      </AnalyticsTableHead>
                      <AnalyticsTableBody>
                        {data.referrers.slice(0, 5).map((r) => (
                          <AnalyticsTableRow
                            key={r.referrerHost ?? "__direct__"}
                          >
                            <AnalyticsTableCell>
                              {r.referrerHost ?? "Direct / none"}
                            </AnalyticsTableCell>
                            <AnalyticsTableCell align="right">
                              {numFmt.format(r.sessions)}
                            </AnalyticsTableCell>
                            <AnalyticsTableCell align="right">
                              {numFmt.format(r.visitors)}
                            </AnalyticsTableCell>
                            <AnalyticsTableCell align="right" subtle>
                              {r.sharePercent}%
                            </AnalyticsTableCell>
                          </AnalyticsTableRow>
                        ))}
                      </AnalyticsTableBody>
                    </AnalyticsTable>
                  </>
                )
              ) : acqRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-text-subtle">
                  No acquisition data in this range.
                </p>
              ) : (
                <AnalyticsTable>
                  <AnalyticsTableHead>
                    <AnalyticsTableHeaderRow>
                      <AnalyticsTableHeaderCell>
                        {acqDim.charAt(0).toUpperCase() + acqDim.slice(1)}
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Sessions
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Visitors
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Share
                      </AnalyticsTableHeaderCell>
                    </AnalyticsTableHeaderRow>
                  </AnalyticsTableHead>
                  <AnalyticsTableBody>
                    {acqRows.slice(0, 5).map((r) => (
                      <AnalyticsTableRow key={r.name}>
                        <AnalyticsTableCell>{r.name}</AnalyticsTableCell>
                        <AnalyticsTableCell align="right">
                          {numFmt.format(r.sessions)}
                        </AnalyticsTableCell>
                        <AnalyticsTableCell align="right">
                          {numFmt.format(r.visitors)}
                        </AnalyticsTableCell>
                        <AnalyticsTableCell align="right" subtle>
                          {Math.round(
                            (r.sessions /
                              Math.max(1, acqRows[0]?.sessions ?? 1)) *
                              100
                          )}
                          %
                        </AnalyticsTableCell>
                      </AnalyticsTableRow>
                    ))}
                  </AnalyticsTableBody>
                </AnalyticsTable>
              )}
            </Frame>
          </div>

          {/* Locations + Technology — Frame + main table design, View all in header */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Frame className="p-5">
              <div className="mb-3.5 flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em]">
                  Locations
                  <span
                    title="Geo from IP, only for fresh deliveries."
                    aria-label="Geo from IP, only for fresh deliveries."
                    className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] text-text-subtle"
                  >
                    ?
                  </span>
                </span>
                {!loading && data && data.locations.countries.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedTable("locations")}
                    className="text-xs font-medium text-text-muted hover:text-text hover:underline"
                  >
                    View all ({data.locations.countries.length})
                  </button>
                ) : null}
              </div>
              {loading || !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                </div>
              ) : (
                <AnalyticsTable>
                  <AnalyticsTableHead>
                    <AnalyticsTableHeaderRow>
                      <AnalyticsTableHeaderCell>
                        Country
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Sessions
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Views
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Share
                      </AnalyticsTableHeaderCell>
                    </AnalyticsTableHeaderRow>
                  </AnalyticsTableHead>
                  <AnalyticsTableBody>
                    {data.locations.countries.slice(0, 5).map((r, i) => (
                      <AnalyticsTableRow
                        key={[r.countryCode, r.region, r.city, i].join("|")}
                      >
                        <AnalyticsTableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-[2px] border border-border px-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-text-muted">
                              {r.countryCode ?? "?"}
                            </span>
                            {r.countryCode ?? "Unknown"}
                          </span>
                        </AnalyticsTableCell>
                        <AnalyticsTableCell align="right">
                          {numFmt.format(r.sessions)}
                        </AnalyticsTableCell>
                        <AnalyticsTableCell align="right">
                          {numFmt.format(r.pageViews)}
                        </AnalyticsTableCell>
                        <AnalyticsTableCell align="right" subtle>
                          {r.sharePercent}%
                        </AnalyticsTableCell>
                      </AnalyticsTableRow>
                    ))}
                  </AnalyticsTableBody>
                </AnalyticsTable>
              )}
            </Frame>

            <Frame className="p-5">
              <div className="mb-3.5 flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em]">
                  Technology
                  <span
                    title={`${data?.technology.coveragePercent ?? 0}% of pageviews with browser/OS context.`}
                    aria-label={`${data?.technology.coveragePercent ?? 0}% of pageviews with browser/OS context.`}
                    className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] text-text-subtle"
                  >
                    ?
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {!loading &&
                  data &&
                  (techDim === "browsers"
                    ? data.technology.browsers.length
                    : techDim === "operatingSystems"
                      ? data.technology.operatingSystems.length
                      : data.technology.devices.length) > 5 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedTable("technology")}
                      className="text-xs font-medium text-text-muted hover:text-text hover:underline"
                    >
                      View all (
                      {techDim === "browsers"
                        ? data.technology.browsers.length
                        : techDim === "operatingSystems"
                          ? data.technology.operatingSystems.length
                          : data.technology.devices.length}
                      )
                    </button>
                  ) : null}
                  <Seg
                    label="Technology tab"
                    size="md"
                    value={techDim}
                    onChange={(d) => setParam({ tdim: d })}
                    options={[
                      { key: "browsers", label: "Browsers" },
                      { key: "operatingSystems", label: "OS" },
                      { key: "devices", label: "Devices" },
                    ]}
                  />
                </div>
              </div>
              {loading || !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                  <Skeleton className="h-[36px] w-full rounded-[2px]" />
                </div>
              ) : (
                <AnalyticsTable>
                  <AnalyticsTableHead>
                    <AnalyticsTableHeaderRow>
                      <AnalyticsTableHeaderCell>Name</AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Views
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Visitors
                      </AnalyticsTableHeaderCell>
                      <AnalyticsTableHeaderCell align="right">
                        Share
                      </AnalyticsTableHeaderCell>
                    </AnalyticsTableHeaderRow>
                  </AnalyticsTableHead>
                  <AnalyticsTableBody>
                    {(techDim === "browsers"
                      ? data.technology.browsers
                      : techDim === "operatingSystems"
                        ? data.technology.operatingSystems
                        : data.technology.devices
                    )
                      .slice(0, 5)
                      .map((t) => (
                        <AnalyticsTableRow key={t.key}>
                          <AnalyticsTableCell>{t.label}</AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(t.pageViews)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(t.visitors)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right" subtle>
                            {t.sharePercent}%
                          </AnalyticsTableCell>
                        </AnalyticsTableRow>
                      ))}
                  </AnalyticsTableBody>
                </AnalyticsTable>
              )}
            </Frame>
          </div>
        </>
      )}

      {/* ---- expanded table dialogs ---- */}
      {expandedTable === "pages" && data && (
        <Dialog open onOpenChange={() => setExpandedTable(null)}>
          <DialogContent showCloseButton={false} className="min-w-[700px] max-w-[900px]">
            <DialogHeader>
              <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <DialogTitle>
                  Pages (
                  {pagesTab === "all"
                    ? data.pages.length
                    : [...data.pages].sort((a, b) => b.entrances - a.entrances)
                        .length}
                  )
                </DialogTitle>
                <Seg
                  label="Pages tab"
                  size="md"
                  value={pagesTab}
                  onChange={(t) => setParam({ ptab: t })}
                  options={[
                    { key: "all", label: "All pages" },
                    { key: "entry", label: "Entry" },
                  ]}
                />
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">
              <AnalyticsTable>
                <AnalyticsTableHead>
                  <AnalyticsTableHeaderRow>
                    {pagesTab === "all" ? (
                      <>
                        <AnalyticsTableHeaderCell>
                          Path
                        </AnalyticsTableHeaderCell>
                        <AnalyticsTableHeaderCell align="right">
                          Views
                        </AnalyticsTableHeaderCell>
                        <AnalyticsTableHeaderCell align="right">
                          Visitors
                        </AnalyticsTableHeaderCell>
                        <AnalyticsTableHeaderCell align="right">
                          Bounce
                        </AnalyticsTableHeaderCell>
                      </>
                    ) : (
                      <>
                        <AnalyticsTableHeaderCell>
                          Entry
                        </AnalyticsTableHeaderCell>
                        <AnalyticsTableHeaderCell align="right">
                          Entrances
                        </AnalyticsTableHeaderCell>
                        <AnalyticsTableHeaderCell align="right">
                          Share
                        </AnalyticsTableHeaderCell>
                      </>
                    )}
                  </AnalyticsTableHeaderRow>
                </AnalyticsTableHead>
                <AnalyticsTableBody>
                  {pagesTab === "all"
                    ? data.pages.map((p) => (
                        <AnalyticsTableRow
                          key={`${p.host ?? ""}${p.path}`}
                          selected={path === p.path}
                        >
                          <AnalyticsTableCell>
                            <button
                              type="button"
                              onClick={() => {
                                setParam({
                                  path: path === p.path ? null : p.path,
                                });
                                setExpandedTable(null);
                              }}
                              className="block w-full text-left"
                            >
                              <b className="block truncate font-mono text-[12.5px] font-medium">
                                {p.path}
                              </b>
                              {/* <span className="block truncate text-[11px] text-text-muted">
                                {p.title ?? ""}
                                {p.host ? ` · ${p.host}` : ""}
                              </span> */}
                            </button>
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(p.pageViews)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(p.visitors)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right" subtle>
                            {p.bounceRate == null ? "—" : `${p.bounceRate}%`}
                          </AnalyticsTableCell>
                        </AnalyticsTableRow>
                      ))
                    : [...data.pages]
                        .sort((a, b) => b.entrances - a.entrances)
                        .map((p) => (
                          <AnalyticsTableRow
                            key={`entry-${p.host ?? ""}${p.path}`}
                            selected={path === p.path}
                          >
                            <AnalyticsTableCell>
                              <button
                                type="button"
                                onClick={() => {
                                  setParam({
                                    path: path === p.path ? null : p.path,
                                  });
                                  setExpandedTable(null);
                                }}
                                className="block w-full text-left"
                              >
                                <b className="block truncate font-mono text-[12.5px] font-medium">
                                  {p.path}
                                </b>
                                {/* <span className="block truncate text-[11px] text-text-muted">
                                  {p.title ?? ""}
                                </span> */}
                              </button>
                            </AnalyticsTableCell>
                            <AnalyticsTableCell align="right">
                              {numFmt.format(p.entrances)}
                            </AnalyticsTableCell>
                            <AnalyticsTableCell align="right" subtle>
                              {p.sharePercent}%
                            </AnalyticsTableCell>
                          </AnalyticsTableRow>
                        ))}
                </AnalyticsTableBody>
              </AnalyticsTable>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {expandedTable === "acquisition" && data && (
        <Dialog open onOpenChange={() => setExpandedTable(null)}>
          <DialogContent showCloseButton={false} className="min-w-[700px] max-w-[900px]">
            <DialogHeader>
              <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <DialogTitle>Acquisition</DialogTitle>
                <Seg
                  label="Acquisition dimension"
                  size="md"
                  value={acqDim}
                  onChange={(d) => setParam({ acq: d })}
                  options={[
                    { key: "referrers", label: "Referrers" },
                    { key: "source", label: "Source" },
                    { key: "medium", label: "Medium" },
                  ]}
                />
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">
              <AnalyticsTable>
                <AnalyticsTableHead>
                  <AnalyticsTableHeaderRow>
                    <AnalyticsTableHeaderCell>
                      {acqDim === "referrers" ? "Referrer" : acqDim}
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Sessions
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Visitors
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Share
                    </AnalyticsTableHeaderCell>
                  </AnalyticsTableHeaderRow>
                </AnalyticsTableHead>
                <AnalyticsTableBody>
                  {(acqDim === "referrers" ? data.referrers : acqRows).map(
                    (r, i) => {
                      const isRef = acqDim === "referrers";
                      const maxSessions = isRef
                        ? (data.referrers[0]?.sessions ?? 1)
                        : (acqRows[0]?.sessions ?? 1);
                      const share = isRef
                        ? (r as (typeof data.referrers)[0]).sharePercent
                        : Math.round(
                            ((r as (typeof acqRows)[0]).sessions /
                              Math.max(1, maxSessions)) *
                              100
                          );
                      const key = isRef
                        ? ((r as (typeof data.referrers)[0]).referrerHost ??
                          "__direct__")
                        : (r as (typeof acqRows)[0]).name;
                      const label = isRef
                        ? ((r as (typeof data.referrers)[0]).referrerHost ??
                          "Direct / none")
                        : (r as (typeof acqRows)[0]).name;
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: key alone not guaranteed unique across referrers/acqRows
                        <AnalyticsTableRow key={`${key}-${i}`}>
                          <AnalyticsTableCell>{label}</AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(r.sessions)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right">
                            {numFmt.format(r.visitors)}
                          </AnalyticsTableCell>
                          <AnalyticsTableCell align="right" subtle>
                            {share}%
                          </AnalyticsTableCell>
                        </AnalyticsTableRow>
                      );
                    }
                  )}
                </AnalyticsTableBody>
              </AnalyticsTable>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {expandedTable === "locations" && data && (
        <Dialog open onOpenChange={() => setExpandedTable(null)}>
          <DialogContent showCloseButton={false} className="min-w-[700px] max-w-[900px]">
            <DialogHeader>
              <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <DialogTitle>
                  Locations ({data.locations.countries.length})
                </DialogTitle>
                <span className="text-xs text-text-muted">Country</span>
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">
              <AnalyticsTable>
                <AnalyticsTableHead>
                  <AnalyticsTableHeaderRow>
                    <AnalyticsTableHeaderCell>Country</AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Sessions
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Views
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Share
                    </AnalyticsTableHeaderCell>
                  </AnalyticsTableHeaderRow>
                </AnalyticsTableHead>
                <AnalyticsTableBody>
                  {data.locations.countries.map((r, i) => (
                    <AnalyticsTableRow
                      key={[r.countryCode, r.region, r.city, i].join("|")}
                    >
                      <AnalyticsTableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-[2px] border border-border px-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-text-muted">
                            {r.countryCode ?? "?"}
                          </span>
                          {r.countryCode ?? "Unknown"}
                        </span>
                      </AnalyticsTableCell>
                      <AnalyticsTableCell align="right">
                        {numFmt.format(r.sessions)}
                      </AnalyticsTableCell>
                      <AnalyticsTableCell align="right">
                        {numFmt.format(r.pageViews)}
                      </AnalyticsTableCell>
                      <AnalyticsTableCell align="right" subtle>
                        {r.sharePercent}%
                      </AnalyticsTableCell>
                    </AnalyticsTableRow>
                  ))}
                </AnalyticsTableBody>
              </AnalyticsTable>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {expandedTable === "technology" && data && (
        <Dialog open onOpenChange={() => setExpandedTable(null)}>
          <DialogContent showCloseButton={false} className="min-w-[700px] max-w-[900px]">
            <DialogHeader>
              <div className="flex min-h-[36px] flex-wrap items-center justify-between gap-3">
                <DialogTitle>Technology</DialogTitle>
                <Seg
                  label="Technology tab"
                  size="md"
                  value={techDim}
                  onChange={(d) => setParam({ tdim: d })}
                  options={[
                    { key: "browsers", label: "Browsers" },
                    { key: "operatingSystems", label: "OS" },
                    { key: "devices", label: "Devices" },
                  ]}
                />
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto">
              <AnalyticsTable>
                <AnalyticsTableHead>
                  <AnalyticsTableHeaderRow>
                    <AnalyticsTableHeaderCell>Name</AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Views
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Visitors
                    </AnalyticsTableHeaderCell>
                    <AnalyticsTableHeaderCell align="right">
                      Share
                    </AnalyticsTableHeaderCell>
                  </AnalyticsTableHeaderRow>
                </AnalyticsTableHead>
                <AnalyticsTableBody>
                  {(techDim === "browsers"
                    ? data.technology.browsers
                    : techDim === "operatingSystems"
                      ? data.technology.operatingSystems
                      : data.technology.devices
                  ).map((t) => (
                    <AnalyticsTableRow key={t.key}>
                      <AnalyticsTableCell>{t.label}</AnalyticsTableCell>
                      <AnalyticsTableCell align="right">
                        {numFmt.format(t.pageViews)}
                      </AnalyticsTableCell>
                      <AnalyticsTableCell align="right">
                        {numFmt.format(t.visitors)}
                      </AnalyticsTableCell>
                      <AnalyticsTableCell align="right" subtle>
                        {t.sharePercent}%
                      </AnalyticsTableCell>
                    </AnalyticsTableRow>
                  ))}
                </AnalyticsTableBody>
              </AnalyticsTable>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
