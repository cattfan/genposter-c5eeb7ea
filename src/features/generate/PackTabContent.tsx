// Tab "Pack template (nâng cao)" — bind dữ liệu vào từng page của pack giống tab entity.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Download,
  Package,
  Eye,
  EyeOff,
  Link2,
  Link2Off,
  MousePointerClick,
  AlertTriangle,
  Image as ImageIcon,
  Type,
  Star,
  Wand2,
  Loader2,
  Filter,
} from "lucide-react";
import type {
  Asset,
  Entity,
  GenerationJob,
  PackTemplate,
  PageTemplate,
  RenderedPage,
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
  resolveImageBinding,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";
import { BindCanvas } from "@/features/generate/BindCanvas";
import { PageRenderer } from "@/features/render/PageRenderer";
import { SheetFieldsPanel } from "@/features/generate/SheetFieldsPanel";
import { GeneratePageEditor } from "@/features/generate/GeneratePageEditor";
import { SuggestBindingsModal, type BindSuggestion } from "@/features/ai/SuggestBindingsModal";
import { aiCaptionFromEntity, aiSuggestBindings } from "@/features/ai/aiFeatures";
import { generateCaptions } from "@/engines/captions/generator";
import { generatePackJob, type PackBindMode } from "@/engines/selection/generate";
import {
  allocateEntityBindingsForTemplate,
  buildEntityAllocationOrder,
} from "@/engines/selection/entityBindAllocator";
import { buildEntityBindingTargets } from "@/engines/binding/cardRepeater";
import {
  usePackBindOverrides,
} from "@/features/generate/usePackBindOverrides";
import { nodeToPngBlob, downloadZip } from "@/features/render/exportPng";
import { saveBlob } from "@/features/render/saveBlob";
import { renderReactNodeOffDom } from "@/features/render/renderPageOffDom";
import { db } from "@/storage/db";
import { getLastActiveSheet, setLastActiveSheet } from "@/storage/lastSheet";
import { buildBundleGroups } from "@/lib/packDisplay";
import {
  createWorkingTemplate,
  resolvePageWorkingTemplate,
} from "@/features/generate/templateState";

type Filter = "all" | "selected" | "errors" | "partner";

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
  setDebug: React.Dispatch<React.SetStateAction<boolean>>;
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
  setDebug,
  sheetOptions,
  packId,
  setPackId,
  filter,
  setFilter,
}: Props) {
  const [mode, setMode] = useState<PackBindMode>("one-entity-per-pack");
  const [selectedSheet, setSelectedSheet] = useState<string>(
    () => getLastActiveSheet() ?? "__all__",
  );
  const [filterMoHinh, setFilterMoHinh] = useState<string>("__all__");
  const [filterPhongCach, setFilterPhongCach] = useState<string>("__all__");
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [partnerQuotaPerPage, setPartnerQuotaPerPage] = useState<number>(0);
  const [maxEntities, setMaxEntities] = useState<number>(10);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const [aiBusy, setAiBusy] = useState(false);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<BindSuggestion[]>([]);
  const [suggestPageId, setSuggestPageId] = useState<string | null>(null);
  const packRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const {
    all: packOv,
    setBinding,
    clearBinding,
    resetPage,
    resetAll,
  } = usePackBindOverrides();
  const [previewPageDrafts, setPreviewPageDrafts] = useState<Record<string, PageTemplate>>({});
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);

  const selectedPack = packs.find((p) => p.packTemplateId === packId);
  const packPages: PageTemplate[] = useMemo(() => {
    if (!selectedPack) return [];
    const map = new Map(tpls.map((t) => [t.pageTemplateId, t]));
    return selectedPack.orderedPages.map((id) => map.get(id)).filter((t): t is PageTemplate => !!t);
  }, [selectedPack, tpls]);

  const activePage = packPages[activePageIdx];
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
    setActivePageIdx(0);
    setPreviewPageDrafts({});
    setEditingPageIndex(null);
  }, [packId]);
  useEffect(() => {
    setSelectedSlotIds([]);
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
      partnerQuota: onlyPartner ? 0 : partnerQuotaPerPage,
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
  const commonBindingValue = (slots: Slot[]): string | undefined => {
    if (slots.length === 0) return undefined;
    const values = Array.from(new Set(slots.map((slot) => slot.bindingPath ?? "_static")));
    return values.length === 1 ? values[0] : undefined;
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

  const runAiSuggest = async (forAllPages: boolean) => {
    if (!packPages.length) return toast.error("Pack chưa có page");
    setAiBusy(true);
    try {
      if (forAllPages) {
        // Loop từng page, áp luôn (không mở modal)
        let total = 0;
        for (const tpl of packPages) {
          const eff = resolvePageWorkingTemplate(
            tpl,
            packOv[tpl.pageTemplateId],
            previewPageDrafts[tpl.pageTemplateId],
          );
          if (!eff) continue;
          const slotsForAi = eff.slots
            .filter((s) => s.kind === "text" || s.kind === "image" || s.kind === "shape")
            .map((s) => ({
              slotId: s.slotId,
              kind: s.kind,
              placeholder: s.staticText,
              staticText: s.staticText,
            }));
          if (slotsForAi.length === 0) continue;
          const out = await aiSuggestBindings({ slots: slotsForAi, columns: dataColumns });
          if (!out.ok) continue;
          out.suggestions.forEach((s) => {
            if (s.suggestedBindingPath) {
              setBinding(tpl.pageTemplateId, s.slotId, s.suggestedBindingPath);
              total += 1;
            }
          });
        }
        toast.success(`AI đã bind ${total} slot trên ${packPages.length} page`);
      } else {
        if (!effectiveActive) return;
        const slotsForAi = effectiveActive.slots
          .filter((s) => s.kind === "text" || s.kind === "image" || s.kind === "shape")
          .map((s) => ({
            slotId: s.slotId,
            kind: s.kind,
            placeholder: s.staticText,
            staticText: s.staticText,
          }));
        if (slotsForAi.length === 0) return toast.error("Page không có slot bindable");
        const out = await aiSuggestBindings({ slots: slotsForAi, columns: dataColumns });
        if (!out.ok) return toast.error(out.error);
        setSuggestions(out.suggestions);
        setSuggestPageId(effectiveActive.pageTemplateId);
        setSuggestOpen(true);
      }
    } catch (e) {
      toast.error("AI lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiSuggestions = (selected: BindSuggestion[]) => {
    if (!suggestPageId) return;
    selected.forEach((s) => setBinding(suggestPageId, s.slotId, s.suggestedBindingPath));
    toast.success(`Đã áp dụng ${selected.length} liên kết`);
  };

  const runAiCaption = async () => {
    if (!activePage || !selectedSlot || selectedSlot.kind !== "text") return;
    if (!previewEntity) return toast.error("Chọn entity preview trước");
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
      toast.success("Đã sinh caption");
    } catch (error) {
      toast.error("AI lỗi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setCaptionBusy(false);
    }
  };

  const onGenerate = () => {
    if (!selectedPack) return toast.error("Chưa chọn pack");
    if (filteredEntities.length === 0) return toast.error("Không có entity phù hợp");
    const pageTemplatesForGenerate = tpls.map(
      (tpl) => previewPageDrafts[tpl.pageTemplateId] ?? tpl,
    );
    const job = generatePackJob({
      pack: selectedPack,
      pageTemplates: pageTemplatesForGenerate,
      entities,
      assets,
      mode,
      entityPool: filteredEntities,
      bindOverrides: packOv,
      partnerQuotaPerPage: onlyPartner ? 0 : partnerQuotaPerPage,
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
    setJob(job);
    toast.success(`Đã tạo ${job.pages.length} page`);
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

  const renderPackPageOffDom = async (page: RenderedPage) => {
    const tpl = tpls.find((t) => t.pageTemplateId === page.pageTemplateId);
    if (!tpl) throw new Error(`Không tìm thấy template cho page ${page.pageIndex}`);
    const eff =
      page.workingTemplate ??
      resolvePageWorkingTemplate(tpl, page.bindOverrides ?? packOv[tpl.pageTemplateId]);
    if (!eff) throw new Error(`Không resolve được template cho page ${page.pageIndex}`);
    const ent = page.entityId
      ? entities.find((entity) => entity.entityId === page.entityId)
      : undefined;
    return await renderReactNodeOffDom(
      <PageRenderer
        template={eff}
        page={page}
        entities={entities}
        assets={assets}
        entity={ent}
        entityPool={buildOrderedEntityPool(page.entityId)}
        scale={1}
      />,
    );
  };

  const exportZip = async () => {
    if (!currentJob) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn page nào");
    toast.info(`Đang export ${sel.length} page...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const { node, cleanup } = await renderPackPageOffDom(p);
      try {
        const blob = await nodeToPngBlob(node, 2);
        files.push({ name: p.pageFile, blob });
      } finally {
        cleanup();
      }
    }
    await downloadZip(files, `${currentJob.packTemplateName}.zip`);
    await db.jobs.put({ ...currentJob, status: "exported" });
    toast.success("Đã export ZIP & lưu job");
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
      <div className="grid grid-cols-12 gap-4">
        {/* Cột 1: Cấu hình */}
        <Card className="col-span-12 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cấu hình pack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Pack template</Label>
              <Select value={packId} onValueChange={setPackId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn pack..." />
                </SelectTrigger>
                <SelectContent>
                  {packs.map((p) => (
                    <SelectItem key={p.packTemplateId} value={p.packTemplateId}>
                      {p.name} ({p.orderedPages.length} page)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Chế độ bind</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as PackBindMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one-entity-per-pack">1 entity / nguyên pack</SelectItem>
                  <SelectItem value="one-entity-per-page">
                    Mỗi page 1 entity (round-robin)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1 italic">
                {mode === "one-entity-per-pack"
                  ? `Mỗi entity sẽ render đủ ${packPages.length || "N"} page.`
                  : "Lần lượt nhét entity vào từng page của 1 pack."}
              </p>
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sheet này không có cột Mô hình để lọc.
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
              Ưu tiên đối tác
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
                onChange={(e) => setPartnerQuotaPerPage(Math.max(0, Number(e.target.value) || 0))}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {onlyPartner
                  ? "Đang bật 'Chỉ entity đối tác' nên quota này được bỏ qua."
                  : `Page hiện tại có tối đa ${activeTargetCount} block nhận entity. App sẽ tự clamp nếu vượt quá.`}
              </p>
            </div>

            <div>
              <Label className="text-xs">
                {mode === "one-entity-per-pack" ? "Số entity tối đa" : "Số entity dùng"}
              </Label>
              <Input
                type="number"
                min={1}
                value={maxEntities}
                onChange={(e) => setMaxEntities(Number(e.target.value) || 1)}
              />
            </div>

            <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Entity phù hợp</span>
                <b className="text-foreground">{filteredEntities.length}</b>
              </div>
              <div className="flex justify-between">
                <span>Page trong pack</span>
                <b className="text-foreground">{packPages.length}</b>
              </div>
              <div className="flex justify-between">
                <span>Slot đã bind (tổng)</span>
                <b className="text-foreground">{totalBound}</b>
              </div>
              <div className="flex justify-between">
                <span>Page sẽ tạo</span>
                <b className="text-foreground">
                  {mode === "one-entity-per-pack"
                    ? filteredEntities.length * packPages.length
                    : packPages.length}
                </b>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              <Button
                onClick={onGenerate}
                disabled={!packId || filteredEntities.length === 0}
                className="w-full"
              >
                <Sparkles className="size-4 mr-2" /> Generate
              </Button>
              <Button variant="outline" onClick={() => setDebug((d) => !d)} className="w-full">
                {debug ? <EyeOff className="size-4 mr-2" /> : <Eye className="size-4 mr-2" />}
                {debug ? "Tắt debug" : "Bật debug"}
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
                  <Link2Off className="size-3 mr-1" /> Reset toàn bộ bind
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cột 2: Canvas bind từng page */}
        <Card className="col-span-12 lg:col-span-6">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <MousePointerClick className="size-4" />
              Bind dữ liệu cho từng page
            </CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAiSuggest(false)}
                disabled={!effectiveActive || aiBusy}
                className="h-7 text-xs"
              >
                {aiBusy ? (
                  <Loader2 className="size-3 mr-1 animate-spin" />
                ) : (
                  <Wand2 className="size-3 mr-1" />
                )}
                AI page này
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAiSuggest(true)}
                disabled={packPages.length === 0 || aiBusy}
                className="h-7 text-xs"
              >
                <Wand2 className="size-3 mr-1" />
                AI tất cả
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {packPages.length === 0 ? (
              <div className="border border-dashed rounded-lg h-[480px] grid place-items-center text-muted-foreground text-sm">
                Chọn pack template để bắt đầu
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
                        <span>P{idx + 1}</span>
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
                    className="bg-muted/30 rounded-lg p-4 grid place-items-center overflow-auto"
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
                      slotItems={previewSlotItems}
                    />
                  </div>
                )}

                {filteredEntities.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Preview với</Label>
                    <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
                      <SelectTrigger className="h-8">
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
                    {activePage &&
                      packOv[activePage.pageTemplateId] &&
                      Object.keys(packOv[activePage.pageTemplateId]).length > 0 && (
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
                          <Link2Off className="size-3 mr-1" /> Reset page
                        </Button>
                      )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Cột 3: Bind panel + sheet fields */}
        <Card className="col-span-12 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="size-4" /> Liên kết dữ liệu
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedSlots.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Chọn 1 hoặc nhiều block trên canvas để gán trường data cho page hiện tại.
              </p>
            )}
            {selectedSlots.length > 0 && selectedBindableSlots.length === 0 && (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <AlertTriangle className="size-3.5" />
                  Block đang chọn không bind được
                </div>
              </div>
            )}
            {selectedBindableSlots.length > 0 && activePage && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {selectedBindableSlots.length} block đang chọn · page {activePageIdx + 1}
                    {selectedTextSlots.length > 0 && ` · ${selectedTextSlots.length} text`}
                    {selectedImageSlots.length > 0 && ` · ${selectedImageSlots.length} image`}
                  </span>
                </div>
                {selectedTextSlots.length > 0 && (
                  <div>
                    <Label className="text-xs">
                      Trường text{" "}
                      {selectedTextSlots.length > 1 ? `(${selectedTextSlots.length} block)` : ""}
                    </Label>
                    <Select
                      value={commonBindingValue(selectedTextSlots)}
                      onValueChange={(v) =>
                        applyBindingToSlots(
                          selectedTextSlots,
                          activePage.pageTemplateId,
                          v === "_static" ? undefined : v,
                        )
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
                      {selectedImageSlots.length > 1 ? `(${selectedImageSlots.length} block)` : ""}
                    </Label>
                    <Select
                      value={commonBindingValue(selectedImageSlots)}
                      onValueChange={(v) =>
                        applyBindingToSlots(
                          selectedImageSlots,
                          activePage.pageTemplateId,
                          v === "_static" ? undefined : v,
                        )
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
                    onClick={() =>
                      clearBindingsForSlots(selectedBindableSlots, activePage.pageTemplateId)
                    }
                  >
                    <Link2Off className="size-3 mr-1" /> Xoá liên kết đã chọn
                  </Button>
                )}
                {selectedSlot?.bindingPath && previewEntity && (
                  <div className="border-t pt-3 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Preview "{previewEntity.name}"
                    </Label>
                    {getSlotBindMode(selectedSlot) === "text" ? (
                      <div className="text-sm border rounded p-2 bg-muted/30 break-words">
                        {resolveTextBinding(
                          selectedSlot.bindingPath,
                          previewEntity,
                          selectedSlot.staticText,
                        ) || <span className="text-muted-foreground italic">(trống)</span>}
                      </div>
                    ) : (
                      (() => {
                        const r = resolveImageBinding(
                          selectedSlot.bindingPath,
                          previewEntity,
                          assets,
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

            <div className="border-t pt-3">
              <SheetFieldsPanel
                entities={entities}
                sheetOptions={sheetOptions}
                selectedSheet={selectedSheet}
                onSelectSheet={handleSelectSheet}
                selectedSlots={selectedSlots}
                previewEntity={previewEntity}
                onBindToSelectedSlot={(path, isImageLike) => {
                  if (!activePage) return;
                  const targets = isImageLike ? selectedImageSlots : selectedTextSlots;
                  if (targets.length === 0) return;
                  applyBindingToSlots(targets, activePage.pageTemplateId, path);
                  toast.success(`Đã bind ${targets.length} block: ${path}`);
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kết quả render */}
      {currentJob && currentJob.pages.length > 0 && (
        <>
          <Card className="mb-4">
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <Badge variant="outline">{currentJob.pages.length} page</Badge>
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
                <Package className="size-4 mr-2" /> Export ZIP
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {bundleGroups.map((bundle) => (
              <div key={bundle.bundleIndex} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">{bundle.bundleLabel}</h2>
                  <Badge variant="outline">{bundle.pages.length} page</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const files: Array<{ name: string; blob: Blob }> = [];
                      for (const meta of bundle.pages) {
                        const { node, cleanup } = await renderPackPageOffDom(meta.page);
                        try {
                          const blob = await nodeToPngBlob(node, 2);
                          files.push({ name: meta.page.pageFile, blob });
                        } finally {
                          cleanup();
                        }
                      }
                      if (jobPack && currentJob) {
                        const bundleJob = {
                          ...currentJob,
                          pages: bundle.pages.map((meta) => meta.page),
                        };
                        const caption = generateCaptions({
                          job: bundleJob,
                          pack: jobPack,
                          entities,
                          count: 1,
                        })[0];
                        const captionText = caption
                          ? `${caption.headline}\n\n${caption.body}\n\n${caption.hashtags.join(" ")}`
                          : "";
                        files.push({
                          name: "caption.txt",
                          blob: new Blob([captionText], { type: "text/plain;charset=utf-8" }),
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
                      <Card key={page.pageIndex} className={page.selected ? "border-primary" : ""}>
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
                                entityPool={buildOrderedEntityPool(page.entityId)}
                                scale={previewScale}
                                debug={debug}
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
                              <Type className="size-3 mr-1" /> Edit page
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={async () => {
                                const { node, cleanup } = await renderPackPageOffDom(page);
                                try {
                                  const blob = await nodeToPngBlob(node, 2);
                                  saveBlob(blob, page.pageFile);
                                } finally {
                                  cleanup();
                                }
                              }}
                            >
                              <Download className="size-3 mr-1" /> Export PNG
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

      {!currentJob && packPages.length > 0 && (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 mb-2 text-foreground font-medium">
              <Filter className="size-4" /> Sẵn sàng generate
            </div>
            <p>
              Đã có {packPages.length} page trong pack. Bind data cho từng page (hoặc bấm "AI tất
              cả"), chọn entity, rồi bấm <b>Generate</b> để tạo{" "}
              {mode === "one-entity-per-pack"
                ? `${filteredEntities.length} × ${packPages.length} = ${filteredEntities.length * packPages.length}`
                : packPages.length}{" "}
              trang.
            </p>
          </CardContent>
        </Card>
      )}

      {editingJobPage && editingJobPageBaseTemplate && editingJobPageTemplate && (
        <GeneratePageEditor
          open={!!editingJobPage}
          onOpenChange={(open) => {
            if (!open) setEditingPageIndex(null);
          }}
          title={`Edit page · ${editingJobPage.pageFile}`}
          template={editingJobPageTemplate}
          baseTemplate={editingJobPageBaseTemplate}
          entities={entities}
          assets={assets}
          entity={
            editingJobPage.entityId
              ? entities.find((entity) => entity.entityId === editingJobPage.entityId)
              : undefined
          }
          entityPool={buildOrderedEntityPool(editingJobPage.entityId)}
          slotItems={editingJobPage.items}
          onApply={(nextTemplate) => {
            updatePage(editingJobPage.pageIndex, (page) => ({
              ...page,
              workingTemplate: nextTemplate ?? undefined,
            }));
          }}
        />
      )}

      <SuggestBindingsModal
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        suggestions={suggestions}
        slots={effectiveActive?.slots ?? []}
        onApply={applyAiSuggestions}
      />
    </>
  );
}
