/**
 * Bounded mobile context (Task 18 slice 1).
 *
 * Extend Core runtime context with an allowlisted mobile block. All fields
 * are client-reported dimensions; source key remains the trusted platform
 * authority. No advertising IDs, GPS, or hardware serials.
 */

export type MobileOs = "ios" | "android";
export type MobileKind = "mobile";
export type MobilePlatform = "react-native";

export interface MobileContext {
  readonly platform: MobilePlatform;
  readonly kind: MobileKind;
  readonly os: MobileOs;
  readonly osVersion?: string;
  readonly appName?: string;
  readonly appVersion?: string;
  readonly appBuild?: string;
  readonly appEnvironment?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly windowWidth?: number;
  readonly windowHeight?: number;
  /** Server-derived size class; client reports dimensions only. */
  readonly sizeClass?: "compact" | "regular" | "large" | "unknown";
  readonly deviceClass?: "phone" | "tablet" | "unknown";
}

export function isValidMobileContext(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.platform !== "react-native") return false;
  if (r.kind !== "mobile") return false;
  if (r.os !== "ios" && r.os !== "android") return false;
  return true;
}
