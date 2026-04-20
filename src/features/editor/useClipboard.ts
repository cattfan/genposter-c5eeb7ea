// Clipboard nội bộ cho editor (in-memory module-level singleton).
// Dùng cho Copy / Cut / Paste 1 slot. Paste sẽ offset (+24, +24) và sinh slotId mới.

import { nanoid } from "nanoid";
import type { Slot } from "@/models";

let buffer: Slot | null = null;

export function setClipboard(slot: Slot | null) {
  buffer = slot ? (JSON.parse(JSON.stringify(slot)) as Slot) : null;
}

export function getClipboard(): Slot | null {
  return buffer ? (JSON.parse(JSON.stringify(buffer)) as Slot) : null;
}

export function hasClipboard(): boolean {
  return buffer !== null;
}

// Tạo bản sao mới với id mới + offset
export function pasteFromClipboard(offset = 24): Slot | null {
  const src = getClipboard();
  if (!src) return null;
  return {
    ...src,
    slotId: nanoid(),
    x: src.x + offset,
    y: src.y + offset,
    isUploadedBackground: false, // bản sao không phải nền nữa
  };
}
