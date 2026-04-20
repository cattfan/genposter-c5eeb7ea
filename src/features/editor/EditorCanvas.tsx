import { useRef, useCallback, useState } from "react";
import { X, ImageIcon, Layers as LayersIcon } from "lucide-react";
import type { PageTemplate, Slot } from "@/models";
import {
  buildBoxShadow,
  buildCssFilter,
  buildFlipTransform,
  buildBorder,
  buildGradient,
  buildTextStyle,
  shapeBorderRadius,
  shapeClipPath,
} from "@/engines/binding/dataBinding";
import { CropOverlay } from "./CropOverlay";
import { SlotContextMenu, type SlotMenuActions } from "./SlotContextMenu";

export function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 w-full border rounded px-2 text-sm"
      />
    </div>
  );
}

export function Canvas({
  template,
  zoom,
  selectedSlotId,
  onSelect,
  onUpdateSlot,
  onDeleteSlot,
  buildMenuActions,
}: {
  template: PageTemplate;
  zoom: number;
  selectedSlotId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateSlot: (slotId: string, patch: Partial<Slot>) => void;
  onDeleteSlot?: (slotId: string) => void;
  buildMenuActions?: (slotId: string) => SlotMenuActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cropSlotId, setCropSlotId] = useState<string | null>(null);

  const cropSlot = cropSlotId ? template.slots.find((s) => s.slotId === cropSlotId) : null;

  return (
    <div
      ref={ref}
      className="relative shadow-2xl"
      style={{
        width: template.canvas.width * zoom,
        height: template.canvas.height * zoom,
        background: template.canvas.background ?? "#fff",
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onSelect(null);
      }}
    >
      {template.slots
        .slice()
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((slot) => (
          <SlotEditor
            key={slot.slotId}
            slot={slot}
            zoom={zoom}
            selected={slot.slotId === selectedSlotId}
            onSelect={() => onSelect(slot.slotId)}
            onUpdate={(patch) => onUpdateSlot(slot.slotId, patch)}
            onDelete={() => onDeleteSlot?.(slot.slotId)}
            onStartCrop={() => setCropSlotId(slot.slotId)}
            template={template}
            menuActions={buildMenuActions?.(slot.slotId)}
          />
        ))}
      {cropSlot && cropSlot.staticImage && (
        <div
          style={{
            position: "absolute",
            left: cropSlot.x * zoom,
            top: cropSlot.y * zoom,
            width: cropSlot.width * zoom,
            height: cropSlot.height * zoom,
          }}
        >
          <CropOverlay
            src={cropSlot.staticImage}
            initial={cropSlot.crop}
            zoom={zoom}
            width={cropSlot.width}
            height={cropSlot.height}
            onCommit={(crop) => {
              onUpdateSlot(cropSlot.slotId, { crop });
              setCropSlotId(null);
            }}
            onCancel={() => setCropSlotId(null)}
          />
        </div>
      )}
    </div>
  );
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function SlotEditor({
  slot,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  onStartCrop,
  template,
  menuActions,
}: {
  slot: Slot;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Slot>) => void;
  onDelete: () => void;
  onStartCrop: () => void;
  template: PageTemplate;
  menuActions?: SlotMenuActions;
}) {
  const startMove = useCallback(
    (e: React.MouseEvent) => {
      if (slot.locked) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: slot.x, y: slot.y };
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        onUpdate({ x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot, zoom, onSelect, onUpdate],
  );

  const startResize = useCallback(
    (e: React.MouseEvent, handle: Handle) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: slot.x, y: slot.y, w: slot.width, h: slot.height };
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let { x, y, w, h } = orig;
        if (handle.includes("e")) w = Math.max(20, orig.w + dx);
        if (handle.includes("s")) h = Math.max(20, orig.h + dy);
        if (handle.includes("w")) {
          w = Math.max(20, orig.w - dx);
          x = orig.x + (orig.w - w);
        }
        if (handle.includes("n")) {
          h = Math.max(20, orig.h - dy);
          y = orig.y + (orig.h - h);
        }
        onUpdate({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot, zoom, onSelect, onUpdate],
  );

  const flip = buildFlipTransform(slot.style);
  const rot = slot.rotation ? `rotate(${slot.rotation}deg)` : "";
  const transform = (rot + flip).trim() || undefined;

  const isHidden = !!slot.style?.hidden;
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: slot.x * zoom,
    top: slot.y * zoom,
    width: slot.width * zoom,
    height: slot.height * zoom,
    transform,
    cursor: slot.locked ? "not-allowed" : "move",
    outline: selected
      ? "2px solid hsl(var(--primary))"
      : isHidden
        ? "1px dashed rgba(239,68,68,0.5)"
        : "1px dashed rgba(0,0,0,0.15)",
    outlineOffset: 0,
    boxSizing: "border-box",
    // Khi ẩn: editor render mờ + viền đỏ để designer biết block tồn tại nhưng không xuất hiện trong export.
    opacity: isHidden ? 0.25 : (slot.style?.opacity ?? 1),
    boxShadow: buildBoxShadow(slot.style, zoom),
  };

  let content: React.ReactNode = null;
  if (slot.kind === "text") {
    const displayText = slot.staticText;
    const textCss = buildTextStyle(slot.style, zoom);
    content = (
      <div
        style={{
          ...textCss,
          width: "100%",
          height: "100%",
        }}
      >
        {displayText}
      </div>
    );
  } else if (slot.kind === "image") {
    const filter = buildCssFilter(slot.style);
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const displaySrc = slot.staticImage;
    const crop = slot.crop;

    // Khi có crop, render qua wrapper overflow:hidden + img scale lên rồi offset
    const imgEl = displaySrc ? (
      crop ? (
        <img
          src={displaySrc}
          alt=""
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={{
            position: "absolute",
            left: `${-crop.x * 100}%`,
            top: `${-crop.y * 100}%`,
            width: `${100 / crop.w}%`,
            height: `${100 / crop.h}%`,
            objectFit: "fill",
            filter,
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      ) : (
        <img
          src={displaySrc}
          alt=""
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={{
            width: "100%",
            height: "100%",
            objectFit,
            borderRadius: (slot.style?.borderRadius ?? 0) * zoom,
            filter,
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      )
    ) : (
      <div className="w-full h-full bg-muted/50 grid place-items-center text-xs text-muted-foreground gap-1 flex-col">
        <ImageIcon className="size-5 opacity-50" />
        <span>Image placeholder</span>
      </div>
    );
    content = (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          borderRadius: (slot.style?.borderRadius ?? 0) * zoom,
        }}
      >
        {imgEl}
        {slot.style?.overlayColor && (
          <div style={{ position: "absolute", inset: 0, background: slot.style.overlayColor, pointerEvents: "none" }} />
        )}
      </div>
    );
  } else if (slot.kind === "shape") {
    const gradient = buildGradient(slot.style);
    const fill = gradient ?? slot.style?.fill ?? "#000";
    const filter = buildCssFilter(slot.style);
    const border = buildBorder(slot.style, zoom);
    const radius = shapeBorderRadius(slot.shapeKind, slot.style?.borderRadius, zoom);
    const clip = slot.shapeKind ? shapeClipPath(slot.shapeKind) : undefined;
    const objectFit = (slot.style?.fit === "stretch" ? "fill" : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"];
    const src = slot.staticImage;

    if (slot.shapeKind === "line" || slot.shapeKind === "divider") {
      content = (
        <div
          style={{
            width: "100%",
            height: Math.max(2, (slot.style?.strokeWidth ?? 2) * zoom),
            background: fill,
            marginTop: `calc(50% - ${Math.max(1, (slot.style?.strokeWidth ?? 2) * zoom) / 2}px)`,
          }}
        />
      );
    } else {
      content = (
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            background: src ? undefined : fill,
            borderRadius: radius,
            clipPath: clip,
            border: src ? undefined : border,
            overflow: "hidden",
          }}
        >
          {src ? (
            <>
              <img
                src={src}
                alt=""
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit,
                  filter,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
              {slot.style?.overlayColor && (
                <div style={{ position: "absolute", inset: 0, background: slot.style.overlayColor, pointerEvents: "none" }} />
              )}
            </>
          ) : null}
        </div>
      );
    }
  } else if (slot.kind === "section") {
    const sec = template.sections.find((s) => s.sectionId === slot.sectionRefId);
    content = (
      <div className="w-full h-full bg-accent/30 border-2 border-dashed border-accent grid place-items-center text-accent-foreground text-xs p-2 text-center gap-1">
        <LayersIcon className="size-4" />
        <span>Section: {sec?.title ?? "(chưa gán)"}</span>
      </div>
    );
  }

  // 8 resize handles
  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: "nw", style: { left: -5, top: -5 }, cursor: "nwse-resize" },
    { h: "n", style: { left: "50%", top: -5, marginLeft: -5 }, cursor: "ns-resize" },
    { h: "ne", style: { right: -5, top: -5 }, cursor: "nesw-resize" },
    { h: "e", style: { right: -5, top: "50%", marginTop: -5 }, cursor: "ew-resize" },
    { h: "se", style: { right: -5, bottom: -5 }, cursor: "nwse-resize" },
    { h: "s", style: { left: "50%", bottom: -5, marginLeft: -5 }, cursor: "ns-resize" },
    { h: "sw", style: { left: -5, bottom: -5 }, cursor: "nesw-resize" },
    { h: "w", style: { left: -5, top: "50%", marginTop: -5 }, cursor: "ew-resize" },
  ];

  const slotEl = (
    <div
      style={baseStyle}
      onMouseDown={startMove}
      onContextMenu={(e) => {
        // chọn slot trước khi mở context menu
        if (!selected) onSelect();
      }}
      onDoubleClick={(e) => {
        if (slot.kind === "image" && slot.staticImage && !slot.locked) {
          e.stopPropagation();
          onStartCrop();
        }
      }}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selected) {
          e.preventDefault();
          onDelete();
        }
      }}
      tabIndex={selected ? 0 : -1}
    >
      {content}
      {selected && !slot.locked && (
        <>
          {handles.map((hd) => (
            <div
              key={hd.h}
              onMouseDown={(e) => startResize(e, hd.h)}
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                background: "white",
                border: "2px solid hsl(var(--primary))",
                cursor: hd.cursor,
                borderRadius: 2,
                zIndex: 10,
                ...hd.style,
              }}
            />
          ))}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              position: "absolute",
              right: -12,
              top: -32,
              background: "hsl(var(--destructive))",
              color: "white",
              border: "none",
              borderRadius: 4,
              padding: "4px 6px",
              cursor: "pointer",
              zIndex: 11,
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              lineHeight: 1,
            }}
            title="Xoá block (Delete)"
          >
            <X className="size-3" />
            <span>Xoá</span>
          </button>
        </>
      )}
    </div>
  );

  if (menuActions) {
    return (
      <SlotContextMenu slot={slot} actions={menuActions}>
        {slotEl}
      </SlotContextMenu>
    );
  }
  return slotEl;
}
