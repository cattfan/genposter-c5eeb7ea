import * as XLSX from "xlsx";
import type { Entity, RenderedItem } from "@/models";

export interface ExportPageEntityData {
  pageFile?: string;
  pageName?: string;
  entityId?: string;
  entityName?: string;
  items?: RenderedItem[];
}

interface CaptionVariant {
  headline: string;
  body: string;
  hashtags: string[];
}

const FIXED_HASHTAGS = ["#riviudalat", "#dalat", "#dalatreview"];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8";

export function buildPartnerWorkbookBlob(input: {
  pages: ExportPageEntityData[];
  entities: Entity[];
}): Blob {
  const used = collectUsedEntities(input.pages, input.entities);
  const partners = used.filter((e) => e.partnerFlag);

  const workbook = XLSX.utils.book_new();

  if (partners.length === 0) {
    const dataRows = [["Không có đối tác"]];
    const sheet = XLSX.utils.aoa_to_sheet(dataRows);
    sheet["!cols"] = [{ wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "doitac");
  } else {
    const dataRows = [partners.map((entity) => entity.name || "")];
    const sheet = XLSX.utils.aoa_to_sheet(dataRows);
    sheet["!cols"] = partners.map((entity) => ({
      wch: Math.max(18, Math.min(36, (entity.name || "").length + 4)),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, "doitac");
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([buffer], { type: XLSX_MIME });
}

export async function buildTikTokCaptionBlob(input: {
  packName: string;
  bundleLabel?: string;
  pages: ExportPageEntityData[];
  entities: Entity[];
  variantCount?: number;
}): Promise<Blob> {
  // AI caption tạm tắt (xem Milestone A plan): API gọi AI hay treo/timeout 15s
  // mỗi bundle, nhiều khi sinh trùng nội dung. Dùng fallback local cho ổn định.
  // Giữ async signature để các caller hiện tại không phải sửa.
  return buildFallbackCaptionBlob(input);
}

/**
 * Build caption blob using only local fallback templates (no AI call).
 * Use this for batch/multi-bundle exports to avoid slow network calls.
 */
export function buildFallbackCaptionBlob(input: {
  packName: string;
  bundleLabel?: string;
  pages: ExportPageEntityData[];
  entities: Entity[];
  variantCount?: number;
}): Blob {
  const usedEntities = collectUsedEntities(input.pages, input.entities);
  const variantCount = 1;
  const variants = buildFallbackCaptions(input.packName, input.bundleLabel, usedEntities, variantCount);
  const text = variants
    .slice(0, variantCount)
    .map((variant) => formatCaptionVariant(variant, 1, input.bundleLabel))
    .join("\n");
  return new Blob([text], { type: "text/plain;charset=utf-8" });
}

function collectUsedEntities(pages: ExportPageEntityData[], entities: Entity[]): Entity[] {
  const entityMap = new Map(entities.map((entity) => [entity.entityId, entity]));
  const ids = new Set<string>();
  for (const page of pages) {
    if (page.entityId) ids.add(page.entityId);
    for (const item of page.items ?? []) {
      if (item.entityId) ids.add(item.entityId);
    }
  }
  return Array.from(ids)
    .map((id) => entityMap.get(id))
    .filter((entity): entity is Entity => !!entity);
}

function buildFallbackCaptions(
  packName: string,
  bundleLabel: string | undefined,
  entities: Entity[],
  count: number,
): CaptionVariant[] {
  const names = entities.map((entity) => entity.name).filter(Boolean);
  const topNames = names.slice(0, 4).join(", ");
  const seoKeywords = buildSeoKeywords(entities);
  const variants: Array<{ headline: string; body: string }> = [
    {
      headline: `ĐÀ LẠT HÓA RA CÓ CẢ LIST SPOT XỊN MLEM VẬY`,
      body: topNames.length > 0
        ? `Em thề những địa điểm này rất đáng để lưu lại. Gồm ${topNames}. Dùng cẩm nang này, lịch trình du lịch Đà Lạt sẽ chất hơn, ${seoKeywords}. Không sợ trôi giữa muôn vàn lựa chọn đâu.`
        : `Em thề những địa điểm này rất đáng để lưu lại. Dùng cẩm nang ${packName.toLowerCase()} này, lịch trình du lịch Đà Lạt sẽ chất hơn, ${seoKeywords}. Không sợ trôi giữa muôn vàn lựa chọn.`,
    },
    {
      headline: `LƯU NGAY ${names.length || "BỘ"} GỢI Ý ĐÀ LẠT TRƯỚC KHI ĐI`,
      body: topNames.length > 0
        ? `Mình tổng hợp ${packName.toLowerCase()} với ${topNames}. Ai đi Đà Lạt mà chưa biết đi đâu, ăn gì, ở đâu thì save post này. Review chi tiết ${seoKeywords}.`
        : `Mình tổng hợp ${packName.toLowerCase()} cho ai đi Đà Lạt mà chưa biết đi đâu, ăn gì, ở đâu. Save post này lại. Review chi tiết ${seoKeywords}.`,
    },
    {
      headline: `ĐI ĐÀ LẠT HOÀI KHÔNG CHÁN VÌ CÓ LIST NÀY`,
      body: topNames.length > 0
        ? `Toàn chỗ chất lượng: ${topNames}. Lưu lại rồi tag đứa hay rủ đi Đà Lạt để lên lịch ngay. Cẩm nang du lịch Đà Lạt, ${seoKeywords} đầy đủ nhất.`
        : `Toàn chỗ chất lượng, lưu lại rồi tag đứa hay rủ đi Đà Lạt để lên lịch ngay. Cẩm nang du lịch Đà Lạt, ${seoKeywords} đầy đủ nhất.`,
    },
    {
      headline: `NEWBIE ĐÀ LẠT NHẤT ĐỊNH PHẢI BIẾT NHỮNG CHỖ NÀY`,
      body: topNames.length > 0
        ? `Lần đầu đi Đà Lạt? Đây là ${packName.toLowerCase()} mình recommend: ${topNames}. Đi theo list này khỏi lo lạc. Checkin, review, ${seoKeywords} chuẩn nhất.`
        : `Lần đầu đi Đà Lạt? Đây là ${packName.toLowerCase()} mình recommend. Đi theo list này khỏi lo lạc. Checkin, review, ${seoKeywords} chuẩn nhất.`,
    },
  ];

  return Array.from({ length: count }, (_, index) => {
    const variant = variants[index % variants.length];
    return normalizeCaptionVariant(variant.headline, variant.body, [], entities);
  });
}

function buildSeoKeywords(entities: Entity[]): string {
  const cats = new Set<string>();
  for (const e of entities) {
    if (e.categoryMain) cats.add(e.categoryMain);
    if (e.categorySub) cats.add(e.categorySub);
  }
  const catMap: Record<string, string> = {
    cafe: "cafe view đẹp",
    quan_an: "quán ăn ngon",
    homestay: "homestay xinh",
    checkin: "điểm checkin",
    spa: "spa thư giãn",
    thue_xe: "thuê xe tự lái",
  };
  const keywords = Array.from(cats)
    .map((c) => catMap[c] || c)
    .slice(0, 3);
  return keywords.length > 0 ? keywords.join(", ") : "cafe, quán ăn, homestay";
}

function normalizeCaptionVariant(
  headline: string,
  body: string,
  hashtags: string[],
  entities: Entity[],
): CaptionVariant {
  return {
    headline: trimAt(headline.toUpperCase(), 90),
    body: trimAt(body.replace(/\s+/g, " ").trim(), 300),
    hashtags: ensureHashtags(hashtags, entities),
  };
}

function ensureHashtags(tags: string[], entities: Entity[]): string[] {
  const dynamic = buildDynamicHashtags(entities);
  const normalizedTags = tags.map(normalizeHashtag).filter(Boolean);
  const unique = new Set([...FIXED_HASHTAGS, ...normalizedTags, ...dynamic]);
  return Array.from(unique).slice(0, 5);
}

function buildDynamicHashtags(entities: Entity[]): string[] {
  const text = entities
    .flatMap((entity) => [
      entity.categoryMain,
      entity.categorySub,
      entity.style,
      ...entity.seoKeywords,
      ...Object.values(entity.metadata ?? {}).map(String),
    ])
    .join(" ")
    .toLowerCase();
  const candidates = [
    text.includes("homestay") && "#homestaydalat",
    text.includes("cafe") && "#cafedalat",
    text.includes("check") && "#checkindalat",
    text.includes("ăn") && "#andalat",
    text.includes("spa") && "#thugiandalat",
    "#dulichdalat",
    "#reviewdalat",
    "#dalatcheckin",
  ].filter(Boolean) as string[];
  return Array.from(new Set(candidates.map(normalizeHashtag).filter(Boolean))).slice(0, 4);
}

function normalizeHashtag(tag: string): string {
  const body = stripVietnamese(String(tag))
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9]+/g, "");
  return body ? `#${body}` : "";
}

function stripVietnamese(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function trimAt(value: string, max: number): string {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

function formatCaptionVariant(
  caption: CaptionVariant,
  index: number,
  bundleLabel: string | undefined,
): string {
  return [
    caption.headline,
    caption.body,
    caption.hashtags.join(" "),
  ].join("\n");
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(stringifyCell).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
