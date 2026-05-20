import { describe, expect, it } from "vitest";
import { runLiveQueryQuerier } from "./useLiveQuery";

describe("runLiveQueryQuerier", () => {
  it("retries a transient failure before resolving", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await runLiveQueryQuerier(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("backend warming up");
        return ["loaded"];
      },
      {
        maxAttempts: 3,
        retryDelayMs: () => 25,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toEqual(["loaded"]);
    expect(attempts).toBe(2);
    expect(delays).toEqual([25]);
  });
});
