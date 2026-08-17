import { describe, expect, it } from "vitest";
// Runtime values come from the package root (the real factory); the frozen
// type surface comes from the contract declarations.
import { createPrismClient } from "../index";
import type {
  CaptureResult,
  PrismClient,
  PrismRequest,
  PrismResponse,
  PrismRuntimeAdapter,
} from "../contract";

/**
 * Contract tests (task-9 slice 1 + review corrections) — the frozen public
 * API surface of `@prism-analytics/core` v2 (ADR 0002). These tests currently FAIL on
 * purpose: the declarations in src/contract.ts are the review surface and
 * the runtime implementation lands in slice 2. Do not delete or weaken
 * them; they become the passing contract suite once `createPrismClient`
 * exists.
 */

function fakeRuntime(name = "node-fake"): PrismRuntimeAdapter {
  let id = 0;
  return {
    name,
    now: () => 1_700_000_000_000,
    createId: () => `fake-id-${(id += 1)}`,
    transport: {
      post: async (_url: string, _request: PrismRequest): Promise<PrismResponse> => ({
        status: 200,
        headers: { "content-type": "application/json" },
        text: async () => "",
      }),
    },
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
    schedule: (_delayMs: number, callback: () => void) => {
      const handle = setTimeout(callback, 0);
      return () => clearTimeout(handle);
    },
    context: { platform: "node", kind: "server" },
  };
}

const baseOptions = {
  sourceKey: "pr_0123456789abcdef0123456789abcdef",
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
    expect(prism.sourceKey).toBe(baseOptions.sourceKey);
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

  it("rejects a missing source key during setup", async () => {
    await expect(
      createPrismClient({
        sourceKey: "",
        endpoint: "https://analytics.example.com",
        runtime: fakeRuntime(),
        collection: { initialState: "granted" },
      }),
    ).rejects.toThrow(/sourceKey/);
  });

  it("requires durable storage for persistent anonymous identity", async () => {
    const runtime = fakeRuntime() as PrismRuntimeAdapter & { storage?: PrismRuntimeAdapter["storage"] };
    delete runtime.storage;
    await expect(
      createPrismClient({
        ...baseOptions,
        runtime,
        collection: { initialState: "granted", anonymousPersistence: "persistent" },
      }),
    ).rejects.toThrow(/storage/);
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

  it("throws a specific validation error for invalid caller input", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    expect(() => prism.track("")).toThrow(/event name/i);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => prism.track("with_circular", circular as never)).toThrow(/JSON/i);
  });
});

describe("session contract", () => {
  it("starts a client-owned session handle and ends it once", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const started = prism.startSession();
    expect(started.status).toBe("started");
    if (started.status === "started") {
      expect(started.session.sessionId).toMatch(/^fake-id-/);
      expect(prism.session).toBe(started.session);
      const ended = started.session.end();
      expect(ended.status).toBe("ended");
      expect(prism.session).toBeNull();
    }
  });

  it("blocks starting twice and reports a second end as not-active", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const first = prism.startSession();
    expect(first.status).toBe("started");
    const second = prism.startSession();
    expect(second.status).toBe("blocked");
    if (second.status === "blocked") {
      expect(second.reason).toBe("already-active");
    }
    if (first.status === "started") {
      const firstEnd = first.session.end();
      expect(firstEnd.status).toBe("ended");
      const secondEnd = first.session.end();
      expect(secondEnd.status).toBe("not-active");
    }
  });

  it("blocks starting a session while consent is pending or denied", async () => {
    const pending: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "pending" },
    });
    const blocked = pending.startSession();
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") {
      expect(blocked.reason).toBe("consent-pending");
    }
    await pending.setCollectionState("denied");
    expect(pending.startSession().status).toBe("blocked");
  });
});

describe("transport contract", () => {
  it("passes a request object with timeout and cancellation signal", async () => {
    const captured: PrismRequest[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      captured.push(request);
      return { status: 200, headers: { "retry-after": "30" }, text: async () => "" };
    };
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime,
      collection: { initialState: "granted" },
      queue: { requestTimeoutMs: 500 },
    });
    prism.track("with_timeout");
    await prism.flush();
    expect(captured.length).toBe(1);
    expect(captured[0]?.timeoutMs).toBe(500);
    expect(typeof captured[0]?.signal?.addEventListener).toBe("function");
  });

  it("exposes response headers (Retry-After) to the delivery logic", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => ({
      status: 429,
      headers: { "retry-after": "60" },
      text: async () => "",
    });
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime,
      collection: { initialState: "granted" },
    });
    prism.track("rate_limited");
    await expect(prism.flush()).rejects.toThrow(); // 429 after retries -> flush rejects
  });
});

describe("diagnostics + lifecycle contract", () => {
  it("stays quiet on successful empty flushes but emits on delivery failure", async () => {
    const prism: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: fakeRuntime(),
      collection: { initialState: "granted" },
    });
    const seen: string[] = [];
    const handle = prism.onDiagnostic((d) => seen.push(d.code));
    await prism.flush(); // empty queue — quiet
    expect(seen).toEqual([]);

    const failing = fakeRuntime();
    failing.transport.post = async () => {
      throw new Error("network down");
    };
    const prism2: PrismClient = await createPrismClient({
      ...baseOptions,
      runtime: failing,
      collection: { initialState: "granted" },
    });
    const seen2: string[] = [];
    prism2.onDiagnostic((d) => seen2.push(d.code));
    prism2.track("will_fail");
    await expect(prism2.flush()).rejects.toThrow(/batch delivery failed/);
    expect(seen2).toContain("delivery_failed");
    handle.remove();
    handle.remove(); // idempotent
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
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
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
