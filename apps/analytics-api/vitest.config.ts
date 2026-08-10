import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/database/**", // setup script that requires a live Turso database
      ],
      // Initial enforceable threshold; grows toward the project-wide 80%
      // goal as integration coverage lands. See docs/coverage.md.
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 70,
      },
    },
  },
});
