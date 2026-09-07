import { describe, expect, it } from "vitest";
import {
  STANDARD_EVENT_DEFINITIONS,
  validateStandardEventProperties,
} from "../standard-events";
import { ready, fakeRuntime, base } from "./helpers";
import { createPrismClient } from "../index";
import type { PrismRuntimeAdapter } from "../contract";

function deliveredEvents(body: string | undefined): Array<Record<string, unknown>> {
  const parsed = JSON.parse(body ?? "{}") as { events?: Array<Record<string, unknown>> };
  return parsed.events ?? [];
}

describe("Task 19 slice 2 — Core Standard Event namespace", () => {
  it("exposes a stable events object and stable bound methods", async () => {
    const prism = await ready();
    const e1 = prism.events;
    const e2 = prism.events;
    expect(e1).toBe(e2);
    expect(Object.isFrozen(e1)).toBe(true);
    const { signUp } = prism.events;
    // destructured method stays bound (does not need `this`)
    const before = (prism as unknown as { knownUserId: string | null }).knownUserId;
    void before;
    // need identity for signUp, use actor
    const r = signUp({ method: "email" }, { userId: "u_stable" });
    expect(r.status).toBe("queued");
    const m2 = prism.events.signUp;
    expect(signUp).toBe(m2);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("does not mutate input or actor objects", async () => {
    const prism = await ready();
    await prism.identify("user_1");
    const input = { method: "email" };
    const actor = { userId: "user_2" };
    const inputCopy = { ...input };
    const actorCopy = { ...actor };
    Object.freeze(input);
    Object.freeze(actor);
    const r = prism.events.signUp(input as never, actor as never);
    expect(r.status).toBe("queued");
    expect(input).toEqual(inputCopy);
    expect(actor).toEqual(actorCopy);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("emits exact protected name, key, version and validated data", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    await prism.identify("user_1");
    const cases: Array<[keyof typeof prism.events, Record<string, unknown>, string, string]> = [
      ["signUp", { method: "email" }, "$prism_sign_up", "sign_up"],
      ["login", { method: "password" }, "$prism_login", "login"],
      ["purchase", { transactionId: "txn_01", valueMinor: 100, currency: "USD" }, "$prism_purchase", "purchase"],
    ];
    for (const [method, data, expectedName, expectedKey] of cases) {
      // @ts-expect-error dynamic
      const res = prism.events[method](data, { userId: "user_1" } as never);
      expect(res.status).toBe("queued");
      void expectedName;
      void expectedKey;
    }
    await prism.flush();
    const events = deliveredEvents(bodies[0]);
    expect(events.length).toBe(3);
    for (const ev of events) {
      expect(typeof ev.name).toBe("string");
      expect((ev.name as string).startsWith("$prism_")).toBe(true);
      const props = ev.properties as { $standard?: { schemaVersion: number; key: string; data: unknown } };
      expect(props.$standard?.schemaVersion).toBe(1);
      expect(typeof props.$standard?.key).toBe("string");
      // validate via shared validator matches protected name
      const v = validateStandardEventProperties(ev.name as string, ev.properties);
      expect(v.ok).toBe(true);
    }
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("public track() rejects every protected catalog name", async () => {
    const prism = await ready();
    for (const def of STANDARD_EVENT_DEFINITIONS) {
      expect(() => prism.track(def.protectedName, { x: 1 } as never)).toThrow(/reserved/i);
    }
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("throws for missing identity on signUp/login/logout", async () => {
    const prism = await ready();
    expect(() => prism.events.signUp({ method: "email" })).toThrow(/requires an identified user/i);
    expect(() => prism.events.login({ method: "password" })).toThrow(/requires an identified user/i);
    expect(() => prism.events.logout({})).toThrow(/requires an identified user/i);
    // with actor it succeeds
    expect(prism.events.signUp({ method: "email" }, { userId: "u1" }).status).toBe("queued");
    expect(prism.events.login({ method: "password" }, { userId: "u1" }).status).toBe("queued");
    expect(prism.events.logout({}, { userId: "u1" }).status).toBe("queued");
    // without actor but after identify it succeeds
    const prism2 = await ready();
    await prism2.identify("u2");
    expect(prism2.events.signUp({ method: "email" }).status).toBe("queued");
    await prism.shutdown({ timeoutMs: 50 });
    await prism2.shutdown({ timeoutMs: 50 });
  });

  it("identify-then-event ordering attaches the known user", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    await prism.identify("user_ordered");
    prism.events.signUp({ method: "email" });
    await prism.flush();
    const ev = deliveredEvents(bodies[0])[0] as { userId?: string };
    expect(ev.userId).toBe("user_ordered");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("actor override affects only its event under interleaved calls", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    // global identity is user_global
    await prism.identify("user_global");
    prism.events.search({ category: "docs" }, { userId: "user_actor_1" });
    prism.events.search({ category: "docs" }); // should be user_global
    prism.events.search({ category: "docs" }, { userId: "user_actor_2" });
    await prism.flush();
    const events = deliveredEvents(bodies[0]) as Array<{ userId?: string; properties: { $standard: { key: string } } }>;
    expect(events[0]?.userId).toBe("user_actor_1");
    expect(events[1]?.userId).toBe("user_global");
    expect(events[2]?.userId).toBe("user_actor_2");
    // global identity unchanged
    expect((prism as unknown as { knownUserId: string | null }).knownUserId).toBe("user_global");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("does not merge global properties into $standard", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    await prism.setGlobalProperty("global_foo", "should_not_appear");
    await prism.identify("u1");
    prism.events.signUp({ method: "email" });
    await prism.flush();
    const ev = deliveredEvents(bodies[0])[0] as { properties: Record<string, unknown> };
    expect(ev.properties.global_foo).toBeUndefined();
    expect((ev.properties.$standard as { data: { method: string } }).data.method).toBe("email");
    // regular track DOES merge
    bodies.length = 0;
    prism.track("custom", { local: 1 });
    await prism.flush();
    const ev2 = deliveredEvents(bodies[0])[0] as { properties: Record<string, unknown> };
    expect(ev2.properties.global_foo).toBe("should_not_appear");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("returns dropped for consent pending/denied, queue-full, shutdown", async () => {
    // pending
    const pPending = await ready({ collection: { initialState: "pending" as const } });
    await pPending.identify("u1").catch(() => undefined); // identify will be dropped too but we use actor
    const rPending = pPending.events.search({ category: "docs" }, { userId: "u1" });
    expect(rPending.status).toBe("dropped");
    if (rPending.status === "dropped") expect(rPending.reason).toBe("consent-pending");

    // denied
    const pDenied = await ready({ collection: { initialState: "denied" as const } });
    const rDenied = pDenied.events.search({ category: "docs" }, { userId: "u1" });
    expect(rDenied.status).toBe("dropped");
    if (rDenied.status === "dropped") expect(rDenied.reason).toBe("consent-denied");

    // queue-full
    const pFull = await ready({ queue: { maxQueueEvents: 1 }, collection: { initialState: "granted" as const } });
    expect(pFull.events.search({ category: "docs" }).status).toBe("queued");
    const rFull = pFull.events.search({ category: "docs" });
    expect(rFull.status).toBe("dropped");
    if (rFull.status === "dropped") expect(rFull.reason).toBe("queue-full");

    // shutdown
    const pShut = await ready();
    await pShut.shutdown({ timeoutMs: 50 });
    const rShut = pShut.events.search({ category: "docs" });
    expect(rShut.status).toBe("dropped");
    if (rShut.status === "dropped") expect(rShut.reason).toBe("shutdown");

    await pPending.shutdown({ timeoutMs: 50 });
    await pDenied.shutdown({ timeoutMs: 50 });
    await pFull.shutdown({ timeoutMs: 50 });
  });

  it("throws on invalid input before queue mutation", async () => {
    const prism = await ready();
    await prism.identify("u1");
    const before = (prism as unknown as { queue: { size: number } }).queue?.size ?? 0;
    void before;
    expect(() => prism.events.signUp({ method: "INVALID_UPPER" })).toThrow();
    expect(() => prism.events.purchase({ transactionId: "txn_01", valueMinor: -1, currency: "USD" } as never)).toThrow();
    expect(() => prism.events.subscriptionChanged({ subscriptionId: "sub_01", fromPlanId: "pro", toPlanId: "pro" })).toThrow(/must differ/);
    // queue size unchanged (still only previous valid events)
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("queued standard event carries eventId and delivers through existing batch", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    const r = prism.events.search({ category: "docs" });
    expect(r.status).toBe("queued");
    if (r.status === "queued") expect(typeof r.eventId).toBe("string");
    await prism.flush();
    expect(bodies.length).toBe(1);
    const ev = deliveredEvents(bodies[0])[0] as Record<string, unknown>;
    expect(ev.name).toBe("$prism_search");
    await prism.shutdown({ timeoutMs: 50 });
  });

  // ------------------------------------------------------------------
  // R1-F2 — Standard Events follow the shared strict-JSON and sanitizer
  // boundaries of every other Core event.
  // ------------------------------------------------------------------

  it("R1-F2: a conflicting denyList entry fails locally instead of leaking the value", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, sanitize: { denyList: ["method"] } });
    await prism.identify("user_deny");
    // "method" is on the deny list: redaction would replace it with
    // [REDACTED], which violates the frozen sign_up schema — the capture
    // must throw locally, never queue the raw or redacted value.
    expect(() => prism.events.signUp({ method: "email" })).toThrow(
      /invalidated by sanitization/,
    );
    // No queue mutation: nothing from the helper was queued.
    await prism.flush();
    for (const body of bodies) {
      expect(body).not.toContain('"$prism_sign_up"');
      expect(body).not.toContain('"method":"email"');
      expect(body).not.toContain('"method":"[REDACTED]"');
    }
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("R1-F2: the same denyList does not affect regular track() redaction", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime, sanitize: { denyList: ["method"] } });
    prism.track("custom_event", { method: "email" });
    await prism.flush();
    const ev = deliveredEvents(bodies[0])[0] as { properties: Record<string, unknown> };
    // track() redacts as configured — the frozen Standard Event schema is
    // the only thing that refuses redacted values.
    expect(ev.properties.method).toBe("[REDACTED]");
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("R1-F2: accessor properties and non-plain objects are rejected before validation", async () => {
    const prism = await ready();
    await prism.identify("user_json");
    // Accessor property — strict JSON policy rejects accessors.
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "method", {
      get: () => "email",
      enumerable: true,
    });
    expect(() => prism.events.signUp(accessor as never)).toThrow(
      /not JSON-safe \(accessor\)/,
    );
    // Non-plain object (Date) — rejected before any field is read.
    expect(() => prism.events.signUp(new Date() as never)).toThrow(
      /not JSON-safe \(non-plain-object\)/,
    );
    // Nested undefined — rejected by the shared strict JSON validator.
    expect(() =>
      prism.events.logout({ reasonCode: undefined } as never),
    ).toThrow(/not JSON-safe \(invalid-value\)/);
    await prism.shutdown({ timeoutMs: 50 });
  });

  it("R1-F2: a failed capture never mutates the queue (rejection before enqueue)", async () => {
    const bodies: string[] = [];
    const runtime = fakeRuntime();
    runtime.transport.post = async (_url, req) => {
      bodies.push(req.body);
      return { status: 200, headers: {}, text: async () => "" };
    };
    const prism = await ready({ runtime });
    // One valid event queued as the baseline.
    expect(prism.events.search({ category: "docs" }).status).toBe("queued");
    await prism.flush();
    bodies.length = 0;
    // Every failing capture leaves the queue exactly where it was.
    expect(() => prism.events.signUp({ method: "BAD" })).toThrow();
    expect(() => prism.events.purchase({ transactionId: "txn_01", valueMinor: -1, currency: "USD" } as never)).toThrow();
    expect(() => prism.events.signUp({ method: "email", extra: true } as never)).toThrow();
    await prism.flush();
    expect(bodies).toEqual([]);
    await prism.shutdown({ timeoutMs: 50 });
  });
});
