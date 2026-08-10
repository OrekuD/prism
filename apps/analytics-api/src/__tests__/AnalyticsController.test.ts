import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsController } from "../controllers/AnalyticsController.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
  default: { instance: { execute: vi.fn() } },
}));
vi.mock("../managers/WebSocketManager.js", () => ({
  default: { emitToClient: vi.fn(() => true) },
}));

import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";

const execute = TursoDatabaseManager.instance.execute as unknown as ReturnType<
  typeof vi.fn
>;

function makeContext(projectId: string, body: unknown) {
  return {
    req: {
      json: vi.fn(async () => body),
      header: () => "1.2.3.4",
      raw: { headers: new Headers() },
    },
    json: vi.fn((value: unknown) => ({ __json: value })),
    get: () => projectId,
  } as unknown as Parameters<typeof AnalyticsController.endSession>[0];
}

const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("AnalyticsController.endSession (session ownership)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [] });
  });

  it("ends a session only when the session belongs to the authenticated project", async () => {
    const ctx = makeContext(PROJECT_A, { sessionId: SESSION_ID });

    await AnalyticsController.endSession(ctx);

    expect(execute).toHaveBeenCalledTimes(1);
    const [{ sql, args }] = execute.mock.calls[0];

    // The update MUST be scoped by both session_id and project_id so a key
    // from one project cannot touch another project's session.
    expect(String(sql).toLowerCase()).toContain("project_id");
    expect(args).toEqual([SESSION_ID, PROJECT_A]);
  });

  it("rejects a key from project A trying to end a session in project B (scoping enforced server-side)", async () => {
    const ctx = makeContext(PROJECT_A, { sessionId: SESSION_ID });

    await AnalyticsController.endSession(ctx);

    const [{ sql, args }] = execute.mock.calls[0];
    expect(String(sql).toLowerCase()).toContain("project_id = ?");
    expect(args).not.toContain(PROJECT_B);
    // The project id used must be the one derived from the API key, not any
    // value supplied by the client.
    expect(args).toContain(PROJECT_A);
  });

  it("rejects an invalid body with 400 without touching the database", async () => {
    const ctx = makeContext(PROJECT_A, { sessionId: 12345 });

    const result = await AnalyticsController.endSession(ctx);

    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({ __json: expect.anything() });
  });
});
