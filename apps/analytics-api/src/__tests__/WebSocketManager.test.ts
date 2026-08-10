import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { Roles } from "@prism/types";
import WebSocketManager from "../managers/WebSocketManager.js";

const SECRET = process.env.JWT_SECRET_KEY ?? "";

/**
 * Mock the Neon (Postgres) database manager.
 * The production manager is a `postgres` client that is impossible to use
 * without real credentials, so we stub `instance` and drive it with canned
 * rows keyed by the SQL fragment in the query.
 */
vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));

import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";

type Row = Record<string, unknown>;
const instance = NeonDatabaseManager.instance as unknown as ReturnType<
  typeof vi.fn
>;

function mockDb(handler: (sql: string) => Promise<Row[]>) {
  instance.mockImplementation(
    async (strings: TemplateStringsArray): Promise<Row[]> => {
      const sql = strings.join("?");
      return handler(sql);
    },
  );
}

function signAccessToken(payload: { token: string; userId: string }) {
  return jwt.sign(payload, SECRET, { algorithm: "HS256" });
}

function makeSocket() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    raw: {},
  } as unknown as Parameters<typeof WebSocketManager.onMessage>[1];
}

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";
const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEAM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OPAQUE_TOKEN = "c".repeat(64);

function defaultDb(rows: {
  oauth?: Row[];
  users?: Row[];
  projects?: Row[];
  teams?: Row[];
  teamMembers?: Row[];
}) {
  mockDb((sql) => {
    if (sql.includes("oauth_access_tokens")) {
      return Promise.resolve(
        rows.oauth ?? [{ user_id: OWNER_ID }],
      );
    }
    if (sql.includes("FROM users")) {
      return Promise.resolve(rows.users ?? [{ id: OWNER_ID, role: Roles.USER }]);
    }
    if (sql.includes("FROM projects")) {
      return Promise.resolve(rows.projects ?? [{ team_id: TEAM_ID }]);
    }
    if (sql.includes("FROM teams")) {
      return Promise.resolve(rows.teams ?? [{ id: TEAM_ID, owner_id: OWNER_ID }]);
    }
    if (sql.includes("FROM team_members")) {
      return Promise.resolve(rows.teamMembers ?? [{ id: "m1" }]);
    }
    return Promise.resolve([]);
  });
}

function connectMessage(overrides: Partial<{ projectId: string; token: string; userId: string }> = {}) {
  return {
    type: "connect-project",
    data: {
      projectId: PROJECT_ID,
      token: signAccessToken({ token: OPAQUE_TOKEN, userId: OWNER_ID }),
      // A malicious client may try to send extra identity fields. The server
      // must ignore anything except the signed token.
      ...overrides,
    },
  };
}

describe("WebSocketManager.connect-project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    WebSocketManager.resetForTests();
  });

  it("rejects a connection message without a token (unauthenticated)", async () => {
    defaultDb({});
    const ws = makeSocket();
    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage({ token: "" })) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a malformed JSON message without crashing", async () => {
    defaultDb({});
    const ws = makeSocket();
    await WebSocketManager.onMessage({ data: "not-json" } as unknown as Event, ws);

    expect(WebSocketManager.getConnectedClientIds()).toHaveLength(0);
  });

  it("rejects a token that does not verify (wrong secret / tampered)", async () => {
    defaultDb({});
    const ws = makeSocket();
    const forged = jwt.sign(
      { token: OPAQUE_TOKEN, userId: OWNER_ID },
      "wrong-secret",
      { algorithm: "HS256" },
    );

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage({ token: forged })) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a spoofed userId field — identity comes from the token, never the client", async () => {
    // The signed token belongs to a stranger. The database (authoritative
    // source) confirms the stranger is not a member of the project's team.
    defaultDb({
      oauth: [{ user_id: STRANGER_ID }],
      users: [{ id: STRANGER_ID, role: Roles.USER }],
      teamMembers: [],
    });
    const ws = makeSocket();

    // Client claims to be the project owner, but the signed token belongs to
    // the stranger. The server must derive identity from the token only.
    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            token: signAccessToken({ token: OPAQUE_TOKEN, userId: STRANGER_ID }),
            userId: OWNER_ID,
          }),
        ),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a revoked OAuth access token", async () => {
    defaultDb({ oauth: [] });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects an expired OAuth access token (expiry_at <= NOW returns no row)", async () => {
    defaultDb({ oauth: [] });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a suspended or deleted user", async () => {
    defaultDb({ users: [] });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects an unknown project", async () => {
    defaultDb({ projects: [] });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a valid user who does not belong to the project's team", async () => {
    defaultDb({
      oauth: [{ user_id: STRANGER_ID }],
      users: [{ id: STRANGER_ID, role: Roles.USER }],
      teamMembers: [],
    });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            token: signAccessToken({ token: OPAQUE_TOKEN, userId: STRANGER_ID }),
          }),
        ),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("accepts the team owner", async () => {
    defaultDb({});
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).toContain(PROJECT_ID);
  });

  it("accepts a regular team member", async () => {
    defaultDb({
      oauth: [{ user_id: MEMBER_ID }],
      users: [{ id: MEMBER_ID, role: Roles.USER }],
      teamMembers: [{ id: "m1" }],
    });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            token: signAccessToken({ token: OPAQUE_TOKEN, userId: MEMBER_ID }),
          }),
        ),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).toContain(PROJECT_ID);
  });

  it("removes closed sockets from the client map", async () => {
    defaultDb({});
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );
    expect(WebSocketManager.getConnectedClientIds()).toContain(PROJECT_ID);

    WebSocketManager.onClose(ws);
    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects an access token whose JWT payload has no backing opaque token", async () => {
    defaultDb({});
    const ws = makeSocket();

    const missingOpaque = jwt.sign(
      { userId: OWNER_ID },
      SECRET,
      { algorithm: "HS256" },
    );

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(connectMessage({ token: missingOpaque })),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });
});
