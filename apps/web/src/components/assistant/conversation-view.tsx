/**
 * Conversation view (Task 21 slice 7).
 *
 * One chat at a time: compact right-aligned user messages, full-width
 * assistant answers (direct answer, primary artifact, grounded
 * observations, assumptions, drill-downs, activity trace). Assistant
 * prose announces politely without re-reading on each token; charts
 * carry text summaries; tool internals never render.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type {
  ActivityStep,
  AssistantAnswer,
  AssistantArtifact,
} from "@prism-analytics/types";
import { ActivityTrace } from "@/components/assistant/activity-trace";
import { ArtifactWidget } from "@/components/assistant/artifact-widgets";
import type { ConversationDetail } from "@/network/queries/useAssistantConversations";
import type { StreamState } from "@/network/queries/useAssistantConversations";

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2 text-sm text-white">
        {text}
      </p>
    </div>
  );
}

function AnswerBlock({
  answer,
  artifacts,
  definitionActions,
}: {
  answer: AssistantAnswer;
  artifacts: AssistantArtifact[];
  definitionActions?: (artifact: AssistantArtifact) => {
    onConfirm: () => void;
    onReject: () => void;
    deciding: boolean;
  } | undefined;
}) {
  const primary = artifacts.find((artifact) => artifact.id === answer.primaryArtifactId) ?? null;
  const supporting = answer.supportingArtifactIds
    .map((id) => artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is AssistantArtifact => artifact !== undefined);
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.summary}</p>
      {primary ? (
        <ArtifactWidget artifact={primary} definitionActions={definitionActions?.(primary)} />
      ) : null}
      {answer.observations.length > 0 ? (
        <ul className="space-y-1.5">
          {answer.observations.map((observation, index) => (
            <li key={index} className="flex gap-2 text-sm text-text">
              <span aria-hidden="true" className="text-accent">•</span>
              <span>{observation.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {supporting.map((artifact) => (
        <ArtifactWidget
          key={artifact.id}
          artifact={artifact}
          definitionActions={definitionActions?.(artifact)}
        />
      ))}
      {answer.assumptions.length > 0 ? (
        <div className="rounded-lg border border-border-subtle px-4 py-2.5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-text-subtle">
            Assumptions
          </p>
          <ul className="mt-1 space-y-1">
            {answer.assumptions.map((assumption, index) => (
              <li key={index} className="font-mono text-xs text-text-subtle">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {answer.followUps.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {answer.followUps.map((followUp, index) => (
            <span
              key={index}
              className="rounded-full border border-border-subtle px-3 py-1 font-mono text-[11px] text-text-subtle"
            >
              {followUp}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationView({
  detail,
  stream,
  streaming,
  error,
  onBack,
  onInvestigate,
  definitionActions,
}: {
  detail: ConversationDetail | null;
  stream: StreamState | null;
  streaming: boolean;
  error: { message: string; retryable: boolean } | null;
  onBack: () => void;
  onInvestigate?: (prompt: string) => void;
  definitionActions?: (artifact: AssistantArtifact) => {
    onConfirm: () => void;
    onReject: () => void;
    deciding: boolean;
  } | undefined;
}) {
  void onInvestigate;
  const bottomRef = useRef<HTMLDivElement>(null);
  const steps: ActivityStep[] = stream?.steps ?? [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stream?.text, detail?.messages.length]);

  return (
    <div className="animate-[fadeSlideIn_180ms_ease-out] motion-reduce:animate-none">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-text-subtle hover:text-text"
        >
          ← Back to overview
        </button>
        <h1 className="truncate text-lg font-semibold">
          {detail?.conversation.title ?? "New chat"}
        </h1>
      </div>

      <div className="space-y-5">
        {(detail?.messages ?? []).map((message) => {
          const text = message.parts
            .filter((part) => part.type === "text")
            .map((part) => (part as { text?: string }).text ?? "")
            .join("\n");
          if (message.role === "user") {
            return <UserBubble key={message.id} text={text} />;
          }
          const messageArtifacts = message.parts
            .map((part) => (part as { artifact?: AssistantArtifact }).artifact)
            .filter((artifact): artifact is AssistantArtifact => artifact !== undefined);
          if (!text && messageArtifacts.length === 0) return null;
          return (
            <div key={message.id} className="space-y-3">
              {text ? <p className="whitespace-pre-wrap text-sm">{text}</p> : null}
              {messageArtifacts.map((artifact) => (
                <ArtifactWidget
                  key={artifact.id}
                  artifact={artifact}
                  definitionActions={definitionActions?.(artifact)}
                />
              ))}
            </div>
          );
        })}

        {stream && (streaming || stream.text || stream.answer || stream.steps.length > 0) ? (
          <div className="space-y-3" aria-live="polite">
            <ActivityTrace steps={steps} collapsed={stream.done} />
            {stream.text && !stream.answer ? (
              <p className="whitespace-pre-wrap text-sm">{stream.text}</p>
            ) : null}
            {stream.answer ? (
              <AnswerBlock
                answer={stream.answer}
                artifacts={stream.artifacts}
                definitionActions={definitionActions}
              />
            ) : (
              stream.artifacts.map((artifact) => (
                <ArtifactWidget
                  key={artifact.id}
                  artifact={artifact}
                  definitionActions={definitionActions?.(artifact)}
                />
              ))
            )}
          </div>
        ) : null}

        {stream?.error || error ? (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3"
          >
            <p className="text-sm">
              {(stream?.error ?? error)?.message ?? "Something went wrong."}
            </p>
            <Link to="." className="mt-1 inline-block font-mono text-[11px] text-link hover:underline">
              Back to overview →
            </Link>
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}
