import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectPeople } from "@/routes/projects/project/people";
import { PersonDetail } from "@/routes/projects/project/person";
import axe from "axe-core";

vi.mock("@/utils/axiosInstance", () => ({
  axiosInstance: {
    get: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
import { axiosInstance } from "@/utils/axiosInstance";

const getMock = axiosInstance.get as unknown as ReturnType<typeof vi.fn>;
const deleteMock = axiosInstance.delete as unknown as ReturnType<typeof vi.fn>;

/**
 * People dashboard (task-10 §8): keyboard access, visible focus, screen-
 * reader labels, redaction by default, destructive-confirmation, and
 * empty/error states — through the design system components.
 */

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  getMock.mockReset();
  deleteMock.mockReset();
  getMock.mockImplementation(async () => ({ data: {} }));
});

function renderPeople() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/alpha/people"]}>
        <Routes>
          <Route path="/projects/:slug/people" element={<ProjectPeople />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectPeople", () => {
  it("labels the search input for screen readers and explains the exact-match limitation", async () => {
    renderPeople();
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
    const search = screen.getByLabelText(/exact external id/i);
    expect(search).toBeDefined();
    expect(screen.getByText(/broad enumeration is intentionally not supported/i)).toBeDefined();
  });

  it("renders people with redacted trait values by default", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/totals")) {
        return {
          data: { events: 10, people: 1, anonymousIdentities: 1, sessions: 2 },
        };
      }
      return {
        data: {
          people: [
            {
              personId: "u_1234567890abcdef",
              firstSeenAt: 1,
              lastSeenAt: Date.now(),
              traits: { plan: "pro", email: "person@example.com" },
              identityCount: 2,
              sessionCount: 2,
              eventCount: 10,
            },
          ],
          nextCursor: null,
        },
      };
    });
    renderPeople();
    await waitFor(() => expect(screen.getByText("People")).toBeDefined());
    expect(await screen.findByText("u_1234567890…")).toBeDefined();
    // trait VALUES are redacted — only keys are visible
    expect(screen.queryByText("person@example.com")).toBeNull();
    expect(screen.getByText(/plan/)).toBeDefined();
    // deliberate disclosure exists
    const reveal = screen.getByRole("button", { name: /reveal trait values/i });
    expect(reveal).toBeDefined();
    reveal.click();
    expect(await screen.findByText(/person@example.com/)).toBeDefined();
  });

  it("renders the honest totals strip", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/totals")) {
        return {
          data: { events: 10, people: 1, anonymousIdentities: 1, sessions: 2 },
        };
      }
      return { data: { people: [], nextCursor: null } };
    });
    renderPeople();
    expect(await screen.findByText(/1 people · 1 anonymous identities · 2 sessions · 10 events/)).toBeDefined();
  });

  it("renders the empty state with honest copy", async () => {
    getMock.mockImplementation(async () => ({ data: { people: [], nextCursor: null } }));
    renderPeople();
    expect(await screen.findByText("No people yet")).toBeDefined();
    expect(screen.getByText(/calls identify\(\)/)).toBeDefined();
  });
});

describe("PersonDetail", () => {
  it("requires typing 'delete' exactly before the destructive action enables", async () => {
    getMock.mockImplementation(async () => ({
      data: {
        personId: "u_1234567890abcdef",
        firstSeenAt: 1,
        lastSeenAt: Date.now(),
        traits: { plan: "pro" },
        identityCount: 1,
        sessionCount: 0,
        eventCount: 0,
        externalIds: ["user-1"],
        anonymousIds: [],
      },
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects/alpha/people/u_1234"]}>
          <Routes>
            <Route path="/projects/:slug/people/:personId" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const confirm = await screen.findByLabelText(/Type delete to confirm/i);
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

  it("redacts trait values until deliberate disclosure", async () => {
    getMock.mockImplementation(async () => ({
      data: {
        personId: "u_1234567890abcdef",
        firstSeenAt: 1,
        lastSeenAt: Date.now(),
        traits: { email: "person@example.com" },
        identityCount: 0,
        sessionCount: 0,
        eventCount: 0,
        externalIds: [],
        anonymousIds: [],
      },
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects/alpha/people/u_1234"]}>
          <Routes>
            <Route path="/projects/:slug/people/:personId" element={<PersonDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Current traits");
    // REDACTED by default — the value is never rendered until disclosure
    expect(screen.queryByText("person@example.com")).toBeNull();
    const reveal = screen.getByRole("button", { name: /reveal trait values/i });
    expect(reveal).toBeDefined();
    reveal.click();
    expect(await screen.findByText(/person@example.com/)).toBeDefined();
  });

  it("has no axe violations on the people list", async () => {
    getMock.mockImplementation(async () => ({
      data: { people: [], nextCursor: null },
    }));
    const { container } = renderPeople();
    await screen.findByText("No people yet");
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});
