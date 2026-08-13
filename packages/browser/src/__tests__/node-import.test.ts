// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createBrowserClient, capturePageContext } from "../index";

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
        projectKey: "pr_0123456789abcdef0123456789abcdef",
        endpoint: "https://example.com",
        collection: { initialState: "granted" },
      }),
    ).rejects.toThrow(/requires a browser environment/);
  });
});
