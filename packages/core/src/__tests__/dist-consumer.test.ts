import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Built-artifact consumption tests (task-9 slice 3): the package must work
 * from its BUILT output (dist), not only through workspace resolution.
 * They run when the dist exists (after `yarn workspace @prism/core build`);
 * CI builds before testing.
 */

const DIST = resolve(__dirname, "../../dist/index.js");

describe.runIf(existsSync(DIST))("built package consumption", () => {
  it("exports a working createPrismClient from the built artifact", async () => {
    const mod = (await import(DIST)) as {
      createPrismClient: (options: unknown) => Promise<{
        track: (name: string, properties?: Record<string, unknown>) => { status: string };
        shutdown: (options?: { timeoutMs?: number }) => Promise<void>;
      }>;
      PrismClientV1: unknown;
    };
    expect(typeof mod.createPrismClient).toBe("function");
    // the legacy class is reachable under its deprecated name
    expect(typeof mod.PrismClientV1).toBe("function");

    const runtime = {
      name: "node-fake",
      now: () => Date.now(),
      createId: () => `dist-id-${Math.random().toString(36).slice(2)}`,
      transport: {
        post: async () => ({
          status: 200,
          headers: {} as Record<string, string>,
          text: async () => "",
        }),
      },
      schedule: (delayMs: number, callback: () => void) => {
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
      },
      context: { platform: "node", kind: "server" },
    };
    const prism = await mod.createPrismClient({
      projectKey: "pr_0123456789abcdef0123456789abcdef",
      endpoint: "https://analytics.example.com",
      runtime,
      collection: { initialState: "granted" },
    });
    expect(prism.track("from_dist").status).toBe("queued");
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("stays within the bundle budget", () => {
    const size = statSync(DIST).size;
    // Baseline budget for the dependency-free core (ADR 0002 §7): the full
    // runtime in one file. CI fails if the bundle outgrows the budget.
    expect(size).toBeLessThan(60 * 1024);
  });
});
