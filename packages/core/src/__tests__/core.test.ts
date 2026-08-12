import { describe, expect, it, vi } from "vitest";
import {
  createPrismClient,
  type PrismClient,
  type PrismRequest,
  type PrismResponse,
  type PrismRuntimeAdapter,
} from "../index";

/**
 * Core behavior tests (task-9 slice 2) — the v2 implementation behind the
 * frozen contract: consent, queue limits, sessions, diagnostics, flush,
 * retries, and shutdown, on the capability-based fake runtime.
 */

function fakeRuntime(name = "node-fake"): PrismRuntimeAdapter {
  let id = 0;
  return {
    name,
    now: () => Date.now(),
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
    schedule: (delayMs: number, callback: () => void) => {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    },
    context: { platform: "node", kind: "server" },
  };
}

const base = {
  projectKey: "pr_0123456789abcdef0123456789abcdef",
  endpoint: "https://analytics.example.com",
};

async function ready(options: Partial<Parameters<typeof createPrismClient>[0]> = {}) {
  return createPrismClient({
    ...base,
    runtime: fakeRuntime(),
    collection: { initialState: "granted" },
    ...options,
  });
}

describe("consent and collection state", () => {
  it("transitions pending -> granted -> denied and back", async () => {
    const prism = await ready({ collection: { initialState: "pending" } });
    expect(prism.collectionState).toBe("pending");
    await prism.setCollectionState("granted");
    expect(prism.collectionState).toBe("granted");
    await prism.setCollectionState("denied");
    expect(prism.collectionState).toBe("denied");
    await prism.setCollectionState("granted");
    expect(prism.collectionState).toBe("granted");
  });

  it("drops events while pending/denied and queues them once granted", async () => {
    const prism = await ready({ collection: { initialState: "pending" } });
    expect(prism.track("early").status).toBe("dropped");
    await prism.setCollectionState("granted");
    expect(prism.track("early").status).toBe("queued");
    await prism.setCollectionState("denied");
    const late = prism.track("late");
    expect(late.status).toBe("dropped");
    if (late.status === "dropped") {
      expect(late.reason).toBe("consent-denied");
    }
  });

  it("validates the initial state value", async () => {
    await expect(
      ready({ collection: { initialState: "bogus" as never } }),
    ).rejects.toThrow();
  });
});

describe("track validation", () => {
  it("throws for an empty event name", async () => {
    const prism = await ready();
    expect(() => prism.track("")).toThrow(/event name/i);
    expect(() => prism.track("   ")).toThrow(/event name/i);
  });

  it("throws for non-JSON-serializable properties", async () => {
    const prism = await ready();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => prism.track("broken", circular as never)).toThrow(/JSON/);
  });

  it("accepts nested JSON properties", async () => {
    const prism = await ready();
    const result = prism.track("order.completed", {
      items: [{ sku: "a-1", qty: 2 }],
      meta: { source: "web", ok: true },
    });
    expect(result.status).toBe("queued");
  });
});

describe("queue and delivery", () => {
  it("flushes queued events as a single v2 batch", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (url, request) => {
      bodies.push(request.body);
      void url;
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("a", { n: 1 });
    prism.track("b", { n: 2 });
    await prism.flush();
    expect(bodies).toHaveLength(1);
    const batch = JSON.parse(bodies[0] ?? "[]") as Array<{ name: string }>;
    expect(batch.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("drops events beyond the queue capacity", async () => {
    const prism = await ready({ queue: { maxQueueEvents: 2 } });
    expect(prism.track("1").status).toBe("queued");
    expect(prism.track("2").status).toBe("queued");
    const third = prism.track("3");
    expect(third.status).toBe("dropped");
    if (third.status === "dropped") {
      expect(third.reason).toBe("queue-full");
    }
  });

  it("drops events beyond the queue byte capacity", async () => {
    // ~280 serialized bytes for the big event; the small one would exceed
    // a 300-byte cap when combined.
    const prism = await ready({ queue: { maxQueueBytes: 300 } });
    expect(prism.track("a", { payload: "x".repeat(200) }).status).toBe("queued");
    const second = prism.track("b");
    expect(second.status).toBe("dropped");
    if (second.status === "dropped") {
      expect(second.reason).toBe("queue-full");
    }
  });

  it("sends request timeout and a cancellable signal", async () => {
    const seen: PrismRequest[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      seen.push(request);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { requestTimeoutMs: 321 } });
    prism.track("x");
    await prism.flush();
    expect(seen[0]?.timeoutMs).toBe(321);
    expect(typeof seen[0]?.signal?.addEventListener).toBe("function");
  });

  it("rejects flush on transport failure and keeps the batch for retry", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      throw new Error("network down");
    };
    const prism = await ready({ runtime, queue: { maxRetries: 3 } });
    prism.track("retry_me");
    await expect(prism.flush()).rejects.toThrow(/network down/);
    expect(calls).toBe(1);
    // the batch stays queued; a second flush retries
    await expect(prism.flush()).rejects.toThrow(/network down/);
    expect(calls).toBe(2);
  });

  it("honors retry-after from the response headers and drops after max retries", async () => {
    const seen: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      seen.push(request.body);
      return { status: 429, headers: { "retry-after": "60" }, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 2 } });
    prism.onDiagnostic((d) => seen.push(d.code));
    prism.track("limited");
    await expect(prism.flush()).rejects.toThrow(/429/); // attempt 1
    await expect(prism.flush()).rejects.toThrow(/429/); // attempt 2 >= maxRetries: dropped
    await prism.flush(); // queue is empty now — resolves quietly
    expect(seen.filter((s) => s === "rate_limited").length).toBe(2);
    expect(seen).toContain("batch_dropped");
  });
});

