/**
 * Seed realistic web traffic for the `landing` source (project
 * apricot-frittata-581613140) — 90 days × ~2k page views/day.
 *
 * - Days 0–6 go through the real HTTP ingestion API (exercises auth,
 *   validation, quota, compatibility gates, sessions).
 * - Days 7–89 go through the server's own IngestRepository.persistBatch
 *   with the same validators/builders (bypasses only the 30-day
 *   recency window, which legitimately rejects old timestamps).
 *
 * Deterministic IDs (day + sequence) make reruns idempotent via the
 * store's ON CONFLICT guards.
 *
 * Run from apps/analytics-api:
 *   LANDING_SOURCE_KEY=psk_web_... npx tsx <tmp>/seed-landing-web.mts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { IngestRepository } from "./src/repositories/IngestRepository.js";
import {
  UA_PARSER_VERSION,
  classifyTechnology,
} from "./src/enrichment/webPageView.js";
import {
  validateIdentityOp,
  type ValidatedEvent,
} from "./src/utils/ingestValidation.js";
import {
  PAGE_VIEW_EVENT_NAME,
  validatePageViewProperties,
  validateStandardEventProperties,
} from "@prism-analytics/core";

const API_BASE = process.env.ANALYTICS_API_BASE ?? "http://localhost:8080";
const SOURCE_KEY = process.env.LANDING_SOURCE_KEY ?? "";
const PROJECT_ID = "b1c21dd7-706e-4240-b53c-bc88b2bdc04a";
const SOURCE_ID = "15b1cb04-e880-44c0-9d11-4c7eeb8ecc6f";
const HOST = "prism.localhost";
const SDK = { name: "@prism-analytics/browser", version: "0.9.0" };
const HTTP_DAYS = Number(process.env.SEED_HTTP_DAYS ?? 7); // days 0..N-1 via HTTP; the rest direct
const TOTAL_DAYS = Number(process.env.SEED_DAYS ?? 90);
const HTTP_BATCH = 50;
const DIRECT_CHUNK = 400;

if (!SOURCE_KEY) throw new Error("LANDING_SOURCE_KEY is required");

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                   */
/* ------------------------------------------------------------------ */
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
/* Traffic model                                                       */
/* ------------------------------------------------------------------ */
const PAGES: Array<[string, string, number]> = [
  ["/", "Prism — Product analytics, events, and errors", 30],
  ["/pricing", "Prism pricing", 12],
  ["/features", "Prism features", 7],
  ["/features/sessions", "Sessions and live activity — Prism", 2],
  ["/docs", "Prism documentation", 8],
  ["/docs/start/quickstart", "Quickstart — Prism docs", 6],
  ["/docs/start/javascript-sdk", "JavaScript SDK — Prism docs", 3],
  ["/blog", "Prism blog", 5],
  ["/blog/launch-week-recap", "Launch week recap — Prism blog", 3],
  ["/blog/cookieless-tracking", "Cookieless tracking — Prism blog", 2],
  ["/blog/release-4-2", "Release 4.2 — Prism blog", 2],
  ["/customers", "Prism customers", 3],
  ["/customers/acme-case-study", "Acme case study — Prism", 1.5],
  ["/about", "About Prism", 2],
  ["/contact", "Contact Prism", 2],
  ["/changelog", "Prism changelog", 2.5],
  ["/login", "Sign in — Prism", 2],
  ["/signup", "Create your Prism account", 3],
];
const PAGE_WEIGHTS: Array<[number, number]> = PAGES.map(([ , , w], i) => [i, w]);

const REFERRERS: Array<[string | null, number]> = [
  [null, 40], // direct
  ["www.google.com", 20],
  ["github.com", 10],
  ["x.com", 7],
  ["www.linkedin.com", 5],
  ["news.ycombinator.com", 4],
  ["www.bing.com", 4],
  ["duckduckgo.com", 2],
  ["www.reddit.com", 3],
  ["newsletter.prism.localhost", 2],
  ["www.npmjs.com", 1],
];

