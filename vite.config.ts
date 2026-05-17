// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { createDataImagesMiddleware } from "./src/server/dataImageStorage";

function dataImagesPlugin(): Plugin {
  const middleware = createDataImagesMiddleware();

  return {
    name: "genposter-data-images",
    enforce: "pre",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [dataImagesPlugin()],
    server: {
      host: "0.0.0.0",
      port: 9090,
      strictPort: true,
      proxy: {
        // Mọi request /api/* được forward tới backend NestJS port 3001 (dev).
        // Frontend không cần biết URL backend, gọi relative /api/v1/...
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
        // WebSocket /ws cho realtime sync giữa các tab/browser. Vite tự forward
        // upgrade request khi `ws: true`.
        "/ws": {
          target: "ws://localhost:3001",
          ws: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 9090,
      strictPort: true,
    },
  },
});
