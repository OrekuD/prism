/**
 * @prism-analytics/react-native entry (Task 18 slices 3-5)
 * Metro-safe: no DOM/Node imports at top level.
 * Core owns consent/queue/batch/retry/identity/session wire; adapter supplies
 * AppState, Platform, Dimensions, locale/timezone, storage, fetch, random IDs.
 */
export type { PrismClient } from "@prism-analytics/core";
export { MOBILE_LIMITS, SCREEN_VIEW_EVENT_NAME, APP_LIFECYCLE_EVENT_NAME } from "@prism-analytics/core";
export interface ReactNativePrismOptions { sourceKey: string; endpoint: string; storage?: unknown; }
export async function createReactNativeClient(_opts: ReactNativePrismOptions): Promise<unknown> { throw new Error("not implemented in slice 3 stub - replace in slices 3-4"); }
