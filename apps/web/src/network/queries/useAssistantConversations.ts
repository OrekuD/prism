/**
 * Assistant conversation API client (Task 21 slice 7).
 *
 * The server speaks the frozen validated stream parts over SSE
 * (`data-run-start`, `data-activity-step`, `data-fact`, `data-artifact`,
 * prose `{type:"text"}`, `data-run-finish` / `data-run-error`) — not the
 * generic AI SDK data-stream protocol — so this module owns a small
 * validated SSE client instead of `useChat`. Every streamed part is
 * parsed through `AssistantStreamPartSchema` before it touches state;
 * unknown or malformed frames are ignored and surfaced as a retryable
 * error, never rendered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantAnswerSchema,
  AssistantArtifactSchema,
  AssistantStreamPartSchema,
  MetricFactSchema,
  type ActivityStep,
  type AssistantAnswer,
  type AssistantArtifact,
  type AssistantStreamPart,
  type MetricFact,
} from "@prism-analytics/types";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";

export type ConversationListItem = {
  id: string;
  /** URL slug (`chat_*`) — the only chat identifier used in URLs. */
  slug: string;
  title: string;
  lastMessageAt: number | null;
  messageCount: number;
  hasActiveRun: boolean;
};

export type ConversationDetail = {
  conversation: {
    id: string;
    slug: string;
    title: string;
    seed: { type: "insight"; insightId: string } | null;
    createdAt: number;
    updatedAt: number;
    lastMessageAt: number | null;
  };
  messages: Array<{
    id: string;
    seq: number;
    role: "user" | "assistant";
    status: string;
    parts: Array<{ type: string; text?: string; artifact?: AssistantArtifact; answer?: AssistantAnswer; steps?: ActivityStep[] }>;
    failureCode: string | null;
  }>;
  activeRun: { id: string; status: string } | null;
};

export function conversationListKey(slug: string) {
  return ["assistant-conversations", slug] as const;
}

export function conversationDetailKey(slug: string, conversationSlug: string) {
  return ["assistant-conversation", slug, conversationSlug] as const;
}

