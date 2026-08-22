import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: [
        "src/__tests__/**",
        "src/models/**", // type-only definitions
        "src/types/**", // type definitions
        "src/database/**", // scripts that require live databases
        "src/index.ts", // worker bootstrap; covered by the E2E smoke script
      ],
      // Initial enforceable threshold; grows toward the project-wide 80%
      // goal as integration coverage lands. See engineering/coverage.md.
      thresholds: {
        lines: 30,
        functions: 25,
        statements: 30,
        branches: 55,
      },
    },
  },
});
