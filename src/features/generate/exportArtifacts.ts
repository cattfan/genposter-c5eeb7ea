import * as XLSX from "xlsx";
import { callAi } from "@/features/ai/aiClient";
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
  const text = await buildTikTokCaptionText(input);
  return new Blob([text], { type: "text/plain;charset=utf-8" });
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

export async function buildTikTokCaptionText(input: {
  packName: string;
  bundleLabel?: string;
  pages: ExportPageEntityData[];
  entities: Entity[];
  variantCount?: number;
}): Promise<string> {
  const usedEntities = collectUsedEntities(input.pages, input.entities);
  const variantCount = 1;
  const aiVariants = await requestAiCaptions({
    packName: input.packName,
    bundleLabel: input.bundleLabel,
    entities: usedEntities,
    variantCount,
  });
  const variants =
    aiVariants.length > 0
      ? aiVariants
      : buildFallbackCaptions(input.packName, input.bundleLabel, usedEntities, variantCount);

  return variants
    .slice(0, variantCount)
    .map((variant) => formatCaptionVariant(variant, 1, input.bundleLabel))
    .join("\n");
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

function collectPartnerLikeEntities(pages: ExportPageEntityData[], entities: Entity[]): Entity[] {
  const used = collectUsedEntities(pages, entities);
  const flaggedIds = new Set<string>();
  for (const page of pages) {
    if (page.entityId) {
      const owner = entities.find((entity) => entity.entityId === page.entityId);
      if (owner?.partnerFlag) flaggedIds.add(page.entityId);
    }
    for (const item of page.items ?? []) {
      if (item.partnerFlag && item.entityId) flaggedIds.add(item.entityId);
    }
  }

  const partners = used.filter((entity) => entity.partnerFlag || flaggedIds.has(entity.entityId));
  return partners.length > 0 ? partners : used;
}

async function requestAiCaptions(input: {
  packName: string;
  bundleLabel?: string;
  entities: Entity[];
  variantCount: number;
}): Promise<CaptionVariant[]> {
  const payload = {
    packName: input.packName,
    bundleLabel: input.bundleLabel,
    variantCount: input.variantCount,
    fixedHashtags: FIXED_HASHTAGS,
    entities: input.entities.slice(0, 30).map((entity) => ({
      name: entity.name,
      address: entity.address,
      categoryMain: entity.categoryMain,
      categorySub: entity.categorySub,
      style: entity.style,
      priceRange: entity.priceRange,
      openingHours: entity.openingHours,
      seoKeywords: entity.seoKeywords,
      metadata: entity.metadata,
      partnerFlag: entity.partnerFlag,
    })),
  };

  try {
    const result = await callAi({
      messages: [
        {
          role: "system",
          content:
      "Bạn viết chú thích TikTok tiếng Việt cho bộ ảnh du lịch Đà Lạt. " +
            "Chỉ dùng dữ liệu được đưa vào, không bịa tên, địa chỉ, giá hoặc ưu đãi. " +
            "Trả về JSON object duy nhất theo schema: " +
            '{"captions":[{"headline":"...","body":"...","hashtags":["#..."]}]}. ' +
            "Mỗi headline phải VIẾT HOA, giật gân, dưới 90 ký tự. " +
            "Mỗi body tối đa 300 ký tự, có từ khóa SEO liên quan. " +
            "Mỗi hashtags đúng 5 hashtag: #riviudalat, #dalat, #dalatreview và 2 hashtag viết liền không dấu.",
        },
        {
          role: "user",
          content: JSON.stringify(payload, null, 2),
        },
      ],
      temperature: 0.75,
    });
    if (!result.ok) return [];
    return parseAiCaptionJson(result.content ?? "", input.entities).slice(0, input.variantCount);
  } catch {
    return [];
  }
}

function parseAiCaptionJson(raw: string, entities: Entity[]): CaptionVariant[] {
  const jsonText = extractJson(raw);
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as {
      captions?: Array<{ headline?: unknown; body?: unknown; hashtags?: unknown }>;
    };
    return (parsed.captions ?? [])
      .map((caption) =>
        normalizeCaptionVariant(
          String(caption.headline ?? ""),
          String(caption.body ?? ""),
          Array.isArray(caption.hashtags) ? caption.hashtags.map(String) : [],
          entities,
        ),
      )
      .filter((caption) => caption.headline && caption.body);
  } catch {
    return [];
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
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
// Publish bundle (ZIP) helpers.
// Output files are intentionally minimal for handoff: poster images at ZIP
// root, caption.txt, and doitac.xlsx when requested.

interface PublishManifestEntry {
  file: string;
  pageIndex: number;
  pageName?: string;
  entityId?: string;
  entityName?: string;
  partnerFlag?: boolean;
  templateId?: string;
  templateName?: string;
}

export interface PublishManifest {
  generatedAt: string;
  packName: string;
  bundleLabel?: string;
  imageCount: number;
  entityIds: string[];
  pages: PublishManifestEntry[];
}

function buildPublishManifest(input: {
  packName: string;
  bundleLabel?: string;
  pages: ExportPageEntityData[];
  entities: Entity[];
  files: Array<{ name: string; pageIndex: number; templateId?: string; templateName?: string }>;
}): PublishManifest {
  const entityMap = new Map(input.entities.map((e) => [e.entityId, e]));
  const pageMap = new Map<number, ExportPageEntityData>();
  input.pages.forEach((page, idx) => {
    const pageIndex = (page as ExportPageEntityData & { pageIndex?: number }).pageIndex ?? idx;
    pageMap.set(pageIndex, page);
  });
  const usedEntityIds = new Set<string>();
  const entries: PublishManifestEntry[] = input.files.map((file) => {
    const page = pageMap.get(file.pageIndex);
    const entity = page?.entityId ? entityMap.get(page.entityId) : undefined;
    if (page?.entityId) usedEntityIds.add(page.entityId);
    for (const item of page?.items ?? []) {
      if (item.entityId) usedEntityIds.add(item.entityId);
    }
    return {
      file: file.name,
      pageIndex: file.pageIndex,
      pageName: page?.pageName,
      entityId: page?.entityId,
      entityName: entity?.name ?? page?.entityName,
      partnerFlag: entity?.partnerFlag,
      templateId: file.templateId,
      templateName: file.templateName,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    packName: input.packName,
    bundleLabel: input.bundleLabel,
    imageCount: input.files.length,
    entityIds: Array.from(usedEntityIds),
    pages: entries,
  };
}

/**
 * Extract hashtag list from caption text. Deduplicates while preserving order.
 * The caption builder tends to repeat `#riviudalat`, `#dalat`, `#dalatreview`
 * across variants so we only want each tag once.
 */
function extractHashtagLines(captionText: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const tokens = captionText.match(/#[\p{L}0-9_]+/gu) ?? [];
  for (const raw of tokens) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function buildBundleSlug(bundleLabel: string | undefined): string {
  const clean = stripVietnamese(bundleLabel ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const number = clean.match(/\d+/)?.[0];
  if (number) return `bo${number}`;
  const slug = clean.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "bo1";
}

function getImageExtension(fileName: string, blob: Blob): string {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  const extension = fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (extension && ["png", "jpg", "jpeg", "webp"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }
  return "png";
}

export interface PublishBundleInput {
  packName: string;
  bundleLabel?: string;
  images: Array<{ fileName: string; blob: Blob; pageIndex: number; templateId?: string; templateName?: string }>;
  pages: Array<ExportPageEntityData & { pageIndex: number }>;
  entities: Entity[];
  variantCount?: number;
  includePartnerWorkbook?: boolean;
}

export interface PublishBundleArtifacts {
  files: Array<{ name: string; blob: Blob }>;
  captionText: string;
  hashtags: string[];
  manifest: PublishManifest;
}

/**
 * Build a complete publish-ready bundle in memory. Returns both the files ready
 * for JSZip and auxiliary data (captionText, hashtags, manifest) so the caller
 * can surface previews in the UI before triggering the download.
 */
export async function buildPublishBundle(
  input: PublishBundleInput,
): Promise<PublishBundleArtifacts> {
  const variantCount = 1;

  const bundleSlug = buildBundleSlug(input.bundleLabel);
  const imageFiles = input.images.map((entry, index) => ({
    name: `${index + 1}.${getImageExtension(entry.fileName, entry.blob)}`,
    blob: entry.blob,
    pageIndex: entry.pageIndex,
    templateId: entry.templateId,
    templateName: entry.templateName,
  }));

  const captionText = await buildTikTokCaptionText({
    packName: input.packName,
    bundleLabel: input.bundleLabel,
    pages: input.pages,
    entities: input.entities,
    variantCount,
  });
  const hashtags = extractHashtagLines(captionText);

  const manifest = buildPublishManifest({
    packName: input.packName,
    bundleLabel: input.bundleLabel,
    pages: input.pages,
    entities: input.entities,
    files: imageFiles.map((f) => ({
      name: f.name,
      pageIndex: f.pageIndex,
      templateId: f.templateId,
      templateName: f.templateName,
    })),
  });

  const files: Array<{ name: string; blob: Blob }> = [
    ...imageFiles.map((f) => ({ name: f.name, blob: f.blob })),
    {
      name: "caption.txt",
      blob: new Blob([captionText], { type: "text/plain;charset=utf-8" }),
    },
  ];

  if (input.includePartnerWorkbook !== false) {
    files.push({
      name: "doitac.xlsx",
      blob: buildPartnerWorkbookBlob({ pages: input.pages, entities: input.entities }),
    });
  }

  return { files, captionText, hashtags, manifest };
}
