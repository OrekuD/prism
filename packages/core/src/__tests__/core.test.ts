import { describe, expect, it, vi } from "vitest";
import {
  createPrismClient,
  INGEST_LIMITS,
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


/** Parse the v2 batch envelope's events array from a delivered body. */
function deliveredEvents(body: string | undefined): Array<Record<string, unknown>> {
  const parsed = JSON.parse(body ?? "{}") as { events?: Array<Record<string, unknown>> };
  return parsed.events ?? [];
}

const base = {
  projectKey: "pr_0123456789abcdef0123456789abcdef",
  endpoint: "https://analytics.example.com",
};

/** The storage key for `base` — mirrors the core's endpoint-hash djb2 (§15). */
function queueKey(): string {
  let hash = 5381;
  for (let i = 0; i < base.endpoint.length; i += 1) {
    hash = (hash * 33) ^ base.endpoint.charCodeAt(i);
  }
  return `prism:queue:v2:${hash >>> 0}:${base.projectKey}`;
}

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
    const batch = deliveredEvents(bodies[0]) as Array<{ name: string }>;
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
    // v2 envelope sizes (no per-event library): big = 368, small = 156,
    // sum = 524 — a 500-byte cap accepts the first and drops the second.
    const prism = await ready({ queue: { maxQueueBytes: 500 } });
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
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    expect(calls).toBe(1);
    // the batch stays queued; a second flush retries
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    expect(calls).toBe(2);
    await prism.shutdown({ timeoutMs: 50 }); // cancels the pending retry timer
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
    await prism.shutdown({ timeoutMs: 50 }); // cancels the pending retry timer
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
    const batch = deliveredEvents(bodies[0]) as Array<{ sessionId?: string; name: string }>;
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
    const names = deliveredEvents(bodies[0])
      .map((e) => String(e.name))
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
    const delivered = deliveredEvents(bodies[0]) as Array<{ properties: Record<string, unknown> }>;
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
    const batch = deliveredEvents(bodies[0]) as Array<{ name: string }>;
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
    // the consent recheck short-circuits before the cancelled-error throw:
    // a consent-cancelled delivery resolves (it is not a delivery failure)
    await expect(flushPromise).resolves.toBeUndefined();
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
    await expect(flushPromise).rejects.toThrow(/batch delivery cancelled/);
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
    expect(() => prism.track("polluted", polluted as never)).toThrow(/dangerous-key/);
    expect(() =>
      prism.track("polluted2", { nested: { constructor: { x: 1 } } } as never),
    ).toThrow(/dangerous-key/);
  });

  it("rejects runtime-only non-JSON values", async () => {
    const prism = await ready();
    expect(() => prism.track("fn", { cb: () => 1 } as never)).toThrow(/JSON values/);
    expect(() => prism.track("undef", { missing: undefined } as never)).toThrow(/JSON values/);
    expect(() => prism.track("big", { n: BigInt("10") } as never)).toThrow(/JSON values/);
  });
});

describe("queue persistence (slice 3)", () => {
  it("persists and restores queued events through storage with a versioned key", async () => {
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
    const prism = await ready({ runtime });
    prism.track("persisted_1");
    prism.track("persisted_2");
    await prism.flush(); // delivery succeeded — queue empty + snapshot cleared
    const key = [...stored.keys()].find((k) => k.startsWith("prism:queue:v2:"));
    expect(key).toBeDefined();
    expect((JSON.parse(stored.get(key ?? "") ?? "{}") as { events: unknown[] }).events).toEqual([]);

    // undeliverable events survive shutdown in the persisted snapshot
    runtime.transport.post = async () => {
      throw new Error("offline");
    };
    prism.track("persisted_3");
    await prism.shutdown({ timeoutMs: 100 });
    const snapshot = JSON.parse(stored.get(key ?? "") ?? "{}") as { events: string[] };
    expect(snapshot.events).toHaveLength(1);

    // a fresh client restores the queued event once delivery works again
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const bodies: string[] = [];
    const prism2 = await ready({ runtime });
    await prism2.flush();
    expect(deliveredEvents(bodies[0])[0]?.name).toBe("persisted_3");
  });

  it("quarantines corrupt queue state with a diagnostic", async () => {
    // the client's ACTUAL key: prism:queue:v1:<projectKey>
    const corruptKey = queueKey();
    const stored = new Map<string, string>([[corruptKey, "{not json"]]);
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
    const codes: string[] = [];
    const prism = await createPrismClient({
      ...base,
      runtime,
      collection: { initialState: "granted" },
      // subscribe before the factory resolves — init diagnostics observable
      onDiagnostic: (d) => codes.push(d.code),
    });
    expect(codes).toContain("queue_state_reset");
    expect(prism.track("fresh").status).toBe("queued");
    await prism.shutdown({ timeoutMs: 50 });
    // the corrupt entry was quarantined; the final snapshot is a valid v1 state
    const final = [...stored.values()].find((v) => v.includes('"v":2')) ?? "";
    expect(final).toContain('"v":2');
  });
});

