/**
 * Project overview accuracy (Task 21 slice 7, supersedes the slice-2
 * metrics-frame tests): the page renders canonical snapshot aggregates
 * from `GET /overview` — never paginated lengths or React-side sums.
 * Unconfigured error health renders a data-quality state, never
 * fabricated zeros; failed reads render unavailable, never zero.
 */
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

const queryContext = {
  from: 1,
  to: 2,
  compareFrom: 0,
  compareTo: 1,
  asOf: 2,
  timezone: "UTC",
  sourceScope: "all",
  sourceIds: [],
  definitionVersion: 1,
};

function metricFact(metricId: string, label: string, value: number | null) {
  return {
    id: metricId,
    metricId,
    definitionVersion: 1,
    label,
    value,
    formattedValue: value === null ? "—" : String(value),
    unit: null,
    comparison: null,
    comparisonBasis: {
      previousValue: null,
      denominatorCurrent: null,
      denominatorPrevious: null,
    },
    queryContext: { ...queryContext, sourceIds: [] },
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

function overviewResource(pulse: Array<ReturnType<typeof metricFact>>) {
  return {
    queryContext,
    queryContextToken: "opaque-snapshot-token-12345678",
    capabilities: {
      web: false,
      mobile: false,
      server: true,
      errorCollection: { configured: false, observed: false },
      standardEventsObserved: [],
      sources: { total: 1, active: 1, lastReceivedAt: null },
      trafficPolicy: "human",
    },
    insights: [],
    pulse,
    supportingFacts: [],
    activity: {
      kind: "empty",
      id: "act",
      title: "Activity",
      summary: "No activity in this range.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "overview", label: "Overview" },
      reason: "No activity in this range.",
    },
    secondary: {
      kind: "empty",
      id: "sec",
      title: "Secondary",
      summary: "Nothing to show.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "overview", label: "Overview" },
      reason: "Nothing to show yet.",
    },
    dataQuality: {
      hasAcceptedData: true,
      definitionState: "missing",
      definitionLabel: null,
      warnings: [],
    },
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

describe("ProjectSummary canonical overview", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    getMock.mockReset();
  });

  it("renders the canonical event total from one bounded overview request", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        return {
          data: overviewResource([

            metricFact("project.accepted_events", "Accepted events", 16),
            metricFact("project.sessions", "Sessions", 12),
            metricFact("project.active_people", "Active people", 11),
          ]),
          status: 200,
        };
      }
      return { data: { items: [], nextCursor: null } };
    });
    renderSummary();
    await waitFor(() =>
      expect(
        getMock.mock.calls.some((call) => String(call[0]).includes("/overview")),
      ).toBe(true),
    );
    const overviewCalls = getMock.mock.calls.filter((call) =>
      String(call[0]).includes("/overview"),
    );
    expect(overviewCalls).toHaveLength(1);
    expect(await screen.findByText("16")).toBeDefined();
    expect(await screen.findByText("11")).toBeDefined();
    expect(await screen.findByText("12")).toBeDefined();
  });

  it("renders a data-quality state instead of fabricated error zeros", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        return {
          data: overviewResource([

            metricFact("project.accepted_events", "Accepted events", 16),
            metricFact("project.sessions", "Sessions", 12),
            metricFact("project.active_people", "Active people", 11),
          ]),
          status: 200,
        };
      }
      return { data: { items: [], nextCursor: null } };
    });
    renderSummary();
    await screen.findByText(/No key outcome is defined yet/);
    // No error pulse is forced into the adaptive slots when error
    // collection is unconfigured.
    expect(screen.queryByText("Unresolved")).toBeNull();
  });

  it("renders unavailable, never zeros, when the request fails", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        throw new Error("network failure");
      }
      return { data: { items: [], nextCursor: null } };
    });
    renderSummary();
    await screen.findByText(/Project overview unavailable/);
    await screen.findByText(/assistant is also paused/);
  });

  it("renders a server-returned zero as zero", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        return {
          data: overviewResource([

            metricFact("project.accepted_events", "Accepted events", 0),
            metricFact("project.sessions", "Sessions", 0),
            metricFact("project.active_people", "Active people", 0),
          ]),
          status: 200,
        };
      }
      return { data: { items: [], nextCursor: null } };
    });
    renderSummary();
    // Successful zeros render; the unavailable alert stays absent.
    await waitFor(() => {
      expect(screen.queryByText(/Project overview unavailable/)).toBeNull();
    });
    const zeros = await screen.findAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });
});
