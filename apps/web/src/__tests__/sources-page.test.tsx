import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectSources } from "@/routes/projects/project/sources";
import type { SourceResource } from "@/network/queries/useSourcesQuery";

const state = vi.hoisted(() => ({
  data: [] as SourceResource[],
  isLoading: false,
  isError: false,
  role: "owner",
}));
vi.mock("@/components/public/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/lib/workspace", () => ({
  useActiveMember: () => ({ data: { role: state.role } }),
}));
vi.mock("@/network/queries/useSourcesQuery", () => ({
  useSourcesQuery: () => ({ ...state, refetch: vi.fn() }),
}));
vi.mock("@/components/sources/create-source-dialog", () => ({
  CreateSourceDialog: ({ initialPlatform }: { initialPlatform: string }) => (
    <button type="button">New {initialPlatform} source</button>
  ),
}));
vi.mock("@/components/sources/source-keys", () => ({
  SourceKeys: () => <div>Key management</div>,
}));
vi.mock("@/components/sources/source-setup", () => ({
  SourceSetup: () => <div>SDK instructions</div>,
}));

const source = (
  id: string,
  platform: SourceResource["platform"],
  received: number | null,
): SourceResource => ({
  id,
  projectId: "project",
  name: id,
  platform,
  allowedOrigins: [],
  keys: [
    {
      id: "key",
      name: "Default",
      keyType: "publishable",
      status: "active",
      value: "test",
      createdAt: "",
      lastUsedAt: null,
    },
  ],
  telemetry: { events: 5, lastReceivedAt: received },
});
function mount() {
  return render(
    <MemoryRouter initialEntries={["/workspace/acme/projects/app/sources/web"]}>
      <Routes>
        <Route
          path="/workspace/:wrkSlug/projects/:slug/sources/:type/:tab?"
          element={<ProjectSources />}
        >
          <Route path=":sourceId" element={<div>Source detail</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  state.data = [];
  state.isLoading = false;
  state.isError = false;
  state.role = "owner";
});
describe("Sources redesign", () => {
  it("shows named sources, honest activity, and working detail routes", () => {
    state.data = [
      source("Production site", "web", Date.now()),
      source("Unverified site", "web", null),
      source("Mobile app", "mobile", null),
    ];
    mount();
    expect(screen.getByText("Data received")).toBeTruthy();
    expect(screen.getByText("No activity reported")).toBeTruthy();
    expect(screen.queryByText("Configured")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Mobile app", level: 3 }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /Production site/ }));
    expect(screen.getByText("Source detail")).toBeTruthy();
  });
  it("keeps navigation visible during loading without a false empty state", () => {
    state.isLoading = true;
    mount();
    expect(
      screen.getByRole("navigation", { name: "Source types" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "Loading sources" }),
    ).toBeTruthy();
    expect(screen.queryByText("Connect your web app")).toBeNull();
  });
  it("switches families, creates mobile sources, and preserves setup/key routes", () => {
    state.data = [source("Native app", "mobile", null)];
    mount();
    fireEvent.click(screen.getByRole("link", { name: /Mobile app/ }));
    expect(screen.getByText("Native app")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "New mobile source" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "SDK setup" }));
    expect(screen.getByText("SDK instructions")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Keys" }));
    expect(screen.getByText("Key management")).toBeTruthy();
  });
  it("shows permission-aware empty state and keeps errors distinct", () => {
    state.role = "member";
    const view = mount();
    expect(screen.queryByRole("button", { name: /New .* source/ })).toBeNull();
    expect(screen.getByText(/Ask a workspace owner/)).toBeTruthy();
    view.unmount();
    state.isError = true;
    mount();
    expect(screen.getByText("Could not load sources")).toBeTruthy();
    expect(screen.queryByText(/Ask a workspace owner/)).toBeNull();
  });
  it("does not present historical activity as an active-key connection", () => {
    state.data = [{ ...source("Old source", "web", Date.now()), keys: [] }];
    mount();
    expect(screen.getByText("No active keys")).toBeTruthy();
    expect(screen.queryByText("Data received")).toBeNull();
  });
});
