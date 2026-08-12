import { describe, expect, it } from "vitest";
import {
  createPrismClient,
  type PrismClient,
  type PrismRuntimeAdapter,
  type CaptureResult,
} from "../contract";

/**
 * Contract tests (task-9 slice 1) — the frozen public API surface of
 * `@prism/core` v2 (ADR 0002). These tests currently FAIL on purpose: the
 * declarations in src/contract.ts are the review surface and the runtime
 * implementation lands in slice 2. Do not delete or weaken them; they
 * become the passing contract suite once `createPrismClient` exists.
 */

function fakeRuntime(name = "node-fake"): PrismRuntimeAdapter {
  let id = 0;
  return {
    name,
    now: () => 1_700_000_000_000,
    createId: () => `fake-id-${(id += 1)}`,
    transport: {
      post: async (url, body) => {
        void url;
        void body;
        return { status: 200, text: async () => "" };
      },
    },
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
  };
}

const baseOptions = {
  projectKey: "pr_0123456789abcdef0123456789abcdef",
  endpoint: "https://analytics.example.com",
};

describe("createPrismClient contract", () => {
  it("resolves to a ready client with explicit options", async () => {
    const prism = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "pending" },
    });
    expect(typeof prism).toBe("object");
    expect(prism.collectionState).toBe("pending");
    expect(prism.projectKey).toBe(baseOptions.projectKey);
    expect(prism.endpoint).toBe("https://analytics.example.com");
  });

  it("requires a runtime adapter (no platform globals in the core)", async () => {
    const missingRuntime = {
      ...baseOptions,
      collection: { initialState: "granted" },
    };
    // @ts-expect-error — runtime is mandatory
    await expect(createPrismClient(missingRuntime)).rejects.toThrow(/runtime/);
  });

  it("rejects a malformed endpoint during setup", async () => {
    await expect(
      createPrismClient({
        ...baseOptions,
        endpoint: "not-a-url",
        runtime: fakeRuntime(),
        collection: { initialState: "granted" },
      }),
    ).rejects.toThrow(/endpoint/);
  });

  it("rejects a missing project key during setup", async () => {
    await expect(
      createPrismClient({
        projectKey: "",
        endpoint: "https://analytics.example.com",
        runtime: fakeRuntime(),
        collection: { initialState: "granted" },
      }),
    ).rejects.toThrow(/project/);
  });
});

describe("track contract", () => {
  it("returns a queued result with a client-generated event ID", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const result = prism.track("checkout_started", { plan: "pro", value: 42 });
    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.eventId).toMatch(/^fake-id-/);
    }
  });

  it("drops events while consent is pending — no hidden pre-consent queue", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "pending" },
    });
    const result = prism.track("checkout_started");
    expect(result.status).toBe("dropped");
    if (result.status === "dropped") {
      expect(result.reason).toBe("consent-pending");
    }
  });

  it("drops events after shutdown with a shutdown reason", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    await prism.shutdown({ timeoutMs: 100 });
    const result = prism.track("late_event");
    expect(result.status).toBe("dropped");
    if (result.status === "dropped") {
      expect(result.reason).toBe("shutdown");
    }
  });

  it("drops invalid events with the invalid reason", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const result = prism.track("");
    expect(result.status).toBe("dropped");
    if (result.status === "dropped") {
      expect(result.reason).toBe("invalid");
    }
  });
});

describe("session contract", () => {
  it("starts a client-owned session handle and ends it", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const handle = prism.startSession();
    expect(handle.sessionId).toMatch(/^fake-id-/);
    expect(prism.session).toBe(handle);
    const ended = handle.end();
    expect(ended.status).toBe("queued");
    expect(prism.session).toBeNull();
  });
});

describe("diagnostics + lifecycle contract", () => {
  it("supports multiple idempotent diagnostic subscriptions", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const seen: string[] = [];
    const a = prism.onDiagnostic((d) => seen.push(d.code));
    const b = prism.onDiagnostic((d) => seen.push(d.code));
    await prism.flush();
    expect(seen.length).toBeGreaterThan(0);
    a.remove();
    a.remove(); // idempotent
    const before = seen.length;
    await prism.flush();
    expect(seen.length).toBeGreaterThan(before); // b still receives
    void b;
  });

  it("flush is async and rejects on delivery failure when awaited", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      throw new Error("network down");
    };
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime,
      collection: { initialState: "granted" },
    });
    prism.track("will_fail");
    await expect(prism.flush()).rejects.toThrow(/network down/);
  });

  it("shutdown is idempotent", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    await prism.shutdown({ timeoutMs: 100 });
    await prism.shutdown({ timeoutMs: 100 });
    expect(prism.collectionState).toBe("granted");
  });
});

describe("capture result discriminated union", () => {
  it("narrows queued results at the type level", () => {
    const result = { status: "queued", eventId: "x" } as CaptureResult;
    if (result.status === "queued") {
      expect(result.eventId).toBe("x");
    }
  });
});
