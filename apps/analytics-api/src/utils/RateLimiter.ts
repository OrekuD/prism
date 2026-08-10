/**
 * Minimal fixed-window in-memory rate limiter.
 *
 * Suitable for per-process dev/soft limits; production enforcement for the
 * analytics API would need a shared store or proxy-level rules (documented
 * follow-up).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    entry.count += 1;

    if (entry.count > this.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      };
    }

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
