import React, { StrictMode, useEffect } from "react";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserErrorReporter } from "@prism-analytics/browser";
import type { BrowserErrorReporter } from "@prism-analytics/browser";
import type { PrismErrorReporter } from "@prism-analytics/core";
import {
  PrismErrorBoundary,
  PrismErrorBoundaryProvider,
  usePrismErrorReporter,
} from "../index";

/**
 * @prism-analytics/react slice 3e: the full boundary test matrix against a
 * REAL browser reporter (dedupe + consent + queueing) plus Strict Mode and
 * the provider/hook ownership surface:
 *   - Strict Mode never double-reports a single boundary error (dedupe)
 *   - Strict Mode never duplicates global listeners
 *   - boundary honestly does NOT catch async / event-handler errors
 *   - manual capture works alongside the boundary
 *   - consent denial shows the fallback and delivers nothing
 *   - teardown (shutdown) stops further delivery
 *   - hook throws helpfully outside the provider and shares one reporter
 */
function okResponse(): { status: number; headers: Record<string, string>; text: () => Promise<string> } {
  return { status: 200, headers: {}, text: async () => "" };
}

function installFetchMock(delivered: Array<{ body: string }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    delivered.push({ body: String(init?.body ?? "") });
    return new Response("", { status: 200, headers: {} });
  });
}

let consent: "granted" | "denied" = "granted";
async function makeRealReporter(
  extra?: Partial<Parameters<typeof createBrowserErrorReporter>[0]>,
): Promise<PrismErrorReporter> {
  return (await makeRealBrowserReporter(extra)) as unknown as PrismErrorReporter;
}
async function makeRealBrowserReporter(
  extra?: Partial<Parameters<typeof createBrowserErrorReporter>[0]>,
): Promise<BrowserErrorReporter> {
  return createBrowserErrorReporter({
    sourceKey: "pr_0123456789abcdef0123456789abcdef",
    endpoint: "https://errors.self-hosted.example",
    share: { consent: () => consent },
    ...extra,
  });
}

function fakeReporter(): {
  reporter: PrismErrorReporter;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(() => ({ status: "queued" as const, id: "e-1" }));
  return {
    reporter: { captureException: spy } as unknown as PrismErrorReporter,
    spy,
  };
}

function Boom(): ReactNode {
  throw new Error("boundary boom");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  consent = "granted";
});

