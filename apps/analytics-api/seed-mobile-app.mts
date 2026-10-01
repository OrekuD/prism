/**
 * Seed realistic mobile traffic for the `app` source (project
 * apricot-frittata-581613140) — 90 days × ~2.5k screens/day.
 *
 * - Days 0–6 go through HTTP ingestion on the SALTED instance
 *   (PORT=8091 + ANALYTICS_INSTALLATION_SALT; the :8080 dev process has
 *   no salt and fails mobile ingestion closed by design).
 * - Days 7–89 go through the server's own IngestRepository.persistBatch
 *   with identical validators/builders (bypasses only the 30-day
 *   recency window). Installation digests use the same dev salt.
 *
 * Deterministic IDs make reruns idempotent via ON CONFLICT guards.
 *
 *   MOBILE_SOURCE_KEY=psk_mobile_... npx tsx ./seed-mobile-app.mts
 */
import "dotenv/config";
import { IngestRepository } from "./src/repositories/IngestRepository.js";
import { digestInstallation } from "./src/enrichment/mobileScreenView.js";
import {
  validateIdentityOp,
  type ValidatedEvent,
} from "./src/utils/ingestValidation.js";
import {
  APP_LIFECYCLE_EVENT_NAME,
  SCREEN_VIEW_EVENT_NAME,
  validateAppLifecycleProperties,
  validateScreenViewProperties,
  validateStandardEventProperties,
} from "@prism-analytics/core";

const API_BASE = process.env.MOBILE_API_BASE ?? "http://localhost:8091";
const SOURCE_KEY = process.env.MOBILE_SOURCE_KEY ?? "";
const PROJECT_ID = "b1c21dd7-706e-4240-b53c-bc88b2bdc04a";
const SOURCE_ID = "f970cbce-386f-4393-89ed-2030911bd0d4";
const SALT = process.env.ANALYTICS_INSTALLATION_SALT ?? "";
const SDK = { name: "@prism-analytics/react-native", version: "0.9.0" };
const HTTP_DAYS = Number(process.env.SEED_HTTP_DAYS ?? 7);
const TOTAL_DAYS = Number(process.env.SEED_DAYS ?? 90);
const HTTP_BATCH = 50;
const DIRECT_CHUNK = 400;

if (!SOURCE_KEY) throw new Error("MOBILE_SOURCE_KEY is required");
if (!SALT) throw new Error("ANALYTICS_INSTALLATION_SALT is required (direct leg digests installations)");

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
interface ScreenDef {
  name: string;
  route: string | null;
  weight: number;
}
const SCREENS: ScreenDef[] = [
  { name: "Home", route: null, weight: 26 },
  { name: "Events", route: null, weight: 16 },
  { name: "EventDetail", route: "/events/:id", weight: 9 },
  { name: "Errors", route: null, weight: 8 },
  { name: "ErrorDetail", route: "/errors/:id", weight: 4 },
  { name: "Projects", route: null, weight: 7 },
  { name: "Settings", route: null, weight: 6 },
  { name: "Search", route: null, weight: 5 },
  { name: "Notifications", route: null, weight: 4 },
  { name: "Welcome", route: null, weight: 5 },
  { name: "PermissionsPrompt", route: null, weight: 2 },
  { name: "Login", route: null, weight: 3 },
  { name: "Paywall", route: null, weight: 5 },
];
const SCREEN_WEIGHTS: Array<[number, number]> = SCREENS.map((s, i) => [i, s.weight]);

const OS_W: Array<[{ os: string; version: string }, number]> = [
  [{ os: "ios", version: "17.4" }, 20],
  [{ os: "ios", version: "17.5" }, 18],
  [{ os: "ios", version: "18.0" }, 17],
  [{ os: "android", version: "14" }, 22],
  [{ os: "android", version: "13" }, 13],
  [{ os: "android", version: "15" }, 10],
];
const APP_W: Array<[{ version: string; build: string; environment: string }, number]> = [
  [{ version: "4.2.0", build: "102", environment: "production" }, 70],
  [{ version: "4.1.3", build: "99", environment: "production" }, 20],
  [{ version: "4.3.0-beta", build: "110", environment: "staging" }, 10],
];
const SIGNUP_METHODS: Array<[string, number]> = [["apple", 40], ["google", 35], ["email", 25]];
const PLANS: Array<[string, number]> = [["pro", 70], ["team", 30]];

