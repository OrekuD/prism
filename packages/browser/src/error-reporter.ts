import type {
  ErrorBeforeSend,
  ErrorCaptureResult,
  ErrorReporterOptions,
  ErrorReporterShare,
  ErrorReportInput,
  PrismDiagnostic,
  PrismDiagnosticHandle,
  PrismErrorReporter,
} from "@prism-analytics/core";
import {
  createPrismErrorReporter,
  framesFromStack,
} from "@prism-analytics/core";
import { createBrowserRuntime } from "./browser-runtime";

/**
 * Browser error adapter (task-15 slice 3b) — `createBrowserErrorReporter`.
 *
 * Translates browser failure primitives (Error, ErrorEvent,
 * PromiseRejectionEvent, strings, arbitrary rejection reasons) into the
 * core's `ErrorReportInput` shape and drives the runtime-neutral
 * `createPrismErrorReporter` lane from `@prism-analytics/core`.
 *
 * Global error handlers are OPT-IN (never installed by the factory
 * unless `captureGlobalErrors` is set), idempotently installable/
 * uninstallable, and always `handled: false`. A bounded dedupe window
 * coalesces same-fingerprint bursts. "Script error." (the opaque
 * cross-origin message) is captured HONESTLY — its own fingerprintable
 * type, no fabricated frames — so it groups separately instead of being
 * thrown away or faked.
 *
 * Like its analytics sibling, this package only translates browser
 * primitives; the core owns queueing, batching, retries, consent, and
 * sanitization, and unload flushes are the runtime's authenticated
 * keepalive.
 */

/** Result of `captureException` — core's plus a coarsened `deduped` state. */
export type BrowserCaptureResult =
  | ErrorCaptureResult
  | { readonly status: "deduped"; readonly id: string };

export interface ErrorCaptureOptions {
  /** Default `false` for global-handler captures; direct calls default `true`. */
  handled?: boolean;
  level?: ErrorReportInput["level"];
  release?: string;
  environment?: string;
  context?: ErrorReportInput["context"];
  breadcrumbs?: ErrorReportInput["breadcrumbs"];
}

export interface BrowserErrorReporterOptions {
  /** Project source key (ingestion auth; server derives project/source). */
  sourceKey: string;
  /** Ingestion origin chosen at runtime — REQUIRED, never compiled in. */
  endpoint: string;
  /** Safe identity/consent sharing source (wire the analytics client's). */
  share: ErrorReporterShare;
  /** Optional dev-side boundary (immutable in; drop/redact/throw-safe). */
  beforeSend?: ErrorBeforeSend;
  /** Queue/delivery tuning passthrough to the core reporter. */
  queue?: ErrorReporterOptions["queue"];
  /** Optional release + environment stamped on every report. */
  release?: string;
  environment?: string;
  /** Opt-in: install window onerror + unhandledrejection handlers. */
  captureGlobalErrors?: boolean;
  /** Coalescing window in ms for same-fingerprint bursts. Default 1000. */
  dedupeMs?: number;
  /** Diagnostic subscription made BEFORE the reporter starts. */
  onDiagnostic?: (diagnostic: PrismDiagnostic) => void;
}

export interface BrowserErrorReporter {
  /** The underlying runtime-neutral reporter (flush/shutdown/diagnostics). */
  readonly reporter: PrismErrorReporter;
  readonly installed: boolean;
  /** Number of queued, undelivered error reports. */
  readonly pendingCount: number;
  /**
   * Normalize ANY thrown/collected value into an error report and enqueue
   * it. Invalid callers passing a malformed ErrorReportInput still THROW
   * (same contract as core). Consent/shutdown/queue-capacity return
   * `dropped`; a same-fingerprint duplicate within the dedupe window
   * returns `deduped`.
   */
  captureException(
    value: unknown,
    options?: ErrorCaptureOptions,
  ): BrowserCaptureResult;
  /** Idempotent: install window error handlers (no-op when installed). */
  install(): void;
  /** Idempotent: remove window error handlers (no-op when not installed). */
  uninstall(): void;
  /** Attempt delivery of all queued batches. */
  flush(): Promise<void>;
  /** Idempotent shutdown: stop handlers, timers, bounded final flush. */
  shutdown(options?: { timeoutMs?: number }): Promise<void>;
  /** Subscribe to diagnostics; returns an idempotent remove handle. */
  onDiagnostic(listener: (d: PrismDiagnostic) => void): PrismDiagnosticHandle;
}

