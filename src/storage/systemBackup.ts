import JSZip from "jszip";
import { db, clearAllExceptSymbols } from "./db";
import { getSettings } from "./settings";
import { importProjectJSON, type ProjectExport } from "./projectIO";
import type {
  AnalysisRecord,
  AppSettings,
  Asset,
  AssetItem,
  BlobRecord,
  BrandKit,
  DesignDocument,
  Entity,
  FontAsset,
  GenerateBindingPreset,
  GenerationJob,
  ManualOverride,
  PackTemplate,
  PageTemplate,
  Project,
  SymbolDefinition,
} from "@/models";

export type SystemBackupImportMode = "replace" | "merge";
export type SystemBackupScope = "all" | "packTemplates" | "generatePresets" | "custom";
export type SystemBackupSection = "systemData" | "packTemplates" | "generatePresets";

export interface SystemBackupExportOptions {
  scope?: SystemBackupScope;
  sections?: SystemBackupSection[];
  includeImages?: boolean;
}

const ALL_BACKUP_SECTIONS: SystemBackupSection[] = [
  "systemData",
  "packTemplates",
  "generatePresets",
];

interface BackupBlobMeta {
  blobKey: string;
  mime: string;
  createdAt: number;
  path: string;
  size: number;
}

interface SystemBackupManifestV1 {
  app: "genposter";
  kind: "system-backup";
  version: 1;
  scope?: SystemBackupScope;
  sections?: SystemBackupSection[];
  includesImages?: boolean;
  exportedAt: number;
  projects: Project[];
  entities: Entity[];
  assets: Asset[];
  assetLibrary: AssetItem[];
  brandKits: BrandKit[];
  designDocuments: DesignDocument[];
  fontAssets: FontAsset[];
  pageTemplates: PageTemplate[];
  packTemplates: PackTemplate[];
  jobs: GenerationJob[];
  overrides: ManualOverride[];
  generatePresets: GenerateBindingPreset[];
  analyses: AnalysisRecord[];
  settings: Array<AppSettings & { id: string }>;
  blobs: BackupBlobMeta[];
  /**
   * Optional vì backup tạo trước fix này không có. Khi đọc, mặc định là [].
   * Vẫn giữ version: 1 — symbols là field tuỳ chọn, không phá compatibility.
   */
  symbols?: SymbolDefinition[];
}

export interface SystemBackupImportResult {
  kind: "system-backup" | "legacy-json";
  message: string;
  warning?: string;
}

function stripSecretsFromSettings<T extends AppSettings>(settings: T): T {
  const { captionApiKey: _captionApiKey, ai, ...rest } = settings;
  const safeSettings = { ...rest } as T;
  if (ai) {
    const { apiKey: _apiKey, ...safeAi } = ai;
    safeSettings.ai = safeAi as T["ai"];
  }
  return safeSettings;
}

function blobPath(blobKey: string) {
  return `blobs/${encodeURIComponent(blobKey)}`;
}

function getIdbBlobKey(src: string) {
  return src.startsWith("idb://") ? src.slice("idb://".length) : null;
}

function collectIdbBlobKeys(value: unknown, out = new Set<string>()) {
  if (!value) return out;
  if (typeof value === "string") {
    const key = getIdbBlobKey(value);
    if (key) out.add(key);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectIdbBlobKeys(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectIdbBlobKeys(item, out);
    }
  }
  return out;
}

function pageIdsForPacks(packTemplates: PackTemplate[]) {
  return new Set(
    packTemplates.flatMap((pack) => [
      ...pack.orderedPages,
      ...pack.requiredPages,
      ...pack.optionalPages,
    ]),
  );
}

function sectionsFromOptions(options: SystemBackupExportOptions): SystemBackupSection[] {
  if (options.sections?.length) {
    return Array.from(new Set(options.sections));
  }

  if (options.scope === "packTemplates") return ["packTemplates"];
  if (options.scope === "generatePresets") return ["generatePresets"];
  return ALL_BACKUP_SECTIONS;
}

function scopeFromSections(sections: SystemBackupSection[]): SystemBackupScope {
  const selected = new Set(sections);
  if (ALL_BACKUP_SECTIONS.every((section) => selected.has(section))) return "all";
  if (selected.size === 1 && selected.has("packTemplates")) return "packTemplates";
  if (selected.size === 1 && selected.has("generatePresets")) return "generatePresets";
  return "custom";
}

