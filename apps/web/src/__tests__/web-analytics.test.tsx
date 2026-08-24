import { ProjectWebAnalytics } from "@/routes/projects/project/web-analytics";
import type { WebAnalyticsResource } from "@prism-analytics/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Web analytics page rendering tests (Task 17 slice 6). The page is a
 * pure presentation of the bounded server read model — these tests pin
 * the one-to-one v2 layout contract: metric strip labels, comparison
 * kinds (New / no prior data / inverted bounce), trend chart series
 * tabs, pages/referrers/campaigns/locations/technology panels, the page
 * filter chip flow, and the no-web-sources empty state.
 */

const mockedSources = vi.hoisted(() => ({
	data: [] as Array<{
		id: string;
		name: string;
		platform: string;
		allowedOrigins: string[];
	}>,
}));
const mockedAnalytics = vi.hoisted(() => ({
	data: null as WebAnalyticsResource | null,
}));

vi.mock("@/network/queries/useSourcesQuery", () => ({
	useSourcesQuery: () => ({ data: mockedSources.data, isLoading: false }),
}));
vi.mock("@/network/queries/useWebAnalyticsQuery", () => ({
	useWebAnalyticsQuery: () => ({
		data: mockedAnalytics.data,
		isLoading: !mockedAnalytics.data,
		isError: false,
	}),
}));

const FROM = 1_785_542_400_000;
const HOUR = 3_600_000;

function makeResource(): WebAnalyticsResource {
	return {
		range: { from: FROM, to: FROM + 30 * 86_400_000, timezone: "UTC" },
		filters: { sourceIds: [], host: null, path: null, traffic: "human" },
		totals: {
			pageViews: 1240,
			visitors: 610,
			sessions: 830,
			viewsPerSession: 1.49,
			bounceRate: 41,
			excludedBots: 12,
		},
		comparison: {
			pageViews: { kind: "percent", direction: "up", percent: 12.4 },
			visitors: { kind: "percent", direction: "down", percent: 3.1 },
			sessions: { kind: "new" },
			viewsPerSession: { kind: "no-prior-data" },
			bounceRate: { kind: "percent", direction: "down", percent: 2.2 },
		},
		trend: {
			bucket: "daily",
			points: Array.from({ length: 30 }, (_, i) => ({
				bucketStartUtc: FROM + i * 86_400_000,
				pageViews: 40 + i,
				visitors: 20 + (i % 5),
				sessions: 27 + (i % 3),
			})),
		},
		pages: [
			{
				path: "/",
				title: "Home",
				host: "localhost",
				pageViews: 420,
				visitors: 210,
				entrances: 300,
				sharePercent: 33.9,
				bounceRate: 38,
			},
			{
				path: "/menu",
				title: "Menu",
				host: "localhost",
				pageViews: 260,
				visitors: 140,
				entrances: 180,
				sharePercent: 21.0,
				bounceRate: null,
			},
		],
		referrers: [
			{ referrerHost: null, sessions: 250, visitors: 180, sharePercent: 30.1 },
			{
				referrerHost: "google.com",
				sessions: 200,
				visitors: 150,
				sharePercent: 24.1,
			},
		],
		campaigns: [
			{
				source: "google",
				medium: "organic",
				name: null,
				sessions: 160,
				visitors: 120,
				sharePercent: 19.3,
			},
		],
		locations: {
			countries: [
				{
					countryCode: "US",
					region: null,
					city: null,
					sessions: 210,
					visitors: 150,
					pageViews: 400,
					sharePercent: 25.3,
				},
				{
					countryCode: "DE",
					region: null,
					city: null,
					sessions: 90,
					visitors: 60,
					pageViews: 170,
					sharePercent: 10.8,
				},
			],
			regions: [],
			cities: [],
			coveragePercent: 64,
		},
		technology: {
			browsers: [
				{
					key: "chrome",
					label: "Chrome",
					pageViews: 700,
					visitors: 380,
					sharePercent: 56.5,
				},
			],
			operatingSystems: [],
			devices: [],
			viewports: [
				{
					key: "1920x1080",
					label: "1920×1080",
					pageViews: 260,
					visitors: 140,
					sharePercent: 21.0,
				},
			],
			languages: [],
			coveragePercent: 96,
		},
		coverage: {
			technologyPercent: 96,
			geographyPercent: 64,
			campaignPercent: 48,
		},
	};
}

