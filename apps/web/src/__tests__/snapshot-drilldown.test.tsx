import { ProjectEvents } from "@/routes/projects/project/events";
import { ProjectMobileAnalytics } from "@/routes/projects/project/mobile-analytics";
import { ProjectWebAnalytics } from "@/routes/projects/project/web-analytics";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventCalls: Array<{ slug: string | undefined; params: Record<string, unknown> }> = [];
const webCalls: Array<Record<string, unknown>> = [];
const mobileCalls: Array<Record<string, unknown>> = [];

const hookState = {
  eventsError: false,
  webError: false,
  mobileError: false,
};

vi.mock("@/network/queries/useProjectEventsQuery", () => ({
  useProjectEventsQuery: (slug: string | undefined, params: Record<string, unknown>) => {
    eventCalls.push({ slug, params });
    if (hookState.eventsError) {
      return { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() };
    }
    return {
      data: { events: [], nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/network/queries/useWebAnalyticsQuery", () => ({
  useWebAnalyticsQuery: (params: Record<string, unknown>) => {
    webCalls.push({ ...params });
    if (hookState.webError) {
      return { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

vi.mock("@/network/queries/useMobileAnalyticsQuery", () => ({
  useMobileAnalyticsQuery: (params: Record<string, unknown>) => {
    mobileCalls.push({ ...params });
    if (hookState.mobileError) {
      return { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    }
    return { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));

vi.mock("@/network/queries/useSourcesQuery", () => ({
  useSourcesQuery: () => ({
    data: [
      { id: "src_web_1", name: "Web", platform: "web", allowedOrigins: [] },
      { id: "src_other", name: "Other", platform: "web", allowedOrigins: [] },
    ],
    isLoading: false,
  }),
}));

function renderAt(path: string, route: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const EVENTS_ROUTE = "/workspace/:wrkSlug/projects/:slug/events";
const WEB_ROUTE = "/workspace/:wrkSlug/projects/:slug/web-analytics";
const MOBILE_ROUTE = "/workspace/:wrkSlug/projects/:slug/mobile-analytics";

beforeEach(() => {
  eventCalls.length = 0;
  webCalls.length = 0;
  mobileCalls.length = 0;
  hookState.eventsError = false;
  hookState.webError = false;
  hookState.mobileError = false;
  vi.useRealTimers();
});

describe("snapshot drill-down routing (R6-F1)", () => {
  it("passes ctx to the Events API without local source filters", () => {
    renderAt("/workspace/w/projects/alpha/events?ctx=tok123", EVENTS_ROUTE, <ProjectEvents />);
    expect(eventCalls.length).toBeGreaterThan(0);
    const params = eventCalls[eventCalls.length - 1]?.params ?? {};
    expect(params.ctx).toBe("tok123");
    expect(params.sourceId).toBeUndefined();
    expect(params.platformFamily).toBeUndefined();
    expect(screen.getByText(/shared snapshot/)).toBeTruthy();
  });

  it("keeps an empty-scope token on Events when local filters look unfiltered", () => {
    // selected + [] shares `sourceIds: []` with all-sources on the wire;
    // only the signed token preserves the distinction (R4-F1/R5-F1).
    renderAt("/workspace/w/projects/alpha/events?ctx=emptytok", EVENTS_ROUTE, <ProjectEvents />);
    const params = eventCalls[eventCalls.length - 1]?.params ?? {};
    expect(params.ctx).toBe("emptytok");
    expect(params.sourceId).toBeUndefined();
  });

  it("ignores hostile URL source params while a snapshot token is present", () => {
    renderAt(
      "/workspace/w/projects/alpha/events?ctx=tok123&source=src_other&scope=selected",
      EVENTS_ROUTE,
      <ProjectEvents />,
    );
    const params = eventCalls[eventCalls.length - 1]?.params ?? {};
    expect(params.ctx).toBe("tok123");
    expect(params.sourceId).toBeUndefined();
  });

  it("clears ctx when the Events search filter changes", () => {
    vi.useFakeTimers();
    renderAt("/workspace/w/projects/alpha/events?ctx=tok123", EVENTS_ROUTE, <ProjectEvents />);
    const input = screen.getByLabelText("Search events");
    fireEvent.change(input, { target: { value: "click" } });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const params = eventCalls[eventCalls.length - 1]?.params ?? {};
    expect(params.ctx).toBeUndefined();
    expect(params.q).toBe("click");
    vi.useRealTimers();
  });

  it("exits snapshot mode from the Events banner", () => {
    renderAt("/workspace/w/projects/alpha/events?ctx=tok123", EVENTS_ROUTE, <ProjectEvents />);
    fireEvent.click(screen.getByRole("button", { name: "Exit snapshot" }));
    const params = eventCalls[eventCalls.length - 1]?.params ?? {};
    expect(params.ctx).toBeUndefined();
  });

  it("shows an error instead of data for an invalid Events token", () => {
    hookState.eventsError = true;
    renderAt("/workspace/w/projects/alpha/events?ctx=bad", EVENTS_ROUTE, <ProjectEvents />);
    expect(screen.getByText("Could not load events")).toBeTruthy();
  });

  it("passes ctx to Web analytics once, disabling the previous-period request", () => {
    renderAt(
      "/workspace/w/projects/alpha/web-analytics?ctx=tok123&range=7d",
      WEB_ROUTE,
      <ProjectWebAnalytics />,
    );
    const scoped = webCalls.filter((call) => call.ctx === "tok123");
    // One snapshot request; the separate previous-period request must not
    // reuse the token as both current and previous (R6-F1).
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.sourceIds).toBeUndefined();
    expect(screen.getByText(/shared snapshot/)).toBeTruthy();
  });

  it("exits snapshot mode from the Web banner", () => {
    renderAt(
      "/workspace/w/projects/alpha/web-analytics?ctx=tok123",
      WEB_ROUTE,
      <ProjectWebAnalytics />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Exit snapshot" }));
    const last = webCalls[webCalls.length - 1] ?? {};
    expect(last.ctx ?? null).toBeNull();
  });

  it("shows an error instead of data for an invalid Web token", () => {
    hookState.webError = true;
    renderAt(
      "/workspace/w/projects/alpha/web-analytics?ctx=bad",
      WEB_ROUTE,
      <ProjectWebAnalytics />,
    );
    expect(screen.getByText("Could not load web analytics")).toBeTruthy();
  });

  it("passes ctx to Mobile analytics and exits from the banner", () => {
    renderAt(
      "/workspace/w/projects/alpha/mobile-analytics?ctx=tok123",
      MOBILE_ROUTE,
      <ProjectMobileAnalytics />,
    );
    const last = mobileCalls[mobileCalls.length - 1] ?? {};
    expect(last.ctx).toBe("tok123");
    fireEvent.click(screen.getByRole("button", { name: "Exit snapshot" }));
    const after = mobileCalls[mobileCalls.length - 1] ?? {};
    expect(after.ctx ?? null).toBeNull();
  });

  it("shows an error instead of data for an invalid Mobile token", () => {
    hookState.mobileError = true;
    renderAt(
      "/workspace/w/projects/alpha/mobile-analytics?ctx=bad",
      MOBILE_ROUTE,
      <ProjectMobileAnalytics />,
    );
    expect(screen.getByText("Failed to load mobile analytics.")).toBeTruthy();
  });
});
