import "./testEnv.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../utils/RateLimiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", () => {
    const limiter = new RateLimiter(60_000, 3);

    expect(limiter.hit("ip-1").allowed).toBe(true);
    expect(limiter.hit("ip-1").allowed).toBe(true);
    expect(limiter.hit("ip-1").allowed).toBe(true);
  });

  it("blocks the request past the limit with retry guidance", () => {
    const limiter = new RateLimiter(60_000, 3);

    limiter.hit("ip-1");
    limiter.hit("ip-1");
    limiter.hit("ip-1");
    const blocked = limiter.hit("ip-1");

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("tracks different keys independently", () => {
    const limiter = new RateLimiter(60_000, 1);

    expect(limiter.hit("ip-a").allowed).toBe(true);
    expect(limiter.hit("ip-b").allowed).toBe(true);
    expect(limiter.hit("ip-a").allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const limiter = new RateLimiter(60_000, 1);

    limiter.hit("ip-1");
    expect(limiter.hit("ip-1").allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(limiter.hit("ip-1").allowed).toBe(true);
  });

  it("reset() clears all state", () => {
    const limiter = new RateLimiter(60_000, 1);

    limiter.hit("ip-1");
    expect(limiter.hit("ip-1").allowed).toBe(false);

    limiter.reset();
    expect(limiter.hit("ip-1").allowed).toBe(true);
  });
});
