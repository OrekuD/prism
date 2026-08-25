import { createHash } from "node:crypto";

/**
 * Server-side installation digesting (Task 18; R3-F3).
 *
 * Keyed hash over an unambiguous project+source+installation message: the
 * same physical install is NOT correlatable across projects or sources,
 * and the raw client value is never persisted (the controller strips it
 * from event properties right after computing this digest).
 */
export function digestInstallation(
	projectId: string,
	sourceId: string,
	installationId: string,
	salt: string,
): string {
	return createHash("sha256")
		.update(`${salt}:${projectId}:${sourceId}:${installationId}`)
		.digest("hex")
		.slice(0, 32);
}
