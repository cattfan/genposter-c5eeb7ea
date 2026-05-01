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
  Type,
  Star,
  Wand2,
  Loader2,
  Eye,
  Save,
  Trash2,
} from "lucide-react";
import type {
  Asset,
  Entity,
  GenerateBindingPreset,
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
import {
  allocateEntityBindingsForTemplate,
  buildEntityAllocationOrder,
} from "@/engines/selection/entityBindAllocator";
import { buildEntityBindingTargets } from "@/engines/binding/cardRepeater";
import { usePackBindOverrides } from "@/features/generate/usePackBindOverrides";
import { nodeToPngBlob, downloadPng, downloadZip } from "@/features/render/exportPng";
import { db } from "@/storage/db";
import { getLastActiveSheet, setLastActiveSheet } from "@/storage/lastSheet";
import { buildBundleGroups } from "@/lib/packDisplay";
import {
  createWorkingTemplate,
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

type Filter = "all" | "selected" | "errors" | "partner";
type SurfaceSelectionRect = { left: number; top: number; width: number; height: number };
type FormatSlotMode = "text" | "image";

interface SlotFormatSnapshot {
  sourceSlotId: string;
  sourceLabel: string;
  bindMode: FormatSlotMode;
  bindingKey: string;
  rotation?: number;
  style?: Slot["style"];
}

interface SlotFormatClipboard {
  label: string;
  snapshots: SlotFormatSnapshot[];
}

const cloneSlotStyle = (style: Slot["style"] | undefined): Slot["style"] | undefined =>
  style ? { ...style } : undefined;

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
    () => getLastActiveSheet() ?? "__all__",
  );
  const [filterMoHinh, setFilterMoHinh] = useState<string>("__all__");
  const [filterPhongCach, setFilterPhongCach] = useState<string>("__all__");
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [partnerQuotaPerPage, setPartnerQuotaPerPage] = useState<number>(0);
  const [maxEntities, setMaxEntities] = useState<number>(10);
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
  const [previewPageDrafts, setPreviewPageDrafts] = useState<Record<string, PageTemplate>>({});
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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

  // Filter options
  const moHinhOptions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((e) => {
      if (e.status !== "active") return;
      if (selectedSheet !== "__all__" && e.sheetName !== selectedSheet) return;
      if (e.categoryMain) set.add(e.categoryMain);
    });
    return Array.from(set).sort();
  }, [entities, selectedSheet]);

  const phongCachOptions = useMemo(() => {
    const set = new Set<string>();
    entities.forEach((e) => {
      if (e.status !== "active") return;
      if (selectedSheet !== "__all__" && e.sheetName !== selectedSheet) return;
      if (e.categorySub) set.add(e.categorySub);
    });
    return Array.from(set).sort();
  }, [entities, selectedSheet]);
  const hasMoHinhOptions = moHinhOptions.length > 0;
  const hasPhongCachOptions = phongCachOptions.length > 0;

  const filteredEntities: Entity[] = useMemo(() => {
    const list = entities.filter((e) => {
      if (e.status !== "active") return false;
      if (selectedSheet !== "__all__" && e.sheetName !== selectedSheet) return false;
      if (filterMoHinh !== "__all__" && e.categoryMain !== filterMoHinh) return false;
      if (filterPhongCach !== "__all__" && e.categorySub !== filterPhongCach) return false;
      if (onlyPartner && !e.partnerFlag) return false;
      return true;
    });
    list.sort((a, b) => {
      if (prioritizePartner) {
        if (!!b.partnerFlag !== !!a.partnerFlag) return b.partnerFlag ? 1 : -1;
        if ((b.partnerPriority ?? 0) !== (a.partnerPriority ?? 0))
          return (b.partnerPriority ?? 0) - (a.partnerPriority ?? 0);
      }
      return a.name.localeCompare(b.name, "vi");
    });
    return list.slice(0, Math.max(1, maxEntities));
  }, [
    entities,
    selectedSheet,
    filterMoHinh,
    filterPhongCach,
    onlyPartner,
    prioritizePartner,
    maxEntities,
  ]);

  const buildOrderedEntityPool = (primaryEntityId: string | undefined): Entity[] => {
    if (!primaryEntityId) return filteredEntities;
    return [
      ...filteredEntities.filter((entity) => entity.entityId === primaryEntityId),
      ...filteredEntities.filter((entity) => entity.entityId !== primaryEntityId),
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

  const randomizedEntityOrder = useMemo(
    () => buildEntityAllocationOrder(filteredEntities, prioritizePartner),
    [filteredEntities, prioritizePartner],
  );

  const previewEntityPool = useMemo(
    () => buildOrderedEntityPool(previewEntityId),
    [filteredEntities, previewEntityId],
  );

  const activeTargetCount = useMemo(
    () =>
      effectiveActive ? buildEntityBindingTargets(effectiveActive, filteredEntities).length : 0,
    [effectiveActive, filteredEntities],
  );

  const handleSelectSheet = (sheet: string) => {
    setSelectedSheet(sheet);
    setLastActiveSheet(sheet);
    setFilterMoHinh("__all__");
    setFilterPhongCach("__all__");
  };

  // Reset slot khi đổi pack/page
  useEffect(() => {
    setSelectedSlotIds([]);
    setFormatClipboard(null);
    setActivePageIdx(0);
    setPreviewPageDrafts({});
    setEditingPageIndex(null);
    setEditingPreviewOpen(false);
  }, [packId]);
  useEffect(() => {
    setSelectedSlotIds([]);
    setEditingPreviewOpen(false);
  }, [activePageIdx]);
  useEffect(() => {
    if (!previewEntityId && filteredEntities[0]) setPreviewEntityId(filteredEntities[0].entityId);
    if (previewEntityId && !filteredEntities.find((e) => e.entityId === previewEntityId))
      setPreviewEntityId(filteredEntities[0]?.entityId);
  }, [filteredEntities, previewEntityId]);
  useEffect(() => {
    if (selectedSheet !== "__all__" && sheetOptions.includes(selectedSheet)) return;
    const rememberedSheet = getLastActiveSheet();
    if (rememberedSheet && sheetOptions.includes(rememberedSheet)) {
      setSelectedSheet(rememberedSheet);
      return;
    }
    if (selectedSheet === "__all__" && sheetOptions.length === 1) {
      setSelectedSheet(sheetOptions[0]);
    }
  }, [selectedSheet, sheetOptions]);

  useEffect(() => {
    if (!selectedPresetId) return;
    if (matchingPresets.some((preset) => preset.presetId === selectedPresetId)) return;
    setSelectedPresetId("");
  }, [matchingPresets, selectedPresetId]);

  useEffect(() => {
    if (!hasMoHinhOptions && filterMoHinh !== "__all__") setFilterMoHinh("__all__");
  }, [hasMoHinhOptions, filterMoHinh]);

  useEffect(() => {
    if (!hasPhongCachOptions && filterPhongCach !== "__all__") setFilterPhongCach("__all__");
  }, [hasPhongCachOptions, filterPhongCach]);

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
      orderedEntities: buildOrderedEntityPool(previewEntityId),
      pageOwner: shouldPinPreviewOwner ? previewEntity : undefined,
      partnerQuota: onlyPartner ? Number.MAX_SAFE_INTEGER : partnerQuotaPerPage,
      prioritizePartner,
      batchState: { usedEntityIds: new Set<string>() },
    });
    return allocation.items;
  }, [
    effectiveActive,
    previewEntity,
    filteredEntities,
    partnerQuotaPerPage,
    onlyPartner,
    prioritizePartner,
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
  const selectedFormatBaseSlot = selectedBindableSlots[selectedBindableSlots.length - 1];
  const relatedFormatTargetSlots =
    effectiveActive && selectedFormatBaseSlot
      ? effectiveActive.slots.filter((slot) => {
          if (getSlotBindMode(slot) === null) return false;
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
  const startSurfaceMarqueeSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-bind-hit-target]") || target.closest("[data-bind-canvas-root]")) {
      return;
    }

    event.preventDefault();
    const surface = event.currentTarget;
    const start = getSurfacePoint(surface, event.clientX, event.clientY);
    surfaceSelectionRef.current = { start, active: false, lastSignature: "" };

    const onMouseMove = (moveEvent: MouseEvent) => {
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

    const onMouseUp = (upEvent: MouseEvent) => {
      const state = surfaceSelectionRef.current;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (state?.active) {
        const current = getSurfacePoint(surface, upEvent.clientX, upEvent.clientY);
        updateSurfaceMarqueeSelection(surface, normalizeSurfaceSelectionRect(state.start, current));
        upEvent.preventDefault();
      } else {
        setSelectedSlotIds([]);
      }
      surfaceSelectionRef.current = null;
      setSurfaceMarqueeRect(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };
  const applyBindingToSlots = (
    slots: Slot[],
    pageTemplateId: string,
    bindingPath: string | undefined,
  ) => {
    slots.forEach((slot) => setBinding(pageTemplateId, slot.slotId, bindingPath));
    setPreviewPageDrafts((prev) => {
      const current = prev[pageTemplateId];
      if (!current) return prev;
      const next = createWorkingTemplate(current, undefined, current);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: bindingPath || undefined };
      });
      next.updatedAt = Date.now();
      return { ...prev, [pageTemplateId]: next };
    });
  };
  const applyTextBindingSelection = (slot: Slot, value: string) => {
    if (!activePage) return;
    const bindingPath = value === "_static" ? undefined : buildTextBindingPathForSlot(slot, value);
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const applyTextSourceSelection = (slot: Slot, sheetName: string) => {
    if (!activePage) return;
    const currentField = textSlotBindingValue(slot);
    if (currentField === "_static") return;
    const bindingPath = buildEntityScopedTextBindingPath({
      path: currentField,
      sheetName: sheetName === "__current" ? undefined : sheetName,
    });
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const copySelectedSlotFormat = () => {
    const sourceSlots = selectedBindableSlots;
    if (sourceSlots.length === 0) {
      toast.error("Chọn ít nhất 1 khối để copy định dạng");
      return;
    }

    const snapshots = sourceSlots
      .map((slot, index): SlotFormatSnapshot | null => {
        const mode = getSlotBindMode(slot);
        if (!mode) return null;
        return {
          sourceSlotId: slot.slotId,
          sourceLabel: slotFormatLabel(slot, index),
          bindMode: mode,
          bindingKey: slotFormatBindingKey(slot),
          rotation: slot.rotation,
          style: cloneSlotStyle(slot.style),
        };
      })
      .filter((snapshot): snapshot is SlotFormatSnapshot => !!snapshot);

    if (snapshots.length === 0) {
      toast.error("Khối đang chọn không có định dạng để copy");
      return;
    }

    const label = snapshots.length === 1 ? snapshots[0].sourceLabel : `${snapshots.length} khối`;
    setFormatClipboard({ label, snapshots });
    toast.success(`Đã copy định dạng ${label}`);
  };
  const buildFormatAssignments = (targets: Slot[]) => {
    if (!formatClipboard) return new Map<string, SlotFormatSnapshot>();

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

    const keyUseCount = new Map<string, number>();
    const modeUseCount = new Map<FormatSlotMode, number>();
    const assignments = new Map<string, SlotFormatSnapshot>();

    for (const target of targets) {
      const mode = getSlotBindMode(target);
      if (!mode) continue;

      const bindingKey = slotFormatBindingKey(target);
      const exactMatches = byKey.get(bindingKey) ?? [];
      if (exactMatches.length > 0) {
        const used = keyUseCount.get(bindingKey) ?? 0;
        assignments.set(target.slotId, exactMatches[used % exactMatches.length]);
        keyUseCount.set(bindingKey, used + 1);
        continue;
      }

      const modeMatches = byMode.get(mode) ?? [];
      if (modeMatches.length === 0) continue;
      const used = modeUseCount.get(mode) ?? 0;
      assignments.set(target.slotId, modeMatches[used % modeMatches.length]);
      modeUseCount.set(mode, used + 1);
    }

    return assignments;
  };
  const applyCopiedSlotFormat = (targets: Slot[], scopeLabel: string) => {
    if (!activePage || !effectiveActive) return;
    if (!formatClipboard) {
      toast.error("Chưa copy định dạng");
      return;
    }
    if (targets.length === 0) {
      toast.error("Chọn khối cần áp dụng định dạng");
      return;
    }

    const assignments = buildFormatAssignments(targets);
    if (assignments.size === 0) {
      toast.error("Không có khối cùng loại để áp dụng định dạng");
      return;
    }

    setPreviewPageDrafts((prev) => {
      const current = createWorkingTemplate(effectiveActive, undefined, effectiveActive);
      current.slots = current.slots.map((slot) => {
        const snapshot = assignments.get(slot.slotId);
        if (!snapshot) return slot;
        return {
          ...slot,
          rotation: snapshot.rotation,
          style: cloneSlotStyle(snapshot.style),
        };
      });
      current.updatedAt = Date.now();
      return { ...prev, [activePage.pageTemplateId]: current };
    });
    toast.success(`Đã áp dụng định dạng cho ${assignments.size} khối ${scopeLabel}`);
  };
  const clearBindingsForSlots = (slots: Slot[], pageTemplateId: string) => {
    slots.forEach((slot) => clearBinding(pageTemplateId, slot.slotId));
    setPreviewPageDrafts((prev) => {
      const current = prev[pageTemplateId];
      if (!current) return prev;
      const next = createWorkingTemplate(current, undefined, current);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: undefined };
      });
      next.updatedAt = Date.now();
      return { ...prev, [pageTemplateId]: next };
    });
  };
  const randomImageFolderOptionsForSheet = (sheetName: string) => {
    const entityIds = new Set<string>();
    const values = new Set<string>();
    for (const entity of entities) {
      if (entity.status !== "active") continue;
      if (sheetName !== "__all__" && entity.sheetName !== sheetName) continue;
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
              sheetName: selectedSheet,
              folder: "__all__",
            })
          : value;
    applyBindingToSlots([slot], activePage.pageTemplateId, bindingPath);
  };
  const applyRandomImageScope = (slot: Slot, patch: { sheetName?: string; folder?: string }) => {
    if (!activePage) return;
    const current = parseAssetRandomScopeBindingPath(slot.bindingPath);
    const next = {
      sheetName: patch.sheetName ?? current?.sheetName ?? selectedSheet,
      folder: patch.folder ?? current?.folder ?? "__all__",
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
          : filteredEntities.find((entity) => entity[field.key]);
      if (!sampleEntity) continue;
      options.push({
        path: field.path,
        label: field.label,
        sample: truncate(sampleEntity[field.key]),
      });
      seen.add(field.path);
    }

    const metadataKeys = new Set<string>();
    filteredEntities.forEach((entity) => {
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
            : filteredEntities.find((entity) => entity.metadata?.[key]);
        options.push({
          path,
          label: key,
          sample: truncate(sampleEntity?.metadata?.[key]),
        });
      });

    return options.length ? options : [{ path: "entity.name", label: "Tên quán" }];
  }, [filteredEntities, previewEntity]);

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
    downloadJson(`${safePortableFileName(preset.name)}-generate-preset.json`, bundle);
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
    if (cfg.selectedSheet) handleSelectSheet(cfg.selectedSheet);
    setFilterMoHinh(cfg.filterMoHinh ?? "__all__");
    setFilterPhongCach(cfg.filterPhongCach ?? "__all__");
    if (cfg.prioritizePartner != null) setPrioritizePartner(cfg.prioritizePartner);
    if (cfg.onlyPartner != null) setOnlyPartner(cfg.onlyPartner);
    if (cfg.partnerQuotaPerPage != null) setPartnerQuotaPerPage(cfg.partnerQuotaPerPage);
    if (cfg.maxEntities != null) setMaxEntities(cfg.maxEntities);
    if (cfg.varyFontsFromSecondBundle != null) {
      setVaryFontsFromSecondBundle(cfg.varyFontsFromSecondBundle);
    }

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
    setPreviewPageDrafts({});
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
      setPreviewPageDrafts((prev) => {
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
      setPreviewPageDrafts((prev) => {
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

  const onGenerate = () => {
    if (!selectedPack) return toast.error("Chưa chọn bộ mẫu");
    if (filteredEntities.length === 0) return toast.error("Không có dữ liệu phù hợp");
    const pageTemplatesForGenerate = tpls.map(
      (tpl) => previewPageDrafts[tpl.pageTemplateId] ?? tpl,
    );
    let job = generatePackJob({
      pack: selectedPack,
      pageTemplates: pageTemplatesForGenerate,
      entities,
      assets,
      mode: "one-entity-per-pack",
      entityPool: filteredEntities,
      bindOverrides: packOv,
      partnerQuotaPerPage: onlyPartner ? Number.MAX_SAFE_INTEGER : partnerQuotaPerPage,
      prioritizePartner,
    });
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
    toast.success(`Đã tạo ${job.pages.length} trang`);
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

  const exportZip = async () => {
    if (!currentJob) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang xuất ${sel.length} trang...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const node = packRefs.current.get(p.pageIndex);
      if (!node) continue;
      const blob = await nodeToPngBlob(node, 2);
      files.push({ name: p.pageFile, blob });
    }
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
    await downloadZip(files, `${currentJob.packTemplateName}.zip`);
    await db.jobs.put({ ...currentJob, status: "exported" });
    toast.success("Đã xuất ZIP");
  };

  const canvasScale = effectiveActive
    ? Math.min(560 / effectiveActive.canvas.width, 700 / effectiveActive.canvas.height)
    : 0.5;

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
                      {p.name} ({p.orderedPages.length} trang)
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
                return (
                  <div key={preset.presetId} className="rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b p-4">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openPresetWorkspace(preset)}
                      >
                        <div className="truncate text-lg font-semibold">{preset.name}</div>
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
                            const previewScale = Math.min(
                              150 / previewTemplate.canvas.width,
                              190 / previewTemplate.canvas.height,
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
                                  <div className="truncate text-sm font-medium">{page.name}</div>
                                </div>
                                <div className="grid h-[205px] place-items-center overflow-hidden rounded-md border bg-muted/20">
                                  <PageRenderer
                                    template={previewTemplate}
                                    entities={entities}
                                    assets={assets}
                                    scale={previewScale}
                                    seedKey={`${preset.presetId}:${page.pageTemplateId}:preview`}
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
                <CardTitle className="text-sm">Cấu hình bộ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={prioritizePartner}
                    onCheckedChange={(v) => setPrioritizePartner(!!v)}
                  />
                  Ưu tiên đối tác
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={onlyPartner} onCheckedChange={(v) => setOnlyPartner(!!v)} />
                  Chỉ dùng dữ liệu đối tác
                </label>

                <div>
                  <Label className="text-xs">Số đối tác / trang</Label>
                  <Input
                    type="number"
                    min={0}
                    max={Math.max(0, activeTargetCount)}
                    value={partnerQuotaPerPage}
                    disabled={onlyPartner}
                    onChange={(e) =>
                      setPartnerQuotaPerPage(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {onlyPartner
                      ? "Đang bật 'Chỉ dùng dữ liệu đối tác' nên giới hạn này được bỏ qua."
                      : `Trang hiện tại có tối đa ${activeTargetCount} khối nhận dữ liệu. App sẽ tự giới hạn nếu vượt quá.`}
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Số dữ liệu tối đa</Label>
                  <Input
                    type="number"
                    min={1}
                    value={maxEntities}
                    onChange={(e) => setMaxEntities(Number(e.target.value) || 1)}
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={varyFontsFromSecondBundle}
                    onCheckedChange={(checked) => setVaryFontsFromSecondBundle(checked === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">Đổi kiểu chữ nghệ thuật từ bộ 2</span>
                  </span>
                </label>

                <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Dữ liệu phù hợp</span>
                    <b className="text-foreground">{filteredEntities.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Trang trong bộ</span>
                    <b className="text-foreground">{packPages.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Khối đã liên kết</span>
                    <b className="text-foreground">{totalBound}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Trang sẽ tạo</span>
                    <b className="text-foreground">{filteredEntities.length * packPages.length}</b>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <Button
                    onClick={onGenerate}
                    disabled={!packId || filteredEntities.length === 0}
                    className="w-full"
                  >
                    <Sparkles className="size-4 mr-2" /> Tạo bộ ảnh
                  </Button>
                  {Object.keys(packOv).length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resetAll();
                        setPreviewPageDrafts({});
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
                    <Eye className="size-3 mr-1" /> Khung: {showSafeFrame ? "Bật" : "Tắt"}
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
                            <span className="font-medium">{tpl.name}</span>
                            {ovCount > 0 && (
                              <span className="text-[10px] bg-background/30 rounded px-1">
                                {ovCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {effectiveActive && (
                      <div
                        onMouseDownCapture={startSurfaceMarqueeSelection}
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
                              setPreviewPageDrafts((prev) => {
                                const next = { ...prev };
                                delete next[activePage.pageTemplateId];
                                return next;
                              });
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
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="size-4" /> Liên kết dữ liệu
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-3">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Nguồn & bộ lọc
                  </div>
                  <div>
                    <Label className="text-xs">Nguồn dữ liệu</Label>
                    <Select value={selectedSheet} onValueChange={handleSelectSheet}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Tất cả</SelectItem>
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
                      value={filterMoHinh}
                      onValueChange={setFilterMoHinh}
                      disabled={!hasMoHinhOptions}
                    >
                      <SelectTrigger disabled={!hasMoHinhOptions}>
                        <SelectValue placeholder="Không có dữ liệu mô hình" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Tất cả</SelectItem>
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
                      value={filterPhongCach}
                      onValueChange={setFilterPhongCach}
                      disabled={!hasPhongCachOptions}
                    >
                      <SelectTrigger disabled={!hasPhongCachOptions}>
                        <SelectValue placeholder="Không có dữ liệu phong cách" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Tất cả</SelectItem>
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
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {selectedBindableSlots.length} khối đang chọn · trang {activePageIdx + 1}
                        {selectedTextSlots.length > 0 && ` · ${selectedTextSlots.length} chữ`}
                        {selectedImageSlots.length > 0 && ` · ${selectedImageSlots.length} ảnh`}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {formatClipboard && (
                          <Badge
                            variant="outline"
                            className="h-7 max-w-32 truncate px-2 text-[11px]"
                          >
                            Đã copy: {formatClipboard.label}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          onClick={copySelectedSlotFormat}
                        >
                          <Copy className="mr-1 size-3" /> Copy định dạng
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-[11px]"
                          disabled={!formatClipboard}
                          onClick={() => applyCopiedSlotFormat(selectedBindableSlots, "đang chọn")}
                        >
                          <Wand2 className="mr-1 size-3" /> Áp dụng
                        </Button>
                        {relatedFormatTargetSlots.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-[11px]"
                            disabled={!formatClipboard}
                            onClick={() =>
                              applyCopiedSlotFormat(relatedFormatTargetSlots, "trong cụm")
                            }
                          >
                            Áp dụng cụm
                          </Button>
                        )}
                      </div>
                    </div>
                    {sortedSelectedTextSlots.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs">
                          Trường chữ{" "}
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
                            </div>
                            <Select
                              value={textSlotBindingValue(slot)}
                              onValueChange={(v) => applyTextBindingSelection(slot, v)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Chọn trường" />
                              </SelectTrigger>
                              <SelectContent>
                                {TEXT_BINDING_OPTIONS.map((option) => {
                                  const value = option.value || "_static";
                                  return (
                                    <SelectItem key={`${slot.slotId}-${value}`} value={value}>
                                      {option.label}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <div>
                              <Label className="text-xs">Nguồn dữ liệu</Label>
                              <Select
                                value={textSlotSourceValue(slot)}
                                onValueChange={(sheetName) =>
                                  applyTextSourceSelection(slot, sheetName)
                                }
                                disabled={textSlotBindingValue(slot) === "_static"}
                              >
                                <SelectTrigger
                                  className="h-8"
                                  disabled={textSlotBindingValue(slot) === "_static"}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__current">Theo nguồn chung</SelectItem>
                                  {sheetOptions.map((sheet) => (
                                    <SelectItem key={sheet} value={sheet}>
                                      {sheet}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {sortedSelectedImageSlots.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs">
                          Trường ảnh{" "}
                          {sortedSelectedImageSlots.length > 1
                            ? `(${sortedSelectedImageSlots.length} khối)`
                            : ""}
                        </Label>
                        {sortedSelectedImageSlots.map((slot, index) => {
                          const value = imageSlotBindingValue(slot);
                          const randomScope = parseAssetRandomScopeBindingPath(slot.bindingPath);
                          const randomScopeSheet = randomScope?.sheetName ?? selectedSheet;
                          const randomScopeFolder = randomScope?.folder ?? "__all__";
                          const randomImageFolderOptions =
                            randomImageFolderOptionsForSheet(randomScopeSheet);
                          return (
                            <div
                              key={slot.slotId}
                              className="space-y-2 rounded-lg border bg-muted/20 p-2"
                            >
                              <div className="min-w-0 truncate text-xs font-medium">
                                {index + 1}. {imageSlotLabel(slot, index)}
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
                                      {option.label}
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
                                          folder: "__all__",
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">Tất cả nguồn</SelectItem>
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
                                        <SelectItem value="__all__">Tất cả thư mục</SelectItem>
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
                    {selectedTextSlots.length === 1 && (
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
              <Card className="mb-4">
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <Badge variant="outline">{currentJob.pages.length} trang</Badge>
                  <Badge variant="secondary">
                    {currentJob.pages.filter((p) => p.selected).length} đã chọn
                  </Badge>
                  <div className="flex-1" />
                  <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả</SelectItem>
                      <SelectItem value="selected">Đang chọn</SelectItem>
                      <SelectItem value="errors">Có cảnh báo</SelectItem>
                      <SelectItem value="partner">Có đối tác</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setSelectedAll(true)}>
                    Chọn hết
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedAll(false)}>
                    Bỏ chọn hết
                  </Button>
                  <Button onClick={exportZip}>
                    <Package className="size-4 mr-2" /> Xuất ZIP
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-6">
                {bundleGroups.map((bundle) => (
                  <div key={bundle.bundleIndex} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold">{bundle.bundleLabel}</h2>
                      <Badge variant="outline">{bundle.pages.length} trang</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const files: Array<{ name: string; blob: Blob }> = [];
                          for (const meta of bundle.pages) {
                            const node = packRefs.current.get(meta.page.pageIndex);
                            if (!node) continue;
                            const blob = await nodeToPngBlob(node, 2);
                            files.push({ name: meta.page.pageFile, blob });
                          }
                          if (jobPack && currentJob) {
                            const bundleJob = {
                              ...currentJob,
                              pages: bundle.pages.map((meta) => meta.page),
                            };
                            const bundlePages = bundleJob.pages;
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
                          }
                          await downloadZip(
                            files,
                            `${bundle.bundleLabel.toLowerCase().replace(/\s+/g, "-")}.zip`,
                          );
                        }}
                      >
                        <Package className="size-3 mr-1" /> Tải bộ
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                        const previewScale = 320 / eff.canvas.width;
                        return (
                          <Card
                            key={page.pageIndex}
                            className={page.selected ? "border-primary" : ""}
                          >
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2 min-w-0">
                                  <Checkbox
                                    checked={page.selected}
                                    onCheckedChange={() => toggleSelected(page.pageIndex)}
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-sm truncate">{tpl.name}</div>
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
                              <div className="overflow-hidden rounded border bg-muted/30">
                                <div
                                  ref={(el) => {
                                    if (el) packRefs.current.set(page.pageIndex, el);
                                  }}
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
                                  />
                                </div>
                              </div>
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
                ))}
              </div>
            </>
          )}
        </>
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
          title={`Chỉnh bố cục xem trước · ${activePage.name}`}
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
            setPreviewPageDrafts((prev) => ({
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
