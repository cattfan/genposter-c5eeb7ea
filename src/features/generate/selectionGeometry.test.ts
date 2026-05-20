import { describe, expect, it } from "vitest";
import type { Slot } from "@/models";
import { isSlotInsideSelectionContainer } from "./selectionGeometry";

function slot(partial: Partial<Slot>): Slot {
  return {
    slotId: partial.slotId ?? "slot",
    kind: partial.kind ?? "image",
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 100,
    height: partial.height ?? 100,
    ...partial,
  };
}

describe("isSlotInsideSelectionContainer", () => {
  it("does not treat a full-page background as part of a small selected group", () => {
    const group = slot({
      slotId: "group",
      kind: "group",
      x: 87,
      y: 1044.89,
      width: 1414,
      height: 293,
    });
    const fullPageBackground = slot({
      slotId: "background",
      kind: "image",
      x: 0,
      y: 0,
      width: 1588,
      height: 2248,
    });
    const imageChild = slot({
      slotId: "image-child",
      kind: "image",
      x: 87,
      y: 1044.89,
      width: 345,
      height: 293,
    });

    expect(isSlotInsideSelectionContainer(group, fullPageBackground)).toBe(false);
    expect(isSlotInsideSelectionContainer(group, imageChild)).toBe(true);
  });
});
