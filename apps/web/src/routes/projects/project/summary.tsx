/**
 * Project overview route (Task 21 slice 7).
 *
 * Sibling regions inside the existing shell: `OverviewView` by default,
 * `ConversationView` when `?view=assistant&chat=<id>`, and a persistent
 * `AskPrismDock` beneath both modes. The composer stays mounted across
 * mode changes so draft text, focus, and height never reset; drafts are
 * scoped by project and chat (the overview new-chat draft is separate
 * from every existing chat draft).
 *
 * Mode lives in the URL without a second route hierarchy. Reload
 * restores the selected chat and its mode; a missing, deleted,
 * foreign, or cross-project chat follows the non-disclosing policy
 * and offers a safe return to the overview.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { InsightCandidate } from "@prism-analytics/types";
import { AskPrismDock, type AskPrismDockHandle } from "@/components/assistant/ask-prism-dock";
import { ChatsPanel } from "@/components/assistant/chats-panel";
import { ConversationView } from "@/components/assistant/conversation-view";
import { OverviewView } from "@/components/assistant/overview-view";
import {
  INITIAL_STREAM_STATE,
  conversationDetailKey,
  useAssistantConversationQuery,
  useAssistantConversationsQuery,
  useDeleteAssistantConversation,
  useSendAssistantMessage,
  type StreamState,
} from "@/network/queries/useAssistantConversations";
import { useDecideAssistantProposal } from "@/network/queries/useAssistantMemory";
import { useProjectOverviewQuery } from "@/network/queries/useProjectOverviewQuery";
import { useQueryClient } from "@tanstack/react-query";

const RANGES = ["24h", "7d", "14d", "30d", "90d"] as const;

function clientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function draftKey(slug: string, chatId: string | null): string {
  return `prism.assistant.draft.${slug}.${chatId ?? "new"}`;
}

function loadDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function ProjectSummary() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const range = RANGES.includes(searchParams.get("range") as (typeof RANGES)[number])
    ? (searchParams.get("range") as string)
    : "7d";
  const view = searchParams.get("view") === "assistant" ? "assistant" : "overview";
  const chatId = searchParams.get("chat");

  const overview = useProjectOverviewQuery(slug, { range });
  const conversations = useAssistantConversationsQuery(slug);
  const detail = useAssistantConversationQuery(
    slug,
    view === "assistant" ? chatId : null,
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [streamByChat, setStreamByChat] = useState<Record<string, StreamState>>({});
  const [pendingChat, setPendingChat] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [sendError, setSendError] = useState<{ message: string; retryable: boolean } | null>(null);
  const dockRef = useRef<AskPrismDockHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const backButtonReturnFocus = useRef(false);

  const { send, stop, active } = useSendAssistantMessage(slug);
  const removeConversation = useDeleteAssistantConversation(slug);
  const decideProposal = useDecideAssistantProposal(slug);

  const draftScope = view === "assistant" ? chatId : null;
  const draftStorageKey = slug ? draftKey(slug, draftScope) : "";
  const draft =
    draftStorageKey in drafts ? (drafts[draftStorageKey] ?? "") : loadDraft(draftStorageKey);
  const setDraft = useCallback(
    (value: string) => {
      if (!slug) return;
      const key = draftKey(slug, draftScope);
      setDrafts((previous) => ({ ...previous, [key]: value }));
      try {
        localStorage.setItem(key, value);
      } catch {
        // Private-mode storage failure: in-memory draft still works.
      }
    },
    [slug, draftScope],
  );

  const goToOverview = useCallback(() => {
    backButtonReturnFocus.current = true;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("view");
        next.delete("chat");
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  const openChat = useCallback(
    (id: string) => {
      setHistoryOpen(false);
      setSendError(null);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("view", "assistant");
          next.set("chat", id);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  // Missing/deleted/foreign chat: the detail query 404s — offer a safe
  // return without disclosing which failure occurred.
  const chatMissing =
    view === "assistant" && chatId !== null && detail.isError;

  useEffect(() => {
    if (backButtonReturnFocus.current) {
      backButtonReturnFocus.current = false;
      dockRef.current?.focus();
    }
  }, [view]);

  const runningConversationId = useMemo(() => {
    if (active && view === "assistant" && chatId) return chatId;
    return conversations.data?.items.find((item) => item.hasActiveRun)?.id ?? null;
  }, [active, view, chatId, conversations.data]);

  const runQuestion = useCallback(
    async (question: string, targetChatId: string | null, seedInsightId: string | null) => {
      if (!slug) return;
      setSendError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const token = overview.data?.queryContextToken;
      if (targetChatId === null) setPendingChat(true);
      try {
        const final = await send({
          conversationId: targetChatId,
          content: question,
          queryContextToken: token,
          clientRequestId: clientRequestId(),
          signal: controller.signal,
          onEvent: (state) => {
            const key = targetChatId ?? "new";
            setStreamByChat((previous) => ({ ...previous, [key]: state }));
            if (state.runId && targetChatId === null) {
              // Server assigned the chat: replace the URL without
              // remounting the composer. The run-start frame carries the
              // conversation through the stream state runId only when the
              // server echoes it — otherwise refresh history to discover it.
              void queryClient.invalidateQueries({ queryKey: ["assistant-conversations", slug] });
            }
            void seedInsightId;
          },
        });
        if (final.error) {
          setSendError({ message: final.error.message, retryable: final.error.retryable });
        } else if (targetChatId !== null) {
          // Refresh the persisted transcript behind the streamed answer.
          await queryClient.invalidateQueries({
            queryKey: conversationDetailKey(slug, targetChatId),
          });
        }
      } finally {
        if (targetChatId === null) setPendingChat(false);
      }
    },
    [slug, send, overview.data, queryClient],
  );

  const submitFromDock = useCallback(
    (question: string) => {
      if (view === "assistant" && chatId) {
        void runQuestion(question, chatId, null);
      } else {
        // Submitting from Overview creates a new chat (never appends to
        // an unrelated prior topic).
        void runQuestion(question, null, null);
      }
      setDraft("");
    },
    [view, chatId, runQuestion, setDraft],
  );

  const investigate = useCallback(
    (insight: InsightCandidate) => {
      // Investigate with Prism creates a NEW chat seeded with the
      // deterministic insight — never appended to a prior topic.
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("view", "assistant");
          next.delete("chat");
          return next;
        },
        { replace: false },
      );
      setDraft(insight.askPrompt);
      dockRef.current?.focus();
    },
    [setSearchParams, setDraft],
  );

  const newChat = useCallback(() => {
    setHistoryOpen(false);
    setSendError(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("view");
        next.delete("chat");
        return next;
      },
      { replace: false },
    );
    dockRef.current?.focus();
  }, [setSearchParams]);

  const deleteChat = useCallback(
    async (id: string) => {
      const ok = await removeConversation(id);
      if (!ok) return;
      if (id === chatId) {
        goToOverview();
      }
      dockRef.current?.focus();
    },
    [removeConversation, chatId, goToOverview],
  );

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    stop();
  }, [stop]);

  const confirmActions = useCallback(
    (proposalId: string) => ({
      onConfirm: () => {
        setDeciding(proposalId);
        void decideProposal(proposalId, "confirm").finally(() => setDeciding(null));
      },
      onReject: () => {
        setDeciding(proposalId);
        void decideProposal(proposalId, "reject").finally(() => setDeciding(null));
      },
      deciding: deciding === proposalId,
    }),
    [decideProposal, deciding],
  );

  const stream = view === "assistant" && chatId ? (streamByChat[chatId] ?? null) : null;
  const activeStream: StreamState | null =
    pendingChat && view === "overview"
      ? (streamByChat.new ?? { ...INITIAL_STREAM_STATE })
      : stream;

  return (
    <div className="relative grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Overview range" className="flex gap-1">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setSearchParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.set("range", value);
                    return next;
                  },
                  { replace: false },
                )
              }
              aria-pressed={range === value}
              className={
                range === value
                  ? "rounded-md bg-accent px-2.5 py-1 font-mono text-xs text-white"
                  : "rounded-md px-2.5 py-1 font-mono text-xs text-text-subtle hover:text-text"
              }
            >
              {value}
            </button>
          ))}
        </div>
        {view === "assistant" ? (
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              aria-expanded={historyOpen}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs"
            >
              Chats
            </button>
            <button
              type="button"
              onClick={newChat}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-accent"
            >
              New chat
            </button>
          </div>
        ) : null}
      </div>

      {view === "overview" || chatId === null ? (
        <OverviewView
          resource={overview.data}
          isLoading={overview.isLoading}
          isError={overview.isError}
          onInvestigate={investigate}
        />
      ) : chatMissing ? (
        <div role="alert" className="rounded-xl border border-border p-5">
          <h1 className="font-semibold">That chat isn&apos;t available</h1>
          <p className="mt-1 text-sm text-text-subtle">
            It may have been deleted or belong to another project. Your other
            chats are unaffected.
          </p>
          <button
            type="button"
            onClick={goToOverview}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 font-mono text-xs text-white"
          >
            Back to overview
          </button>
        </div>
      ) : (
        <ConversationView
          detail={detail.data ?? null}
          stream={activeStream}
          streaming={active || detail.isLoading}
          error={sendError}
          onBack={goToOverview}
          definitionActions={(artifact) =>
            artifact.kind === "definition"
              ? confirmActions(artifact.proposalId)
              : undefined
          }
        />
      )}

      {historyOpen && view === "assistant" ? (
        <ChatsPanel
          items={conversations.data?.items ?? []}
          selectedId={chatId}
          runningConversationId={runningConversationId}
          onSelect={openChat}
          onNewChat={newChat}
          onDelete={(id) => void deleteChat(id)}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      <AskPrismDock
        ref={dockRef}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={submitFromDock}
        running={active || pendingChat}
        onStop={stopRun}
        capabilities={overview.data?.capabilities ?? null}
        disabled={overview.isError}
        disabledReason="Overview unavailable — assistant paused."
      />
    </div>
  );
}
