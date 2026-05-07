import { nanoid } from "nanoid";
import type { Asset, Entity } from "@/models";
import {
  cleanImageReferenceValue,
  looksLikeDirectImageReference,
  looksLikeDriveReference,
} from "@/features/data/imageReferences";
import { FIELD_ALIASES, FIELD_LABELS_VI, METADATA_FIELDS, normalizeKey, parseBool, parseList, parseNumber } from "./aliases";

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

/** Option list đã việt hoá cho dropdown mapping. */
export function standardFieldOptionsLabeled(): Array<{ value: string; label: string }> {
  return standardFieldOptions().map((v) => ({
    value: v,
    label: FIELD_LABELS_VI[v] ?? v,
  }));
}

export function normalizeRows(rows: RawRow[], mapping: FieldMapping, sheetName?: string): NormalizeResult {
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
    const imageRaw = cleanImageReferenceValue(std.image);
    const imagesRaw = parseList(std.images).map(cleanImageReferenceValue).filter(Boolean);
    const allImageRefs = [imageRaw, ...imagesRaw].filter(Boolean);
    const downloadableImageRefs = allImageRefs.filter(
      (url) => looksLikeDriveReference(url) || !looksLikeDirectImageReference(url),
    );
    const directImageUrls = allImageRefs.filter(
      (url) => !looksLikeDriveReference(url) && looksLikeDirectImageReference(url),
    );

    // Gom các trường tuỳ ý (day, description, signatureDish, hoặc bất kỳ key chưa nhận diện) vào metadata
    const metadata: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(std)) {
      if (v == null || v === "") continue;
      if (METADATA_FIELDS.has(k)) {
        const n = parseNumber(v, NaN);
        metadata[k] =
          Number.isFinite(n) && k === "day"
            ? n
            : k === "imageRef"
              ? cleanImageReferenceValue(v) || String(v).trim()
              : String(v).trim();
      } else if (!(k in FIELD_ALIASES) && k !== "image" && k !== "images") {
        // Cột "lạ" không có trong alias chuẩn → giữ nguyên trong metadata để filterRules dùng
        metadata[k] = String(v).trim();
      }
    }
    if (downloadableImageRefs.length > 0) {
      const currentImageRef = metadata.imageRef ? String(metadata.imageRef) : "";
      metadata.imageRef = [currentImageRef, ...downloadableImageRefs].filter(Boolean).join(" | ");
    }
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
      sheetName: sheetName?.trim() || undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    };
    entities.push(entity);

    // Xử lý ảnh
    directImageUrls.forEach((url, i) => {
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

    if (allImageRefs.length === 0) {
      warnings.push(`Dòng ${idx + 1} (${name}): không có ảnh`);
    }
  });

  return { entities, assets, warnings };
}
