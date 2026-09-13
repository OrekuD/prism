import { describe, expect, it } from "vitest";
import {
	isMobilePlatform,
	platformDotClass,
	platformFamily,
	platformLabel,
} from "@/lib/events";

/**
 * Task 29 regression: canonical `mobile` sources must classify as the
 * Mobile family everywhere — the Events page filter previously fell
 * through to `web` for the canonical value.
 */
describe("platform family classification", () => {
	it("classifies canonical and legacy platform values", () => {
		expect(platformFamily("mobile")).toBe("mobile");
		expect(platformFamily("react-native")).toBe("mobile");
		expect(platformFamily("ios")).toBe("mobile");
		expect(platformFamily("android")).toBe("mobile");
		expect(platformFamily("web")).toBe("web");
		expect(platformFamily("server")).toBe("server");
		expect(isMobilePlatform("mobile")).toBe(true);
		expect(isMobilePlatform("web")).toBe(false);
	});

	it("labels and colors the canonical family values", () => {
		expect(platformLabel("mobile")).toBe("Mobile");
		expect(platformLabel("react-native")).toBe("React Native");
		expect(platformDotClass("mobile")).toBe("bg-success");
	});
});
