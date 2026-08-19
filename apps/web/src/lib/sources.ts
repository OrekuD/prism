/**
 * Sources domain helpers shared by the Sources index (type grid + tabs) and
 * the dedicated source-detail page.
 *
 * Source TYPES are the fixed high-level categories in the Sources view:
 * web / mobile / server. Real `SourceResource.platform` values roll up into
 * a type via SOURCE_TYPE_PLATFORMS — native iOS/Android SDKs (future) fold
 * into `mobile` without touching the grid or the URLs.
 */
export type SourceType = "web" | "mobile" | "server";

export const SOURCE_TYPES: ReadonlyArray<{ type: SourceType; label: string }> =
	[
		{ type: "web", label: "Web app" },
		{ type: "mobile", label: "Mobile app" },
		{ type: "server", label: "Server API" },
	];

/** URL words that select a source type (as opposed to a `src_*` id). */
export const SOURCE_TYPE_WORDS: ReadonlyArray<string> = SOURCE_TYPES.map(
	(entry) => entry.type,
);

export const SOURCE_TYPE_PLATFORMS: Record<
	SourceType,
	ReadonlyArray<string>
> = {
	web: ["web"],
	mobile: ["react-native", "ios", "android"],
	server: ["server"],
};

/** Panel tabs (URL slug + label). */
export const SOURCE_TABS: ReadonlyArray<{ tab: string; label: string }> = [
	{ tab: "overview", label: "Overview" },
	{ tab: "setup", label: "Setup" },
	{ tab: "keys", label: "Keys" },
	{ tab: "settings", label: "Settings" },
];

export const PLATFORM_LABELS: Record<string, string> = {
	web: "Web",
	ios: "iOS",
	android: "Android",
	"react-native": "React Native",
	server: "Server API",
};

export function typeOfPlatform(platform: string): SourceType {
	for (const entry of SOURCE_TYPES) {
		if (SOURCE_TYPE_PLATFORMS[entry.type].includes(platform)) {
			return entry.type;
		}
	}
	return "web";
}

export function sourceTypeLabel(type: string): string {
	return SOURCE_TYPES.find((entry) => entry.type === type)?.label ?? type;
}

export function sourceTabLabel(tab: string): string {
	return SOURCE_TABS.find((entry) => entry.tab === tab)?.label ?? tab;
}

/** The platform whose SDK prompt stands in for a type (mobile = react-native
 * until a native SDK ships). */
export function sourceSnippetPlatform(
	type: string,
): "web" | "react-native" | "server" {
	if (type === "server") return "server";
	if (type === "mobile") return "react-native";
	return "web";
}

/** Keys are shown once at creation — list rows render a masked preview. */
export function maskKey(value: string): string {
	if (value.length <= 10) return value;
	return `${value.slice(0, 4)}${String.fromCharCode(0x2022).repeat(8)}${value.slice(-4)}`;
}

/** Compact count formatting — 2K, 2M, … */
export function formatCount(value: number): string {
	return new Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

/** Coarse "… ago" for telemetry timestamps. */
export function timeAgo(timestamp: number | null): string {
	if (!timestamp) return "never";
	const seconds = Math.round((Date.now() - timestamp) / 1000);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

/** Valid http(s) origin, or a wildcard-subdomain origin (https://*.example.com). */
export function isValidOrigin(origin: string): boolean {
	const value = origin.trim();
	if (!value) return true; // empty lines are ignored
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return /^https?:\/\/\*\.[^\s/]+$/.test(value);
	}
}

/** SDK snippets carry ONLY the source's key — never a project or
 * organization id. */
export function sdkSnippet(
	platform: string,
	key: string,
	endpoint: string,
): string {
	if (platform === "server") {
		return `import { PrismClient } from "@prism-analytics/core";

const prism = new PrismClient({
  sourceKey: "${key}", // secret server key — keep it out of client bundles
  endpoint: "${endpoint}",
});

await prism.track("order_completed", { value: 129.0 });`;
	}
	const packageName =
		platform === "web"
			? "@prism-analytics/browser"
			: platform === "react-native"
				? "@prism-analytics/react-native"
				: platform === "ios"
					? "@prism-analytics/ios"
					: "@prism-analytics/android";
	return `import { createBrowserClient } from "${packageName}";

const prism = await createBrowserClient({
  sourceKey: "${key}", // publishable key — safe to embed in the client
  endpoint: "${endpoint}",
});

await prism.track("page_viewed", { url: window.location.href });`;
}
