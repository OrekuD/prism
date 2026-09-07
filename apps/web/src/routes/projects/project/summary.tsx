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
import { Seg, SegTab } from "@/components/project-overview/primitives";
import "@/components/project-overview/project-overview.css";
import {
  INITIAL_STREAM_STATE,
  conversationDetailKey,
  useAssistantConversationQuery,
  useAssistantConversationsQuery,
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

  const onViewChange = useCallback(
    (next: "overview" | "chat") => {
      setSendError(null);
      if (next === "overview") {
        goToOverview();
      } else {
        openFreshChat();
      }
    },
    [goToOverview, openFreshChat]
  );

  const chatMissing = view === "chat" && chatSlug !== null && detail.isError;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {view === "chat" ? (
          <ConversationsDropdown
            items={conversations.data?.items ?? []}
            selectedSlug={chatSlug}
            onSelect={openChat}
            onNewChat={newChat}
          />
        ) : null}
        <div className="ml-auto">
          <Seg label="View">
            <SegTab
              selected={view === "overview"}
              onClick={() => onViewChange("overview")}
            >
              Overview
            </SegTab>
            <SegTab
              selected={view === "chat"}
              onClick={() => onViewChange("chat")}
            >
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
        <div
          role="alert"
          className="mt-6 rounded-[2px] border border-border p-5"
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
            className="mt-3 inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] border border-accent bg-accent px-3.5 text-[13px] font-medium text-white transition-colors duration-100 hover:border-accent-hover hover:bg-accent-hover"
          >
            Back to overview
          </button>
        </div>
      ) : (
        <ChatView
          detail={detail.data ?? null}
          pendingMessage={
            pendingTurn && !persistedUser ? pendingTurn.content : null
          }
          stream={answerPersisted ? null : activeStream}
          streaming={active || detail.isLoading}
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
