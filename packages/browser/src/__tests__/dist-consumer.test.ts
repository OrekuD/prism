import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Package-consumer smoke fixture (task-9 §11): the packed package is
 * installed into an isolated fixture and consumed through its PUBLIC
 * exports with an EXPLICIT self-hosted endpoint — no workspace
 * resolution, no compiled-in host.
 */
const PKG_DIR = resolve(__dirname, "../..");
const CORE_DIR = resolve(__dirname, "../../../core");

describe("packaged consumption", () => {
  it(
    "packs, installs, and runs against an explicit self-hosted endpoint",
    () => {
      const packDir = mkdtempSync(join(tmpdir(), "prism-browser-pack-"));
      const fixture = mkdtempSync(join(tmpdir(), "prism-browser-fixture-"));
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
        const cacheFlag = "--cache " + join(fixture, ".npm-cache");
        const corePackJson = execSync(
          "npm pack --json " + cacheFlag + " --pack-destination " + packDir,
          { cwd: CORE_DIR, encoding: "utf8" },
        );
        const coreTarball = (JSON.parse(corePackJson) as Array<{ filename: string }>)[0];
        const packJson = execSync(
          "npm pack --json " + cacheFlag + " --pack-destination " + packDir,
          { cwd: PKG_DIR, encoding: "utf8" },
        );
        const packed = JSON.parse(packJson) as Array<{ filename: string }>;
        if (packed.length === 0 || !coreTarball) throw new Error("npm pack produced no tarball");
        execSync(
          "npm install --no-audit --no-fund --ignore-scripts " +
            cacheFlag +
            " " +
            join(packDir, coreTarball.filename) +
            " " +
            join(packDir, packed[0]?.filename ?? ""),
          { cwd: fixture, stdio: "pipe" },
        );
        const pkg = JSON.parse(
          readFileSync(join(fixture, "node_modules", "@prism-analytics", "browser", "package.json"), "utf8"),
        ) as { name: string };
        expect(pkg.name).toBe("@prism-analytics/browser");

        const requireFromFixture = createRequire(join(fixture, "package.json"));
        const installed = requireFromFixture("@prism-analytics/browser") as {
          createBrowserClient: (options: unknown) => Promise<{
            track: (name: string) => { status: string };
            flush: () => Promise<void>;
            shutdown: () => Promise<void>;
          }>;
          capturePageContext: () => { path: string; referrer: string | null };
        };
        expect(typeof installed.createBrowserClient).toBe("function");
        expect(typeof installed.capturePageContext).toBe("function");

        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
          Promise.resolve(
            new Response("", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        );
        return installed
          .createBrowserClient({
            sourceKey: "psk_0123456789abcdef0123456789abcdef",
            endpoint: "https://self-hosted.prism.example",
            collection: { initialState: "granted" },
          })
          .then(async (prism) => {
            expect(prism.track("from_installed_package").status).toBe("queued");
            await prism.flush();
            const [url] = fetchMock.mock.calls[0] ?? [];
            expect(String(url)).toBe("https://self-hosted.prism.example/api/v2/ingest");
            await prism.shutdown();
          });
      } finally {
        cleanup();
      }
    },
    120_000,
  );
});
