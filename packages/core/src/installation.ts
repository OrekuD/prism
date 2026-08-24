/**
 * Installation identity contract (Task 18 slice 1).
 *
 * A random installation identifier is created only after consent is granted
 * and only when persistent storage is enabled. It is unrelated to IDFV,
 * advertising IDs, or hardware serials. The server digests it per
 * project/source before persistence; raw value is never stored/logged.
 */

export const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidInstallationId(value: string): boolean {
  return typeof value === "string" && INSTALLATION_ID_PATTERN.test(value);
}

export function isValidInstallationDigest(value: string): boolean {
  return typeof value === "string" && /^[a-f0-9]{32,64}$/.test(value);
}
