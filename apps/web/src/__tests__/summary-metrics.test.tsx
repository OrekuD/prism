import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSummary } from "@/routes/projects/project/summary";

vi.mock("@/utils/axiosInstance", () => ({
  axiosInstance: { get: vi.fn() },
}));

import { axiosInstance } from "@/utils/axiosInstance";

const getMock = axiosInstance.get as unknown as ReturnType<typeof vi.fn>;

let queryClient: QueryClient;

const projectDetail = {
  id: "proj_1",
  name: "Alpha",
  slug: "alpha",
  organizationId: "org_1",
  analytics: {
    summary: [],
    device: { desktop: 7, mobile: 5 },
  },
};

function metricFact(metricId: string, value: number | null) {
  return {
    id: metricId,
    metricId,
    definitionVersion: 1,
    label: metricId,
    value,
    formattedValue: value === null ? "—" : String(value),
    unit: null,
    comparison: null,
    queryContext: {
      from: 1,
      to: 2,
      compareFrom: 0,
      compareTo: 1,
      asOf: 2,
      timezone: "UTC",
      sourceScope: "all",
      sourceIds: [],
      definitionVersion: 1,
    },
    coverage: {
      sourcesConfigured: 1,
      sourcesActive: 1,
      enrichments: [],
      warnings: [],
    },
    coverageNote: "",
    filters: {},
    drilldown: { destination: "events", label: "Open Events" },
  };
}

function renderSummary() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace/wrk/projects/alpha"]}>
        <Routes>
          <Route
            path="/workspace/:wrkSlug/projects/:slug"
            element={<ProjectSummary />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectSummary canonical metrics", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    getMock.mockReset();
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/metrics")) {
        return {
          data: {
            queryContext: {
              from: 1,
              to: 2,
              compareFrom: 0,
              compareTo: 1,
              asOf: 2,
              timezone: "UTC",
              sourceIds: [],
              definitionVersion: 1,
            },
            queryContextToken: "opaque-token",
            facts: [
              metricFact("project.accepted_events", 16),
              metricFact("errors.unresolved_issues", 3),
              metricFact("errors.occurrences", 11),
            ],
          },
        };
      }
      return { data: projectDetail, status: 200 };
    });
  });

  it("renders the canonical event total and error health", async () => {
    renderSummary();
    await waitFor(() =>
      expect(
        getMock.mock.calls.some((call) => String(call[0]).includes("/metrics")),
      ).toBe(true),
    );
    // one bounded metrics request, not paginated events + issue pages
    const metricsCalls = getMock.mock.calls.filter((call) =>
      String(call[0]).includes("/metrics"),
    );
    expect(metricsCalls).toHaveLength(1);
    expect(metricsCalls[0]?.[1]).toMatchObject({
      params: {
        ids: expect.stringContaining("project.accepted_events"),
        range: "7d",
      },
    });
    expect(await screen.findByText("16")).toBeDefined();
    expect(await screen.findByText("11")).toBeDefined();
    // sessions still come from the project aggregate (7 + 5)
    expect(await screen.findByText("12")).toBeDefined();
  });

  it("renders a setup state instead of fabricated zeros", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/metrics")) {
        return {
          data: {
            queryContext: {
              from: 1,
              to: 2,
              compareFrom: 0,
              compareTo: 1,
              asOf: 2,
              timezone: "UTC",
              sourceIds: [],
              definitionVersion: 1,
            },
            queryContextToken: "opaque-token",
            facts: [
              metricFact("project.accepted_events", 16),
              metricFact("errors.unresolved_issues", null),
              metricFact("errors.occurrences", null),
            ],
          },
        };
      }
      return { data: projectDetail, status: 200 };
    });
    renderSummary();
    await screen.findByText(/error collection is not configured/i);
    // no zero-valued error cells beside the setup note
    expect(screen.queryByText("Unresolved")).toBeNull();
  });

  it("renders unavailable cells, never zeros, when the request fails", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/metrics")) {
        throw new Error("network failure");
      }
      return { data: projectDetail, status: 200 };
    });
    renderSummary();
    await screen.findByText(/could not load canonical metrics/i);
    // the Events cell is explicitly unavailable — not a synthesized zero
    expect(await screen.findByLabelText("Events unavailable")).toBeDefined();
  });

  it("renders a server-returned zero as zero", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/metrics")) {
        return {
          data: {
            queryContext: {
              from: 1,
              to: 2,
              compareFrom: 0,
              compareTo: 1,
              asOf: 2,
              timezone: "UTC",
              sourceIds: [],
              definitionVersion: 1,
            },
            queryContextToken: "opaque-token",
            facts: [
              metricFact("project.accepted_events", 0),
              metricFact("errors.unresolved_issues", 0),
              metricFact("errors.occurrences", 0),
            ],
          },
        };
      }
      return { data: projectDetail, status: 200 };
    });
    renderSummary();
    // successful zeros render; the unavailable marker stays absent
    await waitFor(() => {
      expect(screen.queryByLabelText("Events unavailable")).toBeNull();
    });
    expect(screen.queryByText("Unresolved")).toBeDefined();
  });
});
