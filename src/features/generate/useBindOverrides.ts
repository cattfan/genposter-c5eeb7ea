// Quản lý "bind tạm thời" cho trang Tạo nội dung.
// Không ghi vào DB; chỉ tồn tại trong React state.
//
// Trước đây file này có hook useBindOverrides + useEffectiveTemplate dùng bởi
// luồng "Generate theo entity" trong routes/generate.tsx. Luồng đó đã được
// gỡ trong Milestone A — giờ chỉ còn type BindOverrides + helper
// applyBindOverrides được dùng bởi usePackBindOverrides và templateState.
import type { PageTemplate } from "@/models";

export type BindOverrides = Record<string, string | undefined>; // slotId → bindingPath ("" = clear)

/** Trả về template mới có bindingPath đã merge với overrides (không mutate). */
export function applyBindOverrides(
  template: PageTemplate,
  overrides: BindOverrides,
): PageTemplate {
  if (!Object.keys(overrides).length) return template;
  return {
    ...template,
    slots: template.slots.map((s) => {
      if (!(s.slotId in overrides)) return s;
      const v = overrides[s.slotId];
      return { ...s, bindingPath: v ? v : undefined };
    }),
  };
}
