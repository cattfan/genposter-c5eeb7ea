import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/storage/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Copy, Trash2, Sparkles, Loader2, CalendarPlus, Package, Layers, X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import type { PageTemplate } from "@/models";
import { PageRenderer } from "@/features/render/PageRenderer";
import { aiGenerateTemplateFromImageServer, aiGenerateComboFromImagesServer } from "@/server/aiTemplate";
import { aiLayoutToTemplate } from "@/features/ai/templateFromImage";
import { buildComboFromAiResult, persistCombo } from "@/features/ai/comboFromImages";
import { seedTravelFlexPack, cloneDayPage } from "@/storage/seedFlex";

export const Route = createFileRoute("/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tpls = useLiveQuery(() => db.pageTemplates.orderBy("updatedAt").reverse().toArray(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const comboFileRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // Combo state
  const [comboOpen, setComboOpen] = useState(false);
  const [comboFiles, setComboFiles] = useState<File[]>([]);
  const [comboPreviews, setComboPreviews] = useState<string[]>([]);
  const [comboPackName, setComboPackName] = useState("");
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
    setAiBusy(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Đọc ảnh lỗi"));
        r.readAsDataURL(f);
      });
      const out = await aiGenerateTemplateFromImageServer({ data: { imageDataUrl: dataUrl } });
      if (!out.ok) {
        toast.error(out.error);
        return;
      }
      const layout = JSON.parse(out.layoutJson);
      const tpl = aiLayoutToTemplate(layout, "AI: " + f.name.replace(/\.[^.]+$/, ""));
      await db.pageTemplates.put(tpl);
      toast.success("AI dựng xong — mở editor để chỉnh");
      navigate({ to: "/templates/$id/edit", params: { id: tpl.pageTemplateId } });
    } catch (err) {
      toast.error("AI lỗi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiBusy(false);
    }
  };

  const loadFlexPack = async () => {
    try {
      const r = await seedTravelFlexPack();
      toast.success(`Đã nạp pack 4N3Đ (${r.pageIds.length} page)`);
    } catch (e) {
      toast.error("Lỗi nạp pack: " + (e instanceof Error ? e.message : String(e)));
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
      const out = await aiGenerateComboFromImagesServer({
        data: {
          images: comboPreviews.map((dataUrl) => ({ dataUrl })),
          packNameHint: comboPackName.trim() || undefined,
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
    <div className="p-8 max-w-6xl">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAiImageChange} />
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Page Templates</h1>
          <p className="text-muted-foreground mt-1">Mỗi page template là 1 layout có thể ghép vào pack.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={loadFlexPack}>
            <Package className="size-4 mr-2" /> Nạp pack 4N3Đ
          </Button>
          <Button variant="outline" onClick={onPickAiImage} disabled={aiBusy}>
            {aiBusy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
            AI dựng từ ảnh
          </Button>
          <Button onClick={createNew}>
            <Plus className="size-4 mr-2" /> Tạo mới
          </Button>
        </div>
      </div>

      {tpls && tpls.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Chưa có template nào. Bấm "Tạo mới" hoặc nạp lại demo từ thanh bên.
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
                    const dup: PageTemplate = {
                      ...t,
                      pageTemplateId: nanoid(),
                      name: t.name + " (copy)",
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    };
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
    </div>
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

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden" style={{ background: tpl.canvas.background ?? "#fff" }}>
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
          <PageRenderer template={tpl} entities={[]} assets={[]} scale={scale} />
        </div>
      )}
    </div>
  );
}
