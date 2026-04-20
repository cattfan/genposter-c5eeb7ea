import Dexie, { type Table } from "dexie";
import type {
  Project,
  Entity,
  Asset,
  PageTemplate,
  PackTemplate,
  GenerationJob,
  ManualOverride,
  BlobRecord,
  AppSettings,
} from "@/models";

class CPGDatabase extends Dexie {
  projects!: Table<Project, string>;
  entities!: Table<Entity, string>;
  assets!: Table<Asset, string>;
  pageTemplates!: Table<PageTemplate, string>;
  packTemplates!: Table<PackTemplate, string>;
  jobs!: Table<GenerationJob, string>;
  overrides!: Table<ManualOverride, string>;
  blobs!: Table<BlobRecord, string>;
  settings!: Table<AppSettings & { id: string }, string>;

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
  }
}

export const db = new CPGDatabase();

export async function saveBlob(blob: Blob, key?: string): Promise<string> {
  const { nanoid } = await import("nanoid");
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
    db.pageTemplates.clear(),
    db.packTemplates.clear(),
    db.jobs.clear(),
    db.overrides.clear(),
    db.blobs.clear(),
  ]);
}
