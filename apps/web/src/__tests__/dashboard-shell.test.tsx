import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";
import { DashboardLayout } from "@/components/layout/dashboard-layout";

vi.mock("@/lib/authClient", () => ({
	authClient: {
		useSession: () => ({
			data: {
				session: { id: "test-session" },
				user: { name: "David", email: "david@test.dev" },
			},
			isPending: false,
		}),
	},
}));

vi.mock("@/lib/workspace", () => ({
	useActiveWorkspace: () => ({
		data: { id: "ws-1", name: "Acme", slug: "wrk_testws" },
	}),
	useWorkspaces: () => ({
		data: [{ id: "ws-1", name: "Acme", slug: "wrk_testws" }],
	}),
	useSelectedWorkspace: () => ({
		workspace: { id: "ws-1", name: "Acme", slug: "wrk_testws" },
		isPending: false,
	}),
}));

vi.mock("@/network/queries/useProjectsQuery", () => ({
	useProjectsQuery: () => ({
		data: [{ id: "p-1", name: "Acme web", slug: "acme-web", summary: [] }],
		isLoading: false,
	}),
}));

vi.mock("@/network/queries/useSourcesQuery", () => ({
	useSourcesQuery: () => ({
		data: [
			{ id: "src-web", platform: "web" },
			{ id: "src-mobile", platform: "react-native" },
		],
		isLoading: false,
	}),
}));

/**
 * v2 dashboard shell (task-14 layout): asserts the 240px sidebar renders
 * the v2 group/nav structure and the DashboardLayout mounts the shell +
 * toolbar + content regions.
 */
describe("v2 dashboard shell", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the approved workspace and project navigation hierarchy", () => {
		render(
			<MemoryRouter
				initialEntries={["/workspace/wrk_testws/projects/acme-web/events"]}
			>
				<Sidebar />
			</MemoryRouter>,
		);

		expect(
			screen.getByRole("complementary", { name: "Workspace navigation" }),
		).toBeDefined();
		// group labels
		for (const label of ["Workspace", "Project", "Data", "Configure"]) {
			expect(screen.getByText(label)).toBeDefined();
		}
		// durable destinations
		for (const label of [
			"Projects",
			"Members",
			"Workspace settings",
			"Overview",
			"Web Analytics",
			"Mobile Analytics",
			"Events",
			"People",
			"Live",
			"Errors",
			"Sources",
			"Project settings",
		]) {
			expect(screen.getAllByText(label).length).toBeGreaterThan(0);
		}
		expect(screen.queryByText("Workspace overview")).toBeNull();
		expect(screen.queryByText("Performance")).toBeNull();
		expect(screen.queryByText("Replays")).toBeNull();
		expect(screen.queryByText("Logs")).toBeNull();

		// Project work stays primary; workspace administration remains lower.
		const workspaceTrigger = screen.getByTitle("Switch workspace");
		const projectTrigger = screen.getByTitle("Switch project");
		expect(
			projectTrigger.compareDocumentPosition(workspaceTrigger) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		// the current project switch shows the active project
		expect(screen.getByText("Acme web")).toBeDefined();
	});

	it("mounts the shell with sidebar, toolbar and content regions", () => {
		render(
			<MemoryRouter
				initialEntries={["/workspace/wrk_testws/projects/acme-web/events"]}
			>
				<DashboardLayout />
			</MemoryRouter>,
		);

		// Tailwind shell: 240px sidebar landmark, toolbar menu button, main
		// view, and a hidden click-away scrim for the mobile drawer.
		expect(
			screen.getByRole("complementary", { name: "Workspace navigation" }),
		).not.toBeNull();
		expect(
			document.querySelector("button[aria-label='Open navigation']"),
		).not.toBeNull();
		expect(document.querySelector("main")).not.toBeNull();
		expect(
			document.querySelector("button[aria-label='Close navigation']"),
		).not.toBeNull();
	});
});
