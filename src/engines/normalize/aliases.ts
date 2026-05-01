// Field aliases để normalize dữ liệu import vào model chuẩn

export const FIELD_ALIASES: Record<string, string[]> = {
  name: [
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
  categorySub: [
    "sub",
    "subcategory",
    "categorySub",
    "loai_phu",
    "loại phụ",
    "phong_cach",
    "phong cách",
  ],
  address: ["address", "dia_chi", "địa chỉ", "dia chi", "addr", "vị trí", "vi tri", "location"],
  phone: ["phone", "sdt", "hotline", "điện thoại", "dien_thoai", "so_dien_thoai"],
  openingHours: ["hours", "gio_mo_cua", "giờ mở cửa", "open", "khung_gio", "khung gio"],
  priceRange: [
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
  style: ["style"],
  partnerFlag: ["partner", "doi_tac", "đối tác", "doi tac", "sponsor", "partnerFlag"],
  partnerPriority: ["priority", "uu_tien", "ưu tiên", "partnerPriority"],
  partnerType: ["partnerType", "loai_doi_tac", "loại đối tác"],
  campaignTags: ["tags", "campaign", "campaignTags", "chien_dich", "chiến dịch"],
  seoKeywords: ["keywords", "seo", "seoKeywords"],
  signatureDish: [
    "mon_an_noi_bat",
    "món ăn nổi bật",
    "mon_noi_bat",
    "signature",
    "signatureDish",
    "highlight",
    "noi_bat",
    "noi bat",
  ],
  imageRef: [
    "link_drive",
    "link drive",
    "drive",
    "google_drive",
    "google drive",
    "link_anh",
    "link anh",
    "link_hinh",
    "link hinh",
    "thu_muc_anh",
    "thu muc anh",
    "folder_anh",
    "folder anh",
    "ten_file_anh",
    "ten file anh",
  ],
  image: [
    "image",
    "img",
    "hinh_anh",
    "hình ảnh",
    "ảnh",
    "anh",
    "photo",
    "photo_url",
    "cover",
    "hình",
    "hinh",
    "link ảnh",
    "link anh",
  ],
  images: ["images", "anh_phu", "ảnh phụ", "gallery"],
  // Cột tuỳ ý cho lịch trình du lịch — sẽ chui vào entity.metadata
  day: ["day", "ngày", "ngay", "ngay_thu", "day_no"],
  timeSlot: ["thoi_diem", "thoi diem", "time_slot", "time slot", "khung_thoi_gian"],
  direction: ["huong_di", "huong di", "duong_di", "duong di", "route", "direction"],
  description: [
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
};

const IGNORE_FIELD_ALIASES = new Set(["", "empty", "stt", "no", "so_thu_tu", "index"]);

export function normalizeKey(key: string): string {
  const k = normalizeAliasToken(key);
  if (IGNORE_FIELD_ALIASES.has(k) || /^\d+$/.test(k)) return "__ignore__";
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => normalizeAliasToken(a) === k)) return field;
  }
  return key;
}

function normalizeAliasToken(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

/**
 * Các "standard fields" mà sau khi map sẽ được dồn vào entity.metadata
 * (không phải core field của Entity).
 */
export const METADATA_FIELDS = new Set([
  "day",
  "description",
  "signatureDish",
  "timeSlot",
  "direction",
  "imageRef",
]);

/**
 * Nhãn tiếng Việt hiển thị trong dropdown mapping cột.
 * Key = standard field name (chuẩn nội bộ), Value = nhãn UI tiếng Việt.
 */
export const FIELD_LABELS_VI: Record<string, string> = {
  __ignore__: "— Bỏ qua —",
  name: "Tên",
  categoryMain: "Mô hình / Loại dịch vụ",
  categorySub: "Phong cách phụ",
  address: "Địa chỉ",
  phone: "SĐT",
  openingHours: "Giờ mở cửa",
  priceRange: "Khoảng giá",
  style: "Phong cách",
  partnerFlag: "Đối tác (cờ)",
  partnerPriority: "Độ ưu tiên đối tác",
  partnerType: "Loại đối tác",
  campaignTags: "Tag chiến dịch",
  seoKeywords: "Từ khoá SEO",
  signatureDish: "Món / điểm nhấn",
  imageRef: "Tên folder/link ảnh",
  image: "Ảnh chính",
  images: "Ảnh phụ (gallery)",
  day: "Ngày (lịch trình)",
  timeSlot: "Thời điểm",
  direction: "Hướng đi",
  description: "Mô tả / ghi chú",
};

export function fieldLabelVi(key: string): string {
  return FIELD_LABELS_VI[key] ?? key;
}
