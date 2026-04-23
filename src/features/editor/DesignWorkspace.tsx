import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlignCenter,
  AlignEndHorizontal,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignVerticalJustifyCenter,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Grid2X2,
  Group,
  Image as ImageIcon,
  Info,
  Layers,
  Lock,
  LockOpen,
  Minus,
  MoveDown,
  MoveUp,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Shapes,
  Table2,
  Trash2,
  Type,
  Ungroup,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTextStyle } from "@/engines/binding/dataBinding";
import { LayoutGuides } from "@/features/render/LayoutGuides";
import { db, saveBlob } from "@/storage/db";
import { makeIdbSrc, resolveImageSrcAsync } from "@/storage/imageSrc";
import type {
  AssetItem,
  BrandKit,
  DesignDocument,
  DesignElement,
  DesignPage,
  EditorMode,
  FontAsset,
} from "@/models";
import { DesignRenderer } from "./DesignRenderer";
import { FONTS } from "./fonts";
import { getBuiltInAssetLibrary, isHeroiconAsset, type HeroiconAsset } from "./designAssets";
import { useDesignEditor } from "./designStore";

type WorkspaceMode = EditorMode;
type AssetPanelItem = AssetItem | HeroiconAsset;
type DesignTool = "select" | "pan" | "crop";
const EMPTY_ASSETS: AssetItem[] = [];
const EMPTY_BRAND_KITS: BrandKit[] = [];
const EMPTY_FONT_ASSETS: FontAsset[] = [];

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function getCanvasPoint(
  canvas: HTMLElement | null,
  scale: number,
  clientX: number,
  clientY: number,
  panX = 0,
  panY = 0,
) {
  const rect = canvas?.getBoundingClientRect();
  return {
    x: (clientX - (rect?.left ?? 0) - panX) / scale,
    y: (clientY - (rect?.top ?? 0) - panY) / scale,
  };
}

function normalizeMarqueeRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

function snapRotation(rotation: number, event: MouseEvent) {
  if (!event.shiftKey) return rotation;
  return Math.round(rotation / 15) * 15;
}

function applyResizeModifiers(
  origin: { x: number; y: number; width: number; height: number },
  handle: string,
  dx: number,
  dy: number,
  keepAspect: boolean,
  fromCenter: boolean,
) {
  let nextX = origin.x;
  let nextY = origin.y;
  let nextWidth = origin.width;
  let nextHeight = origin.height;
  const aspectRatio = origin.width / Math.max(origin.height, 1);

  if (handle.includes("e")) nextWidth = Math.max(20, origin.width + dx);
  if (handle.includes("s")) nextHeight = Math.max(20, origin.height + dy);
  if (handle.includes("w")) {
    nextWidth = Math.max(20, origin.width - dx);
    nextX = origin.x + (origin.width - nextWidth);
  }
  if (handle.includes("n")) {
    nextHeight = Math.max(20, origin.height - dy);
    nextY = origin.y + (origin.height - nextHeight);
  }

  if (keepAspect && !handle.includes("n") && !handle.includes("s")) {
    nextHeight = Math.max(20, nextWidth / aspectRatio);
  } else if (keepAspect && !handle.includes("e") && !handle.includes("w")) {
    nextWidth = Math.max(20, nextHeight * aspectRatio);
  } else if (keepAspect) {
    const widthDrivenHeight = Math.max(20, nextWidth / aspectRatio);
    const heightDrivenWidth = Math.max(20, nextHeight * aspectRatio);
    if (Math.abs(widthDrivenHeight - nextHeight) <= Math.abs(heightDrivenWidth - nextWidth)) {
      nextHeight = widthDrivenHeight;
    } else {
      nextWidth = heightDrivenWidth;
    }
  }

  if (handle.includes("w") && keepAspect) {
    nextX = origin.x + (origin.width - nextWidth);
  }
  if (handle.includes("n") && keepAspect) {
    nextY = origin.y + (origin.height - nextHeight);
  }

  if (fromCenter) {
    nextX = origin.x - (nextWidth - origin.width) / 2;
    nextY = origin.y - (nextHeight - origin.height) / 2;
  }

  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  };
}

function getSelectedElementsByIds(elements: DesignElement[], selectedIds: string[]) {
  return selectedIds
    .map((id) => elements.find((element) => element.elementId === id))
    .filter((element): element is DesignElement => !!element);
}

function getMarqueeSelection(
  elements: DesignElement[],
  marquee: { x: number; y: number; width: number; height: number },
) {
  return elements
    .filter((element) => !element.hidden && !element.locked)
    .filter((element) =>
      rectsIntersect(marquee, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      }),
    )
    .map((element) => element.elementId);
}

function toggleSelectionIds(existing: string[], additions: string[]) {
  const next = new Set(existing);
  for (const id of additions) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return Array.from(next);
}

function mergeSelectionIds(existing: string[], additions: string[]) {
  return Array.from(new Set([...existing, ...additions]));
}

function getSelectionFromMarquee(
  existing: string[],
  additions: string[],
  additive: boolean,
  toggle: boolean,
) {
  if (toggle) return toggleSelectionIds(existing, additions);
  if (additive) return mergeSelectionIds(existing, additions);
  return additions;
}

