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
import { SuggestBindingsModal, type BindSuggestion } from "@/features/ai/SuggestBindingsModal";
import { aiSuggestBindings } from "@/features/ai/aiFeatures";
import { generatePackJob, type PackBindMode } from "@/engines/selection/generate";
import {
  usePackBindOverrides,
  applyPackOverridesToTemplate,
} from "@/features/generate/usePackBindOverrides";
import { nodeToPngBlob, downloadPng, downloadZip } from "@/features/render/exportPng";
import { db } from "@/storage/db";

type Filter = "all" | "selected" | "errors" | "partner";

interface Props {
  packs: PackTemplate[];
  tpls: PageTemplate[];
  entities: Entity[];
  assets: Asset[];
  currentJob: GenerationJob | null | undefined;
  setJob: (j: GenerationJob) => void;
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
  const [selectedSheet, setSelectedSheet] = useState<string>("__all__");
  const [filterMoHinh, setFilterMoHinh] = useState<string>("__all__");
  const [filterPhongCach, setFilterPhongCach] = useState<string>("__all__");
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [maxEntities, setMaxEntities] = useState<number>(10);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<BindSuggestion[]>([]);
  const [suggestPageId, setSuggestPageId] = useState<string | null>(null);
  const packRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const { all: packOv, setBinding, clearBinding, resetPage, resetAll, replacePage } =
    usePackBindOverrides();

  const selectedPack = packs.find((p) => p.packTemplateId === packId);
  const packPages: PageTemplate[] = useMemo(() => {
    if (!selectedPack) return [];
    const map = new Map(tpls.map((t) => [t.pageTemplateId, t]));
    return selectedPack.orderedPages
      .map((id) => map.get(id))
      .filter((t): t is PageTemplate => !!t);
  }, [selectedPack, tpls]);

