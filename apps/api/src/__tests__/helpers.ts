import { vi } from "vitest";

/**
 * Builds a mock Neon query function that records every call.
 *
 * The `handler` receives normalized SQL (whitespace collapsed) plus the bound
 * args, and returns the rows for that query. Use `query.mock.calls` to assert
 * on SQL + args afterwards.
 */
export function makeMockDb(
  handler: (sql: string, args: unknown[]) => Array<Record<string, unknown>>,
) {
  return vi.fn(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const sql = strings.join("?").replace(/\s+/g, " ");
      return handler(sql, args);
    },
  );
}

/** Minimal Hono-like context for controller unit tests. */
export function makeCtx(
  params: Record<string, string>,
  body: unknown,
  vars: Record<string, unknown> = {},
) {
  return {
    req: {
      param: (key: string) => params[key],
      json: vi.fn(async () => body),
      header: vi.fn(() => undefined),
      query: vi.fn(() => undefined),
      raw: { headers: new Headers() },
    },
    json: vi.fn((value: unknown, status?: number) => ({
      __json: value,
      __status: status,
    })),
    header: vi.fn(() => undefined),
    get: (key: string) => vars[key],
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    env: {},
  } as never;
}
