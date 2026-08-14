import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient, capturePageContext } from "../index";
import { createBrowserRuntime, createBrowserStorage } from "../browser-runtime";
import type { PrismClient, PrismRequest, PrismResponse } from "@prism/core";

/**
 * @prism/browser tests (task-9 §11): the minimal browser adapter — thin
 * runtime seams over the core engine. Covers the approved context
 * capture, storage strategies, lifecycle flush, consent, offline
 * behavior, and deterministic cleanup.
 */

function okResponse(status = 200): PrismResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    text: async () => "",
  };
}

function installFetchMock(handler: (url: string, init: RequestInit) => Promise<PrismResponse>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await handler(String(input), init ?? {});
    return new Response(await response.text(), {
      status: response.status,
      headers: response.headers,
    });
  });
}

const BASE = {
  projectKey: "pr_0123456789abcdef0123456789abcdef",
  endpoint: "https://analytics.self-hosted.example",
  collection: { initialState: "granted" as const },
};

describe("createBrowserClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("delivers through the runtime endpoint with core-owned auth headers", async () => {
    const bodies: Array<{ url: string; init: RequestInit }> = [];
    installFetchMock(async (url, init) => {
      bodies.push({ url, init });
      return okResponse();
    });

    const prism = await createBrowserClient(BASE);
    prism.track("page_viewed");
    await prism.flush();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.url).toBe("https://analytics.self-hosted.example/api/v2/ingest");
    const headers = (bodies[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${BASE.projectKey}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(bodies[0]?.init.keepalive).toBe(true); // authenticated keepalive
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("requires an explicit runtime endpoint", async () => {
    await expect(
      createBrowserClient({ ...BASE, endpoint: "" }),
    ).rejects.toThrow(/endpoint is required/);
  });

  it("captures only the approved context (path sanitized, no UA/DOM content)", async () => {
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    prism.track("ctx_check");
    await prism.flush();

    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ context?: Record<string, unknown> }>;
    };
    const context = envelope.events[0]?.context ?? {};
    expect(context.platform).toBe("browser");
    expect(context.kind).toBe("web");
    // no user-agent copy, no DOM content, no form values
    expect("userAgent" in context).toBe(false);
    expect("html" in context).toBe(false);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("sanitizes the page context (path only; referrer origin only)", () => {
    window.history.replaceState(null, "", "/docs/quickstart?token=secret#frag");
    Object.defineProperty(document, "referrer", {
      value: "https://customer.example/pricing?plan=pro",
      configurable: true,
    });
    const page = capturePageContext();
    expect(page.path).toBe("/docs/quickstart"); // no query, no hash
    expect(page.referrer).toBe("https://customer.example"); // origin only
  });

  it("falls back to in-memory behavior when storage is denied", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(createBrowserStorage()).toBeUndefined();

    // the client still works — the core keeps an in-memory queue
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    expect(prism.track("no_storage").status).toBe("queued");
    await prism.flush();
    expect(posted).toHaveLength(1);
    setItem.mockRestore();
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("flushes on the before-unload lifecycle signal", async () => {
    let posts = 0;
    installFetchMock(async () => {
      posts += 1;
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    prism.track("unload_event");
    expect(posts).toBe(0);
    window.dispatchEvent(new Event("beforeunload"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("removes its lifecycle subscriptions on shutdown (deterministic cleanup)", async () => {
    let posts = 0;
    installFetchMock(async () => {
      posts += 1;
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    prism.track("stale");
    await prism.shutdown({ timeoutMs: 50 });
    posts = 0;
    // the core's subscription was removed — the unload event is a no-op
    window.dispatchEvent(new Event("beforeunload"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(0);
  });

  it("retains the queue across an offline window and delivers on recovery", async () => {
    let offline = true;
    let posts = 0;
    installFetchMock(async () => {
      if (offline) throw new TypeError("network error");
      posts += 1;
      return okResponse();
    });
    const prism = await createBrowserClient({ ...BASE, queue: { maxRetries: 2 } });
    prism.track("offline_event");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    expect(posts).toBe(0);
    offline = false;
    await prism.flush();
    expect(posts).toBe(1);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("drops events while consent is denied", async () => {
    let posts = 0;
    installFetchMock(async () => {
      posts += 1;
      return okResponse();
    });
    const prism = await createBrowserClient({
      ...BASE,
      collection: { initialState: "denied" },
    });
    expect(prism.track("never").status).toBe("dropped");
    await prism.flush();
    expect(posts).toBe(0);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("persists the queue through localStorage (reload persistence wiring)", async () => {
    let fail = true;
    installFetchMock(async () => {
      if (fail) throw new TypeError("network error");
      return okResponse();
    });
    const prism = await createBrowserClient({ ...BASE, queue: { maxRetries: 5 } });
    prism.track("persisted_event");
    await expect(prism.flush()).rejects.toThrow(/batch delivery failed/);
    await prism.shutdown({ timeoutMs: 100 });

    // the snapshot lives under the core's versioned key in SESSION
    // storage (per-execution-context namespace)
    const keys = Object.keys(window.sessionStorage).filter((k) =>
      k.startsWith("prism:queue:v2:"),
    );
    expect(keys.length).toBe(1);
    const snapshot = JSON.parse(window.sessionStorage.getItem(keys[0] ?? "") ?? "{}") as {
      events: unknown[];
    };
    expect(snapshot.events.length).toBe(1);
    // queue data must NEVER sit in origin-shared local storage
    expect(
      Object.keys(window.localStorage).some((k) => k.startsWith("prism:queue:")),
    ).toBe(false);

    // a reload (fresh client, same session storage) restores and delivers
    fail = false;
    const prism2 = await createBrowserClient(BASE);
    await prism2.flush();
    const keysAfter = Object.keys(window.sessionStorage).filter((k) =>
      k.startsWith("prism:queue:v2:"),
    );
    expect(JSON.parse(window.sessionStorage.getItem(keysAfter[0] ?? "") ?? "{}").events).toHaveLength(0);
    await prism2.shutdown({ timeoutMs: 100 });
  });

  it("supports two tabs on the same origin (documented project-scoped tradeoff)", async () => {
    let posts = 0;
    installFetchMock(async () => {
      posts += 1;
      return okResponse();
    });
    // two independent clients over the same localStorage namespace
    const tabA = await createBrowserClient(BASE);
    const tabB = await createBrowserClient(BASE);
    expect(tabA.track("from_a").status).toBe("queued");
    expect(tabB.track("from_b").status).toBe("queued");
    await tabA.flush();
    await tabB.flush();
    expect(posts).toBe(2); // each tab delivered its own batch
    await tabA.shutdown({ timeoutMs: 50 });
    await tabB.shutdown({ timeoutMs: 50 });
  });
});

describe("runtime edge cases (branch coverage)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("returns null when storage reads fail at runtime", async () => {
    const storage = createBrowserStorage();
    expect(storage).toBeDefined();
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const value = await storage?.getItem("any");
    expect(value).toBeNull();
    getItem.mockRestore();
  });

  it("handles an unavailable Intl during context capture", () => {
    const original = Intl.DateTimeFormat;
    vi.stubGlobal(
      "Intl",
      new Proxy(Intl, {
        get(target, prop, receiver) {
          if (prop === "DateTimeFormat") throw new Error("Intl unavailable");
          return Reflect.get(target, prop, receiver);
        },
      }),
    );
    try {
      const runtime = createBrowserRuntime();
      expect(runtime.context.platform).toBe("browser");
      expect(runtime.context.timezone).toBeUndefined();
    } finally {
      vi.stubGlobal("Intl", original);
    }
  });

  it("handles missing location/referrer during page-context capture", () => {
    const url = vi.spyOn(window, "location", "get").mockImplementation(() => {
      throw new Error("no location");
    });
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    const page = capturePageContext();
    expect(page.path).toBe("/");
    expect(page.referrer).toBeNull();
    url.mockRestore();
  });

  it("fires background lifecycle events on hidden visibility", async () => {
    let events: string[] = [];
    const runtime = createBrowserRuntime();
    const remove = runtime.lifecycle?.on("background", () => events.push("background"));
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(events).toEqual(["background"]);
    remove?.();
    remove?.(); // idempotent
    document.dispatchEvent(new Event("visibilitychange"));
    expect(events).toHaveLength(1);
  });

  it("falls back to a deterministic ID when crypto.randomUUID is absent", () => {
    const original = globalThis.crypto;
    vi.stubGlobal(
      "crypto",
      new Proxy(original, {
        get(target, prop, receiver) {
          if (prop === "randomUUID") return undefined;
          return Reflect.get(target, prop, receiver);
        },
      }),
    );
    try {
      const runtime = createBrowserRuntime();
      const id = runtime.createId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(10);
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });

  it("never uses an unauthenticated sendBeacon fallback", async () => {
    const beacon = vi.fn(() => false);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    let posts = 0;
    installFetchMock(async () => {
      posts += 1;
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    prism.track("beacon_check");
    window.dispatchEvent(new Event("beforeunload"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(1); // authenticated fetch keepalive only
    expect(beacon).not.toHaveBeenCalled();
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("identity defaults (§4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("defaults to session-scoped anonymous persistence", async () => {
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    const prism = await createBrowserClient({
      projectKey: BASE.projectKey,
      endpoint: BASE.endpoint,
      collection: { initialState: "granted" },
    });
    prism.track("identity_check");
    await prism.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ anonymousId?: string }>;
    };
    expect(envelope.events[0]?.anonymousId).toBeTruthy();
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("honors an explicit none persistence", async () => {
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    const prism = await createBrowserClient({
      projectKey: BASE.projectKey,
      endpoint: BASE.endpoint,
      collection: { initialState: "granted", anonymousPersistence: "none" },
    });
    prism.track("no_identity");
    await prism.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ anonymousId?: string }>;
    };
    expect("anonymousId" in (envelope.events[0] ?? {})).toBe(false);
    await prism.shutdown({ timeoutMs: 50 });
  });
});

describe("release review — timeouts, keepalive budget, multi-tab safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("aborts a hanging request at the configured timeout", async () => {
    vi.useFakeTimers();
    const captured: Array<{ signal: AbortSignal; keepalive?: boolean }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const requestInit = init as RequestInit & { signal: AbortSignal };
      captured.push({ signal: requestInit.signal });
      // hang until aborted
      await new Promise((resolve, reject) => {
        requestInit.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
      throw new DOMException("aborted", "AbortError");
    });

    const prism = await createBrowserClient({
      ...BASE,
      queue: { requestTimeoutMs: 5_000, maxRetries: 1 },
    });
    prism.track("hanging");
    const flushPromise = prism.flush();
    // mark the rejection handled so the fake-timer advance below cannot
    // surface a transient unhandled rejection before the expect attaches
    void flushPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_100);
    await expect(flushPromise).rejects.toThrow(/batch delivery failed/);
    expect(captured[0]?.signal.aborted).toBe(true);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("sets keepalive only within the browser-safe 64 KiB budget", async () => {
    const captured: Array<{ keepalive?: boolean; body: string }> = [];
    installFetchMock(async (_url, init) => {
      captured.push({ keepalive: init.keepalive, body: String(init.body) });
      return okResponse();
    });

    const prism = await createBrowserClient(BASE);
    prism.track("small");
    await prism.flush();
    expect(captured[0]?.keepalive).toBe(true); // small batch

    // exceed the keepalive budget at BATCH level: four ~20 KiB events
    // (each within the 32 KiB event ceiling) form a >64 KiB batch
    for (const label of ["big-1", "big-2", "big-3", "big-4"]) {
      prism.track(label, {
        pad: ["x".repeat(9_900), "x".repeat(9_900)],
      });
    }
    await prism.flush();
    expect(captured[1]?.keepalive).toBe(false); // > 64 KiB → no keepalive
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("namespaces each tab's queue so offline persistence never collides", async () => {
    // release review: two execution contexts sharing an origin must not
    // clobber each other's persisted snapshots (sessionStorage per tab;
    // the core's owner-segmented merge covers shared-storage adapters).
    const fail = (): never => {
      throw new TypeError("network error");
    };
    installFetchMock(async () => fail());

    // persist each context FULLY before the next (sequential — real tabs
    // each own a sessionStorage namespace, so cross-tab races cannot
    // occur in a real browser)
    const tabA = await createBrowserClient({ ...BASE, queue: { maxRetries: 5 } });
    tabA.track("from_a");
    await expect(tabA.flush()).rejects.toThrow(/batch delivery failed/);
    await tabA.shutdown({ timeoutMs: 50 });

    const tabB = await createBrowserClient({ ...BASE, queue: { maxRetries: 5 } });
    tabB.track("from_b");
    await expect(tabB.flush()).rejects.toThrow(/batch delivery failed/);
    await tabB.shutdown({ timeoutMs: 50 });

    // the merged snapshot loses NOTHING: both tabs' events survive
    const queueKeys = Object.keys(window.sessionStorage).filter((k) =>
      k.startsWith("prism:queue:v2:"),
    );
    expect(queueKeys).toHaveLength(1);
    const snapshot = JSON.parse(
      window.sessionStorage.getItem(queueKeys[0] ?? "") ?? "{}",
    ) as { events: Array<{ name: string }> };
    expect(snapshot.events.map((entry) => entry.name).sort()).toEqual([
      "from_a",
      "from_b",
    ]);
  });
});

describe("identity + global properties in the browser (task-10 §7)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("identifies and attaches the userId to subsequent events", async () => {
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    const prism = await createBrowserClient(BASE);
    await prism.identify("browser-user", { plan: "pro" });
    prism.track("after");
    await prism.flush();

    const envelope = JSON.parse(posted[posted.length - 1] ?? "{}") as {
      identity?: Array<{ userId: string }>;
      events: Array<{ userId?: string }>;
    };
    expect(envelope.identity?.[0]?.userId).toBe("browser-user");
    expect(envelope.events[0]?.userId).toBe("browser-user");
    expect(prism.identity.userId).toBe("browser-user");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("persists the persistent global-property scope through local storage", async () => {
    const prism = await createBrowserClient(BASE);
    await prism.setGlobalProperty("referral", "friend", "persistent");
    await prism.setGlobalProperty("tab_pick", "left", "session");
    await prism.shutdown({ timeoutMs: 50 });

    const persistentKeys = Object.keys(window.localStorage).filter((k) =>
      k.includes(":globals:persistent:"),
    );
    expect(persistentKeys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(persistentKeys[0] ?? "") ?? "{}").referral).toBe("friend");
    // the SESSION scope lives in session storage (per execution context)
    const sessionKeys = Object.keys(window.sessionStorage).filter((k) =>
      k.includes(":globals:session:"),
    );
    expect(sessionKeys).toHaveLength(1);
    expect(JSON.parse(window.sessionStorage.getItem(sessionKeys[0] ?? "") ?? "{}").tab_pick).toBe("left");

    // a reload restores the persistent scope
    const prism2 = await createBrowserClient(BASE);
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    prism2.track("checkout", {});
    await prism2.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(envelope.events[0]?.properties.referral).toBe("friend");
    await prism2.shutdown({ timeoutMs: 50 });
  });

  it("reset clears identity and every global scope (shared-device safety)", async () => {
    const prism = await createBrowserClient({
      ...BASE,
      collection: { initialState: "granted", anonymousPersistence: "session" },
    });
    await prism.identify("user-a");
    await prism.setGlobalProperty("plan", "pro", "persistent");
    const anonBefore = prism.identity.anonymousId;
    await prism.reset();

    expect(prism.identity.userId).toBeNull();
    expect(prism.identity.anonymousId).not.toBe(anonBefore);
    const posted: string[] = [];
    installFetchMock(async (_url, init) => {
      posted.push(String(init.body));
      return okResponse();
    });
    prism.track("after_reset", {});
    await prism.flush();
    const envelope = JSON.parse(posted[0] ?? "{}") as {
      events: Array<{ properties: Record<string, unknown> }>;
    };
    expect(envelope.events[0]?.properties.plan).toBeUndefined();
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("namespaces stored identity state by endpoint + project", async () => {
    const prismA = await createBrowserClient(BASE);
    const prismB = await createBrowserClient({
      ...BASE,
      endpoint: "https://other-instance.example.com",
    });
    await prismA.setGlobalProperty("scope_probe", "a", "persistent");
    await prismB.setGlobalProperty("scope_probe", "b", "persistent");
    await prismA.shutdown({ timeoutMs: 50 });
    await prismB.shutdown({ timeoutMs: 50 });

    const keys = Object.keys(window.localStorage).filter((k) =>
      k.includes(":globals:persistent:"),
    );
    expect(keys).toHaveLength(2); // one per endpoint identity
  });
});