export function useAssistantConversationsQuery(slug: string | undefined) {
  return useQuery({
    queryKey: conversationListKey(slug ?? ""),
    queryFn: async (): Promise<{
      items: ConversationListItem[];
      nextCursor: string | null;
    }> => {
      const response = await axiosInstance.get(
        `/projects/${slug}/assistant/conversations`,
      );
      return response.data;
    },
    enabled: Boolean(slug),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}

export function useAssistantConversationQuery(
  slug: string | undefined,
  conversationSlug: string | null,
) {
  return useQuery({
    ...conversationDetailOptions(slug ?? "", conversationSlug ?? ""),
    enabled: Boolean(slug) && Boolean(conversationSlug),
  });
}

/** Shared key/fetch/freshness policy keeps intent-prefetch and navigation deduplicated. */
export function conversationDetailOptions(slug: string, conversationSlug: string) {
  return queryOptions({
    queryKey: conversationDetailKey(slug, conversationSlug),
    queryFn: async ({ signal }): Promise<ConversationDetail> => {
      const response = await axiosInstance.get(
        `/projects/${slug}/assistant/conversations/${conversationSlug}`,
        { signal },
      );
      return response.data;
    },
    // Completed chats rarely change outside this tab; sends invalidate them.
    // A known running chat must refresh on revisit instead of trusting its snapshot.
    staleTime: (query) => query.state.data?.activeRun ? 0 : 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function usePrefetchAssistantConversation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback((conversationSlug: string) => {
    if (!slug || !conversationSlug) return;
    void queryClient.prefetchQuery(conversationDetailOptions(slug, conversationSlug));
  }, [slug, queryClient]);
}

/* ------------------------------------------------------------------ */
/* Validated SSE frame parsing (pure, unit-tested)                     */
/* ------------------------------------------------------------------ */

export type ParsedStreamEvent =
  | { kind: "part"; part: AssistantStreamPart }
  | { kind: "text"; text: string }
  | { kind: "unknown" };

/** Parse one SSE `data:` payload into a validated stream event. */
export function parseStreamDataPayload(payload: string): ParsedStreamEvent {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { kind: "unknown" };
  }
  if (
    typeof json === "object" &&
    json !== null &&
    (json as { type?: unknown }).type === "text" &&
    typeof (json as { text?: unknown }).text === "string"
  ) {
    return { kind: "text", text: (json as { text: string }).text };
  }
  const part = AssistantStreamPartSchema.safeParse(json);
  if (part.success) return { kind: "part", part: part.data };
  // Tolerate metric-fact and artifact frames validated individually.
  if (typeof json === "object" && json !== null) {
    const record = json as Record<string, unknown>;
    if (record.kind === "data-fact") {
      const fact = MetricFactSchema.safeParse(record.fact);
      if (fact.success) {
        return { kind: "part", part: { kind: "data-fact", fact: fact.data } };
      }
    }
    if (record.kind === "data-artifact") {
      const artifact = AssistantArtifactSchema.safeParse(record.artifact);
      if (artifact.success) {
        return {
          kind: "part",
          part: { kind: "data-artifact", artifact: artifact.data },
        };
      }
    }
  }
  return { kind: "unknown" };
}

/** Split an SSE byte stream into `data:` payloads (handles split chunks). */
export function splitSsePayloads(buffer: string): {
  payloads: string[];
  remainder: string;
} {
  const payloads: string[] = [];
  const events = buffer.split("\n\n");
  const remainder = events.pop() ?? "";
  for (const event of events) {
    for (const line of event.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        payloads.push(trimmed.slice("data:".length).trim());
      }
    }
  }
  return { payloads, remainder };
}

export type StreamState = {
  runId: string | null;
  /** Server-assigned chat from the run-start frame (chat-creation runs). */
  conversationId: string | null;
  /** URL slug for the owning chat, echoed as a response header. */
  conversationSlug: string | null;
  steps: ActivityStep[];
  facts: MetricFact[];
  artifacts: AssistantArtifact[];
  text: string;
  answer: AssistantAnswer | null;
  error: { code: string; message: string; retryable: boolean } | null;
  done: boolean;
};

export const INITIAL_STREAM_STATE: StreamState = {
  runId: null,
  conversationId: null,
  conversationSlug: null,
  steps: [],
  facts: [],
  artifacts: [],
  text: "",
  answer: null,
  error: null,
  done: false,
};

/** Fold one validated event into stream state (pure, unit-tested). */
export function applyStreamEvent(
  state: StreamState,
  event: ParsedStreamEvent,
): StreamState {
  if (event.kind === "text") {
    return { ...state, text: `${state.text}${event.text}` };
  }
  if (event.kind === "unknown") return state;
  const part = event.part;
  switch (part.kind) {
    case "data-run-start":
      return { ...state, runId: part.runId, conversationId: part.conversationId };
    case "data-activity-step": {
      const step: ActivityStep = {
        stepId: part.stepId,
        sequence: part.sequence,
        toolId: part.toolId,
        state: part.state,
        label: part.label,
      };
      const existing = state.steps.findIndex((entry) => entry.stepId === step.stepId);
      const steps =
        existing >= 0
          ? state.steps.map((entry, index) => (index === existing ? step : entry))
          : [...state.steps, step];
      return { ...state, steps };
    }
    case "data-fact":
      return state.facts.some((fact) => fact.id === part.fact.id)
        ? state
        : { ...state, facts: [...state.facts, part.fact] };
    case "data-artifact":
      return state.artifacts.some((artifact) => artifact.id === part.artifact.id)
        ? state
        : { ...state, artifacts: [...state.artifacts, part.artifact] };
    case "data-run-finish": {
      const answer = AssistantAnswerSchema.safeParse(part.answer);
      return {
        ...state,
        answer: answer.success ? answer.data : state.answer,
        done: true,
      };
    }
    case "data-run-error":
      return {
        ...state,
        error: { code: part.code, message: part.message, retryable: part.retryable },
        done: true,
      };
  }
}

export type SendMessageInput = {
  /** Chat URL slug, or null to lazily create the chat. */
  conversationSlug: string | null;
  content: string;
  queryContextToken?: string;
  clientRequestId: string;
  signal: AbortSignal;
  onEvent?: (state: StreamState) => void;
};

/**
 * POST a message and fold the SSE stream into state. A null
 * conversationSlug creates the chat (lazy creation); otherwise the
 * message continues the selected chat. The owning chat's URL slug
 * arrives as an `X-Conversation-Slug` response header, so a creation
 * run can navigate to its URL without a second lookup.
 */
export function useSendAssistantMessage(slug: string | undefined) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (input: SendMessageInput): Promise<StreamState> => {
      if (!slug) throw new Error("Missing project slug");
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      input.signal.addEventListener("abort", forwardAbort, { once: true });
      if (input.signal.aborted) controller.abort();
      abortRef.current = controller;
      setActive(true);
      let state: StreamState = { ...INITIAL_STREAM_STATE };
      const emit = () => input.onEvent?.(state);
      emit();
      try {
        const url =
          input.conversationSlug === null
            ? `/projects/${slug}/assistant/conversations`
            : `/projects/${slug}/assistant/conversations/${input.conversationSlug}/messages`;
        const body =
          input.conversationSlug === null
            ? {
                clientRequestId: input.clientRequestId,
                firstMessage: input.content,
                seed: null,
                queryContextToken: input.queryContextToken,
              }
            : {
                clientRequestId: input.clientRequestId,
                content: input.content,
                ...(input.queryContextToken
                  ? { queryContextToken: input.queryContextToken }
                  : {}),
              };
        const response = await fetch(
          `${axiosInstance.defaults.baseURL}${url}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "include",
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) {
          if (response.status === 409) {
            state = {
              ...state,
              error: {
                code: "idempotency-conflict",
                message: "This message was already sent. Reload to see it.",
                retryable: false,
              },
              done: true,
            };
            emit();
            return state;
          }
          state = {
            ...state,
            error: {
              code: "provider-error",
              message:
                response.status === 404
                  ? "That chat no longer exists. Start a new chat."
                  : "The request failed. Try again shortly.",
              retryable: response.status !== 404,
            },
            done: true,
          };
          emit();
          return state;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Owning chat's URL slug (present on every assistant stream).
        const headerSlug = response.headers.get("X-Conversation-Slug");
        if (headerSlug) {
          state = { ...state, conversationSlug: headerSlug };
          emit();
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const split = splitSsePayloads(buffer);
          buffer = split.remainder;
          for (const payload of split.payloads) {
            state = applyStreamEvent(state, parseStreamDataPayload(payload));
            emit();
          }
        }
        const tail = splitSsePayloads(`${buffer}\n\n`);
        for (const payload of tail.payloads) {
          state = applyStreamEvent(state, parseStreamDataPayload(payload));
          emit();
        }
        if (!state.done) {
          state = { ...state, done: true, error: { code: "provider-error", message: "The connection ended before the answer finished. Please try again.", retryable: true } };
          emit();
        }
        return state;
      } catch (error) {
        if ((error as Error).name === "AbortError" || controller.signal.aborted) {
          state = {
            ...state,
            error: { code: "cancelled", message: "The run was stopped.", retryable: true },
            done: true,
          };
          emit();
          return state;
        }
        state = {
          ...state,
          error: {
            code: "provider-error",
            message: "The request failed. Check your connection and retry.",
            retryable: true,
          },
          done: true,
        };
        emit();
        return state;
      } finally {
        input.signal.removeEventListener("abort", forwardAbort);
        setActive(false);
        void queryClient.invalidateQueries({
          queryKey: conversationListKey(slug),
        });
      }
    },
    [slug, queryClient],
  );

  return { send, stop, active };
}

export function useDeleteAssistantConversation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(
    async (conversationSlug: string): Promise<boolean> => {
      if (!slug) return false;
      const confirmed = window.confirm("Delete this chat? This cannot be undone.");
      if (!confirmed) return false;
      try {
        await axiosInstance.delete(
          `/projects/${slug}/assistant/conversations/${conversationSlug}`,
        );
      } catch {
        return false;
      }
      const queryKey = conversationDetailKey(slug, conversationSlug);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.removeQueries({ queryKey, exact: true });
      await queryClient.invalidateQueries({
        queryKey: conversationListKey(slug),
      });
      return true;
    },
    [slug, queryClient],
  );
}
