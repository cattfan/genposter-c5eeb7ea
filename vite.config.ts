// @lovable.dev/vite-tanstack-config already includes the following. Do not add
// them manually or the app will break with duplicate plugins:
// - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only)
// - componentTagger (dev-only), VITE_* env injection, @ path alias
// - React/TanStack dedupe, error logger plugins, and sandbox detection
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { createDataImagesMiddleware } from "./src/server/dataImageStorage";
import { createLocalBackendProxy } from "./src/server/viteProxyConfig";

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
      proxy: createLocalBackendProxy(),
    },
    preview: {
      host: "0.0.0.0",
      port: 9090,
      strictPort: true,
      proxy: createLocalBackendProxy(),
    },
  },
});
