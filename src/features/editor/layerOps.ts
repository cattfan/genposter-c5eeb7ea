// Z-order operations for slots.
// We sort the slots array by current zIndex (asc), find the target,
// move it within that ordered list, then re-write zIndex 0..N so values
// stay normalized and never accumulate.
//
// IMPORTANT: ảnh upload từ máy (isUploadedBackground) luôn nằm dưới cùng.
// Các phép order chỉ áp dụng cho block "thường" (non-background).

import type { Slot } from "@/models";

function splitBgVsNormal(slots: Slot[]) {
  const bg = slots.filter((s) => s.isUploadedBackground);
  const normal = slots.filter((s) => !s.isUploadedBackground);
  return { bg, normal };
}

function normalize(bg: Slot[], normalSorted: Slot[]): Slot[] {
  // Background luôn ở đáy (zIndex 0..bg.length-1)
  const out: Slot[] = [];
  bg.forEach((s, i) => out.push({ ...s, zIndex: i }));
  normalSorted.forEach((s, i) => out.push({ ...s, zIndex: bg.length + i }));
  return out;
}

function moveInList(list: Slot[], id: string, mode: "up" | "down" | "top" | "bottom"): Slot[] {
  const idx = list.findIndex((s) => s.slotId === id);
  if (idx === -1) return list;
  const next = list.slice();
  const [item] = next.splice(idx, 1);
  if (mode === "top") next.push(item);
  else if (mode === "bottom") next.unshift(item);
  else if (mode === "up") next.splice(Math.min(next.length, idx + 1), 0, item);
  else next.splice(Math.max(0, idx - 1), 0, item);
  return next;
}

function applyOrder(slots: Slot[], id: string, mode: "up" | "down" | "top" | "bottom"): Slot[] {
  const target = slots.find((s) => s.slotId === id);
  if (!target || target.isUploadedBackground) return slots; // không re-order layer nền
  const { bg, normal } = splitBgVsNormal(slots);
  const sorted = normal.slice().sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const moved = moveInList(sorted, id, mode);
  return normalize(bg, moved);
}

export function bringForward(slots: Slot[], id: string): Slot[] {
  return applyOrder(slots, id, "up");
}
export function sendBackward(slots: Slot[], id: string): Slot[] {
  return applyOrder(slots, id, "down");
}
export function bringToFront(slots: Slot[], id: string): Slot[] {
  return applyOrder(slots, id, "top");
}
export function sendToBack(slots: Slot[], id: string): Slot[] {
  return applyOrder(slots, id, "bottom");
}

// Đảo thứ tự giữa nhiều layer trong panel (drag-reorder).
// `orderedIds` là thứ tự hiển thị TỪ TRÊN XUỐNG trong panel Layers
// (tức zIndex cao → zIndex thấp). Bg luôn giữ ở đáy.
export function reorderByPanel(slots: Slot[], orderedIdsTopFirst: string[]): Slot[] {
  const { bg, normal } = splitBgVsNormal(slots);
  const map = new Map(normal.map((s) => [s.slotId, s]));
  // Đảo thành "bottom-first" để khớp với chiều zIndex tăng
  const bottomFirst = orderedIdsTopFirst
    .slice()
    .reverse()
    .map((id) => map.get(id))
    .filter((s): s is Slot => !!s);
  // Thêm bất kỳ slot nào bị thiếu (an toàn) ở cuối (top)
  for (const s of normal) if (!orderedIdsTopFirst.includes(s.slotId)) bottomFirst.push(s);
  return normalize(bg, bottomFirst);
}

// Suy ra tên layer khi user chưa đặt tên thủ công.
export function inferLayerName(slot: Slot): string {
  if (slot.name && slot.name.trim()) return slot.name;
  if (slot.kind === "text") {
    const t = (slot.staticText ?? "").trim();
    return t ? `Text · ${t.slice(0, 22)}` : "Text";
  }
  if (slot.kind === "image") {
    if (slot.isUploadedBackground) return "Ảnh nền (upload)";
    return slot.staticImage ? "Image" : "Image (placeholder)";
  }
  if (slot.kind === "shape") {
    const k = slot.shapeKind ?? "rectangle";
    const map: Record<string, string> = {
      rectangle: "Vuông",
      circle: "Tròn",
      triangle: "Tam giác",
      line: "Đường kẻ",
      divider: "Divider",
      badge: "Badge",
    };
    return `Shape · ${map[k] ?? k}`;
  }
  if (slot.kind === "section") return "Section";
  return slot.kind;
}