function addBlobKeysFromRecords(
  records: Array<{ blobKey?: string; sourceValue?: string; imageBlobKeys?: string[] }>,
  out: Set<string>,
) {
  for (const record of records) {
    if (record.blobKey) out.add(record.blobKey);
    if (record.sourceValue) collectIdbBlobKeys(record.sourceValue, out);
    for (const key of record.imageBlobKeys ?? []) out.add(key);
  }
}

function collectManifestBlobKeys(manifest: SystemBackupManifestV1) {
  const keys = collectIdbBlobKeys(manifest);
  addBlobKeysFromRecords(manifest.assets, keys);
  addBlobKeysFromRecords(manifest.assetLibrary, keys);
  addBlobKeysFromRecords(manifest.fontAssets, keys);
  addBlobKeysFromRecords(manifest.analyses, keys);
  return keys;
}

function assertManifest(data: unknown): asserts data is SystemBackupManifestV1 {
  if (!data || typeof data !== "object") {
    throw new Error("Backup không hợp lệ.");
  }
  const manifest = data as Partial<SystemBackupManifestV1>;
  if (manifest.app !== "genposter" || manifest.kind !== "system-backup" || manifest.version !== 1) {
    throw new Error("File backup không đúng định dạng GenPoster.");
  }
  if (!Array.isArray(manifest.blobs)) {
    throw new Error("Backup thiếu danh sách ảnh.");
  }
}

async function readCurrentManifest(
  options: SystemBackupExportOptions = {},
): Promise<{ manifest: SystemBackupManifestV1; blobRecords: BlobRecord[] }> {
  const sections = sectionsFromOptions(options);
  const scope = scopeFromSections(sections);
  const selectedSections = new Set(sections);
  const includeImages = options.includeImages ?? true;
  const [
    projects,
    entities,
    assets,
    assetLibrary,
    brandKits,
    designDocuments,
    fontAssets,
    pageTemplates,
    packTemplates,
    jobs,
    overrides,
    generatePresets,
    analyses,
    blobRecords,
    settingsRecords,
    symbols,
  ] = await Promise.all([
    db.projects.toArray(),
    db.entities.toArray(),
    db.assets.toArray(),
    db.assetLibrary.toArray(),
    db.brandKits.toArray(),
    db.designDocuments.toArray(),
    db.fontAssets.toArray(),
    db.pageTemplates.toArray(),
    db.packTemplates.toArray(),
    db.jobs.toArray(),
    db.overrides.toArray(),
    db.generatePresets.toArray(),
    db.analyses.toArray(),
    db.blobs.toArray(),
    db.settings.toArray(),
    db.symbols.toArray(),
  ]);

  const settings =
    settingsRecords.length > 0
      ? settingsRecords.map((record) => stripSecretsFromSettings(record))
      : [{ id: "app", ...stripSecretsFromSettings(await getSettings()) }];

  const includeSystemData = selectedSections.has("systemData");
  const packMap = new Map<string, PackTemplate>();
  const pageIds = new Set<string>();

  if (selectedSections.has("packTemplates")) {
    for (const pack of packTemplates) packMap.set(pack.packTemplateId, pack);
    for (const pageId of pageIdsForPacks(packTemplates)) pageIds.add(pageId);
  }

  const selectedGeneratePresets = selectedSections.has("generatePresets") ? generatePresets : [];
  if (selectedGeneratePresets.length > 0) {
    const presetPackIds = new Set(
      selectedGeneratePresets
        .map((preset) => preset.packTemplateId)
        .filter((packId): packId is string => Boolean(packId)),
    );
    const presetPacks = packTemplates.filter((pack) => presetPackIds.has(pack.packTemplateId));
    for (const pack of presetPacks) packMap.set(pack.packTemplateId, pack);
    for (const pageId of pageIdsForPacks(presetPacks)) pageIds.add(pageId);
    for (const preset of selectedGeneratePresets) {
      for (const pageId of preset.pageTemplateIds) pageIds.add(pageId);
    }
  }

  const selectedProjects = includeSystemData ? projects : [];
  const selectedEntities = includeSystemData ? entities : [];
  const selectedAssets = includeSystemData ? assets : [];
  const selectedAssetLibrary = includeSystemData ? assetLibrary : [];
  const selectedBrandKits = includeSystemData ? brandKits : [];
  const selectedDesignDocuments = includeSystemData ? designDocuments : [];
  const selectedFontAssets = includeSystemData ? fontAssets : [];
  const selectedPageTemplates = pageTemplates.filter((page) => pageIds.has(page.pageTemplateId));
  const selectedPackTemplates = Array.from(packMap.values());
  const selectedJobs = includeSystemData ? jobs : [];
  const selectedOverrides = includeSystemData ? overrides : [];
  const selectedAnalyses = includeSystemData ? analyses : [];
  const selectedSettings = includeSystemData ? settings : [];
  // Symbols là tài nguyên app-global, đi kèm systemData scope.
  const selectedSymbols = includeSystemData ? symbols : [];

  const manifest: SystemBackupManifestV1 = {
    app: "genposter",
    kind: "system-backup",
    version: 1,
    scope,
    sections,
    includesImages: includeImages,
    exportedAt: Date.now(),
    projects: selectedProjects,
    entities: selectedEntities,
    assets: selectedAssets,
    assetLibrary: selectedAssetLibrary,
    brandKits: selectedBrandKits,
    designDocuments: selectedDesignDocuments,
    fontAssets: selectedFontAssets,
    pageTemplates: selectedPageTemplates,
    packTemplates: selectedPackTemplates,
    jobs: selectedJobs,
    overrides: selectedOverrides,
    generatePresets: selectedGeneratePresets,
    analyses: selectedAnalyses,
    settings: selectedSettings,
    symbols: selectedSymbols,
    blobs: [],
  };

  const manifestBlobKeys = includeImages && scope !== "all" ? collectManifestBlobKeys(manifest) : null;
  const selectedBlobRecords = includeImages
    ? scope === "all"
      ? blobRecords
      : blobRecords.filter((record) => manifestBlobKeys?.has(record.blobKey))
    : [];

  manifest.blobs = selectedBlobRecords.map((record) => ({
      blobKey: record.blobKey,
      mime: record.mime,
      createdAt: record.createdAt,
      path: blobPath(record.blobKey),
      size: record.blob.size,
    }));

  return { manifest, blobRecords: selectedBlobRecords };
}

