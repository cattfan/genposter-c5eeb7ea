import Dexie, { type Table } from "dexie";
import { nanoid } from "nanoid";
import type {
  Project,
  Entity,
  Asset,
  AssetItem,
  BrandKit,
  DesignDocument,
  FontAsset,
  PageTemplate,
  PackTemplate,
  GenerationJob,
  ManualOverride,
  BlobRecord,
  GenerateBindingPreset,
  AppSettings,
  AnalysisRecord,
  SymbolDefinition,
} from "@/models";

class CPGDatabase extends Dexie {
  projects!: Table<Project, string>;
  entities!: Table<Entity, string>;
  assets!: Table<Asset, string>;
  assetLibrary!: Table<AssetItem, string>;
  brandKits!: Table<BrandKit, string>;
  designDocuments!: Table<DesignDocument, string>;
  fontAssets!: Table<FontAsset, string>;
  pageTemplates!: Table<PageTemplate, string>;
  packTemplates!: Table<PackTemplate, string>;
  jobs!: Table<GenerationJob, string>;
  overrides!: Table<ManualOverride, string>;
  blobs!: Table<BlobRecord, string>;
  generatePresets!: Table<GenerateBindingPreset, string>;
  settings!: Table<AppSettings & { id: string }, string>;
  analyses!: Table<AnalysisRecord, string>;
  symbols!: Table<SymbolDefinition, string>;

  constructor() {
    super("ContentPackGenerator");
    this.version(1).stores({
      projects: "projectId, name, updatedAt",
      entities: "entityId, name, categoryMain, partnerFlag, status",
      assets: "assetId, entityId, role, isCover, status",
      pageTemplates: "pageTemplateId, name, type, updatedAt",
      packTemplates: "packTemplateId, name, updatedAt",
      jobs: "jobId, packTemplateId, createdAt, status",
      overrides: "overrideId, packTemplateId, pageTemplateId, sectionId",
      blobs: "blobKey, createdAt",
      settings: "id",
    });
    this.version(2).stores({
      entities: "entityId, name, categoryMain, partnerFlag, status, sheetName",
    });
    this.version(3).stores({
      analyses: "analysisId, createdAt, updatedAt, title, mode",
    });
    this.version(4).stores({
      assetLibrary: "assetId, name, kind, updatedAt",
      brandKits: "brandKitId, name, updatedAt",
      designDocuments: "designDocumentId, name, updatedAt, mode, sourcePageTemplateId",
      fontAssets: "fontAssetId, family, updatedAt",
    });
    this.version(5).stores({
      generatePresets: "presetId, name, mode, packTemplateId, updatedAt",
    });
    this.version(6).stores({
      symbols: "symbolId, name, updatedAt",
    });
  }
}

export const db = new CPGDatabase();

export async function saveBlob(blob: Blob, key?: string): Promise<string> {
  const blobKey = key ?? nanoid();
  await db.blobs.put({
    blobKey,
    blob,
    mime: blob.type,
    createdAt: Date.now(),
  });
  return blobKey;
}

export async function getBlobURL(blobKey: string): Promise<string | null> {
  const rec = await db.blobs.get(blobKey);
  if (!rec) return null;
  return URL.createObjectURL(rec.blob);
}

export async function clearAll(): Promise<void> {
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

/**
 * Như clearAll nhưng KHÔNG đụng db.symbols. Dùng cho luồng import dạng JSON cũ
 * (legacy V1/V2) — các format đó không bao gồm symbols, nên nếu replace bằng
 * clearAll() sẽ vô tình xoá thư viện symbol mà người dùng đã build sẵn.
 */
export async function clearAllExceptSymbols(): Promise<void> {
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
  ]);
}
