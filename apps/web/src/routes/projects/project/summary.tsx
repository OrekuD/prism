/**
 * Project overview route (Task 21 slice 7, v2 design replica).
 *
 * The dashboard shell owns the header, breadcrumbs, padding, and content
 * column — this route renders directly into it with no second header and
 * no custom page container. A slim control row holds the conversations
 * menu and the Overview/Chat toggle; the composer dock is viewport-fixed
 * beneath the shell column.
 *
 * Data behavior is unchanged: overview submits and insight investigation
 * create chats, in-chat submits continue, missing chats get a safe
 * non-disclosing return, and drafts scope per project+chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { InsightCandidate } from "@prism-analytics/types";
import { ChatView } from "@/components/project-overview/chat-view";
import { ComposerDock, type ComposerDockHandle } from "@/components/project-overview/composer";
import { ConversationsDropdown } from "@/components/project-overview/conversations-dropdown";
import { OverviewView } from "@/components/project-overview/overview-view";
import { Seg, SegTab } from "@/components/project-overview/primitives";
import "@/components/project-overview/project-overview.css";
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

  const rawRange = searchParams.get("range");
  const range = (RANGES as readonly string[]).includes(rawRange ?? "")
    ? (rawRange as string)
    : "7d";
  const view = searchParams.get("view") === "assistant" ? "chat" : "overview";
  const chatId = searchParams.get("chat");

  const overview = useProjectOverviewQuery(slug, { range });
  const conversations = useAssistantConversationsQuery(slug);
  const detail = useAssistantConversationQuery(
    slug,
    view === "chat" ? chatId : null,
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [streamByChat, setStreamByChat] = useState<Record<string, StreamState>>({});
  const [pendingChat, setPendingChat] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [sendError, setSendError] = useState<{ message: string; retryable: boolean } | null>(null);
  const dockRef = useRef<ComposerDockHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const returnFocus = useRef(false);

  const { send, stop, active } = useSendAssistantMessage(slug);
  const removeConversation = useDeleteAssistantConversation(slug);
  const decideProposal = useDecideAssistantProposal(slug);

  const draftScope = view === "chat" ? chatId : null;
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

  const patchParams = useCallback(
    (patch: (next: URLSearchParams) => void, replace = false) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          patch(next);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const goToOverview = useCallback(() => {
    returnFocus.current = true;
    patchParams((next) => {
      next.delete("view");
      next.delete("chat");
    });
  }, [patchParams]);

  const openChat = useCallback(
    (id: string) => {
      setSendError(null);
      patchParams((next) => {
        next.set("view", "assistant");
        next.set("chat", id);
      });
    },
    [patchParams],
  );

  const onViewChange = useCallback(
    (next: "overview" | "chat") => {
      setSendError(null);
      if (next === "overview") {
        goToOverview();
      } else {
        patchParams((inner) => {
          inner.set("view", "assistant");
        });
      }
    },
    [goToOverview, patchParams],
  );

  const chatMissing = view === "chat" && chatId !== null && detail.isError;

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus after any view change; the effect reads no reactive values
  useEffect(() => {
    if (returnFocus.current) {
      returnFocus.current = false;
      dockRef.current?.focus();
    }
  }, [view]);

  const runQuestion = useCallback(
    async (question: string, targetChatId: string | null) => {
      if (!slug) return;
      setSendError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const token = overview.data?.queryContextToken;
      if (targetChatId === null) {
        // Submitting without a chat switches views instantly (cards
        // unmount, chat fades in) and navigates to the server-assigned
        // chat as soon as the run-start frame names it.
        setPendingChat(true);
        patchParams((next) => {
          next.set("view", "assistant");
          next.delete("chat");
        });
      }
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
            if (targetChatId === null && state.conversationId) {
              openChat(state.conversationId);
            }
          },
        });
        if (final.error) {
          setSendError({ message: final.error.message, retryable: final.error.retryable });
        } else if (targetChatId !== null) {
          await queryClient.invalidateQueries({
            queryKey: conversationDetailKey(slug, targetChatId),
          });
        }
      } finally {
        if (targetChatId === null) setPendingChat(false);
      }
    },
    [slug, send, overview.data, queryClient, patchParams, openChat],
  );

  // A chat created mid-run lands on its URL: move the pending stream
  // state onto the assigned chat key once known.
  const pendingStream: StreamState | null =
    view === "chat" && chatId
      ? (streamByChat[chatId] ?? streamByChat.new ?? null)
      : null;

  const submitFromDock = useCallback(
    (question: string) => {
      if (view === "chat" && chatId) {
        void runQuestion(question, chatId);
      } else {
        void runQuestion(question, null);
      }
      setDraft("");
    },
    [view, chatId, runQuestion, setDraft],
  );

  const investigate = useCallback(
    (insight: InsightCandidate) => {
      // Investigate creates a NEW chat seeded with the deterministic
      // insight prompt — never appended to a prior topic.
      patchParams((next) => {
        next.set("view", "assistant");
        next.delete("chat");
      });
      setDraft(insight.askPrompt);
      dockRef.current?.focus();
    },
    [patchParams, setDraft],
  );

  const newChat = useCallback(() => {
    setSendError(null);
    goToOverview();
    dockRef.current?.focus();
  }, [goToOverview]);

  const deleteChat = useCallback(
    async (id: string) => {
      const ok = await removeConversation(id);
      if (!ok) return;
      if (id === chatId) goToOverview();
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

  const stream = view === "chat" ? pendingStream : null;
  const activeStream: StreamState | null =
    pendingChat && view === "chat" && !chatId
      ? (streamByChat.new ?? { ...INITIAL_STREAM_STATE })
      : stream;
  const emptyScopeLine = `Prism answers from your events, errors, and release data — ${slug ?? "this project"} · Last ${range}.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <ConversationsDropdown
          items={conversations.data?.items ?? []}
          selectedId={chatId}
          showNewChat={view === "chat"}
          onSelect={openChat}
          onNewChat={newChat}
          onDelete={(id) => void deleteChat(id)}
        />
        <div className="ml-auto">
          <Seg label="View">
            <SegTab
              selected={view === "overview"}
              onClick={() => onViewChange("overview")}
            >
              Overview
            </SegTab>
            <SegTab selected={view === "chat"} onClick={() => onViewChange("chat")}>
              Chat
            </SegTab>
          </Seg>
        </div>
      </div>

      {view === "overview" ? (
        <OverviewView
          resource={overview.data}
          isLoading={overview.isLoading}
          isError={overview.isError}
          onInvestigate={investigate}
        />
      ) : chatMissing ? (
        <div role="alert" className="mt-6 rounded-[2px] border border-border p-5">
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.022em]">
            That chat isn&apos;t available
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            It may have been deleted or belong to another project. Your other
            chats are unaffected.
          </p>
          <button
            type="button"
            onClick={goToOverview}
            className="mt-3 inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] border border-accent bg-accent px-3.5 text-[13px] font-medium text-white transition-colors duration-100 hover:border-accent-hover hover:bg-accent-hover"
          >
            Back to overview
          </button>
        </div>
      ) : (
        <ChatView
          detail={detail.data ?? null}
          stream={activeStream}
          streaming={active || detail.isLoading}
          sendError={sendError}
          emptyScopeLine={emptyScopeLine}
          onBack={goToOverview}
          onAsk={(prompt) => {
            setDraft(prompt);
            dockRef.current?.focus();
          }}
          definitionActions={(artifact) =>
            artifact.kind === "definition"
              ? confirmActions(artifact.proposalId)
              : undefined
          }
        />
      )}

      {/* Bottom clearance for the fixed dock. */}
      <div aria-hidden="true" className="h-48 shrink-0" />

      <div className="fixed inset-x-0 bottom-0 z-30 min-[1024px]:left-[240px]">
        <div
          aria-hidden="true"
          className="po-composer-fade pointer-events-none h-12"
        />
        <div className="mx-auto w-full max-w-[1800px] bg-canvas px-7 pb-5 max-[1023px]:px-5 max-[767px]:px-4">
          <ComposerDock
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
      </div>
    </div>
  );
}
