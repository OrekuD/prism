/**
 * Seed realistic server traffic for the `server` source (project
 * apricot-frittata-581613140): backend track events + error-issue
 * history — 90 days.
 *
 * - Days 0–6 go through HTTP (events → :8080/api/v2/ingest,
 *   errors → :8080/api/v1/errors/ingest; secret keys need no salt or
 *   origin).
 * - Days 7–89 go through the server's own repositories with identical
 *   validators/builders (bypasses only the 30-day recency window).
 *
 * Deterministic IDs make reruns idempotent via ON CONFLICT guards.
 *
 *   SERVER_SOURCE_KEY=ssk_... npx tsx ./seed-server.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { IngestRepository } from "./src/repositories/IngestRepository.js";
import {
  ErrorIngestRepository,
  type ErrorPersistItem,
} from "./src/repositories/ErrorIngestRepository.js";
import {
  fingerprintV1,
  issueIdFor,
} from "./src/utils/errorFingerprint.js";
import { sanitizeErrorPayload } from "./src/utils/errorSanitize.js";
import {
  validateIdentityOp,
  type ValidatedEvent,
} from "./src/utils/ingestValidation.js";
import { validateStandardEventProperties } from "@prism-analytics/core";

const API_BASE = process.env.SERVER_API_BASE ?? "http://localhost:8080";
const SOURCE_KEY = process.env.SERVER_SOURCE_KEY ?? "";
const PROJECT_ID = "b1c21dd7-706e-4240-b53c-bc88b2bdc04a";
const SOURCE_ID = "42ff3372-effc-4dd3-be77-55db2be09ce5";
const PLATFORM = "server";
const SDK = { name: "@prism-analytics/node", version: "0.9.0" };
const HTTP_DAYS = Number(process.env.SEED_HTTP_DAYS ?? 7);
const TOTAL_DAYS = Number(process.env.SEED_DAYS ?? 90);
const HTTP_BATCH = 50;
const DIRECT_CHUNK = 400;

if (!SOURCE_KEY) throw new Error("SERVER_SOURCE_KEY is required");

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rand: () => number, entries: Array<[T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1]![0];
}

/* ------------------------------------------------------------------ */
/* Track events: backend order/subscription/user lifecycle             */
/* ------------------------------------------------------------------ */
interface WireEvent {
  schemaVersion: 2 | 3;
  eventId: string;
  type: "track";
  occurredAt: number;
  anonymousId?: string;
  userId?: string;
  name: string;
  properties?: Record<string, unknown>;
}
interface WireIdentityOp {
  opId: string;
  userId: string;
  anonymousId: string;
  traits?: Record<string, unknown>;
  occurredAt: number;
}

const ORDER_PLANS: Array<[string, number, number]> = [
  // planId, valueMinor, weight
  ["pro", 2900, 70],
  ["team", 9900, 30],
];

function stdProps(key: string, data: Record<string, unknown>): Record<string, unknown> {
  const props = { $standard: { schemaVersion: 1, key, data } };
  const name = `$prism_${key}`;
  const check = validateStandardEventProperties(name, props);
  if (!check.ok) throw new Error(`bad standard fixture ${name}: ${check.reason}`);
  return props;
}

