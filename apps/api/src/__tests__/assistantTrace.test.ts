/**
 * Trace-logging gate tests: content-bearing trace lines emit only under
 * explicit opt-in, and are a complete no-op otherwise.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createRequestTrace,
  isTraceLoggingEnabled,
  traceText,
} from "../utils/assistantTrace";

describe("assistant trace logging", () => {
  it("is disabled by default", () => {
    expect(isTraceLoggingEnabled({})).toBe(false);
    expect(isTraceLoggingEnabled({ PRISM_AI_TRACE_LOGGING: "0" })).toBe(false);
    expect(isTraceLoggingEnabled({ PRISM_AI_TRACE_LOGGING: "1" })).toBe(true);
    expect(isTraceLoggingEnabled({ PRISM_AI_TRACE_LOGGING: "true" })).toBe(true);
  });

  it("emits nothing when disabled", () => {
    const emit = vi.fn();
    const { trace, enabled } = createRequestTrace(emit, {});
    expect(enabled).toBe(false);
    trace("run.received", "hello", { question: "secret content" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("tags every line with the trace ID when enabled", () => {
    const emit = vi.fn();
    const { traceId, trace, enabled } = createRequestTrace(emit, {
      PRISM_AI_TRACE_LOGGING: "1",
    });
    expect(enabled).toBe(true);
    expect(traceId).toMatch(/^trace_[a-f0-9]{16}$/);
    trace("run.received", "question in", { question: "How are signups?" });
    expect(emit).toHaveBeenCalledTimes(1);
    const [level, scope, message, meta] = emit.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(level).toBe("info");
    expect(scope).toBe("assistant.trace");
    expect(message).toContain("run.received");
    expect(meta.traceId).toBe(traceId);
    expect(meta.stage).toBe("run.received");
  });

  it("truncates long text for log lines", () => {
    expect(traceText("abc", 500)).toBe("abc");
    expect(traceText("x".repeat(600), 500)).toBe(`${"x".repeat(500)}…`);
  });
});
