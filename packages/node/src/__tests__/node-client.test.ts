import { describe, expect, it, vi } from "vitest";
import { createNodeClient } from "../index";
import { createNodeRuntime } from "../node-runtime";

function fakeFetch() {
  return async () => ({
    status: 200,
    headers: {} as Record<string, string>,
    text: async () => "",
  });
}

describe("createNodeClient (task-19 slice 3)", () => {
  it("requires explicit endpoint, sourceKey, and collection.initialState", async () => {
    await expect(
      createNodeClient({ sourceKey: "", endpoint: "https://api.example.com", collection: { initialState: "granted" } } as never),
    ).rejects.toThrow(/sourceKey/);
    await expect(
      createNodeClient({ sourceKey: "pr_123", endpoint: "", collection: { initialState: "granted" } } as never),
    ).rejects.toThrow(/endpoint/);
    await expect(
      createNodeClient({ sourceKey: "pr_123", endpoint: "https://api.example.com", collection: { initialState: "granted" as const } }),
    ).resolves.toBeDefined();
    // missing initialState
    await expect(
      createNodeClient({ sourceKey: "pr_123", endpoint: "https://api.example.com", collection: {} as never }),
    ).rejects.toThrow(/initialState/);
  });

  it("exposes the same stable events namespace as core", async () => {
    const origFetch = globalThis.fetch;
    // @ts-ignore mock
    globalThis.fetch = fakeFetch() as unknown as typeof fetch;
    const prism = await createNodeClient({
      sourceKey: "pr_node_test_123",
      endpoint: "https://analytics.example.com",
      collection: { initialState: "granted" },
    });
    expect(prism.events).toBeDefined();
    expect(typeof prism.events.signUp).toBe("function");
    expect(prism.events).toBe(prism.events);
    // actor-safe interleaved
    const bodies: string[] = [];
    // intercept transport by reaching into runtime? Use a custom runtime via createNodeRuntime override? Instead verify queueing via events
    // Use the client's actual transport mock by replacing fetch
    const seen: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = init.body as string;
      seen.push(JSON.parse(body) as Record<string, unknown>);
      return { status: 200, headers: new Headers(), text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
    const prism2 = await createNodeClient({
      sourceKey: "pr_node_test_456",
      endpoint: "https://analytics.example.com",
      collection: { initialState: "granted" },
    });
    // use per-call actors concurrently
    const r1 = prism2.events.subscriptionCancelled(
      { subscriptionId: "sub_01", planId: "pro_monthly" },
      { userId: "user_a" },
    );
    const r2 = prism2.events.subscriptionCancelled(
      { subscriptionId: "sub_02", planId: "pro_monthly" },
      { userId: "user_b" },
    );
    expect(r1.status).toBe("queued");
    expect(r2.status).toBe("queued");
    await prism2.flush();
    // last body contains both events with distinct userIds
    const last = seen[seen.length - 1] as { events: Array<{ userId?: string }> };
    const ids = last.events.map((e) => e.userId).sort();
    expect(ids).toEqual(["user_a", "user_b"]);
    await prism.shutdown({ timeoutMs: 50 });
    await prism2.shutdown({ timeoutMs: 50 });
    globalThis.fetch = origFetch;
  });

  it("nodeCreateId fails loudly when secure random is unavailable", async () => {
    const orig = (globalThis as unknown as { crypto?: Crypto }).crypto;
    vi.stubGlobal("crypto", undefined as unknown as Crypto);
    expect(() => createNodeRuntime().createId()).toThrow(/no secure random/);
    vi.stubGlobal("crypto", orig as unknown as Crypto);
    vi.unstubAllGlobals();
  });

  it("does not install uncaughtException handlers", async () => {
    const before = process.listenerCount("uncaughtException");
    const origFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = fakeFetch() as unknown as typeof fetch;
    const prism = await createNodeClient({
      sourceKey: "pr_node_test_789",
      endpoint: "https://analytics.example.com",
      collection: { initialState: "granted" },
    });
    expect(process.listenerCount("uncaughtException")).toBe(before);
    await prism.shutdown({ timeoutMs: 50 });
    globalThis.fetch = origFetch;
  });
});