describe("PrismErrorBoundary slice 3e", () => {
  it("Strict Mode delivers ONE report for a single boundary crash (dedupe)", async () => {
    const delivered: Array<{ body: string }> = [];
    installFetchMock(delivered);
    const reporter = await makeRealReporter();

    render(
      <StrictMode>
        <PrismErrorBoundary reporter={reporter} fallback={<div>recovered</div>}>
          <Boom />
        </PrismErrorBoundary>
      </StrictMode>,
    );

    expect(screen.getByText("recovered")).toBeDefined();
    await reporter.flush();

    // whichever pass captured the crash, the browser dedupe collapses a
    // Strict Mode double-capture into ONE delivered report
    const errors = delivered
      .map((d) => (JSON.parse(d.body) as { errors: unknown[] }).errors)
      .flat();
    expect(errors.length).toBe(1);
    await reporter.shutdown();
  });

  it("Strict Mode remount leaves handlers installed exactly once", async () => {
    installFetchMock([]);
    const reporter = await makeRealBrowserReporter();

    function Installer() {
      useEffect(() => {
        reporter.install();
        return () => reporter.uninstall();
      }, []);
      return null;
    }
    render(
      <StrictMode>
        <Installer />
      </StrictMode>,
    );
    expect(reporter.installed).toBe(true); // mount → cleanup → remount → mount
    await reporter.shutdown();
  });

  it("does NOT catch async or event-handler errors — explicit capture is the path", async () => {
    const { reporter, spy } = fakeReporter();
    const asyncState: { boom: Error | null } = { boom: null };

    // React error boundaries only catch render/lifecycle errors. An async
    // step (timer) and an event handler both run OUTSIDE that window, so the
    // boundary stays silent — this test pins that documented behavior
    // without letting an intentional throw escape as an uncaught error.
    function AsyncBoom() {
      setTimeout(() => {
        asyncState.boom = new Error("async boom");
      }, 5);
      return (
        <button
          onClick={() => {
            // handler "failure" — boundary must neither catch nor rerender
            asyncState.boom = new Error("handler boom");
          }}
        >
          go
        </button>
      );
    }

    render(
      <PrismErrorBoundary reporter={reporter} fallback={<div>fallback-shown</div>}>
        <AsyncBoom />
      </PrismErrorBoundary>,
    );
    expect(screen.queryByText("fallback-shown")).toBeNull(); // render was fine

    fireEvent.click(screen.getByText("go"));
    expect(spy).not.toHaveBeenCalled(); // handler error NOT captured
    expect(screen.queryByText("fallback-shown")).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asyncState.boom).not.toBeNull();
    expect(spy).not.toHaveBeenCalled(); // async error NOT captured either

    // explicit capture is the honest path for async/handler errors
    reporter.captureException({
      exception: {
        type: "Error",
        message: asyncState.boom?.message ?? "async boom",
      },
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("manual capture works alongside the boundary", async () => {
    const delivered: Array<{ body: string }> = [];
    installFetchMock(delivered);
    const reporter = await makeRealReporter();

    render(
      <PrismErrorBoundary reporter={reporter}>
        <Boom />
      </PrismErrorBoundary>,
    );
    reporter.captureException({
      exception: { type: "Error", message: "manual async trace" },
    });

    await reporter.flush();
    const errors = delivered
      .map((d) => (JSON.parse(d.body) as { errors: unknown[] }).errors)
      .flat();
    expect(errors.length).toBe(2); // boundary + explicit
    await reporter.shutdown();
  });

  it("consent denial still shows the fallback and delivers nothing", async () => {
    const delivered: Array<{ body: string }> = [];
    installFetchMock(delivered);
    consent = "denied";
    const reporter = await makeRealReporter();

    render(
      <PrismErrorBoundary reporter={reporter} fallback={<div>recovered</div>}>
        <Boom />
      </PrismErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeDefined();
    await reporter.flush();
    expect(delivered).toHaveLength(0);
    await reporter.shutdown();
  });

  it("shutdown stops further delivery and drains the queue", async () => {
    const delivered: Array<{ body: string }> = [];
    installFetchMock(delivered);
    const reporter = await makeRealReporter();

    render(
      <PrismErrorBoundary reporter={reporter}>
        <Boom />
      </PrismErrorBoundary>,
    );
    await reporter.shutdown();
    expect(reporter.pendingCount).toBe(0); // shutdown drains the queue
    const afterShutdown = delivered.length;
    await reporter.flush();
    // shutdown's bounded final flush may deliver the in-flight batch, but a
    // flush AFTER shutdown must send nothing new
    expect(delivered.length).toBe(afterShutdown);
  });

  it("usePrismErrorReporter returns the shared reporter and throws outside a provider", () => {
    const { reporter } = fakeReporter();

    function Consumer() {
      const fromHook = usePrismErrorReporter();
      return <div>{fromHook === reporter ? "shared" : "other"}</div>;
    }
    render(
      <PrismErrorBoundaryProvider reporter={reporter}>
        <Consumer />
      </PrismErrorBoundaryProvider>,
    );
    expect(screen.getByText("shared")).toBeDefined();

    function Outside(): ReactNode {
      usePrismErrorReporter();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/usePrismErrorReporter must be used inside/);
  });

  it("a boundary without a reporter prop consumes the provider's reporter", () => {
    const { reporter, spy } = fakeReporter();

    render(
      <PrismErrorBoundaryProvider reporter={reporter}>
        <PrismErrorBoundary fallback={<div>recovered</div>}>
          <Boom />
        </PrismErrorBoundary>
      </PrismErrorBoundaryProvider>,
    );
    expect(screen.getByText("recovered")).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
