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

    // the snapshot lives under the core's versioned key in localStorage
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("prism:queue:v2:"),
    );
    expect(keys.length).toBe(1);
    const snapshot = JSON.parse(window.localStorage.getItem(keys[0] ?? "") ?? "{}") as {
      events: unknown[];
    };
    expect(snapshot.events.length).toBe(1);

    // a reload (fresh client, same origin storage) restores and delivers
    fail = false;
    const prism2 = await createBrowserClient(BASE);
    await prism2.flush();
    const keysAfter = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("prism:queue:v2:"),
    );
    expect(JSON.parse(window.localStorage.getItem(keysAfter[0] ?? "") ?? "{}").events).toHaveLength(0);
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
