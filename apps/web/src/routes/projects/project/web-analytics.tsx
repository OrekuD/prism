import { Frame } from "@/components/public/frame";
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
	WebAnalyticsBucket,
	WebAnalyticsComparisonValue,
	WebAnalyticsResource,
	WebAnalyticsTrendPoint,
} from "@prism-analytics/types";
import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";

/**
 * Web analytics (Task 17 slice 6) — one-to-one port of the v2
 * web-analytics design. Every number comes from the bounded server read
 * model (GET /projects/:slug/web-analytics); the page never recomputes
 * metrics. Compare overlays the previous equal-length period fetched
 * through the same endpoint. State lives in the URL (search params),
 * matching the dashboard's URL-as-state convention.
 */

const numFmt = new Intl.NumberFormat("en-US");

function kfmt(v: number): string {
	if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
	if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
	if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
	return String(v);
}

/* ---------------- URL-backed state ---------------- */

type WaRangeKey = "24h" | "7d" | "14d" | "30d" | "90d" | "12m" | "custom";
const WA_RANGES: Array<{ key: WaRangeKey; label: string; ms: number }> = [
	{ key: "24h", label: "24h", ms: 24 * 3600_000 },
	{ key: "7d", label: "7d", ms: 7 * 86_400_000 },
	{ key: "14d", label: "14d", ms: 14 * 86_400_000 },
	{ key: "30d", label: "30d", ms: 30 * 86_400_000 },
	{ key: "90d", label: "90d", ms: 90 * 86_400_000 },
	{ key: "12m", label: "12m", ms: 365 * 86_400_000 },
];
const MAX_RANGE_MS = 366 * 86_400_000; // frozen ceiling (PAGE_VIEW_LIMITS)

type SeriesKey = "pageViews" | "visitors" | "sessions";
const SERIES_META: Record<SeriesKey, { label: string; color: string }> = {
	pageViews: { label: "Page views", color: "var(--accent)" },
	visitors: { label: "Visitors", color: "var(--info)" },
	sessions: { label: "Sessions", color: "var(--event)" },
};

/** Resolve the selected range to a concrete [from,to] UTC window. */
function rangeWindow(
	range: WaRangeKey,
	fromStr: string,
	toStr: string,
): { from: number; to: number } {
	const to = Date.now();
	if (range === "custom" && fromStr && toStr) {
		const from = Date.parse(`${fromStr}T00:00:00Z`);
		const until = Date.parse(`${toStr}T23:59:59Z`);
		if (!Number.isNaN(from) && !Number.isNaN(until) && until > from) {
			return {
				from,
				to: Math.min(until, from + MAX_RANGE_MS),
			};
		}
	}
	const def = WA_RANGES.find((r) => r.key === range) ?? WA_RANGES[3];
	return { from: to - def.ms, to };
}

/* ---------------- presentation atoms ---------------- */

function Seg<T extends string>({
	value,
	onChange,
	options,
	label,
	size = "sm",
}: {
	value: T;
	onChange: (next: T) => void;
	options: Array<{ key: T; label: string }>;
	label: string;
	size?: "sm" | "md";
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className="inline-flex overflow-hidden rounded-[2px] border border-border"
		>
			{options.map((o, i) => (
				<button
					key={o.key}
					type="button"
					aria-pressed={value === o.key}
					onClick={() => onChange(o.key)}
					className={cn(
						"transition-colors",
						size === "sm"
							? "h-[30px] px-3 font-mono text-xs font-medium"
							: "h-8 px-3.5 text-[13px] font-medium",
						i > 0 && "border-l border-border",
						value === o.key
							? size === "sm"
								? "bg-accent-soft text-text"
								: "bg-accent-soft text-text"
							: "text-text-muted hover:bg-surface-hover hover:text-text",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

function ArrowUp() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-[11px]"
		>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}

function ArrowDown() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-[11px]"
		>
			<path d="m7 7 10 10" />
			<path d="M17 7v10H7" />
		</svg>
	);
}

/**
 * Prior-period change badge. Honors the frozen comparison kinds:
 * percent (direction-colored), new (no prior baseline), no-prior-data.
 * `invert` flips good/bad coloring for metrics where down is good
 * (bounce rate).
 */
function DeltaBadge({
	value,
	compareOn,
	invert = false,
}: {
	value: WebAnalyticsComparisonValue | null;
	compareOn: boolean;
	invert?: boolean;
}) {
	if (!compareOn || !value) {
		return (
			<span className="font-mono text-[11px] text-text-subtle">&mdash;</span>
		);
	}
	if (value.kind === "no-prior-data") {
		return (
			<span className="font-mono text-[11px] text-text-subtle">
				no prior data
			</span>
		);
	}
	if (value.kind === "new") {
		return (
			<span className="font-mono text-[11px] font-medium text-success">
				New
			</span>
		);
	}
	const up = value.direction === "up";
	const flat = value.direction === "flat";
	const good = flat || (invert ? !up : up);
	if (flat) {
		return (
			<span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted">
				0.0%
			</span>
		);
	}
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-mono text-[11px]",
				good ? "text-success" : "text-danger",
			)}
		>
			{up ? <ArrowUp /> : <ArrowDown />}
			{Math.abs(value.percent).toFixed(1)}%
		</span>
	);
}

function SecLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-10 mb-3.5 font-mono text-[11px] font-medium uppercase leading-[1.3] tracking-[0.09em] text-text-muted">
			{children}
		</div>
	);
}

