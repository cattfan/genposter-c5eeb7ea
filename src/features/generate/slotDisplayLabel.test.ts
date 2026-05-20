import { describe, expect, it } from "vitest";
import type { Slot } from "@/models";
import { buildTextSlotDisplayLabel, normalizeSlotDisplayLabel } from "./slotDisplayLabel";

const textSlot = (slot: Partial<Slot>): Slot => ({
  slotId: "slot-1",
  kind: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 24,
  ...slot,
});

describe("slot display labels", () => {
  it("uses the base textbox content when a bound preview slot has lost static text", () => {
    const boundSlot = textSlot({
      name: "Chữ",
      bindingPath: "entity.name",
    });
    const baseSlot = textSlot({
      slotId: "slot-1",
      name: "Chữ",
      staticText: "Tên quán",
    });

    expect(
      buildTextSlotDisplayLabel(boundSlot, 0, {
        baseSlot,
        bindingLabel: "Tên",
      }),
    ).toBe("Tên quán");
  });

  it("keeps a meaningful textbox name ahead of sample content", () => {
    expect(
      buildTextSlotDisplayLabel(
        textSlot({
          name: "Tên quán",
          staticText: "Mê Lá",
          bindingPath: "entity.name",
        }),
        0,
      ),
    ).toBe("Tên quán");
  });

  it("falls back to the binding label when no textbox context exists", () => {
    expect(
      buildTextSlotDisplayLabel(
        textSlot({
          bindingPath: "entity.address",
        }),
        1,
        { bindingLabel: "Địa chỉ" },
      ),
    ).toBe("Địa chỉ");
  });

  it("ignores generic layer names before using the fallback", () => {
    expect(normalizeSlotDisplayLabel("Text", "Chữ 3")).toBe("Chữ 3");
    expect(normalizeSlotDisplayLabel("Chữ", "Chữ 3")).toBe("Chữ 3");
  });
});
