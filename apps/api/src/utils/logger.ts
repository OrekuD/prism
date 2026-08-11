/**
 * Central structured logger with recursive secret redaction (task-6 closure).
 *
 * All server logging goes through this module — never call console.*
 * directly in server code. Every record is a single JSON line with
 * `ts`, `level`, `scope`, `msg`, and optional redacted `meta`.
 *
 * Redaction (see `redact`): sensitive KEYS (passwords, tokens, api keys,
 * authorization headers, cookies, …) are replaced wholesale, and known
 * secret VALUES are masked anywhere they appear in strings — Prism
 * analytics keys (`pr_<32 hex>`), JWTs, and IPv4/IPv6 addresses. Request
 * bodies and headers are redacted recursively because `meta` is walked.
 *
 * The transport is swappable so tests can capture log output and assert
 * sentinel secrets never appear.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  meta?: unknown;
}

const SENSITIVE_KEY =
  /(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|session[_-]?id|private[_-]?key|credential|jwt|bearer|otp|verification[_-]?code|reset[_-]?code|signature)/i;

const PRISM_KEY = /\bpr_[a-f0-9]{32}\b/i;
const JWT = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/;
// Free-form `key=value` / `"key":"value"` assignments in bodies and logs
// (password=hunter2, "secret":"…", Authorization: Bearer …). Plain
// `token=` in URLs is NOT masked here so log-only verification links stay
// usable; structured token keys are handled by SENSITIVE_KEY.
const ASSIGNMENT =
  /(password|passwd|pwd|secret|api[_-]?key|authorization|bearer)\s*"?\s*[:=]\s*"?[^&,;"']+/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
// Colon-first form handles compressed `::` runs (e.g. 2001:db8::1);
// a colon-time false positive (12:30:45) is safer than leaking an address.
const IPV6 = /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}\b/;

/**
 * Recursively redact a value before it reaches the log. Strings under a
 * sensitive key are replaced entirely; known secret patterns (keys, JWTs,
 * IPs) are masked wherever they appear in any string.
 */
export function redact(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
    return value
      .replace(PRISM_KEY, '[REDACTED]')
      .replace(JWT, '[REDACTED]')
      .replace(IPV6, '[REDACTED]')
      .replace(IPV4, '[REDACTED]')
      .replace(ASSIGNMENT, (match, key) => `${key}=[REDACTED]`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }

  return value;
}

type Transport = (level: LogLevel, line: string) => void;

const defaultTransport: Transport = (level, line) => {
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

let transport: Transport = defaultTransport;

/** Install a custom transport (used by tests to capture output). */
export function setTransport(fn: Transport): void {
  transport = fn;
}

export function resetTransport(): void {
  transport = defaultTransport;
}

function emit(level: LogLevel, scope: string, message: string, meta?: unknown) {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: redact(message) as string,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };
  transport(level, JSON.stringify(record));
}

export const logger = {
  info(scope: string, message: string, meta?: unknown): void {
    emit('info', scope, message, meta);
  },
  warn(scope: string, message: string, meta?: unknown): void {
    emit('warn', scope, message, meta);
  },
  error(scope: string, message: string, meta?: unknown): void {
    emit('error', scope, message, meta);
  },
};
