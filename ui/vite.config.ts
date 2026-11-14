import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The engine serves ui/dist from http://127.0.0.1:<port>/, so asset paths stay relative.
// Dev: set SF_ENGINE (e.g. http://127.0.0.1:8765) and SF_TOKEN to proxy /api to a running engine.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: process.env.SF_ENGINE
      ? { "/api": { target: process.env.SF_ENGINE, headers: { "X-Sensfinder-Token": process.env.SF_TOKEN ?? "" } } }
      : undefined,
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    setupFiles: ["src/tests/setup.ts"],
    include: ["src/tests/**/*.test.{ts,tsx}"],
  },
});
