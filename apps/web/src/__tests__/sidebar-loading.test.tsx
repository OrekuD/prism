import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/layout/sidebar";

const state = vi.hoisted(() => ({
	workspaces: {
		data: undefined as unknown,
		isPending: true,
		error: null as unknown,
	},
	projects: {
		data: undefined as unknown,
		isPending: true,
		isLoading: false,
		isError: false,
	},
	sources: { data: undefined as unknown },
}));
vi.mock("@/lib/authClient", () => ({
	authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@/lib/workspace", () => ({
	useWorkspaces: () => state.workspaces,
	useSelectedWorkspace: () => ({ workspace: null }),
	useActiveWorkspace: () => ({
		data: { id: "old", slug: "old", name: "Old workspace" },
	}),
}));
vi.mock("@/network/queries/useProjectsQuery", () => ({
	useProjectsQuery: () => state.projects,
}));
vi.mock("@/network/queries/useSourcesQuery", () => ({
	useSourcesQuery: () => state.sources,
}));
vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));
vi.mock("@/components/projects/create-project-dialog", () => ({
	CreateProjectDialog: () => null,
}));
vi.mock("@/components/workspace/workspace-switcher", () => ({
	CreateWorkspaceDialog: () => null,
}));

function mount(path = "/workspace/chosen/projects/app/events") {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Sidebar />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	localStorage.clear();
	state.workspaces = { data: undefined, isPending: true, error: null };
	state.projects = {
		data: undefined,
		isPending: true,
		isLoading: false,
		isError: false,
	};
	state.sources = { data: undefined };
});

it("renders URL-scoped navigation before workspace and project queries resolve", () => {
	mount();
	expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
		"href",
		"/workspace/chosen/projects/app/events",
	);
	expect(
		screen.getByRole("link", { name: "Workspace settings" }),
	).toHaveAttribute("href", "/workspace/chosen/settings");
	expect(screen.getByRole("link", { name: "Web Analytics" })).toBeVisible();
	expect(screen.getByRole("link", { name: "Mobile Analytics" })).toBeVisible();
	expect(screen.getByTitle("Switch workspace")).not.toHaveTextContent(
		"Old workspace",
	);
});

it("keeps project navigation visible but disabled when no project is selected", () => {
	mount("/workspace/chosen/projects");
	expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	expect(screen.getByRole("link", { name: "Events" })).not.toHaveAttribute(
		"href",
	);
	expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
		"href",
		"/workspace/chosen/projects",
	);
});

it("shows loading rather than false empty states in dropdowns", async () => {
	mount();
	const user = userEvent.setup();
	await user.click(screen.getByTitle("Switch project"));
	expect(screen.getByText("Loading projects…")).toBeVisible();
	expect(screen.queryByText("No projects yet.")).toBeNull();
	await user.keyboard("{Escape}");
	await user.click(screen.getByTitle("Switch workspace"));
	expect(screen.getByText("Loading workspaces…")).toBeVisible();
	expect(screen.queryByText("No workspaces yet.")).toBeNull();
});

it("distinguishes failed dropdown loads and hides known unsupported source pages", async () => {
	state.projects = {
		data: undefined,
		isPending: false,
		isLoading: false,
		isError: true,
	};
	state.workspaces = {
		data: undefined,
		isPending: false,
		error: new Error("failed"),
	};
	state.sources = { data: [] };
	mount();
	expect(screen.queryByRole("link", { name: "Web Analytics" })).toBeNull();
	const user = userEvent.setup();
	await user.click(screen.getByTitle("Switch project"));
	expect(screen.getByText("Couldn't load projects.")).toBeVisible();
	await user.keyboard("{Escape}");
	await user.click(screen.getByTitle("Switch workspace"));
	expect(screen.getByText("Couldn't load workspaces.")).toBeVisible();
});

it("does not carry the previous workspace's selected project into the next workspace", async () => {
	render(
		<MemoryRouter initialEntries={["/workspace/chosen/projects/app/events"]}>
			<Link to="/workspace/another/projects">Switch destination</Link>
			<Sidebar />
		</MemoryRouter>,
	);
	expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
		"href",
		"/workspace/chosen/projects/app/events",
	);
	await userEvent
		.setup()
		.click(screen.getByRole("link", { name: "Switch destination" }));
	expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
		"href",
		"/workspace/another/projects",
	);
});

it("reserves empty messages for successful empty dropdown responses", async () => {
	state.projects = {
		data: [],
		isPending: false,
		isLoading: false,
		isError: false,
	};
	state.workspaces = { data: [], isPending: false, error: null };
	mount("/workspace/chosen/projects");
	const user = userEvent.setup();
	await user.click(screen.getByTitle("Switch project"));
	expect(screen.getByText("No projects yet.")).toBeVisible();
	await user.keyboard("{Escape}");
	await user.click(screen.getByTitle("Switch workspace"));
	expect(screen.getByText("No workspaces yet.")).toBeVisible();
});
