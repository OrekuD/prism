import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/contract.ts", // frozen declarations — covered by the contract tests' assertions
        "src/index.ts", // re-export surface
      ],
      // Task-9 gate: changed code at the 80% project-wide goal. The v2 core
      // (core/queue/validation) is fully unit-tested; the legacy v1 files
      // are excluded until they are removed.
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
