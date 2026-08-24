/**
 * Reserved mobile screen-view contract (Task 18 slice 1).
 *
 * Mirrors page-view.ts for Web but scoped to React Native apps.
 * Screen views use the existing consent/queue/batch/retry/source-key
 * lane as a reserved analytics event (`$prism_screen_view`). A second
 * reserved record `$prism_app_lifecycle` captures foreground/background
 * app-session intervals honestly (never claiming exact app close).
 */

import { MOBILE_LIMITS } from "./mobile-limits";

export const SCREEN_VIEW_EVENT_NAME = "$prism_screen_view" as const;
export const APP_LIFECYCLE_EVENT_NAME = "$prism_app_lifecycle" as const;

export type ScreenNavigation =
  | "initial"
  | "push"
  | "replace"
  | "pop"
  | "focus"
  | "manual";

export type AppLifecycleTransition = "active" | "background" | "inactive";

export interface ScreenViewCandidate {
  readonly name: string;
  readonly routePattern?: string;
  readonly navigation: ScreenNavigation;
  readonly previousScreen?: string;
  readonly sequence?: number;
  readonly properties?: Record<string, unknown>;
}

export interface ScreenViewWireProperties {
  readonly $screen: {
    readonly name: string;
    readonly routePattern?: string;
    readonly navigation: ScreenNavigation;
    readonly sequence: number;
    readonly previousScreen?: string;
  };
  /** Optional bounded custom properties after sanitization. */
  readonly $screen_properties?: Record<string, unknown>;
}

export interface AppLifecycleWireProperties {
  readonly $lifecycle: {
    readonly transition: AppLifecycleTransition;
    readonly sequence: number;
    readonly durationMs?: number;
  };
}

export type ScreenViewValidationResult =
  | { readonly ok: true; readonly value: ScreenViewWireProperties }
  | { readonly ok: false; readonly reason: string };

function isBoundedString(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

const SCREEN_NAME_PATTERN = /^[^\x00-\x1F\x7F]+$/;

export function isValidScreenName(value: string): boolean {
  return (
    isBoundedString(value, MOBILE_LIMITS.maxScreenNameLength) &&
    SCREEN_NAME_PATTERN.test(value) &&
    !value.includes("$")
  );
}

export function validateScreenViewProperties(
  input: unknown,
): ScreenViewValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "$screen must be an object" };
  }
  const record = input as Record<string, unknown>;
  const screen = record.$screen;
  if (typeof screen !== "object" || screen === null || Array.isArray(screen)) {
    return { ok: false, reason: "$screen must be an object" };
  }
  const s = screen as Record<string, unknown>;
  if (!isValidScreenName(s.name as string)) {
    return { ok: false, reason: "$screen.name must be 1-128 chars, no control chars or $" };
  }
  if (s.routePattern !== undefined) {
    if (!isBoundedString(s.routePattern, MOBILE_LIMITS.maxRoutePatternLength)) {
      return { ok: false, reason: "$screen.routePattern must be 1-512 chars" };
    }
    const rp = s.routePattern as string;
    if (rp.includes("?") || rp.includes("#") || rp.includes(" ") || rp.includes("$")) {
      return { ok: false, reason: "$screen.routePattern must not contain ?, #, space or $" };
    }
  }
  if (typeof s.navigation !== "string" || !["initial","push","replace","pop","focus","manual"].includes(s.navigation)) {
    return { ok: false, reason: "$screen.navigation must be initial|push|replace|pop|focus|manual" };
  }
  if (typeof s.sequence !== "number" || !Number.isInteger(s.sequence) || s.sequence < 1 || s.sequence > MOBILE_LIMITS.maxScreenSequence) {
    return { ok: false, reason: "$screen.sequence must be integer 1-1000000" };
  }
  if (s.previousScreen !== undefined && !isBoundedString(s.previousScreen, MOBILE_LIMITS.maxPreviousScreenLength)) {
    return { ok: false, reason: "$screen.previousScreen must be 1-128 chars" };
  }
  if (record.$screen_properties !== undefined) {
    if (typeof record.$screen_properties !== "object" || record.$screen_properties === null || Array.isArray(record.$screen_properties)) {
      return { ok: false, reason: "$screen_properties must be an object" };
    }
  }
  return {
    ok: true,
    value: {
      $screen: {
        name: s.name as string,
        routePattern: s.routePattern as string | undefined,
        navigation: s.navigation as ScreenNavigation,
        sequence: s.sequence as number,
        previousScreen: s.previousScreen as string | undefined,
      },
      $screen_properties: record.$screen_properties as Record<string, unknown> | undefined,
    },
  };
}

export type AppLifecycleValidationResult =
  | { readonly ok: true; readonly value: AppLifecycleWireProperties }
  | { readonly ok: false; readonly reason: string };

export function validateAppLifecycleProperties(input: unknown): AppLifecycleValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "$lifecycle must be an object" };
  }
  const record = input as Record<string, unknown>;
  const lifecycle = record.$lifecycle;
  if (typeof lifecycle !== "object" || lifecycle === null || Array.isArray(lifecycle)) {
    return { ok: false, reason: "$lifecycle must be an object" };
  }
  const l = lifecycle as Record<string, unknown>;
  if (typeof l.transition !== "string" || !["active","background","inactive"].includes(l.transition)) {
    return { ok: false, reason: "$lifecycle.transition must be active|background|inactive" };
  }
  if (typeof l.sequence !== "number" || !Number.isInteger(l.sequence) || l.sequence < 1) {
    return { ok: false, reason: "$lifecycle.sequence must be integer >=1" };
  }
  if (l.durationMs !== undefined && (typeof l.durationMs !== "number" || l.durationMs < 0)) {
    return { ok: false, reason: "$lifecycle.durationMs must be number >=0" };
  }
  return {
    ok: true,
    value: {
      $lifecycle: {
        transition: l.transition as AppLifecycleTransition,
        sequence: l.sequence as number,
        durationMs: l.durationMs as number | undefined,
      },
    },
  };
}
