import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveBlob, getBlobURL } from "@/storage/db";
import { nanoid } from "nanoid";
import { Canvas, NumField } from "@/features/editor/EditorCanvas";
import type { PageTemplate, Slot, Section } from "@/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Type,
  Image as ImageIcon,
  Square,
  Circle,
  Triangle,
  Minus,
  Layers as LayersIcon,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  ZoomIn,
  ZoomOut,
  Save,
  ArrowLeft,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";

export function EditorPage() {
  const { id } = useParams({ from: "/templates/$id/edit" });
  const tpl = useLiveQuery(() => db.pageTemplates.get(id), [id]);
  const [draft, setDraft] = useState<PageTemplate | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.4);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    if (tpl) setDraft(JSON.parse(JSON.stringify(tpl)));
  }, [tpl]);

  // Keyboard: Delete/Backspace removes selected slot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedSlotId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setDraft((prev) => {
          if (!prev) return prev;
          const next = JSON.parse(JSON.stringify(prev)) as PageTemplate;
          next.slots = next.slots.filter((s) => s.slotId !== selectedSlotId);
          return next;
        });
        setSelectedSlotId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlotId]);

  if (!draft) {
    return <div className="p-8 text-muted-foreground">Đang tải...</div>;
  }

  const selectedSlot = draft.slots.find((s) => s.slotId === selectedSlotId) ?? null;

  const updateDraft = (updater: (d: PageTemplate) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as PageTemplate;
      updater(next);
      return next;
    });
  };

  const updateSlot = (slotId: string, patch: Partial<Slot>) => {
    updateDraft((d) => {
      const s = d.slots.find((x) => x.slotId === slotId);
      if (s) Object.assign(s, patch);
    });
  };
  const updateSlotStyle = (slotId: string, patch: Partial<NonNullable<Slot["style"]>>) => {
    updateDraft((d) => {
      const s = d.slots.find((x) => x.slotId === slotId);
      if (s) s.style = { ...(s.style ?? {}), ...patch };
    });
  };

  const addSlot = (kind: Slot["kind"], shapeKind?: NonNullable<Slot["shapeKind"]>) => {
    const isLine = kind === "shape" && (shapeKind === "line" || shapeKind === "divider");
    const newSlot: Slot = {
      slotId: nanoid(),
      kind,
      x: 100,
      y: 100,
      width: kind === "text" ? 600 : isLine ? 400 : 300,
      height: kind === "text" ? 80 : isLine ? 20 : 300,
      zIndex: (draft.slots.length || 0) + 1,
      ...(kind === "text" ? { staticText: "Văn bản mới", style: { fontSize: 48, fontWeight: 700, color: "#0f172a" } } : {}),
      ...(kind === "image" ? { staticImage: "", style: { fit: "cover", borderRadius: 12 } } : {}),
      ...(kind === "shape"
        ? {
            shapeKind: shapeKind ?? "rectangle",
            style: {
              fill: "#facc15",
              borderRadius: shapeKind === "circle" ? 0 : 8,
              strokeWidth: isLine ? 4 : undefined,
            },
          }
        : {}),
      ...(kind === "section" ? { sectionRefId: draft.sections[0]?.sectionId } : {}),
    } as Slot;
    updateDraft((d) => {
      d.slots.push(newSlot);
    });
    setSelectedSlotId(newSlot.slotId);
  };

  const addImageFromFile = async (file: File, dropX?: number, dropY?: number) => {
    if (!file.type.startsWith("image/")) {
      toast.error("File không phải ảnh: " + file.name);
      return;
    }
    const blobKey = await saveBlob(file);
    const url = await getBlobURL(blobKey);
    if (!url) return;
    const dim = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 600, h: 600 });
      img.src = url;
    });
    const maxW = 600;
    const ratio = dim.h / dim.w;
    const w = Math.min(maxW, dim.w);
    const h = Math.round(w * ratio);
    const newSlot: Slot = {
      slotId: nanoid(),
      kind: "image",
      x: dropX ?? 100,
      y: dropY ?? 100,
      width: w,
      height: h,
      zIndex: (draft.slots.length || 0) + 1,
      staticImage: url,
      style: { fit: "cover", borderRadius: 8 },
    };
    updateDraft((d) => d.slots.push(newSlot));
    setSelectedSlotId(newSlot.slotId);
    toast.success(`Đã thêm ảnh: ${file.name}`);
  };

  const handleUploadClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      let offset = 0;
      for (const f of files) {
        await addImageFromFile(f, 80 + offset, 80 + offset);
        offset += 30;
      }
    };
    input.click();
  };

  const deleteSlot = (slotId: string) => {
    updateDraft((d) => {
      d.slots = d.slots.filter((s) => s.slotId !== slotId);
    });
    setSelectedSlotId(null);
  };

  const duplicateSlot = (slotId: string) => {
    const orig = draft.slots.find((s) => s.slotId === slotId);
    if (!orig) return;
    const copy: Slot = { ...orig, slotId: nanoid(), x: orig.x + 24, y: orig.y + 24 };
    updateDraft((d) => d.slots.push(copy));
    setSelectedSlotId(copy.slotId);
  };

  const moveZ = (slotId: string, dir: 1 | -1) => {
    updateDraft((d) => {
      const s = d.slots.find((x) => x.slotId === slotId);
      if (s) s.zIndex = (s.zIndex ?? 0) + dir;
    });
  };

  const addSection = () => {
    const sec: Section = {
      sectionId: nanoid(),
      title: "Section mới",
      categoryQuery: "",
      maxItems: 3,
      minItems: 1,
      imageMode: "anchor_entity",
      partnerMode: "priority_partner",
      sortRule: "partner_first",
      listStyle: "dot",
    };
    updateDraft((d) => d.sections.push(sec));
  };

  const updateSection = (id: string, patch: Partial<Section>) => {
    updateDraft((d) => {
      const s = d.sections.find((x) => x.sectionId === id);
      if (s) Object.assign(s, patch);
    });
  };

  const deleteSection = (id: string) => {
    updateDraft((d) => {
      d.sections = d.sections.filter((s) => s.sectionId !== id);
      d.slots = d.slots.map((sl) =>
        sl.kind === "section" && sl.sectionRefId === id ? { ...sl, sectionRefId: undefined } : sl,
      );
    });
  };

  const save = async () => {
    if (!draft) return;
    await db.pageTemplates.put({ ...draft, updatedAt: Date.now() });
    toast.success("Đã lưu template");
  };

  return (
    <div className="flex h-screen relative">
      {/* Left toggle (when collapsed) */}
      {!leftOpen && (
        <button
          onClick={() => setLeftOpen(true)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-card border border-l-0 border-border rounded-r-md p-2 hover:bg-muted shadow"
          title="Mở panel trái"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {/* Left: blocks panel */}
      {leftOpen && (
        <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-3 border-b flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="flex-1 justify-start">
              <Link to="/templates">
                <ArrowLeft className="size-4 mr-2" /> Quay lại
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setLeftOpen(false)}
              title="Thu gọn"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>
          <div className="p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase">Thêm block</div>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => addSlot("text")}>
              <Type className="size-4 mr-2" /> Text
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => addSlot("image")}>
              <ImageIcon className="size-4 mr-2" /> Image (placeholder)
            </Button>
            <Button variant="default" size="sm" className="w-full justify-start" onClick={handleUploadClick}>
              <Upload className="size-4 mr-2" /> Tải ảnh từ máy
            </Button>

            <div className="text-xs font-semibold text-muted-foreground uppercase pt-2">Shapes</div>
            <div className="grid grid-cols-2 gap-1">
              <Button variant="outline" size="sm" onClick={() => addSlot("shape", "rectangle")} title="Hình vuông">
                <Square className="size-4 mr-1" /> Vuông
              </Button>
              <Button variant="outline" size="sm" onClick={() => addSlot("shape", "circle")} title="Hình tròn">
                <Circle className="size-4 mr-1" /> Tròn
              </Button>
              <Button variant="outline" size="sm" onClick={() => addSlot("shape", "triangle")} title="Tam giác">
                <Triangle className="size-4 mr-1" /> Tam giác
              </Button>
              <Button variant="outline" size="sm" onClick={() => addSlot("shape", "line")} title="Đường kẻ">
                <Minus className="size-4 mr-1" /> Line
              </Button>
            </div>

            <Button variant="outline" size="sm" className="w-full justify-start mt-2" onClick={() => addSlot("section")}>
              <LayersIcon className="size-4 mr-2" /> Section
            </Button>
          </div>
          <div className="p-3 border-t flex-1 overflow-y-auto">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              Layers ({draft.slots.length})
            </div>
            <div className="space-y-1">
              {draft.slots
                .slice()
                .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
                .map((s) => {
                  const isSel = s.slotId === selectedSlotId;
                  return (
                    <div
                      key={s.slotId}
                      className={
                        "group flex items-center gap-1 px-2 py-1 text-xs rounded " +
                        (isSel ? "bg-primary text-primary-foreground" : "hover:bg-muted")
                      }
                    >
                      <button
                        onClick={() => setSelectedSlotId(s.slotId)}
                        className="flex-1 text-left truncate"
                      >
                        [{s.kind}
                        {s.kind === "shape" && s.shapeKind ? `:${s.shapeKind}` : ""}]{" "}
                        {s.staticText?.slice(0, 14) ?? s.slotId.slice(0, 6)}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSlot(s.slotId);
                        }}
                        className={
                          "opacity-0 group-hover:opacity-100 p-0.5 rounded " +
                          (isSel ? "hover:bg-primary-foreground/20" : "hover:bg-destructive hover:text-destructive-foreground")
                        }
                        title="Xoá layer"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  );
                })}
              {draft.slots.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Chưa có layer nào</p>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Center: canvas */}
      <div className="flex-1 flex flex-col bg-muted/30">
        <div className="border-b bg-background p-2 flex items-center gap-2">
          <Input
            value={draft.name}
            onChange={(e) => updateDraft((d) => (d.name = e.target.value))}
            className="max-w-xs h-8"
          />
          <Select value={draft.type} onValueChange={(v) => updateDraft((d) => (d.type = v as PageTemplate["type"]))}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">cover</SelectItem>
              <SelectItem value="itinerary">itinerary</SelectItem>
              <SelectItem value="board">board</SelectItem>
              <SelectItem value="mixed">mixed</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 text-xs">
            <span>W</span>
            <Input
              type="number"
              value={draft.canvas.width}
              onChange={(e) => updateDraft((d) => (d.canvas.width = Number(e.target.value) || 1080))}
              className="w-20 h-8"
            />
            <span>×H</span>
            <Input
              type="number"
              value={draft.canvas.height}
              onChange={(e) => updateDraft((d) => (d.canvas.height = Number(e.target.value) || 1080))}
              className="w-20 h-8"
            />
          </div>
          <div className="flex items-center gap-1 ml-2">
            <Input
              type="color"
              value={draft.canvas.background ?? "#ffffff"}
              onChange={(e) => updateDraft((d) => (d.canvas.background = e.target.value))}
              className="w-12 h-8 p-1"
            />
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>
            <ZoomOut className="size-4" />
          </Button>
          <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            <ZoomIn className="size-4" />
          </Button>
          <Button onClick={save} size="sm">
            <Save className="size-4 mr-2" /> Lưu
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? "Thu gọn panel phải" : "Mở panel phải"}
          >
            {rightOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
        <div
          className="flex-1 overflow-auto p-8 grid place-items-center relative"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={async (e) => {
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
            if (files.length === 0) return;
            e.preventDefault();
            let offset = 0;
            for (const f of files) {
              await addImageFromFile(f, 80 + offset, 80 + offset);
              offset += 30;
            }
          }}
        >
          <Canvas
            template={draft}
            zoom={zoom}
            selectedSlotId={selectedSlotId}
            onSelect={setSelectedSlotId}
            onUpdateSlot={updateSlot}
            onDeleteSlot={deleteSlot}
          />
          {draft.slots.length === 0 && (
            <div className="absolute inset-8 pointer-events-none border-2 border-dashed border-muted-foreground/30 rounded-xl grid place-items-center">
              <div className="text-center text-muted-foreground">
                <Upload className="size-10 mx-auto mb-2 opacity-50" />
                <p className="font-medium">Kéo & thả ảnh vào đây</p>
                <p className="text-xs">hoặc bấm "Tải ảnh từ máy" ở thanh trái</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: properties */}
      {rightOpen && (
        <aside className="w-80 border-l border-border bg-card overflow-y-auto shrink-0">
        <Tabs defaultValue="props" className="w-full">
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="props" className="flex-1">Thuộc tính</TabsTrigger>
            <TabsTrigger value="sections" className="flex-1">Sections</TabsTrigger>
          </TabsList>
          <TabsContent value="props" className="p-4 space-y-3 mt-0">
            {!selectedSlot && (
              <p className="text-sm text-muted-foreground">Chọn 1 block trên canvas để chỉnh thuộc tính.</p>
            )}
            {selectedSlot && (
              <>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => duplicateSlot(selectedSlot.slotId)}>
                    <Copy className="size-3 mr-1" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveZ(selectedSlot.slotId, 1)}>
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveZ(selectedSlot.slotId, -1)}>
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteSlot(selectedSlot.slotId)}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="X" value={selectedSlot.x} onChange={(v) => updateSlot(selectedSlot.slotId, { x: v })} />
                  <NumField label="Y" value={selectedSlot.y} onChange={(v) => updateSlot(selectedSlot.slotId, { y: v })} />
                  <NumField label="W" value={selectedSlot.width} onChange={(v) => updateSlot(selectedSlot.slotId, { width: v })} />
                  <NumField label="H" value={selectedSlot.height} onChange={(v) => updateSlot(selectedSlot.slotId, { height: v })} />
                  <NumField label="Rotate" value={selectedSlot.rotation ?? 0} onChange={(v) => updateSlot(selectedSlot.slotId, { rotation: v })} />
                  <NumField label="Z" value={selectedSlot.zIndex ?? 0} onChange={(v) => updateSlot(selectedSlot.slotId, { zIndex: v })} />
                </div>

                {selectedSlot.kind === "text" && (
                  <div className="space-y-2">
                    <Label>Văn bản</Label>
                    <textarea
                      className="w-full border rounded p-2 text-sm min-h-[80px]"
                      value={selectedSlot.staticText ?? ""}
                      onChange={(e) => updateSlot(selectedSlot.slotId, { staticText: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <NumField
                        label="Font size"
                        value={selectedSlot.style?.fontSize ?? 24}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { fontSize: v })}
                      />
                      <NumField
                        label="Weight"
                        value={Number(selectedSlot.style?.fontWeight ?? 500)}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { fontWeight: v })}
                      />
                      <div>
                        <Label className="text-xs">Color</Label>
                        <Input
                          type="color"
                          value={selectedSlot.style?.color ?? "#0f172a"}
                          onChange={(e) => updateSlotStyle(selectedSlot.slotId, { color: e.target.value })}
                          className="h-8 p-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Align</Label>
                        <Select
                          value={selectedSlot.style?.textAlign ?? "left"}
                          onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { textAlign: v as any })}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">left</SelectItem>
                            <SelectItem value="center">center</SelectItem>
                            <SelectItem value="right">right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">Transform</Label>
                        <Select
                          value={selectedSlot.style?.textTransform ?? "none"}
                          onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { textTransform: v as any })}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">none</SelectItem>
                            <SelectItem value="uppercase">UPPERCASE</SelectItem>
                            <SelectItem value="lowercase">lowercase</SelectItem>
                            <SelectItem value="capitalize">Capitalize</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {selectedSlot.kind === "image" && (
                  <div className="space-y-2">
                    <Label>URL ảnh tĩnh (để trống nếu bind từ data)</Label>
                    <Input
                      value={selectedSlot.staticImage ?? ""}
                      onChange={(e) => updateSlot(selectedSlot.slotId, { staticImage: e.target.value })}
                      placeholder="https://..."
                    />
                    <Label>Object fit</Label>
                    <Select
                      value={selectedSlot.style?.fit ?? "cover"}
                      onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { fit: v as any })}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cover">cover</SelectItem>
                        <SelectItem value="contain">contain</SelectItem>
                        <SelectItem value="stretch">stretch</SelectItem>
                      </SelectContent>
                    </Select>
                    <NumField
                      label="Border radius"
                      value={selectedSlot.style?.borderRadius ?? 0}
                      onChange={(v) => updateSlotStyle(selectedSlot.slotId, { borderRadius: v })}
                    />
                    <Label>Overlay color (rgba)</Label>
                    <Input
                      value={selectedSlot.style?.overlayColor ?? ""}
                      onChange={(e) => updateSlotStyle(selectedSlot.slotId, { overlayColor: e.target.value })}
                      placeholder="rgba(0,0,0,0.4)"
                    />
                  </div>
                )}

                {selectedSlot.kind === "shape" && (
                  <div className="space-y-2">
                    <Label>Kind</Label>
                    <Select
                      value={selectedSlot.shapeKind ?? "rectangle"}
                      onValueChange={(v) => updateSlot(selectedSlot.slotId, { shapeKind: v as any })}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rectangle">rectangle</SelectItem>
                        <SelectItem value="circle">circle</SelectItem>
                        <SelectItem value="line">line</SelectItem>
                        <SelectItem value="badge">badge</SelectItem>
                      </SelectContent>
                    </Select>
                    <Label>Fill</Label>
                    <Input
                      type="color"
                      value={selectedSlot.style?.fill ?? "#000000"}
                      onChange={(e) => updateSlotStyle(selectedSlot.slotId, { fill: e.target.value })}
                      className="h-8 p-1"
                    />
                    <NumField
                      label="Border radius"
                      value={selectedSlot.style?.borderRadius ?? 0}
                      onChange={(v) => updateSlotStyle(selectedSlot.slotId, { borderRadius: v })}
                    />
                  </div>
                )}

                {selectedSlot.kind === "section" && (
                  <div className="space-y-2">
                    <Label>Section reference</Label>
                    <Select
                      value={selectedSlot.sectionRefId ?? ""}
                      onValueChange={(v) => updateSlot(selectedSlot.slotId, { sectionRefId: v })}
                    >
                      <SelectTrigger className="h-8"><SelectValue placeholder="Chọn section" /></SelectTrigger>
                      <SelectContent>
                        {draft.sections.map((s) => (
                          <SelectItem key={s.sectionId} value={s.sectionId}>{s.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="sections" className="p-4 space-y-3 mt-0">
            <Button onClick={addSection} size="sm" className="w-full">+ Thêm section</Button>
            {draft.sections.length === 0 && (
              <p className="text-xs text-muted-foreground">Chưa có section. Section dùng cho page kiểu list/board.</p>
            )}
            {draft.sections.map((s) => (
              <div key={s.sectionId} className="border rounded p-2 space-y-2">
                <Input value={s.title} onChange={(e) => updateSection(s.sectionId, { title: e.target.value })} className="h-8" />
                <div>
                  <Label className="text-xs">Category query (vd: cafe,quan_an)</Label>
                  <Input value={s.categoryQuery ?? ""} onChange={(e) => updateSection(s.sectionId, { categoryQuery: e.target.value })} className="h-8" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Min" value={s.minItems} onChange={(v) => updateSection(s.sectionId, { minItems: v })} />
                  <NumField label="Max" value={s.maxItems} onChange={(v) => updateSection(s.sectionId, { maxItems: v })} />
                </div>
                <div>
                  <Label className="text-xs">Partner mode</Label>
                  <Select value={s.partnerMode} onValueChange={(v) => updateSection(s.sectionId, { partnerMode: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict_partner">strict_partner</SelectItem>
                      <SelectItem value="priority_partner">priority_partner</SelectItem>
                      <SelectItem value="balanced_partner">balanced_partner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">List style</Label>
                  <Select value={s.listStyle ?? "dot"} onValueChange={(v) => updateSection(s.sectionId, { listStyle: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dot">• dot</SelectItem>
                      <SelectItem value="dash">- dash</SelectItem>
                      <SelectItem value="number">1. number</SelectItem>
                      <SelectItem value="none">none</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="destructive" size="sm" className="w-full" onClick={() => deleteSection(s.sectionId)}>
                  Xóa section
                </Button>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </aside>
      )}

      {/* Shape selection in shape kind select - add triangle option */}
    </div>
  );
}
