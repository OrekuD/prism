import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.PORT || "5173", 10),
    strictPort: false,
    // Portless serves the dashboard at https://prism.localhost. Keep auth,
    // analytics reads, and realtime on that browser origin so SameSite=Lax
    // session cookies remain valid in development, matching production's
    // single-origin reverse proxy.
    proxy: {
      "/api/v2/ingest": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/api/v1/analytics": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(configDirectory, "./src"),
    },
  },
});
