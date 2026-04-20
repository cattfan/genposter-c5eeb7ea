import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveBlob, getBlobURL } from "@/storage/db";
import { nanoid } from "nanoid";
import { Canvas, NumField } from "@/features/editor/EditorCanvas";
import { FontPicker } from "@/features/editor/FontPicker";
import { SlotContextMenu, type SlotMenuActions } from "@/features/editor/SlotContextMenu";
import {
  bringForward,
  bringToFront,
  inferLayerName,
  reorderByPanel,
  sendBackward,
  sendToBack,
} from "@/features/editor/layerOps";
import { getClipboard, hasClipboard, pasteFromClipboard, setClipboard } from "@/features/editor/useClipboard";
import type { PageTemplate, Slot, Section } from "@/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ChevronsUp,
  ChevronsDown,
  GripVertical,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export function EditorPage() {
  const { id } = useParams({ from: "/templates/$id/edit" });
  const tpl = useLiveQuery(() => db.pageTemplates.get(id), [id]);
  const [draft, setDraft] = useState<PageTemplate | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.4);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const dragLayerIdRef = useRef<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  // re-render trigger sau khi setClipboard (vì clipboard là module-level)
  const [, setClipboardTick] = useState(0);
  const bumpClipboard = () => setClipboardTick((n) => n + 1);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  // Undo/Redo stacks (lưu snapshot draft trước khi thay đổi)
  const pastRef = useRef<PageTemplate[]>([]);
  const futureRef = useRef<PageTemplate[]>([]);
  const skipHistoryRef = useRef(false);

  // Ctrl/Cmd + wheel = zoom (native listener vì React onWheel là passive)
  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = -e.deltaY;
      setZoom((z) => {
        const factor = delta > 0 ? 1.1 : 1 / 1.1;
        const next = Math.min(3, Math.max(0.05, z * factor));
        return Math.round(next * 1000) / 1000;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (tpl) {
      setDraft(JSON.parse(JSON.stringify(tpl)));
      pastRef.current = [];
      futureRef.current = [];
    }
  }, [tpl]);

  const undo = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const last = pastRef.current.pop();
      if (!last) return prev;
      futureRef.current.push(prev);
      return last;
    });
  };
  const redo = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = futureRef.current.pop();
      if (!next) return prev;
      pastRef.current.push(prev);
      return next;
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      // Undo/Redo
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        redo();
        return;
      }
      // Paste có thể chạy ngay cả khi không có selection
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteSlot();
        return;
      }
      if (!selectedSlotId) return;
      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSlot(selectedSlotId);
        return;
      }
      // Ctrl+D = duplicate
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSlot(selectedSlotId);
        return;
      }
      // Ctrl+C = copy
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySlot(selectedSlotId);
        return;
      }
      // Ctrl+X = cut
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSlot(selectedSlotId);
        return;
      }
      // Z-order: Ctrl+Shift+] / Ctrl+] / Ctrl+[ / Ctrl+Shift+[
      if (mod && e.key === "]") {
        e.preventDefault();
        orderSlot(selectedSlotId, e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        orderSlot(selectedSlotId, e.shiftKey ? "back" : "backward");
        return;
      }
      if (e.key === "]" && !mod) {
        e.preventDefault();
        orderSlot(selectedSlotId, "forward");
        return;
      }
      if (e.key === "[" && !mod) {
        e.preventDefault();
        orderSlot(selectedSlotId, "backward");
        return;
      }
      // F2 = rename
      if (e.key === "F2") {
        e.preventDefault();
        setRenamingSlotId(selectedSlotId);
        setLeftOpen(true);
        return;
      }
      // Ctrl+H = toggle hidden
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        toggleHidden(selectedSlotId);
        return;
      }
      // Ctrl+L = toggle lock
      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleLock(selectedSlotId);
        return;
      }
      // Mũi tên = nudge ±1, Shift+Mũi tên = ±10
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        const cur = draft?.slots.find((s) => s.slotId === selectedSlotId);
        if (!cur || cur.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        updateSlot(selectedSlotId, { x: cur.x + dx, y: cur.y + dy });
        return;
      }
      // R = rotate 15°
      if (e.key.toLowerCase() === "r" && !mod) {
        e.preventDefault();
        const cur = draft?.slots.find((s) => s.slotId === selectedSlotId);
        if (cur) updateSlot(selectedSlotId, { rotation: ((cur.rotation ?? 0) + 15) % 360 });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlotId, draft]);

  if (!draft) {
    return <div className="p-8 text-muted-foreground">Đang tải...</div>;
  }

  const selectedSlot = draft.slots.find((s) => s.slotId === selectedSlotId) ?? null;

  const updateDraft = (updater: (d: PageTemplate) => void, skipHistory = false) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (!skipHistory && !skipHistoryRef.current) {
        pastRef.current.push(JSON.parse(JSON.stringify(prev)));
        if (pastRef.current.length > 50) pastRef.current.shift();
        futureRef.current = [];
      }
      skipHistoryRef.current = false;
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
    // Mọi block (text/shape/section/image-placeholder) đều ở cùng tầng zIndex = 1.
    // Ảnh upload từ máy mới là layer nền (zIndex = 0).
    const newSlot: Slot = {
      slotId: nanoid(),
      kind,
      x: 100,
      y: 100,
      width: kind === "text" ? 600 : isLine ? 400 : 300,
      height: kind === "text" ? 80 : isLine ? 20 : 300,
      zIndex: 1,
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
    // Scale theo canvas: cho phép ảnh chiếm tối đa ~90% canvas, giữ tỉ lệ gốc.
    // Nếu ảnh nhỏ hơn canvas thì giữ nguyên kích thước thật (1:1 px canvas).
    const cw = draft.canvas.width;
    const ch = draft.canvas.height;
    const maxW = Math.round(cw * 0.9);
    const maxH = Math.round(ch * 0.9);
    const scale = Math.min(1, maxW / dim.w, maxH / dim.h);
    const w = Math.max(20, Math.round(dim.w * scale));
    const h = Math.max(20, Math.round(dim.h * scale));
    const x = dropX ?? Math.max(0, Math.round((cw - w) / 2));
    const y = dropY ?? Math.max(0, Math.round((ch - h) / 2));
    // Ảnh upload từ máy = layer NỀN, luôn nằm dưới mọi block khác.
    const newSlot: Slot = {
      slotId: nanoid(),
      kind: "image",
      x,
      y,
      width: w,
      height: h,
      zIndex: 0,
      staticImage: url,
      style: { fit: "cover", borderRadius: 0 },
      isUploadedBackground: true,
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
    if (orig.isUploadedBackground) {
      toast.error("Không thể nhân bản ảnh nền upload");
      return;
    }
    const copy: Slot = { ...orig, slotId: nanoid(), x: orig.x + 24, y: orig.y + 24 };
    updateDraft((d) => d.slots.push(copy));
    setSelectedSlotId(copy.slotId);
  };

  const moveZ = (slotId: string, dir: 1 | -1) => {
    orderSlot(slotId, dir > 0 ? "forward" : "backward");
  };

  // Z-order chuẩn (4 thao tác Figma/Canva)
  const orderSlot = (slotId: string, mode: "forward" | "backward" | "front" | "back") => {
    updateDraft((d) => {
      const fn =
        mode === "forward" ? bringForward
        : mode === "backward" ? sendBackward
        : mode === "front" ? bringToFront
        : sendToBack;
      d.slots = fn(d.slots, slotId);
    });
  };

  const toggleHidden = (slotId: string) => {
    const s = draft.slots.find((x) => x.slotId === slotId);
    if (!s) return;
    updateSlotStyle(slotId, { hidden: !s.style?.hidden });
  };

  const toggleLock = (slotId: string) => {
    const s = draft.slots.find((x) => x.slotId === slotId);
    if (!s) return;
    if (s.isUploadedBackground) {
      toast.error("Ảnh nền upload luôn bị khoá");
      return;
    }
    updateSlot(slotId, { locked: !s.locked });
  };

  // Clipboard nội bộ
  const copySlot = (slotId: string) => {
    const s = draft.slots.find((x) => x.slotId === slotId);
    if (!s) return;
    setClipboard(s);
    bumpClipboard();
    toast.success("Đã copy layer");
  };
  const cutSlot = (slotId: string) => {
    const s = draft.slots.find((x) => x.slotId === slotId);
    if (!s) return;
    if (s.isUploadedBackground) {
      toast.error("Không thể cắt ảnh nền upload");
      return;
    }
    setClipboard(s);
    bumpClipboard();
    deleteSlot(slotId);
    toast.success("Đã cắt layer");
  };
  const pasteSlot = () => {
    const next = pasteFromClipboard(24);
    if (!next) {
      toast.error("Clipboard trống");
      return;
    }
    updateDraft((d) => d.slots.push(next));
    setSelectedSlotId(next.slotId);
  };

  // Đổi tên layer
  const renameSlot = (slotId: string, name: string) => {
    updateSlot(slotId, { name: name.trim() || undefined });
  };

  // Drag-reorder layer trong panel (top-first list)
  const handleLayerDrop = (targetId: string) => {
    const dragId = dragLayerIdRef.current;
    dragLayerIdRef.current = null;
    setDragOverLayerId(null);
    if (!dragId || dragId === targetId) return;
    // build new top-first order
    const sortedTopFirst = draft.slots
      .filter((s) => !s.isUploadedBackground)
      .slice()
      .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
      .map((s) => s.slotId);
    const fromIdx = sortedTopFirst.indexOf(dragId);
    const toIdx = sortedTopFirst.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = sortedTopFirst.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId);
    updateDraft((d) => {
      d.slots = reorderByPanel(d.slots, next);
    });
  };

  // Build context menu actions for 1 slot
  const buildSlotMenuActions = (slotId: string): SlotMenuActions => ({
    bringToFront: () => orderSlot(slotId, "front"),
    bringForward: () => orderSlot(slotId, "forward"),
    sendBackward: () => orderSlot(slotId, "backward"),
    sendToBack: () => orderSlot(slotId, "back"),
    duplicate: () => duplicateSlot(slotId),
    rename: () => {
      setSelectedSlotId(slotId);
      setRenamingSlotId(slotId);
      setLeftOpen(true);
    },
    toggleLock: () => toggleLock(slotId),
    toggleHidden: () => toggleHidden(slotId),
    remove: () => deleteSlot(slotId),
    copy: () => copySlot(slotId),
    cut: () => cutSlot(slotId),
    paste: () => pasteSlot(),
    canPaste: hasClipboard(),
  });

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
    // Khi lưu: bỏ nền canvas trắng để export trong suốt (chỉ giữ ảnh + block trên).
    const toSave: PageTemplate = {
      ...draft,
      canvas: { ...draft.canvas, background: undefined, backgroundImage: undefined },
      updatedAt: Date.now(),
    };
    await db.pageTemplates.put(toSave);
    toast.success("Đã lưu template (nền canvas trong suốt)");
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
            <div className="space-y-0.5">
              {draft.slots
                .slice()
                .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
                .map((s) => (
                  <LayerRow
                    key={s.slotId}
                    slot={s}
                    selected={s.slotId === selectedSlotId}
                    renaming={renamingSlotId === s.slotId}
                    onSelect={() => setSelectedSlotId(s.slotId)}
                    onStartRename={() => {
                      setSelectedSlotId(s.slotId);
                      setRenamingSlotId(s.slotId);
                    }}
                    onCommitRename={(name) => {
                      renameSlot(s.slotId, name);
                      setRenamingSlotId(null);
                    }}
                    onCancelRename={() => setRenamingSlotId(null)}
                    onToggleHidden={() => toggleHidden(s.slotId)}
                    onToggleLock={() => toggleLock(s.slotId)}
                    onDelete={() => deleteSlot(s.slotId)}
                    menuActions={buildSlotMenuActions(s.slotId)}
                    dragOver={dragOverLayerId === s.slotId}
                    onDragStart={() => {
                      dragLayerIdRef.current = s.slotId;
                    }}
                    onDragEnter={() => setDragOverLayerId(s.slotId)}
                    onDragLeave={() => setDragOverLayerId(null)}
                    onDrop={() => handleLayerDrop(s.slotId)}
                  />
                ))}
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
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.05, z - 0.1))} title="Zoom out (Ctrl + scroll)">
            <ZoomOut className="size-4" />
          </Button>
          <span className="text-xs w-12 text-center" title="Ctrl/⌘ + lăn chuột để zoom">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} title="Zoom in (Ctrl + scroll)">
            <ZoomIn className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={undo} title="Hoàn tác (Ctrl+Z)">
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} title="Làm lại (Ctrl+Shift+Z)">
            <Redo2 className="size-4" />
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
          ref={canvasScrollRef}
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
            buildMenuActions={buildSlotMenuActions}
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
                  {!selectedSlot.isUploadedBackground && (
                    <Button size="sm" variant="outline" onClick={() => duplicateSlot(selectedSlot.slotId)}>
                      <Copy className="size-3 mr-1" /> Copy
                    </Button>
                  )}
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
                {selectedSlot.isUploadedBackground && (
                  <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                    <Lock className="size-3" /> Ảnh nền upload — luôn ở layer dưới cùng, không nhân bản được.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="X" value={selectedSlot.x} onChange={(v) => updateSlot(selectedSlot.slotId, { x: v })} />
                  <NumField label="Y" value={selectedSlot.y} onChange={(v) => updateSlot(selectedSlot.slotId, { y: v })} />
                  <NumField label="W" value={selectedSlot.width} onChange={(v) => updateSlot(selectedSlot.slotId, { width: v })} />
                  <NumField label="H" value={selectedSlot.height} onChange={(v) => updateSlot(selectedSlot.slotId, { height: v })} />
                  <NumField label="Rotate" value={selectedSlot.rotation ?? 0} onChange={(v) => updateSlot(selectedSlot.slotId, { rotation: v })} />
                  <NumField label="Z" value={selectedSlot.zIndex ?? 0} onChange={(v) => updateSlot(selectedSlot.slotId, { zIndex: v })} />
                </div>

                {/* Transform: rotate 90°, flip, opacity */}
                <div className="border-t pt-2 space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Biến đổi</Label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => updateSlot(selectedSlot.slotId, { rotation: ((selectedSlot.rotation ?? 0) - 90 + 360) % 360 })}
                      title="Xoay -90°">
                      <RotateCcw className="size-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => updateSlot(selectedSlot.slotId, { rotation: ((selectedSlot.rotation ?? 0) + 90) % 360 })}
                      title="Xoay +90°">
                      <RotateCw className="size-3" />
                    </Button>
                    <Button size="sm" variant={selectedSlot.style?.flipH ? "default" : "outline"} className="flex-1"
                      onClick={() => updateSlotStyle(selectedSlot.slotId, { flipH: !selectedSlot.style?.flipH })}
                      title="Lật ngang">
                      <FlipHorizontal className="size-3" />
                    </Button>
                    <Button size="sm" variant={selectedSlot.style?.flipV ? "default" : "outline"} className="flex-1"
                      onClick={() => updateSlotStyle(selectedSlot.slotId, { flipV: !selectedSlot.style?.flipV })}
                      title="Lật dọc">
                      <FlipVertical className="size-3" />
                    </Button>
                  </div>
                  <div>
                    <Label className="text-xs">Opacity ({Math.round((selectedSlot.style?.opacity ?? 1) * 100)}%)</Label>
                    <Slider
                      value={[(selectedSlot.style?.opacity ?? 1) * 100]}
                      min={0} max={100} step={1}
                      onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { opacity: v[0] / 100 })}
                    />
                  </div>
                </div>

                {/* Bind dữ liệu được thực hiện ở trang "Tạo nội dung" — editor không còn dropdown bind. */}

                {selectedSlot.kind === "text" && (
                  <div className="space-y-2">
                    <Label>Văn bản</Label>
                    <textarea
                      className="w-full border rounded p-2 text-sm min-h-[80px]"
                      value={selectedSlot.staticText ?? ""}
                      onChange={(e) => updateSlot(selectedSlot.slotId, { staticText: e.target.value })}
                    />

                    <FontPicker
                      value={selectedSlot.style?.fontFamily}
                      onChange={(v) => updateSlotStyle(selectedSlot.slotId, { fontFamily: v })}
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

                    {/* Style toggles: B / I / U / S */}
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={Number(selectedSlot.style?.fontWeight ?? 500) >= 700 ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => updateSlotStyle(selectedSlot.slotId, {
                          fontWeight: Number(selectedSlot.style?.fontWeight ?? 500) >= 700 ? 400 : 700,
                        })}
                        title="Bold"
                      ><Bold className="size-3" /></Button>
                      <Button
                        size="sm"
                        variant={selectedSlot.style?.fontStyle === "italic" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => updateSlotStyle(selectedSlot.slotId, {
                          fontStyle: selectedSlot.style?.fontStyle === "italic" ? "normal" : "italic",
                        })}
                        title="Italic"
                      ><Italic className="size-3" /></Button>
                      <Button
                        size="sm"
                        variant={(selectedSlot.style?.textDecoration ?? "none").includes("underline") ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          const cur = selectedSlot.style?.textDecoration ?? "none";
                          const has = cur.includes("underline");
                          const hasStrike = cur.includes("line-through");
                          const next = (has ? (hasStrike ? "line-through" : "none") : (hasStrike ? "underline line-through" : "underline")) as any;
                          updateSlotStyle(selectedSlot.slotId, { textDecoration: next });
                        }}
                        title="Underline"
                      ><Underline className="size-3" /></Button>
                      <Button
                        size="sm"
                        variant={(selectedSlot.style?.textDecoration ?? "none").includes("line-through") ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => {
                          const cur = selectedSlot.style?.textDecoration ?? "none";
                          const has = cur.includes("line-through");
                          const hasU = cur.includes("underline");
                          const next = (has ? (hasU ? "underline" : "none") : (hasU ? "underline line-through" : "line-through")) as any;
                          updateSlotStyle(selectedSlot.slotId, { textDecoration: next });
                        }}
                        title="Strikethrough"
                      ><Strikethrough className="size-3" /></Button>
                    </div>

                    {/* Spacing */}
                    <div>
                      <Label className="text-xs flex justify-between">
                        <span>Line height</span>
                        <span className="text-muted-foreground">{(selectedSlot.style?.lineHeight ?? 1.2).toFixed(2)}</span>
                      </Label>
                      <Slider
                        value={[(selectedSlot.style?.lineHeight ?? 1.2) * 100]}
                        min={80} max={300} step={5}
                        onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { lineHeight: v[0] / 100 })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs flex justify-between">
                        <span>Letter spacing (px)</span>
                        <span className="text-muted-foreground">{selectedSlot.style?.letterSpacing ?? 0}</span>
                      </Label>
                      <Slider
                        value={[selectedSlot.style?.letterSpacing ?? 0]}
                        min={-5} max={20} step={0.5}
                        onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { letterSpacing: v[0] })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Max lines (0 = không giới hạn)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={selectedSlot.style?.maxLines ?? 0}
                        onChange={(e) => updateSlotStyle(selectedSlot.slotId, { maxLines: Number(e.target.value) || 0 })}
                        className="h-8"
                      />
                    </div>

                    {/* Text stroke */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground">Viền chữ (stroke)</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Color</Label>
                          <Input
                            type="color"
                            value={selectedSlot.style?.textStrokeColor ?? "#000000"}
                            onChange={(e) => updateSlotStyle(selectedSlot.slotId, { textStrokeColor: e.target.value })}
                            className="h-8 p-1"
                          />
                        </div>
                        <NumField
                          label="Width (px)"
                          value={selectedSlot.style?.textStrokeWidth ?? 0}
                          onChange={(v) => updateSlotStyle(selectedSlot.slotId, { textStrokeWidth: v })}
                        />
                      </div>
                    </div>

                    {/* Gradient text */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground flex items-center justify-between">
                        <span className="flex items-center gap-1"><Sparkles className="size-3" /> Gradient text</span>
                        <Button
                          size="sm"
                          variant={selectedSlot.style?.gradientEnabled ? "default" : "outline"}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => updateSlotStyle(selectedSlot.slotId, {
                            gradientEnabled: !selectedSlot.style?.gradientEnabled,
                            gradientFrom: selectedSlot.style?.gradientFrom ?? "#f97316",
                            gradientTo: selectedSlot.style?.gradientTo ?? "#db2777",
                            gradientAngle: selectedSlot.style?.gradientAngle ?? 90,
                          })}
                        >
                          {selectedSlot.style?.gradientEnabled ? "ON" : "OFF"}
                        </Button>
                      </Label>
                      {selectedSlot.style?.gradientEnabled && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">From</Label>
                              <Input
                                type="color"
                                value={selectedSlot.style?.gradientFrom ?? "#f97316"}
                                onChange={(e) => updateSlotStyle(selectedSlot.slotId, { gradientFrom: e.target.value })}
                                className="h-8 p-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">To</Label>
                              <Input
                                type="color"
                                value={selectedSlot.style?.gradientTo ?? "#db2777"}
                                onChange={(e) => updateSlotStyle(selectedSlot.slotId, { gradientTo: e.target.value })}
                                className="h-8 p-1"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs flex justify-between">
                              <span>Angle (°)</span>
                              <span className="text-muted-foreground">{selectedSlot.style?.gradientAngle ?? 90}</span>
                            </Label>
                            <Slider
                              value={[selectedSlot.style?.gradientAngle ?? 90]}
                              min={0} max={360} step={5}
                              onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { gradientAngle: v[0] })}
                            />
                          </div>
                        </>
                      )}
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

                    {/* Crop info */}
                    {selectedSlot.crop && (
                      <div className="flex items-center justify-between text-xs bg-muted/50 p-2 rounded">
                        <span>Đã crop {Math.round(selectedSlot.crop.w * 100)}×{Math.round(selectedSlot.crop.h * 100)}%</span>
                        <Button size="sm" variant="ghost" className="h-6" onClick={() => updateSlot(selectedSlot.slotId, { crop: undefined })}>
                          Reset
                        </Button>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground italic">Mẹo: nháy đúp ảnh trên canvas để crop.</p>

                    {/* Filters */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground">Filters</Label>
                      <FilterSlider label="Brightness" value={selectedSlot.style?.brightness ?? 1} min={0} max={2} step={0.05}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { brightness: v })} />
                      <FilterSlider label="Contrast" value={selectedSlot.style?.contrast ?? 1} min={0} max={2} step={0.05}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { contrast: v })} />
                      <FilterSlider label="Saturate" value={selectedSlot.style?.saturate ?? 1} min={0} max={2} step={0.05}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { saturate: v })} />
                      <FilterSlider label="Blur (px)" value={selectedSlot.style?.blur ?? 0} min={0} max={20} step={0.5}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { blur: v })} />
                      <FilterSlider label="Hue rotate (°)" value={selectedSlot.style?.hueRotate ?? 0} min={0} max={360} step={5}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { hueRotate: v })} />
                      <FilterSlider label="Grayscale" value={selectedSlot.style?.grayscale ?? 0} min={0} max={1} step={0.05}
                        onChange={(v) => updateSlotStyle(selectedSlot.slotId, { grayscale: v })} />
                      <Button size="sm" variant="ghost" className="w-full h-7 text-xs"
                        onClick={() => updateSlotStyle(selectedSlot.slotId, {
                          brightness: 1, contrast: 1, saturate: 1, blur: 0, hueRotate: 0, grayscale: 0,
                        })}>
                        Reset filters
                      </Button>
                    </div>
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
                        <SelectItem value="triangle">triangle</SelectItem>
                        <SelectItem value="line">line</SelectItem>
                        <SelectItem value="badge">badge</SelectItem>
                      </SelectContent>
                    </Select>

                    <Label>Fill (màu nền)</Label>
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

                    {/* Shape làm KHUNG GIỮ ẢNH */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                        <ImageIcon className="size-3" /> Ảnh trong shape
                      </Label>
                      <Input
                        value={selectedSlot.staticImage ?? ""}
                        onChange={(e) => updateSlot(selectedSlot.slotId, { staticImage: e.target.value })}
                        placeholder="https://... (cập nhật sau qua sheet)"
                        className="h-8"
                      />
                      <p className="text-[10px] text-muted-foreground italic">
                        Khi có ảnh, ảnh sẽ được clip theo hình dạng shape. Để trống nếu sẽ bind từ data ở trang Tạo nội dung.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Object fit</Label>
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
                        </div>
                        <div>
                          <Label className="text-xs">Overlay</Label>
                          <Input
                            value={selectedSlot.style?.overlayColor ?? ""}
                            onChange={(e) => updateSlotStyle(selectedSlot.slotId, { overlayColor: e.target.value })}
                            placeholder="rgba(0,0,0,.4)"
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Border */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground">Viền (border)</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Color</Label>
                          <Input
                            type="color"
                            value={selectedSlot.style?.borderColor ?? "#000000"}
                            onChange={(e) => updateSlotStyle(selectedSlot.slotId, { borderColor: e.target.value })}
                            className="h-8 p-1"
                          />
                        </div>
                        <NumField
                          label="Width"
                          value={selectedSlot.style?.borderWidth ?? 0}
                          onChange={(v) => updateSlotStyle(selectedSlot.slotId, { borderWidth: v })}
                        />
                        <div>
                          <Label className="text-xs">Style</Label>
                          <Select
                            value={selectedSlot.style?.borderStyle ?? "solid"}
                            onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { borderStyle: v as any })}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="solid">solid</SelectItem>
                              <SelectItem value="dashed">dashed</SelectItem>
                              <SelectItem value="dotted">dotted</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Gradient fill */}
                    <div className="border-t pt-2 space-y-2">
                      <Label className="text-xs uppercase text-muted-foreground flex items-center justify-between">
                        <span className="flex items-center gap-1"><Sparkles className="size-3" /> Gradient fill</span>
                        <Button
                          size="sm"
                          variant={selectedSlot.style?.gradientEnabled ? "default" : "outline"}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => updateSlotStyle(selectedSlot.slotId, {
                            gradientEnabled: !selectedSlot.style?.gradientEnabled,
                            gradientFrom: selectedSlot.style?.gradientFrom ?? "#f97316",
                            gradientTo: selectedSlot.style?.gradientTo ?? "#db2777",
                            gradientAngle: selectedSlot.style?.gradientAngle ?? 90,
                          })}
                        >
                          {selectedSlot.style?.gradientEnabled ? "ON" : "OFF"}
                        </Button>
                      </Label>
                      {selectedSlot.style?.gradientEnabled && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">From</Label>
                              <Input
                                type="color"
                                value={selectedSlot.style?.gradientFrom ?? "#f97316"}
                                onChange={(e) => updateSlotStyle(selectedSlot.slotId, { gradientFrom: e.target.value })}
                                className="h-8 p-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">To</Label>
                              <Input
                                type="color"
                                value={selectedSlot.style?.gradientTo ?? "#db2777"}
                                onChange={(e) => updateSlotStyle(selectedSlot.slotId, { gradientTo: e.target.value })}
                                className="h-8 p-1"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs flex justify-between">
                              <span>Angle (°)</span>
                              <span className="text-muted-foreground">{selectedSlot.style?.gradientAngle ?? 90}</span>
                            </Label>
                            <Slider
                              value={[selectedSlot.style?.gradientAngle ?? 90]}
                              min={0} max={360} step={5}
                              onValueChange={(v) => updateSlotStyle(selectedSlot.slotId, { gradientAngle: v[0] })}
                            />
                          </div>
                        </>
                      )}
                    </div>
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

function FilterSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs flex justify-between">
        <span>{label}</span>
        <span className="text-muted-foreground">{value.toFixed(2)}</span>
      </Label>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
