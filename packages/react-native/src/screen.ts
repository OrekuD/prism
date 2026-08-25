import { INTERNAL_SEAM } from "@prism-analytics/core";
import type { InternalClientSeam, PrismClient } from "@prism-analytics/core";
import { SCREEN_VIEW_EVENT_NAME } from "@prism-analytics/core";

/**
 * Router-neutral manual screen controller (Task 18 slice 4).
 * Reserved records ALWAYS go through Core's internal seam - the public
 * track() rejects every $prism_ name, so there is no bypass. Sequence is
 * owned by the app-session lifecycle owner; this controller only stamps
 * navigation intent.
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

export function createScreenController(client: PrismClient): ScreenController {
	const seam = (client as unknown as Record<symbol, unknown>)[INTERNAL_SEAM] as
		| InternalClientSeam
		| undefined;
	if (!seam) throw new Error("prism: internal seam unavailable");
	return {
		track(name, opts) {
			// Sequence comes from the session owner via the seam-attached state;
			// screens use a monotonic counter derived from lifecycle sequence.
			const screen: Record<string, unknown> = {
				name,
				navigation: opts?.navigation ?? "manual",
				sequence: screenSequence(),
			};
			if (opts?.routePattern !== undefined) screen.routePattern = opts.routePattern;
			if (opts?.previousScreen !== undefined) screen.previousScreen = opts.previousScreen;
			return seam.createReservedEvent(SCREEN_VIEW_EVENT_NAME, { $screen: screen });
		},
	};
}

let screenCounter = 0;
function screenSequence(): number {
	screenCounter += 1;
	return screenCounter;
}
/** Test-only reset of the module-local screen counter. */
export function resetScreenSequenceForTests(): void {
	screenCounter = 0;
}