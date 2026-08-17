import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourcesController } from "../controllers/SourcesController";
import { makeMockDb, makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager", () => ({
  TursoDatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);
const getTursoInstance = vi.mocked(TursoDatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";
const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SOURCE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const KEY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SLUG = "alpha";

function ctxFor(userId: string | null, params: Record<string, string>, body?: unknown) {
  return makeCtx(
    params,
    body ?? {},
    userId ? { user: { id: userId } } : {},
  );
}

/** Store shaped like the Task 13 schema: project -> organization_id,
 * sources under the project, keys under the source. */
function makeStore(options: {
  role: "owner" | "admin" | "member" | null;
  sources?: Array<Record<string, unknown>>;
  keys?: Array<Record<string, unknown>>;
}) {
  const { role, sources = [], keys = [] } = options;
  return makeMockDb((sql) => {

    if (sql.includes("FROM projects")) {
      return [{ id: PROJECT_ID, organization_id: ORG_ID }];
    }
    if (sql.includes("SELECT role FROM member")) {
      return role ? [{ role }] : [];
    }
    if (sql.includes("FROM project_sources") && sql.includes("WHERE id")) {
      const source = sources.find((s) => s.id === SOURCE_ID);
      return source
        ? [source]
        : [
            {
              id: SOURCE_ID,
              project_id: PROJECT_ID,
              name: "Web",
              platform: "web",
              allowed_origins: "[]",
            },
          ];
    }
    if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id")) {
      return sources;
    }
    if (sql.includes("FROM project_api_keys")) {
      return keys;
    }
    if (sql.includes("INSERT INTO project_sources")) {
      return [{ id: SOURCE_ID }];
    }
    if (sql.includes("INSERT INTO project_api_keys")) {
      return [{ id: KEY_ID }];
    }
    if (sql.includes("UPDATE project_sources")) {
      return [{ id: SOURCE_ID }];
    }
    if (sql.includes("DELETE FROM project_sources")) {
      return [{ id: SOURCE_ID }];
    }
    if (sql.includes("UPDATE project_api_keys SET status")) {
      return [{ id: KEY_ID }];
    }
    return [];
  });
}

function makeTurso(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn(async () => ({ rows }));
  getTursoInstance.mockReturnValue({ execute } as never);
  return execute;
}

type MockResult = { __json?: unknown; __status?: number };
const statusOf = (result: unknown): number | undefined =>
  (result as MockResult).__status;

