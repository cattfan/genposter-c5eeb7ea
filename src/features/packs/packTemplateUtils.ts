import { nanoid } from "nanoid";
import type { PackTemplate, PageTemplate, PageType } from "@/models";
import { db } from "@/storage/db";
import { formatTemplateDisplayName } from "@/lib/templateNames";

export const DEFAULT_PACK_NAME = "Bộ khuôn mặc định";

export function createPackTemplate(
  input: { name?: string; orderedPages?: string[] } = {},
): PackTemplate {
  const now = Date.now();
  return {
    packTemplateId: nanoid(),
    name: input.name?.trim() || "Bộ khuôn mới",
    orderedPages: Array.from(new Set(input.orderedPages ?? [])),
    requiredPages: [],
    optionalPages: [],
    captionProfile: { mode: "save_post" },
    exportDefaults: { format: "png", scale: 2 },
    createdAt: now,
    updatedAt: now,
  };
}

export function createBlankPageTemplate(
  input: { name?: string; type?: PageType } = {},
): PageTemplate {
  const now = Date.now();
  return {
    pageTemplateId: nanoid(),
    name: input.name?.trim() || "Trang mới",
    type: input.type ?? "cover",
    canvas: { width: 1080, height: 1350, background: "#ffffff" },
    slots: [],
    sections: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicatePageTemplate(template: PageTemplate, name?: string): PageTemplate {
  const copy = JSON.parse(JSON.stringify(template)) as PageTemplate;
  const pageTemplateId = nanoid();
  const slotIdMap = new Map(copy.slots.map((slot) => [slot.slotId, nanoid()]));
  const sectionIdMap = new Map(copy.sections.map((section) => [section.sectionId, nanoid()]));

  return {
    ...copy,
    pageTemplateId,
    name: name?.trim() || `${formatTemplateDisplayName(copy.name, "Trang")} - bản sao`,
    slots: copy.slots.map((slot) => ({
      ...slot,
      slotId: slotIdMap.get(slot.slotId) ?? nanoid(),
      pageId: slot.pageId ? pageTemplateId : undefined,
      sectionId: slot.sectionId ? (sectionIdMap.get(slot.sectionId) ?? slot.sectionId) : undefined,
      sectionRefId: slot.sectionRefId
        ? (sectionIdMap.get(slot.sectionRefId) ?? slot.sectionRefId)
        : undefined,
      groupId: slot.groupId ? (slotIdMap.get(slot.groupId) ?? slot.groupId) : undefined,
    })),
    sections: copy.sections.map((section) => ({
      ...section,
      sectionId: sectionIdMap.get(section.sectionId) ?? nanoid(),
      imageSlotId: section.imageSlotId
        ? (slotIdMap.get(section.imageSlotId) ?? section.imageSlotId)
        : undefined,
    })),
    cardGroups: copy.cardGroups?.map((group) => ({
      ...group,
      groupId: slotIdMap.get(group.groupId) ?? group.groupId,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function appendPageToPack(pack: PackTemplate, pageTemplateId: string): PackTemplate {
  if (pack.orderedPages.includes(pageTemplateId)) return pack;
  return {
    ...pack,
    orderedPages: [...pack.orderedPages, pageTemplateId],
    updatedAt: Date.now(),
  };
}

export function removePageFromPackAt(pack: PackTemplate, index: number): PackTemplate {
  return {
    ...pack,
    orderedPages: pack.orderedPages.filter((_, itemIndex) => itemIndex !== index),
    requiredPages: pack.requiredPages.filter((id) => id !== pack.orderedPages[index]),
    optionalPages: pack.optionalPages.filter((id) => id !== pack.orderedPages[index]),
    updatedAt: Date.now(),
  };
}

export function getReferencedPageIds(packs: PackTemplate[]): Set<string> {
  return new Set(packs.flatMap((pack) => pack.orderedPages));
}

export async function ensureOrphanTemplatesInDefaultPack(): Promise<{
  packId?: string;
  added: number;
}> {
  const [templates, packs] = await Promise.all([
    db.pageTemplates.toArray(),
    db.packTemplates.toArray(),
  ]);
  const referenced = getReferencedPageIds(packs);
  const orphanTemplates = templates
    .filter((template) => !referenced.has(template.pageTemplateId))
    .sort((a, b) => a.updatedAt - b.updatedAt || a.name.localeCompare(b.name));

  if (orphanTemplates.length === 0) return { added: 0 };

  const defaultPack =
    packs.find((pack) => pack.name === DEFAULT_PACK_NAME) ??
    createPackTemplate({ name: DEFAULT_PACK_NAME });
  const nextPack = {
    ...defaultPack,
    orderedPages: Array.from(
      new Set([
        ...defaultPack.orderedPages,
        ...orphanTemplates.map((template) => template.pageTemplateId),
      ]),
    ),
    updatedAt: Date.now(),
  };

  await db.packTemplates.put(nextPack);
  return { packId: nextPack.packTemplateId, added: orphanTemplates.length };
}
