/**
 * Project overview route (Task 21 slice 7, v2 design replica).
 *
 * The dashboard shell owns the outer frame and content column. Overview and
 * conversations share one bottom-centered composer so it stays within reach
 * while the widgets or transcript scroll behind it.
 *
 * Data behavior is unchanged: overview submits and insight investigation
 * create chats, in-chat submits continue, missing chats get a safe
 * non-disclosing return, and drafts scope per project+chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { InsightCandidate } from "@prism-analytics/types";
import { ChatView } from "@/components/project-overview/chat-view";
import {
  ComposerDock,
  type ComposerDockHandle,
} from "@/components/project-overview/composer";
import { ConversationsDropdown } from "@/components/project-overview/conversations-dropdown";
import { OverviewView } from "@/components/project-overview/overview-view";
import { ArrowLeft, Plus } from "@/components/ui/hugeicons";
import "@/components/project-overview/project-overview.css";
import {
  INITIAL_STREAM_STATE,
  conversationDetailKey,
  useAssistantConversationQuery,
  useAssistantConversationsQuery,
  usePrefetchAssistantConversation,
  useSendAssistantMessage,
  type StreamState,
} from "@/network/queries/useAssistantConversations";
import { useDecideAssistantProposal } from "@/network/queries/useAssistantMemory";
import { useProjectOverviewQuery } from "@/network/queries/useProjectOverviewQuery";

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

export function ProjectSummary({ freshChat = false }: { freshChat?: boolean }) {
  const { slug, conversationSlug } = useParams<{
    slug: string;
    conversationSlug?: string;
  }>();
  const wrkSlug = useParams<{ wrkSlug: string }>().wrkSlug;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fixed default window: the endpoint owns range resolution, and the URL
  // stays clean (no range pills, no query params on these routes).
  const range = "7d";
  // View lives in the route, not the query string: the index route is the
  // overview, `agent` is a fresh chat, and `agent/:conversationSlug` is an
  // existing chat.
  const view =
    freshChat || conversationSlug !== undefined ? "chat" : "overview";
  const chatSlug = conversationSlug ?? null;
  const projectBase = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}`;

  const overview = useProjectOverviewQuery(slug, { range });
  const conversations = useAssistantConversationsQuery(slug);
  const conversationItems = conversations.data?.pages.flatMap((page) => page.items) ?? [];
  const prefetchConversation = usePrefetchAssistantConversation(slug);
  const detail = useAssistantConversationQuery(
    slug,
    view === "chat" ? chatSlug : null
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [streamByChat, setStreamByChat] = useState<Record<string, StreamState>>(
    {}
  );
  const [pendingChat, setPendingChat] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<{
    content: string;
    chat: string | null;
    afterSeq: number;
  } | null>(null);
  const selectedChatRef = useRef<string | null>(null);
  selectedChatRef.current = chatSlug;
  const navigationVersion = useRef(0);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [sendError, setSendError] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const dockRef = useRef<ComposerDockHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const returnFocus = useRef(false);

  const { send, stop, active } = useSendAssistantMessage(slug);
  const decideProposal = useDecideAssistantProposal(slug);

  // Warm the chats people are most likely to open without competing with
  // the initial overview read or loading every transcript in a project.
  useEffect(() => {
    if (!conversations.data) return;
    for (const item of conversations.data.pages[0]?.items.slice(0, 3) ?? []) {
      prefetchConversation(item.slug);
    }
  }, [conversations.data, prefetchConversation]);

  const draftScope =
    view === "chat" ? (chatSlug ?? "agent-fresh") : "overview-new";
  const draftStorageKey = slug ? draftKey(slug, draftScope) : "";
  const draft =
    draftStorageKey in drafts
      ? (drafts[draftStorageKey] ?? "")
      : loadDraft(draftStorageKey);
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
    [slug, draftScope]
  );

  const goToOverview = useCallback(() => {
    navigationVersion.current += 1;
    returnFocus.current = true;
    void navigate(projectBase);
  }, [navigate, projectBase]);

  const openChat = useCallback(
    (conversationSlug: string) => {
      navigationVersion.current += 1;
      setSendError(null);
      void navigate(`${projectBase}/agent/${conversationSlug}`);
    },
    [navigate, projectBase]
  );

  const openFreshChat = useCallback(() => {
    navigationVersion.current += 1;
    setSendError(null);
    setPendingMessage(null);
    void navigate(`${projectBase}/agent`);
  }, [navigate, projectBase]);

  const chatFetchFailed = view === "chat" && chatSlug !== null && detail.isError;
  const chatErrorStatus = (
    detail.error as { response?: { status?: number } } | null
  )?.response?.status;
  const chatMissing = chatFetchFailed && chatErrorStatus === 404;
  const chatLoadFailed = chatFetchFailed && !chatMissing;

  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus after any view change; the effect reads no reactive values
  useEffect(() => {
    if (returnFocus.current) {
      returnFocus.current = false;
      dockRef.current?.focus();
    }
  }, [view]);

  const runQuestion = useCallback(
    async (question: string, targetChatSlug: string | null) => {
      if (!slug) return;
      setSendError(null);
      // The store numbers the first message zero. The optimistic boundary
      // must precede it, otherwise the persisted first turn never replaces it.
      const afterSeq = targetChatSlug
        ? Math.max(
            -1,
            ...(detail.data?.messages ?? []).map((message) => message.seq)
          )
        : -1;
      setPendingMessage({ content: question, chat: targetChatSlug, afterSeq });
      let assignedChat = targetChatSlug;
      const startedNavigation = navigationVersion.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const token = overview.data?.queryContextToken;
      if (targetChatSlug === null) {
        // Submitting without a chat switches views instantly (cards
        // unmount, chat fades in) and navigates to the server-assigned
        // chat as soon as the stream names its slug.
        setPendingChat(true);
        if (view !== "chat") {
          void navigate(`${projectBase}/agent`);
        }
      }
      try {
        const final = await send({
          conversationSlug: targetChatSlug,
          content: question,
          queryContextToken: token,
          clientRequestId: clientRequestId(),
          signal: controller.signal,
          onEvent: (state) => {
            const key = state.conversationSlug ?? assignedChat ?? "new";
            setStreamByChat((previous) => {
              const next = { ...previous, [key]: state };
              if (state.conversationSlug && targetChatSlug === null) {
                const { new: _dropped, ...rest } = next;
                void _dropped;
                return rest;
              }
              return next;
            });
            if (assignedChat === null && state.conversationSlug) {
              assignedChat = state.conversationSlug;
              setPendingMessage((previous) =>
                previous ? { ...previous, chat: assignedChat } : null
              );
              if (
                navigationVersion.current === startedNavigation &&
                selectedChatRef.current === null
              )
                openChat(state.conversationSlug);
            }
          },
        });
        if (final.error) {
          setSendError({
            message: final.error.message,
            retryable: final.error.retryable,
          });
        } else {
          // The answer is now persisted: refresh the transcript, then
          // drop the live stream copy so the same answer never renders
          // twice (persisted message + lingering stream).
          const persistedSlug = targetChatSlug ?? final.conversationSlug;
          if (persistedSlug) {
            await queryClient.invalidateQueries({
              queryKey: conversationDetailKey(slug, persistedSlug),
            });
          }
          const bucket = assignedChat ?? "new";
          setStreamByChat((previous) => {
            if (!(bucket in previous)) return previous;
            const { [bucket]: _dropped, ...rest } = previous;
            void _dropped;
            return rest;
          });
        }
      } finally {
        if (targetChatSlug === null) setPendingChat(false);
      }
    },
    [
      slug,
      send,
      overview.data,
      detail.data,
      queryClient,
      view,
      navigate,
      projectBase,
      openChat,
    ]
  );

  // A chat created mid-run lands on its URL: move the pending stream
  // state onto the assigned chat key once known.
  const pendingStream: StreamState | null =
    view === "chat" ? (streamByChat[chatSlug ?? "new"] ?? null) : null;

  const submitFromDock = useCallback(
    (question: string) => {
      if (view === "chat" && chatSlug) {
        void runQuestion(question, chatSlug);
      } else {
        void runQuestion(question, null);
      }
      setDraft("");
    },
    [view, chatSlug, runQuestion, setDraft]
  );

  const investigate = useCallback(
    (insight: InsightCandidate) => {
      // Investigate creates a NEW chat seeded with the deterministic
      // insight prompt — never appended to a prior topic.
      void navigate(`${projectBase}/agent`);
      const key = draftKey(slug ?? "", "agent-fresh");
      setDrafts((previous) => ({ ...previous, [key]: insight.askPrompt }));
      dockRef.current?.focus();
    },
    [navigate, projectBase, slug]
  );

  const newChat = useCallback(() => {
    setSendError(null);
    if (!active) setPendingMessage(null);
    openFreshChat();
    dockRef.current?.focus();
  }, [openFreshChat, active]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    stop();
  }, [stop]);

  const confirmActions = useCallback(
    (proposalId: string) => ({
      onConfirm: () => {
        setDeciding(proposalId);
        void decideProposal(proposalId, "confirm").finally(() =>
          setDeciding(null)
        );
      },
      onReject: () => {
        setDeciding(proposalId);
        void decideProposal(proposalId, "reject").finally(() =>
          setDeciding(null)
        );
      },
      deciding: deciding === proposalId,
    }),
    [decideProposal, deciding]
  );

  const stream = view === "chat" ? pendingStream : null;
  const activeStream: StreamState | null =
    pendingChat && pendingMessage?.chat === null && view === "chat" && !chatSlug
      ? (streamByChat.new ?? { ...INITIAL_STREAM_STATE })
      : stream;
  const pendingTurn = pendingMessage?.chat === chatSlug ? pendingMessage : null;
  const persistedUser = pendingTurn
    ? detail.data?.messages.find(
        (message) =>
          message.role === "user" &&
          message.seq > pendingTurn.afterSeq &&
          message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("\n") === pendingTurn.content
      )
    : undefined;
  // History can arrive before the stream closes. Once this turn's complete
  // answer is in the transcript, it owns rendering even while SSE drains.
  const answerPersisted = Boolean(
    activeStream?.answer &&
    persistedUser &&
    detail.data?.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.seq === persistedUser.seq + 1 &&
        message.status === "complete"
    )
  );

  const conversationsMenu = (
    <ConversationsDropdown
      items={conversationItems}
      selectedSlug={chatSlug}
      selectedTitle={view === "chat" ? detail.data?.conversation?.title ?? (chatSlug ? null : "New chat") : null}
      onSelect={openChat}
      onNewChat={newChat}
      onPrefetch={prefetchConversation}
      onLoadMore={() => { void conversations.fetchNextPage(); }}
      hasMore={conversations.hasNextPage}
      loadingMore={conversations.isFetchingNextPage}
    />
  );
  const composer = (
    <ComposerDock
      ref={dockRef}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={submitFromDock}
      running={active || pendingChat}
      onStop={stopRun}
      capabilities={overview.data?.capabilities ?? null}
      showSuggestions={view === "overview" || chatSlug === null}
      disabled={overview.isError}
      disabledReason="Overview unavailable — assistant paused."
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {view === "chat" ? (
            <>
              <button
                type="button"
                onClick={goToOverview}
                aria-label="Back to overview"
                className="grid size-10 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
              </button>
              {conversationsMenu}
            </>
          ) : (
            <div>
              <h1 className="font-mono text-[26px] font-semibold leading-tight tracking-[-0.035em] text-text">Overview</h1>
              <p className="mt-1 text-[13px] text-text-muted">Last 7 days</p>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {view === "overview" ? conversationsMenu : (
            <button
              type="button"
              onClick={newChat}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Plus aria-hidden="true" className="size-4" />
              <span className="max-[480px]:sr-only">New chat</span>
            </button>
          )}
        </div>
      </header>

      {view === "overview" ? (
          <OverviewView
            resource={overview.data}
            isLoading={overview.isLoading}
            isError={overview.isError}
            onInvestigate={investigate}
          />
      ) : chatMissing ? (
        <div
          role="alert"
          className="mt-6 rounded-[16px] border border-border p-5"
        >
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
            className="mt-3 inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-accent-hover"
          >
            Back to overview
          </button>
        </div>
      ) : (
        <>
        {chatLoadFailed ? (
          <div role="alert" className="mt-6 rounded-[16px] border border-border p-5">
            {detail.data ? (
              <p className="text-sm text-text-muted">
                Couldn't refresh this chat. Showing saved messages.
              </p>
            ) : (
              <>
                <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.022em]">
                  Couldn't load this chat
                </h1>
                <p className="mt-1.5 text-sm text-text-muted">
                  Something went wrong while loading the conversation. Try again.
                </p>
              </>
            )}
            <button
              type="button"
              onClick={() => { void detail.refetch(); }}
              disabled={detail.isFetching}
              aria-busy={detail.isFetching}
              className="mt-3 inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-accent-hover disabled:opacity-50"
            >
              {detail.isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {!chatLoadFailed || detail.data ? (
        <ChatView
          detail={detail.data ?? null}
          pendingMessage={
            pendingTurn && !persistedUser ? pendingTurn.content : null
          }
          stream={answerPersisted ? null : activeStream}
          streaming={active}
          loading={detail.isLoading}
          sendError={pendingMessage?.chat === chatSlug ? sendError : null}
          onBack={goToOverview}
          onAsk={(prompt) => {
            // Follow-up pills send immediately; the member never
            // re-types or confirms them.
            if (view === "chat" && chatSlug) {
              void runQuestion(prompt, chatSlug);
            } else {
              void runQuestion(prompt, null);
            }
          }}
          definitionActions={(artifact) =>
            artifact.kind === "definition"
              ? confirmActions(artifact.proposalId)
              : undefined
          }
        />
        ) : null}
        </>
      )}

      <div aria-hidden="true" className="h-64 shrink-0" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] min-[1024px]:left-[260px]">
        <div aria-hidden="true" className="po-composer-fade absolute inset-x-0 -top-12 bottom-0" />
        <div className="relative mx-auto w-full max-w-[820px]">
          {composer}
        </div>
      </div>
    </div>
  );
}