/** Bounded, circular-safe summary of a non-Error rejection reason. */
function describeUnknown(value: unknown, depth = 0): string {
  if (depth > 2) return "[object]";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  )
    return String(value);
  if (depth === 0 && Array.isArray(value)) return "UnhandledRejection";
  try {
    const seen = new Set<unknown>();
    const text = JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (typeof v === "function") return "[Function]";
      return v;
    });
    if (text && text.length <= 256) return text;
    return "[object]";
  } catch {
    return "[object]";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` already looks like an ErrorReportInput (passthrough). */
function looksLikeErrorReportInput(value: unknown): value is ErrorReportInput {
  return (
    isPlainRecord(value) &&
    isPlainRecord(value.exception) &&
    typeof (value.exception as { type?: unknown }).type === "string"
  );
}

function safeMessage(message: unknown, fallback = "Error"): string {
  const text =
    typeof message === "string" && message.length > 0 ? message : fallback;
  return text.length > 2048 ? `${text.slice(0, 2048)}…` : text;
}

/**
 * Normalize ANY collected value into an ErrorReportInput: Error instances
 * (frames from stack), ErrorEvent, PromiseRejectionEvent, strings, plain
 * objects that already match the report shape (passthrough), and opaque
 * rejection reasons (summarized, never thrown).
 */
export function normalizeErrorValue(value: unknown): ErrorReportInput {
  if (typeof value === "string") {
    return { exception: { type: "Error", message: value } };
  }
  // A native Error is ALSO a plain-ish record — check it before the
  // object routes so its name/stack survive.
  if (value instanceof Error) {
    return {
      exception: {
        type: value.name || "Error",
        message: safeMessage(value.message),
        frames: framesFromStack(value.stack),
      },
    };
  }
  if (isPlainRecord(value)) {
    const record = value;
    // Unhandled-rejection event objects carry the reason (wrap it).
    if (record.type === "unhandledrejection") {
      return normalizeErrorValue(record.reason ?? "Unhandled rejection");
    }
    // Developer-shaped input passes through untouched.
    if (looksLikeErrorReportInput(record)) {
      return record;
    }
    const name = record.name;
    const message = record.message;
    // Duck-typed Error (cross-realm iframe, minified): name + message.
    if (
      typeof name === "string" &&
      name.length > 0 &&
      typeof message === "string"
    ) {
      return {
        exception: {
          type: name,
          message: safeMessage(message),
          frames: framesFromStack(
            typeof record.stack === "string" ? record.stack : undefined,
          ),
        },
      };
    }
    if (typeof message === "string" && message.length > 0) {
      // A message-only record: "Script error." is the opaque cross-origin
      // marker — captured honestly, never fabricated.
      return {
        exception: {
          type: message === "Script error." ? "ScriptError" : "Error",
          message: safeMessage(message),
        },
        ...(message === "Script error."
          ? { context: { extras: { scriptError: true } } }
          : {}),
      };
    }
    // Opaque rejection reason: summarize, never throw.
    return {
      exception: {
        type: "UnhandledRejection",
        message: describeUnknown(record),
      },
    };
  }
  if (typeof value === "object" && value !== null) {
    // Non-plain object (ErrorEvent instance, etc.) — summarize.
    return {
      exception: { type: "Error", message: describeUnknown(value) },
    };
  }
  return {
    exception: { type: "Error", message: describeUnknown(value) },
  };
}

const DEDUPE_DEFAULT_MS = 1_000;
const DEDUPE_MAX_ENTRIES = 100;

export async function createBrowserErrorReporter(
  options: BrowserErrorReporterOptions,
): Promise<BrowserErrorReporter> {
  if (typeof window === "undefined") {
    throw new Error(
      "@prism-analytics/browser error reporter requires a browser (window is undefined)",
    );
  }
  if (!options.endpoint || options.endpoint.trim().length === 0) {
    throw new Error(
      "endpoint is required — choose the ingestion origin at runtime",
    );
  }
  if (!options.share || typeof options.share.consent !== "function") {
    throw new Error("share is required — wire the analytics client's consent");
  }

  const runtime = createBrowserRuntime();
  const reporter = await createPrismErrorReporter({
    sourceKey: options.sourceKey,
    endpoint: options.endpoint,
    runtime,
    share: options.share,
    beforeSend: options.beforeSend,
    queue: options.queue,
    ...("onDiagnostic" in options && options.onDiagnostic
      ? { onDiagnostic: options.onDiagnostic }
      : {}),
  });

  const dedupeMs = options.dedupeMs ?? DEDUPE_DEFAULT_MS;
  const seen = new Map<string, { ts: number; id: string }>();
  let installed = false;
  let handleError: ((event: Event) => void) | null = null;
  let handleRejection: ((event: PromiseRejectionEvent | Event) => void) | null =
    null;

  const capture = (
    value: unknown,
    captureOptions?: ErrorCaptureOptions,
  ): BrowserCaptureResult => {
    let input: ErrorReportInput;
    try {
      input = normalizeErrorValue(value);
    } catch (error) {
      // Structural invalids from the passthrough path throw like core.
      throw error instanceof Error ? error : new Error("invalid error report");
    }
    // Stamp adapter-level release/environment + handled/level defaults.
    const release =
      captureOptions?.release ?? options.release ?? input.release;
    const environment =
      captureOptions?.environment ?? options.environment ?? input.environment;
    input = {
      ...input,
      ...(release ? { release } : {}),
      ...(environment ? { environment } : {}),
      ...(captureOptions?.level ? { level: captureOptions.level } : {}),
      ...(captureOptions?.context ? { context: captureOptions.context } : {}),
      ...(captureOptions?.breadcrumbs
        ? { breadcrumbs: captureOptions.breadcrumbs }
        : {}),
      ...("handled" in (captureOptions ?? {})
        ? { handled: captureOptions?.handled }
        : { handled: true }),
    };

    // Bounded dedupe window — coarsen same-fingerprint bursts.
    const type = input.exception.type;
    const key = `${type}\u0000${input.exception.message ?? ""}`;
    const now = runtime.now();
    const prior = seen.get(key);
    if (prior && now - prior.ts < dedupeMs) {
      return { status: "deduped", id: prior.id };
    }
    if (seen.size >= DEDUPE_MAX_ENTRIES) {
      for (const k of seen.keys()) {
        seen.delete(k);
        if (seen.size < DEDUPE_MAX_ENTRIES) break;
      }
    }

    const result = reporter.captureException(input);
    if (result.status === "queued") {
      seen.set(key, { ts: now, id: result.id });
    }
    return result;
  };

  const install = (): void => {
    if (installed) return;
    installed = true;
    handleError = (event: Event): void => {
      const errorEvent = event as ErrorEvent;
      const message = errorEvent.message;
      const error = errorEvent.error;
      try {
        if (error && error instanceof Error) {
          // The event carries a real Error (V8) — normalize it directly.
          capture(error, { handled: false });
        } else if (typeof message === "string" && message.length > 0) {
          // "Script error." is the opaque cross-origin marker: capture
          // honestly, never fabricate frames or pretend to know more.
          capture(
            {
              exception: { type: "ScriptError", message },
              context: { extras: { scriptError: message === "Script error." } },
            },
            { handled: false },
          );
        } else {
          // Element/resource load errors surface with an empty message.
          const target = errorEvent.target as
            | { tagName?: string; src?: string }
            | null;
          capture(
            {
              exception: {
                type: "ResourceError",
                message: target?.src ?? target?.tagName ?? "Resource load failed",
              },
            },
            { handled: false },
          );
        }
      } catch {
        // A handler failure must never crash the page or loop.
      }
    };
    handleRejection = (event): void => {
      const reason = (event as PromiseRejectionEvent).reason;
      try {
        capture(reason ?? "Unhandled rejection", { handled: false });
      } catch {
        // never crash the page
      }
    };
    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleRejection);
  };

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    if (handleError) window.removeEventListener("error", handleError, true);
    if (handleRejection)
      window.removeEventListener("unhandledrejection", handleRejection);
    handleError = null;
    handleRejection = null;
  };

  const bound: BrowserErrorReporter = {
    reporter,
    get pendingCount() {
      return reporter.pendingCount;
    },
    get installed() {
      return installed;
    },
    captureException: capture,
    install,
    uninstall,
    flush: () => reporter.flush(),
    shutdown: async (opts) => {
      uninstall();
      await reporter.shutdown(opts);
    },
    onDiagnostic: (listener) => reporter.onDiagnostic(listener),
  };

  if (options.captureGlobalErrors) install();
  return bound;
}
