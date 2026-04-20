// Quản lý "bind tạm thời" cho trang Tạo nội dung.
// Không ghi vào DB; chỉ tồn tại trong React state.
import { useCallback, useMemo, useState } from "react";
import type { PageTemplate } from "@/models";

export type BindOverrides = Record<string, string | undefined>; // slotId → bindingPath ("" = clear)

export function useBindOverrides() {
  const [overrides, setOverrides] = useState<BindOverrides>({});

  const setBinding = useCallback((slotId: string, bindingPath: string | undefined) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (!bindingPath) next[slotId] = ""; // đánh dấu đã chủ động xoá liên kết
      else next[slotId] = bindingPath;
      return next;
    });
  }, []);

  const clearBinding = useCallback((slotId: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setOverrides({}), []);

  return { overrides, setBinding, clearBinding, resetAll };
}

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

/** Số block đã bind sau khi merge overrides. */
export function useEffectiveTemplate(template: PageTemplate | undefined, overrides: BindOverrides) {
  return useMemo(() => (template ? applyBindOverrides(template, overrides) : undefined), [template, overrides]);
}
