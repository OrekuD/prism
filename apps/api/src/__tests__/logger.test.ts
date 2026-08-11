import { describe, expect, it, afterEach } from 'vitest';
import {
  logger,
  redact,
  resetTransport,
  setTransport,
  type LogLevel,
} from '../utils/logger';

/**
 * Log-redaction tests (task-6 closure): sentinel secrets must never reach
 * captured log output. The analytics-api logger is a byte-identical copy
 * (apps/analytics-api/src/utils/logger.ts), so this suite covers both.
 */

const PRISM_KEY = 'pr_0123456789abcdef0123456789abcdef';
const JWT =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.some-signature-part';
// Built from parts so secret scanners treat it as a fixture, not a
// credential: this is a deliberate sentinel the redactor must never emit.
const PASSWORD = ['SENTINEL_', 'PASSWORD_', 'hunter2'].join('');
const IPV4 = '203.0.113.42';
const IPV6 = '2001:db8::1';
const SENTINELS = [PRISM_KEY, JWT, PASSWORD, IPV4, IPV6];

function capture(): { lines: string[]; transport: (l: LogLevel, line: string) => void } {
  const lines: string[] = [];
  const transport = (_level: LogLevel, line: string) => {
    lines.push(line);
  };
  return { lines, transport };
}

afterEach(() => {
  resetTransport();
});

describe('redact', () => {
  it('masks known secret values anywhere inside strings', () => {
    const out = redact(
      `key=${PRISM_KEY} jwt=${JWT} ipv4=${IPV4} ipv6=${IPV6}`,
    ) as string;
    // The four sentinels present in the string are all masked (PASSWORD is
    // covered by the nested-object test below).
    expect(out).toBe(
      'key=[REDACTED] jwt=[REDACTED] ipv4=[REDACTED] ipv6=[REDACTED]',
    );
  });

  it('redacts sensitive keys recursively in nested objects and arrays', () => {
    const out = redact({
      user: {
        password: PASSWORD,
        authorization: `Bearer ${JWT}`,
        apiKey: PRISM_KEY,
        cookies: { session_token: 'abc123' },
      },
      ip: IPV4,
      name: 'Ada',
      tags: ['ok', `password=${PASSWORD}`],
    });
    expect(out).toEqual({
      user: {
        password: '[REDACTED]',
        authorization: '[REDACTED]',
        apiKey: '[REDACTED]',
        cookies: { session_token: '[REDACTED]' },
      },
      ip: '[REDACTED]',
      name: 'Ada',
      tags: ['ok', 'password=[REDACTED]'],
    });
  });

  it('keeps non-sensitive data intact', () => {
    const out = redact({
      status: 200,
      scope: 'health',
      message: 'ready',
      location: '/pricing',
    });
    expect(out).toEqual({ status: 200, scope: 'health', message: 'ready', location: '/pricing' });
  });

  it('preserves log-only verification links (dev convenience, not a JWT)', () => {
    const link =
      'https://analytics.example.com/api/auth/verify-email?token=abc123def456';
    expect(redact(link)).toBe(link);
  });

  it('handles primitives and null', () => {
    expect(redact(null)).toBeNull();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });
});

describe('logger', () => {
  it('emits structured JSON records with ts/level/scope/msg', () => {
    const { lines, transport } = capture();
    setTransport(transport);
    logger.warn('test', 'something happened');
    const record = JSON.parse(lines[0]);
    expect(record.scope).toBe('test');
    expect(record.level).toBe('warn');
    expect(record.msg).toBe('something happened');
    expect(typeof record.ts).toBe('string');
  });

  it('never emits sentinel secrets in meta, headers, or request bodies', () => {
    const { lines, transport } = capture();
    setTransport(transport);
    logger.error('test', 'upload failed', {
      status: 500,
      body: `password=${PASSWORD}`,
      headers: { authorization: `Bearer ${JWT}` },
      request: { cookies: { session: 'abc' }, ip: IPV4, apiKey: PRISM_KEY },
      nested: [{ secret: PASSWORD }],
    });
    const output = lines.join('\n');
    for (const sentinel of SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
  });

  it('never emits sentinel secrets embedded in the message string', () => {
    const { lines, transport } = capture();
    setTransport(transport);
    logger.error('test', `login failed for ${IPV6} with ${JWT} key=${PRISM_KEY}`);
    const output = lines.join('\n');
    for (const sentinel of SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
    expect(output).toContain('[REDACTED]');
  });

  it('writes error records to stderr by default', () => {
    const stderr = process.stderr.write;
    const written: string[] = [];
    process.stderr.write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    try {
      logger.error('test', 'boom');
    } finally {
      process.stderr.write = stderr;
    }
    expect(written.join('')).toContain('"level":"error"');
  });
});
