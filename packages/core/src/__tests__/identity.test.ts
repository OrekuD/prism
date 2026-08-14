import { describe, expect, it } from "vitest";
import { createPrismClient, type PrismRuntimeAdapter } from "../index";
import { fakeRuntime, memoryStorage, ready, base } from "./helpers";

/**
 * Task-10 §2 behavioral contract: identity + global properties. These
 * tests are written FIRST (TDD) — they fail against the task-9 core
 * (no identify/reset/global-property methods) and go green with §3.
 */

describe("identify (task-10 §2)", () => {
  it("links the current anonymous identity to a developer-supplied userId", async () => {
    const prism = await ready({
      collection: { initialState: "granted", anonymousPersistence: "session" },
    });
    const anonBefore = prism.identity.anonymousId;
    expect(prism.identity.userId).toBeNull();

    const result = await prism.identify("user-123", { plan: "pro" });

    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.userId).toBe("user-123");
      expect(result.anonymousId).toBe(anonBefore);
      expect(result.opId.length).toBeGreaterThan(3);
    }
    expect(prism.identity.userId).toBe("user-123");
    expect(prism.identity.anonymousId).toBe(anonBefore);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("keeps identify() and immediately-following track() in ONE ordered context", async () => {
    const posted: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      posted.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, collection: { initialState: "granted" } });
    const idResult = await prism.identify("user-123");
    prism.track("after_identify");
    await prism.flush();

    const envelope = JSON.parse(posted[posted.length - 1] ?? "{}") as {
      identity?: Array<{ userId: string }>;
      events: Array<{ userId?: string; name: string }>;
    };
    // the track event attached to the NEW identity context
    expect(envelope.identity?.[0]?.userId).toBe("user-123");
    const event = envelope.events.find((e) => e.name === "after_identify");
    expect(event?.userId).toBe("user-123");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("is state-idempotent for repeated identical calls", async () => {
    const prism = await ready();
    await prism.identify("user-123");
    await prism.identify("user-123");
    expect(prism.identity.userId).toBe("user-123");
    expect(prism.identity.lastOpId).toBeTruthy();
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("never merges two known people over a shared anonymous context", async () => {
    const prism = await ready();
    await prism.identify("user-a");
    const anonA = prism.identity.anonymousId;
    // a DIFFERENT user on the same device — the anonymous context rotates
    await prism.identify("user-b");
    expect(prism.identity.userId).toBe("user-b");
    expect(prism.identity.anonymousId).not.toBe(anonA);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("works across devices: two clients, same userId, both envelopes carry it", async () => {
    const postedA: string[] = [];
    const runtimeA = fakeRuntime();
    runtimeA.transport.post = async (_url, request) => {
      postedA.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const postedB: string[] = [];
    const runtimeB = fakeRuntime();
    runtimeB.transport.post = async (_url, request) => {
      postedB.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prismA = await ready({ runtime: runtimeA, collection: { initialState: "granted" } });
    const prismB = await ready({ runtime: runtimeB, collection: { initialState: "granted" } });
    await prismA.identify("cross-device-user");
    await prismB.identify("cross-device-user");
    prismA.track("from_device_a");
    prismB.track("from_device_b");
    await prismA.flush();
    await prismB.flush();

    for (const body of [...postedA, ...postedB]) {
      const envelope = JSON.parse(body) as {
        identity?: Array<{ userId: string }>;
        events: Array<{ userId?: string }>;
      };
      const ids = [
        ...(envelope.identity ?? []).map((op) => op.userId),
        ...envelope.events.map((e) => e.userId ?? ""),
      ];
      expect(ids).toContain("cross-device-user");
    }
    await prismA.shutdown({ timeoutMs: 50 });
    await prismB.shutdown({ timeoutMs: 50 });
  });

  it("drops identify under denied consent without persisting anything", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const prism = await ready({
      runtime,
      collection: { initialState: "denied", anonymousPersistence: "persistent" },
    });
    const result = await prism.identify("user-x", { plan: "pro" });
    expect(result.status).toBe("dropped");
    if (result.status === "dropped") expect(result.reason).toBe("consent-denied");
    expect(prism.identity.userId).toBeNull();
    // nothing identity-related persisted
    const keys = [...stored.keys()];
    expect(keys.some((k) => k.includes("identity") || k.includes("traits"))).toBe(false);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("survives storage failure with one stable in-memory state + a safe diagnostic", async () => {
    const codes: string[] = [];
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: {
        getItem: async () => {
          throw new Error("quota");
        },
        setItem: async () => {
          throw new Error("quota");
        },
        removeItem: async () => {
          throw new Error("quota");
        },
      },
    };
    const prism = await ready({ runtime });
    prism.onDiagnostic((d) => codes.push(d.code));

    const result = await prism.identify("user-storage", { plan: "pro" });

    expect(result.status).toBe("queued"); // memory state is stable
    expect(prism.identity.userId).toBe("user-storage");
    // the diagnostic is coarse — never leaks the ID or traits
    const message = codes.join(" ");
    expect(message).not.toContain("user-storage");
    expect(message).not.toContain("pro");
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("reset (task-10 §2)", () => {
  it("rotates the anonymous ID, clears the known user, and isolates queued events", async () => {
    const posted: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      posted.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "session" },
    });
    await prism.identify("user-123");
    // queue an event BEFORE reset — it keeps its immutable identity context
    prism.track("before_reset");
    const anonBefore = prism.identity.anonymousId;

    const result = await prism.reset();

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.anonymousId).not.toBe(anonBefore);
    expect(prism.identity.userId).toBeNull();
    expect(prism.identity.anonymousId).not.toBe(anonBefore);

    await prism.flush();
    // the pre-reset event still carries the ORIGINAL identity context
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ name: string; anonymousId?: string }>;
    };
    const before = envelope.events.find((e) => e.name === "before_reset");
    expect(before?.anonymousId).toBe(anonBefore);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("closes the active session", async () => {
    const prism = await ready();
    const session = prism.startSession();
    expect(prism.session).not.toBeNull();
    await prism.reset();
    expect(prism.session).toBeNull();
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("global properties (task-10 §2)", () => {
  it("merges globals under event properties WITHOUT mutating stored globals", async () => {
    const posted: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, request) => {
      posted.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, collection: { initialState: "granted" } });
    await prism.setGlobalProperty("plan", "pro");
    await prism.setGlobalProperty("theme", "dark");
    prism.track("checkout", { plan: "enterprise" });
    await prism.flush();

    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ name: string; properties: Record<string, unknown> }>;
    };
    const event = envelope.events.find((e) => e.name === "checkout");
    expect(event?.properties.plan).toBe("enterprise"); // event wins
    expect(event?.properties.theme).toBe("dark"); // global fills the rest

    // the stored globals were NOT mutated by the event
    const second: string[] = [];
    runtime.transport.post = async (_url, request) => {
      second.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    prism.track("another", {});
    await prism.flush();
    const envelope2 = JSON.parse(second[0] ?? "{}") as {
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(envelope2.events[0]?.properties.plan).toBe("pro");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("persists the persistent scope through storage", async () => {
    const stored = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      ...fakeRuntime(),
      storage: memoryStorage(stored),
    };
    const prism = await ready({ runtime });
    await prism.setGlobalProperty("referral", "friend", "persistent");
    await prism.shutdown({ timeoutMs: 50 });

    // a fresh client restores the persistent scope
    const prism2 = await ready({ runtime });
    const posted: string[] = [];
    runtime.transport.post = async (_url, request) => {
      posted.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    prism2.track("checkout", {});
    await prism2.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(envelope.events[0]?.properties.referral).toBe("friend");
    await prism2.shutdown({ timeoutMs: 50 });
  });

  it("clears globals on reset (all scopes)", async () => {
    const prism = await ready();
    await prism.setGlobalProperty("a", 1);
    await prism.setGlobalProperty("b", 2, "session");
    await prism.reset();
    const posted: string[] = [];
    prism.runtime.transport.post = async (_url, request) => {
      posted.push(request.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    prism.track("after_reset", {});
    await prism.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(envelope.events[0]?.properties.a).toBeUndefined();
    expect(envelope.events[0]?.properties.b).toBeUndefined();
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("RN-shaped fake runtime (task-10 §2)", () => {
  it("works with async storage, lifecycle, and NO DOM globals", async () => {
    // this test file itself runs in Node — no window/document anywhere
    expect(typeof window).toBe("undefined");
    const store = new Map<string, string>();
    const runtime: PrismRuntimeAdapter = {
      name: "react-native-shape",
      now: () => Date.now(),
      createId: () => crypto.randomUUID(),
      transport: {
        post: async (_url, request) => {
          // offline: the request is never delivered, the queue holds it
          throw new TypeError("offline");
        },
      },
      schedule: (delayMs, callback) => {
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
      },
      context: { platform: "mobile", kind: "mobile" },
      storage: {
        getItem: async (key) => store.get(key) ?? null,
        setItem: async (key, value) => {
          store.set(key, value);
        },
        removeItem: async (key) => {
          store.delete(key);
        },
      },
      lifecycle: {
        on: (event, listener) => {
          const handlers: Record<string, () => void> = {
            foreground: () => listener(),
            background: () => listener(),
            "before-unload": () => listener(),
          };
          return () => undefined;
        },
      },
    };
    const prism = await createPrismClient({
      projectKey: base.projectKey,
      endpoint: base.endpoint,
      runtime,
      collection: { initialState: "granted", anonymousPersistence: "persistent" },
    });
    prism.track("rn_event");
    await prism.identify("rn-user", { platform: "mobile" });
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    // the offline queue persists through the async storage
    const persisted = [...store.values()].some((v) => v.includes("rn_event"));
    expect(persisted).toBe(true);
    await prism.shutdown({ timeoutMs: 100 });
  });
});
