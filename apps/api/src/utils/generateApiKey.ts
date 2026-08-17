import { v4 } from "uuid";

/**
 * Source ingestion keys (task-13): the prefix encodes the key type so a
 * leaked value is immediately identifiable and the two classes can never
 * be confused:
 * - psk_  publishable (Web/iOS/Android/React Native — visible in client
 *        binaries, telemetry-write-only, origin-policed on web)
 * - ssk_  secret (Server API — never leaves server-side configuration)
 */
export function generateApiKey(keyType: "publishable" | "secret"): string {
  const prefix = keyType === "publishable" ? "psk_" : "ssk_";
  return `${prefix}${v4().toString().replaceAll("-", "")}`;
}
