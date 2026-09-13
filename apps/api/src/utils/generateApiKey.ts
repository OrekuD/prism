import type { SourceFamily } from "@prism-analytics/core";
import { SOURCE_KEY_PREFIX } from "@prism-analytics/core";

/**
 * Task 29: source ingestion keys carry a readable family prefix and 32
 * bytes of random suffix (unpadded base64url, 43 chars):
 *
 * - psk_web_     publishable — visible in client binaries, origin-policed
 * - psk_mobile_  publishable — React Native (and future native adapters)
 * - ssk_         secret      — server-side only, never in client bundles
 *
 * The key class is DERIVED from the family, so impossible class/family
 * pairings cannot be requested. A prefix is a readable hint, never an
 * authorization input: authentication always checks the complete key.
 */

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i] ?? 0;
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		out += BASE64URL_ALPHABET.charAt(b0 >> 2);
		out += BASE64URL_ALPHABET.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4));
		if (b1 !== undefined) {
			out += BASE64URL_ALPHABET.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6));
		}
		if (b2 !== undefined) {
			out += BASE64URL_ALPHABET.charAt(b2 & 0x3f);
		}
	}
	return out;
}

/** 32 cryptographically random bytes, unpadded base64url (43 chars). */
export function generateSourceKeySuffix(): string {
	const source = globalThis as {
		crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
	};
	if (!source.crypto?.getRandomValues) {
		throw new Error(
			"prism: no secure random available (crypto.getRandomValues required)",
		);
	}
	const bytes = new Uint8Array(32);
	source.crypto.getRandomValues(bytes);
	return bytesToBase64Url(bytes);
}

export function generateApiKey(family: SourceFamily): string {
	const prefix = SOURCE_KEY_PREFIX[family];
	if (!prefix) {
		throw new Error(`prism: unknown source family ${String(family)}`);
	}
	return `${prefix}${generateSourceKeySuffix()}`;
}
