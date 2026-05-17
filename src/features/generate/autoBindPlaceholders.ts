// Auto-bind placeholder tokens trong staticText sang bindingPath để fix bug
// "trùng dữ liệu chỉ tên đối tác đổi". Khi AI sinh template (templateFromImage.ts),
// các slot text được gán staticText: "{{name_0}}", "{{address_0}}",... nhưng KHÔNG
// set bindingPath. Khi user vào workspace generate, chỉ những slot có bindingPath
// mới được đổ dữ liệu — slot còn lại render staticText cố định, dẫn đến mọi page
// hiển thị giống nhau, chỉ khác slot tên.
//
// Hàm autoBindPlaceholders quét template, suy ra bindingPath từ token placeholder
// và set vào slot. Giữ staticText nguyên (làm fallback hiển thị editor / khi entity
// thiếu trường tương ứng).
//
// Map placeholder->binding sống trong fieldRegistry.ENTITY_FIELDS — file này
// chỉ phụ trách matching pattern "{{token}}" và áp vào slot.

import type { PageTemplate, Slot } from "@/models";
import { lookupByPlaceholder } from "@/engines/normalize/fieldRegistry";

/** Strip "{{" "}}", lấy token chính. KHÔNG strip "_<n>" vì lookupByPlaceholder tự xử lý. */
function extractPlaceholderToken(staticText: string | undefined): string | null {
  if (!staticText) return null;
  const trimmed = staticText.trim();
  // Match đúng dạng "{{token}}" hoặc "{{token_0}}" — KHÔNG match câu chứa nhiều placeholder.
  const match = trimmed.match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}$/);
  return match?.[1] ?? null;
}

export interface AutoBindResult {
  template: PageTemplate;
  changedSlotIds: string[];
}

/**
 * Quét template, set bindingPath cho slot text có staticText dạng "{{token}}" hoặc
 * "{{token_<n>}}" mà chưa có bindingPath. Trả về template MỚI nếu có thay đổi
 * (không mutate input), hoặc cùng tham chiếu nếu không có gì đổi.
 */
export function autoBindPlaceholders(template: PageTemplate): AutoBindResult {
  const changedSlotIds: string[] = [];
  const nextSlots: Slot[] = template.slots.map((slot) => {
    if (slot.bindingPath) return slot;
    if (slot.kind !== "text" && slot.kind !== "shape") return slot;
    const token = extractPlaceholderToken(slot.staticText);
    if (!token) return slot;
    const field = lookupByPlaceholder(token);
    if (!field) return slot;
    changedSlotIds.push(slot.slotId);
    return { ...slot, bindingPath: field.bindingPath };
  });

  if (changedSlotIds.length === 0) {
    return { template, changedSlotIds: [] };
  }

  return {
    template: { ...template, slots: nextSlots, updatedAt: Date.now() },
    changedSlotIds,
  };
}

/**
 * Áp autoBindPlaceholders cho nhiều template, trả về map mới chỉ chứa template
 * thực sự đổi (giảm re-render khi không cần).
 */
export function autoBindPlaceholdersForDrafts(
  drafts: Record<string, PageTemplate>,
): { drafts: Record<string, PageTemplate>; totalChanged: number } {
  let totalChanged = 0;
  const next: Record<string, PageTemplate> = { ...drafts };
  for (const [pageId, template] of Object.entries(drafts)) {
    const result = autoBindPlaceholders(template);
    if (result.changedSlotIds.length > 0) {
      next[pageId] = result.template;
      totalChanged += result.changedSlotIds.length;
    }
  }
  return { drafts: next, totalChanged };
}
