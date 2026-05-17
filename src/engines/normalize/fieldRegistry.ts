// Field Registry — nguồn chân lý duy nhất cho tất cả field của Entity.
//
// Trước khi có file này, tồn tại 4 alias map riêng:
//   - ENTITY_FIELD_ALIASES         ở engines/binding/dataBinding.ts (cho binding)
//   - aliases nội bộ trong         normalizeEntityListField (binding list)
//   - FIELD_ALIASES                ở engines/normalize/aliases.ts   (cho data import)
//   - PLACEHOLDER_BINDING_MAP      ở features/generate/autoBindPlaceholders.ts
//   - dataColumns hardcode         ở routes/generate.tsx (đã xoá ở Milestone A)
//   - textListFieldOptions         ở features/generate/PackTabContent.tsx
//
// Mỗi map có cách đánh vần token hơi khác nhau ("ten quan" vs "ten_quan"...)
// và bộ trường không khớp 100%. Hệ quả: thêm 1 field mới phải sửa 4 chỗ và rất
// dễ quên 1 chỗ. Registry này gom chúng vào 1 chỗ.

import type { Entity } from "@/models";

export type EntityFieldKind = "string" | "number" | "list" | "boolean";

export interface EntityFieldDefinition {
  /** ID nội bộ, không hiện UI. Trùng với key của aliases.ts cũ để dễ migrate. */
  id: string;
  /** Đường dẫn binding chuẩn dùng cho slot.bindingPath. */
  bindingPath: string;
  /** Nhãn tiếng Việt hiển thị trong dropdown mapping / panel binding. */
  labelVi: string;
  /** Nhóm UI: trường có sẵn trên Entity vs trường nằm trong metadata. */
  group: "core" | "metadata" | "asset";
  /** Tên header sheet/CSV được chấp nhận map vào trường này. */
  aliases: string[];
  /** Token AI đặt trong {{...}} placeholder của staticText (autoBind). */
  placeholderTokens: string[];
  /** Loại dữ liệu — đùng để validate sau này. */
  kind: EntityFieldKind;
  /**
   * Trường này có nằm trong entity.metadata thay vì trên Entity trực tiếp?
   * (signatureDish, description, ...). Khớp với METADATA_FIELDS cũ.
   */
  storedInMetadata?: boolean;
}

/**
 * Danh sách trường chuẩn. Thứ tự ảnh hưởng UI dropdown.
 * QUY ƯỚC:
 * - aliases viết dạng raw từng có trong sheet (giữ tiếng Việt có dấu, hyphen, space).
 *   Hàm `normalizeFieldToken` sẽ đưa về dạng so sánh được.
 * - placeholderTokens KHÔNG kèm hậu tố `_<số>` ("name", không phải "name_0") —
 *   `lookupByPlaceholder` tự strip suffix trước khi tra.
 * - bindingPath: "entity.X" cho core, "entity.metadata.X" cho metadata,
 *   ngoại lệ "entity.signatureDish" KHÔNG có prefix metadata vì readEntityTextValue
 *   xử lý đặc biệt (xem dataBinding.ts:334).
 */
