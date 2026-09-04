/**
 * Run-scoped authorization cache (Task 21 slice 5).
 *
 * The agent loop must never trust model-supplied provenance. Every tool
 * call resolves the run's frozen `AuthorizedProjectContext` through this
 * cache, keyed ONLY by server-verified IDs
 * (`keyForAuthorizedContext`: user/organization/project) — never slugs,
 * never model values. Membership/role/source checks stay server-side via
 * the injected `lookup`; this cache adds:
 * - immutable identity keys (one entry per verified triple),
 * - in-flight lookup memoization (concurrent tools share one lookup),
 * - bounded expiry (`AUTHORIZATION_CACHE_TTL_MS`, 10s),
 * - source-subset enforcement (`selected` scopes must narrow within the
 *   cached `allowedSourceIds`).
 *
 * Deletion, shared-memory, and future project-state writes bypass the
 * cache with a fresh transactional check (slice 6) — this cache serves
 * analytics reads inside one run only.
 */
import {
  AUTHORIZATION_CACHE_TTL_MS,
  isToolScopeAllowed,
  keyForAuthorizedContext,
  type AuthorizedContextKey,
  type AuthorizedProjectContext,
} from "@prism-analytics/types";

export class AssistantAuthError extends Error {
  readonly code: "forbidden" | "not-found";
  constructor(code: AssistantAuthError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** Server-side membership/source lookup (injected; DB-backed in prod). */
export type AuthorizedContextLookup = (
  key: AuthorizedContextKey,
) => Promise<AuthorizedProjectContext | null>;

export type AuthorizationCache = {
  /** Frozen run context for verified IDs (non-disclosing when missing). */
  get: (key: AuthorizedContextKey) => Promise<AuthorizedProjectContext>;
  /**
   * Scope gate for one tool call: the cached context must exist and the
   * requested scope (model-supplied values) must sit inside it —
   * project, organization, user, and every source ID.
   */
  requireScope: (
    key: AuthorizedContextKey,
    scope: {
      userId?: string;
      organizationId?: string;
      projectId?: string;
      sourceIds?: readonly string[];
    },
  ) => Promise<AuthorizedProjectContext>;
  /** Test/observability hook: cached identity keys. */
  keys: () => string[];
};

type CacheEntry = {
  context: AuthorizedProjectContext;
  expiresAt: number;
};

export function createAuthorizationCache(deps: {
  lookup: AuthorizedContextLookup;
  now?: () => number;
  ttlMs?: number;
}): AuthorizationCache {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? AUTHORIZATION_CACHE_TTL_MS;
  const entries = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<AuthorizedProjectContext | null>>();

  async function get(key: AuthorizedContextKey): Promise<AuthorizedProjectContext> {
    const cacheKey = keyForAuthorizedContext(key);
    const hit = entries.get(cacheKey);
    if (hit && hit.expiresAt > now()) {
      return hit.context;
    }
    entries.delete(cacheKey);
    let pending = inflight.get(cacheKey);
    if (!pending) {
      pending = deps.lookup(key);
      inflight.set(cacheKey, pending);
    }
    let resolved: AuthorizedProjectContext | null;
    try {
      resolved = await pending;
    } finally {
      inflight.delete(cacheKey);
    }
    if (!resolved) {
      // Non-disclosing: missing membership reads as missing context,
      // never as "project exists but you lack access".
      throw new AssistantAuthError("not-found", "Authorized context not found");
    }
    entries.set(cacheKey, {
      context: resolved,
      expiresAt: now() + ttlMs,
    });
    return resolved;
  }

  async function requireScope(
    key: AuthorizedContextKey,
    scope: {
      userId?: string;
      organizationId?: string;
      projectId?: string;
      sourceIds?: readonly string[];
    },
  ): Promise<AuthorizedProjectContext> {
    const context = await get(key);
    if (
      !isToolScopeAllowed(
        {
          userId: context.userId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          allowedSourceIds: context.allowedSourceIds,
        },
        scope,
      )
    ) {
      throw new AssistantAuthError(
        "forbidden",
        "Tool scope is outside the authorized run context",
      );
    }
    return context;
  }

  return {
    get,
    requireScope,
    keys: () => [...entries.keys()],
  };
}
