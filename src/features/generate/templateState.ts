import type { PageTemplate } from "@/models";
import { isDataGroupMarkerSlot } from "@/engines/binding/slotMarkers";
import { applyBindOverrides } from "./useBindOverrides";

export type TemplateBindingOverrides = Record<string, string | undefined>;
interface TemplateGroupOptions {
  synthesizeMissingGroups?: boolean;
}

/**
 * Default options dùng ở khâu generate. `synthesizeMissingGroups: false` quan
 * trọng — nếu để true, các page có nhiều slot binding sẽ tự sinh thêm
 * `auto-group-...` slot (hành vi cũ gây ra binding ngoài ý muốn). Cố định ở
 * đây để không phải truyền lặp lại 14+ lần ở PackTabContent.
 */
export const GENERATE_TEMPLATE_OPTIONS = { synthesizeMissingGroups: false } as const;

function isSyntheticAutoGroupId(value: string | undefined) {
  return typeof value === "string" && value.startsWith("auto-group-");
}

export function clonePageTemplate(template: PageTemplate): PageTemplate {
  return JSON.parse(JSON.stringify(template)) as PageTemplate;
}

function slotArea(slot: PageTemplate["slots"][number]): number {
  return Math.max(0, slot.width) * Math.max(0, slot.height);
}

function isImageLikeSlot(slot: PageTemplate["slots"][number]): boolean {
  return slot.kind === "image" || (slot.kind === "shape" && !slot.staticText?.trim());
}

