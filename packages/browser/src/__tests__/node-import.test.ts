// @vitest-environment node
import { describe, expect, it } from "vitest";
import { capturePageContext, createBrowserClient } from "../index";

/**
 * Node-without-DOM safety (task-9 §11): importing the package must never
 * touch window at module scope, and the factory fails loudly with a
 * specific error instead of half-working.
 */
describe("node without DOM", () => {
	it("imports cleanly in Node (no window access at module scope)", () => {
		expect(typeof createBrowserClient).toBe("function");
		expect(typeof capturePageContext).toBe("function");
	});

	it("fails loudly outside a browser", async () => {
		await expect(
			createBrowserClient({
				sourceKey: "psk_web_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
				endpoint: "https://example.com",
				collection: { initialState: "granted" },
			}),
		).rejects.toThrow(/requires a browser environment/);
	});
});
