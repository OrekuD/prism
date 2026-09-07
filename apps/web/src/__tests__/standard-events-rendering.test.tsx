import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectEvents } from "@/routes/projects/project/events";
import { EventDetail } from "@/routes/projects/project/event-detail";
import type { EventResource } from "@prism-analytics/types";

/**
 * Standard Events dashboard rendering (task-19 review R1-F5). Pins the
 * readable-label contract: Standard rows show the display name, a STANDARD
 * metadata label, and the category while RETAINING the raw protected name;
 * custom rows keep their raw rendering; accessible names communicate the
 * label and category without relying on color; and the detail sheet presents
 * the same metadata with the raw name for debugging.
 */

const mockedEvents = vi.hoisted(() => ({
	data: null as {
		events: EventResource[];
		nextCursor: string | null;
	} | null,
}));

vi.mock("@/network/queries/useProjectEventsQuery", () => ({
	useProjectEventsQuery: () => ({
		data: mockedEvents.data,
		isLoading: false,
		isError: false,
		isFetching: false,
		refetch: vi.fn(),
	}),
}));
vi.mock("@/network/queries/useSourcesQuery", () => ({
	useSourcesQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/network/queries/useProjectEventsArrayQuery", () => ({
	useProjectEventsArrayQuery: () => ({ data: mockedEvents.data?.events ?? [] }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("react-router-dom")>();
	return {
		...actual,
		useParams: () => ({
			slug: "acme",
			wrkSlug: "wrk_testws",
			eventId: "evt-std-1",
		}),
	};
});

const OCCURRED = 1_785_542_400_000;

function mixedRows(): EventResource[] {
	return [
		{
			id: "evt-std-1",
			sessionId: "sess-1",
			projectId: "proj_1",
			name: "$prism_sign_up",
			type: "track",
			occurredAt: OCCURRED,
			receivedAt: OCCURRED,
			personId: "person_1",
			schemaVersion: 3,
			anonymousId: "anon-1",
			userId: "user-1",
			sourceId: "src_web",
			platform: "web",
			source: {
				id: "src_web",
				name: "Acme Web",
				platform: "web",
				status: "active",
			},
			standardEvent: {
				key: "sign_up",
				displayName: "Sign up",
				category: "Identity",
				schemaVersion: 1,
			},
			properties: {
				$standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } },
			},
		} as unknown as EventResource,
		{
			id: "evt-custom-1",
			sessionId: "sess-2",
			projectId: "proj_1",
			name: "checkout_completed",
			type: "track",
			occurredAt: OCCURRED,
			receivedAt: OCCURRED,
			personId: "person_1",
			source: {
				id: "src_web",
				name: "Acme Web",
				platform: "web",
				status: "active",
			},
			standardEvent: null,
			properties: { format: "csv" },
		} as unknown as EventResource,
	];
}

function renderList() {
	mockedEvents.data = { events: mixedRows(), nextCursor: null };
	return render(
		<MemoryRouter initialEntries={["/workspace/wrk_testws/projects/acme/events"]}>
			<ProjectEvents />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	mockedEvents.data = null;
});

describe("Events list — Standard Event rows (R1-F5)", () => {
	it("renders the readable label, STANDARD metadata, category, and retained raw name for Standard rows", () => {
		const { container } = renderList();

		// readable display label (not the raw name as the primary text)
		expect(screen.getByText("Sign up")).toBeTruthy();
		// category + STANDARD metadata label, visible to sighted users
		expect(screen.getByText("Identity")).toBeTruthy();
		expect(screen.getByText("Standard")).toBeTruthy();
		// the raw protected name is retained as a secondary line
		expect(container.textContent).toContain("$prism_sign_up");

		// custom rows keep their raw rendering unchanged
		expect(screen.getByText("checkout_completed")).toBeTruthy();
		expect(container.textContent).not.toContain("$prism_checkout_completed");
	});

	it("communicates the Standard label and category through the accessible name", () => {
		renderList();

		// the accessible name carries label + category without color
		const standardButton = screen.getByRole("button", {
			name: "Sign up, Standard Identity",
		});
		expect(standardButton).toBeTruthy();
		// the custom row button's accessible name is still the raw event name
		expect(
			screen.getByRole("button", { name: "checkout_completed" }),
		).toBeTruthy();
	});

	it("renders mixed Standard and custom rows in one table", () => {
		const { container } = renderList();
		const rows = container.querySelectorAll("tbody tr");
		expect(rows).toHaveLength(2);
	});
});

describe("Event detail sheet — Standard Event presentation (R1-F5)", () => {
	it("shows the display name as the title with Standard label, category, and raw name", () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		client.setQueryData(["project-events", "acme"], {
			events: mixedRows(),
			nextCursor: null,
		});
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter
					initialEntries={["/workspace/wrk_testws/projects/acme/events/evt-std-1"]}
				>
					<EventDetail />
				</MemoryRouter>
			</QueryClientProvider>,
		);

		// display name is the sheet title; raw name stays for debugging
		expect(screen.getByText("Sign up")).toBeTruthy();
		expect(document.body.textContent).toContain("$prism_sign_up");
		expect(screen.getByText("Standard")).toBeTruthy();
		expect(screen.getByText("Identity")).toBeTruthy();
		// screen-reader text carries the full relationship explicitly
		expect(
			document.body.textContent?.includes(
				"Standard Identity, Sign up, raw name $prism_sign_up",
			),
		).toBe(true);
	});
});
