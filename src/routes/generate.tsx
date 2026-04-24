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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { generatePackJob } from "@/engines/selection/generate";
import { useJobStore } from "@/features/generate/jobStore";
import { PageRenderer } from "@/features/render/PageRenderer";
import { nodeToPngBlob, downloadZip } from "@/features/render/exportPng";
import { saveBlob } from "@/features/render/saveBlob";
import { renderReactNodeOffDom } from "@/features/render/renderPageOffDom";
import {
  Sparkles,
  Download,
  Package,
  Eye,
  EyeOff,
  Link2,
  Link2Off,
  MousePointerClick,
  Filter,
  AlertTriangle,
  Image as ImageIcon,
  Type,
  Star,
  Wand2,
  Loader2,
} from "lucide-react";
import type { Entity, PageTemplate, RenderedItem, Slot } from "@/models";
import {
  TEXT_BINDING_OPTIONS,
  IMAGE_BINDING_OPTIONS,
  resolveImageBinding,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";
import { BindCanvas } from "@/features/generate/BindCanvas";
import { useBindOverrides, useEffectiveTemplate } from "@/features/generate/useBindOverrides";
import { aiSuggestBindings, aiCaptionFromEntity } from "@/features/ai/aiFeatures";
import { SuggestBindingsModal, type BindSuggestion } from "@/features/ai/SuggestBindingsModal";
import { SheetFieldsPanel } from "@/features/generate/SheetFieldsPanel";
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
  const tpls = useLiveQuery(() => db.pageTemplates.toArray(), []);
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  const overrides = useLiveQuery(() => db.overrides.toArray(), []);

  const [packId, setPackId] = useState<string | undefined>(undefined);
  const [debug, setDebug] = useState(false);
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
    toast.success(`Đã tạo ${job.pages.length} page`);
  };

  const exportZip = async () => {
    if (!currentJob || !tpls || !entities || !assets) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn page nào");
    toast.info(`Đang export ${sel.length} page...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const node = renderRefs.current.get(p.pageIndex);
      if (!node) continue;
      const blob = await nodeToPngBlob(node, 2);
      files.push({ name: p.pageFile, blob });
    }
    await downloadZip(files, `${currentJob.packTemplateName}.zip`);
    await db.jobs.put({ ...currentJob, status: "exported" });
    toast.success("Đã export ZIP & lưu job");
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
  const [entityPages, setEntityPages] = useState<EntityPreviewPage[]>([]);
  const [previewTemplateDraft, setPreviewTemplateDraft] = useState<PageTemplate | null>(null);
  const [editingEntityPageId, setEditingEntityPageId] = useState<string | null>(null);
  const entityRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const { overrides: bindOverrides, setBinding, clearBinding, resetAll } = useBindOverrides();

  // === AI suggest bindings ===
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<BindSuggestion[]>([]);

  // === AI caption ===
  const [captionBusy, setCaptionBusy] = useState(false);

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

  const buildOrderedEntityPool = (primaryEntityId: string | undefined): Entity[] => {
    if (!primaryEntityId) return filteredEntities;
    return [
      ...filteredEntities.filter((entity) => entity.entityId === primaryEntityId),
      ...filteredEntities.filter((entity) => entity.entityId !== primaryEntityId),
    ];
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
      partnerQuota: onlyPartner ? 0 : partnerQuotaPerPage,
      prioritizePartner,
      batchState: { usedEntityIds: new Set<string>() },
    });
    return allocation.items;
  }, [
    entityPreviewTemplate,
    previewEntity,
    filteredEntities,
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
  const handleSelectSlot = (slotId: string | null, additive = false) => {
    if (!slotId) {
      setSelectedSlotIds([]);
      return;
    }
    setSelectedSlotIds((prev) => {
      if (!additive) return [slotId];
      return prev.includes(slotId) ? prev.filter((id) => id !== slotId) : [...prev, slotId];
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
  const boundCount = entityPreviewTemplate?.slots.filter((s) => !!s.bindingPath).length ?? 0;
  const hasAnyBinding = boundCount > 0;

  // Tập cột data có sẵn từ entity (top-level + metadata) — feed cho AI bind suggest.
  const dataColumns = useMemo(() => {
    const set = new Set<string>();
    (entities ?? []).slice(0, 50).forEach((e) => {
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

  const runAiSuggest = async () => {
    if (!entityPreviewTemplate) return toast.error("Chưa chọn template");
    const slotsForAi = entityPreviewTemplate.slots
      .filter((s) => s.kind === "text" || s.kind === "image" || s.kind === "shape")
      .map((s) => ({
        slotId: s.slotId,
        kind: s.kind,
        placeholder: s.staticText,
        staticText: s.staticText,
      }));
    if (slotsForAi.length === 0) return toast.error("Template không có slot bindable");
    setSuggestBusy(true);
    try {
      const out = await aiSuggestBindings({ slots: slotsForAi, columns: dataColumns });
      if (!out.ok) return toast.error(out.error);
      setSuggestions(out.suggestions);
      setSuggestOpen(true);
    } catch (e) {
      toast.error("AI lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSuggestBusy(false);
    }
  };

  const applyAiSuggestions = (selected: BindSuggestion[]) => {
    selected.forEach((s) => setBinding(s.slotId, s.suggestedBindingPath));
    toast.success(`Đã áp dụng ${selected.length} liên kết`);
  };

  const runAiCaption = async () => {
    if (!selectedSlot || selectedSlot.kind !== "text" || !selectedTpl) return;
    if (!previewEntity) return toast.error("Chọn entity preview trước");
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
      toast.success("Đã sinh caption");
    } catch (e) {
      toast.error("AI lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCaptionBusy(false);
    }
  };

  const generateByEntity = () => {
    if (!entityPreviewTemplate) return toast.error("Chưa chọn template");
    if (!hasAnyBinding) {
      setEntityPages([
        {
          entityId: "_static",
          selected: true,
          items: [],
          warnings: [],
          baseTemplate: clonePageTemplate(entityPreviewTemplate),
        },
      ]);
      toast.info("Chưa bind block nào → render 1 trang tĩnh");
      return;
    }
    if (filteredEntities.length === 0) return toast.error("Không có entity phù hợp");
    const batchState = { usedEntityIds: new Set<string>() };
    setEntityPages(
      filteredEntities.map((ownerEntity) => {
        const allocation = allocateEntityBindingsForTemplate({
          template: entityPreviewTemplate,
          orderedEntities: [
            ownerEntity,
            ...randomizedEntityOrder.filter((entity) => entity.entityId !== ownerEntity.entityId),
          ],
          pageOwner: ownerEntity,
          partnerQuota: onlyPartner ? 0 : partnerQuotaPerPage,
          prioritizePartner,
          batchState,
        });
        return {
          entityId: ownerEntity.entityId,
          selected: true,
          items: allocation.items,
          warnings: allocation.warnings,
          baseTemplate: clonePageTemplate(entityPreviewTemplate),
        };
      }),
    );
    toast.success(`Đã tạo ${filteredEntities.length} trang`);
  };

  const renderEntityPageOffDom = async (p: EntityPreviewPage) => {
    const ent = entities?.find((e) => e.entityId === p.entityId);
    const tpl = p.workingTemplate ?? p.baseTemplate ?? entityPreviewTemplate;
    if (!tpl) throw new Error("Không xác định được template");
    return await renderReactNodeOffDom(
      <PageRenderer
        template={tpl}
        entities={entities ?? []}
        assets={assets ?? []}
        entity={ent}
        entityPool={buildOrderedEntityPool(p.entityId)}
        slotItems={p.items}
        scale={1}
      />,
    );
  };

  const exportEntityZip = async () => {
    if (!entityPreviewTemplate) return;
    const sel = entityPages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang export ${sel.length} trang...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const ent = entities?.find((e) => e.entityId === p.entityId);
      const slug = (ent?.name ?? p.entityId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
      const { node, cleanup } = await renderEntityPageOffDom(p);
      try {
        const blob = await nodeToPngBlob(node, 2);
        files.push({ name: `${slug || p.entityId}.png`, blob });
      } finally {
        cleanup();
      }
    }
    await downloadZip(files, `${entityPreviewTemplate.name}-entities.zip`);
    toast.success("Đã export ZIP");
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
      <PageHeader
        icon={<Sparkles className="size-5" />}
        title="Tạo nội dung"
        description="Sinh nhanh theo entity hoặc dùng pack template nâng cao."
      />

      <Tabs defaultValue="entity" className="mb-6">
        <TabsList>
          <TabsTrigger value="entity" className="gap-2">
            <Sparkles className="size-4" /> Theo entity (đơn giản)
          </TabsTrigger>
          <TabsTrigger value="pack" className="gap-2">
            <Package className="size-4" /> Pack template (nâng cao)
          </TabsTrigger>
        </TabsList>

        {/* === TAB: theo entity === */}
        <TabsContent value="entity" className="space-y-4">
          <div className="grid grid-cols-12 gap-4">
            {/* Cột 1: Cấu hình */}
            <Card className="col-span-12 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cấu hình</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Page template</Label>
                  <Select value={tplId} onValueChange={setTplId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tpls?.map((t) => (
                        <SelectItem key={t.pageTemplateId} value={t.pageTemplateId}>
                          {t.name} ({t.canvas.width}×{t.canvas.height})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Nguồn dữ liệu (sheet)</Label>
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
                  <Label className="text-xs">Lọc Mô hình (Mo_hinh)</Label>
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
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Sheet này không có cột Mô hình để lọc.
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Lọc Phong cách (Phong_cach)</Label>
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
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Sheet này không có cột Phong cách để lọc.
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={prioritizePartner}
                    onCheckedChange={(v) => setPrioritizePartner(!!v)}
                  />
                  Ưu tiên đối tác (xếp lên đầu)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={onlyPartner} onCheckedChange={(v) => setOnlyPartner(!!v)} />
                  Chỉ entity đối tác
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
                      ? "Đang bật 'Chỉ entity đối tác' nên quota này được bỏ qua."
                      : `Page hiện tại có tối đa ${activeTargetCount} block nhận entity. App sẽ tự clamp nếu vượt quá.`}
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Số trang tối đa</Label>
                  <Input
                    type="number"
                    min={1}
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value) || 1)}
                  />
                </div>
                <div className="border-t pt-3 space-y-2 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Entity phù hợp</span>
                    <b className="text-foreground">{filteredEntities.length}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Block đã liên kết</span>
                    <b className="text-foreground">
                      {boundCount}/{entityPreviewTemplate?.slots.length ?? 0}
                    </b>
                  </div>
                </div>
                {filteredEntities.length > 0 && (
                  <div>
                    <Label className="text-xs">Xem trước với entity</Label>
                    <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredEntities.map((e) => (
                          <SelectItem key={e.entityId} value={e.entityId}>
                            {e.partnerFlag ? "★ " : ""}
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="border-t pt-3 space-y-2">
                  <Button onClick={generateByEntity} disabled={!tplId} className="w-full">
                    <Sparkles className="size-4 mr-2" /> Generate
                  </Button>
                  <Button variant="outline" onClick={() => setDebug((d) => !d)} className="w-full">
                    {debug ? <EyeOff className="size-4 mr-2" /> : <Eye className="size-4 mr-2" />}
                    {debug ? "Tắt debug" : "Bật debug"}
                  </Button>
                  {entityPages.length > 0 && (
                    <Button onClick={exportEntityZip} className="w-full">
                      <Package className="size-4 mr-2" /> Export ZIP (
                      {entityPages.filter((p) => p.selected).length})
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Cột 2: Canvas tương tác */}
            <Card className="col-span-12 lg:col-span-6">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MousePointerClick className="size-4" />
                  Click block để liên kết dữ liệu
                </CardTitle>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runAiSuggest}
                    disabled={!entityPreviewTemplate || suggestBusy}
                    className="h-7 text-xs"
                  >
                    {suggestBusy ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="size-3 mr-1" />
                    )}
                    AI gợi ý bind
                  </Button>
                  {Object.keys(bindOverrides).length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        resetAll();
                        setPreviewTemplateDraft(null);
                      }}
                      className="h-7 text-xs"
                    >
                      <Link2Off className="size-3 mr-1" /> Reset
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!entityPreviewTemplate ? (
                  <div className="border border-dashed rounded-lg h-[480px] grid place-items-center text-muted-foreground text-sm">
                    Chọn template để bắt đầu
                  </div>
                ) : (
                  <div
                    className="bg-muted/30 rounded-lg p-4 grid place-items-center overflow-auto"
                    style={{ minHeight: 480 }}
                  >
                    <BindCanvas
                      template={entityPreviewTemplate}
                      scale={canvasScale}
                      selectedSlotIds={selectedSlotIds}
                      onSelectSlot={handleSelectSlot}
                      entity={previewEntity}
                      assets={assets ?? []}
                      entityPool={previewEntityPool}
                      slotItems={previewSlotItems}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cột 3: Panel binding */}
            <Card className="col-span-12 lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Link2 className="size-4" /> Liên kết dữ liệu
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedSlots.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Chọn 1 hoặc nhiều block (text hoặc image) trên canvas để gán trường data.
                  </p>
                )}
                {selectedSlots.length > 0 && selectedBindableSlots.length === 0 && (
                  <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <AlertTriangle className="size-3.5" />
                      Block đang chọn không liên kết được
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Chỉ block <b>text</b>, <b>image</b> và <b>shape</b> mới gán được trường data.
                    </p>
                  </div>
                )}
                {selectedBindableSlots.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {selectedBindableSlots.length} block đang chọn
                        {selectedTextSlots.length > 0 && ` · ${selectedTextSlots.length} text`}
                        {selectedImageSlots.length > 0 && ` · ${selectedImageSlots.length} image`}
                      </span>
                    </div>
                    {selectedTextSlots.length > 0 && (
                      <div>
                        <Label className="text-xs">
                          Trường text{" "}
                          {selectedTextSlots.length > 1
                            ? `(${selectedTextSlots.length} block)`
                            : ""}
                        </Label>
                        <Select
                          value={commonBindingValue(selectedTextSlots)}
                          onValueChange={(v) =>
                            applyBindingToSlots(selectedTextSlots, v === "_static" ? undefined : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Chọn field cho text đã chọn" />
                          </SelectTrigger>
                          <SelectContent>
                            {TEXT_BINDING_OPTIONS.map((o) => (
                              <SelectItem key={o.value || "_static"} value={o.value || "_static"}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {selectedImageSlots.length > 0 && (
                      <div>
                        <Label className="text-xs">
                          Trường ảnh{" "}
                          {selectedImageSlots.length > 1
                            ? `(${selectedImageSlots.length} block)`
                            : ""}
                        </Label>
                        <Select
                          value={commonBindingValue(selectedImageSlots)}
                          onValueChange={(v) =>
                            applyBindingToSlots(selectedImageSlots, v === "_static" ? undefined : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Chọn field cho image đã chọn" />
                          </SelectTrigger>
                          <SelectContent>
                            {IMAGE_BINDING_OPTIONS.map((o) => (
                              <SelectItem key={o.value || "_static"} value={o.value || "_static"}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground mt-1 italic">
                          Hệ thống tự gán ảnh khác nhau cho mỗi block (anti-trùng) khi entity có
                          nhiều ảnh.
                        </p>
                      </div>
                    )}
                    {selectedTextSlots.length === 1 && (
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
                        AI caption (từ data thật)
                      </Button>
                    )}
                    {selectedBindableSlots.some((slot) => !!slot.bindingPath) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => clearBindingsForSlots(selectedBindableSlots)}
                      >
                        <Link2Off className="size-3 mr-1" /> Xoá liên kết đã chọn
                      </Button>
                    )}
                    {/* Preview giá trị thực */}
                    {selectedSlot?.bindingPath && selectedPreviewEntity && (
                      <div className="border-t pt-3 space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Preview với "{selectedPreviewEntity.name}"
                        </Label>
                        {getSlotBindMode(selectedSlot) === "text" ? (
                          <div className="text-sm border rounded p-2 bg-muted/30 break-words">
                            {resolveTextBinding(
                              selectedSlot.bindingPath,
                              selectedPreviewEntity,
                              selectedSlot.staticText,
                            ) || <span className="text-muted-foreground italic">(trống)</span>}
                          </div>
                        ) : (
                          (() => {
                            const r = resolveImageBinding(
                              selectedSlot.bindingPath,
                              selectedPreviewEntity,
                              assets ?? [],
                              selectedSlot.staticImage,
                            );
                            return r.src ? (
                              <img
                                src={r.src}
                                alt=""
                                className="w-full h-32 object-cover rounded border"
                              />
                            ) : (
                              <div className="border rounded p-2 text-xs text-muted-foreground">
                                (không có ảnh phù hợp)
                              </div>
                            );
                          })()
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Panel field theo sheet — luôn hiện để designer chọn sheet và bind nhanh */}
                <div className="border-t pt-3">
                  <SheetFieldsPanel
                    entities={entities ?? []}
                    sheetOptions={sheetOptions}
                    selectedSheet={selectedSheet}
                    onSelectSheet={handleSelectSheet}
                    selectedSlots={selectedSlots}
                    previewEntity={selectedPreviewEntity}
                    onBindToSelectedSlot={(path, isImageLike) => {
                      const targets = isImageLike ? selectedImageSlots : selectedTextSlots;
                      if (targets.length === 0) return;
                      applyBindingToSlots(targets, path);
                      toast.success(`Đã liên kết ${targets.length} block: ${path}`);
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Kết quả render */}
          {entityPreviewTemplate && entityPages.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {entityPages.map((p, idx) => {
                const ent = entities?.find((e) => e.entityId === p.entityId);
                const pageTemplate = p.workingTemplate ?? p.baseTemplate ?? entityPreviewTemplate;
                const previewScale = 320 / pageTemplate.canvas.width;
                return (
                  <Card key={p.entityId + idx} className={p.selected ? "border-primary" : ""}>
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <Checkbox
                            checked={p.selected}
                            onCheckedChange={() =>
                              setEntityPages((ps) =>
                                ps.map((x, i) => (i === idx ? { ...x, selected: !x.selected } : x)),
                              )
                            }
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              {ent?.name ?? "(Template tĩnh)"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {ent?.categoryMain ?? pageTemplate.name}
                            </div>
                          </div>
                        </div>
                        {ent?.partnerFlag && (
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
                            if (el) entityRefs.current.set(p.entityId, el);
                          }}
                        >
                          <PageRenderer
                            template={pageTemplate}
                            entities={entities ?? []}
                            assets={assets ?? []}
                            entity={ent}
                            entityPool={buildOrderedEntityPool(ent)}
                            slotItems={p.items}
                            scale={previewScale}
                            debug={debug}
                          />
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setEditingEntityPageId(p.entityId)}
                      >
                        <Type className="size-3 mr-1" /> Edit page
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={async () => {
                          const slug = (ent?.name ?? p.entityId)
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .slice(0, 40);
                          const { node, cleanup } = await renderEntityPageOffDom(p);
                          try {
                            const blob = await nodeToPngBlob(node, 2);
                            saveBlob(blob, `${slug || p.entityId}.png`);
                          } finally {
                            cleanup();
                          }
                        }}
                      >
                        <Download className="size-3 mr-1" /> Export PNG
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {entityPages.length === 0 && (
            <Card>
              <CardContent className="p-8">
                <ol className="space-y-3 max-w-2xl mx-auto text-sm text-muted-foreground">
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">
                      1
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MousePointerClick className="size-4" /> Click vào các block trên canvas để
                      gán trường data từ entity.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">
                      2
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Filter className="size-4" /> Lọc danh sách entity (theo category, đối tác).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">
                      3
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="size-4" /> Bấm Generate — mỗi entity sẽ tạo 1 trang
                      riêng, các block không bind giữ nguyên nội dung tĩnh.
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          )}

          {editingEntityPage && editingEntityBaseTemplate && editingEntityTemplate && (
            <GeneratePageEditor
              open={!!editingEntityPage}
              onOpenChange={(open) => {
                if (!open) setEditingEntityPageId(null);
              }}
              title={`Edit page · ${entities?.find((e) => e.entityId === editingEntityPage.entityId)?.name ?? "Template tĩnh"}`}
              template={editingEntityTemplate}
              baseTemplate={editingEntityBaseTemplate}
              entities={entities ?? []}
              assets={assets ?? []}
              entity={entities?.find((e) => e.entityId === editingEntityPage.entityId)}
              entityPool={buildOrderedEntityPool(editingEntityPage.entityId)}
              slotItems={editingEntityPage.items}
              onApply={(nextTemplate) => {
                updateEntityPageTemplate(editingEntityPage.entityId, nextTemplate);
              }}
            />
          )}

          <SuggestBindingsModal
            open={suggestOpen}
            onOpenChange={setSuggestOpen}
            suggestions={suggestions}
            slots={entityPreviewTemplate?.slots ?? []}
            onApply={applyAiSuggestions}
          />
        </TabsContent>

        {/* === TAB: theo pack (nâng cao, bind theo entity) === */}
        <TabsContent value="pack" className="space-y-4">
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
            setDebug={setDebug}
            sheetOptions={sheetOptions}
            packId={packId}
            setPackId={setPackId}
            filter={filter}
            setFilter={setFilter}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