interface Geo {
  country: string;
  region: string;
  city: string;
  locale: string;
  weight: number;
}
const GEOS: Geo[] = [
  { country: "US", region: "California", city: "San Francisco", locale: "en-US", weight: 16 },
  { country: "US", region: "New York", city: "New York", locale: "en-US", weight: 12 },
  { country: "US", region: "Texas", city: "Austin", locale: "en-US", weight: 7 },
  { country: "US", region: "Washington", city: "Seattle", locale: "en-US", weight: 7 },
  { country: "DE", region: "Berlin", city: "Berlin", locale: "de-DE", weight: 8 },
  { country: "GB", region: "England", city: "London", locale: "en-GB", weight: 7 },
  { country: "IN", region: "Karnataka", city: "Bengaluru", locale: "en-IN", weight: 7 },
  { country: "FR", region: "Île-de-France", city: "Paris", locale: "fr-FR", weight: 5 },
  { country: "CA", region: "Ontario", city: "Toronto", locale: "en-CA", weight: 5 },
  { country: "AU", region: "New South Wales", city: "Sydney", locale: "en-AU", weight: 4 },
  { country: "NL", region: "North Holland", city: "Amsterdam", locale: "en-US", weight: 3 },
  { country: "BR", region: "São Paulo", city: "São Paulo", locale: "pt-BR", weight: 3 },
  { country: "JP", region: "Tokyo", city: "Tokyo", locale: "ja-JP", weight: 3 },
  { country: "ES", region: "Madrid", city: "Madrid", locale: "es-ES", weight: 2 },
  { country: "SE", region: "Stockholm", city: "Stockholm", locale: "sv-SE", weight: 2 },
  { country: "SG", region: "Singapore", city: "Singapore", locale: "en-SG", weight: 2 },
  { country: "US", region: "Illinois", city: "Chicago", locale: "en-US", weight: 7 },
];
const GEO_WEIGHTS: Array<[number, number]> = GEOS.map((g, i) => [i, g.weight]);

