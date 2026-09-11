import { Frame } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useMobileAnalyticsQuery } from "@/network/queries/useMobileAnalyticsQuery";
import { cn } from "@/lib/utils";
import type {
	MobileAnalyticsComparisonValue,
	MobileAnalyticsResource,
} from "@prism-analytics/types";
import { useParams, useSearchParams } from "react-router-dom";

/**
 * Mobile analytics (Task 18 slice 8): every number comes from the bounded
 * server read model (GET /v1/projects/:slug/mobile-analytics) through the
 * credentialed query layer - the page never recomputes metrics. State is
 * URL-backed (range/compare/source/os/release), matching the dashboard's
 * URL-as-state convention.
 */

type RangeKey = "24h" | "7d" | "14d" | "30d" | "90d" | "12m";

const RANGE_MS: Record<RangeKey, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"14d": 14 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
	"90d": 90 * 24 * 60 * 60 * 1000,
	"12m": 366 * 24 * 60 * 60 * 1000,
};

function numFmt(v: number): string {
	return new Intl.NumberFormat("en-US").format(v);
}

function comparisonLabel(v: MobileAnalyticsComparisonValue): string {
	if (v.kind === "no-prior-data") return "no prior data";
	if (v.kind === "new") return "new";
	if (v.direction === "flat") return "0% vs previous";
	const arrow = v.direction === "up" ? "▲" : "▼";
	// Signed percentages from the shared compareValues: the arrow carries
	// direction, so render the magnitude (R10-F5) — matching the Web badge.
	return `${arrow} ${Math.abs(v.percent)}% vs previous`;
}

export { comparisonLabel };

function MetricCell({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub?: string;
}) {
	return (
		<Frame className="flex min-h-[96px] flex-col p-4">
			<span className="text-[10px] font-medium uppercase leading-[1.2] tracking-[0.04em] text-text-muted">
				{label}
			</span>
			<span className="mt-2 text-xl font-semibold leading-none tracking-[-0.05em] tabular-nums text-text">
				{value}
			</span>
			{sub !== undefined ? (
				<span className="mt-1.5 text-[10px] leading-[1.3] text-text-subtle">
					{sub}
				</span>
			) : null}
		</Frame>
	);
}

function LoadingState() {
	return (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
			{["App opens", "Visitors", "App sessions", "Screens/session", "Installations"].map(
				(label) => (
					<Frame key={label} className="min-h-[96px] p-4">
						<div className="h-3 w-20 animate-pulse rounded-md bg-surface-raised" />
						<div className="mt-3 h-5 w-16 animate-pulse rounded-md bg-surface-raised" />
					</Frame>
				),
			)}
		</div>
	);
}

const pillClass = (active: boolean) =>
	cn(
		"inline-flex h-8 items-center justify-center rounded-full border px-3 text-[13px] font-medium leading-none transition-colors duration-150",
		active
			? "border-accent bg-accent text-primary-foreground"
			: "border-border bg-canvas text-text-muted hover:bg-surface-hover hover:text-text",
	);

