/**
 * NOTE (task-6 section 3): this is the documented single-process fallback
 * for rate limiting. Multi-replica deployments must front the API with a
 * shared limiter (reverse proxy / Redis); per-process counters are not
 * shared across replicas.
 *
 * Minimal fixed-window in-memory rate limiter.
 *
 * Suitable for per-process dev/soft limits. In the Cloudflare Worker this is
 * per-isolate state only — production-grade enforcement requires a shared
 * store (KV/Durable Object) and is tracked as a follow-up.
 *
 * Weighted hits (task-15 slice 4): a management batch of N actions costs N
 * units, so batching cannot multiply the allowance. A rejected hit does not
 * consume quota, and entries are replaced immutably after the decision.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  hit(key: string, weight = 1): { allowed: boolean; retryAfterSeconds: number } {
    if (!Number.isInteger(weight) || weight <= 0) {
      throw new Error(
        `rate limiter weight must be a positive integer (got ${weight})`,
      );
    }
    const now = Date.now();
    const entry = this.hits.get(key);
    const active = entry && entry.resetAt > now ? entry : undefined;
    const resetAt = active ? active.resetAt : now + this.windowMs;
    const proposed = (active ? active.count : 0) + weight;

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

/** Best-effort client IP for rate limiting. Never used for authorization. */
export function clientIpFrom(ctx: {
  req: {
    header: (name: string) => string | undefined;
    raw: { headers: Headers };
  };
}): string {
  return (
    ctx.req.header("cf-connecting-ip") ||
    ctx.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}
