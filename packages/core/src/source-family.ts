/**
 * Task 29: source families, key families, and adapter compatibility.
 *
 * ONE environment-neutral policy shared by every SDK and the ingestion
 * service. The credential's family prefix is a readable hint and a parsing
 * gate — never an authorization input. Authentication always resolves the
 * complete key against stored state; compatibility compares the stored
 * source family with the declared adapter, and a declaration is untrusted
 * metadata, not attestation.
 */

export type SourceFamily = "web" | "mobile" | "server";
export type SourceKeyClass = "publishable" | "secret";

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
	"web",
	"mobile",
	"server",
];

/**
 * Current key format: `psk_web_<43>`, `psk_mobile_<43>`, `ssk_<43>`.
 * The suffix is 32 random bytes in unpadded base64url (43 chars).
 */
export const SOURCE_KEY_PREFIX: Readonly<Record<SourceFamily, string>> = {
	web: "psk_web_",
	mobile: "psk_mobile_",
	server: "ssk_",
};

/** Unpadded base64url length of 32 random bytes. */
export const SOURCE_KEY_SUFFIX_LENGTH = 43;

const SOURCE_KEY_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Key class is derived from the family — impossible pairings cannot exist. */
export const SOURCE_KEY_CLASS: Readonly<Record<SourceFamily, SourceKeyClass>> =
	{
		web: "publishable",
		mobile: "publishable",
		server: "secret",
	};

export interface ParsedSourceKey {
	readonly family: SourceFamily;
	readonly keyClass: SourceKeyClass;
}

/**
 * Strict full-format parse of a current-format source key. Returns null for
 * obsolete formats, wrong suffix grammar, or non-strings. Never used for
 * authentication — the complete credential is the credential.
 */
export function parseSourceKey(value: unknown): ParsedSourceKey | null {
	if (typeof value !== "string") return null;
	for (const family of SOURCE_FAMILIES) {
		const prefix = SOURCE_KEY_PREFIX[family];
		if (!value.startsWith(prefix)) continue;
		const suffix = value.slice(prefix.length);
		if (!SOURCE_KEY_SUFFIX_PATTERN.test(suffix)) return null;
		return { family, keyClass: SOURCE_KEY_CLASS[family] };
	}
	return null;
}

export function isSourceKeyFormat(value: unknown): boolean {
	return parseSourceKey(value) !== null;
}

/**
 * Read-compatibility mapping for stored source platforms. Canonical values
 * are the family names; `ios`, `android`, and `react-native` are the legacy
 * mobile taxonomy and map to `mobile` without merging their records.
 */
export const LEGACY_SOURCE_PLATFORMS: Readonly<Record<string, SourceFamily>> = {
	web: "web",
	mobile: "mobile",
	ios: "mobile",
	android: "mobile",
	"react-native": "mobile",
	server: "server",
};

export function familyForPlatform(platform: unknown): SourceFamily | null {
	if (typeof platform !== "string") return null;
	return LEGACY_SOURCE_PLATFORMS[platform] ?? null;
}

export function familyLabel(family: SourceFamily): string {
	if (family === "web") return "Web";
	if (family === "mobile") return "Mobile";
	return "Server";
}

/**
 * Supported SDK adapters per family. A valid Mobile key does not make an
 * unknown adapter supported. Future native iOS/Android adapters register
 * here when their ingestion contracts ship.
 */
export const SUPPORTED_ADAPTERS: Readonly<Record<SourceFamily, readonly string[]>> =
	{
		web: ["@prism-analytics/browser", "@prism-analytics/react"],
		mobile: ["@prism-analytics/react-native"],
		server: ["@prism-analytics/node", "manual"],
	};

/**
 * Runtime platforms allowed on the Mobile family. Future native adapters
 * (iOS/Android SDKs) register here when their ingestion contracts ship —
 * the same Mobile key then serves them without a new prefix or source.
 */
export const MOBILE_RUNTIME_PLATFORMS: readonly string[] = ["react-native"];

const ADAPTER_FAMILY: ReadonlyMap<string, SourceFamily> = new Map(
	SOURCE_FAMILIES.flatMap((family) =>
		(SUPPORTED_ADAPTERS[family] ?? []).map(
			(adapter) => [adapter, family] as const
		)
	)
);

/** The family an adapter name is registered to, or null when unknown. */
export function adapterFamily(adapterName: unknown): SourceFamily | null {
	if (typeof adapterName !== "string") return null;
	return ADAPTER_FAMILY.get(adapterName) ?? null;
}

export function isAdapterSupportedForFamily(
	adapterName: unknown,
	family: SourceFamily
): boolean {
	return adapterFamily(adapterName) === family;
}

