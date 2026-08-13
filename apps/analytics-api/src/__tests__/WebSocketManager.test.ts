import "./testEnv.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Roles } from "@prism/types";
import WebSocketManager from "../managers/WebSocketManager.js";

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
import { JwtVerifier } from "../services/JwtVerifier.js";

type Row = Record<string, unknown>;
const instance = NeonDatabaseManager.instance as unknown as ReturnType<
  typeof vi.fn
>;

// The service JWT is issued by the main API's Better Auth JWT plugin (RS256)
// and verified against its JWKS. Tests generate their own key pair and serve
// the JWKS through a mocked fetch.
let TEST_KEY_PAIR: { publicKey: CryptoKey; privateKey: CryptoKey };
let TEST_JWKS: Record<string, unknown>;
let SIGNED_OWNER_TOKEN = "";

async function initKeyPair() {
  TEST_KEY_PAIR = await generateKeyPair("RS256");
  const jwk = await exportJWK(TEST_KEY_PAIR.publicKey);
  TEST_JWKS = {
    keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-key-1" }],
  };
}

function mockJwksFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => TEST_JWKS,
    })),
  );
}

function mockDb(handler: (sql: string) => Promise<Row[]>) {
  instance.mockImplementation(
    async (strings: TemplateStringsArray): Promise<Row[]> => {
      const sql = strings.join("?");
      return handler(sql);
    },
  );
}

