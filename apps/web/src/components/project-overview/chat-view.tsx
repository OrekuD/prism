/**
 * Conversation transcript bound to saved messages and the active stream.
 */
import { useEffect, useRef } from "react";
import { MessageSquareText } from "@/components/ui/hugeicons";
import type {
  AssistantAnswer,
  AssistantArtifact,
} from "@prism-analytics/types";
import {
  ChatArtifact,
  CoverageNoticeBlock,
  EvidenceBlock,
  FollowUpsBlock,
  TraceBlock,
  UnavailableBlock,
} from "@/components/project-overview/chat-widgets";
import type {
  ConversationDetail,
  StreamState,
} from "@/network/queries/useAssistantConversations";

export type ChatDefinitionActions = (
  artifact: AssistantArtifact
) =>
  | { onConfirm: () => void; onReject: () => void; deciding: boolean }
  | undefined;

function AssistantText({ text }: { text: string }) {
  if (!text) return null;
  return <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-text">{text}</div>;
}

function PreparingAnswer() {
  return (
    <output className="inline-flex items-center gap-2 text-[12.5px] text-text-muted" aria-live="polite">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
      Preparing answer
    </output>
  );
}

function StreamAnswer({
  answer,
  artifacts,
  onAsk,
  definitionActions,
}: {
  answer: AssistantAnswer;
  artifacts: AssistantArtifact[];
  onAsk: (prompt: string) => void;
  definitionActions?: ChatDefinitionActions;
}) {
  const primary = artifacts.find(
    (item) => item.id === answer.primaryArtifactId
  );
  const supporting = answer.supportingArtifactIds.flatMap((id) => {
    const found = artifacts.find((item) => item.id === id);
    return found ? [found] : [];
  });
  return (
    <>
      <AssistantText text={answer.summary} />
      {primary ? (
        <ChatArtifact
          artifact={primary}
          definitionActions={definitionActions?.(primary)}
        />
      ) : null}
      {supporting.map((artifact) => (
        <ChatArtifact
          key={artifact.id}
          artifact={artifact}
          definitionActions={definitionActions?.(artifact)}
        />
      ))}
      <EvidenceBlock observations={answer.observations} />
      {answer.assumptions.length > 0 ? (
        <div className="mt-2.5 flex items-start gap-2.5 rounded-[12px] border border-warning/40 p-[10px_12px] text-[12.5px] text-text-muted">
          <span
            aria-hidden="true"
            className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-warning"
          />
          <span>{answer.assumptions.join(" ")}</span>
        </div>
      ) : null}
      <FollowUpsBlock followUps={answer.followUps} onAsk={onAsk} />
    </>
  );
}

