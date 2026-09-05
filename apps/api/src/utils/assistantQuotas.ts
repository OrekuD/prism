/**
 * Assistant run quotas and rate limits (Task 21 slice 6).
 *
 * Single-process in-memory enforcement: per-minute run rate limits by
 * user/project/workspace, per-day token quotas by user and workspace, and
 * a per-run cost ceiling checked before the run and re-checked after
 * every model step by the agent ledger (slice 5). A rejected run returns
 * a stable `denied-quota` / `denied-cost` outcome with a retry time —
 * never a partial stream.
 *
 * NOTE: per-process counters are not shared across replicas or Worker
 * isolates. Multi-replica deployments must front the API with a shared
 * limiter (reverse proxy / Redis / Durable Object); this module is the
 * documented single-process fallback and its decisions are conservative
 * (fail closed on overflow, never grant on error).
 */
import { RateLimiter } from "./RateLimiter";

export type QuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "rate-limited" | "denied-quota" | "denied-cost";
      retryAfterMs: number | null;
      message: string;
    };

type DailyCounter = { day: string; tokens: number };

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type AssistantQuotaLimits = {
  runsPerMinutePerUser: number;
  runsPerMinutePerProject: number;
  runsPerMinutePerWorkspace: number;
  dailyTokensPerUser: number;
  dailyTokensPerWorkspace: number;
  maxRunCostMicroUsd: number;
  runTimeoutMs: number;
};

export function resolveQuotaLimits(
  env: Record<string, string | undefined>,
): AssistantQuotaLimits {
  const int = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    runsPerMinutePerUser: int("PRISM_AI_RUNS_PER_MINUTE_PER_USER", 6),
    runsPerMinutePerProject: int("PRISM_AI_RUNS_PER_MINUTE_PER_PROJECT", 20),
    runsPerMinutePerWorkspace: int(
      "PRISM_AI_RUNS_PER_MINUTE_PER_WORKSPACE",
      60,
    ),
    dailyTokensPerUser: int("PRISM_AI_DAILY_TOKENS_PER_USER", 500_000),
    dailyTokensPerWorkspace: int(
      "PRISM_AI_DAILY_TOKENS_PER_WORKSPACE",
      2_000_000,
    ),
    maxRunCostMicroUsd: int("PRISM_AI_MAX_RUN_COST_MICRO_USD", 50_000),
    runTimeoutMs: int("PRISM_AI_RUN_TIMEOUT_MS", 120_000),
  };
}

export class AssistantQuotas {
  private readonly userLimiter: RateLimiter;
  private readonly projectLimiter: RateLimiter;
  private readonly workspaceLimiter: RateLimiter;
  private readonly dailyUser = new Map<string, DailyCounter>();
  private readonly dailyWorkspace = new Map<string, DailyCounter>();
  constructor(private readonly limits: AssistantQuotaLimits) {
    this.userLimiter = new RateLimiter(
      60_000,
      limits.runsPerMinutePerUser,
    );
    this.projectLimiter = new RateLimiter(
      60_000,
      limits.runsPerMinutePerProject,
    );
    this.workspaceLimiter = new RateLimiter(
      60_000,
      limits.runsPerMinutePerWorkspace,
    );
  }

  get config(): AssistantQuotaLimits {
    return this.limits;
  }

  /** Pre-run gate: rate limits only (quotas need no token estimate yet). */
  checkRate(input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }): QuotaDecision {
    for (const [limiter, key, scope] of [
      [this.userLimiter, `u:${input.userId}`, "user"],
      [this.projectLimiter, `p:${input.projectId}`, "project"],
      [
        this.workspaceLimiter,
        `w:${input.organizationId}`,
        "workspace",
      ],
    ] as const) {
      const hit = limiter.hit(key);
      if (!hit.allowed) {
        return {
          allowed: false,
          reason: "rate-limited",
          retryAfterMs: hit.retryAfterSeconds * 1000,
          message: `Too many assistant runs for this ${scope}. Retry in ${hit.retryAfterSeconds}s.`,
        };
      }
    }
    return { allowed: true };
  }

  /** Pre-run daily quota gate (tokens consumed so far today). */
  checkDaily(input: {
    userId: string;
    organizationId: string;
    now: number;
  }): QuotaDecision {
    const day = dayKey(input.now);
    const user = this.dailyUser.get(input.userId);
    if (
      user &&
      user.day === day &&
      user.tokens >= this.limits.dailyTokensPerUser
    ) {
      return {
        allowed: false,
        reason: "denied-quota",
        retryAfterMs: nextMidnightMs(input.now),
        message: "Daily assistant usage exhausted. Try again tomorrow.",
      };
    }
    const workspace = this.dailyWorkspace.get(input.organizationId);
    if (
      workspace &&
      workspace.day === day &&
      workspace.tokens >= this.limits.dailyTokensPerWorkspace
    ) {
      return {
        allowed: false,
        reason: "denied-quota",
        retryAfterMs: nextMidnightMs(input.now),
        message: "Workspace daily assistant usage exhausted.",
      };
    }
    return { allowed: true };
  }

  /** Post-run accounting: tokens only (cost is enforced per-step + here). */
  recordUsage(input: {
    userId: string;
    organizationId: string;
    promptTokens: number;
    completionTokens: number;
    costMicroUsd: number;
    now: number;
  }): void {
    const day = dayKey(input.now);
    const tokens = Math.max(
      0,
      Math.floor(input.promptTokens + input.completionTokens),
    );
    const user = this.dailyUser.get(input.userId);
    if (!user || user.day !== day) {
      this.dailyUser.set(input.userId, { day, tokens });
    } else {
      user.tokens += tokens;
    }
    const workspace = this.dailyWorkspace.get(input.organizationId);
    if (!workspace || workspace.day !== day) {
      this.dailyWorkspace.set(input.organizationId, { day, tokens });
    } else {
      workspace.tokens += tokens;
    }
  }

  reset(): void {
    this.userLimiter.reset();
    this.projectLimiter.reset();
    this.workspaceLimiter.reset();
    this.dailyUser.clear();
    this.dailyWorkspace.clear();
  }
}

function nextMidnightMs(now: number): number {
  const date = new Date(now);
  const midnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
  return Math.max(0, midnight - now);
}

/** Process-local singleton (documented single-process fallback). */
let shared: AssistantQuotas | null = null;

export function assistantQuotas(
  env?: Record<string, string | undefined>,
): AssistantQuotas {
  if (!shared || env) {
    shared = new AssistantQuotas(resolveQuotaLimits(env ?? {}));
  }
  return shared;
}

/** Test seam: replace the process-local singleton. */
export function __setAssistantQuotasForTests(
  quotas: AssistantQuotas | null,
): void {
  shared = quotas;
}
