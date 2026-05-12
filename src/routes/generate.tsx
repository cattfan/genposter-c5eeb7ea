import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { generatePackJob } from "@/engines/selection/generate";
import { useJobStore } from "@/features/generate/jobStore";
import { PageRenderer } from "@/features/render/PageRenderer";
import { nodeToPngBlob, downloadPng, downloadMultiBundleZip, formatZipFileName } from "@/features/render/exportPng";
import {
  Sparkles,
  Download,
  Package,
  Link2,
  Link2Off,
  MousePointerClick,
  AlertTriangle,
  Type,
  Star,
  Wand2,
  Loader2,
} from "lucide-react";
import type { Entity, PageTemplate, RenderedItem, Slot } from "@/models";
import {
  TEXT_BINDING_OPTIONS,
  IMAGE_BINDING_OPTIONS,
  ASSET_RANDOM_SCOPE_BINDING_VALUE,
  buildAssetRandomScopeBindingPath,
  isAssetRandomScopeBindingPath,
  parseAssetRandomScopeBindingPath,
  resolveImageBinding,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";
import { BindCanvas } from "@/features/generate/BindCanvas";
import { useBindOverrides, useEffectiveTemplate } from "@/features/generate/useBindOverrides";
import { aiCaptionFromEntity, aiRewriteTextPreserveMeaning } from "@/features/ai/aiFeatures";
import {
  TextListBindingPanel,
  type TextListFieldOption,
} from "@/features/generate/TextListBindingPanel";
import { TextRewritePanel } from "@/features/generate/TextRewritePanel";
import { PackTabContent } from "@/features/generate/PackTabContent";
import { GeneratePageEditor } from "@/features/generate/GeneratePageEditor";
import { getLastActiveSheet, setLastActiveSheet } from "@/storage/lastSheet";
import {
  allocateEntityBindingsForTemplate,
  buildEntityAllocationOrder,
} from "@/engines/selection/entityBindAllocator";
import { buildEntityBindingTargets } from "@/engines/binding/cardRepeater";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { clonePageTemplate, createWorkingTemplate } from "@/features/generate/templateState";
import {
  buildPublishBundle,
} from "@/features/generate/exportArtifacts";
import { applyFontVariantToTemplate } from "@/features/generate/fontVariation";
import { designDocumentToPageTemplate } from "@/features/editor/designDocument";
import { formatTemplateDisplayName } from "@/lib/templateNames";

export const Route = createFileRoute("/generate")({
  component: GeneratePage,
});

interface EntityPreviewPage {
  entityId: string;
  selected: boolean;
  items: RenderedItem[];
  warnings: string[];
  baseTemplate?: PageTemplate;
  workingTemplate?: PageTemplate;
}

function GeneratePage() {
  const packs = useLiveQuery(() => db.packTemplates.toArray(), []);
  const storedTpls = useLiveQuery(() => db.pageTemplates.toArray(), []);
  const designDocuments = useLiveQuery(() => db.designDocuments.toArray(), []);
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  const overrides = useLiveQuery(() => db.overrides.toArray(), []);
  const tpls = useMemo(() => {
    if (!storedTpls) return undefined;
    const documentsByTemplateId = new Map(
      (designDocuments ?? [])
        .filter((document) => document.mode === "template" && document.sourcePageTemplateId)
        .map((document) => [document.sourcePageTemplateId!, document]),
    );
    for (const document of designDocuments ?? []) {
      if (document.mode !== "template") continue;
      if (!documentsByTemplateId.has(document.designDocumentId)) {
        documentsByTemplateId.set(document.designDocumentId, document);
      }
    }
    return storedTpls.map((template) => {
      const document = documentsByTemplateId.get(template.pageTemplateId);
      if (!document) return template;
      return designDocumentToPageTemplate(document, template);
    });
  }, [storedTpls, designDocuments]);

  const [packId, setPackId] = useState<string | undefined>(undefined);
  const debug = false;
  const [filter, setFilter] = useState<"all" | "selected" | "errors" | "partner">("all");
  const { currentJob, setJob, toggleSelected, setSelectedAll, updatePage } = useJobStore();
  const renderRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const selectedPack = packs?.find((p) => p.packTemplateId === packId);

  useEffect(() => {
    if (!currentJob || currentJob.status !== "exported") return;
    const timeout = window.setTimeout(() => {
      void db.jobs.put(currentJob);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [currentJob]);

  const onGenerate = () => {
    if (!selectedPack || !tpls || !entities || !assets) return;
    const job = generatePackJob({
      pack: selectedPack,
      pageTemplates: tpls,
      entities,
      assets,
      overrides: overrides ?? [],
    });
    setJob(job);
    toast.success(`Đã tạo ${job.pages.length} trang`);
  };

  const exportZip = async () => {
    if (!currentJob || !tpls || !entities || !assets) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang xuất ${sel.length} trang...`);
    const images: Array<{ fileName: string; blob: Blob; pageIndex: number }> = [];
    for (const p of sel) {
      const node = renderRefs.current.get(p.pageIndex);
      if (!node) continue;
      const blob = await nodeToPngBlob(node, 2);
      images.push({ fileName: p.pageFile, blob, pageIndex: p.pageIndex });
    }
    const bundle = await buildPublishBundle({
      packName: currentJob.packTemplateName,
      pages: sel.map((p) => ({
        pageFile: p.pageFile,
        pageIndex: p.pageIndex,
        pageName: p.workingTemplate?.name,
        entityId: p.entityId,
        entityName: p.entityName,
        items: p.items,
      })),
      entities,
      images,
      variantCount: 4,
    });
    const templateName = formatTemplateDisplayName(currentJob.packTemplateName, "bo-anh");
    const zipFileName = `${formatZipFileName(templateName, { version: 1 })}.zip`;
    await downloadMultiBundleZip([{ files: bundle.files }], zipFileName);
    await db.jobs.put({ ...currentJob, status: "exported" });
    toast.success("Đã xuất ZIP và lưu lượt tạo");
  };

  const filteredPages = currentJob?.pages.filter((p) => {
    if (filter === "selected") return p.selected;
    if (filter === "errors") return p.warnings.length > 0 || p.state === "rejected";
    if (filter === "partner") return p.items.some((i) => i.partnerFlag);
    return true;
  });

  // === Chế độ "Generate theo entity" ===
  const [tplId, setTplId] = useState<string | undefined>(undefined);
  const [selectedSheet, setSelectedSheet] = useState<string>(
    () => getLastActiveSheet() ?? "__all__",
  );
  const [filterMoHinh, setFilterMoHinh] = useState<string>("__all__");
  const [filterPhongCach, setFilterPhongCach] = useState<string>("__all__");
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [partnerQuotaPerPage, setPartnerQuotaPerPage] = useState<number>(0);
  const [maxPages, setMaxPages] = useState<number>(50);
  const [varyFontsFromSecondPage, setVaryFontsFromSecondPage] = useState(false);
  const [entityPages, setEntityPages] = useState<EntityPreviewPage[]>([]);
  const [previewTemplateDraft, setPreviewTemplateDraft] = useState<PageTemplate | null>(null);
  const [editingEntityPageId, setEditingEntityPageId] = useState<string | null>(null);
  const [editingPreviewOpen, setEditingPreviewOpen] = useState(false);
  const entityRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const { overrides: bindOverrides, setBinding, clearBinding, resetAll } = useBindOverrides();

  // === AI caption ===
  const [captionBusy, setCaptionBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);

  const selectedTpl = tpls?.find((t) => t.pageTemplateId === tplId);
  const effectiveTpl = useEffectiveTemplate(selectedTpl, bindOverrides);
  const entityPreviewTemplate = previewTemplateDraft ?? effectiveTpl;

  // Distinct sheets / mô hình / phong cách
  const sheetOptions = useMemo(() => {
    const set = new Set<string>();
    entities?.forEach((e) => e.sheetName && set.add(e.sheetName));
    return Array.from(set).sort();
  }, [entities]);
  const moHinhOptions = useMemo(() => {
    const set = new Set<string>();
    entities?.forEach((e) => {
      if (e.status !== "active") return;
      if (selectedSheet !== "__all__" && e.sheetName !== selectedSheet) return;
      if (e.categoryMain) set.add(e.categoryMain);
    });
    return Array.from(set).sort();
  }, [entities, selectedSheet]);
  const phongCachOptions = useMemo(() => {
    const set = new Set<string>();
    entities?.forEach((e) => {
      if (e.status !== "active") return;
      if (selectedSheet !== "__all__" && e.sheetName !== selectedSheet) return;
      if (e.categorySub) set.add(e.categorySub);
    });
    return Array.from(set).sort();
  }, [entities, selectedSheet]);
  const hasMoHinhOptions = moHinhOptions.length > 0;
  const hasPhongCachOptions = phongCachOptions.length > 0;

  const handleSelectSheet = (sheet: string) => {
    setSelectedSheet(sheet);
    setLastActiveSheet(sheet);
    setFilterMoHinh("__all__");
    setFilterPhongCach("__all__");
  };

  const filteredEntities: Entity[] = useMemo(() => {
    if (!entities) return [];
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
    return list.slice(0, Math.max(1, maxPages));
  }, [
    entities,
    selectedSheet,
    filterMoHinh,
    filterPhongCach,
    onlyPartner,
    prioritizePartner,
    maxPages,
  ]);

  const buildOrderedEntityPool = useCallback((primaryEntityId: string | undefined): Entity[] => {
    if (!primaryEntityId) return filteredEntities;
    return [
      ...filteredEntities.filter((entity) => entity.entityId === primaryEntityId),
      ...filteredEntities.filter((entity) => entity.entityId !== primaryEntityId),
    ];
  }, [filteredEntities]);

  const randomizedEntityOrder = useMemo(
    () => buildEntityAllocationOrder(filteredEntities, prioritizePartner, "generate-preview"),
    [filteredEntities, prioritizePartner],
  );

  const previewEntityPool = useMemo(
    () => buildOrderedEntityPool(previewEntityId),
    [buildOrderedEntityPool, previewEntityId],
  );

  const activeTargetCount = useMemo(
    () =>
      entityPreviewTemplate
        ? buildEntityBindingTargets(entityPreviewTemplate, filteredEntities).length
        : 0,
    [entityPreviewTemplate, filteredEntities],
  );

  // Reset chọn slot & preview entity khi đổi template
  useEffect(() => {
    setSelectedSlotIds([]);
    resetAll();
    setPreviewTemplateDraft(null);
    setEditingEntityPageId(null);
    setEditingPreviewOpen(false);
  }, [tplId, resetAll]);

  // Auto chọn entity preview đầu tiên
  useEffect(() => {
    if (!previewEntityId && filteredEntities[0]) setPreviewEntityId(filteredEntities[0].entityId);
    if (previewEntityId && !filteredEntities.find((e) => e.entityId === previewEntityId)) {
      setPreviewEntityId(filteredEntities[0]?.entityId);
    }
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
    if (!hasMoHinhOptions && filterMoHinh !== "__all__") setFilterMoHinh("__all__");
  }, [hasMoHinhOptions, filterMoHinh]);

  useEffect(() => {
    if (!hasPhongCachOptions && filterPhongCach !== "__all__") setFilterPhongCach("__all__");
  }, [hasPhongCachOptions, filterPhongCach]);

  const previewEntity = entities?.find((e) => e.entityId === previewEntityId);
  const selectedSlots = useMemo(
    () =>
      selectedSlotIds
        .map((slotId) => entityPreviewTemplate?.slots.find((slot) => slot.slotId === slotId))
        .filter((slot): slot is Slot => !!slot),
    [entityPreviewTemplate, selectedSlotIds],
  );
  const selectedSlot: Slot | undefined = selectedSlots[selectedSlots.length - 1];
  const previewSlotItems = useMemo(() => {
    if (!entityPreviewTemplate || !previewEntity) return [];
    const allocation = allocateEntityBindingsForTemplate({
      template: entityPreviewTemplate,
      orderedEntities: buildOrderedEntityPool(previewEntityId),
      pageOwner: previewEntity,
      partnerQuota: onlyPartner ? Number.MAX_SAFE_INTEGER : partnerQuotaPerPage,
      prioritizePartner,
      batchState: { usedEntityIds: new Set<string>() },
    });
    return allocation.items;
  }, [
    entityPreviewTemplate,
    previewEntity,
    buildOrderedEntityPool,
    previewEntityId,
    partnerQuotaPerPage,
    onlyPartner,
    prioritizePartner,
  ]);
  const selectedPreviewEntity = useMemo(() => {
    if (!selectedSlot) return previewEntity;
    const slotEntityId = previewSlotItems.find(
      (item) => item.slotId === selectedSlot.slotId,
    )?.entityId;
    return entities?.find((item) => item.entityId === slotEntityId) ?? previewEntity;
  }, [selectedSlot, previewSlotItems, entities, previewEntity]);
  const getSlotBindMode = (slot: Slot): "text" | "image" | null => {
    if (slot.kind === "text") return "text";
    if (slot.kind === "image") return "image";
    if (slot.kind === "shape") return slot.staticText?.trim() ? "text" : "image";
    return null;
  };
  const selectedTextSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) === "text");
  const selectedImageSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) === "image");
  const selectedBindableSlots = selectedSlots.filter((slot) => getSlotBindMode(slot) !== null);
  const handleSelectSlot = (
    slotId: string | null,
    mode: "replace" | "toggle" | "group" | "replace-many" = "replace",
    relatedSlotIds: string[] = [],
  ) => {
    if (!slotId) {
      setSelectedSlotIds([]);
      return;
    }
    setSelectedSlotIds((prev) => {
      if (mode === "replace-many") {
        const ids = relatedSlotIds.length > 0 ? relatedSlotIds : [slotId];
        return Array.from(new Set(ids));
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
      const ids = relatedSlotIds.length > 0 ? relatedSlotIds : [slotId];
      return Array.from(new Set(ids));
    });
  };
  const applyBindingToSlots = (slots: Slot[], bindingPath: string | undefined) => {
    slots.forEach((slot) => setBinding(slot.slotId, bindingPath));
    setPreviewTemplateDraft((prev) => {
      if (!prev) return prev;
      const next = clonePageTemplate(prev);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: bindingPath || undefined };
      });
      next.updatedAt = Date.now();
      return next;
    });
  };
  const clearBindingsForSlots = (slots: Slot[]) => {
    slots.forEach((slot) => clearBinding(slot.slotId));
    setPreviewTemplateDraft((prev) => {
      if (!prev) return prev;
      const next = clonePageTemplate(prev);
      next.slots = next.slots.map((slot) => {
        if (!slots.some((target) => target.slotId === slot.slotId)) return slot;
        return { ...slot, bindingPath: undefined };
      });
      next.updatedAt = Date.now();
      return next;
    });
  };
  const commonBindingValue = (slots: Slot[]): string | undefined => {
    if (slots.length === 0) return undefined;
    const values = Array.from(new Set(slots.map((slot) => slot.bindingPath ?? "_static")));
    return values.length === 1 ? values[0] : undefined;
  };
  const commonImageBindingValue = commonBindingValue(selectedImageSlots);
  const imageBindingSelectValue = isAssetRandomScopeBindingPath(commonImageBindingValue)
    ? ASSET_RANDOM_SCOPE_BINDING_VALUE
    : commonImageBindingValue;
  const randomScopeConfig = parseAssetRandomScopeBindingPath(commonImageBindingValue);
  const randomScopeSheet = randomScopeConfig?.sheetName ?? selectedSheet;
  const randomScopeFolder = randomScopeConfig?.folder ?? "__all__";
  const randomImageFolderOptions = useMemo(() => {
    const entityIds = new Set<string>();
    const values = new Set<string>();
    for (const entity of entities ?? []) {
      if (entity.status !== "active") continue;
      if (randomScopeSheet !== "__all__" && entity.sheetName !== randomScopeSheet) continue;
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
    for (const asset of assets ?? []) {
      if (entityIds.has(asset.entityId) && asset.role) values.add(asset.role);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "vi"));
  }, [assets, entities, randomScopeSheet]);
  const applyImageBindingSelection = (value: string) => {
    const bindingPath =
      value === "_static"
        ? undefined
        : value === ASSET_RANDOM_SCOPE_BINDING_VALUE
          ? buildAssetRandomScopeBindingPath({ sheetName: selectedSheet, folder: "__all__" })
          : value;
    applyBindingToSlots(selectedImageSlots, bindingPath);
  };
  const applyRandomImageScope = (patch: { sheetName?: string; folder?: string }) => {
    const next = {
      sheetName: patch.sheetName ?? randomScopeSheet,
      folder: patch.folder ?? randomScopeFolder,
    };
    applyBindingToSlots(selectedImageSlots, buildAssetRandomScopeBindingPath(next));
  };
  const boundCount = entityPreviewTemplate?.slots.filter((s) => !!s.bindingPath).length ?? 0;
  const hasAnyBinding = boundCount > 0;

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

  const runAiCaption = async () => {
    if (!selectedSlot || selectedSlot.kind !== "text" || !selectedTpl) return;
    if (!previewEntity) return toast.error("Chọn dòng xem trước trước");
    setCaptionBusy(true);
    try {
      const out = await aiCaptionFromEntity({
        entity: previewEntity as unknown as Record<string, unknown>,
        style: "instagram",
      });
      if (!out.ok) return toast.error(out.error);
      setBinding(selectedSlot.slotId, undefined);
      setPreviewTemplateDraft((prev) => {
        const working = createWorkingTemplate(selectedTpl, bindOverrides, prev ?? undefined);
        working.slots = working.slots.map((slot) =>
          slot.slotId === selectedSlot.slotId
            ? { ...slot, bindingPath: undefined, staticText: out.caption }
            : slot,
        );
        working.updatedAt = Date.now();
        return working;
      });
      toast.success("Đã viết chú thích");
    } catch (e) {
      toast.error("AI lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCaptionBusy(false);
    }
  };

  const getRewriteCurrentText = (slot: Slot) =>
    (slot.staticText ?? "").trim() ||
    (slot.bindingPath
      ? resolveTextBinding(slot.bindingPath, selectedPreviewEntity, "", previewEntityPool).trim()
      : "");

  const runAiRewriteSelectedText = async (sourceText?: string) => {
    if (!selectedTpl || selectedTextSlots.length !== 1) return;
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
      setBinding(slot.slotId, undefined);
      setPreviewTemplateDraft((prev) => {
        const working = createWorkingTemplate(selectedTpl, bindOverrides, prev ?? undefined);
        working.slots = working.slots.map((item) =>
          item.slotId === slot.slotId
            ? { ...item, bindingPath: undefined, staticText: out.text }
            : item,
        );
        working.updatedAt = Date.now();
        return working;
      });
      toast.success("AI đã viết lại khung chữ");
    } catch (e) {
      toast.error("AI lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRewriteBusy(false);
    }
  };

  const generateByEntity = () => {
    if (!entityPreviewTemplate) return toast.error("Chưa chọn mẫu");
    if (!hasAnyBinding || activeTargetCount === 0) {
      setEntityPages([
        {
          entityId: "_static",
          selected: true,
          items: [],
          warnings: [],
          baseTemplate: clonePageTemplate(entityPreviewTemplate),
        },
      ]);
      toast.info(
        hasAnyBinding
          ? "Mẫu chỉ có danh sách hoặc nội dung tĩnh, nên tạo 1 trang từ nguồn dữ liệu"
          : "Chưa liên kết khối nào, nên tạo 1 trang tĩnh",
      );
      return;
    }
    if (filteredEntities.length === 0) return toast.error("Không có dữ liệu phù hợp");
    const batchState = { usedEntityIds: new Set<string>() };
    setEntityPages(
      filteredEntities.map((ownerEntity, index) => {
        const allocation = allocateEntityBindingsForTemplate({
          template: entityPreviewTemplate,
          orderedEntities: [
            ownerEntity,
            ...randomizedEntityOrder.filter((entity) => entity.entityId !== ownerEntity.entityId),
          ],
          pageOwner: ownerEntity,
          partnerQuota: onlyPartner ? Number.MAX_SAFE_INTEGER : partnerQuotaPerPage,
          prioritizePartner,
          batchState,
        });
        return {
          entityId: ownerEntity.entityId,
          selected: true,
          items: allocation.items,
          warnings: allocation.warnings,
          baseTemplate:
            varyFontsFromSecondPage && index > 0
              ? applyFontVariantToTemplate(entityPreviewTemplate, index + 1)
              : clonePageTemplate(entityPreviewTemplate),
        };
      }),
    );
    toast.success(`Đã tạo ${filteredEntities.length} trang`);
  };

  const exportEntityZip = async () => {
    if (!entityPreviewTemplate) return;
    const sel = entityPages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang xuất ${sel.length} trang...`);
    const images: Array<{
      fileName: string;
      blob: Blob;
      pageIndex: number;
      templateId?: string;
      templateName?: string;
    }> = [];
    for (const [idx, p] of sel.entries()) {
      const node = entityRefs.current.get(p.entityId);
      if (!node) continue;
      const ent = entities?.find((e) => e.entityId === p.entityId);
      const slug = (ent?.name ?? p.entityId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
      const blob = await nodeToPngBlob(node, 2);
      images.push({
        fileName: `${slug || p.entityId}.png`,
        blob,
        pageIndex: idx,
        templateId: entityPreviewTemplate.pageTemplateId,
        templateName: entityPreviewTemplate.name,
      });
    }
    if (images.length === 0) return toast.error("Không tạo được ảnh để xuất");
    const exportPages = sel.map((page, index) => ({
      pageIndex: index,
      pageFile: images[index]?.fileName,
      pageName:
        entities?.find((entity) => entity.entityId === page.entityId)?.name ?? `Trang ${index + 1}`,
      entityId: page.entityId === "_static" ? undefined : page.entityId,
      entityName: entities?.find((entity) => entity.entityId === page.entityId)?.name,
      items: page.items,
    }));
    const bundle = await buildPublishBundle({
      packName: entityPreviewTemplate.name,
      pages: exportPages,
      entities: entities ?? [],
      images,
      variantCount: 4,
    });
    const templateName = formatTemplateDisplayName(entityPreviewTemplate.name, "bo-anh");
    const zipFileName = `${formatZipFileName(templateName, { version: 1 })}.zip`;
    await downloadMultiBundleZip([{ files: bundle.files }], zipFileName);
    toast.success(`Đã xuất ZIP · ${bundle.files.length} file`);
  };

  // Tính scale canvas tương tác theo container ~640px max
  const canvasScale = entityPreviewTemplate
    ? Math.min(640 / entityPreviewTemplate.canvas.width, 720 / entityPreviewTemplate.canvas.height)
    : 0.5;

  const updateEntityPageTemplate = (entityId: string, nextTemplate: PageTemplate | null) => {
    setEntityPages((pages) =>
      pages.map((page) =>
        page.entityId === entityId
          ? {
              ...page,
              workingTemplate: nextTemplate ?? undefined,
            }
          : page,
      ),
    );
  };

  const editingEntityPage = entityPages.find((page) => page.entityId === editingEntityPageId);
  const editingEntityBaseTemplate = editingEntityPage?.baseTemplate ?? entityPreviewTemplate;
  const editingEntityTemplate =
    editingEntityPage?.workingTemplate ?? editingEntityPage?.baseTemplate ?? entityPreviewTemplate;

  return (
    <PageContainer className="max-w-[1600px]">
      <PageHeader icon={<Sparkles className="size-5" />} title="Tạo nội dung" />

      <PackTabContent
        packs={packs ?? []}
        tpls={tpls ?? []}
        entities={entities ?? []}
        assets={assets ?? []}
        currentJob={currentJob}
        setJob={setJob}
        updatePage={updatePage}
        toggleSelected={toggleSelected}
        setSelectedAll={setSelectedAll}
        renderRefs={renderRefs}
        debug={debug}
        sheetOptions={sheetOptions}
        packId={packId}
        setPackId={setPackId}
        filter={filter}
        setFilter={setFilter}
      />
    </PageContainer>
  );
}