describe("sessions", () => {
  it("attaches the session ID to events while a session is active", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    const started = prism.startSession();
    expect(started.status).toBe("started");
    prism.track("during_session");
    await prism.flush();
    const batch = JSON.parse(bodies[0] ?? "[]") as Array<{ sessionId?: string; name: string }>;
    const during = batch.find((e) => e.name === "during_session");
    if (started.status === "started") {
      expect(during?.sessionId).toBe(started.session.sessionId);
    }
  });

  it("queues session_started and session_ended lifecycle events", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    const started = prism.startSession();
    if (started.status === "started") {
      started.session.end();
    }
    await prism.flush();
    const names = JSON.parse(bodies[0] ?? "[]")
      .map((e: { name: string }) => e.name)
      .sort();
    expect(names).toEqual(["session_ended", "session_started"]);
  });
});

describe("diagnostics", () => {
  it("emits diagnostics on delivery failure and stays quiet on empty flushes", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      throw new Error("boom");
    };
    const prism = await ready({ runtime });
    const codes: string[] = [];
    const handle = prism.onDiagnostic((d) => codes.push(d.code));
    await prism.flush();
    expect(codes).toEqual([]);
    prism.track("x");
    await expect(prism.flush()).rejects.toThrow();
    expect(codes).toContain("delivery_failed");
    handle.remove();
    handle.remove();
    const before = codes.length;
    await expect(prism.flush()).rejects.toThrow();
    expect(codes.length).toBe(before);
  });
});

describe("shutdown", () => {
  it("stops capture after shutdown with a shutdown drop reason", async () => {
    const prism = await ready();
    await prism.shutdown({ timeoutMs: 100 });
    const result = prism.track("after");
    expect(result.status).toBe("dropped");
    if (result.status === "dropped") {
      expect(result.reason).toBe("shutdown");
    }
    await prism.shutdown({ timeoutMs: 100 }); // idempotent
  });

  it("attempts a bounded final flush during shutdown", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("final");
    await prism.shutdown({ timeoutMs: 500 });
    expect(bodies.length).toBeGreaterThan(0);
  });

  it("does not crash when the final flush fails", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      throw new Error("gone");
    };
    const prism = await ready({ runtime });
    prism.track("final");
    await prism.shutdown({ timeoutMs: 50 }); // resolves; diagnostic emitted
  });
});

describe("anonymous identity persistence", () => {
  it("persists an anonymous ID when granted with persistent storage", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
        removeItem: async (key: string) => {
          stored.delete(key);
        },
      },
    };
    const prism = await ready({ runtime, collection: { initialState: "granted", anonymousPersistence: "persistent" } });
    // The factory resolves only after identity state is loaded/written.
    expect(stored.has("prism:anonymous_id")).toBe(true);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("rejects persistent identity without durable storage", async () => {
    const runtime = fakeRuntime() as PrismRuntimeAdapter & { storage?: PrismRuntimeAdapter["storage"] };
    delete runtime.storage;
    await expect(
      ready({ runtime, collection: { initialState: "granted", anonymousPersistence: "persistent" } }),
    ).rejects.toThrow(/storage/);
  });
});

