import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  Sparkles,
  Loader2,
  CalendarPlus,
  Layers,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import type { PageTemplate } from "@/models";
import { PageRenderer } from "@/features/render/PageRenderer";
import {
  aiGenerateTemplateFromImage,
  aiGenerateComboFromImages,
  type LayoutFidelity,
} from "@/features/ai/aiFeatures";
import { aiLayoutToTemplate } from "@/features/ai/templateFromImage";
import { buildComboFromAiResult, persistCombo } from "@/features/ai/comboFromImages";
import { cloneDayPage } from "@/storage/seedFlex";
import type { Asset, Entity, RenderedItem } from "@/models";
import { PageContainer, PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

function duplicatePageTemplate(template: PageTemplate): PageTemplate {
  const copy = JSON.parse(JSON.stringify(template)) as PageTemplate;
  const pageTemplateId = nanoid();
  const slotIdMap = new Map(copy.slots.map((slot) => [slot.slotId, nanoid()]));
  const sectionIdMap = new Map(copy.sections.map((section) => [section.sectionId, nanoid()]));

  return {
    ...copy,
    pageTemplateId,
    name: `${copy.name} (copy)`,
    slots: copy.slots.map((slot) => ({
      ...slot,
      slotId: slotIdMap.get(slot.slotId) ?? nanoid(),
      pageId: slot.pageId ? pageTemplateId : undefined,
      sectionId: slot.sectionId ? (sectionIdMap.get(slot.sectionId) ?? slot.sectionId) : undefined,
      sectionRefId: slot.sectionRefId
        ? (sectionIdMap.get(slot.sectionRefId) ?? slot.sectionRefId)
        : undefined,
      groupId: slot.groupId ? (slotIdMap.get(slot.groupId) ?? slot.groupId) : undefined,
    })),
    sections: copy.sections.map((section) => ({
      ...section,
      sectionId: sectionIdMap.get(section.sectionId) ?? nanoid(),
      imageSlotId: section.imageSlotId
        ? (slotIdMap.get(section.imageSlotId) ?? section.imageSlotId)
        : undefined,
    })),
    cardGroups: copy.cardGroups?.map((group) => ({
      ...group,
      groupId: slotIdMap.get(group.groupId) ?? group.groupId,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function TemplatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tpls = useLiveQuery(() => db.pageTemplates.orderBy("updatedAt").reverse().toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const comboFileRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [singleOpen, setSingleOpen] = useState(false);
  const [singleFileName, setSingleFileName] = useState("");
  const [singlePreview, setSinglePreview] = useState("");
  const [singleTemplateName, setSingleTemplateName] = useState("");
  const [singleFidelity, setSingleFidelity] = useState<LayoutFidelity>("strict");
  const [singleInstructions, setSingleInstructions] = useState("");
  const [singlePreferVisibleLines, setSinglePreferVisibleLines] = useState(true);

  // Combo state
  const [comboOpen, setComboOpen] = useState(false);
  const [comboFiles, setComboFiles] = useState<File[]>([]);
  const [comboPreviews, setComboPreviews] = useState<string[]>([]);
  const [comboPackName, setComboPackName] = useState("");
  const [comboFidelity, setComboFidelity] = useState<LayoutFidelity>("strict");
  const [comboInstructions, setComboInstructions] = useState("");
  const [comboPreferVisibleLines, setComboPreferVisibleLines] = useState(true);
  const [comboBusy, setComboBusy] = useState(false);
  const [comboStep, setComboStep] = useState("");
  const [comboProgress, setComboProgress] = useState(0);

  if (location.pathname !== "/templates") {
    return <Outlet />;
  }

  const createNew = async () => {
    const id = nanoid();
    const tpl: PageTemplate = {
      pageTemplateId: id,
      name: "Page Template mới",
      type: "cover",
      canvas: { width: 1080, height: 1350, background: "#ffffff" },
      slots: [],
      sections: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.pageTemplates.put(tpl);
    toast.success("Đã tạo template mới — mở editor...");
    navigate({ to: "/templates/$id/edit", params: { id } });
  };

  const openEdit = (id: string) => {
    navigate({ to: "/templates/$id/edit", params: { id } });
  };

  // === AI gen template từ ảnh ===
  const onPickAiImage = () => fileRef.current?.click();

  const onAiImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 6_000_000) return toast.error("Ảnh > 6MB. Resize trước nhé.");
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Đọc ảnh lỗi"));
        r.readAsDataURL(f);
      });
      setSingleFileName(f.name);
      setSinglePreview(dataUrl);
      setSingleTemplateName("AI: " + f.name.replace(/\.[^.]+$/, ""));
      setSingleFidelity("strict");
      setSingleInstructions("");
      setSinglePreferVisibleLines(true);
      setSingleOpen(true);
    } catch (err) {
      toast.error("AI lỗi: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const startSingleImageGeneration = async () => {
    if (!singlePreview) return;
    setAiBusy(true);
    try {
      const out = await aiGenerateTemplateFromImage({
        imageDataUrl: singlePreview,
        fidelity: singleFidelity,
        customInstructions: singleInstructions,
        preferVisibleLines: singlePreferVisibleLines,
      });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      const layout = JSON.parse(out.layoutJson);
      const tpl = aiLayoutToTemplate(
        layout,
        singleTemplateName.trim() || "AI: " + singleFileName.replace(/\.[^.]+$/, ""),
      );
      await db.pageTemplates.put(tpl);
      toast.success("AI dựng xong — mở editor để chỉnh");
      setSingleOpen(false);
      setSinglePreview("");
      setSingleFileName("");
      setSingleTemplateName("");
      setSingleInstructions("");
      setSinglePreferVisibleLines(true);
      navigate({ to: "/templates/$id/edit", params: { id: tpl.pageTemplateId } });
    } catch (err) {
      toast.error("AI lỗi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiBusy(false);
    }
  };

  const onCloneDay = async (pageId: string) => {
    const dayStr = prompt("Nhân bản thành Ngày số mấy?", "2");
    if (!dayStr) return;
    const n = parseInt(dayStr, 10);
    if (!Number.isFinite(n) || n < 1) return toast.error("Số ngày không hợp lệ");
    try {
      const newId = await cloneDayPage(pageId, n);
      toast.success(`Đã tạo "Ngày ${n}"`);
      navigate({ to: "/templates/$id/edit", params: { id: newId } });
    } catch (e) {
      toast.error("Lỗi: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // === AI dựng combo từ nhiều ảnh ===
  const onPickComboImages = () => comboFileRef.current?.click();

  const onComboFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;
    // Validate
    const oversize = list.find((f) => f.size > 6_000_000);
    if (oversize) {
      toast.error(`Ảnh "${oversize.name}" > 6MB. Resize trước nhé.`);
      return;
    }
    const totalSize = list.reduce((a, f) => a + f.size, 0);
    if (totalSize > 25_000_000) {
      toast.error("Tổng dung lượng > 25MB. Bớt ảnh hoặc nén.");
      return;
    }
    const previews = await Promise.all(
      list.map(
        (f) =>
          new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result));
            r.onerror = () => rej(new Error("Đọc " + f.name + " lỗi"));
            r.readAsDataURL(f);
          }),
      ),
    );
    setComboFiles(list);
    setComboPreviews(previews);
    setComboPackName("");
    setComboFidelity("strict");
    setComboInstructions("");
    setComboPreferVisibleLines(true);
    setComboOpen(true);
  };

  const removeComboImage = (idx: number) => {
    setComboFiles((arr) => arr.filter((_, i) => i !== idx));
    setComboPreviews((arr) => arr.filter((_, i) => i !== idx));
  };

  const startCombo = async () => {
    if (comboPreviews.length === 0) return;
    setComboBusy(true);
    setComboStep(`Phân loại ${comboPreviews.length} ảnh...`);
    setComboProgress(10);
    try {
      const out = await aiGenerateComboFromImages({
        images: comboPreviews.map((dataUrl) => ({ dataUrl })),
        packNameHint: comboPackName.trim() || undefined,
        layoutFidelity: comboFidelity,
        customInstructions: comboInstructions.trim() || undefined,
        preferVisibleLines: comboPreferVisibleLines,
        onProgress: (step, progress) => {
          setComboStep(step);
          setComboProgress(progress);
        },
      });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      setComboStep(`Dựng ${out.pages.length} page → tạo pack...`);
      setComboProgress(80);
      const built = buildComboFromAiResult(
        { pages: out.pages, packMeta: out.packMeta },
        comboPackName,
      );
      const packId = await persistCombo(built);
      setComboProgress(100);
      if (out.warnings && out.warnings.length > 0) {
        toast.warning(`Có ${out.warnings.length} page lỗi — pack vẫn tạo được`);
      } else {
        toast.success(`Đã tạo pack "${built.pack.name}" (${built.pages.length} page)`);
      }
      setComboOpen(false);
      setComboFiles([]);
      setComboPreviews([]);
      setComboInstructions("");
      setComboPreferVisibleLines(true);
      navigate({ to: "/packs", search: { open: packId } });
    } catch (err) {
      toast.error("Lỗi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setComboBusy(false);
      setComboStep("");
      setComboProgress(0);
    }
  };

  return (
    <PageContainer>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAiImageChange} />
      <input
        ref={comboFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onComboFilesChange}
      />
      <PageHeader
        icon={<Layers className="size-5" />}
        title="Page Templates"
        description="Mỗi page template là 1 layout có thể ghép vào pack."
        actions={
          <>
            <Button variant="outline" onClick={onPickAiImage} disabled={aiBusy}>
              {aiBusy ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="size-4 mr-2" />
              )}
              AI dựng từ ảnh
            </Button>
            <Button variant="outline" onClick={onPickComboImages} disabled={aiBusy}>
              <Layers className="size-4 mr-2" /> AI dựng combo
            </Button>
            <Button onClick={createNew}>
              <Plus className="size-4 mr-2" /> Tạo mới
            </Button>
          </>
        }
      />

      <Dialog open={singleOpen} onOpenChange={(o) => !aiBusy && setSingleOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI dựng template từ ảnh</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {singlePreview && (
              <div className="overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={singlePreview}
                  alt={singleFileName}
                  className="max-h-[420px] w-full object-contain"
                />
              </div>
            )}

            <div>
              <Label>Tên template</Label>
              <Input
                value={singleTemplateName}
                onChange={(e) => setSingleTemplateName(e.target.value)}
                placeholder="AI: Ten-template"
                disabled={aiBusy}
              />
            </div>

            <div>
              <Label>Mức bám sát mẫu</Label>
              <Select
                value={singleFidelity}
                onValueChange={(value) => setSingleFidelity(value as LayoutFidelity)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">Bám sát mẫu</SelectItem>
                  <SelectItem value="balanced">Cân bằng</SelectItem>
                  <SelectItem value="creative">Sáng tạo nhẹ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Ghi chú cho AI</Label>
              <Textarea
                value={singleInstructions}
                onChange={(e) => setSingleInstructions(e.target.value)}
                placeholder="Ví dụ: giữ nền tối, title vàng nổi, ảnh bo góc đặt hai bên, chia danh sách thành nhiều cụm giống ảnh mẫu."
                className="mt-2 min-h-[110px]"
                disabled={aiBusy}
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={singlePreferVisibleLines}
                onCheckedChange={(checked) => setSinglePreferVisibleLines(checked === true)}
                disabled={aiBusy}
              />
              <div className="space-y-1">
                <div className="text-sm font-medium">Ưu tiên số dòng thật</div>
                <div className="text-xs text-muted-foreground">
                  Nếu ảnh mẫu nhìn thấy nhiều dòng item riêng biệt, AI sẽ cố giữ từng dòng thay vì
                  gom thành block lớn.
                </div>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSingleOpen(false)} disabled={aiBusy}>
              Huỷ
            </Button>
            <Button onClick={startSingleImageGeneration} disabled={aiBusy || !singlePreview}>
              {aiBusy ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="size-4 mr-2" />
              )}
              Dựng template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={comboOpen} onOpenChange={(o) => !comboBusy && setComboOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI dựng combo từ {comboPreviews.length} ảnh</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tên pack (để trống → AI tự đặt)</Label>
              <Input
                value={comboPackName}
                onChange={(e) => setComboPackName(e.target.value)}
                placeholder="Vd: Đà Lạt 4N3Đ"
                disabled={comboBusy}
              />
            </div>
            <div>
              <Label>Mức bám sát mẫu</Label>
              <Select
                value={comboFidelity}
                onValueChange={(value) => setComboFidelity(value as LayoutFidelity)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">Bám sát mẫu</SelectItem>
                  <SelectItem value="balanced">Cân bằng</SelectItem>
                  <SelectItem value="creative">Sáng tạo nhẹ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ghi chú cho AI</Label>
              <Textarea
                value={comboInstructions}
                onChange={(e) => setComboInstructions(e.target.value)}
                placeholder="Ví dụ: giữ đúng kiểu poster nền tối, title vàng nổi, 3-4 ảnh bo góc floating quanh canvas, danh sách bullet chia nhiều cụm như ảnh mẫu."
                className="mt-2 min-h-[110px]"
                disabled={comboBusy}
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={comboPreferVisibleLines}
                onCheckedChange={(checked) => setComboPreferVisibleLines(checked === true)}
                disabled={comboBusy}
              />
              <div className="space-y-1">
                <div className="text-sm font-medium">Ưu tiên số dòng thật</div>
                <div className="text-xs text-muted-foreground">
                  Khi bộ ảnh là poster bullet-list, AI sẽ giữ line-level rõ hơn để draft không bị
                  rơi về item-group generic.
                </div>
              </div>
            </label>
            <div>
              <Label>Ảnh đã chọn</Label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2 max-h-[300px] overflow-y-auto">
                {comboPreviews.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative group aspect-[4/5] rounded overflow-hidden border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`page-${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute top-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">
                      #{idx + 1}
                    </div>
                    {!comboBusy && (
                      <button
                        onClick={() => removeComboImage(idx)}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {comboBusy && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{comboStep}</div>
                <Progress value={comboProgress} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComboOpen(false)} disabled={comboBusy}>
              Huỷ
            </Button>
            <Button onClick={startCombo} disabled={comboBusy || comboPreviews.length === 0}>
              {comboBusy ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="size-4 mr-2" />
              )}
              Bắt đầu dựng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tpls && tpls.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Chưa có template nào. Bấm "Tạo mới" hoặc dùng AI để dựng từ ảnh.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tpls?.map((t) => (
          <Card key={t.pageTemplateId} className="overflow-hidden">
            <button
              onClick={() => openEdit(t.pageTemplateId)}
              className="block w-full text-left relative hover:opacity-90 transition bg-muted/40"
              style={{ aspectRatio: `${t.canvas.width} / ${t.canvas.height}` }}
            >
              <TemplatePreview tpl={t} />
              <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 bg-black/60 text-white rounded z-10">
                {t.canvas.width}×{t.canvas.height} · {t.slots.length} slot
              </div>
            </button>
            <CardContent className="p-4">
              <div className="font-semibold mb-2 truncate">{t.name}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="default" onClick={() => openEdit(t.pageTemplateId)}>
                  <Pencil className="size-3 mr-1" /> Sửa
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const dup = duplicatePageTemplate(t);
                    await db.pageTemplates.put(dup);
                    toast.success("Đã duplicate");
                  }}
                >
                  <Copy className="size-3" />
                </Button>
                {/Ng[àa]y/i.test(t.name) && (
                  <Button
                    size="sm"
                    variant="outline"
                    title="Nhân bản thành ngày khác"
                    onClick={() => onCloneDay(t.pageTemplateId)}
                  >
                    <CalendarPlus className="size-3" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!confirm(`Xóa template "${t.name}"?`)) return;
                    await db.pageTemplates.delete(t.pageTemplateId);
                    toast.success("Đã xóa");
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}

function TemplatePreview({ tpl }: { tpl: PageTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setScale(Math.min(w / tpl.canvas.width, h / tpl.canvas.height));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tpl.canvas.width, tpl.canvas.height]);

  const isEmpty = tpl.slots.length === 0;
  const previewData = useState(() => buildTemplatePreviewData(tpl))[0];

  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ background: tpl.canvas.background ?? "#fff" }}
    >
      {isEmpty ? (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs uppercase tracking-wider">
          {tpl.type} · trống
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          <PageRenderer
            template={tpl}
            entities={previewData.entities}
            assets={previewData.assets}
            entity={previewData.entities[0]}
            entityPool={previewData.entities}
            slotItems={previewData.slotItems}
            scale={scale}
          />
        </div>
      )}
    </div>
  );
}

function buildTemplatePreviewData(tpl: PageTemplate): {
  entities: Entity[];
  assets: Asset[];
  slotItems: RenderedItem[];
} {
  const sectionSlots = tpl.slots.filter((slot) => slot.kind === "section" && slot.sectionRefId);
  const repeatedCount = Math.max(
    6,
    tpl.sections.reduce((max, section) => Math.max(max, section.maxItems || 0), 0),
    Math.min(12, tpl.slots.filter((slot) => slot.bindingPath?.startsWith("entity.")).length || 0),
  );

  const entities: Entity[] = Array.from({ length: repeatedCount }, (_, index) => ({
    entityId: `preview-entity-${index + 1}`,
    name: `Địa điểm ${index + 1}`,
    address: `${12 + index} Hai Bà Trưng, Đà Lạt`,
    phone: `09${(10000000 + index).toString().slice(0, 8)}`,
    openingHours: "07:00 - 22:00",
    priceRange: `${40 + index * 5}k - ${90 + index * 5}k`,
    categoryMain: index % 2 === 0 ? "Cafe" : "Quán ăn",
    categorySub: index % 3 === 0 ? "Check-in" : "Chill",
    partnerFlag: false,
    partnerPriority: 0,
    partnerType: "none",
    campaignTags: [],
    seoKeywords: [],
    status: "active",
    sheetName: "preview",
    metadata: {
      signatureDish: index % 2 === 0 ? "Món nổi bật" : "Không gian đẹp",
    },
  }));

  const assets: Asset[] = entities.flatMap((entity, index) => {
    const src = buildPreviewPhotoDataUrl(index);
    return [
      {
        assetId: `preview-asset-cover-${index + 1}`,
        entityId: entity.entityId,
        sourceType: "url",
        sourceValue: src,
        role: "cover",
        isCover: true,
        qualityScore: 90,
        status: "ok",
      },
      {
        assetId: `preview-asset-section-${index + 1}`,
        entityId: entity.entityId,
        sourceType: "url",
        sourceValue: src,
        role: "section_image",
        isCover: false,
        qualityScore: 84,
        status: "ok",
      },
    ];
  });

  const slotItems: RenderedItem[] = [];
  sectionSlots.forEach((slot, sectionIndex) => {
    const section = tpl.sections.find((item) => item.sectionId === slot.sectionRefId);
    const itemCount = Math.max(3, Math.min(6, section?.maxItems ?? 4));
    Array.from({ length: itemCount }).forEach((_, itemIndex) => {
      const entity = entities[(sectionIndex * 3 + itemIndex) % entities.length];
      slotItems.push({
        sectionId: slot.sectionRefId,
        entityId: entity.entityId,
        assetId: assets.find((asset) => asset.entityId === entity.entityId)?.assetId,
      });
    });
  });

  return { entities, assets, slotItems };
}

function buildPreviewPhotoDataUrl(seed: number): string {
  const palettes = [
    ["#0f172a", "#1d4ed8", "#f59e0b"],
    ["#111827", "#14532d", "#fbbf24"],
    ["#1f2937", "#7c2d12", "#f97316"],
    ["#0b1120", "#6d28d9", "#facc15"],
  ];
  const [a, b, c] = palettes[seed % palettes.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${a}"/>
          <stop offset="60%" stop-color="${b}"/>
          <stop offset="100%" stop-color="${c}"/>
        </linearGradient>
        <filter id="blur">
          <feGaussianBlur stdDeviation="36"/>
        </filter>
      </defs>
      <rect width="720" height="900" fill="url(#g)"/>
      <circle cx="560" cy="180" r="150" fill="rgba(255,255,255,0.16)" filter="url(#blur)"/>
      <circle cx="180" cy="620" r="210" fill="rgba(255,255,255,0.10)" filter="url(#blur)"/>
      <rect x="80" y="680" width="560" height="120" rx="36" fill="rgba(255,255,255,0.06)"/>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
