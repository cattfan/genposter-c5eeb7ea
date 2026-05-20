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
  boundSlots: Array<{ slotId: string; slotName: string; dataGroupId?: string; groupId?: string }>;
  /** Slot có placeholder khớp ({{name_0}}) nhưng chưa bind. */
  placeholderSlots: Array<{ slotId: string; slotName: string }>;
  /**
   * Trường tự do từ metadata sheet — không nằm trong fieldRegistry chuẩn.
   * UI render group này dưới các field chuẩn để user vẫn map được.
   */
  isFreeMetadata?: boolean;
  /**
   * `true` nếu field đang bị bind bởi >=2 slot KHÔNG cùng `dataGroupId` —
   * sẽ render entity khác nhau giữa các slot và tạo content lệch (gốc bug
   * "trùng dữ liệu chỉ tên đối tác đổi"). UI hiển thị cảnh báo + gợi ý
   * "Nhóm dữ liệu" khi cờ này bật.
   */
  duplicateUnGrouped?: boolean;
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
  // Ưu tiên slot.name (designer thường rename layer có nghĩa) → staticText
  // (đoạn text mẫu) → fallback do caller gán dựa trên slotId hash. KHÔNG dùng
  // index theo thứ tự template vì nhiều slot không có name sẽ trùng "Khối 2".
  return slot.name?.trim() || slot.staticText?.trim().slice(0, 32) || fallback;
}

/**
 * Trả về `true` nếu danh sách slot bound chứa >=2 phần tử KHÔNG cùng
 * dataGroupId. Khi 2 slot khác nhóm cùng bind 1 field, generator sẽ chọn
 * entity ngẫu nhiên cho mỗi slot → content lệch giữa các khối.
 */
function hasDuplicateUngrouped(
  boundSlots: ReadonlyArray<{ slotId: string; dataGroupId?: string; groupId?: string }>,
): boolean {
  if (boundSlots.length < 2) return false;
  const groupIds = boundSlots.map((slot) => slot.dataGroupId ?? slot.groupId);
  const grouped = groupIds.filter((id): id is string => !!id);
  // Nếu mọi slot có dataGroupId chung -> đã nhóm hợp lệ.
  if (grouped.length === boundSlots.length) {
    return false;
  }
  // Có ít nhất 1 slot chưa nhóm.
  return true;
}

export function buildMappingOverview(
  template: PageTemplate | undefined,
  entitiesInSheet: Entity[],
): MappingOverviewSummary {
  if (!template) {
    return { rows: [], fieldsWithData: 0, fieldsBound: 0, hasUnboundPlaceholders: false };
  }

  // Defensive: ngữ nghĩa "trường có data trong sheet" = sheet thực sự có entity
  // active mang giá trị. KHÔNG bao gồm entity đã archived. Caller có thể đẩy
  // entities chưa filter (vd: globalAvailableEntities) — ta tự làm sạch ở đây.
  const activeEntities = entitiesInSheet.filter((entity) => entity.status === "active");

  const boundByFieldId = new Map<
    string,
    Array<{ slotId: string; slotName: string; dataGroupId?: string; groupId?: string }>
  >();
  const placeholderByFieldId = new Map<string, Array<{ slotId: string; slotName: string }>>();

  template.slots.forEach((slot) => {
    // Hash slotId làm fallback: dùng 4 ký tự cuối để ngắn nhưng đủ phân biệt
    // ngay cả khi slot.name và staticText cùng trống.
    const fallbackName = `Khối #${slot.slotId.slice(-4)}`;
    const slotEntry = {
      slotId: slot.slotId,
      slotName: slotDisplayName(slot, fallbackName),
      dataGroupId: slot.dataGroupId,
      groupId: slot.groupId,
    };

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
    const has = activeEntities.some((entity) => {
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
    (field) => {
      const boundSlots = boundByFieldId.get(field.id) ?? [];
      return {
        field,
        hasDataInSheet: fieldsWithDataIds.has(field.id),
        boundSlots,
        placeholderSlots: placeholderByFieldId.get(field.id) ?? [],
        duplicateUnGrouped: hasDuplicateUngrouped(boundSlots),
      };
    },
  );

  // Trường tự do: các metadata key trong sheet KHÔNG có trong fieldRegistry.
  // Cũng phát hiện slot đang bind tới `entity.metadata.<key>` để liệt kê.
  const knownMetadataIds = new Set(
    ENTITY_FIELDS.filter((field) => field.storedInMetadata).map((field) => field.id),
  );
  const freeKeysWithData = new Set<string>();
  for (const entity of activeEntities) {
    const metadata = entity.metadata ?? {};
    for (const [key, value] of Object.entries(metadata)) {
      if (!key || knownMetadataIds.has(key)) continue;
      if (value == null) continue;
      if (Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0) {
        freeKeysWithData.add(key);
      }
    }
  }
  // Phát hiện slot đang bind tới metadata key tự do để hiện cả khi sheet chưa
  // có data (giúp user thấy "khối này cần data nhưng sheet thiếu").
  const freeKeysFromBindings = new Set<string>();
  for (const slot of template.slots) {
    const path = resolveSlotEntityFieldPath(slot);
    if (!path?.startsWith("entity.metadata.")) continue;
    const key = path.slice("entity.metadata.".length);
    if (key && !knownMetadataIds.has(key)) freeKeysFromBindings.add(key);
  }

  const allFreeKeys = Array.from(new Set([...freeKeysWithData, ...freeKeysFromBindings])).sort(
    (a, b) => a.localeCompare(b, "vi"),
  );
  for (const key of allFreeKeys) {
    const bindingPath = `entity.metadata.${key}`;
    const fieldId = `metadata.${key}`;
    const freeField: EntityFieldDefinition = {
      id: fieldId,
      bindingPath,
      labelVi: key,
      group: "metadata",
      aliases: [],
      placeholderTokens: [],
      kind: "string",
      storedInMetadata: true,
    };
    const boundSlots: Array<{ slotId: string; slotName: string; dataGroupId?: string; groupId?: string }> = [];
    template.slots.forEach((slot) => {
      const slotPath = resolveSlotEntityFieldPath(slot);
      if (slotPath !== bindingPath) return;
      const fallbackName = `Khối #${slot.slotId.slice(-4)}`;
      boundSlots.push({
        slotId: slot.slotId,
        slotName: slotDisplayName(slot, fallbackName),
        dataGroupId: slot.dataGroupId,
        groupId: slot.groupId,
      });
    });
    rows.push({
      field: freeField,
      hasDataInSheet: freeKeysWithData.has(key),
      boundSlots,
      placeholderSlots: [],
      isFreeMetadata: true,
      duplicateUnGrouped: hasDuplicateUngrouped(boundSlots),
    });
  }

  const fieldsWithData = rows.filter((row) => row.hasDataInSheet).length;
  const fieldsBound = rows.filter(
    (row) => row.hasDataInSheet && row.boundSlots.length > 0,
  ).length;
  const hasUnboundPlaceholders = rows.some(
    (row) => row.placeholderSlots.length > 0 && row.boundSlots.length === 0,
  );

  return { rows, fieldsWithData, fieldsBound, hasUnboundPlaceholders };
}