interface UA {
  ua: string;
  viewport: [number, number];
  weight: number;
}
const UAS: UA[] = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", viewport: [1920, 1080], weight: 26 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", viewport: [1440, 900], weight: 18 },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", viewport: [1512, 982], weight: 10 },
  { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", viewport: [390, 844], weight: 16 },
  { ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", viewport: [412, 915], weight: 12 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0", viewport: [1536, 864], weight: 6 },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", viewport: [1920, 1080], weight: 6 },
  { ua: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", viewport: [820, 1180], weight: 4 },
  { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", viewport: [1024, 768], weight: 1 },
  { ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", viewport: [1024, 768], weight: 1 },
];
const UA_WEIGHTS: Array<[number, number]> = UAS.map((u, i) => [i, u.weight]);

const CAMPAIGNS: Array<[{ source: string; medium: string; name: string }, number]> = [
  [{ source: "google", medium: "cpc", name: "launch-week" }, 5],
  [{ source: "newsletter", medium: "email", name: "october-update" }, 4],
  [{ source: "x", medium: "social", name: "launch" }, 3],
  [{ source: "producthunt", medium: "launch", name: "ph-launch" }, 1.5],
  [{ source: "github", medium: "social", name: "readme" }, 2],
  [{ source: "linkedin", medium: "social", name: "founder-post" }, 1.5],
];

const SIGNUP_METHODS: Array<[string, number]> = [["email", 55], ["github", 30], ["google", 15]];
const SEARCH_CATEGORIES = ["docs", "pricing", "api-reference", "guides", "changelog"];
const PLANS: Array<[string, number]> = [["pro", 70], ["team", 30]];

/* ------------------------------------------------------------------ */
/* Wire event builders (same shape the browser SDK sends)              */
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
  uaIndex: number;
  geoIndex: number;
}

function stdProps(key: string, data: Record<string, unknown>): Record<string, unknown> {
  const props = { $standard: { schemaVersion: 1, key, data } };
  const name = `$prism_${key}`;
  const check = validateStandardEventProperties(name, props);
  if (!check.ok) throw new Error(`bad standard fixture ${name}: ${check.reason}`);
  return props;
}

function pageProps(
  path: string,
  title: string,
  sequence: number,
  previousPath: string | null,
  referrerHost: string | null,
  campaign: { source: string; medium: string; name: string } | null,
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    $page: {
      host: HOST,
      path,
      navigation: sequence === 1 ? "initial" : "push",
      sequence,
      ...(previousPath ? { previousPath } : {}),
      title,
    },
  };
  if (referrerHost) props.$referrer = { host: referrerHost };
  if (campaign) props.$campaign = { ...campaign };
  const check = validatePageViewProperties(props);
  if (!check.ok) throw new Error(`bad page-view fixture ${path}: ${check.reason}`);
  return props;
}

function baseContext(uaIndex: number, geoIndex: number): Record<string, unknown> {
  const ua = UAS[uaIndex]!;
  const geo = GEOS[geoIndex]!;
  return {
    locale: geo.locale,
    screenSize: { width: ua.viewport[0], height: ua.viewport[1] },
  };
}

/* ------------------------------------------------------------------ */
/* Day generator                                                       */
/* ------------------------------------------------------------------ */
let globalVisitor = 0;
let globalUser = 0;
const visitorPool: string[] = []; // anonymous_ids eligible as returnees

function dayVolume(day: number, rand: () => number): number {
  const growth = 0.55 + 0.65 * ((TOTAL_DAYS - 1 - day) / (TOTAL_DAYS - 1));
  const dow = new Date(Date.now() - day * 86_400_000).getUTCDay();
  const dowFactor = dow === 6 ? 0.55 : dow === 0 ? 0.6 : 1;
  let spike = 1;
  const sinceLaunch = day - 45; // Product Hunt launch was 45 days ago
  if (sinceLaunch === 0) spike = 3.2;
  else if (sinceLaunch === 1) spike = 2.1;
  else if (sinceLaunch === 2) spike = 1.5;
  const noise = 0.88 + rand() * 0.24;
  return Math.round(2000 * growth * dowFactor * spike * noise);
}

function diurnalMs(dayStart: number, rand: () => number): number {
  // Peak 09–17 UTC, quiet nights.
  const weights = [1, 1, 1, 1, 1, 2, 4, 7, 10, 12, 13, 14, 14, 13, 13, 12, 11, 9, 7, 5, 4, 3, 2, 1];
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
  const rand = mulberry32(0x9e37 + day * 7919);
  const events: GenEvent[] = [];
  const ops: WireIdentityOp[] = [];
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000 - day * 86_400_000;
  const views = dayVolume(day, rand);
  const sessionTarget = Math.round(views / 2.8);
  let seq = 0;
  const eid = () => `evt-landing-d${day}-${seq++}`;
  let sessSeq = 0;

  for (let s = 0; s < sessionTarget; s++) {
    const returning = visitorPool.length > 50 && rand() < 0.3;
    const anonymousId = returning
      ? visitorPool[Math.floor(rand() * visitorPool.length)]!
      : `anon-landing-${globalVisitor++}`;
    if (!returning && visitorPool.length < 40000) visitorPool.push(anonymousId);
    const sessionId = `ses-landing-d${day}-${sessSeq++}`;
    const uaIndex = pick(rand, UA_WEIGHTS);
    const geoIndex = pick(rand, GEO_WEIGHTS);
    const ctx = baseContext(uaIndex, geoIndex);
    let t = diurnalMs(dayStart, rand);
    const startedAt = t;

    events.push({
      schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
      sessionId, anonymousId, name: "session_started", context: ctx,
      uaIndex, geoIndex,
    });

    // Walk 1–7 pages.
    const pageCount = 1 + Math.floor(-Math.log(1 - rand()) * 2.2);
    let pageIdx = pick(rand, PAGE_WEIGHTS);
    let prevPath: string | null = null;
    let referrer = pick(rand, REFERRERS);
    let campaign: { source: string; medium: string; name: string } | null = null;
    if (referrer && rand() < 0.18) campaign = pick(rand, CAMPAIGNS);
    // Launch-day traffic skews to Product Hunt / HN.
    if (day === 45 && rand() < 0.45) {
      referrer = rand() < 0.6 ? "www.producthunt.com" : "news.ycombinator.com";
      campaign = { source: "producthunt", medium: "launch", name: "ph-launch" };
    }
    let signedUpUser: string | null = null;

    for (let p = 0; p < Math.min(pageCount, 7); p++) {
      const [path, title] = PAGES[pageIdx]!;
      t += Math.floor((20 + rand() * 160) * 1000);
      const props = pageProps(path, title, p + 1, prevPath, p === 0 ? referrer : null, p === 0 ? campaign : null);
      events.push({
        schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
        sessionId, anonymousId, name: PAGE_VIEW_EVENT_NAME,
        properties: props, context: ctx, uaIndex, geoIndex,
      });

      // In-page behavior.
      if ((path === "/docs" || path.startsWith("/docs/") || path === "/blog") && rand() < 0.22) {
        t += Math.floor((10 + rand() * 90) * 1000);
        events.push({
          schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, name: "$prism_search",
          properties: stdProps("search", {
            category: SEARCH_CATEGORIES[Math.floor(rand() * SEARCH_CATEGORIES.length)]!,
            resultCount: 1 + Math.floor(rand() * 24),
          }),
          context: ctx, uaIndex, geoIndex,
        });
      }
      if (path === "/blog/launch-week-recap" && rand() < 0.08) {
        t += Math.floor((15 + rand() * 60) * 1000);
        events.push({
          schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, name: "$prism_share",
          properties: stdProps("share", { method: "x", contentType: "article" }),
          context: ctx, uaIndex, geoIndex,
        });
      }

      // Funnel: pricing/signup → sign_up → onboarding → trial → purchase.
      if ((path === "/pricing" || path === "/signup") && !signedUpUser && rand() < (path === "/signup" ? 0.4 : 0.1)) {
        const userId = `usr-landing-${globalUser++}`;
        signedUpUser = userId;
        t += Math.floor((30 + rand() * 120) * 1000);
        const method = pick(rand, SIGNUP_METHODS);
        ops.push({
          opId: `op-landing-signup-${userId}`, userId, anonymousId,
          traits: { initial_plan: "trial", signup_method: method }, occurredAt: t,
        });
        events.push({
          schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, userId, name: "$prism_sign_up",
          properties: stdProps("sign_up", { method }), context: ctx,
          uaIndex, geoIndex,
        });
        t += Math.floor((20 + rand() * 60) * 1000);
        events.push({
          schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, userId, name: "workspace_created",
          properties: { workspace_name: "My project" }, context: ctx,
          uaIndex, geoIndex,
        });
        if (rand() < 0.4) {
          t += Math.floor((10 + rand() * 40) * 1000);
          events.push({
            schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
            sessionId, anonymousId, userId, name: "api_key_created",
            properties: { key_type: "publishable" }, context: ctx,
            uaIndex, geoIndex,
          });
        }
        if (rand() < 0.6) {
          t += Math.floor((60 + rand() * 300) * 1000);
          const flowId = "signup-onboarding";
          events.push({
            schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
            sessionId, anonymousId, userId, name: "$prism_onboarding_completed",
            properties: stdProps("onboarding_completed", {
              flowId, durationMs: 120000 + Math.floor(rand() * 600000),
            }),
            context: ctx, uaIndex, geoIndex,
          });
          if (rand() < 0.3) {
            t += Math.floor((30 + rand() * 120) * 1000);
            const planId = pick(rand, PLANS);
            events.push({
              schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
              sessionId, anonymousId, userId, name: "$prism_trial_started",
              properties: stdProps("trial_started", {
                trialId: `trial-${userId}`, planId, durationDays: 14,
              }),
              context: ctx, uaIndex, geoIndex,
            });
            const converts = rand() < 0.35;
            t += Math.floor((3600 + rand() * 7200) * 1000);
            if (converts) {
              events.push({
                schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
                sessionId, anonymousId, userId, name: "$prism_purchase",
                properties: stdProps("purchase", {
                  transactionId: `txn-${userId}`, valueMinor: planId === "team" ? 9900 : 2900,
                  currency: "USD", itemCount: 1,
                }),
                context: ctx, uaIndex, geoIndex,
              });
            } else if (rand() < 0.2) {
              events.push({
                schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
                sessionId, anonymousId, userId, name: "$prism_payment_failed",
                properties: stdProps("payment_failed", {
                  transactionId: `txn-${userId}`, valueMinor: 2900,
                  currency: "USD", provider: "stripe", failureCode: "card_declined",
                }),
                context: ctx, uaIndex, geoIndex,
              });
            }
          }
        }
      }
      if (path === "/docs/start/quickstart" && signedUpUser && rand() < 0.1) {
        t += Math.floor((20 + rand() * 80) * 1000);
        events.push({
          schemaVersion: 3, eventId: eid(), type: "track", occurredAt: t,
          sessionId, anonymousId, userId: signedUpUser, name: "$prism_feedback_submitted",
          properties: stdProps("feedback_submitted", { kind: "docs", rating: 4 + Math.floor(rand() * 2) }),
          context: ctx, uaIndex, geoIndex,
        });
      }

      prevPath = path;
      // Next page: often related, sometimes random.
      pageIdx = rand() < 0.55
        ? pick(rand, PAGE_WEIGHTS)
        : (pageIdx + 1 + Math.floor(rand() * 4)) % PAGES.length;
    }

    if (rand() < 0.75) {
      t += Math.floor((10 + rand() * 120) * 1000);
      events.push({
        schemaVersion: 2, eventId: eid(), type: "track", occurredAt: t,
        sessionId, anonymousId, name: "session_ended", context: ctx,
        uaIndex, geoIndex,
      });
    }
    void startedAt;
  }
  // Sort by time (funnel events can run past midnight — keep day-local).
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  // Clamp funnel follow-ups that spilled into the future (day 0): the API
  // rejects anything past now + 5min skew as invalid-timestamp.
  const now = Date.now();
  for (const e of events) {
    if (e.occurredAt > now) e.occurredAt = now - Math.floor(rand() * 600_000);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  return { events, ops };
}

/* ------------------------------------------------------------------ */
/* HTTP leg (days 0..HTTP_DAYS-1)                                      */
/* ------------------------------------------------------------------ */
async function postBatch(
  batch: GenEvent[],
  ops: WireIdentityOp[],
  ua: string,
): Promise<{ accepted: number; rejected: Array<{ id: string; reason?: string }> }> {
  const res = await fetch(`${API_BASE}/api/v2/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SOURCE_KEY}`,
      "content-type": "application/json",
      origin: `https://${HOST}`,
      "user-agent": ua,
    },
    body: JSON.stringify({
      schemaVersion: 3,
      sentAt: Date.now(),
      sdk: SDK,
      events: batch.map(({ uaIndex: _u, geoIndex: _g, ...rest }) => rest),
      ...(ops.length > 0 ? { identity: ops } : {}),
    }),
  });
  if (res.status === 429) return { accepted: 0, rejected: [{ id: "__rate_limited__" }] };
  if (!res.ok) throw new Error(`ingest HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    results?: Array<{ id: string; status: string; reason?: string }>;
  };
  const accepted = (body.results ?? []).filter((r) => r.status === "accepted").length;
  const rejected = (body.results ?? [])
    .filter((r) => r.status !== "accepted")
    .map((r) => ({ id: r.id, reason: r.reason }));
  return { accepted, rejected };
}

async function seedHttp(days: GenEvent[][], dayOps: WireIdentityOp[][]): Promise<void> {
  let accepted = 0;
  let rejected = 0;
  let requests = 0;
  const windowStart = Date.now();
  let windowEvents = 0;
  for (let d = 0; d < days.length; d++) {
    // Group by UA: technology enrichment is per-request.
    const byUa = new Map<number, GenEvent[]>();
    for (const e of days[d]!) {
      const list = byUa.get(e.uaIndex) ?? [];
      list.push(e);
      byUa.set(e.uaIndex, list);
    }
    let opsSent = false;
    for (const [uaIndex, list] of byUa) {
      for (let i = 0; i < list.length; i += HTTP_BATCH) {
        const batch = list.slice(i, i + HTTP_BATCH);
        const ops = !opsSent ? dayOps[d]!.slice(0, 50) : [];
        opsSent = true;
        // Stay under the 10k/minute project quota with headroom.
        if (windowEvents + batch.length > 7000 && Date.now() - windowStart < 60_000) {
          await new Promise((r) => setTimeout(r, 60_000 - (Date.now() - windowStart) + 1000));
        }
        for (;;) {
          const out = await postBatch(batch, ops, UAS[uaIndex]!.ua);
          requests++;
          windowEvents += batch.length;
          if (out.rejected.length === 1 && out.rejected[0]!.id === "__rate_limited__") {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          accepted += out.accepted;
          rejected += out.rejected.length;
          for (const r of out.rejected) {
            console.error(`HTTP reject day=${d} id=${r.id} reason=${r.reason}`);
          }
          break;
        }
      }
    }
    console.log(`HTTP day ${d}: cumulative accepted=${accepted} rejected=${rejected} requests=${requests}`);
  }
}

/* ------------------------------------------------------------------ */
/* Direct leg (days HTTP_DAYS..TOTAL_DAYS-1) via the server's own repo */
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

function buildProjection(e: GenEvent): {
  index: number;
  row: Parameters<IngestRepository["persistBatch"]>[8][number]["row"];
} | null {
  if (e.name !== PAGE_VIEW_EVENT_NAME) return null;
  const props = e.properties as {
    $page: { host: string; path: string; navigation: string; sequence: number; previousPath?: string; title?: string };
    $referrer?: { host: string };
    $campaign?: { source?: string; medium?: string; name?: string };
  };
  const page = props.$page;
  const ctx = (e.context ?? {}) as { screenSize?: { width?: number; height?: number }; locale?: string };
  const tech = classifyTechnology(UAS[e.uaIndex]!.ua);
  const geo = GEOS[e.geoIndex]!;
  return {
    index: -1, // filled by caller
    row: {
      occurredAt: e.occurredAt,
      host: page.host,
      path: page.path,
      title: page.title ?? null,
      navigationType: String(page.navigation),
      pageSequence: page.sequence,
      previousPath: page.previousPath ?? null,
      referrerHost: props.$referrer?.host ?? null,
      campaignSource: props.$campaign?.source ?? null,
      campaignMedium: props.$campaign?.medium ?? null,
      campaignName: props.$campaign?.name ?? null,
      browserFamily: tech.browserFamily,
      browserMajor: tech.browserMajor,
      osFamily: tech.osFamily,
      osMajor: tech.osMajor,
      deviceType: tech.deviceType,
      isBot: tech.isBot,
      uaParserVersion: UA_PARSER_VERSION,
      viewportWidth: typeof ctx.screenSize?.width === "number" ? Math.round(ctx.screenSize.width) : null,
      viewportHeight: typeof ctx.screenSize?.height === "number" ? Math.round(ctx.screenSize.height) : null,
      primaryLanguage: ctx.locale ? ctx.locale.slice(0, 12).split("-")[0] || null : null,
      countryCode: geo.country,
      region: geo.region,
      city: geo.city,
      geoProvider: "seed",
    },
  };
}

async function seedDirect(days: GenEvent[][], dayOps: WireIdentityOp[][]): Promise<void> {
  const repo = new IngestRepository();
  const externalLinks = new Map<string, string>();
  const anonymousLinks = new Map<string, string>();
  const replacementPersonIds = new Map<string, string>();
  let written = 0;
  for (let d = 0; d < days.length; d++) {
    const list = days[d]!;
    const ops = dayOps[d]!.map((op, i) => {
      const v = validateIdentityOp(op);
      if (!v.ok) throw new Error(`bad identity op day=${d}: ${JSON.stringify(op).slice(0, 120)}`);
      return { index: i, op: v.op };
    });
    for (let i = 0; i < list.length; i += DIRECT_CHUNK) {
      const chunk = list.slice(i, i + DIRECT_CHUNK);
      const validated = chunk.map(toValidated);
      const projections = chunk
        .map((e, j) => {
          const p = buildProjection(e);
          return p ? { index: j, row: p.row } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
      const chunkOps = i === 0 ? ops.map((o) => ({ ...o })) : [];
      // Remap op indexes into chunk-local space (only first chunk carries ops).
      const remappedOps = chunkOps.map((o, j) => ({ index: j, op: o.op }));
      await repo.persistBatch(
        PROJECT_ID,
        validated,
        Math.max(...validated.map((v) => v.occurredAt)),
        SDK,
        remappedOps,
        externalLinks,
        anonymousLinks,
        replacementPersonIds,
        { sourceId: SOURCE_ID, platform: "web" },
        projections,
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
    // Oldest first so identity first-wins matches chronological order.
    const { events, ops } = generateDay(day);
    allEvents[day] = events;
    allOps[day] = ops;
    if (day % 30 === 0) console.log(`generated day ${day}: ${events.length} events, ${ops.length} identity ops`);
  }
  const httpDays = allEvents.slice(0, HTTP_DAYS);
  const httpOps = allOps.slice(0, HTTP_DAYS);
  const directDays = allEvents.slice(HTTP_DAYS);
  const directOps = allOps.slice(HTTP_DAYS);

  console.log(`HTTP leg: days 0..${HTTP_DAYS - 1}`);
  await seedHttp(httpDays, httpOps);
  console.log(`direct leg: days ${HTTP_DAYS}..${TOTAL_DAYS - 1}`);
  await seedDirect(directDays, directOps);
  console.log("done");
  process.exit(0);
}

void main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
