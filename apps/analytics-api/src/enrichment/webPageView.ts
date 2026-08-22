import type { Context } from "hono";
import { UAParser } from "ua-parser-js";

/**
 * Server-owned page-view enrichment (Task 17 §5).
 *
 * Technology and coarse geography are derived at the TRUSTED ingestion
 * boundary from the request itself — never from event properties. Raw
 * User-Agent and raw IP exist only inside this module for the duration of
 * a request; they are never persisted, logged, returned, or placed into
 * properties/context.
 */

export const UA_PARSER_VERSION = "ua-parser-js@2.0.10";

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface PageTechnology {
	browserFamily: string | null;
	browserMajor: number | null;
	osFamily: string | null;
	osMajor: number | null;
	deviceType: DeviceType;
	isBot: boolean;
}

/** Conservative bot vocabulary — extended deliberately, not by default. */
const BOT_PATTERN =
	/(bot|crawler|spider|crawling|headless|slurp|bingpreview|facebookexternalhit|lighthouse|pagespeed|wget|curl\/)/i;

/**
 * One parse per User-Agent, bounded classifications out. A missing/garbage
 * UA yields `unknown` — enrichment failures NEVER fail ingestion.
 */
export function classifyTechnology(
	ua: string | null | undefined,
): PageTechnology {
	if (!ua || typeof ua !== "string" || ua.length > 512) {
		return {
			browserFamily: null,
			browserMajor: null,
			osFamily: null,
			osMajor: null,
			deviceType: "unknown",
			isBot: false,
		};
	}
	const isBot = BOT_PATTERN.test(ua);
	try {
		const parsed = new UAParser(ua).getResult();
		const browserFamily = parsed.browser.name ?? null;
		const browserMajorRaw = (parsed.browser as { major?: string }).major;
		const browserMajor = browserMajorRaw ? Number(browserMajorRaw) : null;
		const osFamily = parsed.os.name ?? null;
		const osMajorRaw = (parsed.os as { major?: string | number }).major;
		const osMajor = osMajorRaw ? Number(osMajorRaw) : null;
		let deviceType: DeviceType = "unknown";
		if (isBot) {
			deviceType = "bot";
		} else if (parsed.device.type === "mobile") {
			deviceType = "mobile";
		} else if (parsed.device.type === "tablet") {
			deviceType = "tablet";
		} else if (parsed.device.type === "desktop" || browserFamily) {
			deviceType = "desktop";
		}
		return {
			browserFamily,
			browserMajor,
			osFamily,
			osMajor,
			deviceType,
			isBot,
		};
	} catch {
		return {
			browserFamily: null,
			browserMajor: null,
			osMajor: null as unknown as number | null,
			osFamily: null,
			deviceType: isBot ? "bot" : "unknown",
			isBot,
		};
	}
}

/* ------------------------------------------------------------------ */
/* Coarse geography                                                    */
/* ------------------------------------------------------------------ */

export interface CoarseLocation {
	countryCode: string | null;
	region: string | null;
	city: string | null;
	provider: string;
}

export interface GeoProvider {
	/** Returns coarse location or null when unknown — never throws upward. */
	lookup(ip: string): Promise<CoarseLocation | null>;
}

/** Deterministic provider for tests and local development. */
export class FakeGeoProvider implements GeoProvider {
	constructor(private readonly mapping: ReadonlyMap<string, CoarseLocation>) {}

	async lookup(ip: string): Promise<CoarseLocation | null> {
		return this.mapping.get(ip) ?? null;
	}
}

/**
 * Optional IPinfo enrichment behind the existing egress configuration.
 * Timeboxed (2s), failure-isolated (null on any error), and silent — the
 * raw IP never appears in errors or logs.
 */
export class IpinfoGeoProvider implements GeoProvider {
	constructor(
		private readonly token: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	async lookup(ip: string): Promise<CoarseLocation | null> {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 2_000);
			const response = await this.fetchImpl(
				`https://ipinfo.io/${encodeURIComponent(ip)}/json`,
				{
					headers: { authorization: `Bearer ${this.token}` },
					signal: controller.signal,
				},
			);
			clearTimeout(timer);
			if (!response.ok) return null;
			const body = (await response.json()) as {
				country?: string;
				region?: string;
				city?: string;
			};
			return {
				countryCode: body.country?.slice(0, 2) ?? null,
				region: body.region?.slice(0, 120) ?? null,
				city: body.city?.slice(0, 120) ?? null,
				provider: "ipinfo",
			};
		} catch {
			return null;
		}
	}
}

/**
 * Client IP for OPTIONAL geo enrichment. Fails closed: forwarded headers
 * influence identity ONLY when TRUST_PROXY=true (a configured reverse
 * proxy); otherwise only a directly-connected peer address counts. There
 * is no public-caller-supplied value trusted by default.
 */
export function resolveClientIp(
	ctx: Context,
	env: Record<string, string | undefined>,
): string | null {
	const realIp = ctx.req.header("x-real-ip");
	const direct =
		ctx.env?.REMOTE_ADDR ??
		(env.TRUST_PROXY === "true" && realIp ? realIp : undefined);
	if (direct) return direct.slice(0, 64);
	if (env.TRUST_PROXY === "true") {
		const cf = ctx.req.header("cf-connecting-ip");
		if (cf) return cf.slice(0, 64);
		const forwarded = ctx.req.header("x-forwarded-for");
		const first = forwarded?.split(",")[0]?.trim();
		if (first) return first.slice(0, 64);
	}
	// Local/self-hosted without a proxy: loopback markers produce Unknown.
	return null;
}

/** Builds the configured provider chain (fake-friendly for tests). */
export function geoProviderFromEnv(
	env: Record<string, string | undefined>,
): GeoProvider | null {
	if (env.IPINFO_GEO_ENABLED === "1" && env.IP_INFO_API_TOKEN) {
		return new IpinfoGeoProvider(env.IP_INFO_API_TOKEN);
	}
	return null;
}

/* ------------------------------------------------------------------ */
/* Operational counters (safe labels only — no paths/IPs/UAs)          */
/* ------------------------------------------------------------------ */

const counters = new Map<string, number>();

export function incrementPageViewCounter(name: string): void {
	counters.set(name, (counters.get(name) ?? 0) + 1);
}

export function pageViewCountersSnapshot(): Record<string, number> {
	return Object.fromEntries(counters);
}
