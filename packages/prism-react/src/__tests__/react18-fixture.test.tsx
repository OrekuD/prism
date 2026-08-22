import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * React 18 peer-compatibility check (task-9 §12): the package declares
 * `react: ^18 || ^19`; the workspace tests run against React 19. This
 * fixture installs the PACKED package with React 18 from the registry
 * (isolated cache) and renders the provider through the React 18
 * react-dom entry — real cross-major evidence, not a peer-range string.
 */
const PKG_DIR = resolve(__dirname, "../..");
const CORE_DIR = resolve(__dirname, "../../../core");

describe("React 18 peer compatibility", () => {
	it("renders the provider under react@18 from a clean install", async () => {
		const packDir = mkdtempSync(join(tmpdir(), "prism-react-pack-"));
		const fixture = mkdtempSync(join(tmpdir(), "prism-react-fixture-"));
		const cleanup = (): void => {
			rmSync(packDir, { recursive: true, force: true });
			rmSync(fixture, { recursive: true, force: true });
		};
		try {
			if (!existsSync(join(PKG_DIR, "dist", "index.js"))) {
				execSync("npm run build", { cwd: PKG_DIR, stdio: "pipe" });
			}
			if (!existsSync(join(CORE_DIR, "dist", "index.js"))) {
				execSync("npm run build", { cwd: CORE_DIR, stdio: "pipe" });
			}
			const cache = "--cache " + join(fixture, ".npm-cache");
			const coreTarball = (
				JSON.parse(
					execSync(
						"npm pack --json " + cache + " --pack-destination " + packDir,
						{
							cwd: CORE_DIR,
							encoding: "utf8",
						},
					),
				) as Array<{ filename: string }>
			)[0];
			const reactTarball = (
				JSON.parse(
					execSync(
						"npm pack --json " + cache + " --pack-destination " + packDir,
						{
							cwd: PKG_DIR,
							encoding: "utf8",
						},
					),
				) as Array<{ filename: string }>
			)[0];
			if (!coreTarball || !reactTarball)
				throw new Error("npm pack produced no tarball");

			execSync(
				// --omit=dev: dev-only deps of the packed tarball (a test-scoped
				// reference to @prism-analytics/browser) must not be resolved from
				// the registry — the fixture installs the production surface.
				"npm install --no-audit --no-fund --ignore-scripts --omit=dev " +
					cache +
					" react@18 react-dom@18 " +
					join(packDir, coreTarball.filename) +
					" " +
					join(packDir, reactTarball.filename),
				{ cwd: fixture, stdio: "pipe" },
			);

			const requireFromFixture = createRequire(join(fixture, "package.json"));
			const reactVersion = (
				requireFromFixture("react/package.json") as { version: string }
			).version;
			expect(reactVersion.startsWith("18.")).toBe(true);

			// render through react-dom 18 with a REAL @prism-analytics/core client
			const React = requireFromFixture("react") as typeof import("react");
			const { createRoot } = requireFromFixture(
				"react-dom/client",
			) as typeof import("react-dom/client");
			const { PrismProvider } = requireFromFixture(
				"@prism-analytics/react",
			) as {
				PrismProvider: typeof import("../index").PrismProvider;
			};
			const { createPrismClient } = requireFromFixture(
				"@prism-analytics/core",
			) as typeof import("@prism-analytics/core");

			const client = await createPrismClient({
				sourceKey: "pr_0123456789abcdef0123456789abcdef",
				endpoint: "https://self-hosted.prism.example",
				runtime: {
					name: "node-fake",
					now: () => Date.now(),
					createId: () => "react18-id",
					transport: {
						post: async () => ({
							status: 200,
							headers: {},
							text: async () => "",
						}),
					},
					schedule: (delayMs: number, callback: () => void) => {
						const handle = setTimeout(callback, delayMs);
						return () => clearTimeout(handle);
					},
					context: { platform: "browser", kind: "web" },
				},
				collection: { initialState: "granted" },
			});

			const host = document.createElement("div");
			document.body.appendChild(host);
			const root = createRoot(host);
			const element = React.createElement(
				PrismProvider as unknown as React.ElementType,
				{ client },
				React.createElement("span", { id: "react18-child" }, "rendered"),
			);
			root.render(element);
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(document.getElementById("react18-child")?.textContent).toBe(
				"rendered",
			);
			root.unmount();
			await client.shutdown({ timeoutMs: 50 });
		} finally {
			cleanup();
		}
	}, 300_000);
});
