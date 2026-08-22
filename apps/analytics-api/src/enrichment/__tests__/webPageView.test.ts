import { describe, expect, it } from "vitest";
import {
	FakeGeoProvider,
	IpinfoGeoProvider,
	classifyTechnology,
	incrementPageViewCounter,
	pageViewCountersSnapshot,
	resolveClientIp,
} from "../webPageView.js";

describe("page-view technology classification", () => {
	it("classifies a desktop Chrome UA", () => {
		const tech = classifyTechnology(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
		);
		expect(tech.browserFamily).toBe("Chrome");
		expect(tech.browserMajor).toBe(126);
		expect(tech.osFamily?.toLowerCase()).toContain("mac");
		expect(tech.deviceType).toBe("desktop");
		expect(tech.isBot).toBe(false);
	});

	it("classifies an iPhone as mobile", () => {
		const tech = classifyTechnology(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
		);
		expect(tech.deviceType).toBe("mobile");
	});

	it("marks known bots and excludes them from human device classes", () => {
		const tech = classifyTechnology(
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		);
		expect(tech.isBot).toBe(true);
		expect(tech.deviceType).toBe("bot");
	});

	it("degrades to unknown for missing or oversized UAs without failing", () => {
		expect(classifyTechnology(null).deviceType).toBe("unknown");
		expect(classifyTechnology(undefined).browserFamily).toBeNull();
		expect(classifyTechnology("x".repeat(600)).deviceType).toBe("unknown");
	});
});

describe("geo provider chain", () => {
	it("FakeGeoProvider resolves deterministic mappings only", async () => {
		const provider = new FakeGeoProvider(
			new Map([
				[
					"203.0.113.9",
					{
						countryCode: "US",
						region: "CA",
						city: "Smallville",
						provider: "fake",
					},
				],
			]),
		);
		await expect(provider.lookup("203.0.113.9")).resolves.toMatchObject({
			countryCode: "US",
			city: "Smallville",
		});
		await expect(provider.lookup("198.51.100.1")).resolves.toBeNull();
	});

	it("IpinfoGeoProvider is failure-isolated and timeboxed", async () => {
		const failing = new IpinfoGeoProvider("tok", (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch);
		await expect(failing.lookup("203.0.113.9")).resolves.toBeNull();

		let aborted = false;
		const slow = new IpinfoGeoProvider("tok", ((_input: unknown, init?: RequestInit) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					aborted = true;
					reject(new Error("aborted"));
				});
			});
		}) as unknown as typeof fetch);
		await expect(slow.lookup("203.0.113.9")).resolves.toBeNull();
		expect(aborted).toBe(true);
	});

	it("resolveClientIp fails closed without TRUST_PROXY", () => {
		const ctx = {
			env: {},
			req: {
				header: (name: string) =>
					name === "cf-connecting-ip" ? "203.0.113.9" : undefined,
			},
		} as never as Parameters<typeof resolveClientIp>[0];
		expect(resolveClientIp(ctx, {})).toBeNull();
		expect(resolveClientIp(ctx, { TRUST_PROXY: "true" })).toBe("203.0.113.9");
	});
});

it("counters are safe labeled numbers only", () => {
	incrementPageViewCounter("page_view_validated");
	incrementPageViewCounter("page_view_validated");
	expect(pageViewCountersSnapshot().page_view_validated).toBe(2);
});
