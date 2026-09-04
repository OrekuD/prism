import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsController } from "../controllers/ProjectsController";
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
const OTHER_ORG_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SLUG = "alpha";

function ctxFor(userId: string | null, params: Record<string, string>, body?: unknown) {
  return makeCtx(
    params,
    body ?? {},
    userId ? { user: { id: userId } } : {},
  );
}

/**
 * Mock store shaped like the Task 13 schema: projects carry
 * organization_id; membership lives in the canonical `member` table with
 * Better Auth's owner/admin/member roles.
 */
function makeStore(role: "owner" | "admin" | "member" | null) {
  return makeMockDb((sql) => {
    if (sql.includes("SELECT role FROM member")) {
      return role ? [{ role }] : [];
    }
    if (sql.includes("SELECT organization_id FROM projects")) {
      return [{ organization_id: ORG_ID }];
    }
    if (
      sql.includes("SELECT") &&
      sql.includes("FROM projects") &&
      sql.includes("WHERE projects.slug")
    ) {
      return [{ id: PROJECT_ID, organization_id: ORG_ID, slug: SLUG, name: "Alpha" }];
    }
    if (sql.startsWith("INSERT INTO projects")) {
      return [{ id: PROJECT_ID }];
    }
    if (sql.startsWith("INSERT INTO project_api_keys")) {
      return [];
    }
    if (sql.startsWith("UPDATE projects")) {
      return [{ id: PROJECT_ID, name: "New Name" }];
    }
    if (sql.startsWith("DELETE FROM projects")) {
      return [];
    }
    return [];
  });
}

type MockResult = { __json?: { errors?: string[]; error?: string }; __status?: number };

function statusOf(result: unknown): number | undefined {
  return (result as MockResult).__status;
}

function errorsOf(result: unknown): string[] {
  return (result as MockResult).__json?.errors ?? [];
}

function bodyOf(result: unknown): Record<string, unknown> {
  return (result as MockResult).__json ?? {};
}

function makeTurso(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn(
    async (_opts: { sql: string; args: unknown[] }) => ({ rows }),
  );
  getTursoInstance.mockReturnValue({ execute } as never);
  return execute;
}

