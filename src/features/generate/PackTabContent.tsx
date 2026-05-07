// Tab "Pack template (nâng cao)" — bind dữ liệu vào từng page của pack giống tab entity.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import {
  Sparkles,
  ArrowLeft,
  Download,
  FileDown,
  FileUp,
  Package,
  Copy,
  Link2,
  Link2Off,
  AlertTriangle,
  Image as ImageIcon,
  Minus,
  Plus,
  Type,
  Star,
  Wand2,
  Loader2,
  Eye,
  Save,
  Trash2,
  Undo2,
  Redo2,
} from "lucide-react";
import type {
  Asset,
  Entity,
  GenerateBindingPreset,
  GeneratePageConfig,
  GenerationJob,
  PackTemplate,
  PageTemplate,
  Slot,
} from "@/models";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TEXT_BINDING_OPTIONS,
  IMAGE_BINDING_OPTIONS,
  ASSET_RANDOM_SCOPE_BINDING_VALUE,
  buildAssetRandomScopeBindingPath,
  buildEntityScopedTextBindingPath,
  getEntityScopedTextBindingBasePath,
  isAssetRandomScopeBindingPath,
  parseAssetRandomScopeBindingPath,
  parseEntityListBindingPath,
  parseEntityScopedTextBindingPath,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";
import { BindCanvas } from "@/features/generate/BindCanvas";
import { PageRenderer } from "@/features/render/PageRenderer";
import {
  TextListBindingPanel,
  type TextListFieldOption,
} from "@/features/generate/TextListBindingPanel";
import { TextRewritePanel } from "@/features/generate/TextRewritePanel";
import { GeneratePageEditor } from "@/features/generate/GeneratePageEditor";
import { aiCaptionFromEntity, aiRewriteTextPreserveMeaning } from "@/features/ai/aiFeatures";
import { generatePackJob } from "@/engines/selection/generate";
import { allocateEntityBindingsForTemplate } from "@/engines/selection/entityBindAllocator";
import { buildEntityBindingTargets, expandPageWithCardGroups } from "@/engines/binding/cardRepeater";
import { filterRenderableAssets } from "@/engines/binding/assetImage";
import { usePackBindOverrides } from "@/features/generate/usePackBindOverrides";
import {
  nodeToPngBlob,
  downloadPng,
  downloadZip,
  formatExportError,
} from "@/features/render/exportPng";
import { db } from "@/storage/db";
import { getLastActiveSheet, setLastActiveSheet } from "@/storage/lastSheet";
import { buildBundleGroups } from "@/lib/packDisplay";
import {
  createWorkingTemplate,
  clonePageTemplate,
  resolvePageWorkingTemplate,
} from "@/features/generate/templateState";
import {
  buildPartnerWorkbookBlob,
  buildTikTokCaptionBlob,
} from "@/features/generate/exportArtifacts";
import { applyFontVariationToGeneratedJob } from "@/features/generate/fontVariation";
import {
  buildGeneratePresetBundle,
  downloadJson,
  importPortableBundle,
  readPortableBundleFile,
  safePortableFileName,
} from "@/features/generate/generatePresetPortability";
import { formatTemplateDisplayName } from "@/lib/templateNames";

type Filter = "all" | "selected" | "errors" | "partner";
type SurfaceSelectionRect = { left: number; top: number; width: number; height: number };
type FormatSlotMode = "text" | "image";
type PreviewPageDrafts = Record<string, PageTemplate>;
type FormatBounds = { left: number; top: number; right: number; bottom: number };

interface BundleImageIssue {
  entityId: string;
  entityName: string;
  pageNames: string[];
  partnerFlag: boolean;
}

interface SlotFormatSnapshot {
  sourceSlotId: string;
  sourceLabel: string;
  bindMode: FormatSlotMode;
  bindingKey: string;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceZIndex?: number;
  rotation?: number;
  style?: Slot["style"];
  crop?: Slot["crop"];
  bindingPath?: string;
  fieldParts?: Slot["fieldParts"];
  allowedAssetRoles?: Slot["allowedAssetRoles"];
  dataGroupKey?: string;
  visibilityRule?: Slot["visibilityRule"];
  overflowRule?: Slot["overflowRule"];
}

interface SlotFormatClipboard {
  label: string;
  snapshots: SlotFormatSnapshot[];
}

interface SlotFormatAssignment {
  snapshot: SlotFormatSnapshot;
  layoutBounds?: FormatBounds;
  dataGroupId?: string;
}

interface GenerateReadiness {
  canGenerate: boolean;
  reason: string;
}

const cloneSlotStyle = (style: Slot["style"] | undefined): Slot["style"] | undefined =>
  style ? { ...style } : undefined;

const cloneSlotCrop = (crop: Slot["crop"] | undefined): Slot["crop"] | undefined =>
  crop ? { ...crop } : undefined;

const cloneJsonValue = <T,>(value: T | undefined): T | undefined =>
  value == null ? undefined : (JSON.parse(JSON.stringify(value)) as T);

const DRAFT_HISTORY_LIMIT = 30;

function clonePreviewPageDrafts(drafts: PreviewPageDrafts): PreviewPageDrafts {
  return Object.fromEntries(
    Object.entries(drafts).map(([pageTemplateId, template]) => [
      pageTemplateId,
      clonePageTemplate(template),
    ]),
  );
}

function sortSlotsForFormat(slots: Slot[]) {
  return slots
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x || a.slotId.localeCompare(b.slotId));
}

function buildSlotBounds(slots: Slot[]): FormatBounds | null {
  if (slots.length === 0) return null;
  const left = Math.min(...slots.map((slot) => slot.x));
  const top = Math.min(...slots.map((slot) => slot.y));
  const right = Math.max(...slots.map((slot) => slot.x + slot.width));
  const bottom = Math.max(...slots.map((slot) => slot.y + slot.height));
  return { left, top, right, bottom };
}

function buildSnapshotBounds(snapshots: SlotFormatSnapshot[]): FormatBounds | null {
  if (snapshots.length === 0) return null;
  const left = Math.min(...snapshots.map((slot) => slot.sourceX));
  const top = Math.min(...snapshots.map((slot) => slot.sourceY));
  const right = Math.max(...snapshots.map((slot) => slot.sourceX + slot.sourceWidth));
  const bottom = Math.max(...snapshots.map((slot) => slot.sourceY + slot.sourceHeight));
  return { left, top, right, bottom };
}

function stringifyFormatValue(value: unknown) {
  return JSON.stringify(value ?? null);
}

function createDataGroupId() {
  return `dg_${nanoid(8)}`;
}

interface Props {
  packs: PackTemplate[];
  tpls: PageTemplate[];
  entities: Entity[];
  assets: Asset[];
  currentJob: GenerationJob | null | undefined;
  setJob: (j: GenerationJob) => void;
  updatePage: (
    idx: number,
    updater: (page: GenerationJob["pages"][number]) => GenerationJob["pages"][number],
  ) => void;
  toggleSelected: (idx: number) => void;
  setSelectedAll: (v: boolean) => void;
  renderRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  debug: boolean;
  sheetOptions: string[];
  packId: string | undefined;
  setPackId: (id: string | undefined) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
}

type ResolvedGeneratePageConfig = Required<GeneratePageConfig>;

const ALL_VALUE = "__all__";

function normalizeCount(value: number | undefined, fallback: number): number {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return Math.max(1, fallback);
  return Math.max(1, Math.floor(numberValue));
}

function resolveGeneratePageConfig(
  globalConfig: ResolvedGeneratePageConfig,
  pageConfig: GeneratePageConfig | undefined,
): ResolvedGeneratePageConfig {
  const onlyPartner = pageConfig?.onlyPartner ?? globalConfig.onlyPartner;
  return {
    selectedSheet: pageConfig?.selectedSheet ?? globalConfig.selectedSheet,
    filterMoHinh: pageConfig?.filterMoHinh ?? globalConfig.filterMoHinh,
    filterPhongCach: pageConfig?.filterPhongCach ?? globalConfig.filterPhongCach,
    prioritizePartner: pageConfig?.prioritizePartner ?? globalConfig.prioritizePartner,
    onlyPartner,
    partnerQuotaPerPage: onlyPartner
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.floor(pageConfig?.partnerQuotaPerPage ?? globalConfig.partnerQuotaPerPage)),
    maxEntities: normalizeCount(pageConfig?.maxEntities, globalConfig.maxEntities),
  };
}

function entityMatchesGenerateSource(entity: Entity, config: ResolvedGeneratePageConfig): boolean {
  if (entity.status !== "active") return false;
  if (config.selectedSheet !== ALL_VALUE && entity.sheetName !== config.selectedSheet) return false;
  if (config.filterMoHinh !== ALL_VALUE && entity.categoryMain !== config.filterMoHinh) return false;
  if (config.filterPhongCach !== ALL_VALUE && entity.categorySub !== config.filterPhongCach) {
    return false;
  }
  return true;
}

function buildSourceFilteredEntities(entities: Entity[], config: ResolvedGeneratePageConfig): Entity[] {
  return entities.filter((entity) => entityMatchesGenerateSource(entity, config));
}

function buildConfiguredEntityPool(
  source: Entity[],
  config: ResolvedGeneratePageConfig,
): Entity[] {
  const list = source.filter((entity) => !config.onlyPartner || entity.partnerFlag);
  list.sort((a, b) => {
    if (config.prioritizePartner) {
      if (!!b.partnerFlag !== !!a.partnerFlag) return b.partnerFlag ? 1 : -1;
      if ((b.partnerPriority ?? 0) !== (a.partnerPriority ?? 0)) {
        return (b.partnerPriority ?? 0) - (a.partnerPriority ?? 0);
      }
    }
    return a.name.localeCompare(b.name, "vi");
  });
  return list.slice(0, config.maxEntities);
}

function slotNeedsEntityImage(slot: Slot): boolean {
  if (slot.kind !== "image" && slot.kind !== "shape") return false;
  const bindingPath = slot.bindingPath ?? "";
  return (
    bindingPath === "asset.random" ||
    bindingPath === "asset.cover" ||
    bindingPath.startsWith("asset.byRole:")
  );
}

function textBindingOptionLabel(value: string, label: string): string {
  if (value === "_static") return "Giữ nguyên chữ";
  return `Gắn ${label.toLowerCase()}`;
}

function imageBindingOptionLabel(value: string): string {
  if (value === "_static") return "Giữ ảnh hiện tại";
  if (value === "asset.cover") return "Ảnh cover của quán";
  if (value === "asset.random") return "Ảnh ngẫu nhiên của quán";
  if (value === ASSET_RANDOM_SCOPE_BINDING_VALUE) return "Ảnh ngẫu nhiên theo nguồn/thư mục";
  return value;
}