export default function MobileAnalyticsPage() {
	const { slug = "" } = useParams();
	const [searchParams, setSearchParams] = useSearchParams();

	const rangeKey = ((): RangeKey => {
		const raw = searchParams.get("range");
		return raw && raw in RANGE_MS ? (raw as RangeKey) : "7d";
	})();
	const compare = searchParams.get("compare") === "1";
	const osFilter = searchParams.get("os");
	const to = Date.now();
	const from = to - RANGE_MS[rangeKey];

	// Snapshot drill-down mode (R6-F1): the `ctx` token is authoritative
	// server-side for range + sources. Any filter change clears it so a
	// stale token never mixes with new filter state.
	const snapshotCtx = searchParams.get("ctx") ?? undefined;

	const query = useMobileAnalyticsQuery({
		slug,
		from,
		to,
		os: osFilter === "ios" || osFilter === "android" ? osFilter : null,
		ctx: snapshotCtx ?? null,
	});

	const data: MobileAnalyticsResource | undefined = query.data;
	const totals = data?.totals;

	function setParam(key: string, value: string | null) {
		const next = new URLSearchParams(searchParams);
		next.delete("ctx");
		if (value === null) next.delete(key);
		else next.set(key, value);
		setSearchParams(next, { replace: true });
	}

	function exitSnapshot() {
		const next = new URLSearchParams(searchParams);
		next.delete("ctx");
		setSearchParams(next, { replace: true });
	}

	return (
		<div className="flex w-full flex-col">
			<PageHeader />

			<div className="mb-6 mt-6 flex flex-wrap items-center gap-2">
				{(Object.keys(RANGE_MS) as RangeKey[]).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setParam("range", key)}
						className={pillClass(key === rangeKey)}
					>
						{key}
					</button>
				))}
				<button
					type="button"
					aria-pressed={compare}
					onClick={() => setParam("compare", compare ? null : "1")}
					className={pillClass(compare)}
				>
					Compare
				</button>
				{(["ios", "android"] as const).map((os) => (
					<button
						key={os}
						type="button"
						aria-pressed={osFilter === os}
						onClick={() => setParam("os", osFilter === os ? null : os)}
						className={cn(pillClass(osFilter === os), "capitalize")}
					>
						{os}
					</button>
				))}
			</div>

			{snapshotCtx ? (
				<div
					aria-live="polite"
					className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border bg-canvas px-3 py-2"
				>
					<span className="text-[13px] text-text-muted">
						Viewing a shared snapshot — range and sources are fixed by the
						link.
					</span>
					<button
						type="button"
						onClick={exitSnapshot}
						className="inline-flex h-8 items-center rounded-full border border-border bg-canvas px-3 text-[13px] font-medium hover:bg-surface-hover"
					>
						Exit snapshot
					</button>
				</div>
			) : null}

			{query.isPending ? <LoadingState /> : null}

			{query.isError ? (
				<ErrorState
					title="Failed to load mobile analytics."
					description="The report is temporarily unavailable. Retry or check your connection."
					onRetry={() => query.refetch()}
				/>
			) : null}

			{data && totals ? (
				totals.appOpens === 0 && totals.visitors === 0 ? (
					<EmptyState
						title="No mobile data yet"
						description="Install @prism-analytics/react-native, grant consent in the app, and navigate a screen. New screen views appear here within a minute."
					/>
				) : (
					<>
						<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
							<MetricCell label="App opens" value={numFmt(totals.appOpens)} sub={compare ? comparisonLabel(data.comparison.appOpens) : undefined} />
							<MetricCell label="Visitors" value={numFmt(totals.visitors)} sub={compare ? comparisonLabel(data.comparison.visitors) : undefined} />
							<MetricCell label="App sessions" value={numFmt(totals.appSessions)} sub={compare ? comparisonLabel(data.comparison.appSessions) : undefined} />
							<MetricCell
								label="Avg screens / session"
								value={totals.avgScreensPerSession.toFixed(2)}
							/>
							<MetricCell
								label="Observed installations"
								value={numFmt(totals.observedInstallations)}
								sub={
									totals.avgSessionDurationMs === null
										? undefined
										: `${Math.round(totals.avgSessionDurationMs / 1000)}s avg session`
								}
							/>
						</div>

						<h2 className="mb-3 mt-8 text-[13px] font-medium tracking-normal text-text-subtle">
							Top screens
						</h2>
						{data.screens.length === 0 ? (
							<p className="text-[13px] text-text-muted">
								No screen views in this period.
							</p>
						) : (
							<Frame className="overflow-hidden">
								<ul className="divide-y divide-border">
									{data.screens.map((screen) => (
										<li
											key={`${screen.name}:${screen.routePattern ?? ""}`}
											className="flex items-center justify-between gap-3 px-4 py-[11px] text-[13px]"
										>
											<span className="truncate font-medium">
												{screen.name}
											</span>
											<span className="whitespace-nowrap text-text-muted tabular-nums">
												{numFmt(screen.screenViews)} views ·{" "}
												{numFmt(screen.visitors)} visitors ·{" "}
												{screen.sharePercent}%
											</span>
										</li>
									))}
								</ul>
							</Frame>
						)}

						<h2 className="mb-3 mt-8 text-[13px] font-medium tracking-normal text-text-subtle">
							Releases
						</h2>
						{data.releases.length === 0 ? (
							<p className="text-[13px] text-text-muted">
								No release metadata reported yet.
							</p>
						) : (
							<Frame className="overflow-hidden">
								<ul className="divide-y divide-border">
									{data.releases.map((release) => (
										<li
											key={release.version}
											className="flex items-center justify-between gap-3 px-4 py-[11px] text-[13px]"
										>
											<span className="truncate font-medium">
												{release.version}
												{release.build ? ` (${release.build})` : ""}
											</span>
											<span className="whitespace-nowrap text-text-muted tabular-nums">
												{numFmt(release.screenViews)} views ·{" "}
												{release.sharePercent}%
											</span>
										</li>
									))}
								</ul>
							</Frame>
						)}
					</>
				)
			) : null}
		</div>
	);
}

export function ProjectMobileAnalytics() {
	return <MobileAnalyticsPage />;
}
