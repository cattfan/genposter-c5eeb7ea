// Domain models cho Content Pack Generator

export type ID = string;

export type PartnerType = "sponsor" | "ambassador" | "campaign" | "owned" | "none";
export type EntityStatus = "active" | "draft" | "archived";

export interface Entity {
  entityId: ID;
  name: string;
  categoryMain?: string;
  categorySub?: string;
  address?: string;
  phone?: string;
  openingHours?: string;
  style?: string;
  priceRange?: string;
  partnerFlag: boolean;
  partnerPriority: number; // 0..100
  partnerType: PartnerType;
  campaignTags: string[];
  seoKeywords: string[];
  status: EntityStatus;
  sourceRowId?: string;
  sheetName?: string;
  metadata?: Record<string, unknown>;
}

export type AssetSourceType = "local" | "url" | "sheet";
export type AssetRole =
  | "cover"
  | "facade"
  | "food_closeup"
  | "space"
  | "portrait"
  | "square_thumb"
  | "section_image"
  | "generic";
export type AssetOrientation = "portrait" | "landscape" | "square";
export type AssetStatus = "ok" | "missing" | "broken" | "low_quality";

export interface Asset {
  assetId: ID;
  entityId: ID;
  sourceType: AssetSourceType;
  sourceValue: string; // URL hoặc IndexedDB blob key
  blobKey?: string; // nếu local blob trong IndexedDB
  role: AssetRole;
  orientation?: AssetOrientation;
  aspectRatio?: number;
  qualityScore: number; // 0..100
  isCover: boolean;
  status: AssetStatus;
  width?: number;
  height?: number;
}

export type BulletType = "dot" | "dash" | "number" | "icon" | "none";

export interface SectionItem {
  sectionItemId: ID;
  entityId: ID;
  line1?: string; // tên
  line2?: string; // địa chỉ / mô tả
  line3?: string; // giá / hotline
  icon?: string;
  bulletType?: BulletType;
  emphasis?: "normal" | "bold" | "highlight";
  metadata?: Record<string, unknown>;
}

export type SlotKind = "text" | "image" | "group" | "repeater" | "section" | "shape" | "icon";

export interface SlotStyle {
  // text
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through" | "underline line-through";
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  maxLines?: number;
  textShadow?: string;
  textStroke?: string;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  // gradient (text & shape fill)
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number; // deg
  gradientEnabled?: boolean;
  // image
  fit?: "cover" | "contain" | "stretch";
  borderRadius?: number;
  shadow?: string;
  opacity?: number;
  overlayColor?: string;
  // shape
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // border (image & shape)
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  // common
  background?: string;
  padding?: number;
  rotation?: number;
  // image filters (CSS filter)
  brightness?: number; // 1 = normal
  contrast?: number;
  saturate?: number;
  blur?: number; // px
  hueRotate?: number; // deg
  grayscale?: number; // 0..1
  // flip
  flipH?: boolean;
  flipV?: boolean;
  // drop shadow
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  // visibility (Designer toolkit)
  hidden?: boolean;
}

// Crop ảnh: % so với ảnh gốc (0..1)
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OverflowRule = "shrink" | "ellipsis" | "max_lines" | "hard_fail";

export interface Slot {
  slotId: ID;
  name?: string; // tên hiển thị trong panel Layers (designer đặt thủ công)
  pageId?: ID;
  sectionId?: ID;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  locked?: boolean;
  groupId?: ID;
  kind: SlotKind;
  // dữ liệu tĩnh (nếu không bind)
  staticText?: string;
  staticImage?: string; // url hoặc blob key
  shapeKind?: "rectangle" | "circle" | "triangle" | "line" | "divider" | "badge";
  // bind
  bindingPath?: string; // ví dụ "entity.name", "asset.url", "section.items[0].line1"
  allowedAssetRoles?: AssetRole[];
  style?: SlotStyle;
  visibilityRule?: string;
  overflowRule?: OverflowRule;
  // repeater
  repeaterCount?: number;
  repeaterItemHeight?: number;
  repeaterGap?: number;
  // section ref
  sectionRefId?: ID;
  // ảnh upload từ máy → mặc định là layer nền, không cho nhân bản
  isUploadedBackground?: boolean;
  // crop ảnh (chỉ dùng cho kind=image)
  crop?: ImageCrop;
}

export type PartnerMode = "strict_partner" | "priority_partner" | "balanced_partner";
export type ImageMode = "section_mood" | "anchor_entity";

