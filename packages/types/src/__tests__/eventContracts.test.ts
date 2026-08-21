import { describe, expect, it } from "vitest";
import {
  decodeEventCursor,
  encodeEventCursor,
  type EventFilterRequest,
  type EventListItemResource,
} from "../network/resources";

describe("Task 16 slice 1 — event contracts and cursor", () => {
  it("round-trips a cursor", () => {
    const cur = { receivedAt: Date.now(), id: "550e8400-e29b-41d4-a716-446655440000" };
    const enc = encodeEventCursor(cur);
    expect(typeof enc).toBe("string");
    expect(enc.length).toBeGreaterThan(10);
    // opaque — no JSON leakage
    expect(enc).not.toContain("receivedAt");
    const dec = decodeEventCursor(enc);
    expect(dec).toEqual(cur);
  });

  it("rejects invalid cursors safely", () => {
    expect(decodeEventCursor("")).toBeNull();
    expect(decodeEventCursor("not-base64!")).toBeNull();
    expect(decodeEventCursor(encodeEventCursor({ receivedAt: NaN, id: "x" }))).toBeNull();
    // tampered id
    const good = encodeEventCursor({ receivedAt: 123, id: "abc" });
    expect(decodeEventCursor(good + "xxx")).toBeNull();
  });

  it("EventListItemResource carries source attribution with exact platform", () => {
    const item: EventListItemResource = {
      id: "evt_1",
      projectId: "proj_1",
      name: "checkout_completed",
      type: "track",
      occurredAt: Date.now(),
      receivedAt: Date.now(),
      personId: "person_1",
      sessionId: "sess_1",
      source: { id: "src_1", name: "Acme Web", platform: "web", status: "active" },
    };
    expect(item.source?.platform).toBe("web");
    // archived sources retain exact platform
    const archived: EventListItemResource = {
      ...item,
      source: { id: "src_2", name: "Old RN", platform: "react-native", status: "archived" },
    };
    expect(archived.source?.platform).toBe("react-native");
    expect(archived.source?.status).toBe("archived");
  });

  it("EventFilterRequest is bounded and nullable", () => {
    const f: EventFilterRequest = {
      from: Date.now() - 1000,
      to: Date.now(),
      eventName: "page_viewed",
      sourceId: "src_1",
      sourcePlatform: "web",
      personId: "person_1",
      sessionId: "sess_1",
      propertyKey: "orderId",
      propertyValue: "ord_123",
      cursor: encodeEventCursor({ receivedAt: Date.now(), id: "abc" }),
      limit: 50,
    };
    expect(f.limit).toBe(50);
    // all fields optional — empty filter is valid (latest page)
    const empty: EventFilterRequest = {};
    expect(empty.from).toBeUndefined();
  });
});
