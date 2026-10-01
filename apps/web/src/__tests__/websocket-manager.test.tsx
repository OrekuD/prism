import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WebSocketManager } from "@/managers/WebSocketManager";
import { getServiceToken } from "@/lib/authClient";

vi.mock("@/lib/authClient", () => ({
  authClient: { useSession: () => ({ data: { session: { id: "session" } } }) },
  getServiceToken: vi.fn().mockResolvedValue("fresh-token"),
}));
vi.mock("@/lib/api", () => ({ WS_BASE_URL: "wss://live.example.test" }));

class FakeSocket {
  static sockets: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string, readonly protocols: string[]) {
    FakeSocket.sockets.push(this);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeSocket.sockets = [];
});

it("scopes Live sockets to the project and refreshes the token on reconnect", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const view = render(<WebSocketManager projectId="project-1" />);

  await act(async () => {});
  expect(FakeSocket.sockets[0]?.url).toBe("wss://live.example.test/ws?projectId=project-1");
  expect(FakeSocket.sockets[0]?.protocols).toEqual(["prism", "prism.jwt.fresh-token"]);
  act(() => FakeSocket.sockets[0]?.onopen?.());
  expect(FakeSocket.sockets[0]?.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "connect-project", data: { projectId: "project-1", token: "fresh-token" } }),
  );

  await act(async () => {
    FakeSocket.sockets[0]?.onclose?.({ code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(getServiceToken).toHaveBeenCalledTimes(2);
  expect(FakeSocket.sockets).toHaveLength(2);
  view.unmount();
  expect(FakeSocket.sockets[1]?.close).toHaveBeenCalledOnce();
});

it("retries when fetching the service token fails once", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(getServiceToken).mockRejectedValueOnce(new Error("temporary outage"));
  const view = render(<WebSocketManager projectId="project-1" />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(getServiceToken).toHaveBeenCalledTimes(2);
  expect(FakeSocket.sockets).toHaveLength(1);
  view.unmount();
});
