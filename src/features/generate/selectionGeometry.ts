import type { Slot } from "@/models";

export function isSlotInsideSelectionContainer(container: Slot, item: Slot): boolean {
  return (
    item.x >= container.x &&
    item.y >= container.y &&
    item.x + item.width <= container.x + container.width &&
    item.y + item.height <= container.y + container.height
  );
}
