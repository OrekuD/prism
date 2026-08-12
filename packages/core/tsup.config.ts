import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  env: {
    // The v2 SDK never bakes a hosted URL into its build (ADR 0002 §6);
    // the v1 legacy default is a same-origin relative path.
  },
});
