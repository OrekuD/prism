import { describe, expect, it } from "vitest";
import {
	PAGE_VIEW_EVENT_NAME,
	PAGE_VIEW_LIMITS,
	RESERVED_EVENT_PREFIX,
	isReservedAnalyticsEventName,
	isValidCanonicalPath,
	isValidPageHost,
	validatePageViewProperties,
	viewportWidthBucket,
} from "../index";
import { ready } from "./helpers";

const CANONICAL = {
	$page: {
		host: "acme.com",
		path: "/pricing",
		navigation: "push",
		sequence: 2,
		previousPath: "/",
	},
	$referrer: { host: "google.com" },
	$campaign: { source: "newsletter", medium: "email", name: "july" },
} as const;

describe("Task 17 slice 1 — reserved page-view contract", () => {
	it("exposes the reserved name and prefix", () => {
		expect(PAGE_VIEW_EVENT_NAME).toBe("$prism_page_view");
		expect(RESERVED_EVENT_PREFIX).toBe("$prism_");
		expect(isReservedAnalyticsEventName("$prism_page_view")).toBe(true);
		expect(isReservedAnalyticsEventName("$prism_custom_thing")).toBe(true);
		expect(isReservedAnalyticsEventName("checkout_completed")).toBe(false);
		// `$prism` without the dot is NOT reserved (prefix, not substring).
		expect(isReservedAnalyticsEventName("$prismlike")).toBe(false);
	});

	it("rejects reserved names through the PUBLIC track() seam", async () => {
		const prism = await ready({
			collection: { initialState: "granted", anonymousPersistence: "none" },
		});
		expect(() =>
			prism.track("$prism_page_view", { spoofed: true }),
		).toThrowError(/reserved/i);
		// Any other $prism_* name too — the namespace is owned by the SDK.
		expect(() => prism.track("$prism_spoof")).toThrowError(/reserved/i);
		await prism.shutdown({ timeoutMs: 100 });
	});

	it("accepts the canonical wire shape", () => {
		expect(validatePageViewProperties(CANONICAL)).toEqual({ ok: true });
		expect(
			validatePageViewProperties({
				$page: {
					host: "acme.com",
					path: "/",
					navigation: "initial",
					sequence: 1,
				},
			}),
		).toEqual({ ok: true });
	});

	it("rejects malformed reserved events with a reason", () => {
		const cases: Array<[unknown, RegExp]> = [
			[null, /must be an object/],
			[{}, /\$page is required/],
			[{ $page: CANONICAL.$page, spoofed: 1 }, /unknown page-view property/],
			[
				{ $page: { ...CANONICAL.$page, host: "Not-Normalized.example." } },
				/host/,
			],
			[{ $page: { ...CANONICAL.$page, path: "pricing" } }, /canonical path/],
			[{ $page: { ...CANONICAL.$page, path: "/x?a=1" } }, /canonical path/],
			[{ $page: { ...CANONICAL.$page, path: "/x#frag" } }, /canonical path/],
			[
				{
					$page: {
						...CANONICAL.$page,
						path: `/${"a".repeat(PAGE_VIEW_LIMITS.maxPathLength)}`,
					},
				},
				/canonical path/,
			],
			[{ $page: { ...CANONICAL.$page, navigation: "hover" } }, /navigation/],
			[{ $page: { ...CANONICAL.$page, sequence: 0 } }, /sequence/],
			[{ $page: { ...CANONICAL.$page, sequence: 1.5 } }, /sequence/],
			[{ $page: { ...CANONICAL.$page, extra: true } }, /unknown \$page field/],
			[
				{ $page: CANONICAL.$page, $referrer: { host: "acme.com" } },
				/differ from the page host/,
			],
			[
				{ $page: CANONICAL.$page, $referrer: { host: "x", path: "/" } },
				/only \{ host \}/,
			],
			[
				{ $page: CANONICAL.$page, $campaign: { utm_other: "x" } },
				/unknown \$campaign field/,
			],
			[
				{ $page: CANONICAL.$page, $campaign: { source: "" } },
				/\$campaign\.source/,
			],
			[
				{
					$page: {
						...CANONICAL.$page,
						title: "t".repeat(PAGE_VIEW_LIMITS.maxTitleLength + 1),
					},
				},
				/title/,
			],
		];
		for (const [input, pattern] of cases) {
			const result = validatePageViewProperties(input);
			expect(result.ok, JSON.stringify(input)?.slice(0, 120)).toBe(false);
			if (!result.ok) expect(result.reason).toMatch(pattern);
		}
	});

	it("bounds helpers agree with the frozen limits", () => {
		expect(isValidCanonicalPath("/")).toBe(true);
		expect(isValidCanonicalPath("")).toBe(false);
		expect(isValidPageHost("acme.com")).toBe(true);
		expect(isValidPageHost("-bad.bad")).toBe(false);
		expect(viewportWidthBucket(375)).toBe("<480");
		expect(viewportWidthBucket(768)).toBe("768-1023");
		expect(viewportWidthBucket(1920)).toBe("1440+");
		// Frozen metric boundaries (task-17 §7): not configurable in v1.
		expect(PAGE_VIEW_LIMITS.webSessionInactivityTimeoutMs).toBe(30 * 60_000);
		expect(PAGE_VIEW_LIMITS.lateDeliveryGeoCutoffMs).toBe(15 * 60_000);
		expect(PAGE_VIEW_LIMITS.maxDashboardRangeMs).toBeGreaterThan(
			360 * 86_400_000,
		);
		expect(PAGE_VIEW_LIMITS.rankingRowLimit).toBe(50);
		expect(PAGE_VIEW_LIMITS.citySuppressionMinSessions).toBe(5);
	});
});
