/**
 * Task 18 slice 6: mobile screen view enrichment stub
 * Validates $prism_screen_view / $prism_app_lifecycle via Core validators,
 * digests installation IDs, derives size/device classes, optional coarse geo.
 */
import { validateScreenViewProperties } from "@prism-analytics/core";
export function enrichMobileScreenView(event: unknown){ const props = (event as any)?.properties; const r = validateScreenViewProperties(props); return r.ok ? { ok: true } : { ok: false, reason: (r as any).reason }; }
