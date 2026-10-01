import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveDefaultWorkspacePath, useWorkspaces, useActiveWorkspace } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";

const state = vi.hoisted(() => ({ signedIn: false, rejectList: false }));
const projects = vi.hoisted(() => vi.fn(async () => ({ status: 200, data: [{ slug: "app", name: "My app" }] })));
vi.mock("@/utils/axiosInstance", () => ({ axiosInstance: { get: projects } }));
vi.mock("@/lib/authClient", async () => {
  const { createAuthClient } = await import("better-auth/react");
  const { organizationClient } = await import("better-auth/client/plugins");
  return { authClient: createAuthClient({
    baseURL: "http://localhost:8787",
    plugins: [organizationClient()],
    fetchOptions: { customFetchImpl: async (input: RequestInfo | URL) => {
      const path = String(input);
      const workspace = { id: "org", slug: "team", name: "My team" };
      if (path.includes("get-session")) return Response.json({ session: { id: "s", activeOrganizationId: "org" }, user: { id: "u" } });
      if (!state.signedIn || (state.rejectList && path.endsWith("/list"))) return Response.json({ message: "Unauthorized" }, { status: 401 });
      return Response.json(path.endsWith("/list") ? [workspace] : workspace);
    } },
  }) };
});

function DropdownData() {
  const workspaces = useWorkspaces();
  const query = useProjectsQuery();
  const active = useActiveWorkspace();
  return <>
    <span>{workspaces.error ? "Signed-out cache" : workspaces.data?.[0]?.name}</span>
    <span>{query.data?.[0]?.name}</span>
    <span>{active.data ? `Active: ${active.data.name}` : "No active workspace"}</span>
  </>;
}

afterEach(() => { state.signedIn = false; state.rejectList = false; vi.clearAllMocks(); });

it("replaces the mounted signed-out organization cache before SPA navigation, enabling projects without a reload", async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/workspace/team/projects"]}><Routes>
      <Route path="/workspace/:wrkSlug/projects" element={<DropdownData />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
  await screen.findByText("Signed-out cache");
  expect(projects).not.toHaveBeenCalled();
  state.signedIn = true;
  let path: string | undefined;
  await act(async () => { path = await resolveDefaultWorkspacePath(); });
  expect(path).toBe("/workspace/team/projects");
  await waitFor(() => expect(screen.getByText("My team")).toBeVisible());
  await screen.findByText("My app");
  await screen.findByText("Active: My team");
  expect(projects).toHaveBeenCalledWith("/projects?organizationId=org");
});

it("does not turn a failed workspace refresh into a successful navigation", async () => {
  state.signedIn = true;
  state.rejectList = true;
  await expect(resolveDefaultWorkspacePath()).rejects.toThrow("Could not load workspaces");
});