export function ChatView({
  detail,
  stream,
  streaming,
  streamLatencyMs,
  sendError,
  onAsk,
  definitionActions,
  pendingMessage,
  loading = false,
}: {
  detail: ConversationDetail | null;
  loading?: boolean;
  pendingMessage?: string | null;
  stream: StreamState | null;
  streaming: boolean;
  streamLatencyMs?: number;
  sendError: { message: string; retryable: boolean } | null;
  onBack: () => void;
  onAsk: (prompt: string) => void;
  definitionActions?: ChatDefinitionActions;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingLatestRef = useRef(true);
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const messages = detail?.messages ?? [];
  const showStream =
    stream !== null &&
    (streaming || stream.text || stream.answer || stream.steps.length > 0);

  // Keep new activity visible while the reader is at the bottom. Do not pull
  // them away from an earlier answer as streamed text arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional scroll triggers, not values read by the effect
  useEffect(() => {
    const viewport = scrollRef.current;
    const conversationId = detail?.conversation?.id;
    if (conversationId !== previousConversationIdRef.current) {
      previousConversationIdRef.current = conversationId;
      followingLatestRef.current = true;
    }
    if (!viewport || (!followingLatestRef.current && !pendingMessage)) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [
    stream?.text,
    stream?.answer,
    stream?.steps.length,
    pendingMessage,
    messages.length,
    detail?.conversation?.id,
  ]);

  return (
    <section
      className="po-chat-in flex min-h-0 flex-1 flex-col"
      aria-label="Conversation"
    >
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followingLatestRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
        }}
        className="po-chat-scroll flex min-h-0 flex-1 flex-col gap-7 overflow-auto px-5 pb-8 pt-8 max-[640px]:px-4"
      >
        {loading && !detail && !showStream && !pendingMessage ? (
          <output aria-label="Loading conversation" className="po-chat-turn flex flex-col gap-6 py-2" aria-busy="true">
            <span className="sr-only">Loading conversation…</span>
            <div aria-hidden="true" className="h-10 w-2/5 self-end rounded-lg bg-surface-raised" />
            <div aria-hidden="true" className="h-4 w-3/5 rounded bg-surface-raised" />
            <div aria-hidden="true" className="h-4 w-2/5 rounded bg-surface-raised" />
          </output>
        ) : null}
        {!loading && messages.length === 0 && !showStream && !pendingMessage ? (
          <div className="po-chat-turn flex flex-1 flex-col items-center justify-center gap-2.5 py-10 text-center">
            <MessageSquareText
              aria-hidden="true"
              className="h-[22px] w-[22px] stroke-text-subtle"
            />
            <p className="text-[13px] font-medium leading-[1.4] text-text">
              Ask about this project
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          const text = message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text?: string }).text ?? "")
            .join("\n");
          if (message.role === "user") {
            return (
              <div key={message.id} className="po-chat-turn po-msg-in flex justify-end">
                <div className="po-chat-user-message max-w-[min(75%,520px)] whitespace-pre-wrap break-words px-4 py-2.5 text-[13.5px] leading-[1.6] text-text max-[640px]:max-w-[88%]">
                  {text}
                </div>
              </div>
            );
          }
          const artifacts = message.parts
            .map((part) => (part as { artifact?: AssistantArtifact }).artifact)
            .filter((item): item is AssistantArtifact => item !== undefined);
          const answer = message.parts.find(
            (part) => part.type === "answer"
          )?.answer;
          const trace =
            message.parts.find((part) => part.type === "trace")?.steps ?? [];
          if (!text && !answer && artifacts.length === 0) return null;
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className="po-chat-turn po-msg-in min-w-0"
            >
              {answer ? (
                <StreamAnswer
                  answer={answer}
                  artifacts={artifacts}
                  onAsk={onAsk}
                  definitionActions={definitionActions}
                />
              ) : (
                <AssistantText text={text} />
              )}
              {!answer &&
                artifacts.map((artifact) =>
                  artifact.kind === "coverage" ? (
                    <CoverageNoticeBlock
                      key={artifact.id}
                      artifact={artifact}
                    />
                  ) : artifact.kind === "unavailable" ? (
                    <UnavailableBlock key={artifact.id} artifact={artifact} />
                  ) : (
                    <ChatArtifact
                      key={artifact.id}
                      artifact={artifact}
                      definitionActions={definitionActions?.(artifact)}
                    />
                  )
                )}
              <TraceBlock steps={trace} />
            </div>
          );
        })}

        {pendingMessage ? (
          <div className="po-chat-turn po-msg-in flex justify-end">
            <div className="po-chat-user-message max-w-[min(75%,520px)] whitespace-pre-wrap break-words px-4 py-2.5 text-[13.5px] leading-[1.6] text-text max-[640px]:max-w-[88%]">
              {pendingMessage}
            </div>
          </div>
        ) : null}

        {streaming && !stream ? (
          <div className="po-chat-turn"><PreparingAnswer /></div>
        ) : null}

        {showStream && stream ? (
          <div
            className="po-chat-turn po-msg-in min-w-0"
            aria-live="polite"
          >
            {streaming &&
            !stream.text &&
            !stream.answer &&
            stream.steps.length === 0 ? (
              <PreparingAnswer />
            ) : null}
            {stream.answer ? (
              <StreamAnswer
                answer={stream.answer}
                artifacts={stream.artifacts}
                onAsk={onAsk}
                definitionActions={definitionActions}
              />
            ) : (
              <>
                <AssistantText text={stream.text} />
                {stream.artifacts.map((artifact) => (
                  <ChatArtifact
                    key={artifact.id}
                    artifact={artifact}
                    definitionActions={definitionActions?.(artifact)}
                  />
                ))}
              </>
            )}
            <TraceBlock steps={stream.steps} latencyMs={streamLatencyMs} active={streaming} />
          </div>
        ) : null}

        {stream?.error || sendError ? (
          <div
            role="alert"
            className="po-chat-turn flex items-start gap-2.5 text-[12.5px] text-danger"
          >
            <span
              aria-hidden="true"
              className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-danger"
            />
            <span>{(stream?.error ?? sendError)?.message}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
