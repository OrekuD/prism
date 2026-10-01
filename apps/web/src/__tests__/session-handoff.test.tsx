import { afterEach, expect, it, vi } from "vitest";
import { waitForSession } from "@/lib/session";

const state = vi.hoisted(() => ({ visible: false }));
const refetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authClient", () => ({ authClient: {
  $store: { atoms: { session: { get: () => ({
    data: state.visible ? { session: { id: "s" } } : null,
    refetch,
  }) } } },
  getSession: async () => ({ data: { session: { id: "s" } } }),
} }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); state.visible = false; });

it("does not confirm navigation from a cookie response while the router atom is signed out", async () => {
  vi.useFakeTimers();
  refetch.mockResolvedValue(undefined);
  const result = waitForSession(600);
  await vi.runAllTimersAsync();
  expect(await result).toBe(false);
});

it("refreshes the router atom when the cookie becomes available", async () => {
  refetch.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { state.visible = true; });
  expect(await waitForSession()).toBe(true);
  expect(refetch).toHaveBeenCalledTimes(2);
});
