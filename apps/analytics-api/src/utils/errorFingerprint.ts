/**
 * Versioned server-side error fingerprinting (task-15 slice 1).
 *
 * An issue is grouped by (project_id, platform, fingerprint_version,
 * fingerprint). The fingerprint is computed from the canonical
 * representation of the exception TYPE, the NORMALIZED message and the
 * stable top stack frames:
 *
 * - message normalization: lowercase, collapse whitespace, and replace
 *   digit runs with "#" so dynamic ids do not fragment groups;
 * - frames: the sanitized file (origin + path) and function of the top
 *   frames — line/column are intentionally excluded because they shift
 *   between deploys;
 * - the version constant is persisted with every issue, so a future
 *   algorithm change groups NEW issues differently without silently
 *   regrouping historical ones.
 *
 * Client-provided fingerprints are ignored entirely: the server always
 * computes the group key.
 */

import { createHash } from "node:crypto";

export const FINGERPRINT_VERSION = 1;

/** Lowercase, collapse whitespace, digit runs -> "#". */
export function normalizeMessage(message: string): string {
	return message.toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#").trim();
}

export interface FingerprintExceptionInput {
	type: string;
	message?: string;
	frames?: Array<{
		file?: string | null;
		function?: string | null;
		line?: number | null;
		column?: number | null;
		inApp?: boolean | null;
	}>;
}

/**
 * Canonical fingerprint for one exception (version 1). Deterministic:
 * same sanitized exception always produces the same fingerprint.
 */
export function fingerprintV1(input: FingerprintExceptionInput): string {
	const frames = (input.frames ?? []).slice(0, 3).map((frame) => {
		const file = frame.file ?? "";
		const fn = frame.function ?? "";
		return `${file.length > 200 ? file.slice(0, 200) : file}:${fn.length > 100 ? fn.slice(0, 100) : fn}`;
	});
	const canonical = [
		input.type.slice(0, ERROR_TYPE_CAP),
		normalizeMessage(input.message ?? "").slice(0, ERROR_MESSAGE_CAP),
		...frames,
	].join("|");
	return createHash("sha256").update(canonical).digest("hex");
}

const ERROR_TYPE_CAP = 128;
const ERROR_MESSAGE_CAP = 512;

/**
 * Deterministic issue id: the fingerprint itself scopes the group, so the
 * id derives from (project, platform, version, fingerprint) — an upsert
 * can reference it without a cross-statement lookup inside one atomic
 * batch.
 */
export function issueIdFor(
	projectId: string,
	platform: string,
	fingerprint: string,
): string {
	return createHash("sha256")
		.update(`${projectId}|${platform}|${FINGERPRINT_VERSION}|${fingerprint}`)
		.digest("hex")
		.slice(0, 32);
}
