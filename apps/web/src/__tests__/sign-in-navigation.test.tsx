import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LogIn } from "@/routes/auth/log-in";

const state = vi.hoisted(() => ({ authenticated: false, pending: false }));
const signIn = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
let workspaceResult: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/lib/authClient", () => ({ authClient: {
  useSession: () => ({ data: state.authenticated ? { session: { id: "s" } } : null, isPending: state.pending }),
  useListOrganizations: () => ({ data: state.authenticated ? [{ id: "first", slug: "first" }] : [], isPending: state.pending }),
  useActiveOrganization: () => ({ data: null, isPending: state.pending }),
  signIn: { email: signIn },
  getSession: async () => ({ data: { session: { id: "s", activeOrganizationId: "chosen" } } }),
  organization: { list },
  $store: { atoms: {
    session: { get: () => ({ data: { session: { id: "s" } } }) },
    listOrganizations: { get: () => ({ ...workspaceResult, refetch: async () => { workspaceResult = await list(); } }) },
    activeOrganization: { get: () => ({ refetch: async () => undefined }) },
  } },
} }));

function Flow() {
  return <MemoryRouter initialEntries={["/auth/log-in"]}><Routes>
    <Route path="/auth/log-in" element={<LogIn />} />
    <Route path="/workspace/chosen/projects" element={<h1>Chosen projects</h1>} />
    <Route path="*" element={<h1>Intermediate redirect</h1>} />
  </Routes></MemoryRouter>;
}

beforeEach(() => {
  state.authenticated = false;
  state.pending = false;
  workspaceResult = { data: null, error: null };
  vi.clearAllMocks();
});

it("retains the submitted form during session updates and navigates once to the active workspace projects", async () => {
  let finish!: (value: unknown) => void;
  list.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  signIn.mockImplementation(async () => { state.authenticated = true; return { error: null }; });
  const view = render(<Flow />);
  await userEvent.type(screen.getByLabelText("Email"), "person@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "password123");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  view.rerender(<Flow />);
  expect(screen.getByLabelText("Email")).toHaveValue("person@example.com");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  await act(async () => finish({ data: [{ id: "first", slug: "first" }, { id: "chosen", slug: "chosen" }] }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Chosen projects" })).toBeVisible());
  expect(screen.queryByText("Intermediate redirect")).toBeNull();
});
