import type { EventResource } from "@prism-analytics/types";

/**
 * Events page vocabulary (task-16 dashboard slice).
 *
 * Mirrors the v2 design (`analytics-dashboard-v2-events.html`): trusted
 * source attribution renders as a colored dot + name + exact platform,
 * grouped into Web | Mobile | Server families for filters and breakdowns.
 * React web apps are Web sources — the family grouping is a UI concept,
 * never a trusted value.
 */

export type PlatformFamily = "web" | "mobile" | "server";

export const isMobilePlatform = (platform: string): boolean =>
	platform === "ios" || platform === "android" || platform === "react-native";

export function platformFamily(platform: string): PlatformFamily {
	if (platform === "web") return "web";
	if (platform === "server") return "server";
	if (isMobilePlatform(platform)) return "mobile";
	return "web";
}

export function platformLabel(platform: string): string {
	switch (platform) {
		case "web":
			return "Web";
		case "ios":
			return "iOS";
		case "android":
			return "Android";
		case "react-native":
			return "React Native";
		case "server":
			return "Server";
		default:
			return platform;
	}
}

export const FAMILY_LABELS: Record<PlatformFamily, string> = {
	web: "Web",
	mobile: "Mobile",
	server: "Server",
};

export const FAMILY_DESCRIPTIONS: Record<PlatformFamily, string> = {
	web: "Browser · React web",
	mobile: "iOS · Android · React Native",
	server: "Node · secret key",
};

/** Dot color per exact platform (v2 tokens). */
export function platformDotClass(platform: string): string {
	switch (platform) {
		case "web":
			return "bg-info";
		case "ios":
			return "bg-event";
		case "android":
			return "bg-warning";
		case "react-native":
			return "bg-success";
		case "server":
			return "bg-text-subtle";
		default:
			return "bg-border-strong";
	}
}

export function eventPlatform(event: EventResource): string | null {
	return event.platform ?? event.source?.platform ?? null;
}

/** Relative time ("3m ago") for table rows. */
export function agoLabel(ts: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

export function clockLabel(ts: number): string {
	const date = new Date(ts);
	if (Number.isNaN(date.getTime())) return String(ts);
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function isoLabel(ts: number): string {
	try {
		return new Date(ts).toISOString();
	} catch {
		return String(ts);
	}
}

export const EVENT_PAGE_SIZE = 50;
