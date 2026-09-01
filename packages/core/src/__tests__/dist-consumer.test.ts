import { execSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Clean installed-package consumption test (task-9 slice 3, correction
 * round): the package is packed (npm pack), installed into an isolated
 * temp fixture with no workspace resolution, and consumed through its
 * package metadata (exports map, main/module/types). This catches
 * packaging defects that workspace imports cannot.
 */

const CORE_DIR = resolve(__dirname, "../..");
const ROOT = resolve(__dirname, "../../../..");
/** Track package.json — never hardcode the version here. */
const CORE_VERSION = JSON.parse(
	readFileSync(join(CORE_DIR, "package.json"), "utf8"),
).version as string;

function packAndInstallFixture(): { fixture: string; cleanup(): void } {
	const packDir = mkdtempSync(join(tmpdir(), "prism-core-pack-"));
	const fixture = mkdtempSync(join(tmpdir(), "prism-core-fixture-"));
	// Hermetic npm cache (review F14): the test owns a temporary cache and
	// never depends on — or modifies — the operator's global npm state.
	const cacheDir = join(fixture, ".npm-cache");
	const cleanup = (): void => {
		rmSync(packDir, { recursive: true, force: true });
		rmSync(fixture, { recursive: true, force: true });
	};
	try {
		// build the artifact if absent (CI builds before testing)
		if (!existsSync(join(CORE_DIR, "dist", "index.js"))) {
			execSync("npm run build", { cwd: CORE_DIR, stdio: "pipe" });
		}
		const packJson = execSync(
			"npm pack --json --cache " + cacheDir + " --pack-destination " + packDir,
			{ cwd: CORE_DIR, encoding: "utf8" },
		);
		const packed = JSON.parse(packJson) as Array<{
			filename: string;
			name: string;
			version: string;
		}>;
		if (packed.length === 0) throw new Error("npm pack produced no tarball");
		const tarball = packed[0] as {
			filename: string;
			name: string;
			version: string;
		};
		expect(tarball.name).toBe("@prism-analytics/core");
		expect(tarball.version).toBe(CORE_VERSION);
		execSync(
			"npm install --no-audit --no-fund --ignore-scripts --cache " +
				cacheDir +
				" " +
				join(packDir, tarball.filename),
			{ cwd: fixture, stdio: "pipe" },
		);
		return { fixture, cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}

describe("clean installed-package consumption", () => {
	it("packs, installs, and consumes @prism-analytics/core through its package metadata", () => {
		const { fixture, cleanup } = packAndInstallFixture();
		try {
			const pkg = JSON.parse(
				readFileSync(
					join(
						fixture,
						"node_modules",
						"@prism-analytics",
						"core",
						"package.json",
					),
					"utf8",
				),
			) as {
				name: string;
				version: string;
				main: string;
				module: string;
				types: string;
				exports?: Record<string, unknown>;
				files?: string[];
			};
			// package metadata is intact after the install
			expect(pkg.name).toBe("@prism-analytics/core");
			expect(pkg.main).toBe("./dist/index.js");
			expect(pkg.module).toBe("./dist/index.mjs");
			expect(pkg.types).toBe("./dist/index.d.ts");
			expect(pkg.files).toEqual(["dist"]);
			expect(pkg.exports?.["."]).toBeDefined();

			// require() resolves through the exports map (or main fallback)
			const requireFromFixture = createRequire(join(fixture, "package.json"));
			const installed = requireFromFixture("@prism-analytics/core") as {
				createPrismClient: (options: unknown) => Promise<{
					track: (
						name: string,
						properties?: Record<string, unknown>,
					) => { status: string };
					shutdown: (options?: { timeoutMs?: number }) => Promise<void>;
				}>;
			};
			expect(typeof installed.createPrismClient).toBe("function");

			// the installed artifact actually works
			const runtime = {
				name: "node-fake",
				now: () => Date.now(),
				createId: () => `dist-id-${Math.random().toString(36).slice(2)}`,
				transport: {
					post: async () => ({
						status: 200,
						headers: {} as Record<string, string>,
						text: async () => "",
					}),
				},
				schedule: (delayMs: number, callback: () => void) => {
					const handle = setTimeout(callback, delayMs);
					return () => clearTimeout(handle);
				},
				context: { platform: "node", kind: "server" },
			};
			return installed
				.createPrismClient({
					sourceKey: "pr_0123456789abcdef0123456789abcdef",
					endpoint: "https://analytics.example.com",
					runtime,
					collection: { initialState: "granted" },
				})
				.then(async (prism) => {
					expect(prism.track("from_installed_package").status).toBe("queued");
					await prism.shutdown({ timeoutMs: 100 });
				});
		} finally {
			cleanup();
		}
	}, 120_000);

	it("stays within the bundle budget", () => {
		// Baseline budget for the dependency-free core (ADR 0002 §7): the full
		// runtime in one file. CI fails if the bundle outgrows the budget.
		// 70 KiB: task-10 review fixes (identity-state persistence, kind-aware
		// queue validation, guarded delivery) added ~5 KiB of runtime code.
		// 100 KiB: task-15 slice 3 adds the SEPARATE error-reporting lane
		// (bounded queue, batch delivery, retry classification, beforeSend +
		// diagnostics) ~21 KiB of runtime code. ESM consumers tree-shake it
		// when they only use the analytics client; this CJS guard keeps both
		// entry points from runaway growth.
		// 112 KiB: task-17 slice 1 adds the reserved page-view contract
		// (frozen property schema, strict validator, viewport buckets) shared
		// by Core, Browser, and ingestion — ~6 KiB of runtime code.
		// 165 KiB: task-19 slice 1 adds the frozen 25-event Standard Event
		// catalog (registry, 25 exact data validators, wire-wrapper validator,
		// typed input interfaces) shared by Core/SDKs, ingestion, and product
		// API — ~31 KiB of runtime + type code; ESM consumers tree-shake
		// unused validators while the CJS guard prevents runaway growth.
		const dist = join(CORE_DIR, "dist", "index.js");
		expect(existsSync(dist)).toBe(true);
		expect(statSync(dist).size).toBeLessThan(165 * 1024);
	});
});
