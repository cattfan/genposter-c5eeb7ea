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
import { nodeToPngBlob, downloadPng, downloadZip } from "@/features/render/exportPng";
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
} from "lucide-react";
import type { Entity, Slot } from "@/models";
import {
  TEXT_BINDING_OPTIONS,
  IMAGE_BINDING_OPTIONS,
  resolveImageBinding,
  resolveTextBinding,
} from "@/engines/binding/dataBinding";
import { BindCanvas } from "@/features/generate/BindCanvas";
import { useBindOverrides, useEffectiveTemplate } from "@/features/generate/useBindOverrides";

export const Route = createFileRoute("/generate")({
  component: GeneratePage,
});

function GeneratePage() {
  const packs = useLiveQuery(() => db.packTemplates.toArray(), []);
  const tpls = useLiveQuery(() => db.pageTemplates.toArray(), []);
  const entities = useLiveQuery(() => db.entities.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  const overrides = useLiveQuery(() => db.overrides.toArray(), []);

  const [packId, setPackId] = useState<string | undefined>(undefined);
  const [debug, setDebug] = useState(false);
  const [filter, setFilter] = useState<"all" | "selected" | "errors" | "partner">("all");
  const { currentJob, setJob, toggleSelected, setSelectedAll } = useJobStore();
  const renderRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const selectedPack = packs?.find((p) => p.packTemplateId === packId);

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
  const [selectedSheet, setSelectedSheet] = useState<string>("__all__");
  const [filterMoHinh, setFilterMoHinh] = useState<string>("__all__");
  const [filterPhongCach, setFilterPhongCach] = useState<string>("__all__");
  const [prioritizePartner, setPrioritizePartner] = useState(true);
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [maxPages, setMaxPages] = useState<number>(50);
  const [entityPages, setEntityPages] = useState<
    Array<{ entityId: string; selected: boolean }>
  >([]);
  const entityRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [previewEntityId, setPreviewEntityId] = useState<string | undefined>(undefined);
  const { overrides: bindOverrides, setBinding, clearBinding, resetAll } = useBindOverrides();

  const selectedTpl = tpls?.find((t) => t.pageTemplateId === tplId);
  const effectiveTpl = useEffectiveTemplate(selectedTpl, bindOverrides);

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
  }, [entities, selectedSheet, filterMoHinh, filterPhongCach, onlyPartner, prioritizePartner, maxPages]);

  // Reset chọn slot & preview entity khi đổi template
  useEffect(() => {
    setSelectedSlotId(null);
    resetAll();
  }, [tplId, resetAll]);

  // Auto chọn entity preview đầu tiên
  useEffect(() => {
    if (!previewEntityId && filteredEntities[0]) setPreviewEntityId(filteredEntities[0].entityId);
    if (previewEntityId && !filteredEntities.find((e) => e.entityId === previewEntityId)) {
      setPreviewEntityId(filteredEntities[0]?.entityId);
    }
  }, [filteredEntities, previewEntityId]);

  const previewEntity = entities?.find((e) => e.entityId === previewEntityId);
  const selectedSlot: Slot | undefined = effectiveTpl?.slots.find((s) => s.slotId === selectedSlotId);
  const boundCount = effectiveTpl?.slots.filter((s) => !!s.bindingPath).length ?? 0;
  const hasAnyBinding = boundCount > 0;

  const generateByEntity = () => {
    if (!effectiveTpl) return toast.error("Chưa chọn template");
    if (!hasAnyBinding) {
      setEntityPages([{ entityId: "_static", selected: true }]);
      toast.info("Chưa bind block nào → render 1 trang tĩnh");
      return;
    }
    if (filteredEntities.length === 0) return toast.error("Không có entity phù hợp");
    setEntityPages(filteredEntities.map((e) => ({ entityId: e.entityId, selected: true })));
    toast.success(`Đã tạo ${filteredEntities.length} trang`);
  };

  const exportEntityZip = async () => {
    if (!effectiveTpl) return;
    const sel = entityPages.filter((p) => p.selected);
    if (sel.length === 0) return toast.error("Chưa chọn trang nào");
    toast.info(`Đang export ${sel.length} trang...`);
    const files: Array<{ name: string; blob: Blob }> = [];
    for (const p of sel) {
      const node = entityRefs.current.get(p.entityId);
      if (!node) continue;
      const ent = entities?.find((e) => e.entityId === p.entityId);
      const slug = (ent?.name ?? p.entityId).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      const blob = await nodeToPngBlob(node, 2);
      files.push({ name: `${slug || p.entityId}.png`, blob });
    }
    await downloadZip(files, `${effectiveTpl.name}-entities.zip`);
    toast.success("Đã export ZIP");
  };

  // Tính scale canvas tương tác theo container ~640px max
  const canvasScale = effectiveTpl ? Math.min(640 / effectiveTpl.canvas.width, 720 / effectiveTpl.canvas.height) : 0.5;

  return (
    <div className="p-8 max-w-[1600px]">
      <h1 className="text-3xl font-bold mb-6">Tạo nội dung</h1>

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
                    <SelectTrigger><SelectValue placeholder="Chọn template..." /></SelectTrigger>
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
                  <Select value={selectedSheet} onValueChange={(v) => { setSelectedSheet(v); setFilterMoHinh("__all__"); setFilterPhongCach("__all__"); }}>
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
                  <Label className="text-xs">Lọc Mô hình (Mo_hinh)</Label>
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
                  <Label className="text-xs">Lọc Phong cách (Phong_cach)</Label>
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
                  <Checkbox checked={prioritizePartner} onCheckedChange={(v) => setPrioritizePartner(!!v)} />
                  Ưu tiên đối tác (xếp lên đầu)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={onlyPartner} onCheckedChange={(v) => setOnlyPartner(!!v)} />
                  Chỉ entity đối tác
                </label>
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
                    <b className="text-foreground">{boundCount}/{effectiveTpl?.slots.length ?? 0}</b>
                  </div>
                </div>
                {filteredEntities.length > 0 && (
                  <div>
                    <Label className="text-xs">Xem trước với entity</Label>
                    <Select value={previewEntityId} onValueChange={setPreviewEntityId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {filteredEntities.map((e) => (
                          <SelectItem key={e.entityId} value={e.entityId}>
                            {e.partnerFlag ? "★ " : ""}{e.name}
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
                      <Package className="size-4 mr-2" /> Export ZIP ({entityPages.filter((p) => p.selected).length})
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
                {Object.keys(bindOverrides).length > 0 && (
                  <Button size="sm" variant="ghost" onClick={resetAll} className="h-7 text-xs">
                    <Link2Off className="size-3 mr-1" /> Reset bind
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {!effectiveTpl ? (
                  <div className="border border-dashed rounded-lg h-[480px] grid place-items-center text-muted-foreground text-sm">
                    Chọn template để bắt đầu
                  </div>
                ) : (
                  <div className="bg-muted/30 rounded-lg p-4 grid place-items-center overflow-auto" style={{ minHeight: 480 }}>
                    <BindCanvas
                      template={effectiveTpl}
                      scale={canvasScale}
                      selectedSlotId={selectedSlotId}
                      onSelectSlot={setSelectedSlotId}
                      entity={previewEntity}
                      assets={assets ?? []}
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
                {!selectedSlot && (
                  <p className="text-xs text-muted-foreground">
                    Chọn 1 block (text hoặc image) trên canvas để gán trường data.
                  </p>
                )}
                {selectedSlot && selectedSlot.kind !== "text" && selectedSlot.kind !== "image" && (
                  <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <AlertTriangle className="size-3.5" />
                      Block "{selectedSlot.kind}" là khối trang trí
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Shape / section dùng để tạo nền, viền, khung trang trí — không có dữ liệu để đổ vào. Chỉ block <b>text</b> và <b>image</b> mới liên kết được trường data.
                    </p>
                  </div>
                )}
                {selectedSlot && (selectedSlot.kind === "text" || selectedSlot.kind === "image") && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {selectedSlot.kind === "text" ? <Type className="size-3" /> : <ImageIcon className="size-3" />}
                      <span>Block {selectedSlot.kind}</span>
                    </div>
                    <div>
                      <Label className="text-xs">Trường dữ liệu</Label>
                      <Select
                        value={selectedSlot.bindingPath ?? "_static"}
                        onValueChange={(v) => setBinding(selectedSlot.slotId, v === "_static" ? undefined : v)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(selectedSlot.kind === "text" ? TEXT_BINDING_OPTIONS : IMAGE_BINDING_OPTIONS).map((o) => (
                            <SelectItem key={o.value || "_static"} value={o.value || "_static"}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedSlot.bindingPath && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => clearBinding(selectedSlot.slotId)}
                      >
                        <Link2Off className="size-3 mr-1" /> Xoá liên kết
                      </Button>
                    )}
                    {/* Preview giá trị thực */}
                    {selectedSlot.bindingPath && previewEntity && (
                      <div className="border-t pt-3 space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Preview với "{previewEntity.name}"
                        </Label>
                        {selectedSlot.kind === "text" ? (
                          <div className="text-sm border rounded p-2 bg-muted/30 break-words">
                            {resolveTextBinding(selectedSlot.bindingPath, previewEntity, selectedSlot.staticText) || (
                              <span className="text-muted-foreground italic">(trống)</span>
                            )}
                          </div>
                        ) : (
                          (() => {
                            const r = resolveImageBinding(
                              selectedSlot.bindingPath,
                              previewEntity,
                              assets ?? [],
                              selectedSlot.staticImage,
                            );
                            return r.src ? (
                              <img src={r.src} alt="" className="w-full h-32 object-cover rounded border" />
                            ) : (
                              <div className="border rounded p-2 text-xs text-muted-foreground">(không có ảnh phù hợp)</div>
                            );
                          })()
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Kết quả render */}
          {effectiveTpl && entityPages.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {entityPages.map((p, idx) => {
                const ent = entities?.find((e) => e.entityId === p.entityId);
                const previewScale = 320 / effectiveTpl.canvas.width;
                return (
                  <Card key={p.entityId + idx} className={p.selected ? "border-primary" : ""}>
                    <CardHeader className="p-3 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <Checkbox
                            checked={p.selected}
                            onCheckedChange={() => setEntityPages((ps) =>
                              ps.map((x, i) => i === idx ? { ...x, selected: !x.selected } : x))}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">
                              {ent?.name ?? "(Template tĩnh)"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {ent?.categoryMain ?? effectiveTpl.name}
                            </div>
                          </div>
                        </div>
                        {ent?.partnerFlag && <Badge>Đối tác</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 space-y-2">
                      <div className="overflow-hidden rounded border bg-muted/30">
                        <div ref={(el) => { if (el) entityRefs.current.set(p.entityId, el); }}>
                          <PageRenderer
                            template={effectiveTpl}
                            entities={entities ?? []}
                            assets={assets ?? []}
                            entity={ent}
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
                          const node = entityRefs.current.get(p.entityId);
                          if (!node) return;
                          const slug = (ent?.name ?? p.entityId).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
                          await downloadPng(node, `${slug || p.entityId}.png`, 2);
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
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">1</span>
                    <span className="flex items-center gap-1.5"><MousePointerClick className="size-4" /> Click vào các block trên canvas để gán trường data từ entity.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">2</span>
                    <span className="flex items-center gap-1.5"><Filter className="size-4" /> Lọc danh sách entity (theo category, đối tác).</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="size-6 shrink-0 rounded-full bg-muted text-foreground grid place-items-center text-xs font-semibold">3</span>
                    <span className="flex items-center gap-1.5"><Sparkles className="size-4" /> Bấm Generate — mỗi entity sẽ tạo 1 trang riêng, các block không bind giữ nguyên nội dung tĩnh.</span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* === TAB: theo pack (luồng cũ) === */}
        <TabsContent value="pack" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <label className="text-xs text-muted-foreground">Pack template</label>
                <Select value={packId} onValueChange={setPackId}>
                  <SelectTrigger><SelectValue placeholder="Chọn pack..." /></SelectTrigger>
                  <SelectContent>
                    {packs?.map((p) => (
                      <SelectItem key={p.packTemplateId} value={p.packTemplateId}>
                        {p.name} ({p.orderedPages.length} page)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={onGenerate} disabled={!packId}>
                <Sparkles className="size-4 mr-2" /> Generate
              </Button>
              <Button variant="outline" onClick={() => setDebug((d) => !d)}>
                {debug ? <EyeOff className="size-4 mr-2" /> : <Eye className="size-4 mr-2" />}
                {debug ? "Tắt debug" : "Bật debug"}
              </Button>
            </CardContent>
          </Card>

          {currentJob && (
            <>
              <Card className="mb-4">
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <Badge variant="outline">{currentJob.pages.length} page</Badge>
                  <Badge variant="secondary">{currentJob.pages.filter((p) => p.selected).length} đã chọn</Badge>
                  <div className="flex-1" />
                  <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "selected" | "errors" | "partner")}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả</SelectItem>
                      <SelectItem value="selected">Đang chọn</SelectItem>
                      <SelectItem value="errors">Có cảnh báo</SelectItem>
                      <SelectItem value="partner">Có đối tác</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => setSelectedAll(true)}>Chọn hết</Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedAll(false)}>Bỏ chọn hết</Button>
                  <Button onClick={exportZip}>
                    <Package className="size-4 mr-2" /> Export ZIP
                  </Button>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPages?.map((p) => {
                  const tpl = tpls?.find((t) => t.pageTemplateId === p.pageTemplateId);
                  if (!tpl) return null;
                  const previewScale = 320 / tpl.canvas.width;
                  return (
                    <Card key={p.pageIndex} className={p.selected ? "border-primary" : ""}>
                      <CardHeader className="p-3 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <Checkbox checked={p.selected} onCheckedChange={() => toggleSelected(p.pageIndex)} />
                            <div className="min-w-0">
                              <div className="font-semibold text-sm truncate">{tpl.name}</div>
                              <div className="text-xs text-muted-foreground">{p.pageFile}</div>
                            </div>
                          </div>
                          <Badge variant={p.healthScore >= 80 ? "default" : p.healthScore >= 50 ? "secondary" : "destructive"}>
                            {p.healthScore}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 pt-0 space-y-2">
                        <div className="overflow-hidden rounded border bg-muted/30">
                          <div ref={(el) => { if (el) renderRefs.current.set(p.pageIndex, el); }}>
                            <PageRenderer
                              template={tpl}
                              page={p}
                              entities={entities ?? []}
                              assets={assets ?? []}
                              scale={previewScale}
                              debug={debug}
                            />
                          </div>
                        </div>
                        {p.warnings.length > 0 && (
                          <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 p-2 rounded space-y-0.5">
                            {p.warnings.slice(0, 3).map((w, i) => (
                              <div key={i} className="flex items-start gap-1">
                                <AlertTriangle className="size-3 mt-0.5 shrink-0" /> <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={async () => {
                            const node = renderRefs.current.get(p.pageIndex);
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
