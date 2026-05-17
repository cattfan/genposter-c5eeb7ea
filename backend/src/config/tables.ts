// Cấu hình bảng động cho Generic CRUD Module
// Mỗi bảng được khai báo 1 dòng, không cần viết module/controller/service riêng.
// Phù hợp với app single user, schema linh hoạt qua JSON payload.

export interface TableConfig {
  /** Tên bảng SQLite + URL path (vd: "entities" -> /api/v1/entities) */
  name: string;
  /** Tên field primary key trong row JSON (vd: "entityId") */
  primaryKey: string;
  /**
   * Các field cần index để query nhanh. Engine sẽ tạo cột virtual
   * (json_extract) + INDEX. Search ?field=value qua các field này.
   */
  indexedFields?: string[];
}

export const TABLES: readonly TableConfig[] = [
  { name: "projects", primaryKey: "projectId", indexedFields: ["name", "updatedAt"] },
  {
    name: "entities",
    primaryKey: "entityId",
    indexedFields: ["name", "categoryMain", "partnerFlag", "status", "sheetName"],
  },
  {
    name: "assets",
    primaryKey: "assetId",
    indexedFields: ["entityId", "role", "isCover", "status"],
  },
  {
    name: "asset_library",
    primaryKey: "assetId",
    indexedFields: ["name", "kind", "updatedAt"],
  },
  { name: "brand_kits", primaryKey: "brandKitId", indexedFields: ["name", "updatedAt"] },
  {
    name: "design_documents",
    primaryKey: "designDocumentId",
    indexedFields: ["name", "updatedAt", "mode", "sourcePageTemplateId"],
  },
  {
    name: "font_assets",
    primaryKey: "fontAssetId",
    indexedFields: ["family", "updatedAt"],
  },
  {
    name: "page_templates",
    primaryKey: "pageTemplateId",
    indexedFields: ["name", "type", "updatedAt"],
  },
  {
    name: "pack_templates",
    primaryKey: "packTemplateId",
    indexedFields: ["name", "updatedAt"],
  },
  {
    name: "jobs",
    primaryKey: "jobId",
    indexedFields: ["packTemplateId", "createdAt", "status"],
  },
  {
    name: "overrides",
    primaryKey: "overrideId",
    indexedFields: ["packTemplateId", "pageTemplateId", "sectionId"],
  },
  {
    name: "generate_presets",
    primaryKey: "presetId",
    indexedFields: ["name", "mode", "packTemplateId", "updatedAt"],
  },
  {
    name: "analyses",
    primaryKey: "analysisId",
    indexedFields: ["createdAt", "updatedAt", "title", "mode"],
  },
  { name: "symbols", primaryKey: "symbolId", indexedFields: ["name", "updatedAt"] },
  { name: "settings", primaryKey: "id" },
  // Note: blobs handled separately (multipart upload + filesystem),
  // không qua generic CRUD vì payload là binary, không phải JSON.
] as const;

/**
 * Map từ URL slug sang TableConfig. URL hỗ trợ cả 2 format:
 * - kebab-case: /api/v1/page-templates
 * - camelCase legacy (cho frontend Dexie cũ): /api/v1/pageTemplates
 */
export function findTableBySlug(slug: string): TableConfig | undefined {
  const normalized = slug.toLowerCase();
  return TABLES.find((table) => {
    if (table.name === slug) return true;
    if (table.name === normalized) return true;
    // entities -> entities, page_templates -> pageTemplates / page-templates
    const camel = table.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const kebab = table.name.replace(/_/g, "-");
    return slug === camel || slug === kebab;
  });
}