function PanelHead({
	title,
	children,
}: {
	title: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="mb-3.5 flex items-center justify-between gap-3">
			<span className="text-[15px] font-medium tracking-[-0.01em]">
				{title}
			</span>
			{children}
		</div>
	);
}

/** Ranked-row header (Referrers/Campaigns/Locations panels). */
function RankHead({
	name,
	cols,
}: {
	name: string;
	cols: [string, string, string];
}) {
	return (
		<div className="flex items-center gap-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-subtle">
			<span className="min-w-0 flex-1">{name}</span>
			<span className="w-[74px] text-right">{cols[0]}</span>
			<span className="w-[74px] text-right">{cols[1]}</span>
			<span className="w-[110px]">{cols[2]}</span>
		</div>
	);
}

function RankRow({
	name,
	chip,
	cols,
	max,
}: {
	name: React.ReactNode;
	chip?: string | null;
	cols: [number, number];
	max: number;
}) {
	return (
		<div className="flex items-center gap-3 border-t border-border py-[9px] first:border-t-0">
			<span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
				{chip ? (
					<span className="inline-flex h-[18px] min-w-[26px] flex-none items-center justify-center rounded-[2px] border border-border px-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-text-muted">
						{chip}
					</span>
				) : null}
				<span className="truncate text-[13px]">{name}</span>
			</span>
			<span className="w-[74px] text-right font-mono text-xs font-medium text-text-muted tabular-nums">
				{numFmt.format(cols[0])}
			</span>
			<span className="w-[74px] text-right font-mono text-xs font-medium text-text-muted tabular-nums">
				{numFmt.format(cols[1])}
			</span>
			<span className="w-[110px]">
				<span className="block h-1 overflow-hidden rounded-[2px] bg-surface-raised">
					<i
						className="block h-full bg-accent"
						style={{
							width: `${Math.max(3, Math.round((cols[0] / Math.max(1, max)) * 100))}%`,
						}}
					/>
				</span>
			</span>
		</div>
	);
}

/* ---------------- trend chart ---------------- */

const CHART_W = 800;
const CHART_H = 250;
const PAD = { l: 44, r: 12, t: 14, b: 26 };

