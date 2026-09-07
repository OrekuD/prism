import * as React from "react";
import type {
	WebAnalyticsBucket,
	WebAnalyticsTrendPoint,
} from "@prism-analytics/types";

type SeriesKey = "pageViews" | "visitors" | "sessions";

const SERIES_META: Record<SeriesKey, { label: string; color: string }> = {
	pageViews: { label: "Page views", color: "var(--accent)" },
	visitors: { label: "Visitors", color: "var(--info)" },
	sessions: { label: "Sessions", color: "var(--event)" },
};

const numFmt = new Intl.NumberFormat("en-US");

function kfmt(v: number): string {
	if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
	if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
	return String(v);
}

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

export function TrendChart({
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
			<div className="flex aspect-[3.2] min-h-[220px] flex-col items-center justify-center gap-2 p-6 text-center">
				<svg
					aria-hidden="true"
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
				<p className="text-[13px] text-text-muted">
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
		<div ref={wrapRef} className="relative aspect-[3.2] min-h-[220px] flex-1">
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

export { SERIES_META };
export type { SeriesKey };