/* ------------------------------------------------------------------ */
/* Errors: recurring issue catalog                                     */
/* ------------------------------------------------------------------ */
interface IssueDef {
  key: string;
  level: "error" | "warning";
  handled: boolean;
  exception: {
    type: string;
    message: string;
    frames: Array<{ file: string; function: string; line: number; inApp: boolean }>;
  };
  weight: number;
}
const ISSUES: IssueDef[] = [
  {
    key: "billing-undefined-id", level: "error", handled: true, weight: 20,
    exception: {
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'id')",
      frames: [
        { file: "app:///dist/billing/invoices.js", function: "finalizeInvoice", line: 142, inApp: true },
        { file: "app:///dist/billing/worker.js", function: "processBatch", line: 87, inApp: true },
      ],
    },
  },
  {
    key: "stripe-timeout", level: "error", handled: true, weight: 14,
    exception: {
      type: "StripeConnectionError",
      message: "Request to https://api.stripe.com/v1/charges timed out after 30000ms",
      frames: [
        { file: "app:///dist/lib/stripe.js", function: "createCharge", line: 58, inApp: true },
      ],
    },
  },
  {
    key: "pg-pool", level: "error", handled: false, weight: 8,
    exception: {
      type: "PoolExhaustedError",
      message: "Timed out acquiring a connection from the pool (size 20)",
      frames: [
        { file: "app:///dist/db/pool.js", function: "acquire", line: 203, inApp: true },
        { file: "app:///dist/api/middleware.js", function: "withTenant", line: 41, inApp: true },
      ],
    },
  },
  {
    key: "redis-conn", level: "error", handled: false, weight: 6,
    exception: {
      type: "RedisConnectionError",
      message: "connect ECONNREFUSED 10.0.4.21:6379",
      frames: [
        { file: "app:///dist/cache/session.js", function: "readSession", line: 33, inApp: true },
      ],
    },
  },
  {
    key: "webhook-rejection", level: "error", handled: true, weight: 10,
    exception: {
      type: "UnhandledPromiseRejection",
      message: "Webhook signature mismatch for provider github",
      frames: [
        { file: "app:///dist/webhooks/github.js", function: "verifySignature", line: 19, inApp: true },
        { file: "app:///dist/webhooks/router.js", function: "dispatch", line: 112, inApp: true },
      ],
    },
  },
  {
    key: "csv-import", level: "error", handled: true, weight: 9,
    exception: {
      type: "ValidationError",
      message: "Row 418: expected ISO date in column started_at, got 13/02/2026",
      frames: [
        { file: "app:///dist/import/csv.js", function: "parseRow", line: 77, inApp: true },
      ],
    },
  },
  {
    key: "vendor-429", level: "warning", handled: true, weight: 12,
    exception: {
      type: "RateLimitError",
      message: "Vendor API returned 429; backing off 60s",
      frames: [
        { file: "app:///dist/lib/vendor.js", function: "fetchWithRetry", line: 94, inApp: true },
      ],
    },
  },
  {
    key: "slow-query", level: "warning", handled: true, weight: 11,
    exception: {
      type: "SlowQueryWarning",
      message: "Query on events_occurred_at_idx took 1840ms (budget 500ms)",
      frames: [
        { file: "app:///dist/analytics/rollup.js", function: "rollupDay", line: 156, inApp: true },
      ],
    },
  },
];
const ISSUE_WEIGHTS: Array<[number, number]> = ISSUES.map((d, i) => [i, d.weight]);

const RELEASES = ["4.1.0", "4.1.3", "4.2.0", "4.2.1", "4.2.3"];
const ENV_W: Array<[string, number]> = [["production", 88], ["staging", 12]];

interface GenError {
  clientEventId: string;
  occurredAt: number;
  level: "error" | "warning";
  handled: boolean;
  exception: IssueDef["exception"];
  release: string;
  environment: string;
  anonymousId: string | null;
  breadcrumbs: Array<{ timestamp: number; type: string; message: string; level: "info" | "error" }>;
}

/* ------------------------------------------------------------------ */
let globalUser = 0;
let globalOrder = 0;

function dayTrackVolume(day: number, rand: () => number): number {
  const growth = 0.5 + 0.7 * ((TOTAL_DAYS - 1 - day) / (TOTAL_DAYS - 1));
  const dow = new Date(Date.now() - day * 86_400_000).getUTCDay();
  const dowFactor = dow === 6 ? 0.5 : dow === 0 ? 0.55 : 1;
  const noise = 0.85 + rand() * 0.3;
  return Math.round(420 * growth * dowFactor * noise);
}

