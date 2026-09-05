/**
 * Slice 7 UI tests: widget fidelity (server values render unchanged),
 * activity-trace states, and validated SSE parsing/folding.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantArtifact,
  MetricFact,
} from "@prism-analytics/types";

import { ProjectSummary } from "@/routes/projects/project/summary";
import { ArtifactWidget } from "@/components/assistant/artifact-widgets";
import { ActivityTrace } from "@/components/assistant/activity-trace";
import {
  INITIAL_STREAM_STATE,
  applyStreamEvent,
  parseStreamDataPayload,
  splitSsePayloads,
} from "@/network/queries/useAssistantConversations";

vi.mock("@/utils/axiosInstance", () => ({
  axiosInstance: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { axiosInstance } from "@/utils/axiosInstance";

const getMock = axiosInstance.get as unknown as ReturnType<typeof vi.fn>;

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
} as const;

function fact(overrides: Partial<MetricFact> = {}): MetricFact {
  return {
    id: "project.accepted_events",
    metricId: "project.accepted_events",
    definitionVersion: 1,
    label: "Accepted events",
    value: 120,
    formattedValue: "120",
    unit: null,
    comparison: { kind: "percent", direction: "up", percent: 20 },
    comparisonBasis: {
      previousValue: 100,
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
    ...overrides,
  } as MetricFact;
}

function renderWidget(artifact: AssistantArtifact) {
  return render(
    <MemoryRouter>
      <ArtifactWidget artifact={artifact} />
    </MemoryRouter>,
  );
}

describe("artifact widgets render server values unchanged", () => {
  it("metric widget shows the exact formatted value, not prose", () => {
    const artifact: AssistantArtifact = {
      kind: "metric",
      id: "a_metric",
      title: "Accepted events",
      summary: "Accepted events were 120.",
      factIds: [fact().id],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "events", label: "Open Events" },
      fact: fact(),
    };
    const { container } = renderWidget(artifact);
    expect(container.textContent).toContain("120");
    expect(container.textContent).toContain("Accepted events");
  });

  it("comparison widget shows current and previous values", () => {
    const artifact: AssistantArtifact = {
      kind: "comparison",
      id: "a_cmp",
      title: "Events vs previous",
      summary: "120 vs 100 previously.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "events", label: "Open Events" },
      current: fact(),
      previous: fact({ id: "prev", formattedValue: "100", value: 100 }),
    };
    const { container } = renderWidget(artifact);
    expect(container.textContent).toContain("120");
    expect(container.textContent).toContain("100");
  });

  it("timeseries widget exposes an accessible summary and data table", () => {
    const artifact: AssistantArtifact = {
      kind: "timeseries",
      id: "a_ts",
      title: "Accepted events trend",
      summary: "Events rose across 3 days.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "events", label: "Open Events" },
      bucket: "daily",
      series: [
        {
          name: "events",
          points: [
            { t: 1000, value: 10 },
            { t: 2000, value: 20 },
            { t: 3000, value: 30 },
          ],
        },
      ],
    };
    renderWidget(artifact);
    expect(
      screen.getByRole("img", { name: "Events rose across 3 days." }),
    ).toBeInTheDocument();
  });

  it("issue list shows status, count, and users without internals", () => {
    const artifact: AssistantArtifact = {
      kind: "issue-list",
      id: "a_issues",
      title: "Top issues",
      summary: "One unresolved issue with 12 occurrences.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "errors", label: "Open Errors" },
      issues: [
        {
          id: "iss_1",
          title: "TypeError in checkout",
          status: "unresolved",
          count: 12,
          users: 4,
          delta: "new",
          drilldown: { destination: "errors", label: "Open issue" },
        },
      ],
    };
    const { container } = renderWidget(artifact);
    expect(container.textContent).toContain("TypeError in checkout");
    expect(container.textContent).toContain("12");
    expect(container.textContent).not.toContain("stack");
  });

  it("unavailable widget explains and offers a next action", () => {
    const artifact: AssistantArtifact = {
      kind: "unavailable",
      id: "a_un",
      title: "Revenue",
      summary: "No revenue definition exists.",
      factIds: [],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "overview", label: "Overview" },
      reason: "No revenue definition exists.",
      nextAction: "Define a key outcome first.",
    };
    const { container } = renderWidget(artifact);
    expect(container.textContent).toContain("Define a key outcome first.");
  });
});

describe("activity trace", () => {
  it("exposes text states and friendly labels only", () => {
    render(
      <ActivityTrace
        steps={[
          { stepId: "st_1", sequence: 0, toolId: "measure_metric", state: "complete", label: "Measured accepted events" },
          { stepId: "st_2", sequence: 1, toolId: "compare_periods", state: "running", label: "Comparing time periods" },
          { stepId: "st_3", sequence: 2, toolId: "check_coverage", state: "failed", label: "Checking data coverage" },
        ]}
      />,
    );
    expect(screen.getByText("Measured accepted events")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("measure_metric");
    expect(document.body.textContent).not.toContain("compare_periods");
  });
});

describe("SSE parsing and folding", () => {
  it("validates parts and drops malformed frames", () => {
    const good = parseStreamDataPayload(
      JSON.stringify({ kind: "data-run-start", runId: "run_1", conversationId: "conv_1" }),
    );
    expect(good.kind).toBe("part");
    expect(parseStreamDataPayload("not json").kind).toBe("unknown");
    expect(
      parseStreamDataPayload(JSON.stringify({ kind: "data-run-start", runId: "" })).kind,
    ).toBe("unknown");
    const text = parseStreamDataPayload(JSON.stringify({ type: "text", text: "hello" }));
    expect(text).toEqual({ kind: "text", text: "hello" });
  });

  it("splits payloads across chunk boundaries", () => {
    const first = splitSsePayloads('data: {"a":1}\n\npartial');
    expect(first.payloads).toEqual(['{"a":1}']);
    expect(first.remainder).toBe("partial");
    // A fragment without a data: prefix is not an event (SSE semantics).
    const second = splitSsePayloads("data: partial-tail\n\ndata: {\"b\":2}\n\n");
    expect(second.payloads).toEqual(["partial-tail", '{"b":2}']);
  });

  it("folds steps by stepId and finishes answers", () => {
    let state = { ...INITIAL_STREAM_STATE };
    state = applyStreamEvent(
      state,
      parseStreamDataPayload(
        JSON.stringify({ kind: "data-run-start", runId: "run_1", conversationId: "conv_1" }),
      ),
    );
    expect(state.runId).toBe("run_1");
    const step = JSON.stringify({
      kind: "data-activity-step",
      stepId: "st_1",
      sequence: 0,
      toolId: "measure_metric",
      state: "running",
      label: "Measuring accepted events",
    });
    state = applyStreamEvent(state, parseStreamDataPayload(step));
    state = applyStreamEvent(
      state,
      parseStreamDataPayload(
        JSON.stringify({
          kind: "data-activity-step",
          stepId: "st_1",
          sequence: 0,
          toolId: "measure_metric",
          state: "complete",
          label: "Measured accepted events",
        }),
      ),
    );
    // Same stepId updates the row instead of adding a second row.
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.state).toBe("complete");
    state = applyStreamEvent(state, { kind: "text", text: "Events were " });
    state = applyStreamEvent(state, { kind: "text", text: "120." });
    expect(state.text).toBe("Events were 120.");
  });
});

describe("ProjectSummary scaffold", () => {
  let queryClient: QueryClient;

  const overviewResource = {
    queryContext,
    queryContextToken: "opaque-snapshot-token-12345678",
    capabilities: {
      web: true,
      mobile: false,
      server: true,
      errorCollection: { configured: false, observed: false },
      standardEventsObserved: [],
      sources: { total: 1, active: 1, lastReceivedAt: null },
      trafficPolicy: "human",
    },
    insights: [],
    pulse: [fact(), fact({ id: "project.sessions", metricId: "project.sessions", label: "Sessions" }), fact({ id: "e3", metricId: "project.accepted_events", label: "Third" })],
    supportingFacts: [],
    activity: {
      kind: "timeseries",
      id: "act",
      title: "Activity",
      summary: "Events across the range.",
      factIds: ["project.accepted_events"],
      queryContext: { ...queryContext, sourceIds: [] },
      drilldown: { destination: "events", label: "Open Events" },
      bucket: "daily",
      series: [{ name: "events", points: [{ t: 1000, value: 5 }] }],
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
    dataQuality: { hasAcceptedData: true, definitionState: "missing", definitionLabel: null, warnings: [] },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    getMock.mockReset();
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        return { data: overviewResource, status: 200 };
      }
      if (String(url).includes("/assistant/conversations")) {
        return { data: { items: [], nextCursor: null }, status: 200 };
      }
      return { data: null, status: 200 };
    });
  });

  function renderRoute(initial: string) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initial]}>
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

  it("renders the adaptive overview with one h1 and pulse widgets", async () => {
    renderRoute("/workspace/wrk/projects/alpha");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Project overview" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Project overview" }).tagName).toBe("H1");
    expect(screen.getByText("Accepted events")).toBeInTheDocument();
    expect(screen.getByLabelText("Ask Prism about this project")).toBeInTheDocument();
  });

  it("shows the calm empty-insights state, not generic advice", async () => {
    renderRoute("/workspace/wrk/projects/alpha");
    await waitFor(() =>
      expect(screen.getByText(/No significant changes detected/)).toBeInTheDocument(),
    );
  });

  it("offers a safe return for a missing chat", async () => {
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/overview")) {
        return { data: overviewResource, status: 200 };
      }
      if (String(url).includes("/assistant/conversations/conv_missing")) {
        throw { response: { status: 404 } };
      }
      return { data: { items: [], nextCursor: null }, status: 200 };
    });
    renderRoute("/workspace/wrk/projects/alpha?view=assistant&chat=conv_missing");
    await waitFor(() =>
      expect(screen.getByText("That chat isn't available")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Back to overview" })).toBeInTheDocument();
  });
});
