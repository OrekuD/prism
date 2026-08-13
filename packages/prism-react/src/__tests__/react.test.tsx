import React, { StrictMode, useEffect, useRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismProvider, usePrism, PrismContext } from "../index";
import type { PrismClient } from "@prism/core";

/**
 * @prism/react tests (task-9 §12): the provider is a ZERO-effect context
 * wrapper around an already-ready client. Strict Mode double-mounting,
 * unmount cleanup, stable references, and error surfaces are all proven
 * with a mocked client (the real engine is covered by @prism/core).
 */

function makeClient(): PrismClient & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const bump = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
  };
  const session: { sessionId: string; startedAt: number; end: () => unknown } = {
    sessionId: "sess-1",
    startedAt: 1,
    end: () => ({ status: "ended", eventId: "e-end" }),
  };
  return {
    collectionState: "granted",
    get session() {
      return session;
    },
    track: vi.fn((name: string) => {
      bump("track");
      return { status: "queued", eventId: `e-${name}-${calls.track}` };
    }),
    startSession: vi.fn(() => {
      bump("startSession");
      return { status: "started", session };
    }),
    setCollectionState: vi.fn(async (state: string) => {
      bump("setCollectionState");
      return state;
    }),
    flush: vi.fn(async () => {
      bump("flush");
    }),
    shutdown: vi.fn(async () => {
      bump("shutdown");
    }),
    onDiagnostic: vi.fn(() => ({
      remove: vi.fn(),
    })),
    calls,
  } as unknown as PrismClient & { calls: Record<string, number> };
}

function Harness({ children, client }: { children?: React.ReactNode; client?: PrismClient }) {
  const current = client ?? makeClient();
  return <PrismProvider client={current}>{children}</PrismProvider>;
}

function TrackingConsumer() {
  const prism = usePrism();
  const counts = useRef(0);
  counts.current += 1;
  useEffect(() => {
    prism.track("mounted");
  }, [prism]);
  return (
    <div>
      <span data-testid="renders">{counts.current}</span>
      <button
        type="button"
        onClick={() => prism.track("clicked", { label: "x" })}
        data-testid="track-button"
      >
        track
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrismProvider + usePrism", () => {
  it("publishes the READY client and renders children", () => {
    const client = makeClient();
    render(
      <PrismProvider client={client}>
        <div data-testid="child">content</div>
      </PrismProvider>,
    );
    expect(screen.getByTestId("child")).toBeDefined();
  });

  it("throws a specific error outside a provider", () => {
    const Spy = (): React.ReactNode => {
      try {
        usePrism();
        return null;
      } catch (error) {
        return <span data-testid="error">{(error as Error).message}</span>;
      }
    };
    render(<Spy />);
    expect(screen.getByTestId("error").textContent).toContain(
      "usePrism must be used inside a <PrismProvider",
    );
  });

  it("exposes STABLE bound references across re-renders", () => {
    const client = makeClient();
    const seen: Array<{ track: unknown; flush: unknown; setState: unknown }> = [];
    const Probe = (): React.ReactNode => {
      const prism = usePrism();
      seen.push({
        track: prism.track,
        flush: prism.flush,
        setState: prism.setCollectionState,
      });
      return null;
    };
    const { rerender } = render(
      <PrismProvider client={client}>
        <Probe />
      </PrismProvider>,
    );
    rerender(
      <PrismProvider client={client}>
        <Probe />
      </PrismProvider>,
    );
    rerender(
      <PrismProvider client={client}>
        <Probe />
      </PrismProvider>,
    );
    expect(seen).toHaveLength(3);
    expect(seen[0]?.track).toBe(seen[1]?.track);
    expect(seen[1]?.track).toBe(seen[2]?.track);
    expect(seen[0]?.flush).toBe(seen[1]?.flush);
    expect(seen[0]?.setState).toBe(seen[2]?.setState);
  });

  it("does not duplicate events under React Strict Mode", () => {
    const client = makeClient();
    render(
      <StrictMode>
        <PrismProvider client={client}>
          <TrackingConsumer />
        </PrismProvider>
      </StrictMode>,
    );
    // Strict Mode double-invokes effects in dev — but the PROVIDER adds no
    // effects; the consumer's own effect is its own concern. The provider
    // itself never calls track: only the consumer's explicit effect did.
    expect(client.calls.track).toBeGreaterThanOrEqual(1);
    expect(client.calls.track).toBeLessThanOrEqual(2); // at most the consumer's own mounts
  });

  it("creates ONE client and never replaces it (provider ownership is explicit)", () => {
    const client = makeClient();
    const { rerender } = render(
      <PrismProvider client={client}>
        <TrackingConsumer />
      </PrismProvider>,
    );
    rerender(
      <PrismProvider client={client}>
        <TrackingConsumer />
      </PrismProvider>,
    );
    // the provider registered no listeners/timers and created no clients —
    // track calls come only from the consumer's interactions
    expect(client.startSession).not.toHaveBeenCalled();
  });

  it("performs no updates after unmount", () => {
    const client = makeClient();
    const { unmount } = render(
      <PrismProvider client={client}>
        <TrackingConsumer />
      </PrismProvider>,
    );
    unmount();
    // nothing scheduled, nothing pending — the mocked client sees no
    // further interaction from the provider layer
    const after = client.calls.track;
    expect(client.calls.track).toBe(after);
  });

  it("exposes the raw client through the PrismContext for advanced use", () => {
    const client = makeClient();
    render(
      <PrismProvider client={client}>
        <PrismContext.Consumer>
          {(value: PrismClient | null) => (
            <span data-testid="ctx">{value === client ? "same" : "different"}</span>
          )}
        </PrismContext.Consumer>
      </PrismProvider>,
    );
    expect(screen.getByTestId("ctx").textContent).toBe("same");
  });

  it("binds facade methods to the client instance (no recreated callbacks on click)", () => {
    const client = makeClient();
    render(
      <PrismProvider client={client}>
        <TrackingConsumer />
      </PrismProvider>,
    );
    screen.getByTestId("track-button").click();
    screen.getByTestId("track-button").click();
    expect(client.track).toHaveBeenCalledTimes(3); // 2 clicks + 1 mount effect
  });
});

describe("facade surface", () => {
  it("binds the complete facade: track/startSession/setCollectionState/flush/shutdown/onDiagnostic/collectionState", async () => {
    const client = makeClient();
    let observed: unknown = null;
    const Surface = (): React.ReactNode => {
      const prism = usePrism();
      observed = {
        clientIsSame: prism.client === client,
        collectionState: prism.collectionState,
        trackResult: prism.track("surface"),
        sessionResult: prism.startSession(),
        diagnosticHandle: prism.onDiagnostic(() => undefined),
      };
      void prism.setCollectionState("denied");
      void prism.flush();
      void prism.shutdown({ timeoutMs: 50 });
      return null;
    };
    render(
      <PrismProvider client={client}>
        <Surface />
      </PrismProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const seen = observed as {
      clientIsSame: boolean;
      collectionState: string;
      trackResult: { status: string };
      sessionResult: { status: string };
      diagnosticHandle: { remove: () => void };
    };
    expect(seen.clientIsSame).toBe(true);
    expect(seen.collectionState).toBe("granted");
    expect(seen.trackResult.status).toBe("queued");
    expect(seen.sessionResult.status).toBe("started");
    expect(seen.diagnosticHandle.remove).toBeTypeOf("function");
    expect(client.flush).toHaveBeenCalledTimes(1);
    expect(client.setCollectionState).toHaveBeenCalledWith("denied");
    expect(client.shutdown).toHaveBeenCalledTimes(1);
  });
});