function generateDay(day: number): { events: WireEvent[]; ops: WireIdentityOp[]; errors: GenError[] } {
  const rand = mulberry32(0x77aa + day * 7919);
  const events: WireEvent[] = [];
  const ops: WireIdentityOp[] = [];
  const errors: GenError[] = [];
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000 - day * 86_400_000;
  let seq = 0;
  const eid = () => `evt-srv-d${day}-${seq++}`;

  const n = dayTrackVolume(day, rand);
  for (let i = 0; i < n; i++) {
    const t = dayStart + Math.floor(rand() * 86_400_000);
    const kind = rand();
    const userId = `usr-srv-${Math.floor(rand() * 20000)}`;
    const anonymousId = `anon-srv-${Math.floor(rand() * 60000)}`;
    if (kind < 0.42) {
      // Backend order completion (mirrors checkout started on clients).
      const [planId, valueMinor] = pick(rand, ORDER_PLANS.map(([p, v, w]) => [[p, v] as [string, number], w]));
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "order_completed",
        properties: {
          order_id: `ord-${globalOrder++}`,
          plan: planId, valueMinor, currency: "USD",
        },
      });
    } else if (kind < 0.58) {
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "subscription_renewed",
        properties: {
          plan: pick(rand, [["pro", 70], ["team", 30]] as Array<[string, number]>),
          period: "monthly",
        },
      });
    } else if (kind < 0.68) {
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "trial_expired",
        properties: { trial_days: 14, converted: rand() < 0.3 },
      });
    } else if (kind < 0.76) {
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "refund_issued",
        properties: {
          order_id: `ord-${Math.floor(rand() * Math.max(globalOrder, 1))}`,
          valueMinor: 2900, currency: "USD", reason: "duplicate_charge",
        },
      });
    } else if (kind < 0.86) {
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "password_reset_requested",
        properties: { channel: "email" },
      });
    } else if (kind < 0.94) {
      const newUser = `usr-srv-new-${globalUser++}`;
      ops.push({
        opId: `op-srv-invite-${newUser}`, userId: newUser, anonymousId,
        traits: { initial_plan: "trial", invited: true }, occurredAt: t,
      });
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId: newUser, name: "team_member_invited",
        properties: { role: rand() < 0.8 ? "member" : "admin" },
      });
    } else {
      // Server-observed purchase confirmation (webhook).
      const [planId, valueMinor] = pick(rand, ORDER_PLANS.map(([p, v, w]) => [[p, v] as [string, number], w]));
      events.push({
        schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
        anonymousId, userId, name: "$prism_purchase",
        properties: stdProps("purchase", {
          transactionId: `txn-srv-${day}-${i}`, valueMinor, currency: "USD", itemCount: 1,
        }),
      });
      void planId;
    }
  }

  // Errors: ~18/day across the recurring catalog + release rotation.
  const errCount = Math.round(18 * (0.5 + rand()) * (day === 45 ? 2 : 1));
  const release = RELEASES[Math.min(RELEASES.length - 1, Math.floor((TOTAL_DAYS - day) / (TOTAL_DAYS / RELEASES.length)))]!;
  for (let i = 0; i < errCount; i++) {
    const def = ISSUES[pick(rand, ISSUE_WEIGHTS)]!;
    const t = dayStart + Math.floor(rand() * 86_400_000);
    errors.push({
      clientEventId: `err-srv-d${day}-${i}`,
      occurredAt: t,
      level: def.level,
      handled: def.handled,
      exception: def.exception,
      release,
      environment: pick(rand, ENV_W),
      anonymousId: rand() < 0.6 ? `anon-srv-${Math.floor(rand() * 60000)}` : null,
      breadcrumbs: [
        { timestamp: t - 42000, type: "navigation", message: "job started: billing-worker", level: "info" },
        { timestamp: t - 3000, type: "log", message: "retry attempt 2", level: def.level === "error" ? "error" : "info" },
      ],
    });
  }

  events.sort((a, b) => a.occurredAt - b.occurredAt);
  const now = Date.now();
  for (const e of events) {
    if (e.occurredAt > now) e.occurredAt = now - Math.floor(rand() * 600_000);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  return { events, ops, errors };
}

/* ------------------------------------------------------------------ */
function toValidated(e: WireEvent): ValidatedEvent {
  return {
    eventId: e.eventId,
    type: "track",
    schemaVersion: e.schemaVersion,
    occurredAt: e.occurredAt,
    ...(e.anonymousId ? { anonymousId: e.anonymousId } : {}),
    ...(e.userId ? { userId: e.userId } : {}),
    name: e.name,
    properties: e.properties ?? {},
  };
}

