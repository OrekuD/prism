import { expect, it, vi } from "vitest";

const { verify, dbRows } = vi.hoisted(() => ({
  verify: vi.fn(),
  dbRows: { value: [] as { id: string }[] },
}));
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("../services/JwtVerifier.js", () => ({ JwtVerifier: { verify } }));
vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { forRequest: () => async () => dbRows.value },
}));

import worker from "../worker.js";

it("keeps liveness up but rejects traffic until hosted secrets are configured", async () => {
  const env = { LIVE_PROJECT: {} } as never;
  const executionCtx = {} as never;
  const live = await worker.fetch(new Request("https://example.test/health/live"), env, executionCtx);
  const ready = await worker.fetch(new Request("https://example.test/health/ready"), env, executionCtx);
  const ingest = await worker.fetch(new Request("https://example.test/api/v2/ingest", { method: "POST" }), env, executionCtx);
  expect(live.status).toBe(200);
  expect(ready.status).toBe(503);
  expect(ingest.status).toBe(503);
});

it("rejects an unauthenticated WebSocket before creating a Live room", async () => {
  const getByName = vi.fn();
  const env = {
    LIVE_PROJECT: { getByName },
    DATABASE_URL: "postgres://configured",
    TURSO_DATABASE_URL: "libsql://configured",
    TURSO_AUTH_TOKEN: "configured",
    ANALYTICS_INSTALLATION_SALT: "configured",
    AUTH_BASE_URL: "https://api.example.test",
  } as never;
  const request = new Request(
    "https://example.test/ws?projectId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    { headers: { Upgrade: "websocket" } },
  );
  const response = await worker.fetch(request, env, {} as never);
  expect(response.status).toBe(401);
  expect(getByName).not.toHaveBeenCalled();
});

it("routes only a verified member to the project room", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const getByName = vi.fn().mockReturnValue({ fetch });
  const env = {
    LIVE_PROJECT: { getByName }, DATABASE_URL: "postgres://configured",
    TURSO_DATABASE_URL: "libsql://configured", TURSO_AUTH_TOKEN: "configured",
    ANALYTICS_INSTALLATION_SALT: "configured", AUTH_BASE_URL: "https://api.example.test",
  } as never;
  const request = new Request("https://example.test/ws?projectId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "prism, prism.jwt.signed-token" },
  });

  verify.mockResolvedValueOnce({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 });
  dbRows.value = [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }];
  const response = await worker.fetch(request, env, {} as never);
  expect(response.status).toBe(200);
  expect(verify).toHaveBeenCalledWith("signed-token", "https://api.example.test/api/auth/jwks");
  expect(getByName).toHaveBeenCalledWith("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  expect(fetch).toHaveBeenCalledOnce();
});
