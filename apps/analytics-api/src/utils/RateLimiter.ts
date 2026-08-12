/**
 * Minimal fixed-window in-memory rate limiter (task-9 slice-4 review F11).
 *
 * Weighted hits: a batch of N events costs N units, so batching cannot
 * multiply the allowance by the batch size. A proposed count above the
 * maximum is rejected — INCLUDING a key's first request — and a rejected
 * request does not consume quota. Entries are replaced immutably after
 * the decision (no in-place mutation of shared state).
 *
 * Suitable for per-process dev/soft limits; production enforcement for the
 * analytics API would need a shared store or proxy-level rules (documented
 * follow-up).
 */
interface LimiterEntry {
  readonly count: number;
  readonly resetAt: number;
}

export class RateLimiter {
  private hits = new Map<string, LimiterEntry>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /**
   * Register `weight` units against `key` (default 1).
   * Throws on an invalid weight (programming error — the API never sends
   * non-positive weights). Rejected hits do not consume quota.
   */
  hit(key: string, weight = 1): { allowed: boolean; retryAfterSeconds: number } {
    if (!Number.isInteger(weight) || weight <= 0) {
      throw new Error(`rate limiter weight must be a positive integer (got ${weight})`);
    }
    const now = Date.now();
    const entry = this.hits.get(key);
    const resetAt = entry && entry.resetAt > now ? entry.resetAt : now + this.windowMs;
    const proposed = (entry && entry.resetAt > now ? entry.count : 0) + weight;

    if (proposed > this.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((resetAt - now) / 1000),
      };
    }

    this.hits.set(key, { count: proposed, resetAt });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset() {
    this.hits.clear();
  }
}

/**
 * Client identity for per-IP rate limiting (review F12 + harden F22).
 * NEVER used for authorization, identity, or persisted analytics; never
 * logged.
 *
 * Explicit proxy modes (`ANALYTICS_TRUSTED_PROXY`):
 * - unset / "none" (default): only the immediate socket peer address is
 *   real — forwarding headers are ignored (forged hops cannot rotate the
 *   per-IP key).
 * - "nginx": the bundled nginx overwrites X-Forwarded-For with the real
 *   peer address AND clears CF-Connecting-IP — trust X-Forwarded-For
 *   ONLY (a client-supplied Cloudflare header cannot spoof the key).
 * - "cloudflare": the runtime guarantees CF-Connecting-IP is
 *   platform-owned (Cloudflare overwrites client input) — trust it only.
 * On runtimes without a peer address and without proxy trust, the key
 * falls back to a shared bucket — the project-key event-weighted quota
 * remains the authoritative boundary.
 */
export function clientIpFrom(ctx: {
  req: {
    header: (name: string) => string | undefined;
    raw: { headers: Headers };
  };
  env?: { incoming?: { socket?: { remoteAddress?: string } } };
}): string {
  const mode = process.env.ANALYTICS_TRUSTED_PROXY ?? "none";
  if (mode === "nginx") {
    return (
      ctx.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    );
  }
  if (mode === "cloudflare") {
    return ctx.req.header("cf-connecting-ip") || "local";
  }
  // Untrusted: only the immediate peer address is real.
  return ctx.env?.incoming?.socket?.remoteAddress || "local";
}