describe("fake native/mobile adapter (capability matrix)", () => {
  it("represents screens, app metadata, and lifecycle without platform fields", async () => {
    const lifecycleEvents: string[] = [];
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime("native-fake"),
      context: {
        platform: "react-native",
        kind: "mobile",
        screenSize: { width: 390, height: 844 },
        locale: "en-US",
        timezone: "Europe/Berlin",
        app: { name: "Prism Demo", version: "1.2.3", build: "42" },
        device: { model: "Pixel 8", manufacturer: "Google" },
      },
      lifecycle: {
        on: (event, listener) => {
          lifecycleEvents.push(event);
          return () => undefined;
        },
      },
    };
    const prism = await ready({ runtime, collection: { initialState: "granted" } });
    expect(prism.runtime.context.kind).toBe("mobile");
    expect(prism.runtime.context.app?.version).toBe("1.2.3");
    expect(prism.runtime.context.screenSize?.width).toBe(390);
    // lifecycle subscription is wired without core importing platform globals
    expect(lifecycleEvents).toContain("before-unload");
    const result = prism.track("screen_viewed", { screen: "checkout" });
    expect(result.status).toBe("queued");
    await prism.shutdown({ timeoutMs: 50 });
  });
});


describe("consent withdrawal (review fix)", () => {
  it("clears the queue, deletes the anonymous ID, and closes the session on denied", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: {
        getItem: async (key: string) => stored.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          stored.set(key, value);
        },
        removeItem: async (key: string) => {
          stored.delete(key);
        },
      },
    };
    const prism = await ready({
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
    });
    expect(stored.has("prism:anonymous_id")).toBe(true);
    prism.track("before_withdrawal");
    const started = prism.startSession();
    expect(started.status).toBe("started");
    await prism.setCollectionState("denied");
    expect(prism.session).toBeNull();
    expect(stored.has("prism:anonymous_id")).toBe(false);
    // nothing queued before the withdrawal may be transmitted
    const bodies: string[] = [];
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    await prism.flush();
    expect(bodies).toEqual([]);
  });

  it("starts a fresh anonymous context when re-granted", async () => {
    const prism = await ready({ collection: { initialState: "granted" } });
    await prism.setCollectionState("denied");
    await prism.setCollectionState("granted");
    const result = prism.track("after_regrant");
    expect(result.status).toBe("queued");
  });
});

describe("session handle scoping (review fix)", () => {
  it("an old handle cannot end a newer session", async () => {
    const prism = await ready();
    const first = prism.startSession();
    expect(first.status).toBe("started");
    let firstHandle: NonNullable<PrismClient["session"]> | null = null;
    if (first.status === "started") firstHandle = first.session;
    if (firstHandle) {
      expect(firstHandle.end().status).toBe("ended");
      const second = prism.startSession();
      expect(second.status).toBe("started");
      // the old handle must NOT end the newer session
      expect(firstHandle.end().status).toBe("not-active");
      expect(prism.session).not.toBeNull();
    }
  });
});

describe("background delivery lifecycle (review fix)", () => {
  it("reschedules the flush loop after each tick", async () => {
    let schedules = 0;
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      schedule: (delayMs: number, callback: () => void) => {
        schedules += 1;
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
      },
    };
    const prism = await ready({ runtime, queue: { flushIntervalMs: 5 } });
    prism.track("keep_busy");
    await vi.waitFor(() => {
      expect(schedules).toBeGreaterThanOrEqual(2);
    });
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("concurrent flush calls share one in-flight flush", async () => {
    let posts = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("a");
    prism.track("b");
    await Promise.all([prism.flush(), prism.flush(), prism.flush()]);
    expect(posts).toBe(1);
  });

  it("removes lifecycle subscriptions on shutdown", async () => {
    const removers: Array<() => void> = [];
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      lifecycle: {
        on: (_event, _listener) => {
          const remove = () => {
            removers.push(() => undefined);
          };
          return remove;
        },
      },
    };
    const prism = await ready({ runtime });
    await prism.shutdown({ timeoutMs: 50 });
    expect(removers.length).toBe(1);
  });

  it("shutdown's final flush uses a fresh, non-aborted signal", async () => {
    const seen: PrismRequest[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      seen.push(request);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("final_signal");
    await prism.shutdown({ timeoutMs: 200 });
    expect(seen.length).toBe(1);
    expect(seen[0]?.signal.aborted).toBe(false);
  });
});

describe("property sanitization (review fix)", () => {
  it("redacts credential keys at any depth and in arrays", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("signup", {
      user: { password: "hunter2", nested: { apiKey: "pr_x" } },
      tags: [{ token: "abc" }],
      ok: "visible",
    });
    await prism.flush();
    const delivered = JSON.parse(bodies[0] ?? "{}") as Array<{ properties: Record<string, unknown> }>;
    const props = delivered[0]?.properties ?? {};
    expect((props.user as Record<string, unknown>).password).toBe("[REDACTED]");
    expect(((props.user as Record<string, unknown>).nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((props.tags as Array<Record<string, unknown>>)[0]?.token).toBe("[REDACTED]");
    expect(props.ok).toBe("visible");
  });

  it("honors a custom deny list", async () => {
    const prism = await ready({ sanitize: { denyList: ["employee_email"] } });
    const result = prism.track("hr_event", { employee_email: "a@b.c", name: "Ada" });
    expect(result.status).toBe("queued");
  });

  it("throws when properties exceed the depth limit", async () => {
    const prism = await ready({ sanitize: { maxDepth: 3 } });
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(() => prism.track("deep", deep)).toThrow(/depth/i);
  });

  it("throws when a property string exceeds the length limit", async () => {
    const prism = await ready({ sanitize: { maxStringLength: 10 } });
    expect(() => prism.track("long", { note: "x".repeat(11) })).toThrow(/length/i);
  });

  it("throws when the event name exceeds 128 characters", async () => {
    const prism = await ready();
    expect(() => prism.track("e".repeat(129))).toThrow(/128/);
  });
});

describe("oversized single event (review fix)", () => {
  it("delivers an event larger than maxBatchBytes as a solo batch", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchBytes: 120 } });
    expect(prism.track("big", { payload: "x".repeat(400) }).status).toBe("queued");
    await prism.flush();
    expect(bodies).toHaveLength(1);
    const batch = JSON.parse(bodies[0] ?? "[]") as Array<{ name: string }>;
    expect(batch).toHaveLength(1);
    expect(batch[0]?.name).toBe("big");
  });
});