export function PackTabContent({
  packs,
  tpls,
  entities,
  assets,
  currentJob,
  setJob,
  updatePage,
  toggleSelected,
  setSelectedAll,
  renderRefs,
  debug,
  sheetOptions,
  packId,
  setPackId,
  filter,
  setFilter,
}: Props) {
  const [selectedSheet, setSelectedSheet] = useState<string>(
    () => getLastActiveSheet() ?? ALL_VALUE,
  );
  const [filterMoHinh, setFilterMoHinh] = useState<string>(ALL_VALUE);
  const [filterPhongCach, setFilterPhongCach] = useState<string>(ALL_VALUE);
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [partnerQuotaPerPage, setPartnerQuotaPerPage] = useState<number>(0);
  const [maxEntities, setMaxEntities] = useState<number>(5);
  const [pageConfigs, setPageConfigs] = useState<Record<string, GeneratePageConfig>>({});
  const [varyFontsFromSecondBundle, setVaryFontsFromSecondBundle] = useState(false);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const [editingPreviewOpen, setEditingPreviewOpen] = useState(false);
  const [showSafeFrame, setShowSafeFrame] = useState(false);
  const [surfaceMarqueeRect, setSurfaceMarqueeRect] = useState<SurfaceSelectionRect | null>(null);
  const [formatClipboard, setFormatClipboard] = useState<SlotFormatClipboard | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [bundleExportingIndex, setBundleExportingIndex] = useState<number | null>(null);
  const [zoomedPageIndex, setZoomedPageIndex] = useState<number | null>(null);
  const packRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const surfaceSelectionRef = useRef<{
    start: { x: number; y: number };
    active: boolean;
    lastSignature: string;
  } | null>(null);
  const presetImportRef = useRef<HTMLInputElement>(null);
  const presetAutosaveTimer = useRef<number | null>(null);
  const {
    all: packOv,
    setBinding,
    clearBinding,
    resetPage,
    resetAll,
    replaceAll,
  } = usePackBindOverrides();
  const [previewPageDrafts, setPreviewPageDrafts] = useState<PreviewPageDrafts>({});
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const previewPageDraftsRef = useRef<PreviewPageDrafts>({});
  const previewDraftPastRef = useRef<PreviewPageDrafts[]>([]);
  const previewDraftFutureRef = useRef<PreviewPageDrafts[]>([]);
  const [previewDraftHistoryVersion, setPreviewDraftHistoryVersion] = useState(0);
  const generatePresets = useLiveQuery(
    () => db.generatePresets.where("mode").equals("pack").toArray(),
    [],
  );

  const selectedPack = packs.find((p) => p.packTemplateId === packId);
  const packPages: PageTemplate[] = useMemo(() => {
    if (!selectedPack) return [];
    const map = new Map(tpls.map((t) => [t.pageTemplateId, t]));
    return selectedPack.orderedPages.map((id) => map.get(id)).filter((t): t is PageTemplate => !!t);
  }, [selectedPack, tpls]);

  const activePage = packPages[activePageIdx];
  const matchingPresets = useMemo(
    () => (generatePresets ?? []).sort((a, b) => b.updatedAt - a.updatedAt),
    [generatePresets],
  );
  const canUndoPreviewDraft =
    previewDraftHistoryVersion >= 0 && previewDraftPastRef.current.length > 0;
  const canRedoPreviewDraft =
    previewDraftHistoryVersion >= 0 && previewDraftFutureRef.current.length > 0;

  const touchPreviewDraftHistory = () =>
    setPreviewDraftHistoryVersion((version) => version + 1);

  const clearPreviewDraftHistory = () => {
    previewDraftPastRef.current = [];
    previewDraftFutureRef.current = [];
    touchPreviewDraftHistory();
  };

  const setPreviewDraftsNoHistory = (next: PreviewPageDrafts) => {
    previewPageDraftsRef.current = next;
    setPreviewPageDrafts(next);
  };

  const commitPreviewPageDrafts = (
    updater: (prev: PreviewPageDrafts) => PreviewPageDrafts,
    options: { history?: boolean } = {},
  ) => {
    const prev = previewPageDraftsRef.current;
    const next = updater(prev);
    if (next === prev) return;

    if (options.history !== false) {
      previewDraftPastRef.current = [
        ...previewDraftPastRef.current,
        clonePreviewPageDrafts(prev),
      ].slice(-DRAFT_HISTORY_LIMIT);
      previewDraftFutureRef.current = [];
      touchPreviewDraftHistory();
    }

    setPreviewDraftsNoHistory(next);
  };

  const resetPreviewPageDrafts = (options: { history?: boolean } = {}) => {
    commitPreviewPageDrafts(() => ({}), options);
    if (options.history === false) clearPreviewDraftHistory();
  };

  const undoPreviewPageDrafts = () => {
    const previous = previewDraftPastRef.current.at(-1);
    if (!previous) return;
    previewDraftPastRef.current = previewDraftPastRef.current.slice(0, -1);
    previewDraftFutureRef.current = [
      ...previewDraftFutureRef.current,
      clonePreviewPageDrafts(previewPageDraftsRef.current),
    ].slice(-DRAFT_HISTORY_LIMIT);
    setPreviewDraftsNoHistory(clonePreviewPageDrafts(previous));
    touchPreviewDraftHistory();
  };

  const redoPreviewPageDrafts = () => {
    const next = previewDraftFutureRef.current.at(-1);
    if (!next) return;
    previewDraftFutureRef.current = previewDraftFutureRef.current.slice(0, -1);
    previewDraftPastRef.current = [
      ...previewDraftPastRef.current,
      clonePreviewPageDrafts(previewPageDraftsRef.current),
    ].slice(-DRAFT_HISTORY_LIMIT);
    setPreviewDraftsNoHistory(clonePreviewPageDrafts(next));
    touchPreviewDraftHistory();
  };

  const effectiveActive = useMemo(
    () =>
      activePage
        ? resolvePageWorkingTemplate(
            activePage,
            packOv[activePage.pageTemplateId],
            previewPageDrafts[activePage.pageTemplateId],
          )
        : undefined,
    [activePage, packOv, previewPageDrafts],
  );

  const globalGenerateConfig: ResolvedGeneratePageConfig = useMemo(
    () => ({
      selectedSheet,
      filterMoHinh,
      filterPhongCach,
      prioritizePartner,
      onlyPartner,
      partnerQuotaPerPage: onlyPartner ? Number.MAX_SAFE_INTEGER : Math.max(0, partnerQuotaPerPage),
      maxEntities: normalizeCount(maxEntities, 5),
    }),
    [
      selectedSheet,
      filterMoHinh,
      filterPhongCach,
      prioritizePartner,
      onlyPartner,
      partnerQuotaPerPage,
      maxEntities,
    ],
  );

  const activePageConfigEnabled = !!activePage && !!pageConfigs[activePage.pageTemplateId];
  const activeGenerateConfig = useMemo(
    () =>
      resolveGeneratePageConfig(
        globalGenerateConfig,
        activePage ? pageConfigs[activePage.pageTemplateId] : undefined,
      ),
    [globalGenerateConfig, activePage, pageConfigs],
  );
  // Filter options are scoped to the page currently being edited.
  const moHinhOptions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((entity) => {
      if (entity.status !== "active") return;
      if (
        activeGenerateConfig.selectedSheet !== ALL_VALUE &&
        entity.sheetName !== activeGenerateConfig.selectedSheet
      ) {
        return;
      }
      if (entity.categoryMain) set.add(entity.categoryMain);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [entities, activeGenerateConfig.selectedSheet]);

  const phongCachOptions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((entity) => {
      if (entity.status !== "active") return;
      if (
        activeGenerateConfig.selectedSheet !== ALL_VALUE &&
        entity.sheetName !== activeGenerateConfig.selectedSheet
      ) {
        return;
      }
      if (entity.categorySub) set.add(entity.categorySub);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [entities, activeGenerateConfig.selectedSheet]);
  const hasMoHinhOptions = moHinhOptions.length > 0;
  const hasPhongCachOptions = phongCachOptions.length > 0;

  const globalAvailableEntities = useMemo(
    () => buildSourceFilteredEntities(entities, globalGenerateConfig),
    [entities, globalGenerateConfig],
  );
  const activeAvailableEntities = useMemo(
    () => buildSourceFilteredEntities(entities, activeGenerateConfig),
    [entities, activeGenerateConfig],
  );
  const filteredEntities = useMemo(
    () => buildConfiguredEntityPool(globalAvailableEntities, globalGenerateConfig),
    [globalAvailableEntities, globalGenerateConfig],
  );
  const activeFilteredEntities = useMemo(
    () => buildConfiguredEntityPool(activeAvailableEntities, activeGenerateConfig),
    [activeAvailableEntities, activeGenerateConfig],
  );
  const hasActiveDataFilters =
    activeGenerateConfig.selectedSheet !== ALL_VALUE ||
    activeGenerateConfig.filterMoHinh !== ALL_VALUE ||
    activeGenerateConfig.filterPhongCach !== ALL_VALUE;
  const generationBaseEntities = useMemo(
    () => entities.filter((entity) => entity.status === "active"),
    [entities],
  );
  const pageTemplatesForGenerate = useMemo(
    () => tpls.map((tpl) => previewPageDrafts[tpl.pageTemplateId] ?? tpl),
    [tpls, previewPageDrafts],
  );
  const previewGenerateJob = useMemo(() => {
    if (!selectedPack) return null;
    return generatePackJob({
      pack: selectedPack,
      pageTemplates: pageTemplatesForGenerate,
      entities,
      assets,
      mode: "one-entity-per-pack",
      entityPool: generationBaseEntities,
      bindOverrides: packOv,
      partnerQuotaPerPage: globalGenerateConfig.partnerQuotaPerPage,
      prioritizePartner,
      onlyPartner,
      maxEntities,
      selectedSheet: globalGenerateConfig.selectedSheet,
      filterMoHinh: globalGenerateConfig.filterMoHinh,
      filterPhongCach: globalGenerateConfig.filterPhongCach,
      pageConfigs,
    });
  }, [
    selectedPack,
    pageTemplatesForGenerate,
    entities,
    assets,
    generationBaseEntities,
    packOv,
    globalGenerateConfig,
    prioritizePartner,
    onlyPartner,
    maxEntities,
    pageConfigs,
  ]);
  const estimateGeneratedPageCount = previewGenerateJob?.pages.length ?? 0;

  const updateActiveGenerateConfig = (patch: Partial<GeneratePageConfig>) => {
    if (activePageConfigEnabled && activePage) {
      setPageConfigs((prev) => ({
        ...prev,
        [activePage.pageTemplateId]: (() => {
          const current = resolveGeneratePageConfig(
            globalGenerateConfig,
            prev[activePage.pageTemplateId],
          );
          const next: GeneratePageConfig = { ...current, ...patch };
          if (patch.onlyPartner === false && current.onlyPartner) {
            next.partnerQuotaPerPage = globalGenerateConfig.onlyPartner
              ? 0
              : globalGenerateConfig.partnerQuotaPerPage;
          }
          return next;
        })(),
      }));
      return;
    }
    if (patch.prioritizePartner != null) setPrioritizePartner(patch.prioritizePartner);
    if (patch.onlyPartner != null) setOnlyPartner(patch.onlyPartner);
    if (patch.partnerQuotaPerPage != null) {
      setPartnerQuotaPerPage(Math.max(0, Math.floor(patch.partnerQuotaPerPage)));
    }
    if (patch.maxEntities != null) setMaxEntities(normalizeCount(patch.maxEntities, maxEntities));
    if (patch.selectedSheet != null) setSelectedSheet(patch.selectedSheet);
    if (patch.filterMoHinh != null) setFilterMoHinh(patch.filterMoHinh);
    if (patch.filterPhongCach != null) setFilterPhongCach(patch.filterPhongCach);
  };
  const updateActiveSourceConfig = (
    patch: Pick<GeneratePageConfig, "selectedSheet" | "filterMoHinh" | "filterPhongCach">,
  ) => {
    if (patch.selectedSheet != null) setLastActiveSheet(patch.selectedSheet);
    if (!activePage) {
      updateActiveGenerateConfig(patch);
      return;
    }
    setPageConfigs((prev) => ({
      ...prev,
      [activePage.pageTemplateId]: {
        ...resolveGeneratePageConfig(globalGenerateConfig, prev[activePage.pageTemplateId]),
        ...patch,
      },
    }));
  };
  const applyActiveSourceToAllPages = () => {
    setSelectedSheet(activeGenerateConfig.selectedSheet);
    setFilterMoHinh(activeGenerateConfig.filterMoHinh);
    setFilterPhongCach(activeGenerateConfig.filterPhongCach);
    setLastActiveSheet(activeGenerateConfig.selectedSheet);
    setPageConfigs((prev) => {
      const next: Record<string, GeneratePageConfig> = {};
      Object.entries(prev).forEach(([pageTemplateId, config]) => {
        const rest = { ...config };
        delete rest.selectedSheet;
        delete rest.filterMoHinh;
        delete rest.filterPhongCach;
        if (Object.keys(rest).length > 0) next[pageTemplateId] = rest;
      });
      return next;
    });
    toast.success("Đã áp dụng nguồn dữ liệu này cho tất cả trang");
  };
  const toggleActivePageConfig = (enabled: boolean) => {
    if (!activePage) return;
    setPageConfigs((prev) => {
      if (!enabled) {
        const next = { ...prev };
        delete next[activePage.pageTemplateId];
        return next;
      }
      return {
        ...prev,
        [activePage.pageTemplateId]: resolveGeneratePageConfig(
          globalGenerateConfig,
          prev[activePage.pageTemplateId],
        ),
      };
    });
  };
  const enabledPageConfigCount = Object.keys(pageConfigs).length;

  const buildOrderedEntityPool = (
    primaryEntityId: string | undefined,
    pool: Entity[] = filteredEntities,
  ): Entity[] => {
    if (!primaryEntityId) return pool;
    return [
      ...pool.filter((entity) => entity.entityId === primaryEntityId),
      ...pool.filter((entity) => entity.entityId !== primaryEntityId),
    ];
  };

  const buildPageEntityPool = (page: GenerationJob["pages"][number] | undefined): Entity[] => {
    if (page?.entityPoolIds?.length) {
      const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
      const pool = page.entityPoolIds
        .map((entityId) => byId.get(entityId))
        .filter((entity): entity is Entity => !!entity);
      if (pool.length > 0) return pool;
    }
    return buildOrderedEntityPool(page?.entityId);
  };

  const buildPresetPreviewRenderContext = (
    preset: GenerateBindingPreset,
    template: PageTemplate,
  ) => {
    const cfg = preset.generateConfig ?? {};
    const presetGlobalConfig = resolveGeneratePageConfig(globalGenerateConfig, {
      selectedSheet: cfg.selectedSheet,
      filterMoHinh: cfg.filterMoHinh,
      filterPhongCach: cfg.filterPhongCach,
      prioritizePartner: cfg.prioritizePartner,
      onlyPartner: cfg.onlyPartner,
      partnerQuotaPerPage: cfg.partnerQuotaPerPage,
      maxEntities: cfg.maxEntities,
    });
    const presetPageConfig = resolveGeneratePageConfig(
      presetGlobalConfig,
      cfg.pageConfigs?.[template.pageTemplateId],
    );
    const source = buildSourceFilteredEntities(entities, presetPageConfig);
    const configuredPool = buildConfiguredEntityPool(source, presetPageConfig);
    const pool =
      configuredPool.length > 0
        ? configuredPool
        : activeFilteredEntities.length > 0
          ? activeFilteredEntities
          : filteredEntities;
    const owner = pool[0];
    const targetCount = buildEntityBindingTargets(template, pool).length;
    const allocation =
      owner && targetCount > 0
        ? allocateEntityBindingsForTemplate({
            template,
            orderedEntities: pool,
            pageOwner: targetCount <= 1 ? owner : undefined,
            partnerQuota: presetPageConfig.partnerQuotaPerPage,
            prioritizePartner: presetPageConfig.prioritizePartner,
            batchState: { usedEntityIds: new Set<string>() },
          })
        : undefined;
    return {
      entity: owner,
      entityPool: pool,
      slotItems: allocation?.items ?? [],
    };
  };

  const previewEntityPool = useMemo(
    () => buildOrderedEntityPool(previewEntityId, activeFilteredEntities),
    [activeFilteredEntities, previewEntityId],
  );

  const activeTargetCount = useMemo(
    () =>
      effectiveActive
        ? buildEntityBindingTargets(effectiveActive, activeFilteredEntities).length
        : 0,
    [effectiveActive, activeFilteredEntities],
  );

  const handleSelectSheet = (sheet: string) => {
    updateActiveSourceConfig({
      selectedSheet: sheet,
      filterMoHinh: ALL_VALUE,
      filterPhongCach: ALL_VALUE,
    });
  };

  useEffect(() => {
    previewPageDraftsRef.current = previewPageDrafts;
  }, [previewPageDrafts]);

  // Reset slot khi đổi pack/page
  useEffect(() => {
    setSelectedSlotIds([]);
    setFormatClipboard(null);
    setActivePageIdx(0);
    setPageConfigs({});
    resetPreviewPageDrafts({ history: false });
    setEditingPageIndex(null);
    setEditingPreviewOpen(false);
  }, [packId]);
  useEffect(() => {
    setSelectedSlotIds([]);
    setEditingPreviewOpen(false);
  }, [activePageIdx]);
  useEffect(() => {
    if (!previewEntityId && activeFilteredEntities[0]) {
      setPreviewEntityId(activeFilteredEntities[0].entityId);
    }
    if (
      previewEntityId &&
      !activeFilteredEntities.find((e) => e.entityId === previewEntityId)
    ) {
      setPreviewEntityId(activeFilteredEntities[0]?.entityId);
    }
  }, [activeFilteredEntities, previewEntityId]);
  useEffect(() => {
    if (selectedSheet !== ALL_VALUE && sheetOptions.includes(selectedSheet)) return;
    const rememberedSheet = getLastActiveSheet();
    if (rememberedSheet && sheetOptions.includes(rememberedSheet)) {
      setSelectedSheet(rememberedSheet);
      return;
    }
    if (selectedSheet === ALL_VALUE && sheetOptions.length === 1) {
      setSelectedSheet(sheetOptions[0]);
    }
  }, [selectedSheet, sheetOptions]);

  useEffect(() => {
    if (!selectedPresetId) return;
    if (matchingPresets.some((preset) => preset.presetId === selectedPresetId)) return;
    setSelectedPresetId("");
  }, [matchingPresets, selectedPresetId]);

  useEffect(() => {
    if (!hasMoHinhOptions && activeGenerateConfig.filterMoHinh !== ALL_VALUE) {
      updateActiveSourceConfig({ filterMoHinh: ALL_VALUE });
    }
  }, [hasMoHinhOptions, activeGenerateConfig.filterMoHinh]);

  useEffect(() => {
    if (!hasPhongCachOptions && activeGenerateConfig.filterPhongCach !== ALL_VALUE) {
      updateActiveSourceConfig({ filterPhongCach: ALL_VALUE });
    }
  }, [hasPhongCachOptions, activeGenerateConfig.filterPhongCach]);

  useEffect(() => {
    if (!workspaceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== "z") return;
      if (event.shiftKey) {
        if (previewDraftFutureRef.current.length === 0) return;
        event.preventDefault();
        redoPreviewPageDrafts();
        return;
      }
      if (previewDraftPastRef.current.length === 0) return;
      event.preventDefault();
      undoPreviewPageDrafts();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspaceOpen]);

  const previewEntity = entities.find((e) => e.entityId === previewEntityId);
  const selectedSlots = useMemo(
    () =>
      selectedSlotIds
        .map((slotId) => effectiveActive?.slots.find((slot) => slot.slotId === slotId))
        .filter((slot): slot is Slot => !!slot),
    [effectiveActive, selectedSlotIds],
  );
  const selectedSlot: Slot | undefined = selectedSlots[selectedSlots.length - 1];
  const previewSlotItems = useMemo(() => {
    if (!effectiveActive || !previewEntity) return [];
    const shouldPinPreviewOwner = activeTargetCount <= 1;
    const allocation = allocateEntityBindingsForTemplate({
      template: effectiveActive,
      orderedEntities: buildOrderedEntityPool(previewEntityId, activeFilteredEntities),
      pageOwner: shouldPinPreviewOwner ? previewEntity : undefined,
      partnerQuota: activeGenerateConfig.partnerQuotaPerPage,
      prioritizePartner: activeGenerateConfig.prioritizePartner,
      batchState: { usedEntityIds: new Set<string>() },
    });
    return allocation.items;
  }, [
    effectiveActive,
    previewEntity,
    activeFilteredEntities,
    activeGenerateConfig,
    activeTargetCount,
  ]);
  const getSlotBindMode = (slot: Slot): "text" | "image" | null => {
    if (slot.kind === "text") return "text";
    if (slot.kind === "image") return "image";
    if (slot.kind === "shape") return slot.staticText?.trim() ? "text" : "image";
    return null;
  };
  const selectedTextSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) === "text");
  const selectedImageSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) === "image");
  const selectedBindableSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) !== null);
  const selectedDataGroupIds = Array.from(
    new Set(
      selectedBindableSlots
        .map((slot) => slot.dataGroupId)
        .filter((dataGroupId): dataGroupId is string => !!dataGroupId),
    ),
  );
  const selectedFormatBaseSlot = selectedBindableSlots[selectedBindableSlots.length - 1];
  const relatedFormatTargetSlots =
    effectiveActive && selectedFormatBaseSlot
      ? effectiveActive.slots.filter((slot) => {
          if (getSlotBindMode(slot) === null) return false;
          if (selectedFormatBaseSlot.dataGroupId) {
            return slot.dataGroupId === selectedFormatBaseSlot.dataGroupId;
          }
          if (selectedFormatBaseSlot.groupId)
            return slot.groupId === selectedFormatBaseSlot.groupId;
          if (selectedFormatBaseSlot.sectionRefId) {
            return slot.sectionRefId === selectedFormatBaseSlot.sectionRefId;
          }
          return false;
        })
      : [];
  const sortedSelectedTextSlots = useMemo(
    () =>
      selectedTextSlots
        .slice()
        .sort((a, b) => a.y - b.y || a.x - b.x || a.slotId.localeCompare(b.slotId)),
    [selectedTextSlots],
  );
  const sortedSelectedImageSlots = useMemo(
    () =>
      selectedImageSlots
        .slice()
        .sort((a, b) => a.y - b.y || a.x - b.x || a.slotId.localeCompare(b.slotId)),
    [selectedImageSlots],
  );
  const textSlotBindingValue = (slot: Slot) =>
    parseEntityListBindingPath(slot.bindingPath)
      ? "__list"
      : getEntityScopedTextBindingBasePath(slot.bindingPath) || "_static";
  const textSlotFieldBindingValue = (slot: Slot) =>
    getEntityScopedTextBindingBasePath(slot.bindingPath) || "_static";
  const textSlotSourceValue = (slot: Slot) =>
    parseEntityScopedTextBindingPath(slot.bindingPath)?.sheetName ?? "__current";
  const imageSlotBindingValue = (slot: Slot) =>
    isAssetRandomScopeBindingPath(slot.bindingPath)
      ? ASSET_RANDOM_SCOPE_BINDING_VALUE
      : (slot.bindingPath ?? "_static");
  const normalizeSlotLabel = (label: string | undefined, fallback: string) => {
    const value = label?.trim();
    if (!value) return fallback;
    if (/^text$/i.test(value)) return fallback;
    if (/^\d+\s*,\s*\d+$/.test(value)) return fallback;
    if (/^image$/i.test(value)) return "Ảnh";
    return value;
  };
  const textSlotLabel = (slot: Slot, index: number) =>
    normalizeSlotLabel(
      slot.name?.trim() ||
        slot.staticText?.trim() ||
        (slot.bindingPath
          ? TEXT_BINDING_OPTIONS.find(
              (option) => (option.value || "_static") === textSlotBindingValue(slot),
            )?.label
          : undefined),
      `Chữ ${index + 1}`,
    );
  const imageSlotLabel = (slot: Slot, index: number) =>
    normalizeSlotLabel(
      slot.name?.trim() ||
        IMAGE_BINDING_OPTIONS.find((option) => option.value === imageSlotBindingValue(slot))?.label,
      `Ảnh ${index + 1}`,
    );
  const slotFormatLabel = (slot: Slot, index: number) => {
    const mode = getSlotBindMode(slot);
    if (mode === "text") return textSlotLabel(slot, index);
    if (mode === "image") return imageSlotLabel(slot, index);
    return normalizeSlotLabel(slot.name?.trim(), `Khối ${index + 1}`);
  };
  const slotFormatBindingKey = (slot: Slot) => {
    const mode = getSlotBindMode(slot);
    if (mode === "text") return `text:${textSlotBindingValue(slot)}`;
    if (mode === "image") return `image:${imageSlotBindingValue(slot)}`;
    return "unknown";
  };
  const buildTextBindingPathForSlot = (slot: Slot, fieldPath: string) => {
    const sourceSheet = textSlotSourceValue(slot);
    return buildEntityScopedTextBindingPath({
      path: fieldPath,
      sheetName: sourceSheet === "__current" ? undefined : sourceSheet,
    });
  };
  const handleSelectSlot = (
    slotId: string | null,
    mode: "replace" | "toggle" | "group" | "replace-many" = "replace",
    relatedSlotIds: string[] = [],
  ) => {
    if (mode === "replace-many") {
      setSelectedSlotIds(Array.from(new Set(relatedSlotIds)));
      return;
    }
    if (!slotId) {
      setSelectedSlotIds([]);
      return;
    }
    setSelectedSlotIds((prev) => {
      if (mode === "replace") {
        return relatedSlotIds.length > 1 ? Array.from(new Set(relatedSlotIds)) : [slotId];
      }
      if (mode === "toggle") {
        return prev.includes(slotId) ? prev.filter((id) => id !== slotId) : [...prev, slotId];
      }
      if (mode === "group") {
        const ids = relatedSlotIds.length > 0 ? relatedSlotIds : [slotId];
        const selectedSet = new Set(prev);
        const allSelected = ids.every((id) => selectedSet.has(id));
        if (allSelected) return prev.filter((id) => !ids.includes(id));
        return Array.from(new Set([...prev, ...ids]));
      }
      return [slotId];
    });
  };
  const updateSurfaceMarqueeSelection = (surface: HTMLDivElement, rect: SurfaceSelectionRect) => {
    const ids = Array.from(surface.querySelectorAll<HTMLElement>("[data-bind-hit-target]"))
      .filter((node) => {
        const nodeRect = node.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const localRect: SurfaceSelectionRect = {
          left: nodeRect.left - surfaceRect.left + surface.scrollLeft,
          top: nodeRect.top - surfaceRect.top + surface.scrollTop,
          width: nodeRect.width,
          height: nodeRect.height,
        };
        return surfaceRectsIntersect(rect, localRect);
      })
      .map((node) => node.dataset.bindHitTarget)
      .filter((slotId): slotId is string => !!slotId);
    const signature = ids.join("|");
    if (signature === surfaceSelectionRef.current?.lastSignature) return;
    if (surfaceSelectionRef.current) surfaceSelectionRef.current.lastSignature = signature;
    setSelectedSlotIds(Array.from(new Set(ids)));
  };
  const startSurfaceMarqueeSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-bind-hit-target]") || target.closest("[data-bind-canvas-root]")) {
      return;
    }

    event.preventDefault();
    const surface = event.currentTarget;
    const pointerId = event.pointerId;
    const start = getSurfacePoint(surface, event.clientX, event.clientY);
    surfaceSelectionRef.current = { start, active: false, lastSignature: "" };
    try {
      surface.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; the fallback listeners still stop the session.
    }

    const cleanup = () => {
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onCancel);
      surface.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      try {
        if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      } catch {
        // Ignore release errors from browsers that already ended the capture.
      }
      surfaceSelectionRef.current = null;
      setSurfaceMarqueeRect(null);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const state = surfaceSelectionRef.current;
      if (!state) return;
      const current = getSurfacePoint(surface, moveEvent.clientX, moveEvent.clientY);
      const moved = Math.hypot(current.x - state.start.x, current.y - state.start.y);
      if (!state.active && moved < 4) return;
      state.active = true;
      const rect = normalizeSurfaceSelectionRect(state.start, current);
      setSurfaceMarqueeRect(rect);
      updateSurfaceMarqueeSelection(surface, rect);
      moveEvent.preventDefault();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const state = surfaceSelectionRef.current;
      if (state?.active) {
        const current = getSurfacePoint(surface, upEvent.clientX, upEvent.clientY);
        updateSurfaceMarqueeSelection(surface, normalizeSurfaceSelectionRect(state.start, current));
        upEvent.preventDefault();
      } else {
        setSelectedSlotIds([]);
      }
      cleanup();
    };

    const onCancel = () => cleanup();
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") cleanup();
    };

    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onCancel);
    surface.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown);
  };
  const applyBindingToSlots = (
    slots: Slot[],
    pageTemplateId: string,
    bindingPath: string | undefined,
  ) => {
    slots.forEach((slot) => setBinding(pageTemplateId, slot.slotId, bindingPath));
    commitPreviewPageDrafts((prev) => {
      const current = prev[pageTemplateId];
      if (!current) return prev;
      const next = createWorkingTemplate(current, undefined, current);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: bindingPath || undefined };
      });
      next.updatedAt = Date.now();
      return { ...prev, [pageTemplateId]: next };
    }, { history: false });
  };
  const applyTextBindingSelection = (slot: Slot, value: string) => {
    if (!activePage) return;
    if (value === "__list") return;
    const bindingPath = value === "_static" ? undefined : buildTextBindingPathForSlot(slot, value);
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const applyTextSourceSelection = (slot: Slot, sheetName: string) => {
    if (!activePage) return;
    const currentField = textSlotFieldBindingValue(slot);
    if (currentField === "_static") return;
    const bindingPath = buildEntityScopedTextBindingPath({
      path: currentField,
      sheetName: sheetName === "__current" ? undefined : sheetName,
    });
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const setDataGroupForSlots = (slots: Slot[], dataGroupId: string | undefined) => {
    if (!activePage || !effectiveActive) return;
    const targetIds = new Set(slots.map((slot) => slot.slotId));
    let changed = false;
    commitPreviewPageDrafts((prev) => {
      const current = createWorkingTemplate(effectiveActive, undefined, effectiveActive);
      current.slots = current.slots.map((slot) => {
        if (!targetIds.has(slot.slotId)) return slot;
        if (slot.dataGroupId === dataGroupId) return slot;
        changed = true;
        return { ...slot, dataGroupId };
      });
      if (!changed) return prev;
      current.updatedAt = Date.now();
      return { ...prev, [activePage.pageTemplateId]: current };
    });
  };
  const groupSelectedDataSlots = () => {
    if (selectedBindableSlots.length < 2) {
      toast.error("Chọn ít nhất 2 khối để nhóm dữ liệu");
      return;
    }
    const dataGroupId = createDataGroupId();
    setDataGroupForSlots(selectedBindableSlots, dataGroupId);
    toast.success(`Đã nhóm ${selectedBindableSlots.length} khối dữ liệu`);
  };
  const clearSelectedDataGroups = () => {
    const groupedSlots = selectedBindableSlots.filter((slot) => slot.dataGroupId);
    if (groupedSlots.length === 0) {
      toast.error("Các khối đang chọn chưa có nhóm dữ liệu");
      return;
    }
    setDataGroupForSlots(groupedSlots, undefined);
    toast.success("Đã bỏ nhóm dữ liệu");
  };
  const copySelectedSlotFormat = () => {
    const sourceSlots = sortSlotsForFormat(selectedBindableSlots);
    if (sourceSlots.length === 0) {
      toast.error("Chọn ít nhất 1 khối để sao chép kiểu & liên kết");
      return;
    }

    const sourceDataGroupCounts = new Map<string, number>();
    sourceSlots.forEach((slot) => {
      if (!slot.dataGroupId) return;
      sourceDataGroupCounts.set(slot.dataGroupId, (sourceDataGroupCounts.get(slot.dataGroupId) ?? 0) + 1);
    });

    const snapshots = sourceSlots
      .map((slot, index): SlotFormatSnapshot | null => {
        const mode = getSlotBindMode(slot);
        if (!mode) return null;
        const dataGroupKey =
          slot.dataGroupId && (sourceDataGroupCounts.get(slot.dataGroupId) ?? 0) > 1
            ? slot.dataGroupId
            : undefined;
        return {
          sourceSlotId: slot.slotId,
          sourceLabel: slotFormatLabel(slot, index),
          bindMode: mode,
          bindingKey: slotFormatBindingKey(slot),
          sourceX: slot.x,
          sourceY: slot.y,
          sourceWidth: slot.width,
          sourceHeight: slot.height,
          sourceZIndex: slot.zIndex,
          rotation: slot.rotation,
          style: cloneSlotStyle(slot.style),
          crop: cloneSlotCrop(slot.crop),
          bindingPath: slot.bindingPath,
          fieldParts: cloneJsonValue(slot.fieldParts),
          allowedAssetRoles: cloneJsonValue(slot.allowedAssetRoles),
          dataGroupKey,
          visibilityRule: slot.visibilityRule,
          overflowRule: slot.overflowRule,
        };
      })
      .filter((snapshot): snapshot is SlotFormatSnapshot => !!snapshot);

    if (snapshots.length === 0) {
      toast.error("Khối đang chọn không có kiểu hoặc liên kết để sao chép");
      return;
    }

    const label = snapshots.length === 1 ? snapshots[0].sourceLabel : `${snapshots.length} khối`;
    setFormatClipboard({ label, snapshots });
    toast.success(`Đã sao chép kiểu & liên kết của ${label}`);
  };
  const buildFormatAssignments = (targets: Slot[]) => {
    if (!formatClipboard) return new Map<string, SlotFormatAssignment>();

    const sortedTargets = sortSlotsForFormat(targets).filter((target) => getSlotBindMode(target));
    const byKey = new Map<string, SlotFormatSnapshot[]>();
    const byMode = new Map<FormatSlotMode, SlotFormatSnapshot[]>();
    for (const snapshot of formatClipboard.snapshots) {
      const keyGroup = byKey.get(snapshot.bindingKey) ?? [];
      keyGroup.push(snapshot);
      byKey.set(snapshot.bindingKey, keyGroup);

      const modeGroup = byMode.get(snapshot.bindMode) ?? [];
      modeGroup.push(snapshot);
      byMode.set(snapshot.bindMode, modeGroup);
    }

    if (
      formatClipboard.snapshots.length > 1 &&
      sortedTargets.length >= formatClipboard.snapshots.length &&
      sortedTargets.length % formatClipboard.snapshots.length === 0
    ) {
      const chunkedAssignments = new Map<string, SlotFormatAssignment>();
      const chunkSize = formatClipboard.snapshots.length;
      for (let start = 0; start < sortedTargets.length; start += chunkSize) {
        const chunk = sortedTargets.slice(start, start + chunkSize);
        const bounds = buildSlotBounds(chunk) ?? undefined;
        const chunkDataGroupIds = new Map<string, string>();
        const chunkMatches = chunk.every((target, index) => {
          const snapshot = formatClipboard.snapshots[index];
          return snapshot && getSlotBindMode(target) === snapshot.bindMode;
        });
        if (!chunkMatches) {
          chunkedAssignments.clear();
          break;
        }
        chunk.forEach((target, index) => {
          const snapshot = formatClipboard.snapshots[index];
          let dataGroupId: string | undefined;
          if (snapshot.dataGroupKey) {
            dataGroupId = chunkDataGroupIds.get(snapshot.dataGroupKey);
            if (!dataGroupId) {
              dataGroupId = createDataGroupId();
              chunkDataGroupIds.set(snapshot.dataGroupKey, dataGroupId);
            }
          }
          chunkedAssignments.set(target.slotId, {
            snapshot,
            layoutBounds: bounds,
            dataGroupId,
          });
        });
      }
      if (chunkedAssignments.size === sortedTargets.length) return chunkedAssignments;
    }

    if (sortedTargets.length === formatClipboard.snapshots.length) {
      const orderedAssignments = new Map<string, SlotFormatAssignment>();
      const bounds = buildSlotBounds(sortedTargets) ?? undefined;
      const dataGroupIds = new Map<string, string>();
      sortedTargets.forEach((target, index) => {
        const snapshot = formatClipboard.snapshots[index];
        if (snapshot && getSlotBindMode(target) === snapshot.bindMode) {
          let dataGroupId: string | undefined;
          if (snapshot.dataGroupKey) {
            dataGroupId = dataGroupIds.get(snapshot.dataGroupKey);
            if (!dataGroupId) {
              dataGroupId = createDataGroupId();
              dataGroupIds.set(snapshot.dataGroupKey, dataGroupId);
            }
          }
          orderedAssignments.set(target.slotId, { snapshot, layoutBounds: bounds, dataGroupId });
        }
      });
      if (orderedAssignments.size === sortedTargets.length) return orderedAssignments;
    }

    if (formatClipboard.snapshots.length > 1) {
      const partialOrderedAssignments = new Map<string, SlotFormatAssignment>();
      const bounds = buildSlotBounds(sortedTargets) ?? undefined;
      const dataGroupIds = new Map<string, string>();
      sortedTargets.forEach((target, index) => {
        const snapshot = formatClipboard.snapshots[index];
        if (!snapshot || getSlotBindMode(target) !== snapshot.bindMode) return;
        let dataGroupId: string | undefined;
        if (snapshot.dataGroupKey) {
          dataGroupId = dataGroupIds.get(snapshot.dataGroupKey);
          if (!dataGroupId) {
            dataGroupId = createDataGroupId();
            dataGroupIds.set(snapshot.dataGroupKey, dataGroupId);
          }
        }
        partialOrderedAssignments.set(target.slotId, {
          snapshot,
          layoutBounds: bounds,
          dataGroupId,
        });
      });
      if (partialOrderedAssignments.size > 0) return partialOrderedAssignments;
    }

    const modeOrderedAssignments = new Map<string, SlotFormatAssignment>();
    const modeOrderedUseCount = new Map<FormatSlotMode, number>();
    for (const target of sortedTargets) {
      const mode = getSlotBindMode(target);
      if (!mode) continue;
      const modeMatches = byMode.get(mode) ?? [];
      if (modeMatches.length === 0) continue;
      const used = modeOrderedUseCount.get(mode) ?? 0;
      if (formatClipboard.snapshots.length > 1 && used >= modeMatches.length) continue;
      modeOrderedAssignments.set(target.slotId, {
        snapshot:
          formatClipboard.snapshots.length === 1
            ? modeMatches[0]
            : modeMatches[used],
      });
      modeOrderedUseCount.set(mode, used + 1);
    }
    if (modeOrderedAssignments.size === sortedTargets.length) return modeOrderedAssignments;

    const keyUseCount = new Map<string, number>();
    const modeUseCount = new Map<FormatSlotMode, number>();
    const assignments = new Map<string, SlotFormatAssignment>();

    for (const target of sortedTargets) {
      const mode = getSlotBindMode(target);
      if (!mode) continue;

      const bindingKey = slotFormatBindingKey(target);
      const exactMatches = byKey.get(bindingKey) ?? [];
      if (exactMatches.length > 0) {
        const used = keyUseCount.get(bindingKey) ?? 0;
        if (formatClipboard.snapshots.length > 1 && used >= exactMatches.length) continue;
        assignments.set(target.slotId, {
          snapshot:
            formatClipboard.snapshots.length === 1
              ? exactMatches[0]
              : exactMatches[used],
        });
        keyUseCount.set(bindingKey, used + 1);
        continue;
      }

      const modeMatches = byMode.get(mode) ?? [];
      if (modeMatches.length === 0) continue;
      const used = modeUseCount.get(mode) ?? 0;
      if (formatClipboard.snapshots.length > 1 && used >= modeMatches.length) continue;
      assignments.set(target.slotId, {
        snapshot:
          formatClipboard.snapshots.length === 1
            ? modeMatches[0]
            : modeMatches[used],
      });
      modeUseCount.set(mode, used + 1);
    }

    return assignments;
  };
  const applyCopiedSlotFormat = (targets: Slot[], scopeLabel: string) => {
    if (!activePage || !effectiveActive) return;
    if (!formatClipboard) {
      toast.error("Chưa sao chép kiểu & liên kết");
      return;
    }
    if (targets.length === 0) {
      toast.error("Chọn khối cần dán kiểu & liên kết");
      return;
    }

    const assignments = buildFormatAssignments(targets);
    if (assignments.size === 0) {
      toast.error("Không có khối cùng loại để dán kiểu & liên kết");
      return;
    }

    const shouldApplyGroupLayout = formatClipboard.snapshots.length > 1 && assignments.size > 1;
    const shouldApplyDataGroups = formatClipboard.snapshots.some((snapshot) => snapshot.dataGroupKey);
    const sourceBounds = shouldApplyGroupLayout
      ? buildSnapshotBounds(formatClipboard.snapshots)
      : null;
    let changed = false;

    commitPreviewPageDrafts((prev) => {
      const current = createWorkingTemplate(effectiveActive, undefined, effectiveActive);
      current.slots = current.slots.map((slot) => {
        const assignment = assignments.get(slot.slotId);
        if (!assignment) return slot;
        const { snapshot } = assignment;

        const nextStyle = cloneSlotStyle(snapshot.style);
        const nextCrop = cloneSlotCrop(snapshot.crop);
        const nextFieldParts = cloneJsonValue(snapshot.fieldParts);
        const nextAllowedAssetRoles = cloneJsonValue(snapshot.allowedAssetRoles);
        const shouldClearStaticImage = snapshot.bindMode === "image" && !!snapshot.bindingPath;
        const nextDataGroupId = shouldApplyDataGroups ? assignment.dataGroupId : slot.dataGroupId;
        const layoutPatch =
          sourceBounds && assignment.layoutBounds
            ? {
                x: assignment.layoutBounds.left + (snapshot.sourceX - sourceBounds.left),
                y: assignment.layoutBounds.top + (snapshot.sourceY - sourceBounds.top),
                width: snapshot.sourceWidth,
                height: snapshot.sourceHeight,
                zIndex: snapshot.sourceZIndex,
              }
            : {};
        const nextSlot = {
          ...slot,
          ...layoutPatch,
          rotation: snapshot.rotation,
          style: nextStyle,
          crop: nextCrop,
          bindingPath: snapshot.bindingPath,
          fieldParts: nextFieldParts,
          allowedAssetRoles: nextAllowedAssetRoles,
          dataGroupId: nextDataGroupId,
          visibilityRule: snapshot.visibilityRule,
          overflowRule: snapshot.overflowRule,
          staticImage: shouldClearStaticImage ? undefined : slot.staticImage,
        };
        if (
          slot.x !== nextSlot.x ||
          slot.y !== nextSlot.y ||
          slot.width !== nextSlot.width ||
          slot.height !== nextSlot.height ||
          slot.zIndex !== nextSlot.zIndex ||
          slot.rotation !== nextSlot.rotation ||
          stringifyFormatValue(slot.style) !== stringifyFormatValue(nextSlot.style) ||
          stringifyFormatValue(slot.crop) !== stringifyFormatValue(nextSlot.crop) ||
          slot.bindingPath !== nextSlot.bindingPath ||
          stringifyFormatValue(slot.fieldParts) !== stringifyFormatValue(nextSlot.fieldParts) ||
          stringifyFormatValue(slot.allowedAssetRoles) !==
            stringifyFormatValue(nextSlot.allowedAssetRoles) ||
          slot.dataGroupId !== nextSlot.dataGroupId ||
          slot.visibilityRule !== nextSlot.visibilityRule ||
          slot.overflowRule !== nextSlot.overflowRule ||
          slot.staticImage !== nextSlot.staticImage
        ) {
          changed = true;
        }
        return nextSlot;
      });
      if (!changed) return prev;
      current.updatedAt = Date.now();
      return { ...prev, [activePage.pageTemplateId]: current };
    });
    if (!changed) {
      toast.info("Các khối đang chọn đã giống kiểu & liên kết đã sao chép");
      return;
    }
    toast.success(`Đã dán kiểu & liên kết cho ${assignments.size} khối ${scopeLabel}`, {
      action: {
        label: "Hoàn tác",
        onClick: undoPreviewPageDrafts,
      },
    });
  };
  const clearBindingsForSlots = (slots: Slot[], pageTemplateId: string) => {
    slots.forEach((slot) => clearBinding(pageTemplateId, slot.slotId));
    commitPreviewPageDrafts((prev) => {
      const current = prev[pageTemplateId];
      if (!current) return prev;
      const next = createWorkingTemplate(current, undefined, current);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: undefined };
      });
      next.updatedAt = Date.now();
      return { ...prev, [pageTemplateId]: next };
    }, { history: false });
  };
  const randomImageFolderOptionsForSheet = (sheetName: string) => {
    const entityIds = new Set<string>();
    const values = new Set<string>();
    for (const entity of entities) {
      if (entity.status !== "active") continue;
      if (sheetName !== ALL_VALUE && entity.sheetName !== sheetName) continue;
      entityIds.add(entity.entityId);
      [entity.categoryMain, entity.categorySub, entity.style].forEach((value) => {
        if (value?.trim()) values.add(value.trim());
      });
      for (const key of ["folder", "Folder", "Thu_muc", "Thư mục", "Nhom_anh", "Nhóm ảnh"]) {
        const value = entity.metadata?.[key];
        if (typeof value === "string" && value.trim()) values.add(value.trim());
        if (typeof value === "number") values.add(String(value));
      }
    }
    for (const asset of assets) {
      if (entityIds.has(asset.entityId) && asset.role) values.add(asset.role);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "vi"));
  };
  const applyImageBindingSelection = (slot: Slot, value: string) => {
    if (!activePage) return;
    const bindingPath =
      value === "_static"
        ? undefined
        : value === ASSET_RANDOM_SCOPE_BINDING_VALUE
          ? buildAssetRandomScopeBindingPath({
              sheetName: activeGenerateConfig.selectedSheet,
              folder: ALL_VALUE,
            })
          : value;
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const applyRandomImageScope = (slot: Slot, patch: { sheetName?: string; folder?: string }) => {
    if (!activePage) return;
    const current = parseAssetRandomScopeBindingPath(slot.bindingPath);
    const next = {
      sheetName: patch.sheetName ?? current?.sheetName ?? activeGenerateConfig.selectedSheet,
      folder: patch.folder ?? current?.folder ?? ALL_VALUE,
    };
    applyBindingToSlots([slot], activePage.pageTemplateId, buildAssetRandomScopeBindingPath(next));
  };
  const totalBound = useMemo(
    () =>
      packPages.reduce(
        (acc, t) =>
          acc +
          (
            resolvePageWorkingTemplate(
              t,
              packOv[t.pageTemplateId],
              previewPageDrafts[t.pageTemplateId],
            )?.slots ?? []
          ).filter((s) => !!s.bindingPath).length,
        0,
      ),
    [packPages, packOv, previewPageDrafts],
  );
  const hasTextOrImageSlots = useMemo(
    () =>
      packPages.some((page) =>
        (resolvePageWorkingTemplate(
          page,
          packOv[page.pageTemplateId],
          previewPageDrafts[page.pageTemplateId],
        )?.slots ?? []).some((slot) => getSlotBindMode(slot) !== null),
      ),
    [packPages, packOv, previewPageDrafts],
  );
  const generateReadiness: GenerateReadiness = useMemo(() => {
    if (!selectedPack) return { canGenerate: false, reason: "Chưa chọn bộ mẫu" };
    if (packPages.length === 0) return { canGenerate: false, reason: "Bộ mẫu chưa có trang" };
    if (generationBaseEntities.length === 0) {
      return { canGenerate: false, reason: "Chưa có dữ liệu. Hãy nhập Google Sheet trước." };
    }
    if (!hasTextOrImageSlots) {
      return { canGenerate: false, reason: "Bộ mẫu chưa có khung chữ hoặc ảnh để đổ dữ liệu" };
    }
    if (totalBound === 0) {
      return { canGenerate: false, reason: "Chưa liên kết khung chữ/ảnh với dữ liệu" };
    }
    if (activeAvailableEntities.length === 0) {
      return {
        canGenerate: false,
        reason: hasActiveDataFilters
          ? "Bộ lọc không có dòng phù hợp"
          : "Trang này chưa chọn nguồn",
      };
    }
    if (estimateGeneratedPageCount === 0) {
      return { canGenerate: false, reason: "Bộ lọc hiện tại không có dòng phù hợp để tạo ảnh" };
    }
    return {
      canGenerate: true,
      reason: `Sẵn sàng tạo ${estimateGeneratedPageCount} trang từ ${activeFilteredEntities.length} dòng của trang này`,
    };
  }, [
    selectedPack,
    packPages.length,
    generationBaseEntities.length,
    hasTextOrImageSlots,
    totalBound,
    activeAvailableEntities.length,
    hasActiveDataFilters,
    estimateGeneratedPageCount,
    activeFilteredEntities.length,
  ]);
  const activeSourceLabel =
    activeGenerateConfig.selectedSheet === ALL_VALUE ? "Tất cả nguồn dữ liệu" : activeGenerateConfig.selectedSheet;
  const selectedSlotStatusLabel = (slot: Slot) => {
    if (!slot.bindingPath) return "Tĩnh";
    const listConfig = parseEntityListBindingPath(slot.bindingPath);
    if (listConfig) return "Danh sách";
    const textValue = textSlotFieldBindingValue(slot);
    if (textValue !== "_static") {
      return (
        TEXT_BINDING_OPTIONS.find((option) => (option.value || "_static") === textValue)?.label ??
        "Dữ liệu"
      );
    }
    const imageValue = imageSlotBindingValue(slot);
    if (imageValue !== "_static") return imageBindingOptionLabel(imageValue);
    return "Tĩnh";
  };

  const dataColumns = useMemo(() => {
    const set = new Set<string>();
    entities.slice(0, 50).forEach((e) => {
      [
        "name",
        "address",
        "phone",
        "priceRange",
        "style",
        "openingHours",
        "categoryMain",
        "categorySub",
      ].forEach((k) => {
        const v = (e as unknown as Record<string, unknown>)[k];
        if (v != null && v !== "") set.add(k);
      });
      if (e.metadata) Object.keys(e.metadata).forEach((k) => set.add("metadata." + k));
    });
    return Array.from(set);
  }, [entities]);

  const textListFieldOptions = useMemo<TextListFieldOption[]>(() => {
    const truncate = (value: unknown, max = 28) => {
      if (value == null) return "";
      const text = String(value).trim();
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };
    const standardFields: Array<{ key: keyof Entity; path: string; label: string }> = [
      { key: "name", path: "entity.name", label: "Tên quán" },
      { key: "address", path: "entity.address", label: "Địa chỉ" },
      { key: "phone", path: "entity.phone", label: "SĐT" },
      { key: "priceRange", path: "entity.priceRange", label: "Giá" },
      { key: "openingHours", path: "entity.openingHours", label: "Giờ mở cửa" },
      { key: "style", path: "entity.style", label: "Phong cách" },
      { key: "categoryMain", path: "entity.categoryMain", label: "Mô hình / loại" },
      { key: "categorySub", path: "entity.categorySub", label: "Phong cách phụ" },
    ];
    const options: TextListFieldOption[] = [];
    const seen = new Set<string>();

    for (const field of standardFields) {
      const sampleEntity =
        previewEntity && (previewEntity[field.key] as unknown)
          ? previewEntity
          : activeFilteredEntities.find((entity) => entity[field.key]);
      if (!sampleEntity) continue;
      options.push({
        path: field.path,
        label: field.label,
        sample: truncate(sampleEntity[field.key]),
      });
      seen.add(field.path);
    }

    const metadataKeys = new Set<string>();
    activeFilteredEntities.forEach((entity) => {
      Object.entries(entity.metadata ?? {}).forEach(([key, value]) => {
        if (value != null && value !== "") metadataKeys.add(key);
      });
    });

    Array.from(metadataKeys)
      .sort((a, b) => a.localeCompare(b, "vi"))
      .forEach((key) => {
        const path = `entity.metadata.${key}`;
        if (seen.has(path)) return;
        const sampleEntity =
          previewEntity && previewEntity.metadata?.[key]
            ? previewEntity
            : activeFilteredEntities.find((entity) => entity.metadata?.[key]);
        options.push({
          path,
          label: key,
          sample: truncate(sampleEntity?.metadata?.[key]),
        });
      });

    return options.length ? options : [{ path: "entity.name", label: "Tên quán" }];
  }, [activeFilteredEntities, previewEntity]);

  const selectedPreset = matchingPresets.find((preset) => preset.presetId === selectedPresetId);
  const getPresetPackPages = (preset: GenerateBindingPreset) => {
    const pack = packs.find((item) => item.packTemplateId === preset.packTemplateId);
    const pageIds = pack?.orderedPages ?? preset.pageTemplateIds ?? [];
    const pageMap = new Map(tpls.map((tpl) => [tpl.pageTemplateId, tpl]));
    return {
      pack,
      pages: pageIds.map((id) => pageMap.get(id)).filter((page): page is PageTemplate => !!page),
    };
  };

  const exportPreset = (preset: GenerateBindingPreset) => {
    const { pack, pages } = getPresetPackPages(preset);
    const bundle = buildGeneratePresetBundle(preset, pack, pages);
    downloadJson(
      `${safePortableFileName(formatTemplateDisplayName(preset.name, "khuon"))}-generate-preset.json`,
      bundle,
    );
  };

  const buildCurrentPresetPayload = (
    name: string,
    presetId = nanoid(),
    createdAt = Date.now(),
  ): GenerateBindingPreset => {
    const bindOverrides: GenerateBindingPreset["bindOverrides"] = {};
    packPages.forEach((page) => {
      const pageOverrides = packOv[page.pageTemplateId];
      if (pageOverrides && Object.keys(pageOverrides).length > 0) {
        bindOverrides[page.pageTemplateId] = { ...pageOverrides };
      }
    });
    const allowedPageIds = new Set(packPages.map((page) => page.pageTemplateId));
    const savedPageConfigs = Object.fromEntries(
      Object.entries(pageConfigs).filter(([pageTemplateId]) => allowedPageIds.has(pageTemplateId)),
    );

    return {
      presetId,
      name: name.trim() || "Khuôn tạo nội dung",
      mode: "pack",
      packTemplateId: selectedPack?.packTemplateId,
      packTemplateNameSnapshot: selectedPack?.name,
      pageTemplateIds: packPages.map((page) => page.pageTemplateId),
      bindOverrides,
      generateConfig: {
        selectedSheet,
        filterMoHinh,
        filterPhongCach,
        prioritizePartner,
        onlyPartner,
        partnerQuotaPerPage,
        maxEntities,
        varyFontsFromSecondBundle,
        pageConfigs: savedPageConfigs,
      },
      createdAt,
      updatedAt: Date.now(),
      version: 1,
    };
  };

  const applyPreset = (preset: GenerateBindingPreset) => {
    const cfg = preset.generateConfig;
    if (preset.packTemplateId && preset.packTemplateId !== packId) {
      setPackId(preset.packTemplateId);
    }
    setSelectedSheet(cfg.selectedSheet ?? ALL_VALUE);
    setLastActiveSheet(cfg.selectedSheet);
    setFilterMoHinh(cfg.filterMoHinh ?? ALL_VALUE);
    setFilterPhongCach(cfg.filterPhongCach ?? ALL_VALUE);
    if (cfg.prioritizePartner != null) setPrioritizePartner(cfg.prioritizePartner);
    if (cfg.onlyPartner != null) setOnlyPartner(cfg.onlyPartner);
    if (cfg.partnerQuotaPerPage != null) setPartnerQuotaPerPage(cfg.partnerQuotaPerPage);
    if (cfg.maxEntities != null) setMaxEntities(cfg.maxEntities);
    if (cfg.varyFontsFromSecondBundle != null) {
      setVaryFontsFromSecondBundle(cfg.varyFontsFromSecondBundle);
    }
    setPageConfigs(cfg.pageConfigs ?? {});

    const templateMap = new Map(tpls.map((tpl) => [tpl.pageTemplateId, tpl]));
    const nextOverrides: GenerateBindingPreset["bindOverrides"] = {};
    let missing = 0;
    Object.entries(preset.bindOverrides ?? {}).forEach(([pageId, overrides]) => {
      const page = templateMap.get(pageId);
      if (!page) {
        missing += Object.keys(overrides ?? {}).length || 1;
        return;
      }
      const slotIds = new Set(page.slots.map((slot) => slot.slotId));
      Object.entries(overrides ?? {}).forEach(([slotId, bindingPath]) => {
        if (!slotIds.has(slotId)) {
          missing += 1;
          return;
        }
        nextOverrides[pageId] ??= {};
        nextOverrides[pageId][slotId] = bindingPath;
      });
    });

    replaceAll(nextOverrides);
    resetPreviewPageDrafts({ history: false });
    setSelectedSlotIds([]);
    setActivePageIdx(0);
    toast.success("Đã áp khuôn" + (missing ? `, bỏ qua ${missing} khối thiếu` : ""));
  };

  const openPresetWorkspace = (preset: GenerateBindingPreset) => {
    setSelectedPresetId(preset.presetId);
    applyPreset(preset);
    setWorkspaceOpen(true);
  };

  const createPresetAndOpen = async () => {
    if (!selectedPack) return toast.error("Chưa chọn bộ mẫu");
    const preset = buildCurrentPresetPayload(selectedPack.name);
    await db.generatePresets.put(preset);
    setSelectedPresetId(preset.presetId);
    setWorkspaceOpen(true);
    toast.success("Đã tạo khuôn");
  };

  const handlePresetImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = await readPortableBundleFile(file);
      const result = await importPortableBundle(bundle);
      if (result.presets[0]) {
        setSelectedPresetId(result.presets[0].presetId);
        if (result.presets[0].packTemplateId) setPackId(result.presets[0].packTemplateId);
      }
      toast.success(
        `Đã nhập ${result.packs.length} bộ mẫu, ${result.pages.length} trang, ${result.presets.length} khuôn`,
      );
    } catch (error) {
      toast.error("Không thể nhập: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  useEffect(() => {
    if (!workspaceOpen || !selectedPreset || !selectedPack) return;
    if (presetAutosaveTimer.current !== null) {
      window.clearTimeout(presetAutosaveTimer.current);
    }

    presetAutosaveTimer.current = window.setTimeout(() => {
      const preset = buildCurrentPresetPayload(
        selectedPreset.name,
        selectedPreset.presetId,
        selectedPreset.createdAt,
      );
      db.generatePresets.put(preset).catch((error) => {
        toast.error(
          "Không thể tự lưu khuôn: " + (error instanceof Error ? error.message : String(error)),
        );
      });
      presetAutosaveTimer.current = null;
    }, 500);

    return () => {
      if (presetAutosaveTimer.current !== null) {
        window.clearTimeout(presetAutosaveTimer.current);
        presetAutosaveTimer.current = null;
      }
    };
  }, [
    workspaceOpen,
    selectedPreset?.presetId,
    selectedPreset?.name,
    selectedPreset?.createdAt,
    selectedPack?.packTemplateId,
    selectedPack?.name,
    packPages,
    packOv,
    selectedSheet,
    filterMoHinh,
    filterPhongCach,
    prioritizePartner,
    onlyPartner,
    partnerQuotaPerPage,
    maxEntities,
    pageConfigs,
    varyFontsFromSecondBundle,
  ]);

  const runAiCaption = async () => {
    if (!activePage || !selectedSlot || selectedSlot.kind !== "text") return;
    if (!previewEntity) return toast.error("Chọn dữ liệu xem trước trước");
    setCaptionBusy(true);
    try {
      const out = await aiCaptionFromEntity({
        entity: previewEntity as unknown as Record<string, unknown>,
        style: "instagram",
      });
      if (!out.ok) return toast.error(out.error);
      setBinding(activePage.pageTemplateId, selectedSlot.slotId, undefined);
      commitPreviewPageDrafts((prev) => {
        const working = createWorkingTemplate(
          activePage,
          packOv[activePage.pageTemplateId],
          prev[activePage.pageTemplateId],
        );
        working.slots = working.slots.map((slot) =>
          slot.slotId === selectedSlot.slotId
            ? { ...slot, bindingPath: undefined, staticText: out.caption }
            : slot,
        );
        working.updatedAt = Date.now();
        return { ...prev, [activePage.pageTemplateId]: working };
      });
      toast.success("Đã viết chú thích");
    } catch (error) {
      toast.error("AI lỗi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setCaptionBusy(false);
    }
  };

  const getRewriteCurrentText = (slot: Slot) =>
    (slot.staticText ?? "").trim() ||
    (slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, previewEntity, "", previewEntityPool, {
          entities,
          seed: `${activePage?.pageTemplateId ?? "preview"}:${slot.slotId}:rewrite`,
        }).trim()
      : "");

  const runAiRewriteSelectedText = async (sourceText?: string) => {
    if (!activePage || selectedTextSlots.length !== 1) return;
    const slot = selectedTextSlots[0];
    const currentText = getRewriteCurrentText(slot);
    const source = (sourceText ?? "").trim() || currentText;
    if (!source) return toast.error("Khung chữ đang trống, chưa có nội dung để AI viết lại");

    setRewriteBusy(true);
    try {
      const out = await aiRewriteTextPreserveMeaning({
        text: source,
        toneHint: "tự nhiên, gần với văn phong review/travel social post",
        avoidText: currentText && currentText !== source ? currentText : undefined,
        variationSeed: `${slot.slotId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      if (!out.ok) return toast.error(out.error);
      setBinding(activePage.pageTemplateId, slot.slotId, undefined);
      commitPreviewPageDrafts((prev) => {
        const working = createWorkingTemplate(
          activePage,
          packOv[activePage.pageTemplateId],
          prev[activePage.pageTemplateId],
        );
        working.slots = working.slots.map((item) =>
          item.slotId === slot.slotId
            ? { ...item, bindingPath: undefined, staticText: out.text }
            : item,
        );
        working.updatedAt = Date.now();
        return { ...prev, [activePage.pageTemplateId]: working };
      });
      toast.success("AI đã viết lại khung chữ");
    } catch (error) {
      toast.error("AI lỗi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setRewriteBusy(false);
    }
  };

  const onGenerate = async () => {
    if (!selectedPack) return toast.error("Chưa chọn bộ mẫu");
    if (!generateReadiness.canGenerate) {
      return toast.error(generateReadiness.reason);
    }
    let job = previewGenerateJob
      ? {
          ...previewGenerateJob,
          jobId: nanoid(),
          createdAt: Date.now(),
        }
      : generatePackJob({
          pack: selectedPack,
          pageTemplates: pageTemplatesForGenerate,
          entities,
          assets,
          mode: "one-entity-per-pack",
          entityPool: generationBaseEntities,
          bindOverrides: packOv,
          partnerQuotaPerPage: globalGenerateConfig.partnerQuotaPerPage,
          prioritizePartner,
          onlyPartner,
          maxEntities,
          selectedSheet: globalGenerateConfig.selectedSheet,
          filterMoHinh: globalGenerateConfig.filterMoHinh,
          filterPhongCach: globalGenerateConfig.filterPhongCach,
          pageConfigs,
        });
    if (job.pages.length === 0) {
      toast.error("Không có trang nào được tạo. Kiểm tra cấu hình dữ liệu từng trang.");
      return;
    }
    if (Object.keys(previewPageDrafts).length > 0) {
      job.pages = job.pages.map((page) => ({
        ...page,
        workingTemplate: previewPageDrafts[page.pageTemplateId]
          ? createWorkingTemplate(
              previewPageDrafts[page.pageTemplateId],
              undefined,
              previewPageDrafts[page.pageTemplateId],
            )
          : page.workingTemplate,
      }));
    }
    if (varyFontsFromSecondBundle) {
      job = applyFontVariationToGeneratedJob(job, selectedPack, pageTemplatesForGenerate);
    }
    setJob(job);
    try {
      await db.jobs.put(job);
      toast.success(`Đã tạo ${job.pages.length} trang và lưu vào lịch sử`);
    } catch (error) {
      toast.error(
        "Đã tạo trang nhưng không lưu được lịch sử: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const filteredPages = currentJob?.pages.filter((p) => {
    if (filter === "selected") return p.selected;
    if (filter === "errors") return p.warnings.length > 0 || p.state === "rejected";
    if (filter === "partner") return p.items.some((item) => item.partnerFlag);
    return true;
  });

  const jobPack =
    packs.find((pack) => pack.packTemplateId === currentJob?.packTemplateId) ?? selectedPack;
  const visiblePageIndexes = new Set(filteredPages?.map((page) => page.pageIndex) ?? []);
  const bundleGroups = useMemo(() => {
    if (!currentJob || !jobPack) return [];
    return buildBundleGroups(currentJob, jobPack, tpls, entities)
      .map((group) => ({
        ...group,
        pages: group.pages.filter((page) => visiblePageIndexes.has(page.page.pageIndex)),
      }))
      .filter((group) => group.pages.length > 0);
  }, [currentJob, jobPack, tpls, entities, filter, filteredPages]);

  const bundleImageIssuesByIndex = useMemo(() => {
    const renderableAssets = filterRenderableAssets(assets);
    const assetCountByEntity = new Map<string, number>();
    for (const asset of renderableAssets) {
      assetCountByEntity.set(asset.entityId, (assetCountByEntity.get(asset.entityId) ?? 0) + 1);
    }

    const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
    const issuesByBundle = new Map<number, BundleImageIssue[]>();

    for (const bundle of bundleGroups) {
      const issues = new Map<string, BundleImageIssue>();

      for (const meta of bundle.pages) {
        const template = meta.page.workingTemplate
          ? meta.page.workingTemplate
          : resolvePageWorkingTemplate(
              meta.pageTemplate,
              meta.page.bindOverrides ??
                (meta.pageTemplate ? packOv[meta.pageTemplate.pageTemplateId] : undefined),
            );
        if (!template) continue;

        const imageSlotIds = new Set(
          expandPageWithCardGroups(template, [])
            .slots.filter(slotNeedsEntityImage)
            .map((slot) => slot.slotId),
        );
        if (imageSlotIds.size === 0) continue;

        const entityIds = new Set<string>();
        for (const item of meta.page.items) {
          if (item.entityId && item.slotId && imageSlotIds.has(item.slotId)) {
            entityIds.add(item.entityId);
          }
        }
        if (entityIds.size === 0 && meta.page.entityId) {
          entityIds.add(meta.page.entityId);
        }

        const pageName = meta.pageTemplate?.name ?? `Trang ${meta.pageOrderInBundle + 1}`;
        for (const entityId of entityIds) {
          if ((assetCountByEntity.get(entityId) ?? 0) > 0) continue;
          const entity = entityById.get(entityId);
          if (!entity) continue;
          const issue = issues.get(entityId) ?? {
            entityId,
            entityName: entity.name,
            pageNames: [],
            partnerFlag: entity.partnerFlag,
          };
          if (!issue.pageNames.includes(pageName)) issue.pageNames.push(pageName);
          issues.set(entityId, issue);
        }
      }

      if (issues.size > 0) {
        issuesByBundle.set(
          bundle.bundleIndex,
          Array.from(issues.values()).sort((a, b) => a.entityName.localeCompare(b.entityName, "vi")),
        );
      }
    }

    return issuesByBundle;
  }, [assets, bundleGroups, entities, packOv]);

  const exportZip = async () => {
    if (!currentJob) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang xuất ${sel.length} trang...`);
    try {
      const files: Array<{ name: string; blob: Blob }> = [];
      for (const p of sel) {
        const node = packRefs.current.get(p.pageIndex);
        if (!node) continue;
        const blob = await nodeToPngBlob(node, 2);
        files.push({ name: p.pageFile, blob });
      }
      if (files.length === 0) return toast.error("Không tìm thấy ảnh đang hiển thị để xuất");
      files.push({
        name: "doitac.xlsx",
        blob: buildPartnerWorkbookBlob({ pages: sel, entities }),
      });
      files.push({
        name: "chu-thich.txt",
        blob: await buildTikTokCaptionBlob({
          packName: currentJob.packTemplateName,
          pages: sel,
          entities,
          variantCount: 4,
        }),
      });
      await downloadZip(
        files,
        `${formatTemplateDisplayName(currentJob.packTemplateName, "bo-anh")}.zip`,
      );
      await db.jobs.put({ ...currentJob, status: "exported" });
      toast.success("Đã xuất ZIP");
    } catch (error) {
      toast.error("Không thể xuất ZIP: " + formatExportError(error));
    }
  };

  const exportBundleZip = async (bundle: (typeof bundleGroups)[number]) => {
    if (!currentJob || !jobPack) return;
    setBundleExportingIndex(bundle.bundleIndex);
    toast.info(`Đang tải ${bundle.bundleLabel}...`);
    try {
      const files: Array<{ name: string; blob: Blob }> = [];
      for (const meta of bundle.pages) {
        const node = packRefs.current.get(meta.page.pageIndex);
        if (!node) continue;
        const blob = await nodeToPngBlob(node, 2);
        files.push({ name: meta.displayPageName, blob });
      }
      if (files.length === 0) return toast.error("Không tìm thấy ảnh trong bộ này để tải");
      const bundlePages = bundle.pages.map((meta) => meta.page);
      files.push({
        name: "doitac.xlsx",
        blob: buildPartnerWorkbookBlob({ pages: bundlePages, entities }),
      });
      files.push({
        name: "chu-thich.txt",
        blob: await buildTikTokCaptionBlob({
          packName: jobPack.name,
          bundleLabel: bundle.bundleLabel,
          pages: bundlePages,
          entities,
          variantCount: 3,
        }),
      });
      await downloadZip(files, `${bundle.bundleLabel.toLowerCase().replace(/\s+/g, "-")}.zip`);
      toast.success(`Đã tải ${bundle.bundleLabel}`);
    } catch (error) {
      toast.error("Không thể tải bộ: " + formatExportError(error));
    } finally {
      setBundleExportingIndex(null);
    }
  };

  const canvasScale = effectiveActive
    ? Math.min(560 / effectiveActive.canvas.width, 700 / effectiveActive.canvas.height)
    : 0.5;
  const zoomedPageMeta = useMemo(
    () =>
      zoomedPageIndex == null
        ? undefined
        : bundleGroups
            .flatMap((bundle) => bundle.pages)
            .find((meta) => meta.page.pageIndex === zoomedPageIndex),
    [bundleGroups, zoomedPageIndex],
  );
  const zoomedTemplate =
    zoomedPageMeta?.page.workingTemplate ??
    (zoomedPageMeta?.pageTemplate
      ? resolvePageWorkingTemplate(
          zoomedPageMeta.pageTemplate,
          zoomedPageMeta.page.bindOverrides ?? packOv[zoomedPageMeta.pageTemplate.pageTemplateId],
        )
      : undefined);
  const zoomedEntity = zoomedPageMeta?.page.entityId
    ? entities.find((entity) => entity.entityId === zoomedPageMeta.page.entityId)
    : undefined;
  const zoomedScale = zoomedTemplate
    ? Math.min(1040 / zoomedTemplate.canvas.width, 760 / zoomedTemplate.canvas.height)
    : 1;

  const editingJobPage = currentJob?.pages.find((page) => page.pageIndex === editingPageIndex);
  const editingJobPageBaseTemplate =
    editingJobPage && tpls.length > 0
      ? resolvePageWorkingTemplate(
          tpls.find((tpl) => tpl.pageTemplateId === editingJobPage.pageTemplateId),
          editingJobPage.bindOverrides ?? packOv[editingJobPage.pageTemplateId],
        )
      : undefined;
  const editingJobPageTemplate = editingJobPage?.workingTemplate ?? editingJobPageBaseTemplate;

  return (
    <>
      <input
        ref={presetImportRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handlePresetImportFile}
      />
      {!workspaceOpen ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 md:w-[380px]">
              <Label className="text-xs">Bộ mẫu</Label>
              <Select value={packId} onValueChange={setPackId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn bộ mẫu..." />
                </SelectTrigger>
                <SelectContent>
                  {packs.map((p) => (
                    <SelectItem key={p.packTemplateId} value={p.packTemplateId}>
                      {formatTemplateDisplayName(p.name, "Bộ khuôn")} ({p.orderedPages.length} trang)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => presetImportRef.current?.click()}
              >
                <FileUp className="mr-2 size-4" /> Nhập khuôn
              </Button>
              <Button type="button" onClick={createPresetAndOpen} disabled={!selectedPack}>
                <Save className="mr-2 size-4" /> Tạo khuôn mới
              </Button>
            </div>
          </div>

          {matchingPresets.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed bg-card text-sm text-muted-foreground">
              Chưa có khuôn mẫu nào.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {matchingPresets.map((preset) => {
                const { pages } = getPresetPackPages(preset);

                return (
                  <div key={preset.presetId} className="rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b p-4">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openPresetWorkspace(preset)}
                      >
                        <div className="truncate text-lg font-semibold">
                          {formatTemplateDisplayName(preset.name, "Khuôn")}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Mở khuôn"
                          title="Mở khuôn"
                          onClick={() => openPresetWorkspace(preset)}
                        >
                          <Package className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Xuất khuôn"
                          title="Xuất khuôn"
                          onClick={() => exportPreset(preset)}
                        >
                          <FileDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Xóa khuôn"
                          title="Xóa khuôn"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            await db.generatePresets.delete(preset.presetId);
                            if (selectedPresetId === preset.presetId) setSelectedPresetId("");
                            toast.success("Đã xoá khuôn");
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="overflow-x-auto p-4">
                      {pages.length === 0 ? (
                        <div className="grid min-h-28 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                          Bộ mẫu hoặc trang mẫu không còn tồn tại.
                        </div>
                      ) : (
                        <div className="flex min-w-full gap-3">
                          {pages.map((page, index) => {
                            const previewTemplate = resolvePageWorkingTemplate(
                              page,
                              preset.bindOverrides?.[page.pageTemplateId],
                            );
                            if (!previewTemplate) return null;
                            const previewScale = Math.min(
                              150 / previewTemplate.canvas.width,
                              190 / previewTemplate.canvas.height,
                            );
                            const previewContext = buildPresetPreviewRenderContext(
                              preset,
                              previewTemplate,
                            );

                            return (
                              <button
                                key={`${preset.presetId}:${page.pageTemplateId}`}
                                type="button"
                                className="group flex w-[172px] shrink-0 flex-col gap-2 rounded-xl border bg-background p-2 text-left shadow-sm transition hover:border-primary/50"
                                onClick={() => openPresetWorkspace(preset)}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <Badge variant="secondary" className="shrink-0">
                                    Trang {index + 1}
                                  </Badge>
                                  <div className="truncate text-sm font-medium">
                                    {formatTemplateDisplayName(page.name, "Trang")}
                                  </div>
                                </div>
                                <div className="grid h-[205px] place-items-center overflow-hidden rounded-md border bg-muted/20">
                                  <PageRenderer
                                    template={previewTemplate}
                                    entities={entities}
                                    assets={assets}
                                    entity={previewContext.entity}
                                    entityPool={previewContext.entityPool}
                                    slotItems={previewContext.slotItems}
                                    scale={previewScale}
                                    seedKey={`${preset.presetId}:${page.pageTemplateId}:preview`}
                                    hideImagePlaceholderText
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setWorkspaceOpen(false)}>
              <ArrowLeft className="mr-2 size-4" /> Quay lại
            </Button>
          </div>

          <div className="grid grid-cols-12 gap-4">
            {/* Cột 1: Cấu hình */}
            <Card className="col-span-12 lg:sticky lg:top-4 lg:col-span-3 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tạo bộ ảnh</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-3">
                <div>
                  <Label className="text-xs">Số lượng tạo bộ ảnh</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      onClick={() =>
                        updateActiveGenerateConfig({
                          maxEntities: Math.max(1, activeGenerateConfig.maxEntities - 1),
                        })
                      }
                      aria-label="Giảm số lượng tạo"
                      title="Giảm số lượng tạo"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      type="number"
                      min={1}
                      value={activeGenerateConfig.maxEntities}
                      onChange={(e) =>
                        updateActiveGenerateConfig({ maxEntities: Number(e.target.value) || 1 })
                      }
                      className="h-9 text-center"
                      aria-label="Số lượng tạo bộ ảnh"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      onClick={() =>
                        updateActiveGenerateConfig({
                          maxEntities: activeGenerateConfig.maxEntities + 1,
                        })
                      }
                      aria-label="Tăng số lượng tạo"
                      title="Tăng số lượng tạo"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                <details className="rounded-lg border bg-muted/10 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Nâng cao</summary>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={activeGenerateConfig.prioritizePartner}
                        onCheckedChange={(v) =>
                          updateActiveGenerateConfig({ prioritizePartner: v === true })
                        }
                      />
                      Ưu tiên dữ liệu đối tác
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={activeGenerateConfig.onlyPartner}
                        onCheckedChange={(v) =>
                          updateActiveGenerateConfig({ onlyPartner: v === true })
                        }
                      />
                      Chỉ dùng dữ liệu đối tác
                    </label>

                    <div>
                      <Label className="text-xs">Số đối tác / trang</Label>
                      <Input
                        type="number"
                        min={0}
                        max={Math.max(0, activeTargetCount)}
                        value={
                          activeGenerateConfig.onlyPartner
                            ? 0
                            : activeGenerateConfig.partnerQuotaPerPage
                        }
                        disabled={activeGenerateConfig.onlyPartner}
                        onChange={(e) =>
                          updateActiveGenerateConfig({
                            partnerQuotaPerPage: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {activeGenerateConfig.onlyPartner
                          ? "Đang chỉ dùng dữ liệu đối tác nên không cần giới hạn thêm."
                          : `Trang hiện tại có tối đa ${activeTargetCount} khung nhận dữ liệu.`}
                      </p>
                    </div>

                    <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background/60 p-2 text-sm">
                      <Checkbox
                        checked={varyFontsFromSecondBundle}
                        onCheckedChange={(checked) =>
                          setVaryFontsFromSecondBundle(checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          Biến thể font nghệ thuật từ bộ thứ 2
                        </span>
                      </span>
                    </label>
                  </div>
                </details>

                <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Dữ liệu phù hợp</span>
                    <b className="text-foreground">{activeAvailableEntities.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Dữ liệu trang này</span>
                    <b className="text-foreground">{activeFilteredEntities.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Trang dùng nguồn riêng</span>
                    <b className="text-foreground">{enabledPageConfigCount}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Trang trong bộ</span>
                    <b className="text-foreground">{packPages.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Khung đã gắn dữ liệu</span>
                    <b className="text-foreground">{totalBound}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Trang sẽ tạo</span>
                    <b className="text-foreground">{estimateGeneratedPageCount}</b>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <Button
                    onClick={onGenerate}
                    disabled={!generateReadiness.canGenerate}
                    className="w-full"
                    title={generateReadiness.reason}
                  >
                    <Sparkles className="size-4 mr-2" /> Tạo bộ ảnh
                  </Button>
                  <p
                    className={
                      "text-xs " +
                      (generateReadiness.canGenerate ? "text-muted-foreground" : "text-destructive")
                    }
                  >
                    {generateReadiness.reason}
                  </p>
                  {generationBaseEntities.length === 0 && (
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <a href="/data">Nhập dữ liệu từ Google Sheet</a>
                    </Button>
                  )}
                  {Object.keys(packOv).length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resetAll();
                        resetPreviewPageDrafts({ history: false });
                      }}
                      className="w-full text-xs"
                    >
                      <Link2Off className="size-3 mr-1" /> Xoá toàn bộ liên kết
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Cột 2: Canvas bind từng page */}
            <Card className="col-span-12 lg:col-span-6">
              <CardHeader className="pb-2 flex flex-row items-center justify-end">
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={undoPreviewPageDrafts}
                    disabled={!canUndoPreviewDraft}
                    className="h-7 text-xs"
                    title="Hoàn tác (Ctrl+Z)"
                  >
                    <Undo2 className="size-3 mr-1" /> Hoàn tác
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={redoPreviewPageDrafts}
                    disabled={!canRedoPreviewDraft}
                    className="h-7 text-xs"
                    title="Làm lại (Ctrl+Shift+Z)"
                  >
                    <Redo2 className="size-3 mr-1" /> Làm lại
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingPreviewOpen(true)}
                    disabled={!effectiveActive}
                    className="h-7 text-xs"
                  >
                    <Type className="size-3 mr-1" /> Chỉnh bố cục
                  </Button>
                  <Button
                    size="sm"
                    variant={showSafeFrame ? "secondary" : "outline"}
                    onClick={() => setShowSafeFrame((value) => !value)}
                    disabled={!effectiveActive}
                    className="h-7 text-xs"
                    title="Bật/tắt khung an toàn và đường căn chỉnh"
                  >
                    <Eye className="size-3 mr-1" /> Đường căn chỉnh:{" "}
                    {showSafeFrame ? "Bật" : "Tắt"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {packPages.length === 0 ? (
                  <div className="border border-dashed rounded-lg h-[480px] grid place-items-center text-muted-foreground text-sm">
                    Chọn bộ mẫu để bắt đầu
                  </div>
                ) : (
                  <>
                    {/* Tabs page */}
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {packPages.map((tpl, idx) => {
                        const ovCount = Object.values(packOv[tpl.pageTemplateId] ?? {}).filter(
                          (v) => v && v !== "",
                        ).length;
                        return (
                          <button
                            key={tpl.pageTemplateId + idx}
                            onClick={() => setActivePageIdx(idx)}
                            className={
                              "shrink-0 text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 " +
                              (activePageIdx === idx
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/40 border-border hover:bg-muted")
                            }
                          >
                            <span>Trang {idx + 1}</span>
                            <span className="font-medium">
                              {formatTemplateDisplayName(tpl.name, "Trang")}
                            </span>
                            {ovCount > 0 && (
                              <span className="text-[10px] bg-background/30 rounded px-1">
                                {ovCount}
                              </span>
                            )}
                            {pageConfigs[tpl.pageTemplateId] && (
                              <span className="text-[10px] bg-background/30 rounded px-1">
                                Nguồn riêng
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {effectiveActive && (
                      <div
                        onPointerDownCapture={startSurfaceMarqueeSelection}
                        className="relative grid select-none place-items-center overflow-auto rounded-lg border bg-background p-4"
                        style={{ minHeight: 480 }}
                      >
                        <BindCanvas
                          template={effectiveActive}
                          scale={canvasScale}
                          selectedSlotIds={selectedSlotIds}
                          onSelectSlot={handleSelectSlot}
                          entity={previewEntity}
                          assets={assets}
                          entityPool={previewEntityPool}
                          sourceEntities={entities}
                          slotItems={previewSlotItems}
                          seedKey={`${effectiveActive.pageTemplateId}:${activePageIdx}`}
                          showSafeFrame={showSafeFrame}
                          flatPreview
                        />
                        {surfaceMarqueeRect && (
                          <div
                            data-bind-surface-marquee="true"
                            className="pointer-events-none absolute z-[2147483647] border border-primary bg-primary/10"
                            style={{
                              left: surfaceMarqueeRect.left,
                              top: surfaceMarqueeRect.top,
                              width: surfaceMarqueeRect.width,
                              height: surfaceMarqueeRect.height,
                            }}
                          />
                        )}
                      </div>
                    )}

                    {activePage &&
                      ((packOv[activePage.pageTemplateId] &&
                        Object.keys(packOv[activePage.pageTemplateId]).length > 0) ||
                        previewPageDrafts[activePage.pageTemplateId]) && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              resetPage(activePage.pageTemplateId);
                              commitPreviewPageDrafts((prev) => {
                                const next = { ...prev };
                                delete next[activePage.pageTemplateId];
                                return next;
                              }, { history: false });
                            }}
                            className="h-8 text-xs"
                          >
                            <Link2Off className="size-3 mr-1" /> Xoá liên kết trang này
                          </Button>
                        </div>
                      )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Cột 3: Bind panel + sheet fields */}
            <Card className="col-span-12 lg:sticky lg:top-4 lg:col-span-3 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-hidden">
              <CardHeader className="border-b pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Link2 className="size-4" /> Nguồn dữ liệu của trang này
                  </CardTitle>
                  {activePage && (
                    <Badge variant={activePageConfigEnabled ? "default" : "outline"}>
                      Trang này
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-3">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Nguồn & bộ lọc
                      </div>
                      {activePage && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Trang {activePageIdx + 1} đang dùng: {activeSourceLabel}
                        </div>
                      )}
                    </div>
                    {activePage && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={applyActiveSourceToAllPages}
                      >
                        Áp dụng cho tất cả trang
                      </Button>
                    )}
                  </div>
                  {activePage && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background/60 p-2 text-xs">
                      <Checkbox
                        checked={activePageConfigEnabled}
                        onCheckedChange={(checked) => toggleActivePageConfig(checked === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">Dùng nguồn riêng cho trang này</span>
                        <span className="block text-[11px] text-muted-foreground">
                          Bật khi mỗi trang trong bộ lấy dữ liệu từ tab hoặc bộ lọc khác nhau.
                        </span>
                      </span>
                    </label>
                  )}
                  {generationBaseEntities.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background p-3 text-xs text-muted-foreground">
                      Chưa có dữ liệu để chọn nguồn.
                      <Button asChild variant="link" size="sm" className="h-auto px-1 py-0 text-xs">
                        <a href="/data">Nhập dữ liệu từ Google Sheet</a>
                      </Button>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Nguồn dữ liệu</Label>
                    <Select
                      value={activeGenerateConfig.selectedSheet}
                      onValueChange={handleSelectSheet}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Tất cả</SelectItem>
                        {sheetOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Mô hình</Label>
                    <Select
                      value={activeGenerateConfig.filterMoHinh}
                      onValueChange={(value) => updateActiveSourceConfig({ filterMoHinh: value })}
                      disabled={!hasMoHinhOptions}
                    >
                      <SelectTrigger disabled={!hasMoHinhOptions}>
                        <SelectValue placeholder="Không có dữ liệu mô hình" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Tất cả</SelectItem>
                        {moHinhOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!hasMoHinhOptions && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Nguồn dữ liệu này không có cột Mô hình để lọc.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs">Phong cách</Label>
                    <Select
                      value={activeGenerateConfig.filterPhongCach}
                      onValueChange={(value) =>
                        updateActiveSourceConfig({ filterPhongCach: value })
                      }
                      disabled={!hasPhongCachOptions}
                    >
                      <SelectTrigger disabled={!hasPhongCachOptions}>
                        <SelectValue placeholder="Không có dữ liệu phong cách" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_VALUE}>Tất cả</SelectItem>
                        {phongCachOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!hasPhongCachOptions && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Nguồn dữ liệu này không có cột Phong cách để lọc.
                      </p>
                    )}
                  </div>
                </div>

                {selectedSlots.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Chọn 1 hoặc nhiều khối trên vùng thiết kế để gán trường dữ liệu cho trang hiện
                    tại.
                  </p>
                )}
                {selectedSlots.length > 0 && selectedBindableSlots.length === 0 && (
                  <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <AlertTriangle className="size-3.5" />
                      Khối đang chọn không thể liên kết dữ liệu
                    </div>
                  </div>
                )}
                {selectedBindableSlots.length > 0 && activePage && (
                  <>
                    <div className="rounded-xl border bg-muted/20 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        {formatClipboard && (
                          <Badge
                            variant="outline"
                            className="col-span-2 h-8 justify-center truncate px-2 text-[11px]"
                          >
                            Đã sao chép: {formatClipboard.label}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 justify-start px-2 text-[11px]"
                          onClick={copySelectedSlotFormat}
                          title="Sao chép cả kiểu hiển thị và cách gắn dữ liệu của khối đang chọn"
                        >
                          <Copy className="mr-1 size-3" /> Sao chép kiểu & liên kết
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 justify-start px-2 text-[11px]"
                          disabled={!formatClipboard}
                          onClick={() => applyCopiedSlotFormat(selectedBindableSlots, "đang chọn")}
                          title={
                            formatClipboard
                              ? "Dán kiểu và liên kết vào khối đang chọn"
                              : "Chưa sao chép kiểu & liên kết"
                          }
                        >
                          <Wand2 className="mr-1 size-3" /> Dán vào khối đang chọn
                        </Button>
                        {selectedBindableSlots.length > 1 && (
                          <Button
                            type="button"
                            variant={selectedDataGroupIds.length === 1 ? "secondary" : "outline"}
                            size="sm"
                            className="h-8 justify-start px-2 text-[11px]"
                            onClick={groupSelectedDataSlots}
                          >
                            <Link2 className="mr-1 size-3" /> Nhóm dữ liệu
                          </Button>
                        )}
                        {selectedDataGroupIds.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 justify-start px-2 text-[11px]"
                            onClick={clearSelectedDataGroups}
                          >
                            <Link2Off className="mr-1 size-3" /> Bỏ nhóm
                          </Button>
                        )}
                        {relatedFormatTargetSlots.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 justify-start px-2 text-[11px]"
                          disabled={!formatClipboard}
                          onClick={() =>
                            applyCopiedSlotFormat(relatedFormatTargetSlots, "trong cụm")
                          }
                        >
                            Dán vào cụm
                          </Button>
                        )}
                      </div>
                    </div>
                    {sortedSelectedTextSlots.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs">
                          Khung chữ{" "}
                          {sortedSelectedTextSlots.length > 1
                            ? `(${sortedSelectedTextSlots.length} khối)`
                            : ""}
                        </Label>
                        {sortedSelectedTextSlots.map((slot, index) => (
                          <div
                            key={slot.slotId}
                            className="space-y-1 rounded-lg border bg-muted/20 p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate text-xs font-medium">
                                {index + 1}. {textSlotLabel(slot, index)}
                              </div>
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {selectedSlotStatusLabel(slot)}
                              </Badge>
                            </div>
                            <Select
                              value={textSlotBindingValue(slot)}
                              onValueChange={(v) => applyTextBindingSelection(slot, v)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Chọn trường" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__list">
                                  Danh sách nhiều dòng
                                </SelectItem>
                                {TEXT_BINDING_OPTIONS.map((option) => {
                                  const value = option.value || "_static";
                                  return (
                                    <SelectItem key={`${slot.slotId}-${value}`} value={value}>
                                      {textBindingOptionLabel(value, option.label)}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {textSlotFieldBindingValue(slot) !== "_static" && (
                              <div>
                                <Label className="text-xs">Nguồn dữ liệu</Label>
                                <Select
                                  value={textSlotSourceValue(slot)}
                                  onValueChange={(sheetName) =>
                                    applyTextSourceSelection(slot, sheetName)
                                  }
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__current">Theo nguồn của trang</SelectItem>
                                    {sheetOptions.map((sheet) => (
                                      <SelectItem key={sheet} value={sheet}>
                                        {sheet}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {sortedSelectedImageSlots.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs">
                          Khung ảnh{" "}
                          {sortedSelectedImageSlots.length > 1
                            ? `(${sortedSelectedImageSlots.length} khối)`
                            : ""}
                        </Label>
                        {sortedSelectedImageSlots.map((slot, index) => {
                          const value = imageSlotBindingValue(slot);
                          const randomScope = parseAssetRandomScopeBindingPath(slot.bindingPath);
                          const randomScopeSheet =
                            randomScope?.sheetName ?? activeGenerateConfig.selectedSheet;
                          const randomScopeFolder = randomScope?.folder ?? ALL_VALUE;
                          const randomImageFolderOptions =
                            randomImageFolderOptionsForSheet(randomScopeSheet);
                          return (
                            <div
                              key={slot.slotId}
                              className="space-y-2 rounded-lg border bg-muted/20 p-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 truncate text-xs font-medium">
                                  {index + 1}. {imageSlotLabel(slot, index)}
                                </div>
                                <Badge variant="outline" className="shrink-0 text-[10px]">
                                  {selectedSlotStatusLabel(slot)}
                                </Badge>
                              </div>
                              <Select
                                value={value}
                                onValueChange={(nextValue) =>
                                  applyImageBindingSelection(slot, nextValue)
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Chọn trường ảnh" />
                                </SelectTrigger>
                                <SelectContent>
                                  {IMAGE_BINDING_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={`${slot.slotId}-${option.value || "_static"}`}
                                      value={option.value || "_static"}
                                    >
                                      {imageBindingOptionLabel(option.value || "_static")}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {value === ASSET_RANDOM_SCOPE_BINDING_VALUE && (
                                <div className="grid gap-2 rounded-md border bg-background/70 p-2">
                                  <div>
                                    <Label className="text-xs">Nguồn ảnh</Label>
                                    <Select
                                      value={randomScopeSheet}
                                      onValueChange={(sheetName) =>
                                        applyRandomImageScope(slot, {
                                          sheetName,
                                          folder: ALL_VALUE,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={ALL_VALUE}>Tất cả nguồn</SelectItem>
                                        {sheetOptions.map((sheet) => (
                                          <SelectItem key={sheet} value={sheet}>
                                            {sheet}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label className="text-xs">Thư mục ảnh</Label>
                                    <Select
                                      value={randomScopeFolder}
                                      onValueChange={(folder) =>
                                        applyRandomImageScope(slot, { folder })
                                      }
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue placeholder="Chọn thư mục / nhóm ảnh" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={ALL_VALUE}>Tất cả thư mục</SelectItem>
                                        {randomImageFolderOptions.map((folder) => (
                                          <SelectItem key={folder} value={folder}>
                                            {folder}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {selectedTextSlots.length === 1 &&
                      textSlotBindingValue(selectedTextSlots[0]) === "__list" && (
                        <TextListBindingPanel
                          selectedSlot={selectedTextSlots[0]}
                          fieldOptions={textListFieldOptions}
                          entityPool={previewEntityPool}
                          prioritizePartnerDefault={prioritizePartner}
                          onApply={(bindingPath) => {
                            applyBindingToSlots(
                              [selectedTextSlots[0]],
                              activePage.pageTemplateId,
                              bindingPath,
                            );
                            toast.success("Đã áp danh sách vào khung chữ");
                          }}
                        />
                      )}
                    {selectedTextSlots.length === 1 && (
                      <div className="grid grid-cols-1 gap-2">
                        <TextRewritePanel
                          selectedSlotId={selectedTextSlots[0].slotId}
                          currentText={getRewriteCurrentText(selectedTextSlots[0])}
                          busy={rewriteBusy}
                          onRewrite={runAiRewriteSelectedText}
                        />
                        {selectedSlot?.kind === "text" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={runAiCaption}
                            disabled={captionBusy || !previewEntity}
                          >
                            {captionBusy ? (
                              <Loader2 className="size-3 mr-1 animate-spin" />
                            ) : (
                              <Wand2 className="size-3 mr-1" />
                            )}
                            AI viết chú thích
                          </Button>
                        )}
                      </div>
                    )}
                    {selectedBindableSlots.some((slot) => !!slot.bindingPath) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          clearBindingsForSlots(selectedBindableSlots, activePage.pageTemplateId)
                        }
                      >
                        <Link2Off className="size-3 mr-1" /> Xoá liên kết đã chọn
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Kết quả render */}
          {currentJob && currentJob.pages.length > 0 && (
            <>
              <div className="space-y-6">
                {bundleGroups.map((bundle, bundleGroupIndex) => (
                  <div key={bundle.bundleIndex} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold">{bundle.bundleLabel}</h2>
                        <Badge variant="outline">{bundle.pages.length} trang</Badge>
                        {(() => {
                          const bundleAllSelected = bundle.pages.every((meta) => meta.page.selected);
                          return (
                            <Button
                              type="button"
                              size="sm"
                              variant={bundleAllSelected ? "secondary" : "outline"}
                              onClick={() => {
                                bundle.pages.forEach((meta) => {
                                  updatePage(meta.page.pageIndex, (page) => ({
                                    ...page,
                                    selected: !bundleAllSelected,
                                  }));
                                });
                              }}
                            >
                              {bundleAllSelected ? "Bỏ chọn cả bộ" : "Chọn cả bộ"}
                            </Button>
                          );
                        })()}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.preventDefault();
                            void exportBundleZip(bundle);
                          }}
                          disabled={bundleExportingIndex === bundle.bundleIndex}
                        >
                          {bundleExportingIndex === bundle.bundleIndex ? (
                            <Loader2 className="size-3 mr-1 animate-spin" />
                          ) : (
                            <Package className="size-3 mr-1" />
                          )}
                          Tải bộ
                        </Button>
                      </div>
                      {bundleGroupIndex === 0 && (
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                          <Badge variant="outline">{currentJob.pages.length} trang</Badge>
                          <Badge variant="secondary">
                            {currentJob.pages.filter((p) => p.selected).length} đã chọn
                          </Badge>
                          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                            <SelectTrigger className="h-9 w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Tất cả</SelectItem>
                              <SelectItem value="selected">Đang chọn</SelectItem>
                              <SelectItem value="errors">Có cảnh báo</SelectItem>
                              <SelectItem value="partner">Có đối tác</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedAll(true)}
                          >
                            Chọn hết
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedAll(false)}
                          >
                            Bỏ chọn hết
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={(event) => {
                              event.preventDefault();
                              void exportZip();
                            }}
                          >
                            <Package className="size-4 mr-2" /> Xuất ZIP
                          </Button>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const imageIssues =
                        bundleImageIssuesByIndex.get(bundle.bundleIndex) ?? [];
                      if (imageIssues.length === 0) return null;
                      const visibleIssues = imageIssues.slice(0, 8);
                      const hiddenCount = imageIssues.length - visibleIssues.length;
                      return (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <AlertTriangle className="size-4 shrink-0" />
                            Thiếu ảnh riêng trong {bundle.bundleLabel}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {visibleIssues.map((issue) => (
                              <span
                                key={issue.entityId}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-background/80 px-2.5 py-1"
                                title={`${issue.entityName} · ${issue.pageNames.join(", ")}`}
                              >
                                <span className="max-w-56 truncate font-medium">
                                  {issue.entityName}
                                </span>
                                {issue.partnerFlag && (
                                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium">
                                    Đối tác
                                  </span>
                                )}
                                <span className="text-amber-700">
                                  · {issue.pageNames.join(", ")}
                                </span>
                              </span>
                            ))}
                            {hiddenCount > 0 && (
                              <span className="inline-flex items-center rounded-full border border-amber-300 bg-background/80 px-2.5 py-1">
                                +{hiddenCount} quán khác
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="overflow-x-auto pb-2">
                      <div className="flex w-max gap-4">
                      {bundle.pages.map((meta) => {
                        const page = meta.page;
                        const tpl = meta.pageTemplate;
                        if (!tpl) return null;
                        const eff =
                          page.workingTemplate ??
                          resolvePageWorkingTemplate(
                            tpl,
                            page.bindOverrides ?? packOv[tpl.pageTemplateId],
                          );
                        if (!eff) return null;
                        const ent = page.entityId
                          ? entities.find((entity) => entity.entityId === page.entityId)
                          : undefined;
                        const previewScale = Math.min(
                          320 / eff.canvas.width,
                          420 / eff.canvas.height,
                        );
                        const previewWidth = Math.round(eff.canvas.width * previewScale);
                        const previewHeight = Math.round(eff.canvas.height * previewScale);
                        return (
                          <Card
                            key={page.pageIndex}
                            className={`w-[352px] shrink-0 ${page.selected ? "border-primary" : ""}`}
                          >
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2 min-w-0">
                                  <Checkbox
                                    checked={page.selected}
                                    onCheckedChange={() => toggleSelected(page.pageIndex)}
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-sm truncate">
                                      {formatTemplateDisplayName(tpl.name, "Trang")}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {meta.displayPageName}
                                    </div>
                                  </div>
                                </div>
                                {meta.hasPartnerExposure && (
                                  <Badge className="gap-1">
                                    <Star className="size-3" /> Đối tác
                                  </Badge>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0 space-y-2">
                              <button
                                type="button"
                                className="grid place-items-center overflow-hidden rounded border bg-muted/30 p-2 transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                title="Bấm để phóng to ảnh"
                                onClick={() =>
                                  setZoomedPageIndex((current) =>
                                    current === page.pageIndex ? null : page.pageIndex,
                                  )
                                }
                              >
                                <div
                                  ref={(el) => {
                                    if (el) packRefs.current.set(page.pageIndex, el);
                                  }}
                                  className="overflow-hidden bg-background"
                                  style={{ width: previewWidth, height: previewHeight }}
                                >
                                  <PageRenderer
                                    template={eff}
                                    page={page}
                                    entities={entities}
                                    assets={assets}
                                    entity={ent}
                                    entityPool={buildPageEntityPool(page)}
                                    scale={previewScale}
                                    debug={debug}
                                    seedKey={`${page.pageTemplateId}:${page.pageIndex}`}
                                    hideImagePlaceholderText
                                  />
                                </div>
                              </button>
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => setEditingPageIndex(page.pageIndex)}
                                >
                                  <Type className="size-3 mr-1" /> Sửa trang
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  onClick={async () => {
                                    const node = packRefs.current.get(page.pageIndex);
                                    if (!node) return;
                                    await downloadPng(node, page.pageFile, 2);
                                  }}
                                >
                                  <Download className="size-3 mr-1" /> Xuất PNG
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {zoomedPageMeta && zoomedTemplate && (
        <div
          className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/75 p-4"
          onClick={() => setZoomedPageIndex(null)}
        >
          <div className="max-h-[92vh] max-w-[92vw] overflow-auto rounded-lg bg-background p-3 shadow-2xl">
            <PageRenderer
              template={zoomedTemplate}
              page={zoomedPageMeta.page}
              entities={entities}
              assets={assets}
              entity={zoomedEntity}
              entityPool={buildPageEntityPool(zoomedPageMeta.page)}
              scale={zoomedScale}
              debug={debug}
              seedKey={`${zoomedPageMeta.page.pageTemplateId}:${zoomedPageMeta.page.pageIndex}:zoom`}
              hideImagePlaceholderText
            />
          </div>
        </div>
      )}

      {editingJobPage && editingJobPageBaseTemplate && editingJobPageTemplate && (
        <GeneratePageEditor
          open={!!editingJobPage}
          onOpenChange={(open) => {
            if (!open) setEditingPageIndex(null);
          }}
          title={`Sửa trang · ${editingJobPage.pageFile}`}
          template={editingJobPageTemplate}
          baseTemplate={editingJobPageBaseTemplate}
          entities={entities}
          assets={assets}
          entity={
            editingJobPage.entityId
              ? entities.find((entity) => entity.entityId === editingJobPage.entityId)
              : undefined
          }
          entityPool={buildPageEntityPool(editingJobPage)}
          slotItems={editingJobPage.items}
          seedKey={`${editingJobPage.pageTemplateId}:${editingJobPage.pageIndex}`}
          preserveBindings={false}
          onApply={(nextTemplate) => {
            updatePage(editingJobPage.pageIndex, (page) => ({
              ...page,
              workingTemplate: nextTemplate ?? undefined,
            }));
          }}
        />
      )}

      {editingPreviewOpen && activePage && effectiveActive && (
        <GeneratePageEditor
          open={editingPreviewOpen}
          onOpenChange={setEditingPreviewOpen}
          title={`Chỉnh bố cục xem trước · ${formatTemplateDisplayName(activePage.name, "Trang")}`}
          template={effectiveActive}
          baseTemplate={activePage}
          entities={entities}
          assets={assets}
          entity={previewEntity}
          entityPool={previewEntityPool}
          slotItems={previewSlotItems}
          seedKey={`${effectiveActive.pageTemplateId}:${activePageIdx}`}
          preserveBindings
          onApply={(nextTemplate) => {
            if (!nextTemplate) return;
            commitPreviewPageDrafts((prev) => ({
              ...prev,
              [activePage.pageTemplateId]: nextTemplate,
            }));
          }}
        />
      )}
    </>
  );
}

function getSurfacePoint(
  surface: HTMLDivElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = surface.getBoundingClientRect();
  return {
    x: clientX - rect.left + surface.scrollLeft,
    y: clientY - rect.top + surface.scrollTop,
  };
}

function normalizeSurfaceSelectionRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): SurfaceSelectionRect {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  return {
    left,
    top,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

function surfaceRectsIntersect(a: SurfaceSelectionRect, b: SurfaceSelectionRect): boolean {
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;
  return a.left <= bRight && aRight >= b.left && a.top <= bBottom && aBottom >= b.top;
}