/** Stable compatibility failure codes (never carry credential material). */
export type SourceCompatibilityFailure =
	| "obsolete-key-format"
	| "incompatible-source"
	| "secret-key-in-client"
	| "key-source-mismatch"
	| "unsupported-adapter";

export type SourceCompatibility =
	| { readonly ok: true; readonly family: SourceFamily }
	| {
			readonly ok: false;
			readonly code: SourceCompatibilityFailure;
			readonly message: string;
	  };

/**
 * SDK-side local check of the configured key against the adapter's own
 * family. Definite mismatch and obsolete formats fail before any listener,
 * persistence, or queue is installed. The server rechecks authoritatively.
 */
export function checkClientKeyCompatibility(params: {
	readonly sourceKey: unknown;
	readonly adapterName: string;
	readonly adapterFamily: SourceFamily;
}): SourceCompatibility {
	const parsed = parseSourceKey(params.sourceKey);
	if (!parsed) {
		return {
			ok: false,
			code: "obsolete-key-format",
			message:
				"This key is not a current-format Prism source key. Create a new source key in the dashboard.",
		};
	}
	if (parsed.family === params.adapterFamily) {
		return { ok: true, family: parsed.family };
	}
	if (parsed.family === "server") {
		return {
			ok: false,
			code: "secret-key-in-client",
			message:
				"Secret server keys must never be embedded in client applications. Create a key for a Web or Mobile source instead.",
		};
	}
	return {
		ok: false,
		code: "incompatible-source",
		message: `This key belongs to a ${familyLabel(parsed.family)} source. Use a ${familyLabel(params.adapterFamily)} source key.`,
	};
}

/**
 * Server-side check of a stored key against its stored source family. A
 * mismatch is a configuration fault, not a credential alternative.
 */
export function checkStoredKeyCompatibility(params: {
	readonly key: unknown;
	readonly storedFamily: SourceFamily;
}): SourceCompatibility {
	const parsed = parseSourceKey(params.key);
	if (!parsed) {
		return {
			ok: false,
			code: "obsolete-key-format",
			message:
				"The stored key uses an obsolete format. Regenerate the source key.",
		};
	}
	if (parsed.family === params.storedFamily) {
		return { ok: true, family: parsed.family };
	}
	return {
		ok: false,
		code: "key-source-mismatch",
		message:
			"The key family does not match its source configuration. Regenerate the source key.",
	};
}

/**
 * Server-side check of a batch's declared adapter against the authenticated
 * source family. Missing, unknown, and mismatched declarations are distinct
 * outcomes so callers can return stable errors.
 */
export function checkAdapterCompatibility(
	adapterName: unknown,
	family: SourceFamily
): SourceCompatibility {
	const declared = adapterFamily(adapterName);
	if (declared === null) {
		return {
			ok: false,
			code: "unsupported-adapter",
			message:
				"The batch is missing a supported SDK adapter declaration.",
		};
	}
	if (declared !== family) {
		return {
			ok: false,
			code: "incompatible-source",
			message: `The declared SDK adapter is not compatible with this ${familyLabel(family)} source.`,
		};
	}
	return { ok: true, family: declared };
}

export interface IntegrationDeclaration {
	readonly name: string;
	readonly version: string;
	readonly family?: SourceFamily;
}

/**
 * SDK-side resolution of an adapter/integration declaration into the batch
 * `sdk` descriptor. Declaring a family opts into the local key check and
 * fails before any listener, persistence, or queue is installed. No
 * declaration falls back to the caller-provided descriptor (the bare Core
 * identity), which no source family accepts at ingestion.
 */
export function resolveIntegrationDescriptor(params: {
	readonly integration: IntegrationDeclaration | undefined;
	readonly sourceKey: string;
	readonly fallbackName: string;
	readonly fallbackVersion: string;
}): { readonly name: string; readonly version: string } {
	const { integration } = params;
	if (!integration) {
		return { name: params.fallbackName, version: params.fallbackVersion };
	}
	if (
		typeof integration.name !== "string" ||
		integration.name.trim().length === 0 ||
		typeof integration.version !== "string" ||
		integration.version.trim().length === 0
	) {
		throw new Error(
			"integration.name and integration.version are required declarations"
		);
	}
	if (integration.family !== undefined) {
		const compatibility = checkClientKeyCompatibility({
			sourceKey: params.sourceKey,
			adapterName: integration.name,
			adapterFamily: integration.family,
		});
		if (!compatibility.ok) {
			throw new Error(compatibility.message);
		}
	}
	return { name: integration.name, version: integration.version };
}
