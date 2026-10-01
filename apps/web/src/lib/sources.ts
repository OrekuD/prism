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
	mobile: ["mobile", "react-native", "ios", "android"],
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
	mobile: "Mobile",
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

/** Keys are shown once at creation — list rows render a masked preview that
 * keeps the family prefix readable (task 29). Mirror of the shared policy in
 * packages/core/src/source-family.ts. */
const KEY_FAMILY_PREFIXES = ["psk_web_", "psk_mobile_", "ssk_"] as const;

export function maskKey(value: string): string {
	const prefix = KEY_FAMILY_PREFIXES.find((candidate) =>
		value.startsWith(candidate),
	);
	if (prefix) {
		return `${prefix}${String.fromCharCode(0x2022).repeat(8)}${value.slice(-4)}`;
	}
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
 * organization id. The family selects the supported adapter (task 29) and
 * the key string already shows its family prefix. */
export function sdkSnippet(
	platform: string,
	key: string,
	endpoint: string,
): string {
	const family = typeOfPlatform(platform);
	if (family === "server") {
		return `import { createNodeClient } from "@prism-analytics/node";

const prism = await createNodeClient({
  sourceKey: "${key}", // secret server key — keep it out of client bundles
  endpoint: "${endpoint}",
  collection: { initialState: "granted" },
});

await prism.track("order_completed", { value: 129 });`;
	}
	if (family === "mobile") {
		return `import { createReactNativeClient } from "@prism-analytics/react-native";

const prism = await createReactNativeClient({
  sourceKey: "${key}", // publishable key — safe to embed in the app
  endpoint: "${endpoint}",
  collection: { initialState: "granted" },
});

await prism.track("order_completed", { value: 129 });`;
	}
	return `import { createBrowserClient } from "@prism-analytics/browser";

const prism = await createBrowserClient({
  sourceKey: "${key}", // publishable key — safe to embed in the client
  endpoint: "${endpoint}",
  collection: { initialState: "granted" },
});

await prism.track("page_viewed", { url: window.location.href });`;
}

/**
 * Per-source error collection configuration + live status (task-15 item 440).
 * The SDK always enforces its own explicit opt-in; these rows record the
 * dashboard intent (reflected in the setup snippet) + ingestion status.
 */
export type SourceErrorMode = "off" | "manual" | "all";

export type SourceErrorSettings = {
	sourceId: string;
	mode: SourceErrorMode;
	captureGlobalErrors: boolean;
	breadcrumbsEnabled: boolean;
	/** Client-side sampling percent (0-100; 100 = collect all). */
	samplingRate: number;
	release: string | null;
	lastSeenErrorAt: number | null;
	errorCount30d: number;
};

export const SOURCE_ERROR_MODE_LABELS: Record<SourceErrorMode, string> = {
	off: "Off",
	manual: "Manual only",
	all: "Manual + global handlers",
};
