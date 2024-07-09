import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  env: {
    API_URL: process.env.API_URL!,
  },
});
