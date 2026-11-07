import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: "node-server",
    }),
    viteReact(),
  ],
  build: {
    sourcemap: process.env.ENVIRONMENT === "development" || process.env.ENVIRONMENT === "test",
  },
  server: {
    watch: { usePolling: true },
  },
  // Native module used only on the server. Without this the dependency
  // optimizer scans it with browser conditions and fails to resolve its
  // wasm fallback.
  optimizeDeps: {
    exclude: ["@node-rs/argon2"],
    // Vite finds these only when the first page is requested. Each discovery
    // bundles the dependencies again and reloads the page, and requests that are
    // in flight fail. Listing them makes Vite bundle them at startup. This is the
    // list Vite prints as "new dependencies optimized" on a fresh container, so
    // if that line appears again after an upgrade, add what it names.
    include: [
      "@tanstack/history",
      "@tanstack/router-core",
      "@tanstack/router-core/ssr/client",
      "@tanstack/router-core/ssr/server",
      "h3-v2",
      "seroval",
      "tiny-invariant",
    ],
  },
});

export default config;