function toErrorItem(e: GenError, index: number): ErrorPersistItem {
  const fingerprint = fingerprintV1(e.exception);
  const sanitized = sanitizeErrorPayload({
    exception: e.exception,
    handled: e.handled,
    release: e.release,
    environment: e.environment,
    language: "javascript",
    breadcrumbs: e.breadcrumbs as Array<Record<string, unknown>>,
  });
  return {
    index,
    occurrenceId: `occ-srv-${e.clientEventId}`,
    clientEventId: e.clientEventId,
    issueId: issueIdFor(PROJECT_ID, PLATFORM, fingerprint),
    projectId: PROJECT_ID,
    sourceId: SOURCE_ID,
    platform: PLATFORM,
    level: e.level,
    handled: e.handled,
    occurredAt: e.occurredAt,
    receivedAt: e.occurredAt,
    release: e.release,
    environment: e.environment,
    ...(e.anonymousId ? { anonymousId: e.anonymousId } : {}),
    fingerprintVersion: 1,
    fingerprint,
    title: sanitized.title,
    ...(sanitized.location !== undefined ? { location: sanitized.location } : {}),
    payload: sanitized.payload,
  };
}

/* ------------------------------------------------------------------ */
async function postEventBatch(batch: WireEvent[], ops: WireIdentityOp[]): Promise<{ accepted: number; rejected: number; duplicates: number }> {
  const res = await fetch(`${API_BASE}/api/v2/ingest`, {
    method: "POST",
    headers: { authorization: `Bearer ${SOURCE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 3, sentAt: Date.now(), sdk: SDK, events: batch,
      ...(ops.length > 0 ? { identity: ops } : {}),
    }),
  });
  if (res.status === 429) return { accepted: 0, rejected: 0, duplicates: 0 };
  if (!res.ok) throw new Error(`event ingest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { results?: Array<{ id: string; status: string; reason?: string }> };
  let accepted = 0, rejected = 0, duplicates = 0;
  for (const r of body.results ?? []) {
    if (r.status === "accepted") accepted++;
    else if (r.status === "duplicate") duplicates++;
    else { rejected++; console.error(`HTTP event reject id=${r.id} reason=${r.reason}`); }
  }
  return { accepted, rejected, duplicates };
}

async function postErrorBatch(batch: GenError[]): Promise<{ accepted: number; rejected: number; duplicates: number }> {
  const res = await fetch(`${API_BASE}/api/v1/errors/ingest`, {
    method: "POST",
    headers: { authorization: `Bearer ${SOURCE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      sentAt: Date.now(),
      sdk: { ...SDK, language: "javascript" },
      errors: batch.map((e) => ({
        id: e.clientEventId,
        occurredAt: e.occurredAt,
        level: e.level,
        handled: e.handled,
        exception: e.exception,
        release: e.release,
        environment: e.environment,
        ...(e.anonymousId ? { anonymousId: e.anonymousId } : {}),
        breadcrumbs: e.breadcrumbs,
      })),
    }),
  });
  if (res.status === 429) return { accepted: 0, rejected: 0, duplicates: 0 };
  if (!res.ok) throw new Error(`error ingest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { results?: Array<{ id: string; status: string; reason?: string }> };
  let accepted = 0, rejected = 0, duplicates = 0;
  for (const r of body.results ?? []) {
    if (r.status === "accepted") accepted++;
    else if (r.status === "duplicate") duplicates++;
    else { rejected++; console.error(`HTTP error reject id=${r.id} reason=${r.reason}`); }
  }
  return { accepted, rejected, duplicates };
}

async function seedHttp(
  eventDays: WireEvent[][],
  opDays: WireIdentityOp[][],
  errorDays: GenError[][],
): Promise<void> {
  let a = 0, r = 0, d = 0, req = 0;
  const t = async <T>(fn: () => Promise<{ accepted: number; rejected: number; duplicates: number }>): Promise<void> => {
    for (;;) {
      const out = await fn();
      req++;
      if (out.accepted === 0 && out.rejected === 0 && out.duplicates === 0) {
        await new Promise((s) => setTimeout(s, 5000));
        continue;
      }
      a += out.accepted; r += out.rejected; d += out.duplicates;
      break;
    }
    if (req % 100 === 0) await new Promise((s) => setTimeout(s, 1500));
  };
  for (let day = 0; day < eventDays.length; day++) {
    const list = eventDays[day]!;
    let opsSent = false;
    for (let i = 0; i < list.length; i += HTTP_BATCH) {
      const ops = !opsSent ? opDays[day]!.slice(0, 50) : [];
      opsSent = true;
      await t(() => postEventBatch(list.slice(i, i + HTTP_BATCH), ops));
    }
    const errs = errorDays[day]!;
    for (let i = 0; i < errs.length; i += HTTP_BATCH) {
      await t(() => postErrorBatch(errs.slice(i, i + HTTP_BATCH)));
    }
    console.log(`HTTP day ${day}: accepted=${a} rejected=${r} duplicates=${d} requests=${req}`);
  }
}

/* ------------------------------------------------------------------ */
async function seedDirect(
  eventDays: WireEvent[][],
  opDays: WireIdentityOp[][],
  errorDays: GenError[][],
): Promise<void> {
  const repo = new IngestRepository();
  const errorRepo = new ErrorIngestRepository();
  const externalLinks = new Map<string, string>();
  const anonymousLinks = new Map<string, string>();
  const replacementPersonIds = new Map<string, string>();
  let written = 0, errWritten = 0;
  for (let d = 0; d < eventDays.length; d++) {
    const list = eventDays[d]!;
    const ops = opDays[d]!.map((op) => {
      const v = validateIdentityOp(op);
      if (!v.ok) throw new Error(`bad identity op day=${d}`);
      return v.op;
    });
    for (let i = 0; i < list.length; i += DIRECT_CHUNK) {
      const chunk = list.slice(i, i + DIRECT_CHUNK);
      await repo.persistBatch(
        PROJECT_ID,
        chunk.map(toValidated),
        Math.max(...chunk.map((v) => v.occurredAt)),
        SDK,
        i === 0 ? ops.map((op, j) => ({ index: j, op })) : [],
        externalLinks,
        anonymousLinks,
        replacementPersonIds,
        { sourceId: SOURCE_ID, platform: PLATFORM },
        [],
        [],
        [],
      );
      written += chunk.length;
    }
    const errs = errorDays[d]!;
    for (let i = 0; i < errs.length; i += DIRECT_CHUNK) {
      const items = errs.slice(i, i + DIRECT_CHUNK).map((e, j) => toErrorItem(e, j));
      await errorRepo.persistBatch(items);
      errWritten += items.length;
    }
    if (d % 10 === 0 || d === eventDays.length - 1) {
      console.log(`direct day ${d + HTTP_DAYS}: events=${written} errors=${errWritten}`);
    }
  }
}

/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const eventDays: WireEvent[][] = [];
  const opDays: WireIdentityOp[][] = [];
  const errorDays: GenError[][] = [];
  for (let day = TOTAL_DAYS - 1; day >= 0; day--) {
    const { events, ops, errors } = generateDay(day);
    eventDays[day] = events;
    opDays[day] = ops;
    errorDays[day] = errors;
    if (day % 30 === 0) console.log(`generated day ${day}: ${events.length} events, ${ops.length} ops, ${errors.length} errors`);
  }
  console.log(`HTTP leg: days 0..${HTTP_DAYS - 1}`);
  await seedHttp(eventDays.slice(0, HTTP_DAYS), opDays.slice(0, HTTP_DAYS), errorDays.slice(0, HTTP_DAYS));
  console.log(`direct leg: days ${HTTP_DAYS}..${TOTAL_DAYS - 1}`);
  await seedDirect(eventDays.slice(HTTP_DAYS), opDays.slice(HTTP_DAYS), errorDays.slice(HTTP_DAYS));
  console.log("done");
  process.exit(0);
}

void main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