function formatZoom(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

function getNextZoom(current: number, direction: 1 | -1) {
  const factor = direction > 0 ? 1.1 : 1 / 1.1;
  return Math.min(3, Math.max(0.1, current * factor));
}

function zoomAtPoint(params: {
  currentZoom: number;
  nextZoom: number;
  panX: number;
  panY: number;
  pointX: number;
  pointY: number;
}) {
  const contentX = (params.pointX - params.panX) / params.currentZoom;
  const contentY = (params.pointY - params.panY) / params.currentZoom;
  return {
    panX: params.pointX - contentX * params.nextZoom,
    panY: params.pointY - contentY * params.nextZoom,
  };
}

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function isPanToolActive(tool: DesignTool, spacePressed: boolean) {
  return tool === "pan" || spacePressed;
}

function getToolCursor(tool: DesignTool, spacePressed: boolean) {
  return isPanToolActive(tool, spacePressed) ? "grab" : "default";
}

function getCanvasCursor(elementLocked: boolean, tool: DesignTool, spacePressed: boolean) {
  if (isPanToolActive(tool, spacePressed)) return "grab";
  return elementLocked ? "default" : "move";
}

function zoomByStep(editor: ReturnType<typeof useDesignEditor>, zoom: number, direction: 1 | -1) {
  editor.setZoom(getNextZoom(zoom, direction));
}

const RESIZE_HANDLES = [
  { key: "nw", cursor: "nwse-resize", style: { left: -8, top: -8 } },
  { key: "n", cursor: "ns-resize", style: { left: "50%", top: -8, marginLeft: -8 } },
  { key: "ne", cursor: "nesw-resize", style: { right: -8, top: -8 } },
  { key: "e", cursor: "ew-resize", style: { right: -8, top: "50%", marginTop: -8 } },
  { key: "se", cursor: "nwse-resize", style: { right: -8, bottom: -8 } },
  { key: "s", cursor: "ns-resize", style: { left: "50%", bottom: -8, marginLeft: -8 } },
  { key: "sw", cursor: "nesw-resize", style: { left: -8, bottom: -8 } },
  { key: "w", cursor: "ew-resize", style: { left: -8, top: "50%", marginTop: -8 } },
] as const;

function getSelectionBounds(elements: DesignElement[]) {
  if (elements.length === 0) return null;
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getDescendantIds(elements: DesignElement[], parentId: string): string[] {
  const out = new Set<string>();
  const walk = (currentParentId: string) => {
    for (const element of elements) {
      if (element.parentId !== currentParentId || out.has(element.elementId)) continue;
      out.add(element.elementId);
      walk(element.elementId);
    }
  };
  walk(parentId);
  return Array.from(out);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getMoveTargets(selected: DesignElement[]): string[] {
  const ids = new Set<string>();
  for (const element of selected) {
    ids.add(element.elementId);
  }
  for (const element of selected) {
    if (element.kind !== "group") continue;
    getDescendantIds(selected, element.elementId).forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

function snapMove(
  page: DesignPage,
  element: DesignElement,
  x: number,
  y: number,
  otherElements: DesignElement[],
  scale: number,
) {
  const threshold = Math.max(6, 12 / Math.max(scale, 0.1));
  const snapLines: Array<{ axis: "x" | "y"; value: number }> = [];
  const snapTargetIds = new Set<string>();
  let nextX = x;
  let nextY = y;
  const safe = page.safeZone;

  const evaluateAxis = (
    candidates: Array<{ position: number; lineValue: number }>,
    targets: Array<{ position: number; lineValue: number; elementId?: string }>,
    axis: "x" | "y",
  ) => {
    let best:
      | {
          delta: number;
          lineValue: number;
          elementId?: string;
        }
      | undefined;

    for (const candidate of candidates) {
      for (const target of targets) {
        const delta = target.position - candidate.position;
        if (Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, lineValue: target.lineValue, elementId: target.elementId };
        }
      }
    }

    if (!best) return;
    if (axis === "x") nextX += best.delta;
    if (axis === "y") nextY += best.delta;
    snapLines.push({ axis, value: best.lineValue });
    if (best.elementId) snapTargetIds.add(best.elementId);
  };

  const xCandidates = [
    { position: nextX, lineValue: nextX },
    { position: nextX + element.width / 2, lineValue: nextX + element.width / 2 },
    { position: nextX + element.width, lineValue: nextX + element.width },
  ];
  const yCandidates = [
    { position: nextY, lineValue: nextY },
    { position: nextY + element.height / 2, lineValue: nextY + element.height / 2 },
    { position: nextY + element.height, lineValue: nextY + element.height },
  ];
  const xTargets = [
    { position: 0, lineValue: 0 },
    { position: page.width / 2, lineValue: page.width / 2 },
    { position: page.width, lineValue: page.width },
  ];
  const yTargets = [
    { position: 0, lineValue: 0 },
    { position: page.height / 2, lineValue: page.height / 2 },
    { position: page.height, lineValue: page.height },
  ];

  for (const other of otherElements) {
    xTargets.push(
      { position: other.x, lineValue: other.x, elementId: other.elementId },
      {
        position: other.x + other.width / 2,
        lineValue: other.x + other.width / 2,
        elementId: other.elementId,
      },
      {
        position: other.x + other.width,
        lineValue: other.x + other.width,
        elementId: other.elementId,
      },
    );
    yTargets.push(
      { position: other.y, lineValue: other.y, elementId: other.elementId },
      {
        position: other.y + other.height / 2,
        lineValue: other.y + other.height / 2,
        elementId: other.elementId,
      },
      {
        position: other.y + other.height,
        lineValue: other.y + other.height,
        elementId: other.elementId,
      },
    );
  }

  if (safe) {
    xTargets.push(
      { position: safe.left, lineValue: safe.left },
      { position: page.width - safe.right, lineValue: page.width - safe.right },
    );
    yTargets.push(
      { position: safe.top, lineValue: safe.top },
      { position: page.height - safe.bottom, lineValue: page.height - safe.bottom },
    );
  }

  evaluateAxis(xCandidates, xTargets, "x");
  evaluateAxis(yCandidates, yTargets, "y");

  return { x: nextX, y: nextY, snapLines, snapTargetIds: Array.from(snapTargetIds) };
}

function snapResize(
  page: DesignPage,
  elementId: string,
  handle: string,
  rect: { x: number; y: number; width: number; height: number },
  otherElements: DesignElement[],
  scale: number,
) {
  const threshold = Math.max(6, 12 / Math.max(scale, 0.1));
  const snapLines: Array<{ axis: "x" | "y"; value: number }> = [];
  const snapTargetIds = new Set<string>();
  const next = { ...rect };

  const xTargets = [
    { position: 0, lineValue: 0 },
    { position: page.width / 2, lineValue: page.width / 2 },
    { position: page.width, lineValue: page.width },
  ];
  const yTargets = [
    { position: 0, lineValue: 0 },
    { position: page.height / 2, lineValue: page.height / 2 },
    { position: page.height, lineValue: page.height },
  ];

  for (const other of otherElements) {
    xTargets.push(
      { position: other.x, lineValue: other.x, elementId: other.elementId },
      {
        position: other.x + other.width / 2,
        lineValue: other.x + other.width / 2,
        elementId: other.elementId,
      },
      {
        position: other.x + other.width,
        lineValue: other.x + other.width,
        elementId: other.elementId,
      },
    );
    yTargets.push(
      { position: other.y, lineValue: other.y, elementId: other.elementId },
      {
        position: other.y + other.height / 2,
        lineValue: other.y + other.height / 2,
        elementId: other.elementId,
      },
      {
        position: other.y + other.height,
        lineValue: other.y + other.height,
        elementId: other.elementId,
      },
    );
  }

  if (page.safeZone) {
    xTargets.push(
      { position: page.safeZone.left, lineValue: page.safeZone.left },
      {
        position: page.width - page.safeZone.right,
        lineValue: page.width - page.safeZone.right,
      },
    );
    yTargets.push(
      { position: page.safeZone.top, lineValue: page.safeZone.top },
      {
        position: page.height - page.safeZone.bottom,
        lineValue: page.height - page.safeZone.bottom,
      },
    );
  }

  const pickClosest = (
    candidate: number,
    targets: Array<{ position: number; lineValue: number; elementId?: string }>,
  ) => {
    let best:
      | {
          delta: number;
          lineValue: number;
          elementId?: string;
        }
      | undefined;
    for (const target of targets) {
      const delta = target.position - candidate;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, lineValue: target.lineValue, elementId: target.elementId };
      }
    }
    return best;
  };

  if (handle.includes("e")) {
    const best = pickClosest(next.x + next.width, xTargets);
    if (best) {
      next.width = Math.max(20, next.width + best.delta);
      snapLines.push({ axis: "x", value: best.lineValue });
      if (best.elementId) snapTargetIds.add(best.elementId);
    }
  }
  if (handle.includes("w")) {
    const best = pickClosest(next.x, xTargets);
    if (best) {
      next.x += best.delta;
      next.width = Math.max(20, rect.x + rect.width - next.x);
      snapLines.push({ axis: "x", value: best.lineValue });
      if (best.elementId) snapTargetIds.add(best.elementId);
    }
  }
  if (handle.includes("s")) {
    const best = pickClosest(next.y + next.height, yTargets);
    if (best) {
      next.height = Math.max(20, next.height + best.delta);
      snapLines.push({ axis: "y", value: best.lineValue });
      if (best.elementId) snapTargetIds.add(best.elementId);
    }
  }
  if (handle.includes("n")) {
    const best = pickClosest(next.y, yTargets);
    if (best) {
      next.y += best.delta;
      next.height = Math.max(20, rect.y + rect.height - next.y);
      snapLines.push({ axis: "y", value: best.lineValue });
      if (best.elementId) snapTargetIds.add(best.elementId);
    }
  }

  return {
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: Math.round(next.width),
    height: Math.round(next.height),
    snapLines,
    snapTargetIds: Array.from(snapTargetIds),
  };
}

async function registerFontAsset(fontAsset: FontAsset) {
  const src = await resolveImageSrcAsync(fontAsset.sourceValue);
  const usableSrc = src ?? fontAsset.sourceValue;
  if (!usableSrc) return;
  const font = new FontFace(fontAsset.family, `url(${usableSrc})`, {
    style: fontAsset.style ?? "normal",
    weight: String(fontAsset.weight ?? 400),
  });
  await font.load();
  document.fonts.add(font);
}

function layerTree(
  elements: DesignElement[],
  parentId?: string,
  depth = 0,
): Array<{ element: DesignElement; depth: number }> {
  return elements
    .filter((element) => element.parentId === parentId)
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
    .flatMap((element) => [
      { element, depth },
      ...layerTree(elements, element.elementId, depth + 1),
    ]);
}

export function DesignWorkspace({
  initialDocument,
  mode,
  onSave,
  onClose,
  allowMultiplePages = true,
}: {
  initialDocument: DesignDocument;
  mode?: WorkspaceMode;
  onSave?: (document: DesignDocument) => void | Promise<void>;
  onClose?: () => void;
  allowMultiplePages?: boolean;
}) {
  const workspaceDocument = useMemo(
    () => ({
      ...initialDocument,
      mode: mode ?? initialDocument.mode,
    }),
    [initialDocument, mode],
  );
  const editor = useDesignEditor(workspaceDocument);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftTab, setLeftTab] = useState("insert");
  const [rightTab, setRightTab] = useState("properties");
  const [assetSearch, setAssetSearch] = useState("");
  const [iconSearch, setIconSearch] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [selectedIconId, setSelectedIconId] = useState("");
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState("");
  const [snapTargetIds, setSnapTargetIds] = useState<string[]>([]);
  const [tool, setTool] = useState<DesignTool>("select");
  const [spacePressed, setSpacePressed] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panCursor, setPanCursor] = useState<"grab" | "grabbing">("grab");
  const [viewportDrag, setViewportDrag] = useState<{ startX: number; startY: number } | null>(null);
  const assetLibraryQuery = useLiveQuery(
    () => db.assetLibrary.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const brandKitsQuery = useLiveQuery(
    () => db.brandKits.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const fontAssetsQuery = useLiveQuery(
    () => db.fontAssets.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const assetLibrary = assetLibraryQuery ?? EMPTY_ASSETS;
  const brandKits = brandKitsQuery ?? EMPTY_BRAND_KITS;
  const fontAssets = fontAssetsQuery ?? EMPTY_FONT_ASSETS;
  const builtInAssets = useMemo(() => getBuiltInAssetLibrary(), []);
  const uploadedAssets = assetLibrary.filter((asset) => !isHeroiconAsset(asset));
  const iconAssets = builtInAssets.filter(isHeroiconAsset);
  const filteredIconAssets = useMemo(() => {
    const query = iconSearch.trim().toLowerCase();
    if (!query) return iconAssets;
    return iconAssets.filter((asset) => {
      const haystack = [asset.name, ...(asset.tags ?? [])].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [iconAssets, iconSearch]);
  const selectedIconAsset =
    iconAssets.find((asset) => asset.assetId === selectedIconId) ?? filteredIconAssets[0] ?? null;
  const availableFontFamilies = useMemo(() => {
    const fromGoogle = FONTS.map((font) => font.family);
    const fromUpload = fontAssets.map((fontAsset) => fontAsset.family);
    return Array.from(new Set([...fromGoogle, ...fromUpload])).sort((a, b) => a.localeCompare(b));
  }, [fontAssets]);
  const libraryAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    const merged = uploadedAssets;
    return merged.filter((asset) => {
      const haystack = [asset.name, ...(asset.tags ?? [])].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [uploadedAssets, assetSearch]);

  useEffect(() => {
    fontAssets.forEach((fontAsset) => {
      registerFontAsset(fontAsset).catch(() => undefined);
    });
  }, [fontAssets]);

  useEffect(() => {
    if (!selectedIconId && iconAssets[0]) {
      setSelectedIconId(iconAssets[0].assetId);
    }
  }, [iconAssets, selectedIconId]);

  useEffect(() => {
    if (!editingTextId) return;
    const current = editor.activeElements.find((element) => element.elementId === editingTextId);
    if (!current || current.kind !== "text") {
      setEditingTextId(null);
      setEditingTextValue("");
    }
  }, [editingTextId, editor.activeElements]);

  const activePage = editor.activePage;
  const selected = editor.selectedElements;
  const primary = selected.at(-1) ?? null;
  const zoom = editor.state.viewport.zoom;
  const currentBrandKit =
    brandKits.find((kit) => kit.brandKitId === editor.state.brandKitId) ?? brandKits[0] ?? null;

  const persistBrandKitSelection = async (brandKitId: string | undefined) => {
    editor.setBrandKit(brandKitId);
  };

  const handleSave = async () => {
    if (!onSave) return;
    await onSave(editor.document);
    toast.success("Đã lưu thay đổi");
  };

  const runExport = async (label: "json" | "png" | "jpg" | "svg" | "pdf") => {
    try {
      const exporter = await import("./exportDesign");
      if (label === "json") exporter.exportDesignDocumentJson(editor.document);
      if (label === "png") await exporter.exportDesignPagePng({ document: editor.document });
      if (label === "jpg") await exporter.exportDesignPageJpg({ document: editor.document });
      if (label === "svg") await exporter.exportDesignPageSvg({ document: editor.document });
      if (label === "pdf") await exporter.exportDesignDocumentPdf({ document: editor.document });
      toast.success(`Đã export ${label.toUpperCase()}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Export ${label.toUpperCase()} thất bại`,
      );
    }
  };

  const insertText = () => {
    if (!activePage) return;
    const elementId = nanoid();
    editor.insertElement({
      elementId,
      pageId: activePage.pageId,
      kind: "text",
      name: "Text",
      x: 120,
      y: 120,
      width: 420,
      height: 120,
      zIndex: editor.activeElements.length,
      text: "Text mới",
      style: {
        fontFamily: currentBrandKit?.fontAssetIds.length
          ? (fontAssets.find((item) => item.fontAssetId === currentBrandKit.fontAssetIds[0])
              ?.family ?? "Be Vietnam Pro")
          : "Be Vietnam Pro",
        fontSize: 48,
        fontWeight: 700,
        color: "#0f172a",
        lineHeight: 1.2,
      },
      textRuns: [],
    });
  };

  const insertShape = (shapeKind: "rectangle" | "circle" | "triangle" | "line" = "rectangle") => {
    if (!activePage) return;
    editor.insertElement({
      elementId: nanoid(),
      pageId: activePage.pageId,
      kind: "shape",
      name: "Shape",
      x: 160,
      y: 180,
      width: shapeKind === "line" ? 320 : 240,
      height: shapeKind === "line" ? 20 : 180,
      zIndex: editor.activeElements.length,
      shapeKind,
      text: "",
      style: {
        fill: shapeKind === "line" ? "#0f172a" : "#f97316",
        borderRadius: shapeKind === "circle" ? 9999 : 18,
        strokeWidth: shapeKind === "line" ? 4 : undefined,
      },
    });
  };

  const insertTable = () => {
    if (!activePage) return;
    editor.insertElement({
      elementId: nanoid(),
      pageId: activePage.pageId,
      kind: "table",
      name: "Table",
      x: 120,
      y: 220,
      width: 560,
      height: 300,
      zIndex: editor.activeElements.length,
      columns: 3,
      rows: 4,
      cells: Array.from({ length: 12 }, (_, index) => ({
        cellId: `cell-${index}`,
        text: index < 3 ? `Header ${index + 1}` : "",
      })),
      style: {
        fill: "#ffffff",
        color: "#0f172a",
        fontSize: 18,
      },
    });
  };

  const insertImageFrame = () => {
    if (!activePage) return;
    editor.insertElement({
      elementId: nanoid(),
      pageId: activePage.pageId,
      kind: "image",
      name: "Image",
      x: 140,
      y: 160,
      width: 320,
      height: 420,
      zIndex: editor.activeElements.length,
      src: "",
      style: {
        fit: "cover",
        borderRadius: 24,
      },
    });
  };

  const insertAsset = (asset: AssetPanelItem) => {
    if (!activePage) return;
    if (isHeroiconAsset(asset)) {
      editor.insertElement({
        elementId: nanoid(),
        pageId: activePage.pageId,
        kind: "icon",
        name: asset.name,
        x: 160,
        y: 160,
        width: 180,
        height: 180,
        zIndex: editor.activeElements.length,
        iconName: asset.iconName,
        assetId: asset.assetId,
        style: {
          tint: "#0f172a",
          color: "#0f172a",
        },
      });
      return;
    }

    if (asset.kind === "svg") {
      editor.insertElement({
        elementId: nanoid(),
        pageId: activePage.pageId,
        kind: "svg",
        name: asset.name,
        x: 160,
        y: 160,
        width: 180,
        height: 180,
        zIndex: editor.activeElements.length,
        svgContent: asset.sourceValue,
        assetId: asset.assetId,
        style: {
          tint: "#0f172a",
          color: "#0f172a",
        },
      });
      return;
    }

    editor.insertElement({
      elementId: nanoid(),
      pageId: activePage.pageId,
      kind: "image",
      name: asset.name,
      x: 160,
      y: 160,
      width: 320,
      height: 320,
      zIndex: editor.activeElements.length,
      src: asset.sourceValue,
      assetId: asset.assetId,
      style: {
        fit: "cover",
        borderRadius: 24,
      },
    });
  };

  const uploadAsset = async (kind: AssetItem["kind"] = "image") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "image" || kind === "logo" ? "image/*" : ".svg";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const blobKey = await saveBlob(file);
      const asset: AssetItem = {
        assetId: nanoid(),
        name: file.name.replace(/\.[^.]+$/, ""),
        kind,
        sourceType: "local",
        sourceValue: makeIdbSrc(blobKey),
        blobKey,
        mime: file.type,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.assetLibrary.put(asset);
      editor.setAssetIds([...editor.state.assetIds, asset.assetId]);
      if (kind !== "logo") insertAsset(asset);
      toast.success("Đã thêm asset");
    };
    input.click();
  };

  const deleteAsset = async (asset: AssetItem) => {
    await db.assetLibrary.delete(asset.assetId);
    editor.setAssetIds(editor.state.assetIds.filter((id) => id !== asset.assetId));
    toast.success(`Đã xoá asset "${asset.name}"`);
  };

  const uploadFont = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".woff,.woff2,.ttf,.otf";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const blobKey = await saveBlob(file);
      const family = file.name.replace(/\.[^.]+$/, "");
      const fontAsset: FontAsset = {
        fontAssetId: nanoid(),
        family,
        sourceValue: makeIdbSrc(blobKey),
        blobKey,
        format: file.name.split(".").pop()?.toLowerCase(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.fontAssets.put(fontAsset);
      await registerFontAsset(fontAsset);
      toast.success(`Đã thêm font ${family}`);
    };
    input.click();
  };

  const createBrandKit = async () => {
    const brandKit: BrandKit = {
      brandKitId: nanoid(),
      name: `Brand Kit ${brandKits.length + 1}`,
      colors: ["#0f172a", "#f97316", "#f8fafc"],
      logoAssetIds: [],
      fontAssetIds: [],
      presets: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.brandKits.put(brandKit);
    await persistBrandKitSelection(brandKit.brandKitId);
    toast.success("Đã tạo Brand Kit");
  };

  const updateBrandKit = async (patch: Partial<BrandKit>) => {
    if (!currentBrandKit) return;
    await db.brandKits.put({
      ...currentBrandKit,
      ...patch,
      updatedAt: Date.now(),
    });
  };

  const toggleSafeZone = () => {
    editor.updateDocumentSettings({
      showSafeZone: !editor.state.documentSettings.showSafeZone,
    });
  };

  const openPropertiesPanel = () => {
    setRightOpen(true);
    setRightTab("properties");
  };

  const getSelectionActionIds = () => {
    const ids = new Set<string>(editor.state.selection.ids);
    selected.forEach((element) => {
      if (element.kind !== "group") return;
      getDescendantIds(editor.activeElements, element.elementId).forEach((id) => ids.add(id));
    });
    return Array.from(ids);
  };

  const moveSelectionBy = (dx: number, dy: number) => {
    const ids = getSelectionActionIds();
    if (ids.length === 0) return;
    editor.updateElements(ids, (element) => ({
      x: Math.round(element.x + dx),
      y: Math.round(element.y + dy),
    }));
  };

  const alignSelectionToPage = (
    mode: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) => {
    if (!activePage || selected.length === 0) return;
    const bounds = getSelectionBounds(selected);
    if (!bounds) return;
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = -bounds.x;
    if (mode === "center") dx = activePage.width / 2 - (bounds.x + bounds.width / 2);
    if (mode === "right") dx = activePage.width - (bounds.x + bounds.width);
    if (mode === "top") dy = -bounds.y;
    if (mode === "middle") dy = activePage.height / 2 - (bounds.y + bounds.height / 2);
    if (mode === "bottom") dy = activePage.height - (bounds.y + bounds.height);
    moveSelectionBy(dx, dy);
  };

  const showSelectionInfo = () => {
    const bounds = getSelectionBounds(selected);
    if (!primary) return;
    const info = bounds
      ? `${primary.name ?? primary.kind} · ${Math.round(bounds.width)}×${Math.round(bounds.height)}`
      : (primary.name ?? primary.kind);
    toast.message(info);
    openPropertiesPanel();
  };

  const startInlineTextEdit = (elementId: string) => {
    const element = editor.activeElements.find((item) => item.elementId === elementId);
    if (!element || element.kind !== "text") return;
    editor.setSelection([elementId], elementId);
    setEditingTextId(elementId);
    setEditingTextValue(element.text);
  };

  const commitInlineTextEdit = () => {
    if (!editingTextId) return;
    editor.updateElements([editingTextId], { text: editingTextValue }, { history: false });
    setEditingTextId(null);
  };

  const cancelInlineTextEdit = () => {
    setEditingTextId(null);
    setEditingTextValue("");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === " ") {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (isEditableTarget(event.target)) return;

      const mod = event.ctrlKey || event.metaKey;
      const lower = event.key.toLowerCase();

      if (lower === "v" && !mod) {
        event.preventDefault();
        setTool("select");
        return;
      }
      if (lower === "h" && !mod) {
        event.preventDefault();
        setTool("pan");
        return;
      }
      if (lower === "t" && !mod) {
        event.preventDefault();
        insertText();
        return;
      }
      if (lower === "r" && !mod) {
        event.preventDefault();
        insertShape("rectangle");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (editingTextId) {
          cancelInlineTextEdit();
          return;
        }
        editor.setSelection([]);
        setMarqueeRect(null);
        return;
      }
      if (mod && lower === "a") {
        event.preventDefault();
        const selectableIds = editor.activeElements
          .filter((element) => !element.hidden)
          .map((element) => element.elementId);
        editor.setSelection(selectableIds, selectableIds.at(-1) ?? null);
        return;
      }
      if (mod && lower === "z" && !event.shiftKey) {
        event.preventDefault();
        editor.undo();
        return;
      }
      if (mod && ((lower === "z" && event.shiftKey) || lower === "y")) {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (mod && lower === "c") {
        event.preventDefault();
        editor.copySelection();
        return;
      }
      if (mod && lower === "v") {
        event.preventDefault();
        editor.pasteClipboard();
        return;
      }
      if (mod && lower === "d") {
        event.preventDefault();
        editor.duplicateSelection();
        return;
      }
      if (mod && lower === "g" && event.shiftKey) {
        event.preventDefault();
        editor.ungroupSelection();
        return;
      }
      if (mod && lower === "g") {
        event.preventDefault();
        editor.groupSelection();
        return;
      }
      if (mod && event.key === "]") {
        event.preventDefault();
        if (event.altKey) editor.orderSelection("front");
        else editor.orderSelection("forward");
        return;
      }
      if (mod && event.key === "[") {
        event.preventDefault();
        if (event.altKey) editor.orderSelection("back");
        else editor.orderSelection("backward");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length > 0) {
        event.preventDefault();
        editor.deleteSelection();
        return;
      }
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        if (selected.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const moveTargets = new Set<string>();
        selected.forEach((element) => {
          moveTargets.add(element.elementId);
          getDescendantIds(editor.activeElements, element.elementId).forEach((id) =>
            moveTargets.add(id),
          );
        });
        editor.updateElements(Array.from(moveTargets), (element) => ({
          x: element.x + dx,
          y: element.y + dy,
        }));
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") {
        setSpacePressed(false);
        setIsPanning(false);
        setPanCursor("grab");
        setViewportDrag(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    editor,
    selected,
    editingTextId,
    cancelInlineTextEdit,
    insertShape,
    insertText,
  ]);

  useEffect(() => {
    if (!spacePressed) return;
    setPanCursor("grab");
  }, [spacePressed]);

  useEffect(() => {
    if (!stageWrapRef.current) return;
    stageWrapRef.current.style.cursor = isPanning ? "grabbing" : getToolCursor(tool, spacePressed);
  }, [tool, spacePressed, isPanning]);

  const handleZoomStep = (direction: 1 | -1) => {
    zoomByStep(editor, zoom, direction);
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const currentZoom = zoom;
    const nextZoom = getNextZoom(currentZoom, event.deltaY < 0 ? 1 : -1);
    const wrapRect = stageWrapRef.current?.getBoundingClientRect();
    const pointX = event.clientX - (wrapRect?.left ?? 0);
    const pointY = event.clientY - (wrapRect?.top ?? 0);
    const nextPan = zoomAtPoint({
      currentZoom,
      nextZoom,
      panX: editor.state.viewport.panX,
      panY: editor.state.viewport.panY,
      pointX,
      pointY,
    });
    editor.setPan(nextPan.panX, nextPan.panY);
    editor.setZoom(nextZoom);
  };

  const beginPan = (clientX: number, clientY: number) => {
    setIsPanning(true);
    setPanCursor("grabbing");
    setViewportDrag({ startX: clientX, startY: clientY });
  };

  const updatePan = (clientX: number, clientY: number) => {
    setViewportDrag((prev) => {
      if (!prev) return prev;
      editor.setPan(
        editor.state.viewport.panX + (clientX - prev.startX),
        editor.state.viewport.panY + (clientY - prev.startY),
      );
      return { startX: clientX, startY: clientY };
    });
  };

  const endPan = () => {
    setIsPanning(false);
    setPanCursor("grab");
    setViewportDrag(null);
  };

  const handleStageBackgroundMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const canvas = event.currentTarget;
    if (isPanToolActive(tool, spacePressed)) {
      beginPan(event.clientX, event.clientY);
      const onMouseMove = (moveEvent: MouseEvent) => updatePan(moveEvent.clientX, moveEvent.clientY);
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        endPan();
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      return;
    }

    if (event.target !== event.currentTarget) return;
    onSelect(null, false);
    const additive = event.shiftKey;
    const toggle = event.ctrlKey || event.metaKey;
    const start = getCanvasPoint(
      canvas,
      scale,
      event.clientX,
      event.clientY,
      editor.state.viewport.panX,
      editor.state.viewport.panY,
    );
    setMarqueeRect({ x: start.x, y: start.y, width: 0, height: 0 });

    const onMouseMove = (moveEvent: MouseEvent) => {
      const point = getCanvasPoint(
        canvas,
        scale,
        moveEvent.clientX,
        moveEvent.clientY,
        editor.state.viewport.panX,
        editor.state.viewport.panY,
      );
      const rect = normalizeMarqueeRect(start, point);
      setMarqueeRect(rect);
      const nextIds = getSelectionFromMarquee(
        editor.state.selection.ids,
        getMarqueeSelection(editor.activeElements, rect),
        additive,
        toggle,
      );
      editor.setSelection(nextIds, nextIds.at(-1) ?? null);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setMarqueeRect(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const selectedBounds = getSelectionBounds(selected);
  const stageCursor = isPanning ? panCursor : getToolCursor(tool, spacePressed);

  const renderElementContextMenu = (element: DesignElement) => {
    const hasSelection = selected.length > 0;
    const canGroup = selected.length > 1;
    const canUngroup = selected.some((item) => item.kind === "group");
    return (
      <ContextMenuContent className="w-72">
        <ContextMenuItem onSelect={() => editor.copySelection()} disabled={!hasSelection}>
          <Copy className="mr-2 size-4" />
          Sao chép
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => editor.pasteClipboard()}
          disabled={!editor.state.clipboard?.length}
        >
          <ClipboardPaste className="mr-2 size-4" />
          Dán
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editor.duplicateSelection()} disabled={!hasSelection}>
          <Layers className="mr-2 size-4" />
          Tạo bản sao
          <ContextMenuShortcut>Ctrl+D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editor.deleteSelection()} disabled={!hasSelection}>
          <Trash2 className="mr-2 size-4" />
          Xóa
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => editor.orderSelection("front")} disabled={!hasSelection}>
          Lên trên cùng
          <ContextMenuShortcut>Ctrl+Alt+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editor.orderSelection("forward")} disabled={!hasSelection}>
          Lên một lớp
          <ContextMenuShortcut>Ctrl+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => editor.orderSelection("backward")}
          disabled={!hasSelection}
        >
          Xuống một lớp
          <ContextMenuShortcut>Ctrl+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editor.orderSelection("back")} disabled={!hasSelection}>
          Xuống dưới cùng
          <ContextMenuShortcut>Ctrl+Alt+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Căn chỉnh theo trang</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <ContextMenuItem onSelect={() => alignSelectionToPage("left")}>
              Căn trái
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => alignSelectionToPage("center")}>
              Căn giữa ngang
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => alignSelectionToPage("right")}>
              Căn phải
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => alignSelectionToPage("top")}>Căn trên</ContextMenuItem>
            <ContextMenuItem onSelect={() => alignSelectionToPage("middle")}>
              Căn giữa dọc
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => alignSelectionToPage("bottom")}>
              Căn dưới
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => editor.groupSelection()} disabled={!canGroup}>
          <Group className="mr-2 size-4" />
          Tạo thành phần
          <ContextMenuShortcut>Ctrl+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => editor.ungroupSelection()} disabled={!canUngroup}>
          <Ungroup className="mr-2 size-4" />
          Bỏ nhóm
          <ContextMenuShortcut>Ctrl+Shift+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            editor.updateElements(
              [element.elementId],
              { locked: !element.locked },
              { history: false },
            )
          }
        >
          {element.locked ? <LockOpen className="mr-2 size-4" /> : <Lock className="mr-2 size-4" />}
          {element.locked ? "Mở khóa" : "Khóa"}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            editor.updateElements(
              [element.elementId],
              { hidden: !element.hidden },
              { history: false },
            )
          }
        >
          {element.hidden ? <Eye className="mr-2 size-4" /> : <EyeOff className="mr-2 size-4" />}
          {element.hidden ? "Hiện thành phần" : "Ẩn thành phần"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={openPropertiesPanel}>
          <PanelRight className="mr-2 size-4" />
          Mở thuộc tính
        </ContextMenuItem>
        <ContextMenuItem onSelect={showSelectionInfo}>
          <Info className="mr-2 size-4" />
          Thông tin
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const renderCanvasContextMenu = () => (
    <ContextMenuContent className="w-64">
      <ContextMenuLabel>Canvas</ContextMenuLabel>
      <ContextMenuItem
        onSelect={() => editor.pasteClipboard()}
        disabled={!editor.state.clipboard?.length}
      >
        <ClipboardPaste className="mr-2 size-4" />
        Dán
        <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={insertText}>
        <Type className="mr-2 size-4" />
        Thêm text
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => insertShape("rectangle")}>
        <Shapes className="mr-2 size-4" />
        Thêm shape
      </ContextMenuItem>
      <ContextMenuItem onSelect={insertImageFrame}>
        <ImageIcon className="mr-2 size-4" />
        Thêm khung ảnh
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem
        checked={editor.state.documentSettings.showSafeZone}
        onCheckedChange={toggleSafeZone}
      >
        Hiện khung an toàn
      </ContextMenuCheckboxItem>
    </ContextMenuContent>
  );

  if (!activePage) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Input
          value={editor.document.name}
          onChange={(event) => editor.setName(event.target.value)}
          className="h-9 max-w-sm"
        />
        <div className="flex items-center gap-1 rounded-lg border px-1 py-1">
          <Button size="icon" variant="ghost" onClick={() => handleZoomStep(-1)}>
            <ZoomOut className="size-4" />
          </Button>
          <div className="w-16 text-center text-sm">{formatZoom(zoom)}</div>
          <Button size="icon" variant="ghost" onClick={() => handleZoomStep(1)}>
            <ZoomIn className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border px-1 py-1">
          <Button size="sm" variant={tool === "select" ? "default" : "ghost"} onClick={() => setTool("select")}>
            Select
          </Button>
          <Button size="sm" variant={tool === "pan" ? "default" : "ghost"} onClick={() => setTool("pan")}>
            Pan
          </Button>
        </div>
        <Button
          size="sm"
          variant={editor.state.documentSettings.showSafeZone ? "default" : "outline"}
          onClick={toggleSafeZone}
        >
          Khung an toàn
        </Button>
        <Button
          size="sm"
          variant={editor.state.documentSettings.showGrid ? "default" : "outline"}
          onClick={() =>
            editor.updateDocumentSettings({
              showGrid: !editor.state.documentSettings.showGrid,
            })
          }
        >
          Grid
        </Button>
        <Button
          size="sm"
          variant={editor.state.documentSettings.showGuides ? "default" : "outline"}
          onClick={() =>
            editor.updateDocumentSettings({
              showGuides: !editor.state.documentSettings.showGuides,
            })
          }
        >
          Guides
        </Button>
        <Button
          size="sm"
          variant={spacePressed ? "default" : "outline"}
          onClick={() => setSpacePressed((value) => !value)}
        >
          Hand (Space)
        </Button>
        <div className="text-xs text-muted-foreground">Pan: {Math.round(editor.state.viewport.panX)}, {Math.round(editor.state.viewport.panY)}</div>
        <div className="flex items-center gap-1 rounded-lg border px-1 py-1">
          <Button size="icon" variant="ghost" onClick={() => editor.alignSelection("left")}>
            <AlignStartHorizontal className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.alignSelection("center")}>
            <AlignCenter className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.alignSelection("right")}>
            <AlignEndHorizontal className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.alignSelection("middle")}>
            <AlignVerticalJustifyCenter className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => editor.distributeSelection("horizontal")}
          >
            <AlignHorizontalJustifyCenter className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border px-1 py-1">
          <Button size="icon" variant="ghost" onClick={editor.undo} disabled={!editor.canUndo}>
            <MoveUp className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={editor.redo} disabled={!editor.canRedo}>
            <MoveDown className="size-4" />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => runExport("json")}>
            JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => runExport("png")}>
            PNG
          </Button>
          <Button size="sm" variant="outline" onClick={() => runExport("jpg")}>
            JPG
          </Button>
          <Button size="sm" variant="outline" onClick={() => runExport("svg")}>
            SVG
          </Button>
          <Button size="sm" variant="outline" onClick={() => runExport("pdf")}>
            PDF
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setLeftOpen((value) => !value)}>
            <PanelLeft className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setRightOpen((value) => !value)}>
            <PanelRight className="size-4" />
          </Button>
          {onClose ? (
            <Button variant="outline" onClick={onClose}>
              Đóng
            </Button>
          ) : null}
          {onSave ? (
            <Button onClick={handleSave}>
              <Save className="mr-2 size-4" />
              Lưu
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${leftOpen ? 320 : 0}px minmax(0,1fr) ${rightOpen ? 340 : 0}px`,
        }}
      >
        {leftOpen ? (
          <aside className="min-h-0 overflow-hidden border-r">
            <Tabs value={leftTab} onValueChange={setLeftTab} className="flex h-full flex-col">
              <TabsList className="mx-4 mt-4 grid grid-cols-3">
                <TabsTrigger value="insert">Insert</TabsTrigger>
                <TabsTrigger value="assets">Assets</TabsTrigger>
                <TabsTrigger value="pages">Pages</TabsTrigger>
              </TabsList>
              <TabsContent value="insert" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-2 pt-4">
                  <Button className="w-full justify-start" variant="outline" onClick={insertText}>
                    <Type className="mr-2 size-4" /> Text
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={insertImageFrame}
                  >
                    <ImageIcon className="mr-2 size-4" /> Image
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => insertShape("rectangle")}
                  >
                    <Shapes className="mr-2 size-4" /> Rectangle
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => insertShape("circle")}
                  >
                    <Shapes className="mr-2 size-4" /> Circle
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => insertShape("line")}
                  >
                    <Minus className="mr-2 size-4" /> Line
                  </Button>
                  <Button className="w-full justify-start" variant="outline" onClick={insertTable}>
                    <Table2 className="mr-2 size-4" /> Table
                  </Button>
                  <div className="rounded-xl border bg-card p-3">
                    <Label className="text-xs uppercase text-muted-foreground">Icon</Label>
                    <div className="mt-3 space-y-2">
                      <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button className="w-full justify-between" variant="outline">
                            <span className="flex items-center gap-2 truncate">
                              {selectedIconAsset ? (
                                <selectedIconAsset.component className="size-4 shrink-0" />
                              ) : (
                                <Plus className="size-4 shrink-0" />
                              )}
                              <span className="truncate">
                                {selectedIconAsset?.name ?? "Chọn Heroicon"}
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {filteredIconAssets.length}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[280px] p-3">
                          <div className="space-y-3">
                            <Input
                              value={iconSearch}
                              onChange={(event) => setIconSearch(event.target.value)}
                              placeholder="Tìm Heroicon"
                            />
                            <ScrollArea className="h-72">
                              <div className="grid grid-cols-5 gap-2 pr-3">
                                {filteredIconAssets.map((asset) => (
                                  <button
                                    key={asset.assetId}
                                    type="button"
                                    onClick={() => {
                                      setSelectedIconId(asset.assetId);
                                      insertAsset(asset);
                                      setIconPickerOpen(false);
                                    }}
                                    className={
                                      "flex aspect-square items-center justify-center rounded-lg border bg-background transition " +
                                      (asset.assetId === selectedIconId
                                        ? "border-primary bg-primary/5 text-primary"
                                        : "hover:border-primary/50 hover:bg-muted")
                                    }
                                    title={asset.name}
                                  >
                                    <asset.component className="size-5" />
                                  </button>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="assets" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-3 pt-4">
                  <div className="flex gap-2">
                    <Input
                      value={assetSearch}
                      onChange={(event) => setAssetSearch(event.target.value)}
                      placeholder="Tìm asset đã tải lên"
                    />
                    <Button variant="outline" onClick={() => uploadAsset("image")}>
                      <Upload className="size-4" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tab này chỉ lưu assets mà người dùng tải lên.
                  </div>
                  {libraryAssets.length === 0 ? (
                    <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                      Chưa có asset nào được tải lên.
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    {libraryAssets.map((asset) => (
                      <div
                        key={asset.assetId}
                        className="relative rounded-xl border bg-card p-3 transition hover:border-primary hover:shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => insertAsset(asset)}
                          className="w-full text-left"
                        >
                          <div className="mb-3 flex aspect-square items-center justify-center rounded-lg bg-muted/50">
                            {isHeroiconAsset(asset) ? (
                              <asset.component className="size-12 text-foreground" />
                            ) : asset.kind === "image" || asset.kind === "logo" ? (
                              <ImageIcon className="size-8 text-muted-foreground" />
                            ) : (
                              <div
                                className="size-12 text-foreground"
                                dangerouslySetInnerHTML={{ __html: asset.sourceValue }}
                              />
                            )}
                          </div>
                          <div className="pr-8 text-sm font-medium">{asset.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {isHeroiconAsset(asset) ? "Heroicons" : asset.kind}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteAsset(asset);
                          }}
                          className="absolute right-2 top-2 rounded-md border bg-background p-1 text-muted-foreground transition hover:border-destructive hover:text-destructive"
                          title={`Xoá ${asset.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="pages" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-3 pt-4">
                  {allowMultiplePages ? (
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      onClick={() => editor.addPage()}
                    >
                      <Plus className="mr-2 size-4" /> Add page
                    </Button>
                  ) : null}
                  {editor.state.pageOrder.map((pageId, index) => {
                    const page = editor.state.pagesById[pageId];
                    const selectedPage = editor.state.activePageId === pageId;
                    return (
                      <div
                        key={pageId}
                        className={`rounded-xl border p-3 ${selectedPage ? "border-primary bg-primary/5" : ""}`}
                      >
                        <button
                          className="w-full text-left"
                          onClick={() => editor.setActivePage(pageId)}
                        >
                          <div className="text-sm font-semibold">{page.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {page.width} × {page.height}
                          </div>
                        </button>
                        <div className="mt-3 flex gap-2">
                          {allowMultiplePages ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => editor.movePage(pageId, -1)}
                                disabled={index === 0}
                              >
                                ↑
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => editor.movePage(pageId, 1)}
                                disabled={index === editor.state.pageOrder.length - 1}
                              >
                                ↓
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={editor.duplicateActivePage}
                                disabled={!selectedPage}
                              >
                                Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => editor.removePage(pageId)}
                                disabled={editor.state.pageOrder.length <= 1}
                              >
                                Delete
                              </Button>
                            </>
                          ) : (
                            <div className="text-xs text-muted-foreground">Single-page mode</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        ) : (
          <div />
        )}

        <div ref={stageWrapRef} className="min-h-0 overflow-auto bg-muted/30 p-6" onWheel={handleCanvasWheel}>
          <div
            className="flex min-h-full items-start justify-center"
            style={{
              transform: `translate(${editor.state.viewport.panX}px, ${editor.state.viewport.panY}px)`,
              transformOrigin: "top left",
              cursor: stageCursor,
            }}
          >
            <DesignStage
              page={activePage}
              elements={editor.activeElements}
              scale={zoom}
              tool={tool}
              spacePressed={spacePressed}
              marqueeRect={marqueeRect}
              selectedIds={editor.state.selection.ids}
              primaryId={editor.state.selection.primaryId}
              snapLines={editor.state.viewport.snapLines}
              snapTargetIds={snapTargetIds}
              showSafeZone={editor.state.documentSettings.showSafeZone}
              showGrid={editor.state.documentSettings.showGrid}
              showGuides={editor.state.documentSettings.showGuides}
              renderCanvasContextMenu={renderCanvasContextMenu}
              renderElementContextMenu={renderElementContextMenu}
              editingTextId={editingTextId}
              editingTextValue={editingTextValue}
              onEditingTextValueChange={setEditingTextValue}
              onStartTextEdit={startInlineTextEdit}
              onCommitTextEdit={commitInlineTextEdit}
              onCancelTextEdit={cancelInlineTextEdit}
              onStageMouseDown={handleStageBackgroundMouseDown}
              onSelect={(elementId, additive) => {
                if (!elementId) {
                  editor.setSelection([]);
                  return;
                }
                const existing = editor.state.selection.ids;
                if (additive) {
                  if (existing.includes(elementId)) {
                    const nextIds = existing.filter((id) => id !== elementId);
                    editor.setSelection(nextIds, nextIds.at(-1) ?? null);
                  } else {
                    editor.setSelection([...existing, elementId], elementId);
                  }
                  return;
                }
                editor.setSelection([elementId], elementId);
              }}
              onMove={({ elementId, moveIds, originById, nextPrimaryX, nextPrimaryY }) => {
                const primaryTarget =
                  editor.activeElements.find((item) => item.elementId === elementId) ?? null;
                const primaryOrigin = originById[elementId];
                if (!primaryTarget || !primaryOrigin) return;
                if (editor.state.documentSettings.snapToGrid) {
                  const grid = editor.state.documentSettings.gridSize;
                  nextPrimaryX = Math.round(nextPrimaryX / grid) * grid;
                  nextPrimaryY = Math.round(nextPrimaryY / grid) * grid;
                }
                const snapped = snapMove(
                  activePage,
                  primaryTarget,
                  nextPrimaryX,
                  nextPrimaryY,
                  editor.activeElements.filter((element) => !moveIds.includes(element.elementId)),
                  zoom,
                );
                const appliedDx = snapped.x - primaryOrigin.x;
                const appliedDy = snapped.y - primaryOrigin.y;
                editor.setSnapLines(snapped.snapLines);
                setSnapTargetIds(snapped.snapTargetIds);
                editor.updateElements(
                  moveIds,
                  (element) => ({
                    x: clamp(
                      (originById[element.elementId]?.x ?? element.x) + appliedDx,
                      -activePage.width,
                      activePage.width * 2,
                    ),
                    y: clamp(
                      (originById[element.elementId]?.y ?? element.y) + appliedDy,
                      -activePage.height,
                      activePage.height * 2,
                    ),
                  }),
                  { history: false },
                );
              }}
              onMoveCommit={() => {
                editor.setSnapLines([]);
                setSnapTargetIds([]);
              }}
              onResize={({ elementId, patch, snapLines, snapTargetIds }) => {
                editor.updateElements([elementId], patch, { history: false });
                editor.setSnapLines(snapLines ?? []);
                setSnapTargetIds(snapTargetIds ?? []);
              }}
              onResizeCommit={() => {
                editor.setSnapLines([]);
                setSnapTargetIds([]);
              }}
            />
          </div>
        </div>

        {rightOpen ? (
          <aside className="min-h-0 overflow-hidden border-l">
            <Tabs value={rightTab} onValueChange={setRightTab} className="flex h-full flex-col">
              <TabsList className="mx-4 mt-4 grid grid-cols-3">
                <TabsTrigger value="properties">Properties</TabsTrigger>
                <TabsTrigger value="layers">Layers</TabsTrigger>
                <TabsTrigger value="brand">Brand</TabsTrigger>
              </TabsList>
              <TabsContent value="properties" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-4 pt-4">
                  <div className="rounded-xl border bg-card p-3">
                    <Label className="text-xs uppercase text-muted-foreground">Page</Label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <NumberField
                        label="W"
                        value={activePage.width}
                        onChange={(value) => editor.updatePage(activePage.pageId, { width: value })}
                      />
                      <NumberField
                        label="H"
                        value={activePage.height}
                        onChange={(value) =>
                          editor.updatePage(activePage.pageId, { height: value })
                        }
                      />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Label className="text-xs">Background</Label>
                      <Input
                        type="color"
                        value={activePage.background ?? "#ffffff"}
                        onChange={(event) =>
                          editor.updatePage(activePage.pageId, { background: event.target.value })
                        }
                        className="h-10 p-1"
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-sm">Grid snap</span>
                      <Button
                        size="sm"
                        variant={editor.state.documentSettings.snapToGrid ? "default" : "outline"}
                        onClick={() =>
                          editor.updateDocumentSettings({
                            snapToGrid: !editor.state.documentSettings.snapToGrid,
                          })
                        }
                      >
                        <Grid2X2 className="mr-2 size-4" />
                        {editor.state.documentSettings.snapToGrid ? "On" : "Off"}
                      </Button>
                    </div>
                  </div>

                  {primary ? (
                    <div className="space-y-4 rounded-xl border bg-card p-3">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase text-muted-foreground">Element</Label>
                        <Input
                          value={primary.name ?? ""}
                          onChange={(event) =>
                            editor.updateElements(
                              [primary.elementId],
                              { name: event.target.value },
                              { history: false },
                            )
                          }
                          placeholder="Layer name"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <NumberField
                          label="X"
                          value={primary.x}
                          onChange={(value) =>
                            editor.updateSelectedElements({ x: value }, { history: false })
                          }
                        />
                        <NumberField
                          label="Y"
                          value={primary.y}
                          onChange={(value) =>
                            editor.updateSelectedElements({ y: value }, { history: false })
                          }
                        />
                        <NumberField
                          label="W"
                          value={primary.width}
                          onChange={(value) =>
                            editor.updateSelectedElements({ width: value }, { history: false })
                          }
                        />
                        <NumberField
                          label="H"
                          value={primary.height}
                          onChange={(value) =>
                            editor.updateSelectedElements({ height: value }, { history: false })
                          }
                        />
                      </div>
                      <NumberField
                        label="Rotation"
                        value={primary.rotation ?? 0}
                        onChange={(value) =>
                          editor.updateSelectedElements({ rotation: value }, { history: false })
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            editor.updateSelectedElements(
                              { rotation: (primary.rotation ?? 0) - 15 },
                              { history: false },
                            )
                          }
                        >
                          <RotateCcw className="mr-2 size-4" /> -15°
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            editor.updateSelectedElements(
                              { rotation: (primary.rotation ?? 0) + 15 },
                              { history: false },
                            )
                          }
                        >
                          <RotateCw className="mr-2 size-4" /> +15°
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={editor.copySelection}>
                          <Copy className="mr-2 size-4" /> Copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={editor.duplicateSelection}>
                          <Layers className="mr-2 size-4" /> Duplicate
                        </Button>
                      </div>
                      <div className="space-y-2 border-t pt-3">
                        <Label className="text-xs uppercase text-muted-foreground">Layer</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => editor.orderSelection("front")}
                          >
                            Lên cùng
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => editor.orderSelection("forward")}
                          >
                            Lên 1 lớp
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => editor.orderSelection("backward")}
                          >
                            Xuống 1 lớp
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => editor.orderSelection("back")}
                          >
                            Xuống cùng
                          </Button>
                        </div>
                      </div>

                      {primary.kind === "text" ? (
                        <div className="space-y-3 border-t pt-3">
                          <Label className="text-xs uppercase text-muted-foreground">
                            Typography
                          </Label>
                          <div className="text-xs text-muted-foreground">
                            Double-click trực tiếp trên textbox để sửa nhanh nội dung.
                          </div>
                          <textarea
                            value={primary.text}
                            onChange={(event) =>
                              editor.updateElements(
                                [primary.elementId],
                                { text: event.target.value } as Partial<DesignElement>,
                                { history: false },
                              )
                            }
                            className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <NumberField
                              label="Font size"
                              value={Number(primary.style?.fontSize ?? 48)}
                              onChange={(value) =>
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), fontSize: value },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                )
                              }
                            />
                            <NumberField
                              label="Weight"
                              value={Number(primary.style?.fontWeight ?? 700)}
                              onChange={(value) =>
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), fontWeight: value },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Font family</Label>
                            <Select
                              value={String(primary.style?.fontFamily ?? "Be Vietnam Pro")}
                              onValueChange={(value) =>
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), fontFamily: value },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {availableFontFamilies.map((family) => (
                                  <SelectItem key={family} value={family}>
                                    {family}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Text color</Label>
                            <Input
                              type="color"
                              value={primary.style?.color ?? "#0f172a"}
                              onChange={(event) =>
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), color: event.target.value },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                )
                              }
                              className="h-10 p-1"
                            />
                          </div>
                        </div>
                      ) : null}

                      {primary.kind === "image" || primary.kind === "shape" ? (
                        <div className="space-y-3 border-t pt-3">
                          <Label className="text-xs uppercase text-muted-foreground">Visual</Label>
                          <div className="space-y-2">
                            <Label className="text-xs">Border radius</Label>
                            <Slider
                              value={[Number(primary.style?.borderRadius ?? 0)]}
                              min={0}
                              max={160}
                              step={2}
                              onValueChange={(value) =>
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), borderRadius: value[0] },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                )
                              }
                            />
                          </div>
                          {primary.kind === "shape" ? (
                            <div className="space-y-2">
                              <Label className="text-xs">Fill</Label>
                              <Input
                                type="color"
                                value={primary.style?.fill ?? "#f97316"}
                                onChange={(event) =>
                                  editor.updateElements(
                                    [primary.elementId],
                                    {
                                      style: { ...(primary.style ?? {}), fill: event.target.value },
                                    } as Partial<DesignElement>,
                                    { history: false },
                                  )
                                }
                                className="h-10 p-1"
                              />
                            </div>
                          ) : null}
                          {primary.kind === "image" ? (
                            <div className="space-y-2">
                              <Label className="text-xs">Fit</Label>
                              <Select
                                value={primary.style?.fit ?? "cover"}
                                onValueChange={(value) =>
                                  editor.updateElements(
                                    [primary.elementId],
                                    {
                                      style: {
                                        ...(primary.style ?? {}),
                                        fit: value as "cover" | "contain" | "stretch",
                                      },
                                    } as Partial<DesignElement>,
                                    { history: false },
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cover">cover</SelectItem>
                                  <SelectItem value="contain">contain</SelectItem>
                                  <SelectItem value="stretch">stretch</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                      Chọn một element để chỉnh thuộc tính.
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="layers" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-2 pt-4">
                  {layerTree(editor.activeElements).map(({ element, depth }) => {
                    const selectedLayer = editor.state.selection.ids.includes(element.elementId);
                    return (
                      <div
                        key={element.elementId}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selectedLayer ? "border-primary bg-primary/5" : "bg-card"}`}
                        style={{ paddingLeft: 12 + depth * 18 }}
                      >
                        <button
                          className="flex-1 truncate text-left"
                          onClick={() =>
                            editor.setSelection([element.elementId], element.elementId)
                          }
                        >
                          {element.name ?? element.kind}
                        </button>
                        <button
                          onClick={() =>
                            editor.updateElements(
                              [element.elementId],
                              { hidden: !element.hidden },
                              { history: false },
                            )
                          }
                        >
                          {element.hidden ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            editor.updateElements(
                              [element.elementId],
                              { locked: !element.locked },
                              { history: false },
                            )
                          }
                        >
                          {element.locked ? (
                            <Lock className="size-4" />
                          ) : (
                            <LockOpen className="size-4" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="brand" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-4 pt-4">
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={createBrandKit}>
                      <Plus className="mr-2 size-4" /> New kit
                    </Button>
                    <Button variant="outline" onClick={uploadFont}>
                      <Upload className="mr-2 size-4" /> Upload font
                    </Button>
                    <Button variant="outline" onClick={() => uploadAsset("logo")}>
                      <Upload className="mr-2 size-4" /> Upload logo
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground">
                      Current brand kit
                    </Label>
                    <Select
                      value={currentBrandKit?.brandKitId ?? "__none__"}
                      onValueChange={(value) =>
                        persistBrandKitSelection(value === "__none__" ? undefined : value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chưa chọn brand kit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Không dùng</SelectItem>
                        {brandKits.map((kit) => (
                          <SelectItem key={kit.brandKitId} value={kit.brandKitId}>
                            {kit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {currentBrandKit ? (
                    <div className="space-y-4 rounded-xl border bg-card p-3">
                      <Input
                        value={currentBrandKit.name}
                        onChange={(event) => updateBrandKit({ name: event.target.value })}
                      />
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">Palette</Label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {currentBrandKit.colors.map((color, index) => (
                            <button
                              key={`${color}-${index}`}
                              className="size-10 rounded-full border"
                              style={{ background: color }}
                              onClick={() => {
                                if (!primary) return;
                                const styleKey = primary.kind === "text" ? "color" : "fill";
                                editor.updateElements(
                                  [primary.elementId],
                                  {
                                    style: { ...(primary.style ?? {}), [styleKey]: color },
                                  } as Partial<DesignElement>,
                                  { history: false },
                                );
                              }}
                            />
                          ))}
                          <label className="flex size-10 cursor-pointer items-center justify-center rounded-full border bg-muted">
                            <Plus className="size-4" />
                            <input
                              type="color"
                              className="sr-only"
                              onChange={(event) =>
                                updateBrandKit({
                                  colors: [...currentBrandKit.colors, event.target.value],
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">Fonts</Label>
                        <div className="mt-3 space-y-2">
                          {fontAssets.map((fontAsset) => {
                            const selectedFont = currentBrandKit.fontAssetIds.includes(
                              fontAsset.fontAssetId,
                            );
                            return (
                              <button
                                key={fontAsset.fontAssetId}
                                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${selectedFont ? "border-primary bg-primary/5" : ""}`}
                                onClick={() =>
                                  updateBrandKit({
                                    fontAssetIds: selectedFont
                                      ? currentBrandKit.fontAssetIds.filter(
                                          (id) => id !== fontAsset.fontAssetId,
                                        )
                                      : [...currentBrandKit.fontAssetIds, fontAsset.fontAssetId],
                                  })
                                }
                              >
                                <span style={{ fontFamily: fontAsset.family }}>
                                  {fontAsset.family}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {selectedFont ? "On" : "Off"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                      Tạo Brand Kit để lưu palette, font và logo cho editor.
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

function DesignStage({
  page,
  elements,
  scale,
  tool,
  spacePressed,
  marqueeRect,
  selectedIds,
  primaryId,
  snapLines,
  snapTargetIds,
  showSafeZone,
  showGrid,
  showGuides,
  renderCanvasContextMenu,
  renderElementContextMenu,
  editingTextId,
  editingTextValue,
  onEditingTextValueChange,
  onStartTextEdit,
  onCommitTextEdit,
  onCancelTextEdit,
  onStageMouseDown,
  onSelect,
  onMove,
  onMoveCommit,
  onResize,
  onResizeCommit,
}: {
  page: DesignPage;
  elements: DesignElement[];
  scale: number;
  tool: DesignTool;
  spacePressed: boolean;
  marqueeRect: { x: number; y: number; width: number; height: number } | null;
  selectedIds: string[];
  primaryId: string | null;
  snapLines: Array<{ axis: "x" | "y"; value: number }>;
  snapTargetIds: string[];
  showSafeZone: boolean;
  showGrid: boolean;
  showGuides: boolean;
  renderCanvasContextMenu: () => React.ReactNode;
  renderElementContextMenu: (element: DesignElement) => React.ReactNode;
  editingTextId: string | null;
  editingTextValue: string;
  onEditingTextValueChange: (value: string) => void;
  onStartTextEdit: (elementId: string) => void;
  onCommitTextEdit: () => void;
  onCancelTextEdit: () => void;
  onStageMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSelect: (elementId: string | null, additive: boolean) => void;
  onMove: (payload: {
    elementId: string;
    moveIds: string[];
    originById: Record<string, { x: number; y: number }>;
    nextPrimaryX: number;
    nextPrimaryY: number;
  }) => void;
  onMoveCommit: () => void;
  onResize: (payload: {
    elementId: string;
    patch: Partial<DesignElement>;
    snapLines?: Array<{ axis: "x" | "y"; value: number }>;
    snapTargetIds?: string[];
  }) => void;
  onResizeCommit: () => void;
}) {
  const toolIsPan = isPanToolActive(tool, spacePressed);
  const guideColor = "rgba(56,189,248,0.9)";
  const gridSize = 40 * scale;
  const gridBackground = showGrid
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
      }
    : undefined;
  const bounds = getSelectionBounds(
    selectedIds
      .map((id) => elements.find((element) => element.elementId === id))
      .filter((element): element is DesignElement => !!element),
  );

  return (
    <div className="relative bg-transparent p-0 shadow-none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="relative overflow-hidden border border-border bg-background"
            data-design-canvas
            style={{ width: page.width * scale, height: page.height * scale, ...gridBackground }}
            onMouseDown={onStageMouseDown}
          >
            {showGuides
              ? page.guides?.map((guide) => (
                  <div
                    key={guide.guideId}
                    className="pointer-events-none absolute"
                    style={{
                      left: guide.axis === "x" ? guide.value * scale : 0,
                      top: guide.axis === "y" ? guide.value * scale : 0,
                      width: guide.axis === "x" ? 1 : "100%",
                      height: guide.axis === "y" ? 1 : "100%",
                      background: guideColor,
                      opacity: 0.9,
                    }}
                  />
                ))
              : null}
            {marqueeRect ? (
              <div
                className="pointer-events-none absolute border border-primary/80 bg-primary/10"
                style={{
                  left: marqueeRect.x * scale,
                  top: marqueeRect.y * scale,
                  width: marqueeRect.width * scale,
                  height: marqueeRect.height * scale,
                }}
              />
            ) : null}
            {toolIsPan ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
                Pan mode
              </div>
            ) : null}
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow">
              Select: V · Pan: H / Space · Zoom: Ctrl/Cmd + Wheel
            </div>
            <div className="pointer-events-none absolute left-0 top-0 h-6 w-full border-b bg-background/80 text-[10px] text-muted-foreground">
              <div className="relative h-full w-full">
                {showGuides &&
                  page.guides?.map((guide) =>
                    guide.axis === "x" ? (
                      <div
                        key={`ruler-x-${guide.guideId}`}
                        className="absolute top-0 h-full w-px"
                        style={{ left: guide.value * scale, background: guideColor }}
                      />
                    ) : null,
                  )}
              </div>
            </div>
            <div className="pointer-events-none absolute left-0 top-0 h-full w-6 border-r bg-background/80 text-[10px] text-muted-foreground">
              <div className="relative h-full w-full">
                {showGuides &&
                  page.guides?.map((guide) =>
                    guide.axis === "y" ? (
                      <div
                        key={`ruler-y-${guide.guideId}`}
                        className="absolute left-0 h-px w-full"
                        style={{ top: guide.value * scale, background: guideColor }}
                      />
                    ) : null,
                  )}
              </div>
            </div>
            <div className="pointer-events-none absolute left-0 top-0 grid h-full w-full" style={{ gridTemplateColumns: "24px 1fr", gridTemplateRows: "24px 1fr" }}>
              <div className="border-b border-r bg-background/85" />
              <div />
              <div />
              <div />
            </div>
            <div className="absolute left-6 top-6" style={{ width: page.width * scale - 24, height: page.height * scale - 24 }}>
            <div className="pointer-events-none absolute inset-0">
              <DesignRenderer
                page={page}
                elements={elements}
                scale={scale}
                suppressElementIds={editingTextId ? [editingTextId] : []}
              />
            </div>
            {showSafeZone ? (
              <LayoutGuides
                width={page.width}
                height={page.height}
                scale={scale}
                showBleed={false}
                showTrim={false}
                showSafeZone
              />
            ) : null}

            {snapLines.map((line, index) => (
              <div
                key={`${line.axis}-${line.value}-${index}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: line.axis === "x" ? line.value * scale : 0,
                    top: line.axis === "y" ? line.value * scale : 0,
                    width: line.axis === "x" ? 1 : "100%",
                    height: line.axis === "y" ? 1 : "100%",
                    background: "rgba(236,72,153,0.95)",
                  }}
                />
              </div>
            ))}

            {elements
              .filter((element) => !element.hidden)
              .slice()
              .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
              .map((element) => {
                const selected = selectedIds.includes(element.elementId);
                const primary = primaryId === element.elementId;
                const isSnapTarget = snapTargetIds.includes(element.elementId);
                const isEditingText =
                  editingTextId === element.elementId && element.kind === "text";
                const textEditorStyle =
                  element.kind === "text" ? buildTextStyle(element.style, scale) : undefined;

                const overlay = (
                  <div
                    onContextMenu={() => {
                      if (!selected) onSelect(element.elementId, false);
                    }}
                    onDoubleClick={(event) => {
                      if (element.kind !== "text") return;
                      event.stopPropagation();
                      onStartTextEdit(element.elementId);
                    }}
                    onMouseDown={(event) => {
                      if (isEditingText || toolIsPan) return;
                      event.stopPropagation();
                      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
                      onSelect(element.elementId, additive);
                      if (additive || element.locked) return;
                      const canvas = (event.currentTarget as HTMLElement).closest(
                        "[data-design-canvas]",
                      ) as HTMLElement | null;
                      const startPoint = getCanvasPoint(canvas, scale, event.clientX, event.clientY, 0, 0);
                      const baseIds = selectedIds.includes(element.elementId)
                        ? selectedIds
                        : [element.elementId];
                      const moveIds = new Set<string>(baseIds);
                      elements.forEach((entry) => {
                        if (baseIds.includes(entry.elementId) && entry.kind === "group") {
                          getDescendantIds(elements, entry.elementId).forEach((id) =>
                            moveIds.add(id),
                          );
                        }
                      });
                      const originById = Object.fromEntries(
                        Array.from(moveIds)
                          .map((id) => elements.find((entry) => entry.elementId === id))
                          .filter((entry): entry is DesignElement => !!entry)
                          .map((entry) => [entry.elementId, { x: entry.x, y: entry.y }]),
                      );
                      const pointerOffsetX = startPoint.x - element.x;
                      const pointerOffsetY = startPoint.y - element.y;
                      const onMouseMove = (moveEvent: MouseEvent) => {
                        const point = getCanvasPoint(canvas, scale, moveEvent.clientX, moveEvent.clientY, 0, 0);
                        let nextPrimaryX = point.x - pointerOffsetX;
                        let nextPrimaryY = point.y - pointerOffsetY;
                        if (moveEvent.shiftKey) {
                          const deltaX = nextPrimaryX - originById[element.elementId].x;
                          const deltaY = nextPrimaryY - originById[element.elementId].y;
                          if (Math.abs(deltaX) >= Math.abs(deltaY)) nextPrimaryY = originById[element.elementId].y;
                          else nextPrimaryX = originById[element.elementId].x;
                        }
                        onMove({
                          elementId: element.elementId,
                          moveIds: Array.from(moveIds),
                          originById,
                          nextPrimaryX,
                          nextPrimaryY,
                        });
                      };
                      const onMouseUp = () => {
                        window.removeEventListener("mousemove", onMouseMove);
                        window.removeEventListener("mouseup", onMouseUp);
                        onMoveCommit();
                      };
                      window.addEventListener("mousemove", onMouseMove);
                      window.addEventListener("mouseup", onMouseUp);
                    }}
                    style={{
                      position: "absolute",
                      left: element.x * scale,
                      top: element.y * scale,
                      width: element.width * scale,
                      height: element.height * scale,
                      border: isSnapTarget
                        ? "2px solid rgba(236,72,153,0.9)"
                        : selected
                          ? "1px dashed rgba(15,23,42,0.55)"
                          : "1px solid transparent",
                      outline: primary ? "2px solid hsl(var(--primary))" : undefined,
                      outlineOffset: primary ? 2 : undefined,
                      background: isSnapTarget
                        ? "rgba(236,72,153,0.08)"
                        : selected
                          ? "rgba(59,130,246,0.06)"
                          : "transparent",
                      cursor: element.locked ? "default" : "move",
                      boxSizing: "border-box",
                    }}
                  >
                    {isEditingText && textEditorStyle ? (
                      <textarea
                        autoFocus
                        value={editingTextValue}
                        onChange={(event) => onEditingTextValueChange(event.target.value)}
                        onBlur={onCommitTextEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            onCancelTextEdit();
                          }
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            onCommitTextEdit();
                          }
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        className="absolute inset-0 resize-none bg-transparent outline-none"
                        style={{
                          ...textEditorStyle,
                          width: "100%",
                          height: "100%",
                          border: "none",
                        }}
                      />
                    ) : null}

                    {primary && !element.locked && element.kind !== "group" && !isEditingText ? (
                      <>
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -34,
                            width: 2,
                            height: 18,
                            marginLeft: -1,
                            background: "hsl(var(--primary))",
                            opacity: 0.7,
                          }}
                        />
                        <button
                          onMouseDown={(event) => {
                            event.stopPropagation();
                            const canvas = (event.currentTarget as HTMLElement).closest(
                              "[data-design-canvas]",
                            ) as HTMLElement | null;
                            const centerX = element.x + element.width / 2;
                            const centerY = element.y + element.height / 2;
                            const startPoint = getCanvasPoint(canvas, scale, event.clientX, event.clientY, 0, 0);
                            const startAngle = Math.atan2(
                              startPoint.y - centerY,
                              startPoint.x - centerX,
                            );
                            const originRotation = element.rotation ?? 0;
                            const onMouseMove = (moveEvent: MouseEvent) => {
                              const point = getCanvasPoint(canvas, scale, moveEvent.clientX, moveEvent.clientY, 0, 0);
                              const currentAngle = Math.atan2(point.y - centerY, point.x - centerX);
                              const deltaDeg = ((currentAngle - startAngle) * 180) / Math.PI;
                              onResize(element.elementId, {
                                rotation: snapRotation(Math.round(originRotation + deltaDeg), moveEvent),
                              });
                            };
                            const onMouseUp = () => {
                              window.removeEventListener("mousemove", onMouseMove);
                              window.removeEventListener("mouseup", onMouseUp);
                              onResizeCommit();
                            };
                            window.addEventListener("mousemove", onMouseMove);
                            window.addEventListener("mouseup", onMouseUp);
                          }}
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: -52,
                            width: 28,
                            height: 28,
                            marginLeft: -14,
                            borderRadius: 9999,
                            border: "2px solid hsl(var(--primary))",
                            background: "#ffffff",
                            boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
                            display: "grid",
                            placeItems: "center",
                            cursor: "grab",
                            zIndex: 24,
                          }}
                          title="Xoay"
                        >
                          <RotateCw className="size-4 text-primary" />
                        </button>
                        {RESIZE_HANDLES.map((handle) => (
                          <button
                            key={handle.key}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                              const startX = event.clientX;
                              const startY = event.clientY;
                              const origin = {
                                x: element.x,
                                y: element.y,
                                width: element.width,
                                height: element.height,
                              };
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                const dx = (moveEvent.clientX - startX) / scale;
                                const dy = (moveEvent.clientY - startY) / scale;
                                const draft = applyResizeModifiers(
                                  origin,
                                  handle.key,
                                  dx,
                                  dy,
                                  moveEvent.shiftKey,
                                  moveEvent.altKey,
                                );
                                const snapped = snapResize(
                                  page,
                                  element.elementId,
                                  handle.key,
                                  {
                                    x: draft.x,
                                    y: draft.y,
                                    width: draft.width,
                                    height: draft.height,
                                  },
                                  elements.filter((entry) => entry.elementId !== element.elementId),
                                  scale,
                                );
                                onResize({
                                  elementId: element.elementId,
                                  patch: {
                                    x: snapped.x,
                                    y: snapped.y,
                                    width: snapped.width,
                                    height: snapped.height,
                                  },
                                  snapLines: snapped.snapLines,
                                  snapTargetIds: snapped.snapTargetIds,
                                });
                              };
                              const onMouseUp = () => {
                                window.removeEventListener("mousemove", onMouseMove);
                                window.removeEventListener("mouseup", onMouseUp);
                                onResizeCommit();
                              };
                              window.addEventListener("mousemove", onMouseMove);
                              window.addEventListener("mouseup", onMouseUp);
                            }}
                            style={{
                              position: "absolute",
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: "#ffffff",
                              border: "2px solid hsl(var(--primary))",
                              boxShadow: "0 2px 6px rgba(15,23,42,0.15)",
                              cursor: handle.cursor,
                              zIndex: 20,
                              ...handle.style,
                            }}
                          />
                        ))}
                      </>
                    ) : null}
                  </div>
                );

                return (
                  <ContextMenu key={element.elementId}>
                    <ContextMenuTrigger asChild>{overlay}</ContextMenuTrigger>
                    {renderElementContextMenu(element)}
                  </ContextMenu>
                );
              })}

            {bounds ? (
              <div
                className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary/70"
                style={{
                  left: bounds.x * scale - 6,
                  top: bounds.y * scale - 6,
                  width: bounds.width * scale + 12,
                  height: bounds.height * scale + 12,
                }}
              />
            ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
        {renderCanvasContextMenu()}
      </ContextMenu>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </div>
  );
}
