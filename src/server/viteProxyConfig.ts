import type { ProxyOptions } from "vite";

const BACKEND_HTTP_TARGET = "http://127.0.0.1:3001";
const BACKEND_WS_TARGET = "ws://127.0.0.1:3001";

export function createLocalBackendProxy(): Record<string, ProxyOptions> {
  return {
    "/api": {
      target: BACKEND_HTTP_TARGET,
      changeOrigin: true,
    },
    "/ws": {
      target: BACKEND_WS_TARGET,
      ws: true,
    },
  };
}