  const activePage = packPages[activePageIdx];
  const effectiveActive = useMemo(
    () => (activePage ? applyPackOverridesToTemplate(activePage, packOv) : undefined),
    [activePage, packOv],
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
  }, [entities, selectedSheet, filterMoHinh, filterPhongCach, onlyPartner, prioritizePartner, maxEntities]);

  // Reset slot khi đổi pack/page
  useEffect(() => {
    setSelectedSlotId(null);
    setActivePageIdx(0);
  }, [packId]);
  useEffect(() => {
    setSelectedSlotId(null);
  }, [activePageIdx]);
  useEffect(() => {
    if (!previewEntityId && filteredEntities[0]) setPreviewEntityId(filteredEntities[0].entityId);
    if (previewEntityId && !filteredEntities.find((e) => e.entityId === previewEntityId))
      setPreviewEntityId(filteredEntities[0]?.entityId);
  }, [filteredEntities, previewEntityId]);

  const previewEntity = entities.find((e) => e.entityId === previewEntityId);
  const selectedSlot: Slot | undefined = effectiveActive?.slots.find(
    (s) => s.slotId === selectedSlotId,
  );
  const totalBound = useMemo(
    () =>
      packPages.reduce(
        (acc, t) =>
          acc +
          applyPackOverridesToTemplate(t, packOv).slots.filter((s) => !!s.bindingPath).length,
        0,
      ),
    [packPages, packOv],
  );

  const dataColumns = useMemo(() => {
    const set = new Set<string>();
    entities.slice(0, 50).forEach((e) => {
      ["name", "address", "phone", "priceRange", "style", "openingHours", "categoryMain", "categorySub"].forEach((k) => {
        const v = (e as unknown as Record<string, unknown>)[k];
        if (v != null && v !== "") set.add(k);
      });
      if (e.metadata) Object.keys(e.metadata).forEach((k) => set.add("metadata." + k));
    });
    return Array.from(set);
  }, [entities]);

  const usedTextBindingsActive = useMemo(() => {
    const set = new Set<string>();
    if (!effectiveActive || !selectedSlot) return set;
    for (const s of effectiveActive.slots) {
      if (s.kind !== "text") continue;
      if (s.slotId === selectedSlot.slotId) continue;
      if (s.bindingPath) set.add(s.bindingPath);
    }
    return set;
  }, [effectiveActive, selectedSlot]);

  const runAiSuggest = async (forAllPages: boolean) => {
    if (!packPages.length) return toast.error("Pack chưa có page");
    setAiBusy(true);
    try {
      if (forAllPages) {
        // Loop từng page, áp luôn (không mở modal)
        let total = 0;
        for (const tpl of packPages) {
          const eff = applyPackOverridesToTemplate(tpl, packOv);
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

  const onGenerate = () => {
    if (!selectedPack) return toast.error("Chưa chọn pack");
    if (filteredEntities.length === 0) return toast.error("Không có entity phù hợp");
    const job = generatePackJob({
      pack: selectedPack,
      pageTemplates: tpls,
      entities,
      assets,
      mode,
      entityPool: filteredEntities,
      bindOverrides: packOv,
    });
    setJob(job);
    toast.success(`Đã tạo ${job.pages.length} page`);
  };

  const filteredPages = currentJob?.pages.filter((p) => {
    if (filter === "selected") return p.selected;
    if (filter === "errors") return p.warnings.length > 0 || p.state === "rejected";
    if (filter === "partner") {
      const ent = entities.find((e) => e.entityId === p.entityId);
      return !!ent?.partnerFlag;
    }
    return true;
  });

  const exportZip = async () => {
    if (!currentJob) return;
    const sel = currentJob.pages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn page nào");
    toast.info(`Đang export ${sel.length} page...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const node = packRefs.current.get(p.pageIndex);
      if (!node) continue;
      const blob = await nodeToPngBlob(node, 2);
      files.push({ name: p.pageFile, blob });
    }
    await downloadZip(files, `${currentJob.packTemplateName}.zip`);
    await db.jobs.put({ ...currentJob, status: "exported" });
    toast.success("Đã export ZIP & lưu job");
  };

  const canvasScale = effectiveActive
    ? Math.min(560 / effectiveActive.canvas.width, 700 / effectiveActive.canvas.height)
    : 0.5;

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
                <SelectTrigger><SelectValue placeholder="Chọn pack..." /></SelectTrigger>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="one-entity-per-pack">
                    1 entity / nguyên pack
                  </SelectItem>
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
              <Select
                value={selectedSheet}
                onValueChange={(v) => {
                  setSelectedSheet(v);
                  setFilterMoHinh("__all__");
                  setFilterPhongCach("__all__");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả</SelectItem>
                  {sheetOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Mô hình</Label>
              <Select value={filterMoHinh} onValueChange={setFilterMoHinh}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả</SelectItem>
                  {moHinhOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Phong cách</Label>
              <Select value={filterPhongCach} onValueChange={setFilterPhongCach}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Tất cả</SelectItem>
                  {phongCachOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Button
                variant="outline"
                onClick={() => setDebug((d) => !d)}
                className="w-full"
              >
                {debug ? <EyeOff className="size-4 mr-2" /> : <Eye className="size-4 mr-2" />}
                {debug ? "Tắt debug" : "Bật debug"}
              </Button>
              {Object.keys(packOv).length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetAll}
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
                {aiBusy ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Wand2 className="size-3 mr-1" />}
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
                      selectedSlotId={selectedSlotId}
                      onSelectSlot={setSelectedSlotId}
                      entity={previewEntity}
                      assets={assets}
                      entityPool={filteredEntities}
                    />
                  </div>
                )}

                {filteredEntities.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Preview với</Label>
                    <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {filteredEntities.map((e) => (
                          <SelectItem key={e.entityId} value={e.entityId}>
                            {e.partnerFlag ? "★ " : ""}{e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activePage && packOv[activePage.pageTemplateId] &&
                      Object.keys(packOv[activePage.pageTemplateId]).length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetPage(activePage.pageTemplateId)}
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
            {!selectedSlot && (
              <p className="text-xs text-muted-foreground">
                Chọn 1 block trên canvas để gán trường data cho page hiện tại.
              </p>
            )}
            {selectedSlot &&
              selectedSlot.kind !== "text" &&
              selectedSlot.kind !== "image" &&
              selectedSlot.kind !== "shape" && (
                <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <AlertTriangle className="size-3.5" />
                    Block "{selectedSlot.kind}" không bind được
                  </div>
                </div>
              )}
            {selectedSlot &&
              activePage &&
              (selectedSlot.kind === "text" ||
                selectedSlot.kind === "image" ||
                selectedSlot.kind === "shape") && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selectedSlot.kind === "text" ? (
                      <Type className="size-3" />
                    ) : (
                      <ImageIcon className="size-3" />
                    )}
                    <span>Block {selectedSlot.kind} · page {activePageIdx + 1}</span>
                  </div>
                  <div>
                    <Label className="text-xs">Trường dữ liệu</Label>
                    <Select
                      value={selectedSlot.bindingPath ?? "_static"}
                      onValueChange={(v) =>
                        setBinding(
                          activePage.pageTemplateId,
                          selectedSlot.slotId,
                          v === "_static" ? undefined : v,
                        )
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(selectedSlot.kind === "text"
                          ? TEXT_BINDING_OPTIONS
                          : IMAGE_BINDING_OPTIONS
                        ).map((o) => {
                          const isUsed =
                            selectedSlot.kind === "text" &&
                            o.value !== "" &&
                            usedTextBindingsActive.has(o.value);
                          return (
                            <SelectItem
                              key={o.value || "_static"}
                              value={o.value || "_static"}
                            >
                              {o.label}
                              {isUsed && (
                                <span className="ml-2 text-[10px] text-muted-foreground">(đã dùng ở slot khác)</span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedSlot.bindingPath && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => clearBinding(activePage.pageTemplateId, selectedSlot.slotId)}
                    >
                      <Link2Off className="size-3 mr-1" /> Xoá liên kết
                    </Button>
                  )}
                  {selectedSlot.bindingPath && previewEntity && (
                    <div className="border-t pt-3 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Preview "{previewEntity.name}"
                      </Label>
                      {selectedSlot.kind === "text" ? (
                        <div className="text-sm border rounded p-2 bg-muted/30 break-words">
                          {resolveTextBinding(
                            selectedSlot.bindingPath,
                            previewEntity,
                            selectedSlot.staticText,
                          ) || (
                            <span className="text-muted-foreground italic">(trống)</span>
                          )}
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
                onSelectSheet={(s) => {
                  setSelectedSheet(s);
                  setFilterMoHinh("__all__");
                  setFilterPhongCach("__all__");
                }}
                selectedSlot={selectedSlot}
                previewEntity={previewEntity}
                onBindToSelectedSlot={(path) => {
                  if (!selectedSlot || !activePage) return;
                  setBinding(activePage.pageTemplateId, selectedSlot.slotId, path);
                  toast.success(`Đã bind: ${path}`);
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
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPages?.map((p) => {
              const tpl = tpls.find((t) => t.pageTemplateId === p.pageTemplateId);
              if (!tpl) return null;
              const eff = applyPackOverridesToTemplate(tpl, packOv);
              const ent = p.entityId ? entities.find((e) => e.entityId === p.entityId) : undefined;
              const previewScale = 320 / eff.canvas.width;
              return (
                <Card key={p.pageIndex} className={p.selected ? "border-primary" : ""}>
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <Checkbox
                          checked={p.selected}
                          onCheckedChange={() => toggleSelected(p.pageIndex)}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">
                            {ent?.name ?? p.entityName ?? tpl.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {tpl.name} · {p.pageFile}
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
                          if (el) packRefs.current.set(p.pageIndex, el);
                        }}
                      >
                        <PageRenderer
                          template={eff}
                          page={p}
                          entities={entities}
                          assets={assets}
                          entity={ent}
                          entityPool={filteredEntities}
                          scale={previewScale}
                          debug={debug}
                        />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        const node = packRefs.current.get(p.pageIndex);
                        if (!node) return;
                        await downloadPng(node, p.pageFile, 2);
                      }}
                    >
                      <Download className="size-3 mr-1" /> Export PNG
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
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
              Đã có {packPages.length} page trong pack. Bind data cho từng page (hoặc bấm "AI tất cả"),
              chọn entity, rồi bấm <b>Generate</b> để tạo {mode === "one-entity-per-pack"
                ? `${filteredEntities.length} × ${packPages.length} = ${filteredEntities.length * packPages.length}`
                : packPages.length} trang.
            </p>
          </CardContent>
        </Card>
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
