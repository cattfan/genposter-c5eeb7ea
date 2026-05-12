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

export type DataSourceKind = "page_primary" | "page_secondary" | "sheet" | "entity_pool" | "asset_pool";

export interface DataSourceBinding {
  /** Canonical id used by binding engines. */
  id: string;
  /** @deprecated kept for backwards compatibility with older payloads; mirrors `id`. */
  sourceId?: string;
  kind: DataSourceKind;
  label: string;
  sheetName?: string;
  entityIds?: string[];
  assetIds?: string[];
  notes?: string;
}

export interface PageDataSources {
  primary?: DataSourceBinding;
  secondary?: DataSourceBinding[];
}

export type BulletType = "dot" | "dash" | "number" | "icon" | "none";

export interface SectionItem {
  sectionItemId: ID;
  entityId: ID;
  line1?: string;
  line2?: string;
  line3?: string;
  icon?: string;
  bulletType?: BulletType;
  emphasis?: "normal" | "bold" | "highlight";
  metadata?: Record<string, unknown>;
}

export type SlotKind = "text" | "image" | "group" | "repeater" | "section" | "shape" | "icon";

export interface SlotStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through" | "underline line-through";
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  textVerticalAlign?: "top" | "middle" | "bottom";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  maxLines?: number;
  textShadow?: string;
  textShadowColor?: string;
  textShadowBlur?: number;
  textShadowX?: number;
  textShadowY?: number;
  textStroke?: string;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  gradientEnabled?: boolean;
  fit?: "cover" | "contain" | "stretch";
  borderRadius?: number;
  shadow?: string;
  opacity?: number;
  overlayColor?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  background?: string;
  padding?: number;
  rotation?: number;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  blur?: number;
  hueRotate?: number;
  grayscale?: number;
  flipH?: boolean;
  flipV?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  hidden?: boolean;
  /**
   * Writing direction for text/shape-with-text elements. Shared by Slot + Design elements.
   */
  textLayout?: "horizontal" | "vertical-rl" | "vertical-lr";
  /** Curved-text baseline in degrees. 0 = flat. */
  textCurve?: number;
}

export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OverflowRule = "shrink" | "ellipsis" | "max_lines" | "hard_fail";

export interface Slot {
  slotId: ID;
  name?: string;
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
  dataGroupId?: ID;
  kind: SlotKind;
  staticText?: string;
  textRuns?: DesignTextRun[];
  staticImage?: string;
  shapeKind?: "rectangle" | "circle" | "triangle" | "line" | "divider" | "badge";
  bindingPath?: string;
  fieldParts?: BlueprintFieldPart[];
  allowedAssetRoles?: AssetRole[];
  style?: SlotStyle;
  visibilityRule?: string;
  overflowRule?: OverflowRule;
  repeaterCount?: number;
  repeaterItemHeight?: number;
  repeaterGap?: number;
  sectionRefId?: ID;
  isUploadedBackground?: boolean;
  crop?: ImageCrop;
  dataSourceId?: ID;
  dataSourceConfig?: {
    selectedSheet?: string;
    filterMoHinh?: string;
    filterPhongCach?: string;
  };
}

export type PartnerMode = "strict_partner" | "priority_partner" | "balanced_partner";
export type ImageMode = "section_mood" | "anchor_entity";

export type FilterOp = "eq" | "in" | "gte" | "lte" | "contains";

export interface FilterRule {
  field: string;
  op: FilterOp;
  value: string | number | string[];
}

export type SectionLayoutMode = "stack" | "zigzag" | "grid" | "poster_list";

export interface Section {
  sectionId: ID;
  title: string;
  categoryQuery?: string;
  subCategoryQuery?: string;
  maxItems: number;
  minItems: number;
  imageMode: ImageMode;
  imageSlotId?: ID;
  listStyle?: BulletType;
  sortRule?: "partner_first" | "diversity" | "alpha" | "none";
  partnerMode: PartnerMode;
  overflowPolicy?: OverflowRule;
  filterRules?: FilterRule[];
  layoutMode?: SectionLayoutMode;
}

export type PageType = "cover" | "itinerary" | "board" | "mixed";

export interface CanvasSize {
  width: number;
  height: number;
  background?: string;
  backgroundImage?: string;
}

export type EditorMode = "design" | "template" | "generated";

export interface DataBindingRef {
  source: "legacy_template" | "entity" | "asset" | "section" | "manual";
  path: string;
  label?: string;
  fallbackText?: string;
  fallbackImage?: string;
  meta?: Record<string, unknown>;
}