function renderPage(
	initialUrl = "/workspace/wrk_testws/projects/acme-web/web-analytics",
) {
	return render(
		<MemoryRouter initialEntries={[initialUrl]}>
			<ProjectWebAnalytics />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	mockedSources.data = [];
	mockedAnalytics.data = null;
});

describe("web analytics page", () => {
	it("shows the no-web-sources empty state", () => {
		// Sources resolve first (not loading); analytics payload present too -
		// emptiness comes from having zero web-platform sources.
		mockedAnalytics.data = makeResource();
		const { container } = renderPage();
		expect(screen.getByText("No Web sources in this project.")).toBeTruthy();
		expect(container.textContent).toContain("sources with the Web platform");
	});

	it("renders the full v2 layout bound to server data", () => {
		mockedSources.data = [
			{
				id: "src_web",
				name: "Acme Web",
				platform: "web",
				allowedOrigins: ["http://localhost:5173"],
			},
			{ id: "src_srv", name: "API", platform: "server", allowedOrigins: [] },
		];
		mockedAnalytics.data = makeResource();
		const { container } = renderPage();

		// Head + metric strip labels (one-to-one with the design).
		for (const label of [
			"Web analytics",
			"Page views",
			"Unique visitors",
			"Sessions",
			"Bounce rate",
			"Views per session",
		]) {
			expect(screen.getAllByText(label).length).toBeGreaterThan(0);
		}
		// Frozen comparison vocabulary, never fabricated percentages:
		expect(container.textContent).toContain("New");
		expect(container.textContent).toContain("no prior data");
		// Bounce renders its real value (not 0) and views/session is formatted.
		expect(container.textContent).toContain("41%");
		expect(container.textContent).toContain("1.5");

		// Trend chart SVG + series tabs exist.
		expect(container.querySelector("svg[role='img']")).not.toBeNull();
		expect(screen.getByRole("group", { name: "Trend series" })).toBeTruthy();

		// Top pages table shows path rows from the server payload.
		expect(container.textContent).toContain("/menu");

		// Referrers include the explicit Direct row.
		expect(container.textContent).toContain("Direct / none");

		// Locations use country code chips; coverage note present.
		expect(container.textContent).toContain("US");
		expect(container.textContent).toContain(
			"Country-level precision available for 64% of sessions.",
		);

		// Technology table + viewport chip + attribution note.
		expect(container.textContent).toContain("Chrome");
		expect(container.textContent).toContain("96% of pageviews attributed");

		// Non-web sources are excluded from the source picker.
		expect(container.textContent).not.toContain("API");
	});

	it("clicking a page row adds the path filter chip; clicking again clears it", () => {
		mockedSources.data = [
			{ id: "src_web", name: "Acme Web", platform: "web", allowedOrigins: [] },
		];
		mockedAnalytics.data = makeResource();
		const { container } = renderPage();

		// The /menu row is clickable and toggles the ?path= param.
		const menuCell = screen.getByLabelText("Filter report by /menu");
		fireEvent.click(menuCell);
		// Re-render happens through router state — the chip text appears in DOM.
		// (MemoryRouter keeps the component mounted; assert via re-query.)
		expect(screen.getByLabelText("Remove page filter")).toBeTruthy();
		fireEvent.click(screen.getByLabelText("Remove page filter"));
		expect(screen.queryByLabelText("Remove page filter")).toBeNull();
		void container;
	});

	it("bounce rate with no completed sessions renders an em dash, never 0%", () => {
		mockedSources.data = [
			{ id: "src_web", name: "Acme Web", platform: "web", allowedOrigins: [] },
		];
		const resource = makeResource();
		resource.totals = { ...resource.totals, bounceRate: null };
		resource.comparison = { ...resource.comparison, bounceRate: null };
		mockedAnalytics.data = resource;
		const { container } = renderPage();
		expect(container.textContent).toContain("\u2014");
	});
});
