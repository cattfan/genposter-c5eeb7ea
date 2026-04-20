// Quản lý bind override per-page-template cho luồng pack-bind theo entity.
// Map<pageTemplateId, Record<slotId, bindingPath | undefined>>
import { useCallback, useMemo, useState } from "react";
import type { PageTemplate } from "@/models";
import { applyBindOverrides, type BindOverrides } from "./useBindOverrides";

export type PackBindOverrides = Record<string, BindOverrides>; // pageTemplateId → slotId → path

export function usePackBindOverrides() {
  const [all, setAll] = useState<PackBindOverrides>({});

  const setBinding = useCallback(
    (pageTemplateId: string, slotId: string, bindingPath: string | undefined) => {
      setAll((prev) => {
        const cur = { ...(prev[pageTemplateId] ?? {}) };
        if (!bindingPath) cur[slotId] = "";
        else cur[slotId] = bindingPath;
        return { ...prev, [pageTemplateId]: cur };
      });
    },
    [],
  );

  const clearBinding = useCallback((pageTemplateId: string, slotId: string) => {
    setAll((prev) => {
      const cur = { ...(prev[pageTemplateId] ?? {}) };
      delete cur[slotId];
      return { ...prev, [pageTemplateId]: cur };
    });
  }, []);

  const resetPage = useCallback((pageTemplateId: string) => {
    setAll((prev) => {
      const next = { ...prev };
      delete next[pageTemplateId];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setAll({}), []);

  const replacePage = useCallback((pageTemplateId: string, ov: BindOverrides) => {
    setAll((prev) => ({ ...prev, [pageTemplateId]: { ...ov } }));
  }, []);

  return { all, setBinding, clearBinding, resetPage, resetAll, replacePage };
}

/** Áp override cho 1 page template cụ thể. */
export function applyPackOverridesToTemplate(
  template: PageTemplate,
  packOv: PackBindOverrides,
): PageTemplate {
  const ov = packOv[template.pageTemplateId];
  if (!ov) return template;
  return applyBindOverrides(template, ov);
}

export function usePackEffectiveTemplate(
  template: PageTemplate | undefined,
  packOv: PackBindOverrides,
) {
  return useMemo(
    () => (template ? applyPackOverridesToTemplate(template, packOv) : undefined),
    [template, packOv],
  );
}