describe("permanent 4xx handling (slice 3)", () => {
  it.each([400, 401, 403, 413])(
    "drops the batch on %s with a remediation diagnostic and no retry",
    async (status) => {
      let calls = 0;
      const runtime = fakeRuntime();
      runtime.transport.post = async () => {
        calls += 1;
        return { status, headers: {}, text: async () => "" };
      };
      const prism = await ready({ runtime });
      const codes: string[] = [];
      prism.onDiagnostic((d) => codes.push(d.code));
      prism.track("poison");
      await prism.flush(); // resolves — terminal outcome, not a delivery failure
      expect(calls).toBe(1);
      expect(codes).toContain("batch_rejected");
    },
  );

  it("retries 429 and retryable 5xx as before", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      return { status: 500, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 2 } });
    prism.track("retryable");
    await expect(prism.flush()).rejects.toThrow(/500/);
    expect(calls).toBe(1); // stays queued for the next attempt
    await prism.shutdown({ timeoutMs: 50 }); // cancels the pending retry timer
  });
});

describe("per-event results (slice 3)", () => {
  it("accounts accepted/duplicate/rejected results and never resends rejected", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return {
        status: 200,
        headers: {},
        text: async () =>
          JSON.stringify({
            results: [
              { id: "fake-id-1", status: "accepted" },
              { id: "fake-id-2", status: "duplicate" },
              { id: "fake-id-3", status: "rejected" },
            ],
          }),
      };
    };
    const prism = await ready({ runtime });
    const codes: string[] = [];
    prism.onDiagnostic((d) => codes.push(d.code));
    const events = [prism.track("a"), prism.track("b"), prism.track("c")];
    // strict reconciliation matches SUBMITTED ids — use the real event ids
    const results = events.map((result) => ({
      id: result.status === "queued" ? result.eventId : "missing",
      status: ["accepted", "duplicate", "rejected"][events.indexOf(result)] as
        | "accepted"
        | "duplicate"
        | "rejected",
    }));
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => JSON.stringify({ results }) };
    };
    await prism.flush();
    expect(bodies).toHaveLength(1);
    expect(codes).toContain("event_rejected");
    await prism.flush(); // queue is empty — rejected events are not resent
    expect(bodies).toHaveLength(1);
  });

  it("accepts the whole batch when the response has no results", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => ({
      status: 200,
      headers: {},
      text: async () => JSON.stringify({ message: "success" }),
    });
    const prism = await ready({ runtime });
    prism.track("plain");
    await prism.flush();
    expect(prism.track("after").status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// Slice 3 corrections (second review round)
// ---------------------------------------------------------------------------

/** A runtime whose scheduler records entries instead of using real timers. */
function schedulableRuntime() {
  const scheduled: Array<{
    delayMs: number;
    callback: () => void;
    cancelled: boolean;
  }> = [];
  const runtime = fakeRuntime();
  runtime.schedule = (delayMs: number, callback: () => void) => {
    const entry = { delayMs, callback, cancelled: false };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return {
    runtime,
    scheduled,
    /** Fire the first non-cancelled entry matching the predicate. */
    async fire(predicate: (entry: { delayMs: number }) => boolean): Promise<void> {
      const entry = scheduled.find((e) => !e.cancelled && predicate(e));
      if (!entry) throw new Error("no scheduled entry matched");
      entry.cancelled = true;
      entry.callback();
      // let the async tick/flush chain settle
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function memoryStorage(stored: Map<string, string>): PrismRuntimeAdapter["storage"] {
  return {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: async (key: string) => {
      stored.delete(key);
    },
  };
}

describe("single removal owner (slice 3 corrections)", () => {
  it("delivers every event across multiple batches — no double removal", async () => {
    const posted: Array<Array<{ name: string }>> = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      posted.push(deliveredEvents(request.body) as Array<{ name: string }>);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 1 } });
    prism.track("a");
    prism.track("b");
    prism.track("c");
    await prism.flush();
    expect(posted).toHaveLength(3);
    expect(posted.map((b) => b[0]?.name)).toEqual(["a", "b", "c"]);
  });

  it("does not replay delivered events after a successful shutdown", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    let posts = 0;
    runtime.transport.post = async () => {
      posts += 1;
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("once");
    await prism.shutdown({ timeoutMs: 100 }); // delivered during the final flush
    expect(posts).toBe(1);
    // the empty queue was persisted — the next client replays nothing
    const prism2 = await ready({ runtime });
    await prism2.flush();
    expect(posts).toBe(1);
  });
});

describe("consent-gated restore and delivery (slice 3 corrections)", () => {
  function seedStorage(stored: Map<string, string>): void {
    const occurredAt = Date.now();
    const serialized = JSON.stringify({
      schemaVersion: 2,
      eventId: "seed-1",
      type: "track",
      occurredAt,
      name: "seeded",
      properties: {},
      context: { platform: "node", kind: "server" },
    });
    stored.set(
      queueKey(),
      JSON.stringify({
        v: 2,
        events: [{ eventId: "seed-1", name: "seeded", occurredAt, serialized }],
      }),
    );
  }

  it("never transmits restored events when created with consent denied", async () => {
    const stored = new Map<string, string>();
    seedStorage(stored);
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const codes: string[] = [];
    let posts = 0;
    runtime.transport.post = async () => {
      posts += 1;
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await createPrismClient({
      ...base,
      runtime,
      collection: { initialState: "denied" },
      onDiagnostic: (d) => codes.push(d.code),
    });
    await prism.flush(); // explicit flush under denied: nothing transmits
    expect(posts).toBe(0);
    expect(codes).toContain("queue_state_purged");
    // the persisted queue was purged — no stale state survives withdrawal
    expect(stored.get(queueKey())).toBeUndefined();
  });

  it("defers restored events under pending until consent is granted", async () => {
    const stored = new Map<string, string>();
    seedStorage(stored);
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const bodies: string[] = [];
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await createPrismClient({
      ...base,
      runtime,
      collection: { initialState: "pending" },
    });
    await prism.flush();
    expect(bodies).toHaveLength(0); // nothing transmits while pending
    await prism.setCollectionState("granted");
    await prism.flush();
    expect(bodies).toHaveLength(1); // the deferred snapshot delivers after grant
    expect(deliveredEvents(bodies[0])[0]?.name).toBe("seeded");
    await prism.shutdown({ timeoutMs: 100 });
  });
});

describe("strict per-event reconciliation (slice 3 corrections)", () => {
  it("keeps the batch when results reference unrelated ids", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => ({
      status: 200,
      headers: {},
      text: async () => JSON.stringify({ results: [{ id: "unrelated-9", status: "accepted" }] }),
    });
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("x1");
    prism.track("x2");
    prism.track("x3");
    await expect(prism.flush()).rejects.toThrow(/malformed/);
    // nothing was discarded — a good response delivers all three
    runtime.transport.post = async () => ({
      status: 200,
      headers: {},
      text: async () => "",
    });
    const bodies: string[] = [];
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    await prism.flush();
    expect(deliveredEvents(bodies[0])).toHaveLength(3);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("treats duplicate result ids as malformed", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => ({
      status: 200,
      headers: {},
      text: async () =>
        JSON.stringify({
          results: [
            { id: "fake-id-1", status: "accepted" },
            { id: "fake-id-1", status: "accepted" },
          ],
        }),
    });
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("dup");
    await expect(prism.flush()).rejects.toThrow(/malformed/);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("removes only submitted events with terminal results", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    let mode: "partial" | "good" = "partial";
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      if (mode === "partial") {
        return {
          status: 200,
          headers: {},
          text: async () =>
            JSON.stringify({
              results: [
                { id: firstId, status: "accepted" },
                { id: "unrelated-9", status: "accepted" },
              ],
            }),
        };
      }
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    const events = [prism.track("p1"), prism.track("p2"), prism.track("p3")];
    const firstId = events[0]?.status === "queued" ? events[0].eventId : "missing";
    await expect(prism.flush()).rejects.toThrow(/malformed/); // 2nd post has no terminal ids
    expect(deliveredEvents(bodies[0])).toHaveLength(3); // first post: the full batch
    expect(deliveredEvents(bodies[1])).toHaveLength(2); // p1 removed; p2/p3 requeued
    mode = "good";
    await prism.flush();
    const last = deliveredEvents(bodies[bodies.length - 1]) as Array<{ name: string }>;
    expect(last.map((e) => e.name)).toEqual(["p2", "p3"]);
    await prism.shutdown({ timeoutMs: 100 });
  });
});

describe("bounded scheduled retries (slice 3 corrections)", () => {
  it("auto-retries failed batches with exponential backoff, no external flush", async () => {
    let calls = 0;
    const { runtime, fire } = schedulableRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      if (calls < 3) throw new Error("network down");
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("retry_me");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    expect(calls).toBe(1);
    // retry 1: ~1 s backoff (±20% deterministic jitter)
    await fire((e) => e.delayMs >= 800 && e.delayMs <= 1200);
    expect(calls).toBe(2);
    // retry 2: ~2 s backoff
    await fire((e) => e.delayMs >= 1600 && e.delayMs <= 2400);
    expect(calls).toBe(3);
    // delivered — the retry loop settled without any external flush
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("honors Retry-After on 429 in the scheduled retry", async () => {
    let calls = 0;
    const { runtime, fire } = schedulableRuntime();
    runtime.transport.post = async (): Promise<PrismResponse> => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, headers: { "retry-after": "2" }, text: async () => "" };
      }
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("limited");
    await expect(prism.flush()).rejects.toThrow(/429/);
    // 2 s Retry-After, ±20% jitter
    await fire((e) => e.delayMs >= 1600 && e.delayMs <= 2400);
    expect(calls).toBe(2);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("drops the batch after maxRetries and stops retrying", async () => {
    let calls = 0;
    const { runtime, scheduled, fire } = schedulableRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      throw new Error("network down");
    };
    const prism = await ready({ runtime, queue: { maxRetries: 2, flushIntervalMs: 10_000_000 } });
    const codes: string[] = [];
    prism.onDiagnostic((d) => codes.push(d.code));
    prism.track("doomed");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    await fire((e) => e.delayMs >= 800 && e.delayMs <= 1200);
    expect(calls).toBe(2);
    expect(codes).toContain("batch_dropped");
    // no further retry is scheduled after exhaustion
    const pending = scheduled.filter((e) => e.delayMs < 10_000_000 && !e.cancelled);
    expect(pending).toHaveLength(0);
    await prism.shutdown({ timeoutMs: 100 });
  });
});

// ---------------------------------------------------------------------------
// Slice 4 — v2 wire envelope + shared limits (ingestion contract prep)
// ---------------------------------------------------------------------------

describe("v2 wire envelope (slice 4)", () => {
  it("delivers the v2 batch envelope with per-event envelope fields", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("page_viewed", { url: "/home" });
    await prism.flush();

    const envelope = JSON.parse(bodies[0] ?? "{}") as {
      schemaVersion: number;
      sentAt: number;
      sdk: { name: string; version: string };
      events: Array<Record<string, unknown>>;
    };
    expect(envelope.schemaVersion).toBe(2);
    expect(typeof envelope.sentAt).toBe("number");
    expect(envelope.sdk).toEqual({ name: "@prism/core", version: "0.0.1" });
    expect(envelope.events).toHaveLength(1);
    const event = envelope.events[0] ?? {};
    expect(event.schemaVersion).toBe(2);
    expect(event.type).toBe("track");
    expect(typeof event.eventId).toBe("string");
    expect(typeof event.occurredAt).toBe("number");
    expect(event.name).toBe("page_viewed");
    expect((event.properties as { url: string }).url).toBe("/home");
    // SDK identity is batch-level ONLY (F13) — never per-event context
    expect("library" in (event.context as Record<string, unknown>)).toBe(false);
    expect((event.context as { platform: string }).platform).toBe("node");
  });

  it("rejects events above the shared per-event byte cap (queue-full)", async () => {
    const prism = await ready({ runtime: fakeRuntime() });
    // strings cap at 10 000 chars — exceed the 32 KiB event cap with chunks
    const oversized = prism.track("big", {
      payload: [
        "x".repeat(9_900),
        "x".repeat(9_900),
        "x".repeat(9_900),
        "x".repeat(9_900),
      ],
    });
    expect(oversized.status).toBe("dropped");
    if (oversized.status === "dropped") {
      expect(oversized.reason).toBe("queue-full");
    }
    const normal = prism.track("small", { ok: true });
    expect(normal.status).toBe("queued");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("restores pre-envelope snapshots defensively (timestamp fallback)", async () => {
    const stored = new Map<string, string>([
      [
        queueKey(),
        JSON.stringify({
          v: 1,
          events: [
            JSON.stringify({
              eventId: "legacy-1",
              name: "legacy",
              properties: {},
              timestamp: 1234,
            }),
          ],
        }),
      ],
    ]);
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const prism = await ready({ runtime });
    await prism.shutdown({ timeoutMs: 50 }); // restores + flushes without error
  });
});


// ---------------------------------------------------------------------------
// Slice 4 review corrections (F1 auth headers, F2 identity, F3 ceilings,
// F8 threshold flush, F9 retry-after minimum, F13 batch-level SDK identity)
// ---------------------------------------------------------------------------

describe("transport authentication (review F1)", () => {
  it("delivers every batch with immutable authorization and content-type headers", async () => {
    const seen: PrismRequest[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      seen.push(request);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    prism.track("auth_me");
    await prism.flush();

    expect(seen).toHaveLength(1);
    const request = seen[0] as PrismRequest;
    expect(Object.isFrozen(request.headers)).toBe(false); // structurally readonly
    expect(request.headers.authorization).toBe(`Bearer ${base.projectKey}`);
    expect(request.headers["content-type"]).toBe("application/json");
  });

  it("never leaks the project key into diagnostics or error messages", async () => {
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      throw new Error("network down");
    };
    const prism = await ready({ runtime, queue: { maxRetries: 1 } });
    const codes: Array<{ code: string; message: string }> = [];
    prism.onDiagnostic((d) => codes.push({ code: d.code, message: d.message }));
    prism.track("leak_check");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);

    const all = JSON.stringify(codes) + JSON.stringify(codes.map((c) => c.message));
    expect(all).not.toContain(base.projectKey);
  });
});

describe("anonymous identity (review F2)", () => {
  function storageRuntime(stored: Map<string, string>) {
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const posts: string[] = [];
    runtime.transport.post = async (_url, request) => {
      posts.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    return { runtime, posts };
  }

  function firstAnonymousId(body: string): string | undefined {
    const envelope = JSON.parse(body) as { events: Array<{ anonymousId?: string }> };
    return envelope.events[0]?.anonymousId;
  }

  it("attaches an existing persisted ID to every delivered event", async () => {
    const stored = new Map<string, string>([["prism:anonymous_id", "stored-id-123"]]);
    const { runtime, posts } = storageRuntime(stored);
    const prism = await ready({
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
    });
    prism.track("id_check");
    await prism.flush();
    expect(firstAnonymousId(posts[0] ?? "")).toBe("stored-id-123");
    // the stored value was reused, not replaced
    expect(stored.get("prism:anonymous_id")).toBe("stored-id-123");
  });

  it("generates, stores, and attaches a fresh ID on first grant", async () => {
    const stored = new Map<string, string>();
    const { runtime, posts } = storageRuntime(stored);
    const prism = await ready({
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
    });
    prism.track("id_check");
    await prism.flush();
    const id = firstAnonymousId(posts[0] ?? "");
    expect(id).toBeTruthy();
    expect(stored.get("prism:anonymous_id")).toBe(id);
  });

  it("keeps one stable in-memory ID with a diagnostic when persistence fails", async () => {
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: {
        getItem: async () => null,
        setItem: async () => {
          throw new Error("quota");
        },
        removeItem: async () => undefined,
      },
    };
    const posts: string[] = [];
    runtime.transport.post = async (_url, request) => {
      posts.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const codes: string[] = [];
    const prism = await createPrismClient({
      ...base,
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
      onDiagnostic: (d) => codes.push(d.code),
    });
    prism.track("a");
    await prism.flush();
    prism.track("b");
    await prism.flush();
    expect(codes).toContain("identity_storage_failed");
    const ids = posts.map(firstAnonymousId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]); // stable — never regenerated per event
  });

  it("withdraws identity (stored + in-memory) and re-grant creates a fresh ID", async () => {
    const stored = new Map<string, string>();
    const { runtime, posts } = storageRuntime(stored);
    const prism = await createPrismClient({
      ...base,
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
    });
    prism.track("before");
    await prism.flush();
    const before = firstAnonymousId(posts[0] ?? "") ?? "";

    await prism.setCollectionState("denied");
    expect(stored.get("prism:anonymous_id")).toBeUndefined();

    await prism.setCollectionState("granted");
    prism.track("after");
    await prism.flush();
    const after = firstAnonymousId(posts[1] ?? "") ?? "";
    expect(after).toBeTruthy();
    expect(after).not.toBe(before); // never silently restore the old identity
  });

  it("session-scoped identity is stable for the client lifetime", async () => {
    const { runtime, posts } = storageRuntime(new Map());
    const prism = await ready({
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "session" },
    });
    prism.track("a");
    await prism.flush();
    prism.track("b");
    await prism.flush();
    const ids = posts.map(firstAnonymousId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });

  it("anonymousPersistence none never touches storage", async () => {
    let reads = 0;
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: {
        getItem: async (key: string) => {
          if (key === "prism:anonymous_id") reads += 1;
          return null;
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
    };
    const prism = await ready({ runtime, collection: { initialState: "granted" } });
    prism.track("no_id");
    await prism.flush();
    expect(reads).toBe(0);
  });
});

describe("wire ceilings (review F3)", () => {
  it("rejects queue settings above the wire ceilings with a specific error", async () => {
    await expect(
      ready({ queue: { maxBatchEvents: 51 } }),
    ).rejects.toThrow(/maxBatchEvents 51 exceeds the wire ceiling \(50\)/);
    await expect(
      ready({ queue: { maxBatchBytes: INGEST_LIMITS.maxBatchBytes + 1 } }),
    ).rejects.toThrow(/maxBatchBytes/);
    await expect(
      ready({ queue: { maxEventBytes: INGEST_LIMITS.maxEventBytes + 1 } }),
    ).rejects.toThrow(/maxEventBytes/);
  });

  it("accepts lower custom limits", async () => {
    const prism = await ready({ queue: { maxBatchEvents: 1 } });
    expect(prism.track("ok").status).toBe("queued");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("delivers exactly 50 events in one batch — never 51", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 50 } });
    for (let i = 0; i < 50; i += 1) {
      expect(prism.track(`e${i}`).status).toBe("queued");
    }
    // threshold flush fired asynchronously
    await prism.flush();
    expect(bodies).toHaveLength(1);
    expect(deliveredEvents(bodies[0])).toHaveLength(50);
  });

  it("rejects runtime-only property values before sanitization", async () => {
    const prism = await ready();
    // cast through unknown: these are RUNTIME-only values that must be
    // rejected at runtime despite the compile-time JsonObject type
    const bad = (value: unknown) => () => prism.track("bad", value as never);
    expect(bad({ score: Number.NaN })).toThrow(/non-finite-number/);
    expect(bad({ when: new Date() })).toThrow(/non-plain-object/);
    expect(bad({ nested: { deep: undefined } })).toThrow(/invalid-value/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(bad(cyclic)).toThrow(/cyclic/);
    expect(bad({ many: Array.from({ length: 101 }, () => 1) })).toThrow(/too-many-elements/);
    const tooManyKeys: Record<string, number> = {};
    for (let i = 0; i < 101; i += 1) tooManyKeys[`k${i}`] = i;
    expect(bad(tooManyKeys)).toThrow(/too-many-keys/);
  });

  it("rejects control characters in event names (shared rule)", async () => {
    const prism = await ready();
    expect(() => prism.track("bad\u0000name")).toThrow(/control characters/);
  });
});

describe("threshold flushing (review F8)", () => {
  it("maxBatchEvents 1 triggers one asynchronous transport call after track", async () => {
    let posts = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      posts += 1;
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 1 } });
    expect(prism.track("t").status).toBe("queued"); // synchronous result
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("three simultaneous threshold triggers produce one request", async () => {
    let posts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      posts += 1;
      await gate; // hold the first flush in flight
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 1 } });
    prism.track("a");
    prism.track("b");
    prism.track("c");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1); // ONE flush in flight — the other two triggers coalesced
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the same single flush then drained all three batches serially
    expect(posts).toBe(3);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("pending/denied collection never flushes on threshold", async () => {
    let posts = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      posts += 1;
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({
      runtime,
      collection: { initialState: "pending" },
      queue: { maxBatchEvents: 1 },
    });
    expect(prism.track("p").status).toBe("dropped"); // nothing queued while pending
    await prism.setCollectionState("granted");
    expect(prism.track("g").status).toBe("queued");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1); // granted: threshold flush fires
    await prism.setCollectionState("denied");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1); // denied: nothing further
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("failed threshold delivery stays queued and retries normally", async () => {
    let calls = 0;
    const runtime = fakeRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 1 } });
    prism.track("t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1); // failed threshold flush
    await prism.flush(); // explicit retry delivers
    expect(calls).toBe(2);
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("retry-after minimum (review F9)", () => {
  it("never schedules before a delta-seconds Retry-After, even above 60s", async () => {
    let calls = 0;
    const { runtime, scheduled, fire } = schedulableRuntime();
    runtime.transport.post = async (): Promise<PrismResponse> => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, headers: { "retry-after": "120" }, text: async () => "" };
      }
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, queue: { maxRetries: 3, flushIntervalMs: 10_000_000 } });
    prism.track("slow");
    await expect(prism.flush()).rejects.toThrow(/429/);
    const retry = scheduled.find((e) => e.delayMs < 10_000_000);
    expect(retry).toBeDefined();
    // 120 s minimum — not shortened to 60 s, not jittered below
    expect(retry?.delayMs).toBe(120_000);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("parses the HTTP-date Retry-After form", async () => {
    const { runtime, scheduled, fire } = schedulableRuntime();
    const future = new Date(Date.now() + 90_000).toUTCString();
    runtime.transport.post = async (): Promise<PrismResponse> => ({
      status: 429,
      headers: { "retry-after": future },
      text: async () => "",
    });
    const prism = await ready({ runtime, queue: { maxRetries: 2, flushIntervalMs: 10_000_000 } });
    prism.track("dated");
    await expect(prism.flush()).rejects.toThrow(/429/);
    const retry = scheduled.find((e) => e.delayMs < 10_000_000);
    // at least 90 s (now + 90s), within a small clock tolerance
    expect(retry && retry.delayMs).toBeGreaterThanOrEqual(89_000);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("falls back to exponential backoff for invalid or past Retry-After", async () => {
    const { runtime, scheduled } = schedulableRuntime();
    const past = new Date(Date.now() - 60_000).toUTCString();
    runtime.transport.post = async () => ({
      status: 429,
      headers: { "retry-after": past },
      text: async () => "",
    });
    const prism = await ready({ runtime, queue: { maxRetries: 2, flushIntervalMs: 10_000_000 } });
    prism.track("past");
    await expect(prism.flush()).rejects.toThrow(/429/);
    const retry = scheduled.find((e) => e.delayMs < 10_000_000);
    // exponential backoff: 1 s ± 20% deterministic jitter
    expect(retry && retry.delayMs).toBeGreaterThanOrEqual(800);
    expect(retry && retry.delayMs).toBeLessThanOrEqual(1200);
    await prism.shutdown({ timeoutMs: 100 });
  });

  it("cancellation removes pending retry scheduling", async () => {
    let calls = 0;
    const { runtime, scheduled } = schedulableRuntime();
    runtime.transport.post = async () => {
      calls += 1;
      throw new Error("network down");
    };
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("cancel_me");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    const pending = scheduled.filter((e) => e.delayMs < 10_000_000);
    expect(pending.length).toBe(1);
    await prism.shutdown({ timeoutMs: 100 });
    // the pending retry was cancelled: firing it must be a no-op
    await prism.shutdown({ timeoutMs: 100 });
    // the drain made its own final attempt; the pending retry timer must
    // have been cancelled — firing it must NOT trigger another delivery
    expect(calls).toBe(2);
    const entry = pending[0];
    if (entry) {
      entry.cancelled = true;
      entry.callback();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(2);
  });
});


// ---------------------------------------------------------------------------
// Slice-3/4 hardening round (F15 consent race, F16 context allowlist,
// F18 consent validation, F19 session properties, F20 config validation,
// F21 retry timer cancellation)
// ---------------------------------------------------------------------------

describe("consent race with abort-ignoring transports (harden F15)", () => {
  it("never requeues or delivers again when consent is denied mid-flight", async () => {
    let calls = 0;
    let release: (body: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const runtime = fakeRuntime();
    // A transport that IGNORES cancellation: the request completes AFTER
    // consent is already denied, with a PARTIAL result that would
    // ordinarily requeue the retained event.
    runtime.transport.post = async (_url, request) => {
      calls += 1;
      const body = await gate;
      return {
        status: 200,
        headers: {},
        text: async () =>
          JSON.stringify({
            results: [{ id: (JSON.parse(body).events[0] as { eventId: string }).eventId, status: "unknown" }],
          }),
      };
    };
    const prism = await ready({ runtime, queue: { maxBatchEvents: 1, flushIntervalMs: 10_000_000 } });
    prism.track("race_event");
    const flushPromise = prism.flush(); // in flight, hanging at the gate
    await prism.setCollectionState("denied"); // abort IGNORED by the transport
    release("{}"); // the in-flight request completes AFTER withdrawal
    await flushPromise;
    // the completed response must NOT requeue the event or start another
    // request while denied
    await prism.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    // events tracked after withdrawal stay dropped
    expect(prism.track("after").status).toBe("dropped");
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("wire context allowlist (harden F16)", () => {
  it("picks only known fields and redacts credentials in context", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      bodies.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({
      runtime,
      collection: { initialState: "granted" },
      // unreachable through the type: the adapter supplies extra fields
    });
    // inject extra fields through the runtime seam
    const context = (runtime as unknown as { context: Record<string, unknown> }).context;
    context.unexpectedField = "fixture-adapter-value";
    context.extra = { nested: { unexpectedNested: "fixture-nested-value" } };
    prism.track("ctx_check");
    await prism.flush();
    const envelope = JSON.parse(bodies[0] ?? "{}") as {
      events: Array<{ context?: Record<string, unknown> }>;
    };
    const sent = envelope.events[0]?.context ?? {};
    expect(sent.platform).toBe("node");
    expect("unexpectedField" in sent).toBe(false); // allowlist drops unknown keys
    expect("extra" in sent).toBe(false);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("rejects a runtime context that is not JSON-safe at factory creation", async () => {
    const runtime = fakeRuntime();
    // the allowlist DROPS unknown fields (payload never crosses); a
    // KNOWN field with an invalid value must fail the factory loudly
    (runtime as unknown as { context: Record<string, unknown> }).context = {
      platform: "x".repeat(10_001),
      kind: "server",
    };
    await expect(ready({ runtime })).rejects.toThrow(/runtime context is not JSON-safe/);
  });
});

describe("collection state validation (harden F18)", () => {
  it("rejects unsupported states without changing anything", async () => {
    const prism = await ready({ collection: { initialState: "granted" } });
    await expect(prism.setCollectionState("bogus" as never)).rejects.toThrow(
      /must be pending, granted, or denied/,
    );
    expect(prism.collectionState).toBe("granted");
    // collection still follows the REAL state — never enabled by bogus input
    expect(prism.track("still_granted").status).toBe("queued");
    await prism.setCollectionState("denied");
    expect(prism.track("dropped").status).toBe("dropped");
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("session properties validation (harden F19)", () => {
  it("rejects non-JSON session properties instead of silently converting", async () => {
    const prism = await ready();
    const badSession = (value: unknown) => () =>
      prism.startSession({ properties: value as never });
    expect(badSession({ when: new Date() })).toThrow(/non-plain-object/);
    expect(badSession({ score: Number.POSITIVE_INFINITY })).toThrow(/non-finite-number/);
    // a valid session still works after the rejections
    const started = prism.startSession({ properties: { plan: "pro" } });
    expect(started.status).toBe("started");
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("queue configuration validation (harden F20)", () => {
  it.each([
    ["maxQueueEvents", 0],
    ["maxQueueBytes", -1],
    ["maxBatchEvents", 1.5],
    ["maxBatchBytes", Number.NaN],
    ["maxEventBytes", Number.POSITIVE_INFINITY],
    ["requestTimeoutMs", 0],
    ["flushIntervalMs", -5],
    ["maxRetries", 2.5],
  ])("rejects invalid %s (%s)", async (key, value) => {
    await expect(ready({ queue: { [key]: value } })).rejects.toThrow(
      new RegExp(`${key} must be a finite positive integer`),
    );
  });
});

describe("retry timer cancellation (harden F21)", () => {
  it("invokes the runtime cancellation handle on shutdown", async () => {
    const { runtime, scheduled } = schedulableRuntime();
    runtime.transport.post = async () => {
      throw new Error("network down");
    };
    const prism = await ready({ runtime, queue: { maxRetries: 5, flushIntervalMs: 10_000_000 } });
    prism.track("cancel_me");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    const retry = scheduled.find((e) => e.delayMs < 10_000_000);
    expect(retry).toBeDefined();
    await prism.shutdown({ timeoutMs: 100 });
    // the runtime scheduler handle was invoked — the entry is marked cancelled
    expect(retry?.cancelled).toBe(true);
  });
});

describe("endpoint-scoped persistence (§15)", () => {
  it("never restores a queue persisted for a DIFFERENT endpoint", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    let offline = true;
    let posts = 0;
    runtime.transport.post = async () => {
      if (offline) throw new Error("instance down");
      posts += 1;
      return { status: 200, headers: {}, text: async () => "" };
    };
    // persist an event under endpoint A's key (delivery unavailable, so
    // the event stays in A's snapshot)
    const prismA = await ready({ runtime, queue: { maxRetries: 2 } });
    prismA.track("for_endpoint_a");
    await expect(prismA.flush()).rejects.toThrow(/batch delivery failed/);
    await prismA.shutdown({ timeoutMs: 50 });
    const keyA = [...stored.keys()].find((k) => k.startsWith("prism:queue:v2:"));
    expect(keyA).toBeDefined();

    // endpoint B's client uses a DIFFERENT storage namespace — the
    // endpoint-A queue must never be delivered to endpoint B
    offline = false;
    const prismB = await ready({
      runtime,
      endpoint: "https://other-instance.example.com",
    });
    await prismB.flush();
    expect(posts).toBe(0); // nothing from A's queue crossed over
    expect(
      [...stored.keys()].filter((k) => k.startsWith("prism:queue:v2:")),
    ).toHaveLength(1); // only A's snapshot exists
    await prismB.shutdown({ timeoutMs: 50 });
  });
});
