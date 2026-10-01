import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axiosInstance } from "@/utils/axiosInstance";
import {
  conversationDetailKey,
  conversationDetailOptions,
  useAssistantConversationQuery,
  useDeleteAssistantConversation,
  type ConversationDetail,
} from "@/network/queries/useAssistantConversations";

vi.mock("@/utils/axiosInstance", () => ({ axiosInstance: { get: vi.fn(), delete: vi.fn() } }));

const detail: ConversationDetail = {
  conversation: { id: "conv_a", slug: "chat_a", title: "Saved chat", seed: null, createdAt: 1, updatedAt: 1, lastMessageAt: 1 },
  messages: [{ id: "msg_a", seq: 0, role: "user", status: "complete", parts: [{ type: "text", text: "Saved question" }], failureCode: null }],
  activeRun: null,
};
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(() => { for (const client of clients.splice(0)) client.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("conversation transcript cache", () => {
  it("shares one in-flight read between prefetch and selection", async () => {
    const { client, wrapper } = setup();
    let resolve!: (value: { data: ConversationDetail }) => void;
    vi.mocked(axiosInstance.get).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const prefetch = client.prefetchQuery(conversationDetailOptions("alpha", "chat_a"));
    const hook = renderHook(() => useAssistantConversationQuery("alpha", "chat_a"), { wrapper });
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: detail }); await prefetch; });
    await waitFor(() => expect(hook.result.current.data).toEqual(detail));
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it("renders a ten-second-old cached chat immediately without refetching", () => {
    const { client, wrapper } = setup();
    client.setQueryData(conversationDetailKey("alpha", "chat_a"), detail, { updatedAt: Date.now() - 10_000 });
    const hook = renderHook(() => useAssistantConversationQuery("alpha", "chat_a"), { wrapper });
    expect(hook.result.current.data).toEqual(detail);
    expect(hook.result.current.isLoading).toBe(false);
    expect(axiosInstance.get).not.toHaveBeenCalled();
  });

  it.each(["stale", "running"])("keeps %s cached messages visible while refreshing", async (kind) => {
    const { client, wrapper } = setup();
    const cached = { ...detail, activeRun: kind === "running" ? { id: "run_a", status: "running" } : null };
    client.setQueryData(conversationDetailKey("alpha", "chat_a"), cached, { updatedAt: Date.now() - (kind === "stale" ? 31_000 : 1) });
    vi.mocked(axiosInstance.get).mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(() => useAssistantConversationQuery("alpha", "chat_a"), { wrapper });
    expect(hook.result.current.data).toEqual(cached);
    expect(hook.result.current.isLoading).toBe(false);
    await waitFor(() => expect(hook.result.current.isFetching).toBe(true));
  });

  it("does not reuse another project's transcript", () => {
    const { client, wrapper } = setup();
    client.setQueryData(conversationDetailKey("alpha", "chat_a"), detail);
    vi.mocked(axiosInstance.get).mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(() => useAssistantConversationQuery("beta", "chat_a"), { wrapper });
    expect(hook.result.current.data).toBeUndefined();
    expect(axiosInstance.get).toHaveBeenCalledWith("/projects/beta/assistant/conversations/chat_a", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("evicts a deleted transcript and cancels its pending prefetch", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(conversationDetailKey("alpha", "chat_a"), detail, { updatedAt: 1 });
    let signal: AbortSignal | undefined;
    vi.mocked(axiosInstance.get).mockImplementation((_url, config) => { signal = config?.signal as AbortSignal; return new Promise(() => {}); });
    vi.mocked(axiosInstance.delete).mockResolvedValue({ data: {} });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const prefetch = client.prefetchQuery(conversationDetailOptions("alpha", "chat_a"));
    const hook = renderHook(() => useDeleteAssistantConversation("alpha"), { wrapper });
    await act(async () => { expect(await hook.result.current("chat_a")).toBe(true); });
    await prefetch;
    expect(signal?.aborted).toBe(true);
    expect(client.getQueryData(conversationDetailKey("alpha", "chat_a"))).toBeUndefined();
  });
});
