import { db } from "./db";
import type {
  Project,
  Entity,
  Asset,
  PageTemplate,
  PackTemplate,
  GenerationJob,
  ManualOverride,
} from "@/models";

export interface ProjectExport {
  version: 1;
  exportedAt: number;
  project: Project | null;
  entities: Entity[];
  assets: Asset[];
  pageTemplates: PageTemplate[];
  packTemplates: PackTemplate[];
  jobs: GenerationJob[];
  overrides: ManualOverride[];
}

export async function exportProjectJSON(): Promise<ProjectExport> {
  const [project, entities, assets, pageTemplates, packTemplates, jobs, overrides] =
    await Promise.all([
      db.projects.toCollection().first(),
      db.entities.toArray(),
      db.assets.toArray(),
      db.pageTemplates.toArray(),
      db.packTemplates.toArray(),
      db.jobs.toArray(),
      db.overrides.toArray(),
    ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    project: project ?? null,
    entities,
    assets,
    pageTemplates,
    packTemplates,
    jobs,
    overrides,
  };
}

export async function importProjectJSON(data: ProjectExport): Promise<void> {
  if (data.version !== 1) throw new Error("Phiên bản project export không hỗ trợ");
  await db.transaction(
    "rw",
    [
      db.projects,
      db.entities,
      db.assets,
      db.pageTemplates,
      db.packTemplates,
      db.jobs,
      db.overrides,
    ],
    async () => {
      if (data.project) await db.projects.put(data.project);
      await db.entities.bulkPut(data.entities);
      await db.assets.bulkPut(data.assets);
      await db.pageTemplates.bulkPut(data.pageTemplates);
      await db.packTemplates.bulkPut(data.packTemplates);
      await db.jobs.bulkPut(data.jobs);
      await db.overrides.bulkPut(data.overrides);
    },
  );
}
