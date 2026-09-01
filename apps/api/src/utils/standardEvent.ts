import {
  STANDARD_EVENT_BY_PROTECTED_NAME,
} from "@prism-analytics/core";
import type { StandardEventAttribution } from "@prism-analytics/types";

/**
 * Derive Standard Event attribution from the stored protected name.
 * Uses the shared Core registry — never trusts client payload display names.
 * Returns null for custom events, session records, malformed legacy records,
 * and non-Standard automatic protected events (e.g. $prism_page_view).
 */
export function deriveStandardEvent(name: string): StandardEventAttribution | null {
  const def = STANDARD_EVENT_BY_PROTECTED_NAME.get(name);
  if (!def) return null;
  return {
    key: def.key as StandardEventAttribution["key"],
    displayName: def.displayName,
    category: def.category,
    schemaVersion: 1,
  };
}