function backupScopeFileLabel(scope: SystemBackupScope) {
  if (scope === "packTemplates") return "pack-template";
  if (scope === "generatePresets") return "khuon-do-du-lieu";
  if (scope === "custom") return "custom";
  return "full";
}

export function getSystemBackupFileName(
  now = Date.now(),
  scope: SystemBackupScope = "all",
  includeImages = true,
) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `genposter-backup-${backupScopeFileLabel(scope)}-${includeImages ? "with-images" : "no-images"}-${stamp}.zip`;
}

export async function createSystemBackupZip(options: SystemBackupExportOptions = {}): Promise<Blob> {
  const { manifest, blobRecords } = await readCurrentManifest(options);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const record of blobRecords) {
    zip.file(blobPath(record.blobKey), record.blob);
  }
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/zip",
  });
}

async function readBackupZip(file: File): Promise<{
  manifest: SystemBackupManifestV1;
  blobRecords: BlobRecord[];
}> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("Backup thiếu manifest.json.");
  }
  const manifest = JSON.parse(await manifestFile.async("text")) as unknown;
  assertManifest(manifest);

  const blobRecords: BlobRecord[] = [];
  for (const meta of manifest.blobs) {
    const zipBlob = zip.file(meta.path);
    if (!zipBlob) {
      throw new Error(`Backup thiếu ảnh: ${meta.blobKey}`);
    }
    const blob = await zipBlob.async("blob");
    blobRecords.push({
      blobKey: meta.blobKey,
      blob: new Blob([blob], { type: meta.mime || blob.type }),
      mime: meta.mime || blob.type,
      createdAt: meta.createdAt,
    });
  }

  return { manifest, blobRecords };
}

async function putIfAny<T>(table: { bulkPut(rows: T[]): Promise<unknown> }, rows: T[]) {
  if (rows.length) await table.bulkPut(rows);
}

