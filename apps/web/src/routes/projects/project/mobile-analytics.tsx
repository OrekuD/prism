import { Frame } from "@/components/public/frame";
import { useMobileAnalyticsQuery } from "@/network/queries/useMobileAnalyticsQuery";
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
		<div className="border-fd-border rounded-[2px] border p-4">
			<div className="text-fd-muted-foreground text-xs">{label}</div>
			<div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
			{sub !== undefined ? (
				<div className="text-fd-muted-foreground mt-1 text-xs">{sub}</div>
			) : null}
		</div>
	);
}

function LoadingState() {
	return (
		<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
			{["App opens", "Visitors", "App sessions", "Screens/session", "Installations"].map(
				(label) => (
					<div key={label} className="border-fd-border animate-pulse rounded-[2px] border p-4">
						<div className="bg-fd-muted h-3 w-20 rounded" />
						<div className="bg-fd-muted mt-2 h-6 w-16 rounded" />
					</div>
				),
			)}
		</div>
	);
}

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
		<Frame>
			<div className="p-6">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-lg font-semibold">Mobile analytics</h1>
					<div className="flex flex-wrap items-center gap-2">
						{(Object.keys(RANGE_MS) as RangeKey[]).map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => setParam("range", key)}
								className={`border-fd-border rounded-[2px] border px-2 py-1 text-xs ${
									key === rangeKey ? "bg-fd-primary text-fd-primary-foreground" : ""
								}`}
							>
								{key}
							</button>
						))}
						<button
							type="button"
							onClick={() => setParam("compare", compare ? null : "1")}
							className={`border-fd-border rounded-[2px] border px-2 py-1 text-xs ${
								compare ? "bg-fd-primary text-fd-primary-foreground" : ""
							}`}
						>
							Compare
						</button>
						{(["ios", "android"] as const).map((os) => (
							<button
								key={os}
								type="button"
								onClick={() => setParam("os", osFilter === os ? null : os)}
								className={`border-fd-border rounded-[2px] border px-2 py-1 text-xs capitalize ${
									osFilter === os ? "bg-fd-primary text-fd-primary-foreground" : ""
								}`}
							>
								{os}
							</button>
						))}
					</div>
				</div>

				{snapshotCtx ? (
					<div
						role="status"
						className="border-fd-border mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[2px] border p-3"
					>
						<span className="text-fd-muted-foreground text-sm">
							Viewing a shared snapshot — range and sources are fixed by the
							link.
						</span>
						<button
							type="button"
							onClick={exitSnapshot}
							className="border-fd-border rounded-[2px] border px-3 py-1 text-xs"
						>
							Exit snapshot
						</button>
					</div>
				) : null}

				{query.isPending ? <LoadingState /> : null}

				{query.isError ? (
					<div className="border-fd-border rounded-[2px] border p-6">
						<p className="text-sm">Failed to load mobile analytics.</p>
						<button
							type="button"
							onClick={() => query.refetch()}
							className="border-fd-border mt-3 rounded-[2px] border px-3 py-1 text-xs"
						>
							Retry
						</button>
					</div>
				) : null}

				{data && totals ? (
					totals.appOpens === 0 && totals.visitors === 0 ? (
						<div className="border-fd-border rounded-[2px] border p-6">
							<h2 className="text-sm font-semibold">No mobile data yet</h2>
							<p className="text-fd-muted-foreground mt-1 text-sm">
								Install @prism-analytics/react-native, grant consent in the app,
								and navigate a screen. New screen views appear here within a
								minute.
							</p>
						</div>
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

							<h2 className="mt-8 text-sm font-semibold">Top screens</h2>
							{data.screens.length === 0 ? (
								<p className="text-fd-muted-foreground mt-2 text-sm">
									No screen views in this period.
								</p>
							) : (
								<ul className="border-fd-border mt-2 divide-y rounded-[2px] border">
									{data.screens.map((screen) => (
										<li
											key={`${screen.name}:${screen.routePattern ?? ""}`}
											className="flex items-center justify-between px-4 py-2 text-sm"
										>
											<span className="font-medium">{screen.name}</span>
											<span className="text-fd-muted-foreground tabular-nums">
												{numFmt(screen.screenViews)} views ·{" "}
												{numFmt(screen.visitors)} visitors ·{" "}
												{screen.sharePercent}%
											</span>
										</li>
									))}
								</ul>
							)}

							<h2 className="mt-8 text-sm font-semibold">Releases</h2>
							{data.releases.length === 0 ? (
								<p className="text-fd-muted-foreground mt-2 text-sm">
									No release metadata reported yet.
								</p>
							) : (
								<ul className="border-fd-border mt-2 divide-y rounded-[2px] border">
									{data.releases.map((release) => (
										<li key={release.version} className="flex items-center justify-between px-4 py-2 text-sm">
											<span className="font-medium">
												{release.version}
												{release.build ? ` (${release.build})` : ""}
											</span>
											<span className="text-fd-muted-foreground tabular-nums">
												{numFmt(release.screenViews)} views · {release.sharePercent}%
											</span>
										</li>
									))}
								</ul>
							)}
						</>
					)
				) : null}
			</div>
		</Frame>
	);
}

export function ProjectMobileAnalytics() {
	return <MobileAnalyticsPage />;
}
