// Pure helpers cho MappingOverview — tách ra file riêng để file component
// MappingOverview.tsx chỉ export component (giúp react-refresh fast refresh).

import {
  ENTITY_FIELDS,
  type EntityFieldDefinition,
  lookupByBindingPath,
} from "@/engines/normalize/fieldRegistry";
import {
  ENTITY_LIST_BINDING_PREFIX,
  ENTITY_COMPOSE_BINDING_PREFIX,
  getEntityScopedTextBindingBasePath,
} from "@/engines/binding/dataBinding";
import type { Entity, PageTemplate, Slot } from "@/models";

export interface MappingRow {
  field: EntityFieldDefinition;
  /** Có entity nào trong sheet đang chứa giá trị cho trường này không? */
  hasDataInSheet: boolean;
  /** Slot đã bind vào field này (kèm tên slot). Có thể nhiều hơn 1. */
  boundSlots: Array<{ slotId: string; slotName: string }>;
  /** Slot có placeholder khớp ({{name_0}}) nhưng chưa bind. */
  placeholderSlots: Array<{ slotId: string; slotName: string }>;
}

export interface MappingOverviewSummary {
  rows: MappingRow[];
  /** Số field có data trong sheet. */
  fieldsWithData: number;
  /** Số field có data trong sheet VÀ đã bind ít nhất 1 slot. */
  fieldsBound: number;
  /** Có ít nhất 1 slot dạng "{{X_0}}" chưa bind không? */
  hasUnboundPlaceholders: boolean;
}

/**
 * Lấy bindingPath chuẩn từ slot (resolve scoped/list/compose -> basePath).
 * Trả về null nếu slot không bind text/image vào entity (e.g. ai.rewrite,
 * asset.cover, asset.random).
 */
export function resolveSlotEntityFieldPath(slot: Slot): string | null {
  const path = slot.bindingPath;
  if (!path) return null;
  if (path === "ai.rewrite") return null;
  if (path.startsWith("asset.")) return null;
  if (path.startsWith(ENTITY_LIST_BINDING_PREFIX)) return null;
  if (path.startsWith(ENTITY_COMPOSE_BINDING_PREFIX)) return null;
  return getEntityScopedTextBindingBasePath(path);
}

/** Match staticText "{{name_0}}" -> "name". Không kèm "{{}}" trong return. */
function extractPlaceholderToken(staticText: string | undefined): string | null {
  if (!staticText) return null;
  const trimmed = staticText.trim();
  const match = trimmed.match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}$/);
  if (!match) return null;
  return match[1].toLowerCase().replace(/_\d+$/u, "");
}

function slotDisplayName(slot: Slot, fallback: string): string {
  return slot.name?.trim() || slot.staticText?.trim().slice(0, 32) || fallback;
}

export function buildMappingOverview(
  template: PageTemplate | undefined,
  entitiesInSheet: Entity[],
): MappingOverviewSummary {
  if (!template) {
    return { rows: [], fieldsWithData: 0, fieldsBound: 0, hasUnboundPlaceholders: false };
  }

  const boundByFieldId = new Map<string, Array<{ slotId: string; slotName: string }>>();
  const placeholderByFieldId = new Map<string, Array<{ slotId: string; slotName: string }>>();

  template.slots.forEach((slot, index) => {
    const fallbackName = `Khối ${index + 1}`;
    const slotEntry = { slotId: slot.slotId, slotName: slotDisplayName(slot, fallbackName) };

    const boundPath = resolveSlotEntityFieldPath(slot);
    if (boundPath) {
      const field = lookupByBindingPath(boundPath);
      if (field) {
        const bucket = boundByFieldId.get(field.id) ?? [];
        bucket.push(slotEntry);
        boundByFieldId.set(field.id, bucket);
      }
    }

    if (!slot.bindingPath) {
      const token = extractPlaceholderToken(slot.staticText);
      if (token) {
        const field = ENTITY_FIELDS.find((entry) =>
          entry.placeholderTokens.some((t) => t.toLowerCase() === token),
        );
        if (field) {
          const bucket = placeholderByFieldId.get(field.id) ?? [];
          bucket.push(slotEntry);
          placeholderByFieldId.set(field.id, bucket);
        }
      }
    }
  });

  const fieldsWithDataIds = new Set<string>();
  for (const field of ENTITY_FIELDS) {
    if (field.placeholderTokens.length === 0) continue;
    const has = entitiesInSheet.some((entity) => {
      if (field.storedInMetadata) {
        const value = entity.metadata?.[field.id];
        return value != null && String(value).trim().length > 0;
      }
      const value = (entity as unknown as Record<string, unknown>)[field.id];
      if (value == null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return String(value).trim().length > 0;
    });
    if (has) fieldsWithDataIds.add(field.id);
  }

  const rows: MappingRow[] = ENTITY_FIELDS.filter((field) => field.placeholderTokens.length > 0).map(
    (field) => ({
      field,
      hasDataInSheet: fieldsWithDataIds.has(field.id),
      boundSlots: boundByFieldId.get(field.id) ?? [],
      placeholderSlots: placeholderByFieldId.get(field.id) ?? [],
    }),
  );

  const fieldsWithData = rows.filter((row) => row.hasDataInSheet).length;
  const fieldsBound = rows.filter(
    (row) => row.hasDataInSheet && row.boundSlots.length > 0,
  ).length;
  const hasUnboundPlaceholders = rows.some(
    (row) => row.placeholderSlots.length > 0 && row.boundSlots.length === 0,
  );

  return { rows, fieldsWithData, fieldsBound, hasUnboundPlaceholders };
}
