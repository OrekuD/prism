/**
 * Run-scoped trace logging for the assistant pipeline (debug aid).
 *
 * One `traceId` is minted per inbound assistant request and attached to
 * every log line from client receipt through streamed/final response, so
 * an operator can follow a single message submit end to end:
 * controller boundary → quota/token gates → persistence → agent loop
 * steps → tool calls → answer validation/repair → stream frames →
 * final persistence.
 *
 * PRIVACY: trace records include message content, tool inputs, and
 * answer text — everything needed to replay a run. It is therefore
 * gated behind explicit opt-in (`PRISM_AI_TRACE_LOGGING=1`) and defaults
 * OFF. Never enable it in production or on shared infrastructure; the
 * operational (non-trace) logs deliberately exclude prompts, tool
 * inputs/outputs, and answer text (see `docs/assistant.md`).
 */
import { randomUUID } from "node:crypto";

export type TraceFn = (
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
) => void;

export function isTraceLoggingEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return env.PRISM_AI_TRACE_LOGGING === "1" || env.PRISM_AI_TRACE_LOGGING === "true";
}

function newTraceId(): string {
  return `trace_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Build the trace function for one inbound request. When disabled it
 * returns a no-op (zero overhead, zero content in logs). When enabled
 * it emits through the shared redacting logger under the
 * `assistant.trace` scope with the run's `traceId` on every line.
 */
export function createRequestTrace(
  emit: (level: "info", scope: string, message: string, meta: unknown) => void,
  env: Record<string, string | undefined>,
  traceId: string = newTraceId(),
): { traceId: string; trace: TraceFn; enabled: boolean } {
  if (!isTraceLoggingEnabled(env)) {
    return { traceId, trace: () => undefined, enabled: false };
  }
  const trace: TraceFn = (stage, message, meta) => {
    emit("info", "assistant.trace", `${stage}: ${message}`, {
      traceId,
      stage,
      ...(meta ?? {}),
    });
  };
  return { traceId, trace, enabled: true };
}

/** Truncate free-form text for log lines (content stays readable). */
export function traceText(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
