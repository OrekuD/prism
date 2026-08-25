import { INTERNAL_SEAM } from "@prism-analytics/core";
import type { InternalClientSeam, PrismClient } from "@prism-analytics/core";
import { SCREEN_VIEW_EVENT_NAME } from "@prism-analytics/core";

/**
 * Router-neutral manual screen controller (Task 18 slice 4).
 * Reserved records ALWAYS go through Core's internal seam - the public
 * track() rejects every $prism_ name, so there is no bypass. The sequence
 * counter is instance-owned (per controller), so no module-level test reset
 * exists to leak into production declarations.
 */
export interface ScreenController {
	track(
		name: string,
		opts?: {
			routePattern?: string;
			navigation?: "push" | "replace" | "pop" | "focus" | "manual";
			previousScreen?: string;
		},
	): { status: string; eventId?: string };
}

/**
 * `extrasProvider` supplies the bounded reserved-lane blocks ($app,
 * $installation) resolved by the factory - they are allowlisted top-level
 * fields of the frozen wire schema and are validated server-side.
 */
export function createScreenController(
	client: PrismClient,
	extrasProvider?: () => Record<string, unknown>,
): ScreenController {
	const seam = (client as unknown as Record<symbol, unknown>)[INTERNAL_SEAM] as
		| InternalClientSeam
		| undefined;
	if (!seam) throw new Error("prism: internal seam unavailable");
	let seq = 0;
	return {
		track(name, opts) {
			seq += 1;
			const screen: Record<string, unknown> = {
				name,
				navigation: opts?.navigation ?? "manual",
				sequence: seq,
			};
			if (opts?.routePattern !== undefined) {
				screen.routePattern = opts.routePattern;
			}
			if (opts?.previousScreen !== undefined) {
				screen.previousScreen = opts.previousScreen;
			}
			const payload: Record<string, unknown> = { $screen: screen };
			if (extrasProvider) {
				for (const [key, value] of Object.entries(extrasProvider())) {
					payload[key] = value;
				}
			}
			return seam.createReservedEvent(SCREEN_VIEW_EVENT_NAME, payload);
		},
	};
}