export interface DesignGuide {
  guideId: ID;
  axis: "x" | "y";
  value: number;
  locked?: boolean;
}

export interface ElementStyle extends SlotStyle {
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  tint?: string;
  maskShape?: "rectangle" | "circle" | "triangle";
}

export interface DesignTextRun {
  runId?: ID;
  start: number;
  end: number;
  style: Partial<ElementStyle>;
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
  dataSources?: PageDataSources;
  cardGroups?: CardGroupConfig[];
}

export interface CardGroupConfig {
  groupId: ID;
  repeatCount: number;
  gap: number;
  direction: "vertical" | "horizontal";
  entitySource?: {
    sheetName?: string;
    filterRules?: FilterRule[];
  };
}

export interface PackTemplate {
  packTemplateId: ID;
  name: string;
  description?: string;
  goal?: string;
  tone?: string;
  cta?: string;
  orderedPages: ID[];
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

export type GeneratePresetMode = "pack" | "entity";

export interface GeneratePresetConfig {
  selectedSheet?: string;
  filterMoHinh?: string;
  filterPhongCach?: string;
  prioritizePartner?: boolean;
  onlyPartner?: boolean;
  partnerQuotaPerPage?: number;
  maxEntities?: number;
  batchCount?: number;
  varyFontsFromSecondBundle?: boolean;
  pageConfigs?: Record<ID, GeneratePageConfig>;
}

export interface GeneratePageConfig {
  selectedSheet?: string;
  filterMoHinh?: string;
  filterPhongCach?: string;
  prioritizePartner?: boolean;
  onlyPartner?: boolean;
  partnerQuotaPerPage?: number;
  maxEntities?: number;
}

export interface GenerateBindingPreset {
  presetId: ID;
  name: string;
  mode: GeneratePresetMode;
  packTemplateId?: ID;
  packTemplateNameSnapshot?: string;
  pageTemplateIds: ID[];
  bindOverrides: Record<string, Record<string, string | undefined>>;
  pageTemplateDrafts?: Record<ID, PageTemplate>;
  generateConfig: GeneratePresetConfig;
  createdAt: number;
  updatedAt: number;
  version: 1;
}

export interface GenPosterPortableBundleV1 {
  app: "genposter";
  kind: "pack-template" | "generate-preset" | "workspace-bundle";
  version: 1;
  exportedAt: number;
  packTemplates?: PackTemplate[];
  pageTemplates?: PageTemplate[];
  generatePresets?: GenerateBindingPreset[];
  assets?: Asset[];
  blobs?: BlobRecord[];
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
  entityId?: ID;
  entityName?: string;
  entityPoolIds?: ID[];
  bindOverrides?: Record<string, string | undefined>;
  workingTemplate?: PageTemplate;
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

export type AiProviderPreset = "deepseek" | "lovable" | "custom";

export interface AiProviderConfig {
  preset: AiProviderPreset;
  baseUrl: string;
  model: string;
  apiKey?: string;
  visionModel?: string;
}

export interface DriveDownloadCheckpoint {
  updatedAt: number;
  status: "running" | "done" | "error";
  totalEntities: number;
  completedEntities: number;
  importedAssets: number;
  skippedFiles: number;
  downloadedBytes: number;
  failedEntities: number;
  entityLimit: number;
  imageLimit: "all" | number;
}

export interface AppSettings {
  language: "vi";
  captionProvider: "local" | "openai";
  captionApiKey?: string;
  exportScale: number;
  defaultCanvas: CanvasSize;
  theme?: "light" | "dark";
  ai?: AiProviderConfig;
  driveRootFolderUrl?: string;
  driveDownloadCheckpoint?: DriveDownloadCheckpoint;
}

export type AnalysisMode = "quick" | "deep_draft" | "draft_only";

export type AnalyzedPageType =
  | "cover"
  | "board"
  | "mixed_board"
  | "itinerary"
  | "checklist"
  | "service_directory"
  | "recap"
  | "closing"
  | "unknown";

export type CompatibilityLevel =
  | "very_compatible"
  | "partial"
  | "significant_missing"
  | "not_ready";

export type RequirementKind = "data_field" | "asset" | "structural" | "manual_literal";

export type GapCategory = "field" | "asset" | "structure" | "manual" | "risk";

export type SheetSemanticProfile =
  | "food"
  | "cafe"
  | "service"
  | "homestay"
  | "checkin"
  | "mixed"
  | "other";

export type GapLevel = "have" | "mappable" | "missing_required" | "missing_optional" | "risk";

export type DraftReadiness = "ready" | "needs_data" | "skeleton_only";

export type BlueprintBlockRole =
  | "background"
  | "title"
  | "subtitle"
  | "eyebrow"
  | "list_line"
  | "list_group"
  | "section_title"
  | "image_holder"
  | "shape_label"
  | "badge"
  | "body_text"
  | "cta"
  | "decor"
  | "other";

export type BlueprintImportance = "high" | "medium" | "low";

export type BlueprintSourceRole = "background" | "section_image" | "text_field" | "literal";

export interface BlueprintFieldPart {
  kind: "field" | "literal";
  text?: string;
  bindingPath?: string;
  fieldKey?: string;
  label?: string;
  xRatio?: number;
  widthRatio?: number;
}

export interface BlueprintBlock {
  name: string;
  role: BlueprintBlockRole;
  kind: "text" | "image" | "shape";
  sourceRole?: BlueprintSourceRole;
  fieldParts?: BlueprintFieldPart[];
  importance?: BlueprintImportance;
  clusterId?: string;
  lineIndex?: number;
  shapeKind?: "rectangle" | "circle" | "badge" | "line" | "divider";
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  rotation?: number;
  placeholder?: string;
  notes?: string;
  style?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    color?: string;
    fill?: string;
    borderRadius?: number;
    textAlign?: "left" | "center" | "right";
    textVerticalAlign?: "top" | "middle" | "bottom";
    textTransform?: "none" | "uppercase" | "lowercase";
    lineHeight?: number;
    letterSpacing?: number;
    opacity?: number;
    overlayColor?: string;
    textShadow?: string;
    textShadowColor?: string;
    textShadowBlur?: number;
    textShadowX?: number;
    textShadowY?: number;
    textStrokeColor?: string;
    textStrokeWidth?: number;
    padding?: number;
    fit?: "cover" | "contain" | "stretch";
    shadowColor?: string;
    shadowBlur?: number;
    shadowX?: number;
    shadowY?: number;
  };
}

export interface VisualBlueprint {
  canvas?: { bgColor?: string };
  blocks: BlueprintBlock[];
  confidence?: number;
  warnings?: string[];
}

export interface BlueprintRequirementHint {
  fieldKey: string;
  label: string;
  scope: "pack" | "page" | "section" | "item" | "asset";
  required: boolean;
  kind?: RequirementKind;
  bindCandidate?: string;
  bindCandidates?: string[];
  examples?: string[];
  notes?: string;
  acceptsManualInput?: boolean;
  minRecords?: number;
  assetRoleHint?: string;
  confidence?: number;
}

export interface BlueprintUiRegionHint {
  kind: AnalyzedUiRegion["kind"];
  label: string;
  description: string;
  estimatedItems?: number;
}

export interface DataBlueprintBindingHint {
  blockName: string;
  bindingPath?: string;
  sourceRole?: BlueprintSourceRole;
  fieldParts?: BlueprintFieldPart[];
  manualLiteral?: boolean;
  required?: boolean;
  notes?: string;
  confidence?: number;
  clusterId?: string;
  lineIndex?: number;
}

export interface DataBlueprintSectionHint {
  clusterId: string;
  title?: string;
  repeatedItemCount?: number;
  imageRepresentsCluster?: boolean;
  notes?: string;
  confidence?: number;
}

export interface DataBlueprint {
  pageRole: string;
  pageType: AnalyzedPageType;
  summary: string;
  layoutDensity: "low" | "medium" | "high";
  numberOfSections: number;
  estimatedItemCount: number;
  hasMainTitle: boolean;
  hasSubtitle: boolean;
  hasBackgroundImage: boolean;
  hasPanel: boolean;
  hasSectionImages: boolean;
  hasListRepeater: boolean;
  hasSlotRepeater: boolean;
  hasPriceBadge: boolean;
  hasCTA: boolean;
  uiRegions: BlueprintUiRegionHint[];
  requiredFields: BlueprintRequirementHint[];
  bindings?: DataBlueprintBindingHint[];
  sections?: DataBlueprintSectionHint[];
  structureConfidence?: number;
  bindingConfidence?: number;
  warnings?: string[];
}

export interface CombinedLayoutBlueprint {
  version: 2;
  visualBlueprint: VisualBlueprint;
  dataBlueprint?: DataBlueprint;
}

export interface AnalyzedUiRegion {
  regionId: ID;
  kind:
    | "cover"
    | "background"
    | "title"
    | "subtitle"
    | "panel"
    | "section"
    | "bullet_list"
    | "image_slot"
    | "price_badge"
    | "item_list"
    | "cta"
    | "other";
  label: string;
  description: string;
  estimatedItems?: number;
}

export interface InferredDataRequirement {
  requirementId: ID;
  fieldKey: string;
  label: string;
  scope: "pack" | "page" | "section" | "item" | "asset";
  required: boolean;
  kind?: RequirementKind;
  bindCandidate?: string;
  bindCandidates?: string[];
  examples?: string[];
  notes?: string;
  acceptsManualInput?: boolean;
  minRecords?: number;
  assetRoleHint?: string;
  structuralHint?: string;
  confidence?: number;
}

export interface GapItem {
  gapId: ID;
  level: GapLevel;
  fieldKey: string;
  message: string;
  category?: GapCategory;
  pageIndex?: number;
  sectionKey?: string;
  sheetName?: string;
}

export interface SheetCompatibilityDetail {
  sheetName: string;
  score: number;
  label: CompatibilityLevel;
  profileKind?: SheetSemanticProfile;
  availableFields: string[];
  mappableFields: string[];
  missingRequired: string[];
  missingOptional: string[];
  assetCoverage: string[];
  sectionCoverage: string[];
  structuralCoverage?: string[];
  reasons?: string[];
  reasonSummary?: string;
  notes: string[];
}

export interface CompatibilityReport {
  score: number;
  label: CompatibilityLevel;
  bestMatchSheet?: string;
  sheets: SheetCompatibilityDetail[];
  groups: Record<GapLevel, GapItem[]>;
  reasonSummary?: string;
}

export interface DraftPageSuggestion {
  pageTemplateId: ID;
  pageIndex: number;
  pageName: string;
  pageType: AnalyzedPageType;
  readiness: DraftReadiness;
  readinessLabel: string;
  sectionCount: number;
  estimatedItemCount: number;
  autoBindingCount: number;
  warnings: string[];
}

export interface DraftTemplateSuggestion {
  packTemplate?: PackTemplate;
  pageTemplates: PageTemplate[];
  suggestedBindings: Array<{
    pageTemplateId: ID;
    slotId: ID;
    bindingPath: string;
    confidence: number;
  }>;
  readiness?: DraftReadiness;
  readinessLabel?: string;
  pageDrafts?: DraftPageSuggestion[];
  warnings: string[];
}

export interface AnalyzedPage {
  pageIndex: number;
  pageRole: string;
  pageType: AnalyzedPageType;
  suggestedName: string;
  summary: string;
  layoutDensity: "low" | "medium" | "high";
  numberOfSections: number;
  estimatedItemCount: number;
  hasMainTitle: boolean;
  hasSubtitle: boolean;
  hasBackgroundImage: boolean;
  hasPanel: boolean;
  hasSectionImages: boolean;
  hasListRepeater: boolean;
  hasSlotRepeater: boolean;
  hasPriceBadge: boolean;
  hasCTA: boolean;
  confidenceScore: number;
  uiRegions: AnalyzedUiRegion[];
  requiredFields: InferredDataRequirement[];
  compatibility: CompatibilityReport;
  layoutJson?: string;
  visualBlueprint?: VisualBlueprint;
  dataBlueprint?: DataBlueprint;
  visualConfidence?: number;
  structureConfidence?: number;
  bindingConfidence?: number;
}

export interface AnalyzedPack {
  title: string;
  mode: AnalysisMode;
  imageCount: number;
  summary: string;
  predictedPurpose?: string;
  predictedGoal?: string;
  predictedTone?: string;
  predictedCta?: string;
  structureSummary: string[];
  pages: AnalyzedPage[];
  compatibility: CompatibilityReport;
  warnings: string[];
  uiBlueprint: string[];
  dataBlueprint: InferredDataRequirement[];
  dataBlueprintGroups?: {
    pageLevel: InferredDataRequirement[];
    sectionLevel: InferredDataRequirement[];
    itemLevel: InferredDataRequirement[];
    assetLevel: InferredDataRequirement[];
  };
}

export interface AnalysisRecord {
  analysisId: ID;
  title: string;
  mode: AnalysisMode;
  imageBlobKeys: string[];
  imageNames: string[];
  imageOrder: string[];
  pack: AnalyzedPack;
  draft?: DraftTemplateSuggestion;
  createdAt: number;
  updatedAt: number;
}

// ─── Design editor (template/design/generated editor) models ────────────────
// These types are shared across src/features/editor/* and the Dexie tables
// `assetLibrary`, `brandKits`, `fontAssets`, `designDocuments`.

export type AssetLibraryKind =
  | "image"
  | "logo"
  | "icon"
  | "svg"
  | "pattern"
  | "background"
  | "other";

export interface AssetItem {
  assetId: ID;
  name: string;
  kind: AssetLibraryKind;
  sourceType: "local" | "url" | "inline";
  sourceValue: string;
  blobKey?: string;
  width?: number;
  height?: number;
  mime?: string;
  tags?: string[];
  brandKitId?: ID;
  createdAt: number;
  updatedAt: number;
}

export interface BrandKitPreset {
  presetId: ID;
  name: string;
  style?: Partial<ElementStyle>;
  meta?: Record<string, unknown>;
}

export interface BrandKit {
  brandKitId: ID;
  name: string;
  colors: string[];
  fontAssetIds: ID[];
  logoAssetIds?: ID[];
  presets?: BrandKitPreset[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FontAsset {
  fontAssetId: ID;
  family: string;
  weight?: number | string;
  style?: "normal" | "italic";
  blobKey?: string;
  sourceUrl?: string;
  sourceValue?: string;
  format?: string;
  previewText?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesignPageSafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DesignPage {
  pageId: ID;
  name: string;
  width: number;
  height: number;
  background?: string;
  backgroundImage?: string;
  safeZone?: DesignPageSafeZone;
  guides?: DesignGuide[];
}

export interface DesignDocumentSettings {
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  showSafeZone: boolean;
  showGuides: boolean;
}

interface DesignElementBase {
  elementId: ID;
  pageId: ID;
  parentId?: ID;
  children?: ID[];
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  locked?: boolean;
  hidden?: boolean;
  style?: ElementStyle;
  binding?: DataBindingRef;
  meta?: Record<string, unknown>;
  assetId?: ID;
}

export interface DesignTextElement extends DesignElementBase {
  kind: "text";
  text: string;
  textRuns?: DesignTextRun[];
}

export interface DesignImageElement extends DesignElementBase {
  kind: "image";
  src?: string;
  crop?: ImageCrop;
}

export interface DesignShapeElement extends DesignElementBase {
  kind: "shape";
  shapeKind?: Slot["shapeKind"];
  src?: string;
  crop?: ImageCrop;
  text?: string;
  textRuns?: DesignTextRun[];
}

export interface DesignFrameElement extends DesignElementBase {
  kind: "frame";
  background?: string;
  padding?: number;
}

export interface DesignGroupElement extends DesignElementBase {
  kind: "group";
}

export interface DesignIconElement extends DesignElementBase {
  kind: "icon";
  iconName: string;
  iconVariant?: "outline" | "solid" | "lucide" | "iconify";
  iconColor?: string;
  iconAssetId?: ID;
  svgContent?: string;
}

export interface DesignSvgElement extends DesignElementBase {
  kind: "svg";
  svgContent: string;
}

export interface DesignTableCell {
  cellId: ID;
  text?: string;
  style?: Partial<ElementStyle>;
  colSpan?: number;
  rowSpan?: number;
}

export interface DesignTableElement extends DesignElementBase {
  kind: "table";
  columns: number;
  rows: number;
  cells: DesignTableCell[];
}

export type DesignElement =
  | DesignTextElement
  | DesignImageElement
  | DesignShapeElement
  | DesignFrameElement
  | DesignGroupElement
  | DesignIconElement
  | DesignSvgElement
  | DesignTableElement;

export interface DesignDocument {
  designDocumentId: ID;
  name: string;
  mode: EditorMode;
  pages: DesignPage[];
  elements: DesignElement[];
  activePageId: ID;
  documentSettings?: DesignDocumentSettings;
  brandKitId?: ID;
  assetIds?: ID[];
  sourcePageTemplateId?: ID;
  sourceJobId?: ID;
  createdAt: number;
  updatedAt: number;
  version: 1;
}


// ─── Reusable symbols / components ──────────────────────────────────────────
// A SymbolDefinition is a named bundle of DesignElements the user can drop into
// any page. Each time they insert it, we clone the elements and tag the root
// group with `meta.symbolId` + `meta.symbolVersion` so the UI can show a "sync"
// affordance when the original symbol is later updated.

export interface SymbolDefinition {
  symbolId: ID;
  name: string;
  description?: string;
  /** Elements as stored in a DesignDocument. `pageId` is stripped on save. */
  elements: DesignElement[];
  /** Bounding width/height captured when saving — used for preview + placement. */
  width: number;
  height: number;
  /** Monotonic version bumped every time the symbol is overwritten. */
  version: number;
  /** Preview PNG/dataURL captured at save time (optional). */
  thumbnail?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}
