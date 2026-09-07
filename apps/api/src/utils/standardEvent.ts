import {
  standardEventDefinitionForKey,
  validateStandardEventProperties,
} from "@prism-analytics/core";
import type { StandardEventAttribution } from "@prism-analytics/types";

/**
 * Derive Standard Event attribution from the stored protected name AND the
 * stored properties (R1-F3). The name alone is not enough: malformed legacy
 * or manually inserted rows carrying a recognized `$prism_*` name without a
 * valid `$standard` wrapper must stay unlabeled.
 *
 * Validation uses the same shared Core registry/validator as SDK capture and
 * ingestion. Display metadata is built from the trusted registry definition
 * selected by the VALIDATED key — display names, categories, and versions
 * are never read from stored client properties. Returns null for custom
 * events, session records, malformed legacy records, and non-Standard
 * automatic protected events (e.g. $prism_page_view).
 */
export function deriveStandardEvent(
  name: string,
  properties: unknown,
): StandardEventAttribution | null {
  const validation = validateStandardEventProperties(name, properties);
  if (!validation.ok) return null;
  const def = standardEventDefinitionForKey(validation.key);
  if (!def) return null;
  return {
    key: def.key,
    displayName: def.displayName,
    category: def.category,
    schemaVersion: def.schemaVersion,
  };
}
