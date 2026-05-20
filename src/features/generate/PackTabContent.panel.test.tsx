import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packTabContentSource = () =>
  readFileSync(
    fileURLToPath(new URL("./PackTabContent.tsx", import.meta.url)),
    "utf8",
  );

describe("PackTabContent data panel", () => {
  it("keeps selected-slot controls without rendering an overview tab", () => {
    const source = packTabContentSource();

    expect(source).toContain("Khối đang chọn");
    expect(source).not.toContain('value="overview"');
    expect(source).not.toContain("Tổng quan");
  });
});