export const ENTITY_FIELDS: EntityFieldDefinition[] = [
  {
    id: "name",
    bindingPath: "entity.name",
    labelVi: "Tên",
    group: "core",
    aliases: [
      "name",
      "ten",
      "ten_quan",
      "tên",
      "tên quán",
      "ten quan",
      "title",
      "tieu_de",
      "tieu de",
      "hoat_dong",
      "hoat dong",
      "tên địa điểm",
      "ten dia diem",
      "tên homestay",
      "ten homestay",
      "địa điểm",
      "dia_diem",
      "dia diem",
    ],
    placeholderTokens: ["name", "ten", "ten_quan", "title", "tieu_de", "hoat_dong", "dia_diem", "ten_dia_diem"],
    kind: "string",
  },
  {
    id: "address",
    bindingPath: "entity.address",
    labelVi: "Địa chỉ",
    group: "core",
    aliases: ["address", "dia_chi", "địa chỉ", "dia chi", "addr", "vị trí", "vi tri", "location"],
    placeholderTokens: ["address", "dia_chi", "location"],
    kind: "string",
  },
  {
    id: "phone",
    bindingPath: "entity.phone",
    labelVi: "SĐT",
    group: "core",
    aliases: ["phone", "sdt", "hotline", "điện thoại", "dien_thoai", "so_dien_thoai"],
    placeholderTokens: ["phone", "sdt", "hotline", "so_dien_thoai"],
    kind: "string",
  },
  {
    id: "priceRange",
    bindingPath: "entity.priceRange",
    labelVi: "Khoảng giá",
    group: "core",
    aliases: [
      "price",
      "gia",
      "giá",
      "khoảng giá",
      "khoang_gia",
      "priceRange",
      "chi phí",
      "chi phi",
      "cost",
      "gia_ve_tham_khao_vnd_ve",
      "gia ve tham khao vnd ve",
    ],
    placeholderTokens: ["price", "pricerange", "price_range", "gia"],
    kind: "string",
  },
  {
    id: "openingHours",
    bindingPath: "entity.openingHours",
    labelVi: "Giờ mở cửa",
    group: "core",
    aliases: ["hours", "gio_mo_cua", "giờ mở cửa", "open", "khung_gio", "khung gio"],
    placeholderTokens: ["hours", "openinghours", "opening_hours", "gio_mo_cua", "khung_gio"],
    kind: "string",
  },
  {
    id: "categoryMain",
    bindingPath: "entity.categoryMain",
    labelVi: "Mô hình / Loại dịch vụ",
    group: "core",
    aliases: [
      "category",
      "categoryMain",
      "loai",
      "loại",
      "loai_hinh",
      "loại hình",
      "mo_hinh",
      "mô hình",
      "type",
      "nhóm",
      "nhom",
      "loai_dich_vu",
      "loại dịch vụ",
      "loai dich vu",
      "dich_vu",
      "dịch vụ",
      "danh_muc",
      "danh muc",
    ],
    placeholderTokens: ["category", "categorymain", "category_main", "mo_hinh", "loai_dich_vu", "danh_muc"],
    kind: "string",
  },
  {
    id: "categorySub",
    bindingPath: "entity.categorySub",
    labelVi: "Phong cách phụ",
    group: "core",
    aliases: [
      "sub",
      "subcategory",
      "categorySub",
      "loai_phu",
      "loại phụ",
      "phong_cach",
      "phong cách",
    ],
    placeholderTokens: ["subcategory", "categorysub", "category_sub", "phong_cach"],
    kind: "string",
  },
  {
    id: "style",
    bindingPath: "entity.style",
    labelVi: "Phong cách",
    group: "core",
    aliases: ["style"],
    placeholderTokens: ["style"],
    kind: "string",
  },
  {
    id: "signatureDish",
    bindingPath: "entity.metadata.signatureDish",
    labelVi: "Món / điểm nhấn",
    group: "metadata",
    aliases: [
      "mon_an_noi_bat",
      "món ăn nổi bật",
      "mon_noi_bat",
      "signature",
      "signatureDish",
      "highlight",
      "noi_bat",
      "noi bat",
    ],
    placeholderTokens: ["signature_dish", "signaturedish", "mon_an_noi_bat", "mon_noi_bat", "noi_bat", "highlight"],
    kind: "string",
    storedInMetadata: true,
  },
  {
    id: "description",
    bindingPath: "entity.metadata.description",
    labelVi: "Mô tả / ghi chú",
    group: "metadata",
    aliases: [
      "description",
      "desc",
      "mô tả",
      "mo ta",
      "ghi chú",
      "ghi chu",
      "notes",
      "giai_thich",
      "giai thich",
    ],
    // subtitle/mo_ta_ngan giữ tương thích với autoBindPlaceholders cũ
    placeholderTokens: ["description", "desc", "mo_ta", "subtitle", "mo_ta_ngan", "ghi_chu", "giai_thich"],
    kind: "string",
    storedInMetadata: true,
  },
  {
    id: "partnerFlag",
    bindingPath: "entity.partnerFlag",
    labelVi: "Đối tác (cờ)",
    group: "core",
    aliases: ["partner", "doi_tac", "đối tác", "doi tac", "sponsor", "partnerFlag"],
    placeholderTokens: [],
    kind: "boolean",
  },
  {
    id: "partnerPriority",
    bindingPath: "entity.partnerPriority",
    labelVi: "Độ ưu tiên đối tác",
    group: "core",
    aliases: ["priority", "uu_tien", "ưu tiên", "partnerPriority"],
    placeholderTokens: [],
    kind: "number",
  },
  {
    id: "partnerType",
    bindingPath: "entity.partnerType",
    labelVi: "Loại đối tác",
    group: "core",
    aliases: ["partnerType", "loai_doi_tac", "loại đối tác"],
    placeholderTokens: [],
    kind: "string",
  },
  {
    id: "campaignTags",
    bindingPath: "entity.campaignTags",
    labelVi: "Tag chiến dịch",
    group: "core",
    aliases: ["tags", "campaign", "campaignTags", "chien_dich", "chiến dịch"],
    placeholderTokens: [],
    kind: "list",
  },
  {
    id: "seoKeywords",
    bindingPath: "entity.seoKeywords",
    labelVi: "Từ khoá SEO",
    group: "core",
    aliases: ["keywords", "seo", "seoKeywords"],
    placeholderTokens: [],
    kind: "list",
  },
];

