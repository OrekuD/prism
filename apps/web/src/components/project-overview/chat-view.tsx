/**
 * Chat view: the design mock's conversation column bound to real
 * transcript + stream state. User bubbles, full-width assistant
 * messages (body, trace, artifacts, evidence, follow-ups, notices),
 * the empty state, provider errors, and Back to overview.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, MessageSquareText } from "@/components/ui/hugeicons";
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
  return <div className="text-[13.5px] leading-[1.6] text-text">{text}</div>;
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
      <EvidenceBlock observations={answer.observations} />
      {supporting.map((artifact) => (
        <ChatArtifact
          key={artifact.id}
          artifact={artifact}
          definitionActions={definitionActions?.(artifact)}
        />
      ))}
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
  onBack,
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = detail?.messages ?? [];
  const showStream =
    stream !== null &&
    (streaming || stream.text || stream.answer || stream.steps.length > 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional scroll triggers, not values read by the effect
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    stream?.text,
    stream?.answer,
    stream?.steps.length,
    pendingMessage,
    messages.length,
  ]);

  return (
    <div
      className="po-chat-in flex min-h-0 flex-1 flex-col"
      aria-label="Conversation"
    >
      <div className="po-chat-scroll flex flex-1 flex-col gap-[18px] overflow-auto pb-3 pt-7">
        {loading && !detail && !showStream && !pendingMessage ? (
          <div aria-live="polite" aria-label="Loading conversation" className="flex flex-col gap-5 py-2" aria-busy="true">
            <span className="sr-only">Loading conversation…</span>
            <div aria-hidden="true" className="h-12 w-2/5 self-end rounded-md bg-surface-raised" />
            <div aria-hidden="true" className="h-24 w-3/5 rounded-md bg-surface-raised" />
          </div>
        ) : null}
        {!loading && messages.length === 0 && !showStream && !pendingMessage ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-10 text-center">
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
              <div
                key={message.id}
                className="po-msg-in max-w-[70%] self-end whitespace-pre-wrap rounded-[16px] border border-border-strong bg-surface-raised px-3.5 py-2.5 text-[13.5px] text-text"
              >
                {text}
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
          // Widget answers get the fixed column width; text-only answers
          // fit their content.
          const width =
            artifacts.length > 0
              ? "w-full max-w-[70%] max-[760px]:max-w-full"
              : "w-fit max-w-[70%]";
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={`po-msg-in self-start rounded-[16px] border border-border bg-surface p-[14px_16px] ${width}`}
            >
              <TraceBlock steps={trace} />
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
            </div>
          );
        })}

        {pendingMessage ? (
          <div className="po-msg-in max-w-[70%] self-end whitespace-pre-wrap rounded-[16px] border border-border-strong bg-surface-raised px-3.5 py-2.5 text-[13.5px] text-text">
            {pendingMessage}
          </div>
        ) : null}

        {showStream && stream ? (
          <div
            className={`po-msg-in self-start rounded-[16px] border border-border bg-surface p-[14px_16px] ${
              stream.artifacts.length > 0
                ? "w-full max-w-[70%] max-[760px]:max-w-full"
                : "w-fit max-w-[70%]"
            }`}
            aria-live="polite"
          >
            <TraceBlock steps={stream.steps} latencyMs={streamLatencyMs} />
            {streaming &&
            !stream.text &&
            !stream.answer &&
            stream.steps.length === 0 ? (
              <output className="block text-sm text-text-muted">
                Working…
              </output>
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
          </div>
        ) : null}

        {stream?.error || sendError ? (
          <div
            role="alert"
            className="mt-2.5 flex w-fit max-w-full items-start gap-2.5 rounded-[12px] border border-danger/40 p-[10px_12px] text-[12.5px] text-text-muted"
          >
            <span
              aria-hidden="true"
              className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-danger"
            />
            <span>{(stream?.error ?? sendError)?.message}</span>
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mb-2 mt-16 inline-flex h-[30px] items-center gap-2 self-start whitespace-nowrap rounded-full px-3 text-xs font-medium text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        <ArrowLeft aria-hidden="true" />
        Back to overview
      </button>
    </div>
  );
}