async function restoreSystemBackup(
  manifest: SystemBackupManifestV1,
  blobRecords: BlobRecord[],
  mode: SystemBackupImportMode,
) {
  await db.transaction(
    "rw",
    [
      db.projects,
      db.entities,
      db.assets,
      db.assetLibrary,
      db.brandKits,
      db.designDocuments,
      db.fontAssets,
      db.pageTemplates,
      db.packTemplates,
      db.jobs,
      db.overrides,
      db.blobs,
      db.generatePresets,
      db.analyses,
      db.settings,
      db.symbols,
    ],
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.projects.clear(),
          db.entities.clear(),
          db.assets.clear(),
          db.assetLibrary.clear(),
          db.brandKits.clear(),
          db.designDocuments.clear(),
          db.fontAssets.clear(),
          db.pageTemplates.clear(),
          db.packTemplates.clear(),
          db.jobs.clear(),
          db.overrides.clear(),
          db.blobs.clear(),
          db.generatePresets.clear(),
          db.analyses.clear(),
          db.settings.clear(),
          db.symbols.clear(),
        ]);
      }

      await putIfAny(db.projects, manifest.projects);
      await putIfAny(db.entities, manifest.entities);
      await putIfAny(db.assets, manifest.assets);
      await putIfAny(db.assetLibrary, manifest.assetLibrary);
      await putIfAny(db.brandKits, manifest.brandKits);
      await putIfAny(db.designDocuments, manifest.designDocuments);
      await putIfAny(db.fontAssets, manifest.fontAssets);
      await putIfAny(db.pageTemplates, manifest.pageTemplates);
      await putIfAny(db.packTemplates, manifest.packTemplates);
      await putIfAny(db.jobs, manifest.jobs);
      await putIfAny(db.overrides, manifest.overrides);
      await putIfAny(db.blobs, blobRecords);
      await putIfAny(db.generatePresets, manifest.generatePresets);
      await putIfAny(db.analyses, manifest.analyses);
      await putIfAny(db.settings, manifest.settings);
      await putIfAny(db.symbols, manifest.symbols ?? []);
    },
  );
}

async function importLegacyJson(file: File, mode: SystemBackupImportMode): Promise<SystemBackupImportResult> {
  const data = JSON.parse(await file.text()) as ProjectExport;
  if (mode === "replace") {
    // Trước đây gọi clearAll() bao luôn db.symbols -> import legacy JSON (vốn
    // không chứa symbols) sẽ xoá sạch thư viện symbol đã build. Dùng
    // clearAllExceptSymbols để giữ nguyên symbols qua legacy import.
    await clearAllExceptSymbols();
  }
  await importProjectJSON(data);
  return {
    kind: "legacy-json",
    message: "Đã import JSON cũ.",
    warning: "JSON cũ không chứa ảnh local, settings, preset generate hoặc lịch sử phân tích.",
  };
}

export async function importSystemBackupFile(
  file: File,
  mode: SystemBackupImportMode,
): Promise<SystemBackupImportResult> {
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    return importLegacyJson(file, mode);
  }

  const { manifest, blobRecords } = await readBackupZip(file);
  await restoreSystemBackup(manifest, blobRecords, mode);
  const message =
    manifest.scope === "packTemplates"
      ? `Đã khôi phục ${manifest.packTemplates.length} bộ khuôn, ${manifest.pageTemplates.length} trang khuôn và ${blobRecords.length} ảnh.`
      : manifest.scope === "generatePresets"
        ? `Đã khôi phục ${manifest.generatePresets.length} khuôn đổ dữ liệu, ${manifest.packTemplates.length} bộ khuôn, ${manifest.pageTemplates.length} trang khuôn và ${blobRecords.length} ảnh.`
        : `Đã khôi phục backup gồm ${manifest.entities.length} dòng dữ liệu, ${manifest.assets.length} asset và ${blobRecords.length} ảnh.`;
  return {
    kind: "system-backup",
    message,
    warning:
      manifest.includesImages === false
        ? "Backup này không chứa ảnh local, các ảnh lưu trong IndexedDB sẽ không được khôi phục."
        : undefined,
  };
}
