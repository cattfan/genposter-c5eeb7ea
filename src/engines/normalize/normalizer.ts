import { nanoid } from "nanoid";
import type { Asset, Entity } from "@/models";
import { FIELD_ALIASES, normalizeKey, parseBool, parseList, parseNumber } from "./aliases";

export interface RawRow {
  [key: string]: unknown;
}

export interface NormalizeResult {
  entities: Entity[];
  assets: Asset[];
  warnings: string[];
}

export interface FieldMapping {
  // raw column key -> standard field name
  [rawKey: string]: string;
}

/**
 * Tự suy mapping mặc định bằng alias
 */
export function autoMap(headers: string[]): FieldMapping {
  const map: FieldMapping = {};
  for (const h of headers) map[h] = normalizeKey(h);
  return map;
}

export function standardFieldOptions(): string[] {
  return ["__ignore__", ...Object.keys(FIELD_ALIASES)];
}

export function normalizeRows(rows: RawRow[], mapping: FieldMapping): NormalizeResult {
  const entities: Entity[] = [];
  const assets: Asset[] = [];
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    const std: Record<string, unknown> = {};
    for (const [rawKey, val] of Object.entries(row)) {
      const std_key = mapping[rawKey] ?? normalizeKey(rawKey);
      if (std_key === "__ignore__") continue;
      std[std_key] = val;
    }

    const name = std.name ? String(std.name).trim() : "";
    if (!name) {
      warnings.push(`Dòng ${idx + 1}: thiếu tên, đã bỏ qua`);
      return;
    }

    const entityId = nanoid();
    const entity: Entity = {
      entityId,
      name,
      categoryMain: std.categoryMain ? String(std.categoryMain).trim() : undefined,
      categorySub: std.categorySub ? String(std.categorySub).trim() : undefined,
      address: std.address ? String(std.address).trim() : undefined,
      phone: std.phone ? String(std.phone).trim() : undefined,
      openingHours: std.openingHours ? String(std.openingHours).trim() : undefined,
      style: std.style ? String(std.style).trim() : undefined,
      priceRange: std.priceRange ? String(std.priceRange).trim() : undefined,
      partnerFlag: parseBool(std.partnerFlag),
      partnerPriority: parseNumber(std.partnerPriority, 0),
      partnerType: (std.partnerType as Entity["partnerType"]) ?? "none",
      campaignTags: parseList(std.campaignTags),
      seoKeywords: parseList(std.seoKeywords),
      status: "active",
      sourceRowId: String(idx),
    };
    entities.push(entity);

    // Xử lý ảnh
    const imageRaw = std.image ? String(std.image).trim() : "";
    const imagesRaw = parseList(std.images);
    const allImgs = [imageRaw, ...imagesRaw].filter(Boolean);
    allImgs.forEach((url, i) => {
      assets.push({
        assetId: nanoid(),
        entityId,
        sourceType: url.startsWith("http") ? "url" : "local",
        sourceValue: url,
        role: i === 0 ? "cover" : "generic",
        isCover: i === 0,
        qualityScore: 70,
        status: "ok",
      });
    });

    if (allImgs.length === 0) {
      warnings.push(`Dòng ${idx + 1} (${name}): không có ảnh`);
    }
  });

  return { entities, assets, warnings };
}
