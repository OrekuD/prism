import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonDetail } from "@/routes/projects/project/person";
import { ProjectPeople } from "@/routes/projects/project/people";

vi.mock("@/utils/axiosInstance", () => ({
	axiosInstance: {
		get: vi.fn(),
		delete: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
	},
}));
vi.mock("@/lib/workspace", () => ({
	useActiveMember: () => ({ data: { role: mockedRole } }),
}));

let mockedRole: "owner" | "admin" | "member" = "owner";

import { axiosInstance } from "@/utils/axiosInstance";

const getMock = axiosInstance.get as unknown as ReturnType<typeof vi.fn>;
const deleteMock = axiosInstance.delete as unknown as ReturnType<typeof vi.fn>;

let queryClient: QueryClient;

const emptyPeople = {
	people: [],
	summary: {
		range: "30d",
		from: 1,
		to: 2,
		identifiedPeople: 0,
		activePeople: 0,
		newPeople: 0,
		anonymousPeople: 0,
	},
	nextCursor: null,
};

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	mockedRole = "owner";
	getMock.mockReset();
	deleteMock.mockReset();
	getMock.mockImplementation(async () => ({ data: emptyPeople }));
});

function renderPeople() {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter
				initialEntries={["/workspace/wrk_demo/projects/alpha/people"]}
			>
				<Routes>
					<Route
						path="/workspace/:wrkSlug/projects/:slug/people"
						element={<ProjectPeople />}
					/>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

function renderPerson() {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter
				initialEntries={[
					"/workspace/wrk_demo/projects/alpha/people/u_1234567890abcdef",
				]}
			>
				<Routes>
					<Route
						path="/workspace/:wrkSlug/projects/:slug/people"
						element={<ProjectPeople />}
					>
						<Route path=":personId" element={<PersonDetail />} />
					</Route>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("ProjectPeople", () => {
	it("labels exact external ID search and explains its scope", async () => {
		renderPeople();
		await screen.findByText("No people yet");
		expect(screen.getByLabelText(/search by exact user id/i)).toBeDefined();
		expect(screen.getByText(/exact developer-supplied user id/i)).toBeDefined();
	});

	it("leads with the developer identity and useful profile traits, not the internal person id", async () => {
		getMock.mockResolvedValue({
			data: {
				people: [
					{
						personId: "u_1234567890abcdef",
						primaryExternalId: "usr_7f92",
						firstSeenAt: 1,
						lastSeenAt: Date.now(),
						traits: {
							name: "Ama Mensah",
							email: "ama@example.com",
							plan: "pro",
						},
						externalIdentityCount: 1,
						anonymousIdentityCount: 1,
						sessionCount: 2,
						eventCount: 10,
					},
				],
				summary: {
					...emptyPeople.summary,
					identifiedPeople: 1,
					activePeople: 1,
					newPeople: 1,
				},
				nextCursor: null,
			},
		});

		renderPeople();

		// The identity renders in both the desktop table and the mobile list.
		const names = await screen.findAllByText("Ama Mensah");
		expect(names.length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("usr_7f92").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("pro")).toBeDefined();
		expect(screen.queryByText(/u_1234567890/)).toBeNull();
	});

	it("renders a range-specific People summary", async () => {
		getMock.mockResolvedValue({
			data: {
				...emptyPeople,
				summary: {
					...emptyPeople.summary,
					identifiedPeople: 18,
					activePeople: 7,
					newPeople: 3,
					anonymousPeople: 11,
				},
			},
		});

		renderPeople();

		expect(await screen.findByText("18")).toBeDefined();
		expect(screen.getByText("7")).toBeDefined();
		expect(screen.getByText("3")).toBeDefined();
		expect(screen.getByText("11")).toBeDefined();
		expect(screen.getByText(/identified users/i)).toBeDefined();
	});

	it("renders an empty state that explains how a person appears", async () => {
		renderPeople();
		expect(await screen.findByText("No people yet")).toBeDefined();
		expect(screen.getByText(/calls identify\(\)/)).toBeDefined();
	});

	it("keeps URL range state, the cursor stack, and rows-per-page in sync", async () => {
		getMock.mockImplementation(async (url: string) => {
			const cursor = new URL(url, "https://prism.local").searchParams.get("cursor");
			const limit = new URL(url, "https://prism.local").searchParams.get("limit");
			return {
				data: {
					...emptyPeople,
					summary: { ...emptyPeople.summary, identifiedPeople: 1 },
					nextCursor: cursor ? null : "cursor-page-2",
					people: [
						{
							personId: cursor === "cursor-page-2" ? "u_page2" : "u_page1",
							primaryExternalId:
								cursor === "cursor-page-2" ? "user-2" : "user-1",
							firstSeenAt: 1,
							lastSeenAt: Date.now(),
							traits: {},
							externalIdentityCount: 1,
							anonymousIdentityCount: 0,
							sessionCount: 1,
							eventCount: 1,
						},
					],
				},
				__limit: limit,
			};
		});

		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter
					initialEntries={[
						"/workspace/wrk_demo/projects/alpha/people?range=7d",
					]}
				>
					<Routes>
						<Route
							path="/workspace/:wrkSlug/projects/:slug/people"
							element={<ProjectPeople />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		await screen.findAllByText("user-1");

		// range stays in the request URL
		expect(
			getMock.mock.calls.some(([url]) =>
				String(url).includes("range=7d"),
			),
		).toBe(true);

		// page 2 through the cursor stack
		fireEvent.click(screen.getByRole("button", { name: "Next page" }));
		await screen.findAllByText("user-2");
		expect(
			getMock.mock.calls.some(([url]) =>
				String(url).includes("cursor=cursor-page-2"),
			),
		).toBe(true);
		// Previous returns to page 1 — served from the React Query cache
		// (staleTime reuse), so no new request for cursor=null is issued.
		fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
		await screen.findAllByText("user-1");
		expect(
			getMock.mock.calls.filter(([url]) =>
				String(url).includes("cursor=cursor-page-2"),
			),
		).toHaveLength(1);
		expect(
			getMock.mock.calls.filter(
				([url]) => !String(url).includes("cursor="),
			),
		).toHaveLength(1);

		// rows-per-page triggers a refetch with the new limit
		fireEvent.click(screen.getAllByRole("combobox")[1] ?? screen.getAllByRole("combobox")[0]);
		const option = await screen.findByRole("option", { name: "25" });
		fireEvent.click(option);
		await waitFor(() =>
			expect(
				getMock.mock.calls.some(([url]) => String(url).includes("limit=25")),
			).toBe(true),
		);
	});
});

describe("PersonDetail", () => {
	const person = {
		personId: "u_1234567890abcdef",
		primaryExternalId: "user-1",
		firstSeenAt: 1,
		lastSeenAt: Date.now(),
		traits: {
			name: "Ama Mensah",
			email: "ama@example.com",
			plan: "pro",
		},
		externalIdentityCount: 1,
		anonymousIdentityCount: 0,
		sessionCount: 2,
		eventCount: 10,
		externalIds: ["user-1"],
		anonymousIds: [],
	};

	it("uses supplied profile data as the heading and keeps the internal id secondary", async () => {
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity") ? [] : person,
		}));

		renderPerson();

		expect(
			await screen.findByRole("heading", { name: "Ama Mensah" }),
		).toBeDefined();
		expect(screen.getByText("ama@example.com")).toBeDefined();
		expect(screen.getByText("u_1234567890abcdef")).toBeDefined();
	});

	it("renders custom JSON traits with bounded, text-only output (R1-F4)", async () => {
		const oversized = "x".repeat(400);
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity")
				? []
				: {
						...person,
						traits: {
							name: "Ama Mensah",
							avatarUrl: "https://cdn.example.com/ama.png",
							settings: { theme: "dark", flags: [1, 2, 3] },
							tags: ["beta", "vip"],
							legacy: null,
							bio: oversized,
						},
					},
		}));

		renderPerson();

		// avatarUrl joins the supplied-traits section (bounded text, never fetched)
		expect(await screen.findByText("https://cdn.example.com/ama.png")).toBeDefined();
		// objects render as bounded key/value text
		expect(screen.getByText(/theme: dark/)).toBeDefined();
		// arrays render as bounded lists
		expect(screen.getByText(/beta, vip/)).toBeDefined();
		// null renders as an explicit value, not dropped
		expect(screen.getByText("null")).toBeDefined();
		// oversized strings are truncated with an ellipsis, never fully emitted
		expect(screen.getAllByText(/x{60,}…/).length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText(oversized)).toBeNull();
		// nothing was injected as HTML
		expect(document.querySelector("img[src*='cdn.example']")).toBeNull();
	});

	it("requires typing delete exactly before the destructive action enables", async () => {
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity") ? [] : person,
		}));

		renderPerson();

		const confirm = await screen.findByLabelText(/type delete to confirm/i);
		const deleteButton = screen.getByRole("button", { name: /delete person/i });
		expect(deleteButton).toBeDisabled();
		fireEvent.change(confirm, { target: { value: "delete" } });
		expect(deleteButton).toBeEnabled();
		deleteButton.click();
		await waitFor(() => expect(deleteMock).toHaveBeenCalled());
		expect(deleteMock).toHaveBeenCalledWith(
			expect.stringContaining("confirm=true"),
		);
	});

	it("activity rows show trusted source attribution and link to the canonical event detail", async () => {
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity")
				? [
						{
							id: "evt-std-1",
							sessionId: "sess-9",
							projectId: "proj_1",
							name: "$prism_sign_up",
							type: "track",
							occurredAt: 1_785_542_400_000,
							receivedAt: 1_785_542_400_000,
							personId: "u_1234567890abcdef",
							sourceId: "src_web_1",
							platform: "web",
							source: {
								id: "src_web_1",
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
							properties: null,
						},
					]
				: person,
		}));

		renderPerson();

		// Standard Event display name, not the raw protected name
		expect(await screen.findByText("Sign up")).toBeDefined();
		// trusted source name rides the row
		expect(screen.getByText("Acme Web")).toBeDefined();
		// the row opens the canonical Events detail route
		const row = screen
			.getByText("Sign up")
			.closest("a");
		expect(row?.getAttribute("href")).toBe(
			"/workspace/wrk_demo/projects/alpha/events/evt-std-1",
		);
	});

	it("hides data controls from plain members; owner/admin see them", async () => {
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity") ? [] : person,
		}));

		mockedRole = "member";
		const memberView = renderPerson();
		await screen.findByRole("heading", { name: "Ama Mensah" });
		expect(screen.queryByLabelText(/type delete to confirm/i)).toBeNull();
		expect(
			screen.queryByRole("button", { name: /export person data/i }),
		).toBeNull();
		memberView.unmount();

		mockedRole = "admin";
		renderPerson();
		expect(
			await screen.findByRole("button", { name: /export person data/i }),
		).toBeDefined();
		expect(screen.getByLabelText(/type delete to confirm/i)).toBeDefined();
	});

	it("removes People list caches so the deleted row never renders after navigation (R2-F1)", async () => {
		// The fresh list fetch stays pending until released: this proves the
		// old row never flashes while the post-navigation refetch runs.
		const gate: { resolve?: (value: { data: typeof emptyPeople }) => void } = {};
		const pendingList = new Promise<{ data: typeof emptyPeople }>((resolve) => {
			gate.resolve = resolve;
		});
		getMock.mockImplementation(async (url: string) => {
			if (String(url).includes("/activity")) return { data: [] };
			if (String(url).includes("u_1234567890abcdef")) return { data: person };
			return pendingList;
		});

		// seed the list cache as if the user visited People, then opened the
		// profile sheet (the list stays mounted behind the sheet)
		const listKey = ["people", "alpha", "30d", undefined, undefined, 10];
		queryClient.setQueryData(listKey, {
			...emptyPeople,
			people: [
				{
					personId: "u_1234567890abcdef",
					primaryExternalId: "user-1",
					firstSeenAt: 1,
					lastSeenAt: Date.now(),
					traits: { name: "Ama Mensah", plan: "pro" },
					externalIdentityCount: 1,
					anonymousIdentityCount: 0,
					sessionCount: 2,
					eventCount: 10,
				},
			],
		});
		queryClient.setQueryData(["person", "alpha", "u_1234567890abcdef"], person);
		queryClient.setQueryData(
			["person-activity", "alpha", "u_1234567890abcdef"],
			[],
		);

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter
					initialEntries={[
						"/workspace/wrk_demo/projects/alpha/people/u_1234567890abcdef",
					]}
				>
					<Routes>
						<Route
							path="/workspace/:wrkSlug/projects/:slug/people"
							element={<ProjectPeople />}
						>
							<Route path=":personId" element={<PersonDetail />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		// the sheet is open over the seeded list row (correct pre-deletion)
		const confirm = await screen.findByLabelText(/type delete to confirm/i);
		expect(screen.getAllByText("Ama Mensah").length).toBeGreaterThanOrEqual(1);
		fireEvent.change(confirm, { target: { value: "delete" } });
		fireEvent.click(screen.getByRole("button", { name: /delete person/i }));

		await waitFor(() => expect(deleteMock).toHaveBeenCalled());

		// deletion closed the sheet. The list stays mounted and
		// usePeopleQuery reuses the previous page as placeholderData during
		// a refetch — so there is no loading skeleton here by design. What
		// matters: the previous page was surgically cleared first, so the
		// old row never renders while the fresh fetch runs.
		await waitFor(() =>
			expect(document.querySelector('[role="dialog"]')).toBeNull(),
		);
		await waitFor(() => {
			const freshFetch = getMock.mock.calls.some(([url]) =>
				String(url).startsWith("/projects/alpha/people?"),
			);
			expect(freshFetch).toBe(true);
		});
		expect(screen.queryByText("Ama Mensah")).toBeNull();
		// the seeded list page is REMOVED from the cache, not merely stale
		expect(queryClient.getQueryData(listKey)).toBeUndefined();

		// after the fresh (now empty) list resolves, still no deleted row
		gate.resolve?.({ data: emptyPeople });
		await screen.findByText("No people yet");
		expect(screen.queryByText("Ama Mensah")).toBeNull();
		// the profile and activity caches are REMOVED, not just stale
		expect(
			queryClient.getQueryData(["person", "alpha", "u_1234567890abcdef"]),
		).toBeUndefined();
		expect(
			queryClient.getQueryData(["person-activity", "alpha", "u_1234567890abcdef"]),
		).toBeUndefined();
	});

	it("has no axe violations on the person profile with activity and controls (R1-F7)", async () => {
		getMock.mockImplementation(async (url: string) => ({
			data: String(url).includes("/activity")
				? [
						{
							id: "evt-1",
							sessionId: "sess-9",
							projectId: "proj_1",
							name: "$prism_sign_up",
							type: "track",
							occurredAt: 1_785_542_400_000,
							receivedAt: 1_785_542_400_000,
							personId: "u_1234567890abcdef",
							sourceId: "src_web_1",
							platform: "web",
							source: {
								id: "src_web_1",
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
							properties: null,
						},
					]
				: person,
		}));

		renderPerson();

		await screen.findByRole("heading", { name: "Ama Mensah" });
		// section structure: Identity, Linked identities, Technical details,
		// Activity, Data controls
		for (const section of [
			"Identity",
			"Linked identities",
			"Technical details",
			"Activity",
			"Data controls",
		]) {
			expect(screen.getByText(section)).toBeDefined();
		}
		await waitFor(async () => {
			// the profile sheet renders in a portal and Radix marks the
			// background inert — audit the dialog itself, not the document
			const dialog = document.querySelector('[role="dialog"]');
			expect(dialog).not.toBeNull();
			const results = await axe.run(dialog as Element);
			expect(results.violations).toHaveLength(0);
		});
	});

	it("has no axe violations on the people list", async () => {
		const { container } = renderPeople();
		await screen.findByText("No people yet");
		const results = await axe.run(container);
		expect(results.violations).toHaveLength(0);
	});
});
