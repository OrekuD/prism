import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateSourceDialog } from "@/components/sources/create-source-dialog";

const mock = vi.hoisted(() => ({ post: vi.fn(), copy: vi.fn() }));
vi.mock("@/utils/axiosInstance", () => ({
  axiosInstance: { post: mock.post },
}));
vi.mock("@/lib/workspace", () => ({
  useActiveMember: () => ({ data: { role: "owner" } }),
  CREATABLE_PLATFORMS: ["web", "mobile", "server"],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("create source key handoff", () => {
  it("shows and copies the initial server key once, without caching it in the list", async () => {
    const initialKey = "ssk_test_only_not_a_real_secret";
    mock.post.mockResolvedValue({
      data: {
        id: "source",
        name: "Backend",
        platform: "server",
        keys: [],
        initialKey,
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mock.copy.mockResolvedValue(undefined) },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["sources", "project"], []);
    render(
      <QueryClientProvider client={client}>
        <CreateSourceDialog slug="project" initialPlatform="server" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    fireEvent.change(screen.getByPlaceholderText("Marketing site"), {
      target: { value: "Backend" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create" }),
    );
    expect(await screen.findByText(initialKey)).toBeTruthy();
    expect(mock.post).toHaveBeenCalledWith("/projects/project/sources", {
      name: "Backend",
      platform: "server",
    });
    expect(
      JSON.stringify(client.getQueryData(["sources", "project"])),
    ).not.toContain(initialKey);
    fireEvent.click(screen.getByText("Copy", { selector: "button" }));
    await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(initialKey));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    expect(screen.queryByText(initialKey)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create" }),
    ).toBeTruthy();
    client.clear();
  });
  it("keeps the form open when creation fails", async () => {
    mock.post.mockRejectedValue(new Error("offline"));
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <CreateSourceDialog slug="project" initialPlatform="server" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /New source/ }));
    fireEvent.change(screen.getByPlaceholderText("Marketing site"), {
      target: { value: "Backend" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByDisplayValue("Backend")).toBeTruthy();
    client.clear();
  });
});