function tickLabel(t: number, bucket: WebAnalyticsBucket): string {
	const d = new Date(t);
	if (bucket === "hourly")
		return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

function fullLabel(t: number, bucket: WebAnalyticsBucket): string {
	const d = new Date(t);
	const day = d.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
	if (bucket === "hourly")
		return `${day} · ${String(d.getUTCHours()).padStart(2, "0")}:00`;
	return day;
}

function TrendChart({
	points,
	prevPoints,
	compare,
	series,
	bucket,
}: {
	points: WebAnalyticsTrendPoint[];
	prevPoints: WebAnalyticsTrendPoint[] | undefined;
	compare: boolean;
	series: SeriesKey;
	bucket: WebAnalyticsBucket;
}) {
	const [hover, setHover] = React.useState<number | null>(null);
	const wrapRef = React.useRef<HTMLDivElement>(null);

	const meta = SERIES_META[series];
	const values = points.map((p) => p[series]);
	const total = values.reduce((a, b) => a + b, 0);
	const prevValues =
		compare && prevPoints ? prevPoints.map((p) => p[series]) : null;

	const n = points.length;
	const iw = CHART_W - PAD.l - PAD.r;
	const ih = CHART_H - PAD.t - PAD.b;

	let max = 1;
	for (const v of values) max = Math.max(max, v);
	if (prevValues) for (const v of prevValues) max = Math.max(max, v);
	max = Math.ceil((max * 1.15) / 10) * 10;

	const X = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
	const Y = (v: number) => PAD.t + ih - (v / max) * ih;

	/** Previous period sampled at the current period's x positions. */
	const prevAt = (i: number) => {
		if (!prevValues || prevValues.length === 0) return 0;
		const m = prevValues.length;
		return prevValues[
			Math.min(m - 1, Math.round((i * (m - 1)) / Math.max(1, n - 1)))
		];
	};

	const lineOf = (vals: number[]) =>
		vals
			.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)
			.join(" ");

	if (total === 0) {
		return (
			<div className="flex min-h-[220px] flex-col items-center justify-center gap-2.5 p-6 text-center">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="size-[22px] text-text-subtle"
				>
					<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
				</svg>
				<p className="font-mono text-[13px] text-text-muted">
					No page views in this range.
				</p>
				<span className="text-xs text-text-subtle">
					Widen the range or include bot traffic.
				</span>
			</div>
		);
	}

	const gridLines = [0, 1, 2, 3].map((g) => {
		const gy = PAD.t + (ih * g) / 3;
		return (
			<g key={g}>
				<line
					x1={PAD.l}
					y1={gy}
					x2={CHART_W - PAD.r}
					y2={gy}
					stroke="var(--border)"
					strokeOpacity="0.55"
				/>
				<text
					x={PAD.l - 8}
					y={gy + 3.5}
					textAnchor="end"
					fontFamily="var(--font-mono)"
					fontSize="11"
					fill="var(--text-subtle)"
				>
					{kfmt(Math.round(max * (1 - g / 3)))}
				</text>
			</g>
		);
	});

	const step = Math.ceil(n / 6);
	const ticks: number[] = [];
	for (let i = 0; i < n; i += step) ticks.push(i);
	if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);

	const areaPath = `${lineOf(values)} L${X(n - 1).toFixed(1)} ${PAD.t + ih} L${X(0).toFixed(1)} ${PAD.t + ih} Z`;

	const onMove = (clientX: number) => {
		const el = wrapRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const nx = ((clientX - r.left) / r.width) * CHART_W;
		const i = Math.max(
			0,
			Math.min(n - 1, Math.round(((nx - PAD.l) / iw) * (n - 1))),
		);
		setHover(i);
	};

	const hv = hover != null ? points[hover] : null;
	const tipLeft = hover != null ? (X(hover) / CHART_W) * 100 : 0;
	const tipTop = hv != null ? (Y(hv[series]) / CHART_H) * 100 : 0;

	return (
		<div ref={wrapRef} className="relative min-h-[220px] flex-1">
			<svg
				viewBox={`0 0 ${CHART_W} ${CHART_H}`}
				className="block h-full w-full"
				role="img"
				aria-label={`${meta.label} over the selected range`}
				onMouseMove={(e) => onMove(e.clientX)}
				onMouseLeave={() => setHover(null)}
				onTouchStart={(e) => onMove(e.touches[0].clientX)}
				onTouchEnd={() => setHover(null)}
			>
				<title>{meta.label} per bucket</title>
				{gridLines}
				<path d={areaPath} fill={meta.color} fillOpacity="0.12" stroke="none" />
				{prevValues ? (
					<path
						d={lineOf(prevValues.map((_, i) => prevAt(i)))}
						fill="none"
						stroke="var(--text-muted)"
						strokeWidth="1.25"
						strokeDasharray="4 4"
						vectorEffect="non-scaling-stroke"
					/>
				) : null}
				<path
					d={lineOf(values)}
					fill="none"
					stroke={meta.color}
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
				/>
				{ticks.map((i) => (
					<text
						key={i}
						x={X(i)}
						y={CHART_H - 8}
						textAnchor="middle"
						fontFamily="var(--font-mono)"
						fontSize="11"
						fill="var(--text-subtle)"
					>
						{tickLabel(points[i].bucketStartUtc, bucket)}
					</text>
				))}
				{hv ? (
					<g>
						<line
							x1={X(hover ?? 0)}
							y1={PAD.t}
							x2={X(hover ?? 0)}
							y2={PAD.t + ih}
							stroke="var(--text-muted)"
							strokeDasharray="3 3"
						/>
						<circle
							cx={X(hover ?? 0)}
							cy={Y(hv[series])}
							r="3.5"
							fill="var(--surface)"
							stroke={meta.color}
							strokeWidth="1.5"
						/>
					</g>
				) : null}
			</svg>
			{hv ? (
				<div
					className="pointer-events-none absolute z-[5] whitespace-nowrap rounded-[2px] border border-border bg-surface-raised px-2.5 py-2 font-mono text-[11px] leading-[1.5] shadow-[0_8px_24px_rgb(0_0_0/0.3)]"
					style={{
						left: `calc(${Math.min(92, Math.max(2, tipLeft))}% + 10px)`,
						top: `calc(${tipTop}% - 52px)`,
					}}
				>
					<b className="block tracking-[0.04em] text-text-subtle">
						{fullLabel(hv.bucketStartUtc, bucket)}
					</b>
					<span className="flex items-center gap-1.5">
						<i
							className="inline-block size-[7px] rounded-[1px]"
							style={{ background: meta.color }}
						/>
						{numFmt.format(hv[series])} {meta.label.toLowerCase()}
					</span>
					{prevValues && hover != null ? (
						<span className="flex items-center gap-1.5">
							<i className="inline-block size-[7px] rounded-[1px] bg-text-muted" />
							{numFmt.format(prevAt(hover))} previous
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/* ---------------- page ---------------- */

export function ProjectWebAnalytics() {
	const { slug } = useParams<{ slug: string }>();
	const [params, setParams] = useSearchParams();

	const sourcesQuery = useSourcesQuery(slug);
	const webSources = React.useMemo(
		() => (sourcesQuery.data ?? []).filter((s) => s.platform === "web"),
		[sourcesQuery.data],
	);

	// URL-backed state (defaults mirror the design's saved-state defaults).
	const range = (params.get("range") ?? "30d") as WaRangeKey;
	const compare = params.get("cmp") !== "off";
	const sourceId = params.get("src") ?? "all";
	const host = params.get("host") ?? "all";
	const traffic = params.get("traffic") === "all" ? "all" : "human";
	const path = params.get("path") ?? "";
	const series = (params.get("series") ?? "pageViews") as SeriesKey;
	const pagesTab = params.get("ptab") === "entry" ? "entry" : "all";
	const campDim = (["source", "medium", "campaign"] as const).includes(
		params.get("cdim") as never,
	)
		? (params.get("cdim") as "source" | "medium" | "campaign")
		: "source";
	const locDim = (["country", "region", "city"] as const).includes(
		params.get("ldim") as never,
	)
		? (params.get("ldim") as "country" | "region" | "city")
		: "country";
	const techDim = (
		[
			"browsers",
			"operatingSystems",
			"devices",
			"viewports",
			"languages",
		] as const
	).includes(params.get("tdim") as never)
		? (params.get("tdim") as
				| "browsers"
				| "operatingSystems"
				| "devices"
				| "viewports"
				| "languages")
		: "browsers";
	const fromStr = params.get("from") ?? "";
	const toStr = params.get("to") ?? "";

	const setParam = (patch: Record<string, string | null>) => {
		const next = new URLSearchParams(params);
		for (const [k, v] of Object.entries(patch)) {
			if (v == null || v === "") next.delete(k);
			else next.set(k, v);
		}
		setParams(next, { replace: true });
	};

	// Heal stale scope: a non-web source or unknown host falls back to all.
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

	const { from, to } = rangeWindow(range, fromStr, toStr);
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
	});

	const data = query.data;
	const loading = query.isLoading || sourcesQuery.isLoading;

	const filtersOn =
		effSourceId !== "all" ||
		effHost !== "all" ||
		traffic !== "human" ||
		Boolean(path) ||
		range === "custom";

	const resetFilters = () => {
		setParams(
			new URLSearchParams(range === "custom" ? { range: "30d" } : { range }),
			{ replace: true },
		);
	};

	/* ---- derived panel data (presentation-only regrouping) ---- */

	const campaignRows = React.useMemo(() => {
		if (!data) return [];
		const groups = new Map<string, { sessions: number; visitors: number }>();
		for (const r of data.campaigns) {
			const raw =
				campDim === "source"
					? r.source
					: campDim === "medium"
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
			.slice(0, 50);
	}, [data, campDim]);

	if (!loading && webSources.length === 0) {
		return (
			<EmptyState
				title="No Web sources in this project."
				description="Web analytics aggregates page-view telemetry from sources with the Web platform."
				className="border border-border"
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-[1240px]">
			{/* ---------- head ---------- */}
			<div className="mb-5 flex flex-wrap items-end justify-between gap-5">
				<div>
					<h1 className="font-mono text-[26px] font-semibold leading-[1.18] tracking-[-0.025em]">
						Web analytics
					</h1>
					<p className="mt-2 text-sm text-text-muted">
						Pages, acquisition, audience, and technology across your Web
						sources.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						aria-pressed={compare}
						onClick={() => setParam({ cmp: compare ? "off" : null })}
						className={cn(
							"inline-flex h-[30px] items-center rounded-[2px] border px-3 text-[13px] font-medium transition-colors",
							compare
								? "border-accent/45 bg-accent-soft text-text"
								: "border-border-strong text-text hover:bg-surface-hover",
						)}
					>
						Compare
					</button>
					<Seg
						label="Date range"
						value={range}
						onChange={(r) =>
							setParam({
								range: r,
								...(r === "custom"
									? { from: fromStr || "", to: toStr || "" }
									: { from: null, to: null }),
							})
						}
						options={[
							...WA_RANGES.map((r) => ({ key: r.key, label: r.label })),
							{ key: "custom" as const, label: "Custom" },
						]}
					/>
					<span
						title="Reporting timestamps are UTC"
						className="inline-flex h-6 items-center rounded-[2px] border border-border px-2 font-mono text-[10px] font-medium tracking-[0.08em] text-text-subtle"
					>
						UTC
					</span>
				</div>
			</div>

			{/* ---------- filter row ---------- */}
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<Select
					value={effSourceId}
					onValueChange={(v) =>
						setParam({ src: v === "all" ? null : v, host: null })
					}
				>
					<SelectTrigger className="h-9 w-[190px] rounded-[2px] border-border-strong bg-surface text-[13px] font-normal">
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
						<SelectTrigger className="h-9 w-[170px] rounded-[2px] border-border-strong bg-surface text-[13px] font-normal">
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
					<SelectTrigger className="h-9 w-[150px] rounded-[2px] border-border-strong bg-surface text-[13px] font-normal">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="human">Human traffic</SelectItem>
						<SelectItem value="all">Include bots</SelectItem>
					</SelectContent>
				</Select>
				{path ? (
					<span className="inline-flex h-6 items-center gap-1.5 rounded-[2px] border border-border-strong px-2 font-mono text-[11px] font-medium text-accent">
						<span className="max-w-[260px] truncate">{path}</span>
						<button
							type="button"
							aria-label="Remove page filter"
							onClick={() => setParam({ path: null })}
							className="ml-0.5 mr-[-4px] flex h-4 w-4 items-center justify-center rounded-[2px] text-inherit hover:bg-accent/25"
						>
							&times;
						</button>
					</span>
				) : null}
				{range === "custom" ? (
					<span className="flex items-center gap-2">
						<input
							type="date"
							aria-label="From date"
							value={fromStr}
							onChange={(e) => setParam({ from: e.target.value })}
							className="h-8 w-[148px] rounded-[2px] border border-border-strong bg-surface px-2 font-mono text-xs text-text"
						/>
						<span className="text-text-subtle">&rarr;</span>
						<input
							type="date"
							aria-label="To date"
							value={toStr}
							onChange={(e) => setParam({ to: e.target.value })}
							className="h-8 w-[148px] rounded-[2px] border border-border-strong bg-surface px-2 font-mono text-xs text-text"
						/>
					</span>
				) : null}
				<span className="flex-1" />
				{filtersOn ? (
					<button
						type="button"
						onClick={resetFilters}
						className="inline-flex h-[30px] items-center rounded-[2px] border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
					>
						Reset filters
					</button>
				) : null}
			</div>

			{/* ---------- metric strip ---------- */}
			<Frame className="mb-[13px]">
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
					).map(([k, v, cmp, invert]) => (
						<div
							key={k}
							className="flex min-w-0 flex-col gap-[7px] bg-canvas p-[18px]"
						>
							<span className="font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
								{k}
							</span>
							<div className="flex items-center justify-between gap-2">
								{loading || v === undefined ? (
									<Skeleton className="h-6 w-20" />
								) : (
									<span className="whitespace-nowrap font-mono text-[22px] leading-none tracking-[-0.06em] tabular-nums">
										{v === null
											? "\u2014"
											: typeof v === "number"
												? numFmt.format(v)
												: v}
									</span>
								)}
								{!loading && v !== undefined ? (
									<DeltaBadge
										value={(cmp ?? null) as WebAnalyticsComparisonValue | null}
										compareOn={compare}
										invert={invert}
									/>
								) : null}
							</div>
						</div>
					))}
				</div>
			</Frame>

			{/* ---------- trend ---------- */}
			<Frame className="mb-[13px] p-5 pb-4">
				<div className="mb-3.5 flex items-baseline justify-between gap-3">
					<span className="text-[15px] font-medium tracking-[-0.01em]">
						Page-view trend
					</span>
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
				<div className="mb-3 flex gap-4">
					<span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.04em] text-text-muted">
						<i
							className="inline-block size-2 rounded-[1px]"
							style={{ background: SERIES_META[series].color }}
						/>
						Current period
					</span>
					{compare ? (
						<span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.04em] text-text-muted">
							<i className="inline-block h-0.5 w-3.5 bg-[repeating-linear-gradient(90deg,var(--text-subtle)_0_4px,transparent_4px_7px)]" />
							Previous period
						</span>
					) : null}
				</div>
				{loading || !data ? (
					<Skeleton className="h-[220px] w-full" />
				) : (
					<TrendChart
						points={data.trend.points}
						prevPoints={prevQuery.data?.trend.points}
						compare={compare}
						series={series}
						bucket={data.trend.bucket}
					/>
				)}
			</Frame>

			{/* ---------- pages + referrers ---------- */}
			<div className="mb-[13px] grid grid-cols-1 gap-[13px] lg:grid-cols-3">
				<Frame className="p-5 lg:col-span-2">
					<PanelHead title="Top pages">
						<Seg
							label="Pages tab"
							size="md"
							value={pagesTab}
							onChange={(t) => setParam({ ptab: t })}
							options={[
								{ key: "all", label: "All pages" },
								{ key: "entry", label: "Entry pages" },
							]}
						/>
					</PanelHead>
					{loading || !data ? (
						<Skeleton className="h-[240px] w-full" />
					) : (
						<>
							<div className="overflow-auto rounded-[2px] border border-border">
								<table className="w-full border-collapse text-[13px]">
									<thead>
										{pagesTab === "all" ? (
											<tr>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Path
												</th>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Views
												</th>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Visitors
												</th>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Bounce
												</th>
											</tr>
										) : (
											<tr>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Entry page
												</th>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Entrances
												</th>
												<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
													Share
												</th>
											</tr>
										)}
									</thead>
									<tbody>
										{pagesTab === "all"
											? data.pages.slice(0, 12).map((p) => (
													<tr
														key={`${p.host ?? ""}${p.path}`}
														tabIndex={0}
														role="button"
														aria-label={`Filter report by ${p.path}`}
														onClick={() =>
															setParam({
																path: path === p.path ? null : p.path,
															})
														}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === " ") {
																e.preventDefault();
																setParam({
																	path: path === p.path ? null : p.path,
																});
															}
														}}
														className={cn(
															"cursor-pointer transition-colors hover:bg-surface-hover",
															path === p.path && "bg-accent-soft",
														)}
													>
														<td className="max-w-[340px] px-3.5 py-2.5 align-middle">
															<b className="block truncate font-mono text-[12.5px] font-medium leading-[1.35]">
																{p.path}
															</b>
															<span className="block truncate text-[11px] text-text-muted">
																{p.title ?? ""}
																{p.host ? ` · ${p.host}` : ""}
															</span>
														</td>
														<td className="px-3.5 py-2.5 text-right align-middle tabular-nums">
															{numFmt.format(p.pageViews)}
														</td>
														<td className="px-3.5 py-2.5 text-right align-middle tabular-nums">
															{numFmt.format(p.visitors)}
														</td>
														<td className="px-3.5 py-2.5 text-right align-middle font-normal text-text-subtle tabular-nums">
															{p.bounceRate == null
																? "\u2014"
																: `${p.bounceRate}%`}
														</td>
													</tr>
												))
											: [...data.pages]
													.sort((a, b) => b.entrances - a.entrances)
													.slice(0, 12)
													.map((p) => (
														<tr
															key={`entry-${p.host ?? ""}${p.path}`}
															tabIndex={0}
															role="button"
															aria-label={`Filter report by ${p.path}`}
															onClick={() =>
																setParam({
																	path: path === p.path ? null : p.path,
																})
															}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	setParam({
																		path: path === p.path ? null : p.path,
																	});
																}
															}}
															className={cn(
																"cursor-pointer transition-colors hover:bg-surface-hover",
																path === p.path && "bg-accent-soft",
															)}
														>
															<td className="max-w-[340px] px-3.5 py-2.5 align-middle">
																<b className="block truncate font-mono text-[12.5px] font-medium leading-[1.35]">
																	{p.path}
																</b>
																<span className="block truncate text-[11px] text-text-muted">
																	{p.title ?? ""}
																</span>
															</td>
															<td className="px-3.5 py-2.5 text-right align-middle tabular-nums">
																{numFmt.format(p.entrances)}
															</td>
															<td className="px-3.5 py-2.5 text-right align-middle text-text-subtle tabular-nums">
																{p.sharePercent}%
															</td>
														</tr>
													))}
									</tbody>
								</table>
							</div>
							<p className="mt-3 text-[11px] leading-[1.5] text-text-subtle">
								{pagesTab === "entry" ? (
									"Entry page is the first page viewed in a session."
								) : path ? (
									<>
										Filtered to{" "}
										<b className="font-mono font-medium text-text-muted">
											{path}
										</b>{" "}
										· click another page to switch.
									</>
								) : (
									"Click a page to filter every panel to that path."
								)}
							</p>
						</>
					)}
				</Frame>

				<Frame className="p-5">
					<PanelHead title="Referrers" />
					{loading || !data ? (
						<Skeleton className="h-[240px] w-full" />
					) : (
						<>
							<RankHead
								name="Referrer"
								cols={["Sessions", "Visitors", "Share"]}
							/>
							{data.referrers.slice(0, 12).map((r) => (
								<RankRow
									key={r.referrerHost ?? "__direct__"}
									name={r.referrerHost ?? "Direct / none"}
									cols={[r.sessions, r.visitors]}
									max={data.referrers[0]?.sessions ?? 1}
								/>
							))}
							<p className="mt-3 text-[11px] leading-[1.5] text-text-subtle">
								Internal same-host referrers are excluded from the ranking.
							</p>
						</>
					)}
				</Frame>
			</div>

			{/* ---------- campaigns + locations ---------- */}
			<div className="mb-[13px] grid grid-cols-1 gap-[13px] lg:grid-cols-2">
				<Frame className="p-5">
					<PanelHead title="Campaigns">
						<Seg
							label="Campaign dimension"
							size="md"
							value={campDim}
							onChange={(d) => setParam({ cdim: d })}
							options={[
								{ key: "source", label: "Source" },
								{ key: "medium", label: "Medium" },
								{ key: "campaign", label: "Campaign" },
							]}
						/>
					</PanelHead>
					{loading || !data ? (
						<Skeleton className="h-[200px] w-full" />
					) : (
						<>
							<RankHead
								name={campDim === "campaign" ? "Campaign" : campDim}
								cols={["Sessions", "Visitors", "Share"]}
							/>
							{campaignRows.map((r) => (
								<RankRow
									key={r.name}
									name={r.name}
									cols={[r.sessions, r.visitors]}
									max={campaignRows[0]?.sessions ?? 1}
								/>
							))}
							<p className="mt-3 text-[11px] leading-[1.5] text-text-subtle">
								Attributed from utm_source / utm_medium / utm_campaign on
								inbound links. {data.coverage.campaignPercent}% of sessions
								carry campaign context.
							</p>
						</>
					)}
				</Frame>

				<Frame className="p-5">
					<PanelHead title="Locations">
						<Seg
							label="Location dimension"
							size="md"
							value={locDim}
							onChange={(d) => setParam({ ldim: d })}
							options={[
								{ key: "country", label: "Country" },
								{ key: "region", label: "Region" },
								{ key: "city", label: "City" },
							]}
						/>
					</PanelHead>
					{loading || !data ? (
						<Skeleton className="h-[200px] w-full" />
					) : (
						<>
							<RankHead
								name={
									locDim === "city"
										? "City"
										: locDim === "region"
											? "Region"
											: "Country"
								}
								cols={["Sessions", "Views", "Share"]}
							/>
							{(locDim === "country"
								? data.locations.countries
								: locDim === "region"
									? data.locations.regions
									: data.locations.cities
							)
								.slice(0, 12)
								.map((r, i) => (
									<RankRow
										key={[r.countryCode, r.region, r.city, i].join("|")}
										chip={
											locDim === "country"
												? (r.countryCode ?? "?")
												: r.countryCode
										}
										name={
											locDim === "country"
												? (r.countryCode ?? "Unknown")
												: locDim === "region"
													? (r.region ?? "Unknown")
													: (r.city ?? "Unknown")
										}
										cols={[r.sessions, r.pageViews]}
										max={
											(locDim === "country"
												? data.locations.countries[0]?.sessions
												: locDim === "region"
													? data.locations.regions[0]?.sessions
													: data.locations.cities[0]?.sessions) ?? 1
										}
									/>
								))}
							<p className="mt-3 text-[11px] leading-[1.5] text-text-subtle">
								Country-level precision available for{" "}
								{data.locations.coveragePercent}% of sessions.
							</p>
						</>
					)}
				</Frame>
			</div>

			{/* ---------- technology ---------- */}
			<SecLabel>Technology</SecLabel>
			<Frame className="p-5">
				<div className="mb-3.5 flex items-center justify-between gap-3">
					<Seg
						label="Technology tab"
						size="md"
						value={techDim}
						onChange={(d) => setParam({ tdim: d })}
						options={[
							{ key: "browsers", label: "Browsers" },
							{ key: "operatingSystems", label: "Operating systems" },
							{ key: "devices", label: "Devices" },
							{ key: "viewports", label: "Viewports" },
							{ key: "languages", label: "Languages" },
						]}
					/>
					{data ? (
						<span className="font-mono text-[11px] font-medium tabular-nums text-text-subtle">
							{data.technology.coveragePercent}% of pageviews attributed
						</span>
					) : null}
				</div>
				{loading || !data ? (
					<Skeleton className="h-[180px] w-full" />
				) : (
					<div className="overflow-auto rounded-[2px] border border-border">
						<table className="w-full border-collapse text-[13px]">
							<thead>
								<tr>
									<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
										Name
									</th>
									<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
										Page views
									</th>
									<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
										Visitors
									</th>
									<th className="border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
										Share
									</th>
								</tr>
							</thead>
							<tbody>
								{(techDim === "browsers"
									? data.technology.browsers
									: techDim === "operatingSystems"
										? data.technology.operatingSystems
										: techDim === "devices"
											? data.technology.devices
											: techDim === "viewports"
												? data.technology.viewports
												: data.technology.languages
								).map((t) => (
									<tr
										key={t.key}
										className="transition-colors hover:bg-surface-hover"
									>
										<td className="px-3.5 py-2.5 align-middle">
											{techDim === "viewports" ? (
												<span className="inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-[2px] border border-border px-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-text-muted">
													{t.label}
												</span>
											) : (
												t.label
											)}
										</td>
										<td className="px-3.5 py-2.5 text-right align-middle tabular-nums">
											{numFmt.format(t.pageViews)}
										</td>
										<td className="px-3.5 py-2.5 text-right align-middle tabular-nums">
											{numFmt.format(t.visitors)}
										</td>
										<td className="px-3.5 py-2.5 text-right align-middle text-text-subtle tabular-nums">
											{t.sharePercent}%
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Frame>
		</div>
	);
}