async function signAccessToken(payload: { userId: string }) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer("prism")
    .setAudience("prism-analytics")
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(TEST_KEY_PAIR.privateKey);
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
function defaultDb(rows: {
  users?: Row[];
  projects?: Row[];
  teams?: Row[];
  teamMembers?: Row[];
}) {
  mockDb((sql) => {
    if (sql.includes('FROM "user"') || sql.includes("FROM user")) {
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
      token: SIGNED_OWNER_TOKEN,
      // A malicious client may try to send extra identity fields. The server
      // must ignore anything except the signed token.
      ...overrides,
    },
  };
}

describe("WebSocketManager.connect-project", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    WebSocketManager.resetForTests();
    JwtVerifier.resetForTests();
    await initKeyPair();
    mockJwksFetch();
    process.env.AUTH_BASE_URL = "http://localhost:8787";
    SIGNED_OWNER_TOKEN = await signAccessToken({ userId: OWNER_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("rejects a token signed by an unknown key (tampered / forged)", async () => {
    defaultDb({});
    const ws = makeSocket();
    const { privateKey: forgedKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("prism")
      .setAudience("prism-analytics")
      .setSubject(OWNER_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(forgedKey);

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
            token: await signAccessToken({ userId: STRANGER_ID }),
            userId: OWNER_ID,
          }),
        ),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects an expired service JWT", async () => {
    defaultDb({});
    const ws = makeSocket();

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("prism")
      .setAudience("prism-analytics")
      .setSubject(OWNER_ID)
      .setIssuedAt()
      .setExpirationTime("-1m")
      .sign(TEST_KEY_PAIR.privateKey);

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage({ token: expired })) } as unknown as Event,
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

  it("authenticates the ADMIN owner (role-agnostic user check)", async () => {
    // release review: first-boot owners are promoted to ADMIN — the
    // realtime auth must verify the ACTIVE user regardless of role and
    // authorize through project/team membership.
    const seenSql: string[] = [];
    mockDb((sql) => {
      seenSql.push(sql);
      if (sql.includes('FROM "user"') || sql.includes("FROM user")) {
        return Promise.resolve([{ id: OWNER_ID, role: Roles.ADMIN }]);
      }
      if (sql.includes("FROM projects")) {
        return Promise.resolve([{ team_id: TEAM_ID }]);
      }
      if (sql.includes("FROM teams")) {
        return Promise.resolve([{ id: TEAM_ID, owner_id: OWNER_ID }]);
      }
      if (sql.includes("FROM team_members")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).toContain(PROJECT_ID);
    // the user query must be ROLE-AGNOSTIC — no role filter at all
    const userQuery = seenSql.find((sql) => sql.includes('FROM "user"'));
    expect(userQuery).toBeDefined();
    expect(String(userQuery)).not.toContain("role");
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
      users: [{ id: STRANGER_ID, role: Roles.USER }],
      teamMembers: [],
    });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            token: await signAccessToken({ userId: STRANGER_ID }),
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
      users: [{ id: MEMBER_ID, role: Roles.USER }],
      teamMembers: [{ id: "m1" }],
    });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            token: await signAccessToken({ userId: MEMBER_ID }),
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

  it("rejects a token for a user that does not exist in the product database", async () => {
    defaultDb({ users: [] });
    const ws = makeSocket();

    await WebSocketManager.onMessage(
      { data: JSON.stringify(connectMessage()) } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });

  it("rejects a token signed with the wrong issuer", async () => {
    defaultDb({});
    const ws = makeSocket();

    const wrongIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("evil")
      .setAudience("prism-analytics")
      .setSubject(OWNER_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(TEST_KEY_PAIR.privateKey);

    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(connectMessage({ token: wrongIssuer })),
      } as unknown as Event,
      ws,
    );

    expect(WebSocketManager.getConnectedClientIds()).not.toContain(PROJECT_ID);
  });
});

describe("WebSocketManager subscription lifecycle", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    WebSocketManager.resetForTests();
    JwtVerifier.resetForTests();
    await initKeyPair();
    mockJwksFetch();
    process.env.AUTH_BASE_URL = "http://localhost:8787";
    SIGNED_OWNER_TOKEN = await signAccessToken({ userId: OWNER_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function subscribe(ws: ReturnType<typeof makeSocket>, projectId: string) {
    await WebSocketManager.onMessage(
      {
        data: JSON.stringify(
          connectMessage({
            projectId,
            token: await signAccessToken({ userId: OWNER_ID }),
          }),
        ),
      } as unknown as Event,
      ws,
    );
  }

  it("delivers exactly one event for a duplicate subscription", async () => {
    defaultDb({});
    const ws = makeSocket();

    await subscribe(ws, PROJECT_ID);
    await subscribe(ws, PROJECT_ID);

    const delivered = WebSocketManager.emitToClient(PROJECT_ID, "once");
    expect(delivered).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith("once");
  });

  it("stops delivering to the old project when a socket switches projects", async () => {
    defaultDb({});
    const ws = makeSocket();
    const OTHER_PROJECT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    await subscribe(ws, PROJECT_ID);
    await subscribe(ws, OTHER_PROJECT);

    expect(WebSocketManager.emitToClient(PROJECT_ID, "old")).toBe(false);
    expect(WebSocketManager.emitToClient(OTHER_PROJECT, "new")).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith("new");
    expect(WebSocketManager.getConnectedClientIds()).toEqual([OTHER_PROJECT]);
  });

  it("removes every reference to a closed socket, even after switching projects", async () => {
    defaultDb({});
    const ws = makeSocket();
    const OTHER_PROJECT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    await subscribe(ws, PROJECT_ID);
    await subscribe(ws, OTHER_PROJECT);
    WebSocketManager.onClose(ws);

    expect(WebSocketManager.getConnectedClientIds()).toHaveLength(0);
    expect(WebSocketManager.emitToClient(OTHER_PROJECT, "x")).toBe(false);
  });

  it("does not let a failing socket disrupt delivery to healthy sockets", async () => {
    defaultDb({});
    const broken = makeSocket();
    (broken as unknown as { send: ReturnType<typeof vi.fn> }).send.mockImplementation(
      () => {
        throw new Error("socket closed");
      },
    );
    const healthy = makeSocket();

    await subscribe(broken, PROJECT_ID);
    await subscribe(healthy, PROJECT_ID);

    expect(() => WebSocketManager.emitToClient(PROJECT_ID, "hi")).not.toThrow();
    expect(healthy.send).toHaveBeenCalledWith("hi");
  });
});
