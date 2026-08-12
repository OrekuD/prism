import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        // CLI entrypoints — thin wrappers over the tested functions; they
        // spawn subprocesses by design.
        "src/database/migrate.ts",
        "src/database/reset.ts",
      ],
      // Initial enforceable threshold; grows toward the project-wide 80%
      // goal as integration coverage lands. See engineering/coverage.md.
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 70,
      },
    },
  },
});