export type FilterOp = "eq" | "in" | "gte" | "lte" | "contains";

export interface FilterRule {
  field: string; // tên cột — đọc từ entity[field] hoặc entity.metadata[field]
  op: FilterOp;
  value: string | number | string[];
}

export type SectionLayoutMode = "stack" | "zigzag" | "grid";

export interface Section {
  sectionId: ID;
  title: string;
  categoryQuery?: string; // ví dụ "category=cafe"
  subCategoryQuery?: string;
  maxItems: number;
  minItems: number;
  imageMode: ImageMode;
  imageSlotId?: ID;
  listStyle?: BulletType;
  sortRule?: "partner_first" | "diversity" | "alpha" | "none";
  partnerMode: PartnerMode;
  overflowPolicy?: OverflowRule;
  // Lọc thêm theo cột tuỳ ý (vd day=1, category=homestay)
  filterRules?: FilterRule[];
  // Cách bố trí item trong section khi render (stack | zigzag trái/phải | grid)
  layoutMode?: SectionLayoutMode;
}

export type PageType = "cover" | "itinerary" | "board" | "mixed";

export interface CanvasSize {
  width: number;
  height: number;
  background?: string;
  backgroundImage?: string;
}

export interface PageTemplate {
  pageTemplateId: ID;
  name: string;
  type: PageType;
  canvas: CanvasSize;
  slots: Slot[];
  sections: Section[];
  stylePreset?: string;
  validationRules?: string[];
  updatedAt: number;
  createdAt: number;
  thumbnail?: string;
}

export interface PackTemplate {
  packTemplateId: ID;
  name: string;
  description?: string;
  goal?: string;
  tone?: string;
  cta?: string;
  orderedPages: ID[]; // pageTemplateId
  requiredPages: ID[];
  optionalPages: ID[];
  captionProfile?: {
    mode: CaptionMode;
    seoKeywords?: string[];
  };
  exportDefaults?: {
    format: "png" | "jpg";
    scale: number;
  };
  updatedAt: number;
  createdAt: number;
}

export type PageState = "accepted" | "rejected" | "needs_fix";

export interface RenderedItem {
  slotId?: ID;
  sectionId?: ID;
  sectionItemId?: ID;
  entityId?: ID;
  assetId?: ID;
  partnerFlag?: boolean;
  partnerPriority?: number;
  reasonCodes?: string[];
}

export interface RenderedPage {
  pageIndex: number;
  pageFile: string;
  pageTemplateId: ID;
  state: PageState;
  selected: boolean;
  healthScore: number;
  warnings: string[];
  items: RenderedItem[];
  renderedAt: number;
}

export interface DataSourceInfo {
  kind: "csv" | "json" | "sheet" | "manual";
  name?: string;
  url?: string;
  rowCount?: number;
  importedAt: number;
}

export interface GenerationJob {
  jobId: ID;
  packTemplateId: ID;
  packTemplateName: string;
  createdAt: number;
  dataSource?: DataSourceInfo;
  pages: RenderedPage[];
  status: "draft" | "generated" | "exported";
  notes?: string;
}

export interface RenderManifest {
  jobId: ID;
  generatedAt: number;
  pages: Array<{
    pageFile: string;
    pageTemplateId: ID;
    selected: boolean;
    items: RenderedItem[];
    warnings: string[];
  }>;
}

export type CaptionMode = "save_post" | "newbie_guide" | "review_pack" | "partner_soft";

export interface CaptionVariant {
  id: ID;
  headline: string;
  body: string;
  hashtags: string[];
  mode: CaptionMode;
  sourceManifestPageIds: string[];
}

export interface Project {
  projectId: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface BlobRecord {
  blobKey: ID;
  blob: Blob;
  mime: string;
  createdAt: number;
}

export interface ManualOverride {
  overrideId: ID;
  packTemplateId: ID;
  pageTemplateId?: ID;
  sectionId?: ID;
  slotId?: ID;
  pinEntityId?: ID;
  excludeEntityIds?: ID[];
  pinAssetId?: ID;
  excludeAssetIds?: ID[];
  lockSection?: boolean;
}

export interface AppSettings {
  language: "vi";
  captionProvider: "local" | "openai";
  captionApiKey?: string;
  exportScale: number;
  defaultCanvas: CanvasSize;
  theme?: "light" | "dark";
}
