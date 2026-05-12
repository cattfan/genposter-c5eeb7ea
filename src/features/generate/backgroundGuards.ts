import type { PageTemplate, Slot } from "@/models";

export function isLikelyGeneratePageBackgroundSlot(
  slot: Slot,
  template: PageTemplate | undefined,
): boolean {
  if (slot.isUploadedBackground) return true;
  if (!template) return false;
  if (slot.kind !== "image" && !(slot.kind === "shape" && !!slot.staticImage)) return false;

  const canvasWidth = Math.max(1, template.canvas.width);
  const canvasHeight = Math.max(1, template.canvas.height);
  const canvasArea = canvasWidth * canvasHeight;
  const slotWidth = Math.max(0, slot.width);
  const slotHeight = Math.max(0, slot.height);
  const slotArea = slotWidth * slotHeight;
  const pageInsetX = canvasWidth * 0.08;
  const pageInsetY = canvasHeight * 0.08;

  const nearlyFullBleed =
    slot.x <= pageInsetX &&
    slot.y <= pageInsetY &&
    slot.x + slotWidth >= canvasWidth - pageInsetX &&
    slot.y + slotHeight >= canvasHeight - pageInsetY &&
    slotWidth >= canvasWidth * 0.72 &&
    slotHeight >= canvasHeight * 0.72;
  const coversMostOfPage = slotArea >= canvasArea * 0.58;
  const backgroundName = normalizeBackgroundName(slot.name);

  return backgroundName && nearlyFullBleed && coversMostOfPage;
}

function normalizeBackgroundName(value: string | undefined): boolean {
  const text = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    text.includes("background") ||
    text.includes("bg") ||
    text.includes("nen") ||
    text.includes("mood")
  );
}
