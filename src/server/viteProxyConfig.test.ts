import { describe, expect, it } from "vitest";
import { createLocalBackendProxy } from "./viteProxyConfig";

describe("createLocalBackendProxy", () => {
  it("uses IPv4 loopback for API and websocket proxies", () => {
    const proxy = createLocalBackendProxy();

    expect(proxy["/api"]).toMatchObject({
      target: "http://127.0.0.1:3001",
      changeOrigin: true,
    });
    expect(proxy["/ws"]).toMatchObject({
      target: "ws://127.0.0.1:3001",
      ws: true,
    });
    expect(JSON.stringify(proxy)).not.toContain("localhost:3001");
  });
});
