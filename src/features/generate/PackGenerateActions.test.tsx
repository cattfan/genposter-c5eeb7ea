import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PackGenerateActions } from "./PackGenerateActions";

describe("PackGenerateActions", () => {
  it("does not render the global clear-all bindings action", () => {
    const html = renderToStaticMarkup(
      <PackGenerateActions
        canGenerate
        reason="Ready"
        hasEntities
        onGenerate={vi.fn()}
      />,
    );

    expect(html).toContain("Tạo bộ ảnh");
    expect(html).not.toContain("Xoá toàn bộ liên kết");
  });
});