describe("ProjectsController (organization-bound authorization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createProject", () => {
    it("owner can create a project in their workspace", async () => {
      const neon = makeStore("owner");
      getInstance.mockReturnValue(neon as never);

      const result = await ProjectsController.createProject(
        ctxFor(USER_ID, {}, { organizationId: ORG_ID, name: "App" }),
      );

      expect(statusOf(result) ?? 200).toBe(200);
      // ONLY the project row is created — sources create keys (task-13)
      const inserts = neon.mock.calls.filter(([sql]) =>
        String((sql as TemplateStringsArray).join("?")).includes("INSERT"),
      );
      expect(inserts).toHaveLength(1);
      expect(String((inserts[0]?.[0] as TemplateStringsArray).join("?"))).toMatch(
        /INSERT INTO projects \(name, organization_id, creator_id, slug\)/i,
      );
      // The response is the created project — appends straight into the
      // client's project-list cache (no refetch).
      expect(bodyOf(result)).toMatchObject({
        id: PROJECT_ID,
        name: "App",
        slug: expect.any(String),
        summary: [],
      });
    });

    it("admin can create a project", async () => {
      const neon = makeStore("admin");
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.createProject(
        ctxFor(USER_ID, {}, { organizationId: ORG_ID, name: "App" }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
    });

    it("member is denied project creation", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.createProject(
        ctxFor(USER_ID, {}, { organizationId: ORG_ID, name: "App" }),
      );
      expect(statusOf(result)).toBe(400);
      expect(errorsOf(result)).toEqual(["cannot_create_project"]);
    });

    it("non-member is denied without disclosing the workspace", async () => {
      const neon = makeStore(null);
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.createProject(
        ctxFor(STRANGER_ID, {}, { organizationId: ORG_ID, name: "App" }),
      );
      expect(statusOf(result)).toBe(400);
    });

    it("unauthenticated is rejected", async () => {
      const result = await ProjectsController.createProject(
        ctxFor(null, {}, { organizationId: ORG_ID, name: "App" }),
      );
      expect(statusOf(result)).toBe(401);
    });
  });

  describe("renameProject", () => {
    it("admin can rename a project", async () => {
      const neon = makeStore("admin");
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.renameProject(
        ctxFor(USER_ID, { projectId: PROJECT_ID }, { name: "New Name" }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
    });

    it("member cannot rename (restricted action)", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.renameProject(
        ctxFor(USER_ID, { projectId: PROJECT_ID }, { name: "New Name" }),
      );
      expect(statusOf(result)).toBe(403);
    });

    it("non-member receives project_not_found (non-disclosing)", async () => {
      const neon = makeStore(null);
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.renameProject(
        ctxFor(STRANGER_ID, { projectId: PROJECT_ID }, { name: "New Name" }),
      );
      expect(statusOf(result)).toBe(404);
      expect(errorsOf(result)).toEqual(["project_not_found"]);
    });
  });

  describe("deleteProject", () => {
    it("owner can delete a project and purges its error data", async () => {
      const neon = makeStore("owner");
      getInstance.mockReturnValue(neon as never);
      const execute = vi.fn(async () => ({ rows: [], rowsAffected: 0 }));
      const batch = vi.fn(async (_statements: Array<{ sql: string; args: unknown[] }>) => []);
      getTursoInstance.mockReturnValue({ execute, batch } as never);
      const result = await ProjectsController.deleteProject(
        ctxFor(USER_ID, { projectId: PROJECT_ID }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
      const deleteCall = neon.mock.calls.find(([sql]) =>
        String((sql as TemplateStringsArray).join("?")).startsWith("DELETE"),
      );
      expect(deleteCall).toBeDefined();
      // the analytics purge fired in one atomic batch, scoped to the project
      const statements = (batch.mock.calls[0]?.[0] ?? []) as Array<{
        sql: string;
        args: unknown[];
      }>;
      expect(
        statements.some(
          (s) =>
            s.sql.includes("DELETE FROM error_occurrences") &&
            s.args[0] === PROJECT_ID,
        ),
      ).toBe(true);
      expect(
        statements.some(
          (s) =>
            s.sql.includes("DELETE FROM error_issue_activity") &&
            s.args[0] === PROJECT_ID,
        ),
      ).toBe(true);
      expect(
        statements.some(
          (s) =>
            s.sql.includes("DELETE FROM error_issues") &&
            s.args[0] === PROJECT_ID,
        ),
      ).toBe(true);
      // Task 21 slice 4: assistant chats and project memory purge in the
      // same operation, scoped to the project, before the product row dies.
      const productDeletes = neon.mock.calls
        .map(([strings, ...args]) => ({
          sql: String((strings as TemplateStringsArray).join("?")).replace(
            /\s+/g,
            " ",
          ),
          args: args as unknown[],
        }))
        .filter(({ sql }) => sql.includes("DELETE FROM assistant_"));
      expect(
        productDeletes.some(
          ({ sql, args }) =>
            sql.includes("DELETE FROM assistant_conversations") &&
            args[0] === PROJECT_ID,
        ),
      ).toBe(true);
      expect(
        productDeletes.some(
          ({ sql, args }) =>
            sql.includes("DELETE FROM assistant_memory") &&
            args.includes(PROJECT_ID),
        ),
      ).toBe(true);
    });

    it("member cannot delete (404, non-disclosing)", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      getTursoInstance.mockReturnValue({
        execute: vi.fn(),
        batch: vi.fn(),
      } as never);
      const result = await ProjectsController.deleteProject(
        ctxFor(USER_ID, { projectId: PROJECT_ID }),
      );
      expect(statusOf(result)).toBe(404);
    });
  });

  describe("getProjectBySlug", () => {
    it("a member can read project analytics", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      const turso = makeTurso([
        { date: "2026-08-01", desktop: 2, mobile: 1 },
      ]);
      void turso;

      const result = await ProjectsController.getProjectBySlug(
        ctxFor(USER_ID, { slug: SLUG }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
      const resource = (result as { __json?: { organizationId?: string; analytics?: unknown } }).__json ?? {};
      expect(resource.organizationId).toBe(ORG_ID);
      // task-13: ingestion keys live on SOURCES, never on the project
      expect("apiKey" in resource).toBe(false);
    });

    it("a member of ANOTHER workspace is treated as a non-member (404)", async () => {
      // The stranger's membership exists but in a different organization —
      // membership is always proven against the PROJECT's organization.
      const neon = makeMockDb((sql) => {
        if (sql.includes("SELECT role FROM member")) return [];
        if (sql.includes("SELECT organization_id FROM projects")) {
          return [{ organization_id: ORG_ID }];
        }
        if (
          sql.includes("SELECT") &&
          sql.includes("FROM projects") &&
          sql.includes("WHERE projects.slug")
        ) {
          return [{ id: PROJECT_ID, organization_id: ORG_ID, slug: SLUG, name: "Alpha" }];
        }
        return [];
      });
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.getProjectBySlug(
        ctxFor(STRANGER_ID, { slug: SLUG }),
      );
      expect(statusOf(result)).toBe(404);
      expect(errorsOf(result)).toEqual(["project_not_found"]);
    });

    it("unauthenticated is rejected", async () => {
      const result = await ProjectsController.getProjectBySlug(
        ctxFor(null, { slug: SLUG }),
      );
      expect(statusOf(result)).toBe(401);
    });
  });

  describe("getProjectEvents", () => {
    it("any member can list events", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      const turso = makeTurso([]);
      const result = await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { slug: SLUG }),
      );
      expect(statusOf(result) ?? 200).toBe(200);
      expect(turso).toHaveBeenCalledTimes(1);
    });

    it("non-member cannot list events (404)", async () => {
      const neon = makeStore(null);
      getInstance.mockReturnValue(neon as never);
      const result = await ProjectsController.getProjectEvents(
        ctxFor(STRANGER_ID, { slug: SLUG }),
      );
      expect(statusOf(result)).toBe(404);
    });
  });

  describe("Standard Event attribution (task-19 review R1-F3)", () => {
    const NOW = 1_785_542_400_000;
    /** A trusted analytics-store row shaped like the events SELECT. */
    function eventRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "evt-row-1",
        session_id: null,
        project_id: PROJECT_ID,
        name: "checkout_completed",
        type: "track",
        properties: JSON.stringify({ format: "csv" }),
        context: null,
        occurred_at: NOW,
        received_at: NOW,
        schema_version: 3,
        anonymous_id: "anon-1",
        user_id: null,
        person_id: "u_person",
        source_id: null,
        platform: "web",
        sdk_name: null,
        sdk_version: null,
        ...overrides,
      };
    }

    const VALID_STD_PROPS = JSON.stringify({
      $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } },
    });

    it("derives attribution for a VALID name-and-schema pair (paginated path)", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      makeTurso([
        eventRow({
          id: "evt-valid",
          name: "$prism_sign_up",
          properties: VALID_STD_PROPS,
          user_id: "user-123",
        }),
      ]);

      const result = await ProjectsController.getProjectEvents(
        makeCtx({ slug: SLUG }, {}, { user: { id: USER_ID } }, { limit: "10" }),
      );

      const body = bodyOf(result) as {
        events: Array<{ standardEvent: Record<string, unknown> | null; name: string }>;
      };
      const event = body.events[0];
      expect(event?.name).toBe("$prism_sign_up"); // raw name retained
      expect(event?.standardEvent).toEqual({
        key: "sign_up",
        displayName: "Sign up",
        category: "Identity",
        schemaVersion: 1,
      });
    });

    it("returns null attribution for a MALFORMED legacy row with a recognized protected name", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      // old/manually inserted row: right name, no valid $standard wrapper
      makeTurso([
        eventRow({
          id: "evt-legacy",
          name: "$prism_sign_up",
          properties: JSON.stringify({ method: "email" }),
        }),
      ]);

      const result = await ProjectsController.getProjectEvents(
        makeCtx({ slug: SLUG }, {}, { user: { id: USER_ID } }, { limit: "10" }),
      );

      const body = bodyOf(result) as {
        events: Array<{ standardEvent: unknown; name: string; properties: Record<string, unknown> | null }>;
      };
      const event = body.events[0];
      expect(event?.standardEvent).toBeNull();
      // the raw stored name and properties remain available for diagnosis
      expect(event?.name).toBe("$prism_sign_up");
      expect(event?.properties).toEqual({ method: "email" });
    });

    it("returns null attribution for custom events and automatic page views (legacy path)", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      makeTurso([
        eventRow({ id: "evt-custom", name: "checkout_completed" }),
        eventRow({
          id: "evt-page",
          name: "$prism_page_view",
          properties: JSON.stringify({
            $page: { host: "acme.com", path: "/", navigation: "initial", sequence: 1 },
          }),
        }),
      ]);

      const result = await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { slug: SLUG }),
      );

      // legacy path returns a plain array
      const events = bodyOf(result) as unknown as Array<{
        id: string;
        standardEvent: unknown;
        name: string;
      }>;
      expect(Array.isArray(events)).toBe(true);
      expect(events.find((e) => e.id === "evt-custom")?.standardEvent).toBeNull();
      // automatic protected events never masquerade as Standard Events
      expect(events.find((e) => e.id === "evt-page")?.standardEvent).toBeNull();
      expect(events.find((e) => e.id === "evt-page")?.name).toBe("$prism_page_view");
    });

    it("returns null attribution for automatic mobile records: screen_view and app_lifecycle", async () => {
      const neon = makeStore("member");
      getInstance.mockReturnValue(neon as never);
      makeTurso([
        eventRow({
          id: "evt-screen",
          name: "$prism_screen_view",
          properties: JSON.stringify({
            $screen: { name: "Home", navigation: "initial", sequence: 1 },
          }),
        }),
        eventRow({
          id: "evt-lifecycle",
          name: "$prism_app_lifecycle",
          properties: JSON.stringify({
            $lifecycle: { transition: "active", sequence: 1 },
          }),
        }),
      ]);

      const result = await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { slug: SLUG }),
      );

      const events = bodyOf(result) as unknown as Array<{
        id: string;
        standardEvent: unknown;
        name: string;
      }>;
      expect(events.find((e) => e.id === "evt-screen")?.standardEvent).toBeNull();
      expect(events.find((e) => e.id === "evt-screen")?.name).toBe("$prism_screen_view");
      expect(events.find((e) => e.id === "evt-lifecycle")?.standardEvent).toBeNull();
      expect(events.find((e) => e.id === "evt-lifecycle")?.name).toBe("$prism_app_lifecycle");
    });
  });
});
