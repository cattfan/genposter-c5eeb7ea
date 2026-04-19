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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { generatePackJob } from "@/engines/selection/generate";
import { useJobStore } from "@/features/generate/jobStore";
import { PageRenderer } from "@/features/render/PageRenderer";
import { nodeToPngBlob, downloadPng, downloadZip } from "@/features/render/exportPng";
import { Sparkles, Download, Package, Eye, EyeOff } from "lucide-react";
import type { Entity } from "@/models";
import { slotHasBinding } from "@/engines/binding/dataBinding";

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
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [onlyPartner, setOnlyPartner] = useState(false);
  const [entityPages, setEntityPages] = useState<
    Array<{ entityId: string; selected: boolean }>
  >([]);
  const entityRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const selectedTpl = tpls?.find((t) => t.pageTemplateId === tplId);

  const filteredEntities: Entity[] = useMemo(() => {
    if (!entities) return [];
    return entities.filter((e) => {
      if (e.status !== "active") return false;
      if (onlyPartner && !e.partnerFlag) return false;
      if (filterCategory && !((e.categoryMain ?? "") + "/" + (e.categorySub ?? ""))
        .toLowerCase()
        .includes(filterCategory.toLowerCase())) return false;
      return true;
    });
  }, [entities, onlyPartner, filterCategory]);

  const hasAnyBinding = !!selectedTpl?.slots.some(slotHasBinding);

  const generateByEntity = () => {
    if (!selectedTpl) return toast.error("Chưa chọn template");
    if (!hasAnyBinding) {
      // template tĩnh: chỉ render 1 page
      setEntityPages([{ entityId: "_static", selected: true }]);
      toast.info("Template không có block bind → render 1 trang tĩnh");
      return;
    }
    if (filteredEntities.length === 0) return toast.error("Không có entity phù hợp");
    setEntityPages(filteredEntities.map((e) => ({ entityId: e.entityId, selected: true })));
    toast.success(`Đã tạo ${filteredEntities.length} trang`);
  };

  const exportEntityZip = async () => {
    if (!selectedTpl) return;
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
    await downloadZip(files, `${selectedTpl.name}-entities.zip`);
    toast.success("Đã export ZIP");
  };

  return (
    <div className="p-8 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">Tạo nội dung</h1>

      <Tabs defaultValue="entity" className="mb-6">
        <TabsList>
          <TabsTrigger value="entity">⚡ Generate theo entity (đơn giản)</TabsTrigger>
          <TabsTrigger value="pack">📦 Pack template (nâng cao)</TabsTrigger>
        </TabsList>

        {/* === TAB: theo entity === */}
        <TabsContent value="entity" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Page template</label>
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
                  <label className="text-xs text-muted-foreground">Lọc category (chứa...)</label>
                  <Input
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    placeholder="vd: cafe, quan_an"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={onlyPartner} onCheckedChange={(v) => setOnlyPartner(!!v)} />
                    Chỉ entity đối tác
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>Đối tượng phù hợp: <b className="text-foreground">{filteredEntities.length}</b></span>
                {selectedTpl && (
                  <span>
                    Block đã liên kết: <b className="text-foreground">{selectedTpl.slots.filter(slotHasBinding).length}</b>/{selectedTpl.slots.length}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={generateByEntity} disabled={!tplId}>
                  <Sparkles className="size-4 mr-2" /> Generate
                </Button>
                <Button variant="outline" onClick={() => setDebug((d) => !d)}>
                  {debug ? <EyeOff className="size-4 mr-2" /> : <Eye className="size-4 mr-2" />}
                  {debug ? "Tắt debug" : "Bật debug"}
                </Button>
                {entityPages.length > 0 && (
                  <Button onClick={exportEntityZip} className="ml-auto">
                    <Package className="size-4 mr-2" /> Export ZIP ({entityPages.filter((p) => p.selected).length})
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedTpl && entityPages.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {entityPages.map((p, idx) => {
                const ent = entities?.find((e) => e.entityId === p.entityId);
                const previewScale = 320 / selectedTpl.canvas.width;
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
                              {ent?.categoryMain ?? selectedTpl.name}
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
                            template={selectedTpl}
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
              <CardContent className="p-10 text-center text-muted-foreground space-y-2">
                <p>1️⃣ Chọn 1 page template đã có các block "🔗 liên kết" với entity field.</p>
                <p>2️⃣ Lọc danh sách entity (theo category, đối tác).</p>
                <p>3️⃣ Bấm Generate — mỗi entity sẽ tạo 1 trang riêng, các block tĩnh giữ nguyên.</p>
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
                            {p.warnings.slice(0, 3).map((w, i) => <div key={i}>⚠ {w}</div>)}
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

          {!currentJob && (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                Chọn 1 pack rồi bấm Generate để xem preview các page.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