/**
 * Trường chỉ tồn tại trong metadata (không phải trường top-level Entity).
 * Khớp với METADATA_FIELDS cũ ở aliases.ts.
 */
export const METADATA_ONLY_FIELD_IDS = new Set(
  ENTITY_FIELDS.filter((field) => field.storedInMetadata).map((field) => field.id),
);

/**
 * Helper: chuẩn hoá 1 token (header sheet, key alias, placeholder) về dạng
 * so sánh được. Logic: NFD + strip combining + đ/Đ → d + lowercase + non-alnum
 * → "_" + strip leading/trailing "_". Đồng nhất với normalizeAliasToken cũ.
 */
export function normalizeFieldToken(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Build các index lazy để lookup O(1).
let aliasIndex: Map<string, EntityFieldDefinition> | null = null;
let placeholderIndex: Map<string, EntityFieldDefinition> | null = null;
let bindingPathIndex: Map<string, EntityFieldDefinition> | null = null;
let idIndex: Map<string, EntityFieldDefinition> | null = null;

function getAliasIndex(): Map<string, EntityFieldDefinition> {
  if (aliasIndex) return aliasIndex;
  const map = new Map<string, EntityFieldDefinition>();
  for (const field of ENTITY_FIELDS) {
    for (const alias of field.aliases) {
      const key = normalizeFieldToken(alias);
      if (!key) continue;
      // Nếu trùng alias giữa các field, ưu tiên field định nghĩa trước
      // (giống behaviour cũ: Object.entries giữ thứ tự, trả lời hit đầu tiên).
      if (!map.has(key)) map.set(key, field);
    }
    // Cho phép tra bằng id thô và bindingPath cuối ("name", "address",...)
    const idKey = normalizeFieldToken(field.id);
    if (!map.has(idKey)) map.set(idKey, field);
  }
  aliasIndex = map;
  return map;
}

function getPlaceholderIndex(): Map<string, EntityFieldDefinition> {
  if (placeholderIndex) return placeholderIndex;
  const map = new Map<string, EntityFieldDefinition>();
  for (const field of ENTITY_FIELDS) {
    for (const token of field.placeholderTokens) {
      const key = normalizeFieldToken(token);
      if (!key) continue;
      if (!map.has(key)) map.set(key, field);
    }
  }
  placeholderIndex = map;
  return map;
}

function getBindingPathIndex(): Map<string, EntityFieldDefinition> {
  if (bindingPathIndex) return bindingPathIndex;
  const map = new Map<string, EntityFieldDefinition>();
  for (const field of ENTITY_FIELDS) {
    map.set(field.bindingPath, field);
  }
  bindingPathIndex = map;
  return map;
}

function getIdIndex(): Map<string, EntityFieldDefinition> {
  if (idIndex) return idIndex;
  const map = new Map<string, EntityFieldDefinition>();
  for (const field of ENTITY_FIELDS) {
    map.set(field.id, field);
  }
  idIndex = map;
  return map;
}

/**
 * Tra field theo alias / header sheet. Token được normalize trước khi lookup.
 * Trả về undefined nếu không match field nào.
 */
export function lookupByAlias(token: string | undefined): EntityFieldDefinition | undefined {
  if (!token) return undefined;
  const key = normalizeFieldToken(token);
  if (!key) return undefined;
  return getAliasIndex().get(key);
}

/**
 * Tra field từ placeholder token (đã strip "{{" "}}" và hậu tố `_<số>`).
 * Hàm KHÔNG tự strip {{}} — caller responsibility.
 */
export function lookupByPlaceholder(token: string | undefined): EntityFieldDefinition | undefined {
  if (!token) return undefined;
  const key = normalizeFieldToken(token).replace(/_\d+$/u, "");
  if (!key) return undefined;
  return getPlaceholderIndex().get(key);
}

export function lookupByBindingPath(path: string | undefined): EntityFieldDefinition | undefined {
  if (!path) return undefined;
  return getBindingPathIndex().get(path);
}

export function lookupById(id: string | undefined): EntityFieldDefinition | undefined {
  if (!id) return undefined;
  return getIdIndex().get(id);
}

/**
 * Trả về regex pattern (string, không có flag) để bắt suffix `_<số>` đứng cuối
 * token semantic — cardRepeater dùng để biết slot "name_2", "address_2" thuộc
 * card #2. Pattern bao quanh bằng (?:^|_) ở đầu và (?:_|$) ở cuối.
 */
export function buildSemanticIndexAlternation(): string {
  const tokens = new Set<string>();
  for (const field of ENTITY_FIELDS) {
    for (const alias of field.placeholderTokens) {
      const normalized = normalizeFieldToken(alias);
      if (normalized) tokens.add(normalized);
    }
    tokens.add(normalizeFieldToken(field.id));
  }
  // Thêm vài alias structural không phải field cụ thể (giữ y hệt regex cũ)
  ["list_line", "line", "row", "item", "text", "composite", "block"].forEach((t) => tokens.add(t));
  // Sắp dài-trước để regex không match nhầm prefix ngắn
  return Array.from(tokens).sort((a, b) => b.length - a.length).join("|");
}

export interface FieldOptionForUi {
  /** bindingPath chuẩn — set thẳng vào slot.bindingPath. */
  path: string;
  /** Nhãn UI tiếng Việt. */
  label: string;
  /** Mẫu giá trị từ entity preview, đã trim ngắn — nếu caller truyền entity. */
  sample?: string;
  /** id để key React. */
  id: string;
}

/**
 * Sinh option list cho UI binding panel / mapping column.
 * Lọc các trường có placeholderTokens rỗng (partnerFlag, campaignTags, ...) ra
 * khỏi default vì hiếm khi bind 1 slot text vào partnerFlag.
 *
 * @param entitiesPreview — nếu truyền, lọc field nào có ít nhất 1 entity có
 * giá trị tương ứng và đính kèm `sample` từ entity đầu có data.
 */
export function entityFieldOptionsForUi(
  entitiesPreview?: Entity[],
  options: { includeEmptyPreview?: boolean; truncate?: number } = {},
): FieldOptionForUi[] {
  const truncate = options.truncate ?? 28;
  const includeEmptyPreview = options.includeEmptyPreview ?? false;
  const truncateValue = (value: unknown) => {
    if (value == null) return "";
    const text = String(value).trim();
    return text.length > truncate ? `${text.slice(0, truncate - 1)}…` : text;
  };

  const out: FieldOptionForUi[] = [];
  for (const field of ENTITY_FIELDS) {
    if (field.placeholderTokens.length === 0) continue; // bỏ partner*/tags/...
    const sample = entitiesPreview
      ? entitiesPreview
          .map((entity) => readEntityFieldValue(entity, field))
          .find((value) => value && String(value).trim().length > 0)
      : undefined;
    if (entitiesPreview && !includeEmptyPreview && (!sample || String(sample).trim().length === 0)) {
      continue;
    }
    out.push({
      id: field.id,
      path: field.bindingPath,
      label: field.labelVi,
      sample: sample != null ? truncateValue(sample) : undefined,
    });
  }
  return out;
}

/** Đọc giá trị 1 trường từ Entity, support cả core và metadata. */
export function readEntityFieldValue(
  entity: Entity | undefined,
  field: EntityFieldDefinition,
): string | number | boolean | string[] | undefined {
  if (!entity) return undefined;
  if (field.storedInMetadata) {
    return entity.metadata?.[field.id] as string | undefined;
  }
  return (entity as unknown as Record<string, unknown>)[field.id] as
    | string
    | number
    | boolean
    | string[]
    | undefined;
}
