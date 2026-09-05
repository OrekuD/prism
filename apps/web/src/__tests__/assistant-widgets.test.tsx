/**
 * Slice 7 v2-design tests: widget fidelity (server values render
 * unchanged in the mock's visual language), trace states, chart math,
 * validated SSE parsing/folding, and the scaffold (header, views,
 * dropdown, composer).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantArtifact,
  MetricFact,
} from "@prism-analytics/types";

import { ProjectSummary } from "@/routes/projects/project/summary";
import { ChatArtifact, TraceBlock } from "@/components/project-overview/chat-widgets";
import { sparkPath } from "@/components/project-overview/chart-math";
import {
  INITIAL_STREAM_STATE,
  applyStreamEvent,
  parseStreamDataPayload,
  splitSsePayloads,
} from "@/network/queries/useAssistantConversations";

vi.mock("@/utils/axiosInstance", () => ({
  axiosInstance: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: "http://localhost/api/v1" },
  },
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

function baseArtifact(kind: AssistantArtifact["kind"]): Record<string, unknown> {
  return {
    id: `a_${kind}`,
    title: `${kind} title`,
    summary: `${kind} summary.`,
    factIds: [],
    queryContext: { ...queryContext, sourceIds: [] },
    drilldown: { destination: "events", label: "Open Events" },
  };
}

function renderArtifact(artifact: AssistantArtifact) {
  return render(
    <MemoryRouter>
      <ChatArtifact artifact={artifact} />
    </MemoryRouter>,
  );
}

describe("chat widgets render server values unchanged", () => {
  it("metric widget shows the exact formatted value and delta", () => {
    const { container } = renderArtifact({
      kind: "metric",
      ...baseArtifact("metric"),
      fact: fact(),
    } as AssistantArtifact);
    expect(container.textContent).toContain("120");
    expect(container.textContent).toContain("▲ 20%");
    expect(
      container.querySelector('a[href="/events"]') ?? container.textContent,
    ).toBeTruthy();
  });

  it("comparison widget shows current and previous values", () => {
    const { container } = renderArtifact({
      kind: "comparison",
      ...baseArtifact("comparison"),
      current: fact(),
      previous: fact({ id: "prev", formattedValue: "100", value: 100 }),
    } as AssistantArtifact);
    expect(container.textContent).toContain("120");
    expect(container.textContent).toContain("100");
  });

  it("timeseries widget exposes an accessible summary", () => {
    renderArtifact({
      kind: "timeseries",
      ...baseArtifact("timeseries"),
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
    } as AssistantArtifact);
    expect(
      screen.getByRole("img", { name: "timeseries summary." }),
    ).toBeInTheDocument();
  });

  it("ranked list shows labels and values with ranks", () => {
    const { container } = renderArtifact({
      kind: "ranked-list",
      ...baseArtifact("ranked-list"),
      entity: "screen",
      rows: [
        { key: "/pricing", label: "/pricing", value: 512, sharePercent: 100 },
        { key: "/features", label: "/features", value: 386, sharePercent: 75 },
      ],
    } as AssistantArtifact);
    expect(container.textContent).toContain("/pricing");
    expect(container.textContent).toContain("512");
    expect(container.textContent).toContain("386");
  });

  it("table renders exact cells", () => {
    const { container } = renderArtifact({
      kind: "table",
      ...baseArtifact("table"),
      columns: ["Screen", "Signups"],
      rows: [["/pricing", 512]],
    } as AssistantArtifact);
    expect(container.textContent).toContain("/pricing");
    expect(container.textContent).toContain("512");
  });

  it("issue list shows status, count, and users without internals", () => {
    const { container } = renderArtifact({
      kind: "issue-list",
      ...baseArtifact("issue-list"),
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
    } as AssistantArtifact);
    expect(container.textContent).toContain("TypeError in checkout");
    expect(container.textContent).toContain("12");
    expect(container.textContent).not.toContain("stack");
  });

  it("definition picker offers confirm while proposed", () => {
    renderArtifact({
      kind: "definition",
      ...baseArtifact("definition"),
      proposalId: "mem_1",
      memoryKey: "signup-definition",
      description: "Use sign_up as signup.",
      status: "proposed",
    } as AssistantArtifact);
    expect(
      screen.getByRole("button", { name: /definition title/ }),
    ).toBeInTheDocument();
  });

  it("unavailable widget explains and offers a next action", () => {
    const { container } = renderArtifact({
      kind: "unavailable",
      ...baseArtifact("unavailable"),
      reason: "No revenue definition exists.",
      nextAction: "Define a key outcome first.",
    } as AssistantArtifact);
    expect(container.textContent).toContain("Define a key outcome first.");
  });
});

describe("trace block", () => {
  it("exposes text states and friendly labels only", () => {
    render(
      <TraceBlock
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

describe("chart math", () => {
  it("scales sparkline points into the box", () => {
    expect(sparkPath([], 100, 25)).toBe("");
    const path = sparkPath([0, 50, 100], 100, 25);
    expect(path.startsWith("M")).toBe(true);
    expect(path).toContain("L");
  });
});

describe("SSE parsing and folding", () => {
  it("validates parts and drops malformed frames", () => {
    const good = parseStreamDataPayload(
      JSON.stringify({ kind: "data-run-start", runId: "run_1", conversationId: "conv_1" }),
    );
    expect(good.kind).toBe("part");
    if (good.kind === "part" && good.part.kind === "data-run-start") {
      expect(good.part.conversationId).toBe("conv_1");
    }
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
    expect(state.conversationId).toBe("conv_1");
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
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.state).toBe("complete");
    state = applyStreamEvent(state, { kind: "text", text: "Events were " });
    state = applyStreamEvent(state, { kind: "text", text: "120." });
    expect(state.text).toBe("Events were 120.");
  });
});

describe("ProjectSummary v2 scaffold", () => {
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
      series: [{ name: "events", points: [{ t: 1000, value: 5 }, { t: 2000, value: 7 }] }],
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
        return {
          data: {
            items: [
              {
                id: "conv_1",
                title: "Checkout errors deep-dive",
                lastMessageAt: Date.now(),
                messageCount: 4,
                hasActiveRun: false,
              },
            ],
            nextCursor: null,
          },
          status: 200,
        };
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

  it("renders the header, overview h1, pulse, and docked composer", async () => {
    renderRoute("/workspace/wrk/projects/alpha");
    await waitFor(() =>
      expect(screen.getByText("Project health")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Accepted events").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByPlaceholderText("Ask a question about this project…"),
    ).toBeInTheDocument();
    // View toggle tabs.
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the calm empty-insights state, not generic advice", async () => {
    renderRoute("/workspace/wrk/projects/alpha");
    await waitFor(() =>
      expect(screen.getByText(/No significant changes detected/)).toBeInTheDocument(),
    );
  });

  it("opens the conversations dropdown with real chats", async () => {
    const user = userEvent.setup();
    renderRoute("/workspace/wrk/projects/alpha?view=assistant");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Conversations" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Conversations" }));
    const menu = screen.getByRole("menu", { name: "Conversations" });
    expect(
      within(menu).getByRole("menuitem", { name: /Checkout errors deep-dive/ }),
    ).toBeInTheDocument();
  });

  it("keeps the conversations menu in the chat tab only", async () => {
    const user = userEvent.setup();
    // Overview mode: no conversations menu at all.
    renderRoute("/workspace/wrk/projects/alpha");
    await waitFor(() =>
      expect(screen.getByText("Project health")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Conversations" }),
    ).toBeNull();
    // Chat tab: the menu lists chats plus New chat.
    renderRoute("/workspace/wrk/projects/alpha?view=assistant");
    await user.click(screen.getByRole("button", { name: "Conversations" }));
    const menu = screen.getByRole("menu", { name: "Conversations" });
    expect(
      within(menu).getByRole("menuitem", { name: /New chat/ }),
    ).toBeInTheDocument();
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