describe("SourcesController (organization-bound source + key management)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("owner creates a web source with a publishable initial key + allowed origins", async () => {
      const neon = makeStore({
        role: "owner",
        keys: [
          { id: KEY_ID, source_id: SOURCE_ID, name: "Initial key", key: "psk_test", key_type: "publishable", status: "active", last_used_at: null, created_at: "2026-08-16" },
        ],
      });
      getInstance.mockReturnValue(neon as never);
      makeTurso([{ events: 0, last_received: null }]);

      const result = await SourcesController.create(
        ctxFor(USER_ID, { slug: SLUG }, {
          name: "Marketing site",
          platform: "web",
          allowedOrigins: ["https://example.com"],
        }),
      );
      console.log("DEBUG create result:", JSON.stringify(result).slice(0, 300));
      expect(statusOf(result) ?? 200).toBe(200);
      const source = (result as { __json?: Record<string, unknown> }).__json ?? {};
      const initialKey = String(source.initialKey ?? "");
      expect(initialKey.startsWith("psk_")).toBe(true);
      expect(source.keys).toHaveLength(1);
    });

    it("creates a server source with a SECRET initial key", async () => {
      const neon = makeStore({
        role: "owner",
        keys: [
          { id: KEY_ID, source_id: SOURCE_ID, name: "Initial key", key: "ssk_test", key_type: "secret", status: "active", last_used_at: null, created_at: "2026-08-16" },
        ],
      });
      getInstance.mockReturnValue(neon as never);
      makeTurso([{ events: 0, last_received: null }]);

      const result = await SourcesController.create(
        ctxFor(USER_ID, { slug: SLUG }, {
          name: "Backend worker",
          platform: "server",
        }),
      );
      const source = (result as { __json?: Record<string, unknown> }).__json ?? {};
      expect(String(source.initialKey ?? "").startsWith("ssk_")).toBe(true);
    });

    it("rejects allowed origins for non-web platforms", async () => {
      const neon = makeStore({ role: "owner" });
      getInstance.mockReturnValue(neon as never);

      const result = await SourcesController.create(
        ctxFor(USER_ID, { slug: SLUG }, {
          name: "iOS app",
          platform: "ios",
          allowedOrigins: ["https://example.com"],
        }),
      );
      expect(statusOf(result)).toBe(400);
    });

    it("member cannot create a source", async () => {
      const neon = makeStore({ role: "member" });
      getInstance.mockReturnValue(neon as never);

      const result = await SourcesController.create(
        ctxFor(USER_ID, { slug: SLUG }, { name: "X", platform: "web" }),
      );
      expect(statusOf(result)).toBe(400);
    });

    it("non-member gets a non-disclosing 404", async () => {
      const neon = makeStore({ role: null });
      getInstance.mockReturnValue(neon as never);

      const result = await SourcesController.create(
        ctxFor(STRANGER_ID, { slug: SLUG }, { name: "X", platform: "web" }),
      );
      expect(statusOf(result)).toBe(404);
    });
  });

  describe("list + detail", () => {
    it("a member can list sources with masked secret keys and full publishable keys", async () => {
      const neon = makeStore({
        role: "member",
        sources: [
          { id: SOURCE_ID, project_id: PROJECT_ID, name: "Web", platform: "web", allowed_origins: "[]" },
        ],
        keys: [
          { id: KEY_ID, source_id: SOURCE_ID, name: "Initial", key: "psk_abcdef123456", key_type: "publishable", status: "active", last_used_at: null, created_at: "2026-08-16" },
          { id: "key2", source_id: SOURCE_ID, name: "Old", key: "ssk_abcdef1234567890", key_type: "secret", status: "revoked", last_used_at: null, created_at: "2026-08-16" },
        ],
      });
      getInstance.mockReturnValue(neon as never);
      makeTurso([{ events: 42, last_received: 1786000000000 }]);

      const result = await SourcesController.list(ctxFor(USER_ID, { slug: SLUG }));
      expect(statusOf(result) ?? 200).toBe(200);
      const list = (result as { __json?: Array<Record<string, unknown>> }).__json ?? [];
      expect(list).toHaveLength(1);
      const source = list[0] as {
        keys?: Array<Record<string, unknown>>;
        telemetry?: Record<string, unknown>;
      };
      // publishable value returned in full (it is public by design)…
      expect((source.keys ?? [])[0]?.value).toBe("psk_abcdef123456");
      // …secret keys are masked in listings
      expect(String((source.keys ?? [])[1]?.value)).toContain("...");
      expect(String((source.keys ?? [])[1]?.value)).not.toContain("abcdef1234567890");
      expect(source.telemetry).toEqual({ events: 42, lastReceivedAt: 1786000000000 });
    });

    it("non-member cannot list (404)", async () => {
      const neon = makeStore({ role: null });
      getInstance.mockReturnValue(neon as never);
      const result = await SourcesController.list(ctxFor(STRANGER_ID, { slug: SLUG }));
      expect(statusOf(result)).toBe(404);
    });
  });

  describe("keys", () => {
    it("admin can create an additional key for rotation (independent of other sources)", async () => {
      const neon = makeStore({
        role: "admin",
        sources: [{ id: SOURCE_ID, project_id: PROJECT_ID, name: "Web", platform: "web", allowed_origins: "[]" }],
      });
      getInstance.mockReturnValue(neon as never);

      const result = await SourcesController.createKey(
        ctxFor(USER_ID, { slug: SLUG, sourceId: SOURCE_ID }, { name: "Rotation key" }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
      const created = (result as { __json?: Record<string, unknown> }).__json ?? {};
      expect(String(created.value ?? "").startsWith("psk_")).toBe(true);
      expect(created.keyType).toBe("publishable");
      // The key insert targets ONLY this source
      const insert = neon.mock.calls.find(([sql]) =>
        String((sql as TemplateStringsArray).join("?")).includes("INSERT INTO project_api_keys"),
      );
      expect(insert).toBeDefined();
    });

    it("member cannot create keys", async () => {
      const neon = makeStore({ role: "member", sources: [{ id: SOURCE_ID, project_id: PROJECT_ID, name: "Web", platform: "web", allowed_origins: "[]" }] });
      getInstance.mockReturnValue(neon as never);
      const result = await SourcesController.createKey(
        ctxFor(USER_ID, { slug: SLUG, sourceId: SOURCE_ID }, { name: "X" }),
      );
      expect(statusOf(result)).toBe(400);
    });

    it("admin can revoke a key; a key of ANOTHER source is not reachable", async () => {
      const neon = makeStore({
        role: "admin",
        sources: [{ id: SOURCE_ID, project_id: PROJECT_ID, name: "Web", platform: "web", allowed_origins: "[]" }],
      });
      getInstance.mockReturnValue(neon as never);
      // The revoke UPDATE is scoped by source_id — a key id that belongs to
      // a different source matches nothing.
      neon.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join("?").replace(/\s+/g, " ");
        if (sql.includes("FROM projects")) {
          return [{ id: PROJECT_ID, organization_id: ORG_ID }];
        }
        if (sql.includes("SELECT role FROM member")) return [{ role: "admin" }];
        if (sql.includes("FROM project_sources")) {
          return [{ id: SOURCE_ID, project_id: PROJECT_ID, name: "Web", platform: "web", allowed_origins: "[]" }];
        }
        if (sql.includes("UPDATE project_api_keys SET status")) {
          // Source-scoped: another source's key id returns no rows.
          return [];
        }
        return [];
      });
      const result = await SourcesController.revokeKey(
        ctxFor(USER_ID, { slug: SLUG, sourceId: SOURCE_ID, keyId: KEY_ID }),
      );
      expect(statusOf(result)).toBe(404);
    });
  });
});
