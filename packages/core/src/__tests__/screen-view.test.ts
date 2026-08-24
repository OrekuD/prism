import { describe, it, expect } from "vitest";
import { validateScreenViewProperties, validateAppLifecycleProperties, SCREEN_VIEW_EVENT_NAME, APP_LIFECYCLE_EVENT_NAME } from "../screen-view";
import { MOBILE_LIMITS } from "../mobile-limits";

describe("mobile screen-view contracts", () => {
  it("freezes reserved names", () => {
    expect(SCREEN_VIEW_EVENT_NAME).toBe("$prism_screen_view");
    expect(APP_LIFECYCLE_EVENT_NAME).toBe("$prism_app_lifecycle");
  });

  it("accepts canonical screen view", () => {
    const res = validateScreenViewProperties({
      $screen: { name: "Home", navigation: "initial", sequence: 1 },
    });
    expect(res.ok).toBe(true);
  });

  it("accepts with routePattern and previousScreen", () => {
    const res = validateScreenViewProperties({
      $screen: { name: "Profile", routePattern: "/profile/[id]", navigation: "push", sequence: 2, previousScreen: "Home" },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects empty name and control chars", () => {
    expect(validateScreenViewProperties({ $screen: { name: "", navigation: "initial", sequence: 1 } }).ok).toBe(false);
    expect(validateScreenViewProperties({ $screen: { name: "\x00bad", navigation: "initial", sequence: 1 } }).ok).toBe(false);
  });

  it("rejects invalid navigation and sequence bounds", () => {
    expect(validateScreenViewProperties({ $screen: { name: "Home", navigation: "bogus" as any, sequence: 1 } }).ok).toBe(false);
    expect(validateScreenViewProperties({ $screen: { name: "Home", navigation: "initial", sequence: 0 } }).ok).toBe(false);
    expect(validateScreenViewProperties({ $screen: { name: "Home", navigation: "initial", sequence: 1000001 } }).ok).toBe(false);
  });

  it("rejects routePattern with query or hash", () => {
    expect(validateScreenViewProperties({ $screen: { name: "Home", navigation: "initial", sequence: 1, routePattern: "/home?x=1" } }).ok).toBe(false);
    expect(validateScreenViewProperties({ $screen: { name: "Home", navigation: "initial", sequence: 1, routePattern: "/home#section" } }).ok).toBe(false);
  });

  it("validates app lifecycle active/background/inactive", () => {
    expect(validateAppLifecycleProperties({ $lifecycle: { transition: "active", sequence: 1 } }).ok).toBe(true);
    expect(validateAppLifecycleProperties({ $lifecycle: { transition: "background", sequence: 2, durationMs: 120000 } }).ok).toBe(true);
    expect(validateAppLifecycleProperties({ $lifecycle: { transition: "unknown" as any, sequence: 1 } }).ok).toBe(false);
  });

  it("freezes limits", () => {
    expect(MOBILE_LIMITS.appSessionInactivityTimeoutMs).toBe(30*60*1000);
    expect(MOBILE_LIMITS.rankingRowLimit).toBe(50);
    expect(MOBILE_LIMITS.lateDeliveryGeoCutoffMs).toBe(15*60*1000);
  });
});
