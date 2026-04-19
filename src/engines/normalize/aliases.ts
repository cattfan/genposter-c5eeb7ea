// Field aliases để normalize dữ liệu import vào model chuẩn

export const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "ten", "ten_quan", "tên", "tên quán", "ten quan", "title"],
  categoryMain: [
    "category",
    "categoryMain",
    "loai",
    "loại",
    "loai_hinh",
    "loại hình",
    "mo_hinh",
    "mô hình",
    "type",
  ],
  categorySub: ["sub", "subcategory", "categorySub", "loai_phu", "loại phụ"],
  address: ["address", "dia_chi", "địa chỉ", "dia chi", "addr"],
  phone: ["phone", "sdt", "hotline", "điện thoại", "dien_thoai"],
  openingHours: ["hours", "gio_mo_cua", "giờ mở cửa", "open"],
  priceRange: ["price", "gia", "giá", "khoảng giá", "khoang_gia", "priceRange"],
  style: ["style", "phong_cach", "phong cách"],
  partnerFlag: ["partner", "doi_tac", "đối tác", "doi tac", "sponsor", "partnerFlag"],
  partnerPriority: ["priority", "uu_tien", "ưu tiên", "partnerPriority"],
  partnerType: ["partnerType", "loai_doi_tac", "loại đối tác"],
  campaignTags: ["tags", "campaign", "campaignTags", "chien_dich", "chiến dịch"],
  seoKeywords: ["keywords", "seo", "seoKeywords"],
  image: ["image", "img", "hinh_anh", "hình ảnh", "ảnh", "anh", "photo", "photo_url", "cover"],
  images: ["images", "anh_phu", "ảnh phụ", "gallery"],
};

export function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === k)) return field;
  }
  return key;
}

export function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "co", "có", "x", "đối tác", "partner"].includes(s);
}

export function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (!v) return [];
  return String(v)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (!v) return fallback;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
