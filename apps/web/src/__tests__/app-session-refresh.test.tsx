import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "@/App";

const session = vi.hoisted(() => ({ isPending: true }));
vi.mock("@/lib/authClient", () => ({ authClient: { useSession: () => ({ data: null, isPending: session.isPending }) } }));
vi.mock("@/hooks/useRefreshUser", () => ({ useRefreshUser: () => undefined }));
vi.mock("@tanstack/react-query-persist-client", () => ({ persistQueryClient: vi.fn() }));
vi.mock("react-router-dom", async importOriginal => ({
  ...await importOriginal<typeof import("react-router-dom")>(),
  RouterProvider: () => <input aria-label="Mounted route state" />,
}));

it("blocks only initial session loading, preserving mounted routes during later refreshes", async () => {
  const view = render(<App />);
  expect(screen.queryByLabelText("Mounted route state")).toBeNull();
  session.isPending = false;
  view.rerender(<App />);
  await userEvent.type(screen.getByLabelText("Mounted route state"), "entered credentials");
  session.isPending = true;
  view.rerender(<App />);
  expect(screen.getByLabelText("Mounted route state")).toHaveValue("entered credentials");
  session.isPending = false;
  view.rerender(<App />);
  expect(screen.getByLabelText("Mounted route state")).toHaveValue("entered credentials");
});