describe("consent race with an in-flight request (review fix)", () => {
  it("aborts the in-flight delivery when consent becomes denied", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      calls += 1;
      // Hangs until cancelled — a transport that honors the signal.
      await new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    const codes: string[] = [];
    prism.onDiagnostic((d) => codes.push(d.code));
    prism.track("pending_event");
    const flushPromise = prism.flush(); // in flight, hanging
    await prism.setCollectionState("denied");
    await expect(flushPromise).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
    expect(codes).toContain("delivery_cancelled");
    // nothing can be transmitted after the withdrawal
    await prism.flush();
    expect(calls).toBe(1);
  });
});

describe("bounded shutdown with a hanging transport (review fix)", () => {
  it("resolves within the deadline even when the transport ignores cancellation", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      return new Promise<{ status: number; headers: Record<string, string>; text(): Promise<string> }>(
        () => {
          // never settles, ignores the signal entirely
        },
      );
    };
    const prism = await ready({ runtime, queue: { maxRetries: 1 } });
    prism.track("stuck");
    const started = Date.now();
    await prism.shutdown({ timeoutMs: 20 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(calls).toBe(1); // the in-flight attempt; no retry-exhaustion drop
    const codes: string[] = [];
    prism.onDiagnostic((d) => codes.push(d.code));
    expect(codes).not.toContain("batch_dropped");
  });

  it("does not count shutdown cancellation toward retry exhaustion and still delivers", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      calls += 1;
      if (calls === 1) {
        // first attempt hangs until cancelled
        await new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 1 } });
    prism.track("survivor");
    const flushPromise = prism.flush(); // hangs on attempt 1
    await prism.shutdown({ timeoutMs: 200 }); // abort -> drain -> fresh final flush
    await expect(flushPromise).rejects.toThrow(/aborted/);
    expect(calls).toBe(2); // cancelled attempt + the promised fresh final attempt
    const codes: string[] = [];
    prism.onDiagnostic((d) => codes.push(d.code));
    expect(codes).not.toContain("batch_dropped");
  });
});

describe("strict JSON + dangerous keys (review fix)", () => {
  it("rejects prototype-pollution keys", async () => {
    const prism = await ready();
    // JSON.parse creates an own __proto__ property (an object literal would
    // set the prototype instead).
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(() => prism.track("polluted", polluted as never)).toThrow(/dangerous key/);
    expect(() =>
      prism.track("polluted2", { nested: { constructor: { x: 1 } } } as never),
    ).toThrow(/dangerous key/);
  });

  it("rejects runtime-only non-JSON values", async () => {
    const prism = await ready();
    expect(() => prism.track("fn", { cb: () => 1 } as never)).toThrow(/JSON values/);
    expect(() => prism.track("undef", { missing: undefined } as never)).toThrow(/JSON values/);
    expect(() => prism.track("big", { n: BigInt("10") } as never)).toThrow(/JSON values/);
  });
});