function normalizeDataLabel(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isLikelyCardFieldSlot(slot: PageTemplate["slots"][number]): boolean {
  if (slot.kind !== "text" && !(slot.kind === "shape" && slot.staticText?.trim())) return false;
  if (isDataGroupMarkerSlot(slot)) return false;
  if (slot.bindingPath || slot.fieldParts?.length) return true;
  const label = normalizeDataLabel(slot.staticText ?? slot.name);
  const compactLabel = label.replace(/\s+/g, "");
  return [
    "ten",
    "ten quan",
    "dia chi",
    "gia",
    "name",
    "address",
    "price",
  ].includes(label) || ["ten", "tenquan", "diachi", "gia", "name", "address", "price"].includes(compactLabel);
}

function isLikelyTemplateBackground(slot: PageTemplate["slots"][number], template: PageTemplate): boolean {
  if (!isImageLikeSlot(slot)) return false;
  if (slot.isUploadedBackground) return true;
  const canvasArea = template.canvas.width * template.canvas.height;
  if (canvasArea <= 0) return false;
  return slotArea(slot) >= canvasArea * 0.35;
}

function centerDistance(
  a: PageTemplate["slots"][number],
  b: PageTemplate["slots"][number],
): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function isFieldNearImageCard(
  image: PageTemplate["slots"][number],
  field: PageTemplate["slots"][number],
): boolean {
  const fieldCenterX = field.x + field.width / 2;
  const fieldCenterY = field.y + field.height / 2;
  const left = image.x - Math.max(80, image.width * 0.45);
  const right = image.x + image.width + Math.max(190, image.width * 1.9);
  const top = image.y - Math.max(24, image.height * 0.25);
  const bottom = image.y + image.height + Math.max(90, image.height * 0.8);
  return fieldCenterX >= left && fieldCenterX <= right && fieldCenterY >= top && fieldCenterY <= bottom;
}

function buildGroupSlot(
  groupId: string,
  children: PageTemplate["slots"],
): PageTemplate["slots"][number] {
  const left = Math.min(...children.map((slot) => slot.x));
  const top = Math.min(...children.map((slot) => slot.y));
  const right = Math.max(...children.map((slot) => slot.x + slot.width));
  const bottom = Math.max(...children.map((slot) => slot.y + slot.height));
  const maxZ = Math.max(...children.map((slot) => slot.zIndex ?? 0));
  return {
    slotId: groupId,
    kind: "group",
    name: "Group",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    zIndex: maxZ + 1,
  };
}

function synthesizeMissingCardGroups(template: PageTemplate): PageTemplate {
  const images = template.slots
    .filter(
      (slot) =>
        !slot.groupId &&
        isImageLikeSlot(slot) &&
        !isLikelyTemplateBackground(slot, template),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const fields = template.slots
    .filter((slot) => !slot.groupId && isLikelyCardFieldSlot(slot))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (images.length === 0 || fields.length === 0) return template;

  const assigned = new Set<string>();
  let changed = false;
  let groupIndex = 0;
  const groups: Array<{ groupId: string; ids: Set<string> }> = [];

  for (const image of images) {
    const nearbyFields = fields
      .filter((field) => !assigned.has(field.slotId) && isFieldNearImageCard(image, field))
      .sort((a, b) => centerDistance(image, a) - centerDistance(image, b))
      .slice(0, 4);
    if (nearbyFields.length === 0) continue;

    const groupId = `auto-group-${template.pageTemplateId}-${groupIndex + 1}`;
    groupIndex += 1;
    const ids = new Set([image.slotId, ...nearbyFields.map((field) => field.slotId)]);
    ids.forEach((id) => assigned.add(id));
    groups.push({ groupId, ids });
  }

  if (groups.length === 0) return template;

  const groupBySlotId = new Map<string, string>();
  groups.forEach((group) => group.ids.forEach((id) => groupBySlotId.set(id, group.groupId)));
  const nextSlots = template.slots.map((slot) => {
    const groupId = groupBySlotId.get(slot.slotId);
    if (!groupId) return slot;
    changed = true;
    return { ...slot, groupId };
  });

  for (const group of groups) {
    const children = nextSlots.filter((slot) => group.ids.has(slot.slotId));
    if (children.length < 2) continue;
    nextSlots.push(buildGroupSlot(group.groupId, children));
  }

  return changed ? { ...template, slots: nextSlots } : template;
}

function normalizeTemplateGroups(
  template: PageTemplate,
  options?: TemplateGroupOptions,
): PageTemplate {
  const groupedTemplate = options?.synthesizeMissingGroups === false
    ? {
        ...template,
        slots: template.slots
          .filter((slot) => !(slot.kind === "group" && isSyntheticAutoGroupId(slot.slotId)))
          .map((slot) =>
            isSyntheticAutoGroupId(slot.groupId) ? { ...slot, groupId: undefined } : slot,
          ),
      }
    : synthesizeMissingCardGroups(template);
  const groupSlots = groupedTemplate.slots.filter((slot) => slot.kind === "group");
  const groupIds = new Set(groupSlots.map((slot) => slot.slotId));
  const childGroups = new Map<string, typeof groupedTemplate.slots>();

  groupedTemplate.slots.forEach((slot) => {
    if (!slot.groupId) return;
    const list = childGroups.get(slot.groupId) ?? [];
    list.push(slot);
    childGroups.set(slot.groupId, list);
  });

  let changed = false;
  const nextSlots = groupedTemplate.slots.map((slot) => {
    if (!slot.groupId || groupIds.has(slot.groupId)) return slot;
    const siblingCount = childGroups.get(slot.groupId)?.length ?? 0;
    if (siblingCount < 2) {
      changed = true;
      return { ...slot, groupId: undefined };
    }
    return slot;
  });

  const nextGroupIds = new Set(groupIds);
  childGroups.forEach((children, groupId) => {
    if (nextGroupIds.has(groupId) || children.length < 2) return;
    const left = Math.min(...children.map((slot) => slot.x));
    const top = Math.min(...children.map((slot) => slot.y));
    const right = Math.max(...children.map((slot) => slot.x + slot.width));
    const bottom = Math.max(...children.map((slot) => slot.y + slot.height));
    const maxZ = Math.max(...children.map((slot) => slot.zIndex ?? 0));
    nextSlots.push({
      slotId: groupId,
      kind: "group",
      name: "Group",
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      zIndex: maxZ + 1,
    });
    nextGroupIds.add(groupId);
    changed = true;
  });

  if (!changed) return groupedTemplate;
  return {
    ...groupedTemplate,
    slots: nextSlots,
    cardGroups: template.cardGroups?.filter((group) => nextGroupIds.has(group.groupId)),
  };
}

export function restoreTemplateGroups(
  baseTemplate: PageTemplate | undefined,
  workingTemplate: PageTemplate,
  options?: TemplateGroupOptions,
): PageTemplate {
  const normalizedWorkingTemplate = normalizeTemplateGroups(workingTemplate, options);
  if (!baseTemplate) return normalizedWorkingTemplate;

  const baseGroupSlots = baseTemplate.slots.filter((slot) => slot.kind === "group");
  const baseGroupsById = new Map(baseGroupSlots.map((slot) => [slot.slotId, slot]));
  const baseChildGroupIds = new Map<string, string>();
  baseTemplate.slots.forEach((slot) => {
    if (slot.groupId && baseGroupsById.has(slot.groupId)) {
      baseChildGroupIds.set(slot.slotId, slot.groupId);
    }
  });

  if (baseGroupsById.size === 0 && baseChildGroupIds.size === 0) {
    return normalizedWorkingTemplate;
  }

  let changed = false;
  const workingSlotIds = new Set(normalizedWorkingTemplate.slots.map((slot) => slot.slotId));
  const nextSlots = normalizedWorkingTemplate.slots.map((slot) => {
    const baseGroupId = baseChildGroupIds.get(slot.slotId);
    if (!baseGroupId || slot.groupId === baseGroupId) return slot;
    changed = true;
    return { ...slot, groupId: baseGroupId };
  });

  for (const groupSlot of baseGroupSlots) {
    if (workingSlotIds.has(groupSlot.slotId)) continue;
    nextSlots.push(clonePageTemplate({ ...baseTemplate, slots: [groupSlot] }).slots[0]);
    changed = true;
  }

  const restored = changed ? { ...normalizedWorkingTemplate, slots: nextSlots } : normalizedWorkingTemplate;
  return normalizeTemplateGroups(restored, options);
}

export function resolvePageWorkingTemplate(
  baseTemplate: PageTemplate | undefined,
  overrides?: TemplateBindingOverrides,
  workingTemplate?: PageTemplate,
  options?: TemplateGroupOptions,
): PageTemplate | undefined {
  if (workingTemplate) return restoreTemplateGroups(baseTemplate, workingTemplate, options);
  if (!baseTemplate) return undefined;
  return restoreTemplateGroups(
    baseTemplate,
    applyBindOverrides(baseTemplate, overrides ?? {}),
    options,
  );
}

export function createWorkingTemplate(
  baseTemplate: PageTemplate,
  overrides?: TemplateBindingOverrides,
  existingWorkingTemplate?: PageTemplate,
  options?: TemplateGroupOptions,
): PageTemplate {
  const source = existingWorkingTemplate ?? applyBindOverrides(baseTemplate, overrides ?? {});
  return clonePageTemplate(restoreTemplateGroups(baseTemplate, source, options));
}