/* ------------------------------------------------------------------ */
interface WireEvent {
  schemaVersion: 2 | 3;
  eventId: string;
  type: "track";
  occurredAt: number;
  sessionId?: string;
  anonymousId?: string;
  userId?: string;
  name: string;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
}
interface WireIdentityOp {
  opId: string;
  userId: string;
  anonymousId: string;
  traits?: Record<string, unknown>;
  occurredAt: number;
}
interface GenEvent extends WireEvent {
  installationId: string | null;
}

function stdProps(key: string, data: Record<string, unknown>): Record<string, unknown> {
  const props = { $standard: { schemaVersion: 1, key, data } };
  const name = `$prism_${key}`;
  const check = validateStandardEventProperties(name, props);
  if (!check.ok) throw new Error(`bad standard fixture ${name}: ${check.reason}`);
  return props;
}

function screenProps(
  screen: ScreenDef,
  sequence: number,
  previousScreen: string | null,
  app: { version: string; build: string; environment: string },
  installationId: string,
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    $screen: {
      name: screen.name,
      ...(screen.route ? { routePattern: screen.route } : {}),
      navigation: sequence === 1 ? "initial" : "push",
      sequence,
      ...(previousScreen ? { previousScreen } : {}),
    },
    $app: { ...app },
    $installation: installationId,
  };
  const check = validateScreenViewProperties(props);
  if (!check.ok) throw new Error(`bad screen fixture ${screen.name}: ${check.reason}`);
  return props;
}

function lifecycleProps(
  transition: "active" | "background" | "inactive",
  sequence: number,
  durationMs?: number,
): Record<string, unknown> {
  const props = {
    $lifecycle: {
      transition,
      sequence,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  };
  const check = validateAppLifecycleProperties(props);
  if (!check.ok) throw new Error(`bad lifecycle fixture: ${check.reason}`);
  return props;
}

/* ------------------------------------------------------------------ */
let globalInstall = 0;
let globalUser = 0;
const installPool: string[] = [];

function dayVolume(day: number, rand: () => number): number {
  const growth = 0.55 + 0.65 * ((TOTAL_DAYS - 1 - day) / (TOTAL_DAYS - 1));
  const dow = new Date(Date.now() - day * 86_400_000).getUTCDay();
  const dowFactor = dow === 6 ? 0.6 : dow === 0 ? 0.65 : 1; // mobile holds weekends better
  let spike = 1;
  const sinceLaunch = day - 45;
  if (sinceLaunch === 0) spike = 2.6;
  else if (sinceLaunch === 1) spike = 1.8;
  else if (sinceLaunch === 2) spike = 1.3;
  const noise = 0.88 + rand() * 0.24;
  return Math.round(2500 * growth * dowFactor * spike * noise);
}

function diurnalMs(dayStart: number, rand: () => number): number {
  // Mobile: morning + evening commute peaks, late tail.
  const weights = [2, 1, 1, 1, 1, 1, 3, 7, 10, 9, 8, 8, 9, 8, 7, 8, 10, 12, 11, 9, 8, 7, 5, 3];
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  let hour = 0;
  for (let h = 0; h < 24; h++) {
    r -= weights[h]!;
    if (r <= 0) { hour = h; break; }
  }
  return dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000);
}

