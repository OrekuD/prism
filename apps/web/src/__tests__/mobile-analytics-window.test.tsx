import type { MobileAnalyticsResource } from "@prism-analytics/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMobileAnalytics } from "@/routes/projects/project/mobile-analytics";
import { axiosInstance } from "@/utils/axiosInstance";

/**
 * Regression: the mobile analytics page must not mint a fresh query window
 * on every render. Raw from/to timestamps are part of the query key, so an
 * unmemoized `Date.now()` creates a new pending query on each render — an
 * infinite refetch loop that pins the page in its loading state.
 */

vi.mock("@/utils/axiosInstance", () => ({
	axiosInstance: { get: vi.fn() },
}));
// PageHeader breadcrumbs read these; keep them inert so the only axios call
// under test is the page's own mobile-analytics request.
vi.mock("@/lib/workspace", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/workspace")>();
	return {
		...actual,
		useSelectedWorkspace: () => ({ workspace: null, isPending: false }),
		useActiveWorkspace: () => ({ data: null }),
	};
});
vi.mock("@/network/queries/useProjectsQuery", () => ({
	useProjectsQuery: () => ({ data: undefined }),
}));
vi.mock("@/network/queries/useSourcesQuery", () => ({
	useSourcesQuery: () => ({ data: undefined }),
}));

const get = vi.mocked(axiosInstance.get);

function makeResource(): MobileAnalyticsResource {
	return {
		range: { from: 1, to: 2, timezone: "UTC" },
		filters: { sourceIds: [], os: null, release: null },
		totals: {
			appOpens: 12,
			visitors: 4,
			appSessions: 5,
			avgScreensPerSession: 2.4,
			avgSessionDurationMs: 61_000,
			observedInstallations: 3,
			excludedBots: 0,
		},
		comparison: {
			appOpens: { kind: "percent", direction: "up", percent: 10 },
			visitors: { kind: "new" },
			appSessions: { kind: "no-prior-data" },
			observedInstallations: { kind: "percent", direction: "flat", percent: 0 },
		},
		trend: { bucket: "daily", points: [] },
		screens: [],
		releases: [],
		installations: { observed: 0, rows: [] },
		technology: {
			devices: [],
			operatingSystems: [],
			sizeClasses: [],
			coveragePercent: 0,
		},
		locations: {
			countries: [],
			regions: [],
			cities: [],
			coveragePercent: 0,
		},
		coverage: { technologyPercent: 0, geographyPercent: 0 },
	};
}

function renderPage(initialEntry = "/workspace/w/projects/p/mobile-analytics") {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ui = (
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[initialEntry]}>
				<Routes>
					<Route
						path="/workspace/:wrkSlug/projects/:slug/mobile-analytics"
						element={<ProjectMobileAnalytics />}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>
	);
	return { ...render(ui), ui };
}

beforeEach(() => {
	get.mockReset();
	get.mockResolvedValue({ status: 200, data: makeResource() } as never);
});

describe("mobile analytics query window", () => {
	it("keeps one stable window across rerenders (no refetch loop)", async () => {
		const { ui, rerender } = renderPage();
		await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

		// Simulate time moving on and a parent rerender: the memoized window
		// must survive, so the query key — and the fetch count — stay put.
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000);
		rerender(ui);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(get).toHaveBeenCalledTimes(1);
		vi.restoreAllMocks();
	});

	it("fetches once more when the range changes", async () => {
		renderPage();
		await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

		fireEvent.click(screen.getByRole("button", { name: "24h" }));
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
	});
});
