import { nanoid } from "nanoid";
import type {
  GenPosterPortableBundleV1,
  GenerateBindingPreset,
  PackTemplate,
  PageTemplate,
} from "@/models";
import { formatImportedTemplateName } from "@/lib/templateNames";
import { db } from "@/storage/db";

export function safePortableFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "genposter";
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function readPortableBundleFile(file: File): Promise<GenPosterPortableBundleV1> {
  const raw = JSON.parse(await file.text()) as Partial<GenPosterPortableBundleV1>;
  if (raw.app !== "genposter" || raw.version !== 1) {
    throw new Error("File không đúng định dạng GenPoster.");
  }
  return raw as GenPosterPortableBundleV1;
}

export function buildPackTemplateBundle(
  pack: PackTemplate,
  pages: PageTemplate[],
): GenPosterPortableBundleV1 {
  return {
    app: "genposter",
    kind: "pack-template",
    version: 1,
    exportedAt: Date.now(),
    packTemplates: [pack],
    pageTemplates: pages,
  };
}

export function buildGeneratePresetBundle(
  preset: GenerateBindingPreset,
  pack?: PackTemplate,
  pages: PageTemplate[] = [],
): GenPosterPortableBundleV1 {
  return {
    app: "genposter",
    kind: "generate-preset",
    version: 1,
    exportedAt: Date.now(),
    packTemplates: pack ? [pack] : [],
    pageTemplates: pages,
    generatePresets: [preset],
  };
}

function pickImportId(originalId: string, existingIds: Set<string>, usedIds: Set<string>) {
  const nextId = existingIds.has(originalId) || usedIds.has(originalId) ? nanoid() : originalId;
  usedIds.add(nextId);
  return nextId;
}

function clonePageForImport(
  page: PageTemplate,
  pageIdMap: Map<string, string>,
  existingIds: Set<string>,
  usedIds: Set<string>,
): PageTemplate {
  const nextId = pickImportId(page.pageTemplateId, existingIds, usedIds);
  pageIdMap.set(page.pageTemplateId, nextId);
  const copied = structuredClone(page);
  const now = Date.now();
  return {
    ...copied,
    pageTemplateId: nextId,
    name: nextId === page.pageTemplateId ? copied.name : formatImportedTemplateName(copied.name, "Trang"),
    slots: copied.slots.map((slot) => ({
      ...slot,
      pageId: slot.pageId === page.pageTemplateId ? nextId : slot.pageId,
    })),
    createdAt: nextId === page.pageTemplateId ? copied.createdAt : now,
    updatedAt: now,
  };
}

function clonePackForImport(
  pack: PackTemplate,
  pageIdMap: Map<string, string>,
  packIdMap: Map<string, string>,
  existingIds: Set<string>,
  usedIds: Set<string>,
): PackTemplate {
  const nextId = pickImportId(pack.packTemplateId, existingIds, usedIds);
  packIdMap.set(pack.packTemplateId, nextId);
  const now = Date.now();
  const remapPageIds = (ids: string[]) => ids.map((id) => pageIdMap.get(id) ?? id);
  return {
    ...structuredClone(pack),
    packTemplateId: nextId,
    name: nextId === pack.packTemplateId ? pack.name : formatImportedTemplateName(pack.name, "Bộ khuôn"),
    orderedPages: remapPageIds(pack.orderedPages),
    requiredPages: remapPageIds(pack.requiredPages),
    optionalPages: remapPageIds(pack.optionalPages),
    createdAt: nextId === pack.packTemplateId ? pack.createdAt : now,
    updatedAt: now,
  };
}

function clonePresetForImport(
  preset: GenerateBindingPreset,
  pageIdMap: Map<string, string>,
  packIdMap: Map<string, string>,
  existingIds: Set<string>,
  usedIds: Set<string>,
): GenerateBindingPreset {
  const nextId = pickImportId(preset.presetId, existingIds, usedIds);
  const now = Date.now();
  const bindOverrides: GenerateBindingPreset["bindOverrides"] = {};
  Object.entries(preset.bindOverrides ?? {}).forEach(([pageId, overrides]) => {
    bindOverrides[pageIdMap.get(pageId) ?? pageId] = { ...overrides };
  });
  const generateConfig = structuredClone(preset.generateConfig);
  if (generateConfig.pageConfigs) {
    generateConfig.pageConfigs = Object.fromEntries(
      Object.entries(generateConfig.pageConfigs).map(([pageId, config]) => [
        pageIdMap.get(pageId) ?? pageId,
        config,
      ]),
    );
  }

  return {
    ...structuredClone(preset),
    presetId: nextId,
    name: nextId === preset.presetId ? preset.name : formatImportedTemplateName(preset.name, "Khuôn"),
    packTemplateId: preset.packTemplateId
      ? (packIdMap.get(preset.packTemplateId) ?? preset.packTemplateId)
      : undefined,
    pageTemplateIds: preset.pageTemplateIds.map((id) => pageIdMap.get(id) ?? id),
    bindOverrides,
    generateConfig,
    createdAt: nextId === preset.presetId ? preset.createdAt : now,
    updatedAt: now,
    version: 1,
  };
}

export async function importPortableBundle(bundle: GenPosterPortableBundleV1) {
  const existingPageIds = new Set((await db.pageTemplates.toCollection().primaryKeys()) as string[]);
  const existingPackIds = new Set((await db.packTemplates.toCollection().primaryKeys()) as string[]);
  const existingPresetIds = new Set((await db.generatePresets.toCollection().primaryKeys()) as string[]);
  const usedPageIds = new Set<string>();
  const usedPackIds = new Set<string>();
  const usedPresetIds = new Set<string>();
  const pageIdMap = new Map<string, string>();
  const packIdMap = new Map<string, string>();

  const pages = (bundle.pageTemplates ?? []).map((page) =>
    clonePageForImport(page, pageIdMap, existingPageIds, usedPageIds),
  );
  const packs = (bundle.packTemplates ?? []).map((pack) =>
    clonePackForImport(pack, pageIdMap, packIdMap, existingPackIds, usedPackIds),
  );
  const presets = (bundle.generatePresets ?? []).map((preset) =>
    clonePresetForImport(preset, pageIdMap, packIdMap, existingPresetIds, usedPresetIds),
  );

  await db.transaction(
    "rw",
    [db.pageTemplates, db.packTemplates, db.generatePresets],
    async () => {
      if (pages.length > 0) await db.pageTemplates.bulkPut(pages);
      if (packs.length > 0) await db.packTemplates.bulkPut(packs);
      if (presets.length > 0) await db.generatePresets.bulkPut(presets);
    },
  );

  return { pages, packs, presets };
}