function generateDay(day: number): { events: GenEvent[]; ops: WireIdentityOp[] } {
  const rand = mulberry32(0x51f7 + day * 7919);
  const events: GenEvent[] = [];
  const ops: WireIdentityOp[] = [];
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000 - day * 86_400_000;
  const screens = dayVolume(day, rand);
  const sessionTarget = Math.round(screens / 3.4);
  let seq = 0;
  const eid = () => `evt-mob-d${day}-${seq++}`;
  let sessSeq = 0;

  for (let s = 0; s < sessionTarget; s++) {
    const returning = installPool.length > 50 && rand() < 0.38;
    const installationId = returning
      ? installPool[Math.floor(rand() * installPool.length)]!
      : `inst-mob-${globalInstall++}`;
    if (!returning && installPool.length < 30000) installPool.push(installationId);
    const anonymousId = `anon-mob-${installationId}`;
    const sessionId = `mses-d${day}-${sessSeq++}`;
    const os = pick(rand, OS_W);
    const app = pick(rand, APP_W);
    const context = { os: os.os, osVersion: os.version };
    let t = diurnalMs(dayStart, rand);
    let lcSeq = 1;

    events.push({
      schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
      sessionId, anonymousId, name: "session_started", context,
      installationId: null,
    });
    t += Math.floor(rand() * 3000);
    events.push({
      schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
      sessionId, anonymousId, name: APP_LIFECYCLE_EVENT_NAME,
      properties: lifecycleProps("active", lcSeq++), context,
      installationId: null,
    });

    const screenCount = 1 + Math.floor(-Math.log(1 - rand()) * 2.6);
    let screenIdx = rand() < 0.3
      ? pick(rand, [[9, 50], [10, 20], [11, 30]] as Array<[number, number]>)
      : pick(rand, SCREEN_WEIGHTS);
    let prevScreen: string | null = null;
    let signedUpUser: string | null = null;

    for (let p = 0; p < Math.min(screenCount, 9); p++) {
      const screen = SCREENS[screenIdx]!;
      t += Math.floor((8 + rand() * 90) * 1000);
      events.push({
        schemaVersion: signedUpUser ? 3 : 2, eventId: eid(), type: "track", occurredAt: t,
        sessionId, anonymousId, ...(signedUpUser ? { userId: signedUpUser } : {}),
        name: SCREEN_VIEW_EVENT_NAME,
        properties: screenProps(screen, p + 1, prevScreen, app, installationId),
        context, installationId,
      });

      if (screen.name === "Search" && rand() < 0.3) {
        t += Math.floor((5 + rand() * 30) * 1000);
        events.push({
          schemaVersion: signedUpUser ? 3 : 2, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, ...(signedUpUser ? { userId: signedUpUser } : {}),
          name: "$prism_search",
          properties: stdProps("search", {
            category: "events",
            resultCount: 1 + Math.floor(rand() * 30),
          }),
          context, installationId: null,
        });
      }
      if (screen.name === "Paywall" && rand() < 0.12) {
        t += Math.floor((5 + rand() * 20) * 1000);
        events.push({
          schemaVersion: signedUpUser ? 3 : 2, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, ...(signedUpUser ? { userId: signedUpUser } : {}),
          name: "paywall_viewed",
          properties: { source: "settings" }, context, installationId: null,
        });
      }
      if ((screen.name === "Welcome" || screen.name === "Login") && !signedUpUser && rand() < 0.3) {
        const userId = `usr-mob-${globalUser++}`;
        signedUpUser = userId;
        t += Math.floor((20 + rand() * 90) * 1000);
        const method = pick(rand, SIGNUP_METHODS);
        ops.push({
          opId: `op-mob-signup-${userId}`, userId, anonymousId,
          traits: { initial_plan: "trial", signup_method: method }, occurredAt: t,
        });
        events.push({
          schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, userId, name: "$prism_sign_up",
          properties: stdProps("sign_up", { method }), context, installationId: null,
        });
        if (rand() < 0.5) {
          t += Math.floor((30 + rand() * 180) * 1000);
          events.push({
            schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
            sessionId, anonymousId, userId, name: "$prism_onboarding_completed",
            properties: stdProps("onboarding_completed", {
              flowId: "mobile-welcome", durationMs: 60000 + Math.floor(rand() * 300000),
            }),
            context, installationId: null,
          });
        }
        if (rand() < 0.35) {
          t += Math.floor((60 + rand() * 300) * 1000);
          const planId = pick(rand, PLANS);
          events.push({
            schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
            sessionId, anonymousId, userId, name: "$prism_trial_started",
            properties: stdProps("trial_started", {
              trialId: `trial-${userId}`, planId, durationDays: 14,
            }),
            context, installationId: null,
          });
          t += Math.floor((3600 + rand() * 7200) * 1000);
          if (rand() < 0.4) {
            events.push({
              schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
              sessionId, anonymousId, userId, name: "$prism_purchase",
              properties: stdProps("purchase", {
                transactionId: `txn-${userId}`, valueMinor: planId === "team" ? 9900 : 4900,
                currency: "USD", itemCount: 1,
              }),
              context, installationId: null,
            });
          } else if (rand() < 0.2) {
            events.push({
              schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
              sessionId, anonymousId, userId, name: "$prism_payment_failed",
              properties: stdProps("payment_failed", {
                transactionId: `txn-${userId}`, valueMinor: 4900,
                currency: "USD", provider: "apple-iap", failureCode: "payment_declined",
              }),
              context, installationId: null,
            });
          }
        }
        if (rand() < 0.45) {
          t += Math.floor((10 + rand() * 60) * 1000);
          events.push({
            schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
            sessionId, anonymousId, userId, name: "push_opt_in",
            properties: { placement: "onboarding" }, context, installationId: null,
          });
        }
      }
      prevScreen = screen.name;
      screenIdx = rand() < 0.6 ? pick(rand, SCREEN_WEIGHTS) : (screenIdx + 1) % SCREENS.length;
    }

    if (rand() < 0.7) {
      t += Math.floor((5 + rand() * 60) * 1000);
      const durationMs = Math.max(1000, t - (events.find((e) => e.sessionId === sessionId)?.occurredAt ?? t));
      events.push({
        schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
        sessionId, anonymousId, name: APP_LIFECYCLE_EVENT_NAME,
        properties: lifecycleProps("background", lcSeq++, durationMs),
        context, installationId: null,
      });
      events.push({
        schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
        sessionId, anonymousId, name: "session_ended", context,
        installationId: null,
      });
    }
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  const now = Date.now();
  for (const e of events) {
    if (e.occurredAt > now) e.occurredAt = now - Math.floor(rand() * 600_000);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  return { events, ops };
}

/* ------------------------------------------------------------------ */
async function postBatch(
  batch: GenEvent[],
  ops: WireIdentityOp[],
): Promise<{ accepted: number; rejected: Array<{ id: string; status: string; reason?: string }> }> {
  const res = await fetch(`${API_BASE}/api/v2/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SOURCE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      schemaVersion: 3,
      sentAt: Date.now(),
      sdk: SDK,
      events: batch.map(({ installationId: _i, ...rest }) => rest),
      ...(ops.length > 0 ? { identity: ops } : {}),
    }),
  });
  if (res.status === 429) return { accepted: 0, rejected: [{ id: "__rate_limited__", status: "rate_limited" }] };
  if (!res.ok) throw new Error(`ingest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    results?: Array<{ id: string; status: string; reason?: string }>;
  };
  return {
    accepted: (body.results ?? []).filter((r) => r.status === "accepted").length,
    rejected: (body.results ?? [])
      .filter((r) => r.status !== "accepted")
      .map((r) => ({ id: r.id, status: r.status, reason: r.reason })),
  };
}

async function seedHttp(days: GenEvent[][], dayOps: WireIdentityOp[][]): Promise<void> {
  let accepted = 0, rejected = 0, duplicates = 0, requests = 0;
  for (let d = 0; d < days.length; d++) {
    const list = days[d]!;
    let opsSent = false;
    for (let i = 0; i < list.length; i += HTTP_BATCH) {
      const batch = list.slice(i, i + HTTP_BATCH);
      const ops = !opsSent ? dayOps[d]!.slice(0, 50) : [];
      opsSent = true;
      for (;;) {
        const out = await postBatch(batch, ops);
        requests++;
        if (out.rejected.length === 1 && out.rejected[0]!.id === "__rate_limited__") {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        accepted += out.accepted;
        for (const r of out.rejected) {
          if (r.status === "duplicate") duplicates++;
          else {
            rejected++;
            console.error(`HTTP reject day=${d} id=${r.id} status=${r.status} reason=${r.reason}`);
          }
        }
        break;
      }
      if (requests % 100 === 0) await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`HTTP day ${d}: accepted=${accepted} rejected=${rejected} duplicates=${duplicates} requests=${requests}`);
  }
}

/* ------------------------------------------------------------------ */
function toValidated(e: GenEvent): ValidatedEvent {
  return {
    eventId: e.eventId,
    type: "track",
    schemaVersion: e.schemaVersion,
    occurredAt: e.occurredAt,
    ...(e.sessionId ? { sessionId: e.sessionId } : {}),
    ...(e.anonymousId ? { anonymousId: e.anonymousId } : {}),
    ...(e.userId ? { userId: e.userId } : {}),
    name: e.name,
    properties: e.properties ?? {},
    ...(e.context ? { context: e.context } : {}),
  };
}

type ScreenRow = Parameters<IngestRepository["persistBatch"]>[9][number]["row"];
type LifecycleRow = Parameters<IngestRepository["persistBatch"]>[10][number]["row"];

function buildRows(e: GenEvent): { screen: ScreenRow; lifecycle: LifecycleRow } | { screen: null; lifecycle: LifecycleRow } | null {
  if (e.name === SCREEN_VIEW_EVENT_NAME) {
    const props = e.properties as {
      $screen: { name: string; routePattern?: string; navigation: string; sequence: number; previousScreen?: string };
      $app?: { version?: string; build?: string; environment?: string };
    };
    const ctx = (e.context ?? {}) as { os?: string; osVersion?: string };
    const bound = (v: unknown, max: number): string | null =>
      typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
    if (!e.sessionId || !e.installationId) throw new Error(`screen without session/installation: ${e.eventId}`);
    return {
      screen: {
        eventId: e.eventId,
        sourceId: SOURCE_ID,
        occurredAt: e.occurredAt,
        sessionId: e.sessionId,
        sessionSequence: props.$screen.sequence,
        screenName: props.$screen.name,
        routePattern: props.$screen.routePattern ?? null,
        navigation: String(props.$screen.navigation),
        previousScreen: props.$screen.previousScreen ?? null,
        appVersion: bound(props.$app?.version, 32),
        appBuild: bound(props.$app?.build, 16),
        appEnvironment: bound(props.$app?.environment, 16),
        os: typeof ctx.os === "string" && ["ios", "android"].includes(ctx.os) ? ctx.os : null,
        osVersion: bound(ctx.osVersion, 16),
        installationDigest: digestInstallation(PROJECT_ID, SOURCE_ID, e.installationId, SALT),
      },
      lifecycle: null as unknown as LifecycleRow,
    };
  }
  if (e.name === APP_LIFECYCLE_EVENT_NAME) {
    const props = e.properties as { $lifecycle: { sequence: number; durationMs?: number } };
    if (!e.sessionId) throw new Error(`lifecycle without session: ${e.eventId}`);
    return {
      screen: null,
      lifecycle: {
        eventId: e.eventId,
        sourceId: SOURCE_ID,
        occurredAt: e.occurredAt,
        sessionId: e.sessionId,
        sequence: props.$lifecycle.sequence,
        durationMs: props.$lifecycle.durationMs ?? null,
      },
    };
  }
  return null;
}

async function seedDirect(days: GenEvent[][], dayOps: WireIdentityOp[][]): Promise<void> {
  const repo = new IngestRepository();
  const externalLinks = new Map<string, string>();
  const anonymousLinks = new Map<string, string>();
  const replacementPersonIds = new Map<string, string>();
  let written = 0;
  for (let d = 0; d < days.length; d++) {
    const list = days[d]!;
    const ops = dayOps[d]!.map((op) => {
      const v = validateIdentityOp(op);
      if (!v.ok) throw new Error(`bad identity op day=${d}`);
      return v.op;
    });
    for (let i = 0; i < list.length; i += DIRECT_CHUNK) {
      const chunk = list.slice(i, i + DIRECT_CHUNK);
      const validated = chunk.map(toValidated);
      const screens: Array<{ index: number; row: ScreenRow }> = [];
      const lifecycles: Array<{ index: number; row: LifecycleRow }> = [];
      chunk.forEach((e, j) => {
        const rows = buildRows(e);
        if (!rows) return;
        if (rows.screen) screens.push({ index: j, row: rows.screen });
        else lifecycles.push({ index: j, row: rows.lifecycle });
      });
      await repo.persistBatch(
        PROJECT_ID,
        validated,
        Math.max(...validated.map((v) => v.occurredAt)),
        SDK,
        i === 0 ? ops.map((op, j) => ({ index: j, op })) : [],
        externalLinks,
        anonymousLinks,
        replacementPersonIds,
        { sourceId: SOURCE_ID, platform: "mobile" },
        [],
        screens,
        lifecycles,
      );
      written += validated.length;
    }
    if (d % 10 === 0 || d === days.length - 1) {
      console.log(`direct day ${d + HTTP_DAYS}: cumulative events=${written}`);
    }
  }
}

/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  const allEvents: GenEvent[][] = [];
  const allOps: WireIdentityOp[][] = [];
  for (let day = TOTAL_DAYS - 1; day >= 0; day--) {
    const { events, ops } = generateDay(day);
    allEvents[day] = events;
    allOps[day] = ops;
    if (day % 30 === 0) console.log(`generated day ${day}: ${events.length} events, ${ops.length} identity ops`);
  }
  console.log(`HTTP leg: days 0..${HTTP_DAYS - 1} via ${API_BASE}`);
  await seedHttp(allEvents.slice(0, HTTP_DAYS), allOps.slice(0, HTTP_DAYS));
  console.log(`direct leg: days ${HTTP_DAYS}..${TOTAL_DAYS - 1}`);
  await seedDirect(allEvents.slice(HTTP_DAYS), allOps.slice(HTTP_DAYS));
  console.log("done");
  process.exit(0);
}

void main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
