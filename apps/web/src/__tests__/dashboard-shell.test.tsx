import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "@/components/layout/v2/Sidebar";
import { DashboardLayout } from "@/components/layout/v2/DashboardLayout";

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
  useActiveWorkspace: () => ({ data: { id: "ws-1", name: "Acme" } }),
  useWorkspaces: () => ({ data: [{ id: "ws-1", name: "Acme" }] }),
}));

vi.mock("@/network/queries/useProjectsQuery", () => ({
  useProjectsQuery: () => ({
    data: [
      { id: "p-1", name: "Acme web", slug: "acme-web", summary: [] },
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

  it("renders the Workspace/Project/Data/Configure nav groups in the sidebar", () => {
    render(
      <MemoryRouter initialEntries={["/projects/acme-web/events"]}>
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
    // links
    for (const label of ["Workspace overview", "Projects", "Members", "Events", "People", "Live", "Sources", "Settings"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    // the current project switch shows the active project
    expect(screen.getByText("Acme web")).toBeDefined();
  });

  it("mounts the shell with sidebar, toolbar and content regions", () => {
    render(
      <MemoryRouter initialEntries={["/projects/acme-web/events"]}>
        <DashboardLayout />
      </MemoryRouter>,
    );

    expect(document.querySelector(".shell")).not.toBeNull();
    expect(document.querySelector(".sidebar")).not.toBeNull();
    expect(document.querySelector(".toolbar")).not.toBeNull();
    expect(document.querySelector(".content .view")).not.toBeNull();
    // mobile drawers start closed
    expect(document.querySelector(".scrim")?.className).toContain("scrim");
  });
});
